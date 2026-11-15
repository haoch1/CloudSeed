import { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { ManagedAccount } from "../server/cloudflare.js";
import { s3Client } from "../server/r2.js";
import type { DnsRecord } from "../shared/types.js";

export const accountId = "a".repeat(32);
export const zoneId = "b".repeat(32);
export const recordId = "c".repeat(32);
export function createFixtures() {
  const uploads = new Map<
    string,
    {
      bucket: string;
      key: string;
      metadata: Record<string, string>;
      parts: Map<number, Buffer>;
    }
  >();
  const records: DnsRecord[] = [
    {
      id: recordId,
      type: "A",
      name: "example.com",
      content: "192.0.2.10",
      ttl: 1,
      proxied: true,
      comment: "主站",
    },
    {
      id: "d".repeat(32),
      type: "CNAME",
      name: "www.example.com",
      content: "example.com",
      ttl: 1,
      proxied: true,
    },
    {
      id: "e".repeat(32),
      type: "MX",
      name: "example.com",
      content: "mail.example.com",
      priority: 10,
      ttl: 3600,
      proxied: false,
    },
    {
      id: "f".repeat(32),
      type: "TXT",
      name: "example.com",
      content: "v=spf1 include:_spf.example.com ~all",
      ttl: 3600,
      proxied: false,
    },
  ];
  const objects = new Map<
    string,
    { size: number; metadata: Record<string, string>; body?: Buffer }
  >([
    [
      "assets/readme.txt",
      {
        size: Buffer.byteLength("cloudseed upload test"),
        metadata: {},
        body: Buffer.from("cloudseed upload test"),
      },
    ],
    ["assets/images/cover.webp", { size: 143360, metadata: {} }],
  ]);
  const deleteFailures = new Set<string>();
  const s3Calls: { name: string; input: Record<string, any> }[] = [];
  const calls: {
    path: string;
    method: string;
    body?: unknown;
    jurisdiction?: string;
  }[] = [];
  const upstreamFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/client/v4", "");
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      path,
      method,
      body,
      jurisdiction: (init?.headers as Record<string, string>)?.[
        "cf-r2-jurisdiction"
      ],
    });
    let result: unknown;
    if (path.endsWith("/tokens/verify"))
      result = { id: "1".repeat(32), status: "active" };
    else if (path === "/zones")
      result = [
        {
          id: zoneId,
          name: "example.com",
          status: "active",
          account: { id: accountId },
          plan: { name: "Free" },
          name_servers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
        },
      ];
    else if (path === `/zones/${zoneId}`)
      result = { id: zoneId, name: "example.com", account: { id: accountId } };
    else if (path.endsWith("/dns_records/batch")) {
      const deletions = (body.deletes ?? []) as { id: string }[];
      const patches = (body.patches ?? []) as {
        id: string;
        proxied: boolean;
      }[];
      const posts = (body.posts ?? []) as DnsRecord[];
      const deleted = deletions.map((item) => ({
        ...records.find((record) => record.id === item.id)!,
      }));
      for (const item of deletions) {
        const index = records.findIndex((record) => record.id === item.id);
        if (index >= 0) records.splice(index, 1);
      }
      const patched = patches.map((item) => {
        const record = records.find((candidate) => candidate.id === item.id)!;
        Object.assign(record, { proxied: item.proxied });
        return { ...record };
      });
      const posted = posts.map((item) => ({
        ...item,
        id: randomUUID().replaceAll("-", ""),
      }));
      records.push(...posted);
      result = { deletes: deleted, patches: patched, posts: posted };
    } else if (path.endsWith("/dns_records") && method === "GET")
      result = records;
    else if (path.endsWith("/dns_records") && method === "POST") {
      result = { id: "2".repeat(32), ...body };
      records.push(result as (typeof records)[number]);
    } else if (path.includes("/dns_records/") && method === "PATCH") {
      const record = records.find((item) => item.id === path.split("/").at(-1));
      Object.assign(record || {}, body);
      result = record;
    } else if (path.endsWith("/r2/buckets"))
      result = {
        buckets: [
          {
            name: "assets",
            creation_date: "2026-11-01T08:00:00Z",
            storage_class: "Standard",
          },
          {
            name: "backups",
            creation_date: "2026-11-02T08:00:00Z",
            storage_class: "Standard",
          },
        ],
      };
    else if (path.endsWith("/domains/custom")) result = { domains: [] };
    else if (path.endsWith("/domains/managed"))
      result = { domain: "pub-test.r2.dev", enabled: false };
    else if (path.endsWith("/cors") || path.endsWith("/lifecycle"))
      result = { rules: [] };
    else result = {};
    return new Response(
      JSON.stringify({
        success: true,
        result,
        result_info: { total_pages: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const r2Client = (
    account: ManagedAccount,
    jurisdiction: string,
  ): S3Client => {
    const client = s3Client(account, jurisdiction);
    Object.defineProperty(client, "send", {
      value: async (command: {
        constructor: { name: string };
        input: Record<string, any>;
      }) => {
        const input = command.input;
        s3Calls.push({ name: command.constructor.name, input });
        const object = objects.get(`${input.Bucket}/${input.Key}`);
        switch (command.constructor.name) {
          case "ListObjectsV2Command": {
            const prefix = String(input.Prefix || "");
            const keys = [...objects.keys()]
              .filter((key) => key.startsWith(`${input.Bucket}/${prefix}`))
              .map((key) => key.slice(String(input.Bucket).length + 1));
            const folders = new Set<string>();
            const files = keys.filter((key) => {
              const tail = key.slice(prefix.length);
              if (tail.includes("/")) {
                folders.add(`${prefix}${tail.split("/")[0]}/`);
                return false;
              }
              return true;
            });
            return {
              Contents: files.map((key) => ({
                Key: key,
                Size: objects.get(`${input.Bucket}/${key}`)!.size,
                LastModified: new Date("2026-11-10T08:00:00Z"),
                ETag: '"test-etag"',
              })),
              CommonPrefixes: [...folders].map((Prefix) => ({ Prefix })),
            };
          }
          case "HeadObjectCommand":
            if (!object)
              throw Object.assign(new Error("Missing"), {
                $metadata: { httpStatusCode: 404 },
              });
            return {
              ContentLength: object.size,
              Metadata: object.metadata,
              ETag: '"test-etag"',
              ContentType: "text/plain",
            };
          case "DeleteObjectsCommand": {
            const requested = input.Delete.Objects as { Key: string }[];
            const deleted = requested.filter(
              (item) => !deleteFailures.has(item.Key),
            );
            deleted.forEach((item) =>
              objects.delete(`${input.Bucket}/${item.Key}`),
            );
            return {
              Deleted: deleted,
              Errors: requested
                .filter((item) => deleteFailures.has(item.Key))
                .map((item) => ({ Key: item.Key, Message: "Access denied" })),
            };
          }
          case "CreateMultipartUploadCommand": {
            const id = randomUUID();
            uploads.set(id, {
              bucket: input.Bucket,
              key: input.Key,
              metadata: input.Metadata ?? {},
              parts: new Map(),
            });
            return { UploadId: id };
          }
          case "UploadPartCopyCommand": {
            const upload = uploads.get(input.UploadId)!;
            const source = objects.get(decodeURIComponent(input.CopySource))!;
            upload.parts.set(1, source.body ?? Buffer.alloc(source.size));
            return { CopyPartResult: { ETag: '"copy-etag"' } };
          }
          case "CompleteMultipartUploadCommand": {
            const upload = uploads.get(input.UploadId);
            if (upload) {
              const body = Buffer.concat(
                [...upload.parts.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map((item) => item[1]),
              );
              objects.set(`${upload.bucket}/${upload.key}`, {
                size: body.length,
                metadata: upload.metadata,
                body,
              });
              uploads.delete(input.UploadId);
            }
            return {};
          }
          case "AbortMultipartUploadCommand":
            uploads.delete(input.UploadId);
            return {};
          case "DeleteObjectCommand":
            objects.delete(`${input.Bucket}/${input.Key}`);
            return {};
          case "GetObjectCommand":
            return {
              Body: object?.body ?? Buffer.alloc(object?.size ?? 0),
              ContentLength: object?.size ?? 0,
              ContentType: "text/plain",
              Metadata: object?.metadata ?? {},
            };
          case "PutObjectCommand":
            objects.set(`${input.Bucket}/${input.Key}`, {
              size: Buffer.byteLength(input.Body || ""),
              metadata: input.Metadata || {},
            });
            return {};
          default:
            return {};
        }
      },
    });
    return client;
  };
  function acceptSignedUpload(
    url: URL,
    headers: Record<string, string>,
    body: Buffer,
  ) {
    const uploadId = url.searchParams.get("uploadId");
    if (uploadId) {
      uploads
        .get(uploadId)!
        .parts.set(Number(url.searchParams.get("partNumber")), body);
    } else {
      const hostParts = url.hostname.split(".");
      const pathParts = decodeURIComponent(url.pathname).slice(1).split("/");
      const bucket =
        hostParts[0] === accountId ? pathParts.shift()! : hostParts[0];
      const key = pathParts.join("/");
      objects.set(`${bucket}/${key}`, {
        size: body.length,
        metadata: {
          "cloudseed-upload":
            headers["x-amz-meta-cloudseed-upload"] ||
            url.searchParams.get("x-amz-meta-cloudseed-upload") ||
            "",
        },
        body,
      });
    }
  }
  return {
    upstreamFetch,
    r2Client,
    objects,
    records,
    deleteFailures,
    calls,
    s3Calls,
    acceptSignedUpload,
  };
}
