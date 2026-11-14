import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
} from "../server/security.js";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { bootstrapAdmin } from "../server/auth.js";
import { Cloudflare, dnsSchema } from "../server/cloudflare.js";
import { accountId, zoneId, recordId, createFixtures } from "./fixtures.js";

test("凭据加密、篡改检测和密码校验", () => {
  const key = randomBytes(32);
  const ciphertext = encrypt({ token: "private-token" }, key);
  assert.ok(!ciphertext.includes("private-token"));
  assert.deepEqual(decrypt(ciphertext, key), { token: "private-token" });
  assert.throws(() => decrypt(ciphertext, randomBytes(32)));
  const hash = hashPassword("test-password-long-enough");
  assert.equal(verifyPassword("test-password-long-enough", hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);
});

test("DNS 分页完整读取，错误信息保留上游错误码", async () => {
  let page = 0;
  const client = new Cloudflare(
    "test",
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [++page],
          result_info: { total_pages: 2 },
        }),
      ),
  );
  assert.deepEqual(await client.list("/zones"), [1, 2]);
  const denied = new Cloudflare(
    "test",
    async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: "Authentication error" }],
        }),
        { status: 403 },
      ),
  );
  await assert.rejects(denied.call("/zones"), /10000/);
  assert.equal(
    dnsSchema.safeParse({
      type: "TXT",
      name: "@",
      content: "text",
      ttl: 1,
      proxied: true,
    }).success,
    false,
  );
});

test("首次启动创建管理员，用户名登录并保留已有凭据", async () => {
  const root = resolve("../../Temp/cloudseed/tests");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "login-"));
  const store = new Store(directory);
  const initial = bootstrapAdmin(store);
  assert.equal(initial?.username, "admin");
  assert.ok(initial?.password);
  assert.equal(
    bootstrapAdmin(store, "replacement", "replacement-password"),
    undefined,
  );
  const server = createApp(store).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-CloudSeed-Request": "1",
        origin,
      },
      body: JSON.stringify({ username: "ADMIN", password: initial!.password }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const status = await fetch(origin + "/api/auth/status", {
      headers: { cookie },
    });
    assert.equal((await status.json()).username, "admin");
    const failed = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-CloudSeed-Request": "1",
        origin,
      },
      body: JSON.stringify({
        username: "replacement",
        password: "replacement-password",
      }),
    });
    assert.equal(failed.status, 401);
    const legacy = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-CloudSeed-Request": "1",
        origin,
      },
      body: JSON.stringify({
        email: "admin",
        password: initial!.password,
      }),
    });
    assert.equal(legacy.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("认证、账号脱敏、DNS 代理 PATCH、R2 区域与上传校验的完整 API 入口", async () => {
  const root = resolve("../../Temp/cloudseed/tests");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "core-"));
  const store = new Store(directory);
  const fixture = createFixtures();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.upstreamFetch;
  const server = createApp(store, fixture.r2Client).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    return originalFetch(`${origin}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CloudSeed-Request": "1",
        Cookie: cookie,
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  try {
    assert.equal((await request("/accounts")).status, 401);
    assert.equal(
      (
        await request("/auth/setup", "POST", {
          email: "test@example.com",
          password: "test-password-123",
          setupToken: "bad",
        })
      ).status,
      403,
    );
    const setup = await request("/auth/setup", "POST", {
      email: "test@example.com",
      password: "test-password-123",
      setupToken: store.setupToken,
    });
    assert.equal(setup.status, 200);
    cookie = setup.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await request("/auth/login", "POST", {
          username: "test@example.com",
          password: "test-password-123",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/auth/login", "POST", {
          email: "test@example.com",
          password: "test-password-123",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/auth/setup", "POST", {
          email: "test@example.com",
          password: "test-password-123",
          setupToken: store.setupToken,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/accounts",
          "POST",
          {},
          { Origin: "https://other.example" },
        )
      ).status,
      403,
    );
    const add = await request("/accounts", "POST", {
      name: "测试账号",
      accountId,
      token: "secret-cloudflare-token",
    });
    assert.equal(add.status, 201);
    const account = (await add.json()) as { id: string; hasS3: boolean };
    assert.equal(account.hasS3, true);
    assert.ok(!JSON.stringify(account).includes("credentials"));
    assert.ok(
      !JSON.stringify(await (await request("/accounts")).json()).includes(
        "secret-cloudflare-token",
      ),
    );
    assert.ok(
      !readFileSync(join(directory, "cloudseed.sqlite")).includes(
        Buffer.from("secret-cloudflare-token"),
      ),
    );
    assert.equal(
      (
        await request(
          `/accounts/${account.id}/dns/zones/${zoneId}/records/${recordId}`,
          "PATCH",
          { proxied: false },
        )
      ).status,
      200,
    );
    assert.equal(fixture.records[0].proxied, false);
    assert.equal(
      (
        await request(
          `/accounts/${account.id}/dns/zones/${zoneId}/batch`,
          "POST",
          {
            posts: Array.from({ length: 201 }, () => ({
              type: "A",
              name: "x.example.com",
              content: "192.0.2.1",
              ttl: 1,
            })),
          },
        )
      ).status,
      400,
    );
    const buckets = await request(
      `/accounts/${account.id}/r2/buckets?jurisdiction=eu`,
    );
    assert.equal(buckets.status, 200);
    assert.equal(fixture.calls.at(-1)?.jurisdiction, "eu");
    const base = `/accounts/${account.id}/r2/buckets/assets`;
    assert.equal(
      (await request(`${base}/objects?jurisdiction=eu`)).status,
      200,
    );
    const upload = await request(`${base}/uploads?jurisdiction=eu`, "POST", {
      key: "new.txt",
      size: 3,
      contentType: "text/plain",
    });
    assert.equal(upload.status, 200);
    const session = (await upload.json()) as {
      id: string;
      url: string;
      headers: Record<string, string>;
    };
    assert.ok(session.url.includes(".eu.r2.cloudflarestorage.com"));
    assert.equal(session.headers["If-None-Match"], "*");
    fixture.objects.set("assets/new.txt", {
      size: 3,
      metadata: { "cloudseed-upload": session.id },
    });
    assert.equal(
      (
        await request(
          `${base}/uploads/${session.id}/complete?jurisdiction=eu`,
          "POST",
          {},
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `${base}/uploads/${session.id}/complete?jurisdiction=eu`,
          "POST",
          {},
        )
      ).status,
      200,
    );
    assert.equal(
      (await request(base, "DELETE", { confirmation: "wrong" })).status,
      400,
    );
    const share = (await (
      await request(`${base}/link`, "POST", {
        key: "中文 #?.txt",
        expires: 900,
      })
    ).json()) as { url: string };
    assert.ok(share.url.includes("X-Amz-Signature="));
    assert.ok(!share.url.includes("secret-cloudflare-token"));
    const copied = await request(`${base}/copy`, "POST", {
      key: "readme.txt",
      destinationBucket: "backups",
      destinationKey: "copy.txt",
      move: false,
    });
    assert.equal(copied.status, 200);
    assert.equal(
      fixture.objects.get("backups/copy.txt")?.size,
      Buffer.byteLength("cloudseed upload test"),
    );
    assert.equal(
      (
        await request(`${base}/copy`, "POST", {
          key: "readme.txt",
          destinationBucket: "backups",
          destinationKey: "copy.txt",
          move: false,
        })
      ).status,
      409,
    );
    assert.equal((await request("/auth/logout", "POST")).status, 200);
    assert.equal((await request("/accounts")).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
