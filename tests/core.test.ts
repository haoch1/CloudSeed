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
  hashToken,
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

test("操作记录搜索覆盖所有分页并匹配显示名称", () => {
  const root = resolve("../../Temp/cloudseed/tests");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "audit-search-"));
  const store = new Store(directory);
  try {
    store.db.exec("BEGIN");
    for (let index = 0; index < 60; index++)
      store.audit("上传 R2 对象", "个人账号", `assets/Case-file-${index}.txt`);
    store.audit(
      "POST",
      "个人账号",
      "/api/accounts/id/r2/buckets/assets/uploads/job/complete",
      "failed",
      "无法连接 R2",
    );
    store.audit(
      "批量修改 DNS",
      "项目账号",
      "example.com",
      "success",
      "1 条记录",
    );
    store.audit("删除 R2 对象", "项目账号", "assets/100%_file.txt");
    store.db.exec("COMMIT");

    assert.equal(store.listAudit(1, "case-FILE").total, 60);
    assert.equal(store.listAudit(1, "case-FILE").items.length, 50);
    assert.equal(store.listAudit(2, "case-FILE").items.length, 10);
    assert.equal(store.listAudit(1, "上传 R2 对象").total, 61);
    assert.equal(store.listAudit(1, "DNS 操作（旧记录）").total, 1);
    assert.equal(store.listAudit(1, "失败").total, 1);
    assert.equal(store.listAudit(1, "无法连接").total, 1);
    assert.equal(store.listAudit(1, "项目账号").total, 2);
    assert.equal(store.listAudit(1, "100%_").total, 1);
    assert.equal(store.listAudit(1, "' OR 1=1 --").total, 0);
    assert.equal(store.listAudit(1, "不存在的记录").total, 0);
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
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

test("S3 状态区分 Token 推导、独立凭据和未配置", () => {
  const root = resolve("../../Temp/cloudseed/tests");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "s3-status-"));
  const store = new Store(directory);
  try {
    const token = "test-api-token";
    const tokenAccount = store.saveAccount({
      name: "自动推导",
      accountId: "a".repeat(32),
      credentials: {
        token,
        accessKeyId: "token-id",
        secretAccessKey: hashToken(token),
      },
    });
    const manualAccount = store.saveAccount({
      name: "独立凭据",
      accountId: "b".repeat(32),
      credentials: {
        token,
        accessKeyId: "other-id",
        secretAccessKey: "other-secret",
      },
    });
    const noS3Account = store.saveAccount({
      name: "未配置",
      accountId: "c".repeat(32),
      credentials: { token },
    });
    assert.equal(tokenAccount.s3CredentialType, "token");
    assert.equal(manualAccount.s3CredentialType, "manual");
    assert.equal(noS3Account.s3CredentialType, "none");
    assert.equal(noS3Account.hasS3, false);
    assert.equal(
      store.getAccount(tokenAccount.id)?.credentials.secretAccessKey,
      hashToken(token),
    );
    assert.ok(!JSON.stringify(store.listAccounts()).includes(token));
    assert.ok(!JSON.stringify(store.listAccounts()).includes("other-secret"));
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
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
    const account = (await add.json()) as {
      id: string;
      hasS3: boolean;
      s3CredentialType: string;
    };
    assert.equal(account.hasS3, true);
    assert.equal(account.s3CredentialType, "token");
    assert.equal(
      (
        await request("/accounts", "POST", {
          name: "测试账号",
          accountId,
          token: "secret-cloudflare-token",
        })
      ).status,
      409,
    );
    const accountFailure = store.listAudit(1).items[0];
    assert.equal(accountFailure.action, "添加账号");
    assert.equal(accountFailure.accountName, "测试账号");
    assert.equal(accountFailure.resource, accountId);
    assert.equal(accountFailure.status, "failed");
    assert.ok(
      !JSON.stringify(accountFailure).includes("secret-cloudflare-token"),
    );
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
    assert.equal(store.listAudit(1).items[0].action, "关闭 DNS 代理");
    assert.equal(store.listAudit(1).items[0].resource, "example.com (A)");

    const dnsBase = `/accounts/${account.id}/dns/zones/${zoneId}`;
    assert.equal(
      (
        await request(`${dnsBase}/batch`, "POST", {
          patches: [
            { id: recordId, proxied: true },
            { id: "d".repeat(32), proxied: false },
          ],
        })
      ).status,
      200,
    );
    assert.equal(store.listAudit(1).items[0].action, "批量调整 DNS 代理");
    assert.equal(
      store.listAudit(1).items[0].detail,
      "开启代理 1 条，关闭代理 1 条",
    );

    assert.equal(
      (
        await request(`${dnsBase}/batch`, "POST", {
          deletes: [{ id: "f".repeat(32) }],
        })
      ).status,
      200,
    );
    assert.equal(store.listAudit(1).items[0].action, "删除 DNS 记录");
    assert.equal(store.listAudit(1).items[0].resource, "example.com (TXT)");

    assert.equal(
      (
        await request(`${dnsBase}/batch`, "POST", {
          deletes: [{ id: "d".repeat(32) }, { id: "e".repeat(32) }],
        })
      ).status,
      200,
    );
    assert.equal(store.listAudit(1).items[0].action, "批量删除 DNS 记录");
    assert.equal(store.listAudit(1).items[0].detail, "删除 2 条");

    const dnsImport = await request(`${dnsBase}/batch`, "POST", {
      posts: ["one", "two"].map((name) => ({
        type: "A",
        name: `${name}.example.com`,
        content: "192.0.2.1",
        ttl: 1,
      })),
    });
    assert.equal(dnsImport.status, 200);
    assert.equal(store.listAudit(1).items[0].action, "批量新增 DNS 记录");
    assert.equal(store.listAudit(1).items[0].detail, "新增 2 条");
    const imported = (await dnsImport.json()) as { posts: { id: string }[] };
    assert.equal(
      (
        await request(`${dnsBase}/batch`, "POST", {
          deletes: [{ id: imported.posts[0].id }],
          patches: [{ id: imported.posts[1].id, proxied: false }],
          posts: [
            {
              type: "A",
              name: "three.example.com",
              content: "192.0.2.3",
              ttl: 1,
            },
          ],
        })
      ).status,
      200,
    );
    assert.equal(store.listAudit(1).items[0].action, "批量变更 DNS 记录");
    assert.equal(
      store.listAudit(1).items[0].detail,
      "删除 1 条，关闭代理 1 条，新增 1 条",
    );

    globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).pathname.endsWith("/dns_records/batch"))
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: "denied" }],
          }),
          { status: 403 },
        );
      return fixture.upstreamFetch(input, init);
    };
    assert.equal(
      (
        await request(`${dnsBase}/batch`, "POST", {
          deletes: [{ id: recordId }],
        })
      ).status,
      403,
    );
    const dnsFailure = store.listAudit(1).items[0];
    assert.equal(dnsFailure.action, "删除 DNS 记录");
    assert.equal(dnsFailure.accountName, "测试账号");
    assert.equal(dnsFailure.resource, `example.com / ${recordId}`);
    assert.equal(dnsFailure.status, "failed");
    globalThis.fetch = fixture.upstreamFetch;
    const searchResponse = await request(
      `/audit?search=${encodeURIComponent("删除 DNS 记录")}`,
    );
    assert.equal(searchResponse.status, 200);
    const searchResult = (await searchResponse.json()) as {
      items: { action: string; status: string }[];
      total: number;
    };
    assert.ok(searchResult.total >= 2);
    assert.ok(
      searchResult.items.some(
        (item) => item.action === "删除 DNS 记录" && item.status === "failed",
      ),
    );
    assert.equal(
      (await request(`/audit?search=${"x".repeat(201)}`)).status,
      400,
    );
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
    let corsFailure = {
      status: 404,
      errors: [
        { code: 10059, message: "The CORS configuration does not exist." },
      ],
    };
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/cors") && (!init?.method || init.method === "GET"))
        return new Response(
          JSON.stringify({ success: false, errors: corsFailure.errors }),
          {
            status: corsFailure.status,
            headers: { "Content-Type": "application/json" },
          },
        );
      return fixture.upstreamFetch(input, init);
    };
    const missingCors = await request(`${base}/cors?jurisdiction=eu`);
    assert.equal(missingCors.status, 200);
    assert.deepEqual(await missingCors.json(), { rules: [] });
    corsFailure = {
      status: 403,
      errors: [{ code: 10000, message: "Authentication error" }],
    };
    const deniedCors = await request(`${base}/cors`);
    assert.equal(deniedCors.status, 403);
    assert.match((await deniedCors.json()).error, /10000/);
    corsFailure = {
      status: 500,
      errors: [
        { code: 10059, message: "The CORS configuration does not exist." },
        { code: 10000, message: "Another Cloudflare error" },
      ],
    };
    assert.equal((await request(`${base}/cors`)).status, 502);
    globalThis.fetch = fixture.upstreamFetch;
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
    assert.equal(
      (
        await request(
          `${base}/uploads/${session.id}/complete?jurisdiction=eu`,
          "POST",
          {},
        )
      ).status,
      404,
    );
    const uploadFailure = store.listAudit(1).items[0];
    assert.equal(uploadFailure.action, "上传 R2 对象");
    assert.equal(uploadFailure.accountName, "测试账号");
    assert.equal(uploadFailure.resource, "assets/new.txt");
    assert.equal(uploadFailure.status, "failed");
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
    const overwrite = await request(`${base}/uploads?jurisdiction=eu`, "POST", {
      key: "new.txt",
      size: 3,
      contentType: "text/plain",
      overwrite: true,
    });
    const overwriteSession = (await overwrite.json()) as { id: string };
    fixture.objects.set("assets/new.txt", {
      size: 3,
      metadata: { "cloudseed-upload": overwriteSession.id },
    });
    assert.equal(
      (
        await request(
          `${base}/uploads/${overwriteSession.id}/complete?jurisdiction=eu`,
          "POST",
          {},
        )
      ).status,
      200,
    );
    assert.equal(store.listAudit(1).items[0].action, "覆盖 R2 对象");
    const folder = await request(`${base}/uploads?jurisdiction=eu`, "POST", {
      key: "folder/",
      size: 0,
      contentType: "application/octet-stream",
    });
    const folderSession = (await folder.json()) as { id: string };
    fixture.objects.set("assets/folder/", {
      size: 0,
      metadata: { "cloudseed-upload": folderSession.id },
    });
    assert.equal(
      (
        await request(
          `${base}/uploads/${folderSession.id}/complete?jurisdiction=eu`,
          "POST",
          {},
        )
      ).status,
      200,
    );
    assert.equal(store.listAudit(1).items[0].action, "创建 R2 文件夹");
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
    assert.equal(
      (
        await request(`${base}/delete-objects`, "POST", {
          keys: ["images/cover.webp"],
        })
      ).status,
      200,
    );
    assert.equal(store.listAudit(1).items[0].action, "删除 R2 对象");
    assert.equal(
      store.listAudit(1).items[0].resource,
      "assets/images/cover.webp",
    );
    fixture.deleteFailures.add("blocked.txt");
    assert.equal(
      (
        await request(`${base}/delete-objects`, "POST", {
          keys: ["blocked.txt"],
        })
      ).status,
      200,
    );
    assert.equal(store.listAudit(1).items[0].status, "failed");
    assert.equal(
      (
        await request(`${base}/delete-objects`, "POST", {
          keys: ["readme.txt", "blocked.txt"],
        })
      ).status,
      200,
    );
    assert.equal(store.listAudit(1).items[0].action, "批量删除 R2 对象");
    assert.equal(store.listAudit(1).items[0].status, "partial");
    assert.equal(store.listAudit(1).items[0].detail, "成功 1，失败 1");
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
