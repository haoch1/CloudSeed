import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.js";
import { bootstrapAdmin } from "../server/auth.js";
import { hashToken } from "../server/security.js";
import { Store } from "../server/store.js";

test("登录有效期迁移、设置和重启后保持有效", async () => {
  const root = resolve("../../Temp/cloudseed/tests");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "session-duration-"));
  const legacyToken = randomBytes(32).toString("hex");
  const expiredToken = randomBytes(32).toString("hex");
  writeFileSync(join(directory, "encryption.key"), randomBytes(32));
  const legacyDb = new DatabaseSync(join(directory, "cloudseed.sqlite"));
  legacyDb.exec(
    "CREATE TABLE sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL)",
  );
  const insertLegacy = legacyDb.prepare(
    "INSERT INTO sessions(token, expires) VALUES(?, ?)",
  );
  insertLegacy.run(hashToken(legacyToken), Date.now() + 12 * 60 * 60 * 1000);
  insertLegacy.run(hashToken(expiredToken), Date.now() - 1000);
  legacyDb.close();

  let store = new Store(directory);
  bootstrapAdmin(store, "admin", "test-password-123");
  let server = createApp(store).listen(0, "127.0.0.1");
  await once(server, "listening");
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    cookie = "",
  ) {
    return fetch(`${origin}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CloudSeed-Request": "1",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  function sessionExpiry(token: string) {
    return (
      store.db
        .prepare("SELECT expires FROM sessions WHERE token = ?")
        .get(hashToken(token)) as { expires: number }
    ).expires;
  }
  function assertExpiresIn(expires: number, seconds: number) {
    const remaining = expires - Date.now();
    assert.ok(
      remaining > seconds * 1000 - 5000 && remaining <= seconds * 1000 + 1000,
    );
  }
  try {
    assert.equal((await request("/auth/session-duration")).status, 401);
    const expired = await request(
      "/auth/status",
      "GET",
      undefined,
      `cloudseed-session=${expiredToken}`,
    );
    assert.equal((await expired.json()).authenticated, false);
    assert.equal(expired.headers.get("set-cookie"), null);

    const legacyCookie = `cloudseed-session=${legacyToken}`;
    const status = await request(
      "/auth/status",
      "GET",
      undefined,
      legacyCookie,
    );
    assert.equal((await status.json()).authenticated, true);
    assert.match(status.headers.get("set-cookie")!, /Max-Age=2592000/);
    assertExpiresIn(sessionExpiry(legacyToken), 30 * 24 * 60 * 60);
    assert.equal(
      (
        await request("/auth/status", "GET", undefined, legacyCookie)
      ).headers.get("set-cookie"),
      null,
    );

    const login = await request("/auth/login", "POST", {
      username: "admin",
      password: "test-password-123",
    });
    assert.equal(login.status, 200);
    const loginHeader = login.headers.get("set-cookie")!;
    assert.match(loginHeader, /Max-Age=2592000/);
    assert.match(loginHeader, /HttpOnly/);
    assert.match(loginHeader, /SameSite=Strict/);
    const loginCookie = loginHeader.split(";")[0];
    const loginToken = loginCookie.slice("cloudseed-session=".length);
    const untouchedExpiry = sessionExpiry(loginToken);
    assertExpiresIn(untouchedExpiry, 30 * 24 * 60 * 60);

    const invalid = await request(
      "/auth/session-duration",
      "PUT",
      { durationSeconds: 10 },
      legacyCookie,
    );
    assert.equal(invalid.status, 400);
    assert.equal(
      (
        await request(
          "/auth/session-duration",
          "PUT",
          { durationSeconds: 365 * 24 * 60 * 60 },
          legacyCookie,
        )
      ).status,
      400,
    );
    const defaultSettings = await request(
      "/auth/session-duration",
      "GET",
      undefined,
      legacyCookie,
    );
    assert.equal(
      (await defaultSettings.json()).durationSeconds,
      30 * 24 * 60 * 60,
    );

    const seconds = 90 * 24 * 60 * 60;
    const save = await request(
      "/auth/session-duration",
      "PUT",
      { durationSeconds: seconds },
      legacyCookie,
    );
    assert.equal(save.status, 200);
    const saved = (await save.json()) as {
      durationSeconds: number;
      expiresAt: string;
    };
    assert.equal(saved.durationSeconds, seconds);
    assertExpiresIn(Date.parse(saved.expiresAt), seconds);
    assert.match(save.headers.get("set-cookie")!, /Max-Age=7776000/);
    assertExpiresIn(sessionExpiry(legacyToken), seconds);
    assert.equal(sessionExpiry(loginToken), untouchedExpiry);
    assert.equal(store.listAudit(1).items[0].action, "更新登录有效期");

    const newLogin = await request("/auth/login", "POST", {
      username: "admin",
      password: "test-password-123",
    });
    assert.match(newLogin.headers.get("set-cookie")!, /Max-Age=7776000/);
    const newCookie = newLogin.headers.get("set-cookie")!.split(";")[0];
    const newToken = newCookie.slice("cloudseed-session=".length);
    assertExpiresIn(sessionExpiry(newToken), seconds);

    await new Promise<void>((done) => server.close(() => done()));
    store.db.close();
    store = new Store(directory);
    server = createApp(store).listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const afterRestart = await request(
      "/auth/session-duration",
      "GET",
      undefined,
      newCookie,
    );
    assert.equal((await afterRestart.json()).durationSeconds, seconds);
    assertExpiresIn(sessionExpiry(newToken), seconds);

    store.db
      .prepare("UPDATE sessions SET expires = ? WHERE token = ?")
      .run(Date.now() - 1000, hashToken(newToken));
    assert.equal(
      (await request("/auth/session-duration", "GET", undefined, newCookie))
        .status,
      401,
    );
    assert.equal(
      (
        await request(
          "/auth/session-duration",
          "PUT",
          { durationSeconds: seconds },
          newCookie,
        )
      ).status,
      401,
    );

    const password = await request(
      "/auth/password",
      "POST",
      {
        currentPassword: "test-password-123",
        newPassword: "new-test-password-123",
      },
      legacyCookie,
    );
    assert.equal(password.status, 200);
    assert.equal(
      (await request("/auth/session-duration", "GET", undefined, loginCookie))
        .status,
      401,
    );
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
