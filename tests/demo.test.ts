import { test } from "node:test";
import assert from "node:assert/strict";
import { demoRequest } from "../src/demo.js";
import { r2ObjectUrl } from "../src/api.js";
import { describeDnsBatch, displayAuditAction } from "../shared/audit.js";
import type {
  Account,
  AuditEntry,
  Bucket,
  DnsRecord,
  ObjectPage,
  Zone,
} from "../shared/types.js";

test("R2 自定义域直链保留目录并编码文件名", () => {
  assert.equal(
    r2ObjectUrl("cdn.example.com", "资料/配置 #1?.yaml"),
    "https://cdn.example.com/%E8%B5%84%E6%96%99/%E9%85%8D%E7%BD%AE%20%231%3F.yaml",
  );
  assert.equal(
    r2ObjectUrl("cdn.example.com", "nested/a%2Fb.txt"),
    "https://cdn.example.com/nested/a%252Fb.txt",
  );
});

test("旧记录不猜测 DNS 操作，旧上传失败使用可识别的操作名称", () => {
  assert.equal(
    displayAuditAction("批量修改 DNS", "success", "example.com"),
    "DNS 操作（旧记录）",
  );
  assert.equal(
    displayAuditAction(
      "POST",
      "failed",
      "/api/accounts/id/r2/buckets/assets/uploads/job/complete",
    ),
    "上传 R2 对象",
  );
  assert.equal(displayAuditAction("POST", "failed", "/api/unknown"), "POST");
});

test("批量接口未返回记录详情时保留操作类型并回退到记录 ID", () => {
  assert.deepEqual(
    describeDnsBatch({ deletes: [{ id: "record-id" }] }, "example.com", {}),
    {
      action: "删除 DNS 记录",
      resource: "example.com / record-id",
      detail: "",
    },
  );
  assert.equal(
    describeDnsBatch(
      { posts: [{ name: "www.example.com", type: "A" }] },
      "example.com",
      { posts: [{ id: "record-id" }] },
    ).resource,
    "www.example.com (A)",
  );
});

test("演示直接进入、账号数据隔离、DNS 修改和浏览器文件操作", async () => {
  const status = await demoRequest<{ authenticated: boolean }>("/auth/status");
  assert.equal(status.authenticated, true);
  const accounts = await demoRequest<Account[]>("/accounts");
  assert.equal(accounts[0].s3CredentialType, "token");
  assert.equal(accounts[1].s3CredentialType, "manual");
  const zones = await demoRequest<Zone[]>(
    `/accounts/${accounts[0].id}/dns/zones`,
  );
  const base = `/accounts/${accounts[0].id}/dns/zones/${zones[0].id}`;
  const original = await demoRequest<DnsRecord[]>(`${base}/records`);
  await demoRequest(`${base}/records/${original[0].id}`, {
    method: "PATCH",
    body: { proxied: false },
  });
  assert.equal(original[0].proxied, true);
  assert.equal(
    (await demoRequest<DnsRecord[]>(`${base}/records`))[0].proxied,
    false,
  );
  const latestAudit = async () =>
    (await demoRequest<{ items: AuditEntry[] }>("/audit?page=1")).items[0];
  assert.equal((await latestAudit()).action, "关闭 DNS 代理");
  const filteredAudit = await demoRequest<{
    items: AuditEntry[];
    total: number;
  }>(`/audit?page=1&search=${encodeURIComponent("关闭 DNS 代理")}`);
  assert.equal(filteredAudit.total, 1);
  assert.equal(
    filteredAudit.items[0].resource,
    `${original[0].name} (${original[0].type})`,
  );
  assert.equal(
    (
      await demoRequest<{ total: number }>(
        `/audit?search=${encodeURIComponent("没有的记录")}`,
      )
    ).total,
    0,
  );
  await demoRequest(`${base}/batch`, {
    method: "POST",
    body: { deletes: [{ id: original[3].id }] },
  });
  assert.equal((await latestAudit()).action, "删除 DNS 记录");
  assert.equal(
    (await latestAudit()).resource,
    `${original[3].name} (${original[3].type})`,
  );
  const otherZones = await demoRequest<Zone[]>(
    `/accounts/${accounts[1].id}/dns/zones`,
  );
  assert.ok(
    otherZones.every((zone) => !zones.some((first) => first.id === zone.id)),
  );
  const buckets = await demoRequest<Bucket[]>(
    `/accounts/${accounts[0].id}/r2/buckets`,
  );
  const bucketBase = `/accounts/${accounts[0].id}/r2/buckets/${buckets[0].name}`;
  await demoRequest(`${bucketBase}/demo-upload`, {
    method: "POST",
    body: {
      file: new Blob(["CloudSeed demo"]),
      key: "demo.txt",
      overwrite: false,
    },
  });
  const files = await demoRequest<ObjectPage>(`${bucketBase}/objects`);
  assert.ok(
    files.objects.some((file) => file.key === "demo.txt" && file.size === 14),
  );
  const link = await demoRequest<{ url: string }>(`${bucketBase}/link`, {
    method: "POST",
    body: { key: "demo.txt" },
  });
  assert.equal(await (await fetch(link.url)).text(), "CloudSeed demo");
  URL.revokeObjectURL(link.url);
  await assert.rejects(
    demoRequest(`${bucketBase}/demo-upload`, {
      method: "POST",
      body: {
        file: new Blob(["overwrite"]),
        key: "demo.txt",
        overwrite: false,
      },
    }),
    /文件已存在/,
  );
  await demoRequest(`${bucketBase}/demo-upload`, {
    method: "POST",
    body: { file: new Blob(["new"]), key: "demo.txt", overwrite: true },
  });
  assert.equal((await latestAudit()).action, "覆盖 R2 对象");
  await demoRequest(`${bucketBase}/demo-upload`, {
    method: "POST",
    body: { file: new Blob([]), key: "folder/", overwrite: false },
  });
  assert.equal((await latestAudit()).action, "创建 R2 文件夹");
  await demoRequest(`${bucketBase}/delete-objects`, {
    method: "POST",
    body: { keys: ["demo.txt"] },
  });
  assert.ok(
    !(await demoRequest<ObjectPage>(`${bucketBase}/objects`)).objects.some(
      (file) => file.key === "demo.txt",
    ),
  );
  assert.equal((await latestAudit()).action, "删除 R2 对象");
  assert.equal((await latestAudit()).resource, `${buckets[0].name}/demo.txt`);
});
