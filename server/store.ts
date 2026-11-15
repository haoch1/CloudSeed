import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { decrypt, encrypt, hashToken } from "./security.js";
import type { Account, AuditEntry } from "../shared/types.js";
import { auditMatches } from "../shared/audit.js";

export interface Credentials {
  token: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}
interface AccountRow {
  id: string;
  name: string;
  account_id: string;
  credentials: string;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;
  readonly key: Buffer;
  readonly setupToken: string;

  constructor(directory: string) {
    const root = resolve(directory);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const keyPath = join(root, "encryption.key");
    const databasePath = join(root, "cloudseed.sqlite");
    if (!existsSync(keyPath) && existsSync(databasePath)) {
      throw new Error(
        "加密密钥缺失，请从备份恢复 encryption.key 和对应数据库",
      );
    }
    if (!existsSync(keyPath))
      writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error("encryption.key 格式错误");
    const setupPath = join(root, "setup-token");
    if (!existsSync(setupPath))
      writeFileSync(setupPath, randomBytes(24).toString("hex"), {
        mode: 0o600,
        flag: "wx",
      });
    this.setupToken = readFileSync(setupPath, "utf8").trim();
    this.db = new DatabaseSync(databasePath);
    this.db.function(
      "audit_search_match",
      { deterministic: true },
      (search, action, accountName, resource, status, detail) =>
        auditMatches(
          {
            action: String(action),
            accountName: String(accountName),
            resource: String(resource),
            status: String(status),
            detail: String(detail),
          },
          String(search),
        )
          ? 1
          : 0,
    );
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id = 1), email TEXT NOT NULL, password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL, duration_seconds INTEGER);
      CREATE TABLE IF NOT EXISTS panel_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, account_id TEXT NOT NULL UNIQUE, credentials TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, account_name TEXT NOT NULL, resource TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, bucket TEXT NOT NULL, jurisdiction TEXT NOT NULL, object_key TEXT NOT NULL, size INTEGER NOT NULL, upload_id TEXT, expected_etag TEXT, completed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    `);
    const sessionColumns = this.db
      .prepare("PRAGMA table_info(sessions)")
      .all() as unknown as { name: string }[];
    if (!sessionColumns.some((column) => column.name === "duration_seconds"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN duration_seconds INTEGER");
  }

  listAccounts(): Account[] {
    return (
      this.db
        .prepare("SELECT * FROM accounts ORDER BY created_at")
        .all() as unknown as AccountRow[]
    ).map((row) => this.publicAccount(row));
  }

  getAccount(id: string): (Account & { credentials: Credentials }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(id) as unknown as AccountRow | undefined;
    if (!row) return undefined;
    return {
      ...this.publicAccount(row),
      credentials: decrypt<Credentials>(row.credentials, this.key),
    };
  }

  saveAccount(input: {
    id?: string;
    name: string;
    accountId: string;
    credentials: Credentials;
  }): Account {
    const id = input.id ?? randomUUID();
    const encrypted = encrypt(input.credentials, this.key);
    if (input.id) {
      this.db
        .prepare(
          "UPDATE accounts SET name = ?, account_id = ?, credentials = ? WHERE id = ?",
        )
        .run(input.name, input.accountId, encrypted, id);
    } else {
      this.db
        .prepare(
          "INSERT INTO accounts(id,name,account_id,credentials) VALUES(?,?,?,?)",
        )
        .run(id, input.name, input.accountId, encrypted);
    }
    return this.listAccounts().find((account) => account.id === id)!;
  }

  audit(
    action: string,
    accountName: string,
    resource: string,
    status = "success",
    detail = "",
  ): void {
    this.db
      .prepare(
        "INSERT INTO audit(action,account_name,resource,status,detail) VALUES(?,?,?,?,?)",
      )
      .run(
        action,
        accountName,
        resource.slice(0, 500),
        status,
        detail.slice(0, 1000),
      );
  }

  listAudit(page: number, search = ""): { items: AuditEntry[]; total: number } {
    const term = search.trim();
    const where = term
      ? " WHERE audit_search_match(?, action, account_name, resource, status, detail) = 1"
      : "";
    const searchParams = term ? [term] : [];
    const items = this.db
      .prepare(
        `SELECT id, action, account_name AS accountName, resource, status, detail, created_at AS createdAt FROM audit${where} ORDER BY id DESC LIMIT 50 OFFSET ?`,
      )
      .all(...searchParams, (page - 1) * 50) as unknown as AuditEntry[];
    const count = this.db
      .prepare(`SELECT COUNT(*) AS total FROM audit${where}`)
      .get(...searchParams) as { total: number };
    return { items, total: count.total };
  }

  private publicAccount(row: AccountRow): Account {
    const credentials = decrypt<Credentials>(row.credentials, this.key);
    const hasS3 = Boolean(
      credentials.accessKeyId && credentials.secretAccessKey,
    );
    return {
      id: row.id,
      name: row.name,
      accountId: row.account_id,
      hasS3,
      s3CredentialType: !hasS3
        ? "none"
        : credentials.secretAccessKey === hashToken(credentials.token)
          ? "token"
          : "manual",
      createdAt: row.created_at,
    };
  }
}
