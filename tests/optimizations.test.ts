import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Cloudflare, ApiError } from "../server/cloudflare.js";
import { verifyPassword } from "../server/security.js";
import { Store } from "../server/store.js";
import { cachedS3Client, destroyS3Clients } from "../server/r2.js";
import { formatBytes } from "../src/api.js";

test("Cloudflare 客户端优雅处理非 JSON 响应、超时与网络异常", async () => {
  const htmlGateway = new Cloudflare(
    "test",
    async () =>
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
  );
  await assert.rejects(
    htmlGateway.call("/zones"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 502 &&
      error.message.includes("非 JSON"),
  );

  const timeoutClient = new Cloudflare("test", async () => {
    const error = new Error("The operation timed out");
    error.name = "TimeoutError";
    throw error;
  });
  await assert.rejects(
    timeoutClient.call("/zones"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 504 &&
      error.message.includes("超时"),
  );

  const networkClient = new Cloudflare("test", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    networkClient.call("/zones"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 502 &&
      error.message.includes("无法连接"),
  );
});

test("verifyPassword 对格式异常的哈希安全返回 false", () => {
  assert.equal(verifyPassword("password-123456", ""), false);
  assert.equal(verifyPassword("password-123456", "no-colon-here"), false);
  assert.equal(verifyPassword("password-123456", ":only-hash"), false);
});

test("Store 索引查询、单次扫描搜索翻页与过期上传清理", () => {
  const root = resolve("../../Temp/cloudseed/tests");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "opt-store-"));
  const store = new Store(directory);
  try {
    const first = store.saveAccount({
      name: "账号一",
      accountId: "a".repeat(32),
      credentials: { token: "tok-1" },
    });
    assert.equal(store.hasAccountId("a".repeat(32)), true);
    assert.equal(store.hasAccountId("a".repeat(32), first.id), false);
    assert.equal(store.hasAccountId("b".repeat(32)), false);

    store.audit("上传 R2 对象", "账号一", "bucket/alpha.txt");
    store.audit("上传 R2 对象", "账号一", "bucket/beta.txt");
    const page1 = store.listAudit(1, "alpha");
    assert.equal(page1.total, 1);
    assert.equal(page1.items.length, 1);
    const page2 = store.listAudit(2, "alpha");
    assert.equal(page2.total, 1);
    assert.equal(page2.items.length, 0);

    const oldTs = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const recentTs = Date.now();
    store.db
      .prepare(
        "INSERT INTO uploads(id,account_id,bucket,jurisdiction,object_key,size,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run("old-upload", first.id, "b", "default", "old.txt", 10, oldTs);
    store.db
      .prepare(
        "INSERT INTO uploads(id,account_id,bucket,jurisdiction,object_key,size,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run("new-upload", first.id, "b", "default", "new.txt", 10, recentTs);

    store.pruneStaleUploads();
    const remaining = store.db
      .prepare("SELECT id FROM uploads")
      .all() as { id: string }[];
    assert.deepEqual(
      remaining.map((row) => row.id),
      ["new-upload"],
    );
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cachedS3Client 复用相同凭据与区域的客户端实例", () => {
  destroyS3Clients();
  const baseAccount = {
    id: "acc-1",
    name: "测试",
    accountId: "a".repeat(32),
    hasS3: true,
    s3CredentialType: "manual" as const,
    createdAt: new Date().toISOString(),
    credentials: {
      token: "tok",
      accessKeyId: "ak-1",
      secretAccessKey: "sk-1",
    },
  };
  const first = cachedS3Client(baseAccount, "default");
  const second = cachedS3Client(baseAccount, "default");
  const eu = cachedS3Client(baseAccount, "eu");
  const rotated = cachedS3Client(
    {
      ...baseAccount,
      credentials: { ...baseAccount.credentials, secretAccessKey: "sk-2" },
    },
    "default",
  );
  assert.equal(first, second);
  assert.notEqual(first, eu);
  assert.notEqual(first, rotated);
  destroyS3Clients();
});

test("formatBytes 安全处理边界与非法数值", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(-100), "0 B");
  assert.equal(formatBytes(Number.NaN), "0 B");
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), "0 B");
  assert.equal(formatBytes(1024), "1 KiB");
});
