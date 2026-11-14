import { test } from "node:test";
import assert from "node:assert/strict";
import { demoRequest } from "../src/demo.js";
import { r2ObjectUrl } from "../src/api.js";
import type {
  Account,
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

test("演示直接进入、账号数据隔离、DNS 修改和浏览器文件操作", async () => {
  const status = await demoRequest<{ authenticated: boolean }>("/auth/status");
  assert.equal(status.authenticated, true);
  const accounts = await demoRequest<Account[]>("/accounts");
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
  await demoRequest(`${bucketBase}/delete-objects`, {
    method: "POST",
    body: { keys: ["demo.txt"] },
  });
  assert.ok(
    !(await demoRequest<ObjectPage>(`${bucketBase}/objects`)).objects.some(
      (file) => file.key === "demo.txt",
    ),
  );
});
