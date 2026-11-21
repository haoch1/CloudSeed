import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  accountClient,
  ApiError,
  bucketPath,
  cfId,
  jurisdictionSchema,
} from "./cloudflare.js";
import { hashToken } from "./security.js";
import type { ManagedAccount } from "./cloudflare.js";
import type { Store } from "./store.js";
import type { Bucket, ObjectPage, Zone } from "../shared/types.js";
import { r2UploadAction } from "../shared/audit.js";

const s3ClientCache = new Map<string, S3Client>();
const maxS3Clients = 32;

export function destroyS3Clients(): void {
  for (const client of s3ClientCache.values()) client.destroy();
  s3ClientCache.clear();
}

const objectKey = z
  .string()
  .min(1)
  .refine(
    (value) => Buffer.byteLength(value) <= 1024,
    "对象名称超过 1024 字节",
  );
const bucketName = z
  .string()
  .min(3)
  .max(63)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    "桶名称只能包含小写字母、数字和连字符",
  );
interface Upload {
  id: string;
  account_id: string;
  bucket: string;
  jurisdiction: string;
  object_key: string;
  size: number;
  upload_id: string | null;
  expected_etag: string | null;
  completed: number;
}

export function s3Client(
  account: ManagedAccount,
  jurisdiction: string,
): S3Client {
  if (!account.credentials.accessKeyId || !account.credentials.secretAccessKey)
    throw new ApiError(400, "请在账号设置中配置 R2 S3 凭据");
  const suffix = jurisdiction === "default" ? "" : `.${jurisdiction}`;
  return new S3Client({
    region: "auto",
    endpoint: `https://${account.accountId}${suffix}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: account.credentials.accessKeyId,
      secretAccessKey: account.credentials.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
  });
}

export function cachedS3Client(
  account: ManagedAccount,
  jurisdiction: string,
): S3Client {
  if (!account.credentials.accessKeyId || !account.credentials.secretAccessKey)
    throw new ApiError(400, "请在账号设置中配置 R2 S3 凭据");
  const cacheKey = `${account.accountId}:${jurisdiction}:${account.credentials.accessKeyId}:${hashToken(account.credentials.secretAccessKey)}`;
  const cached = s3ClientCache.get(cacheKey);
  if (cached) {
    s3ClientCache.delete(cacheKey);
    s3ClientCache.set(cacheKey, cached);
    return cached;
  }
  const client = s3Client(account, jurisdiction);
  if (s3ClientCache.size >= maxS3Clients) {
    const oldestKey = s3ClientCache.keys().next().value;
    if (oldestKey !== undefined) {
      s3ClientCache.get(oldestKey)?.destroy();
      s3ClientCache.delete(oldestKey);
    }
  }
  s3ClientCache.set(cacheKey, client);
  return client;
}

export function r2Routes(store: Store, clientFactory = cachedS3Client): Router {
  const router = Router({ mergeParams: true });
  router.use((request, response, next) => {
    const account = store.getAccount(String(request.params.account));
    if (!account) return next(new ApiError(404, "账号不存在"));
    response.locals.account = account;
    response.locals.cf = accountClient(account);
    response.locals.jurisdiction = jurisdictionSchema.parse(
      request.query.jurisdiction ?? "default",
    );
    next();
  });
  router.get("/buckets", async (_request, response) => {
    const buckets: Bucket[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ per_page: "1000" });
      if (cursor) query.set("cursor", cursor);
      const { result, info } = await accountClient(
        response.locals.account,
      ).call<{ buckets: Bucket[] }>(
        `/accounts/${response.locals.account.accountId}/r2/buckets?${query}`,
        { jurisdiction: response.locals.jurisdiction },
      );
      buckets.push(...result.buckets);
      cursor = info?.cursor;
      if (cursor && seen.has(cursor))
        throw new ApiError(502, "R2 分页游标重复，请稍后重试");
      if (cursor) seen.add(cursor);
    } while (cursor);
    response.json(buckets);
  });
  router.post("/buckets", async (request, response) => {
    const input = z
      .object({
        name: bucketName,
        locationHint: z
          .enum(["wnam", "enam", "weur", "eeur", "apac", "oc"])
          .optional(),
      })
      .parse(request.body);
    response.locals.auditAttempt = {
      action: "创建 R2 桶",
      resource: input.name,
    };
    const { result } = await accountClient(response.locals.account).call(
      `/accounts/${response.locals.account.accountId}/r2/buckets`,
      {
        method: "POST",
        body: input,
        jurisdiction: response.locals.jurisdiction,
      },
    );
    store.audit("创建 R2 桶", response.locals.account.name, input.name);
    response.status(201).json(result);
  });
  router.use("/buckets/:bucket", (request, response, next) => {
    response.locals.bucket = bucketName.parse(request.params.bucket);
    next();
  });
  router.delete("/buckets/:bucket", async (request, response) => {
    const input = z.object({ confirmation: z.string() }).parse(request.body);
    response.locals.auditAttempt = {
      action: "删除 R2 桶",
      resource: response.locals.bucket,
    };
    if (input.confirmation !== response.locals.bucket)
      throw new ApiError(400, "请输入完整桶名称确认删除");
    await accountClient(response.locals.account).call(
      bucketPath(response.locals.account, response.locals.bucket),
      { method: "DELETE", jurisdiction: response.locals.jurisdiction },
    );
    store.audit(
      "删除 R2 桶",
      response.locals.account.name,
      response.locals.bucket,
    );
    response.json({ ok: true });
  });
  router.get("/buckets/:bucket/objects", async (request, response) => {
    const query = z
      .object({
        prefix: z.string().max(1024).optional(),
        cursor: z.string().max(4096).optional(),
      })
      .parse(request.query);
    const result = await clientFactory(
      response.locals.account,
      response.locals.jurisdiction,
    ).send(
      new ListObjectsV2Command({
        Bucket: response.locals.bucket,
        Prefix: query.prefix,
        Delimiter: "/",
        ContinuationToken: query.cursor,
        MaxKeys: 100,
      }),
    );
    const page: ObjectPage = {
      objects: (result.Contents ?? []).map((item) => ({
        key: item.Key!,
        size: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString(),
        etag: item.ETag,
      })),
      folders: (result.CommonPrefixes ?? []).map((item) => item.Prefix!),
      cursor: result.NextContinuationToken,
    };
    response.json(page);
  });
  router.post("/buckets/:bucket/link", async (request, response) => {
    const input = z
      .object({
        key: objectKey,
        expires: z.number().int().min(60).max(604800).default(900),
        download: z.boolean().default(false),
      })
      .parse(request.body);
    response.locals.auditAttempt = {
      action: "生成 R2 访问链接",
      resource: `${response.locals.bucket}/${input.key}`,
    };
    const filename = input.key.split("/").at(-1) || "download";
    const command = new GetObjectCommand({
      Bucket: response.locals.bucket,
      Key: input.key,
      ResponseContentDisposition: `${input.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      ResponseContentType:
        !input.download && input.key.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : undefined,
    });
    const url = await getSignedUrl(
      clientFactory(response.locals.account, response.locals.jurisdiction),
      command,
      { expiresIn: input.expires },
    );
    response.json({ url });
  });
  router.post("/buckets/:bucket/delete-objects", async (request, response) => {
    const input = z
      .object({ keys: z.array(objectKey).min(1).max(1000) })
      .parse(request.body);
    const action =
      input.keys.length === 1 ? "删除 R2 对象" : "批量删除 R2 对象";
    const resource =
      input.keys.length === 1
        ? `${response.locals.bucket}/${input.keys[0]}`
        : response.locals.bucket;
    response.locals.auditAttempt = {
      action,
      resource,
      detail: `待删除 ${input.keys.length} 个对象`,
    };
    const result = await clientFactory(
      response.locals.account,
      response.locals.jurisdiction,
    ).send(
      new DeleteObjectsCommand({
        Bucket: response.locals.bucket,
        Delete: { Objects: input.keys.map((Key) => ({ Key })), Quiet: false },
      }),
    );
    const errors =
      result.Errors?.map((item) => ({ key: item.Key, error: item.Message })) ??
      [];
    const deletedCount = result.Deleted?.length ?? 0;
    store.audit(
      action,
      response.locals.account.name,
      resource,
      errors.length ? (deletedCount ? "partial" : "failed") : "success",
      `成功 ${deletedCount}，失败 ${errors.length}`,
    );
    response.json({
      deleted: result.Deleted?.map((item) => item.Key) ?? [],
      errors,
    });
  });
  router.post("/buckets/:bucket/copy", async (request, response) => {
    const input = z
      .object({
        key: objectKey,
        destinationKey: objectKey,
        destinationBucket: bucketName,
        move: z.boolean().default(false),
      })
      .parse(request.body);
    response.locals.auditAttempt = {
      action: input.move ? "移动 R2 对象" : "复制 R2 对象",
      resource: `${response.locals.bucket}/${input.key} → ${input.destinationBucket}/${input.destinationKey}`,
    };
    if (
      input.key === input.destinationKey &&
      input.destinationBucket === response.locals.bucket
    )
      throw new ApiError(400, "目标位置与源文件相同");
    const s3 = clientFactory(
      response.locals.account,
      response.locals.jurisdiction,
    );
    try {
      await s3.send(
        new HeadObjectCommand({
          Bucket: input.destinationBucket,
          Key: input.destinationKey,
        }),
      );
      throw new ApiError(409, "目标文件已存在，请使用其他名称");
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 404
      )
        throw error;
    }
    const source = await s3.send(
      new HeadObjectCommand({ Bucket: response.locals.bucket, Key: input.key }),
    );
    if ((source.ContentLength ?? 0) > 5 * 1024 ** 3)
      throw new ApiError(400, "单次复制支持 5 GiB 以内的文件");
    const snapshot = await s3.send(
      new GetObjectCommand({
        Bucket: response.locals.bucket,
        Key: input.key,
        IfMatch: source.ETag,
      }),
    );
    // 条件 GET 与 PUT 流式转发，目标写入时核对不存在
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: input.destinationBucket,
          Key: input.destinationKey,
          Body: snapshot.Body,
          ContentLength: snapshot.ContentLength,
          ContentType: snapshot.ContentType,
          CacheControl: snapshot.CacheControl,
          ContentDisposition: snapshot.ContentDisposition,
          ContentEncoding: snapshot.ContentEncoding,
          ContentLanguage: snapshot.ContentLanguage,
          Metadata: snapshot.Metadata,
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      const body = snapshot.Body as { destroy?: () => void } | undefined;
      body?.destroy?.();
      throw error;
    }
    if (input.move) {
      const current = await s3.send(
        new HeadObjectCommand({
          Bucket: response.locals.bucket,
          Key: input.key,
        }),
      );
      if (
        current.ETag !== source.ETag ||
        current.LastModified?.getTime() !== source.LastModified?.getTime()
      ) {
        throw new ApiError(
          409,
          "目标文件已复制，源文件在操作期间发生修改，已保留源文件",
        );
      }
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: response.locals.bucket,
            Key: input.key,
          }),
        );
      } catch {
        throw new ApiError(
          502,
          "目标文件已复制，删除源文件失败，请检查权限后处理源文件",
        );
      }
    }
    store.audit(
      input.move ? "移动 R2 对象" : "复制 R2 对象",
      response.locals.account.name,
      `${response.locals.bucket}/${input.key} → ${input.destinationBucket}/${input.destinationKey}`,
    );
    response.json({ ok: true });
  });

  router.post("/buckets/:bucket/uploads", async (request, response) => {
    const input = z
      .object({
        key: objectKey,
        size: z
          .number()
          .int()
          .min(0)
          .max(5 * 1024 ** 4),
        contentType: z.string().max(255).default("application/octet-stream"),
        overwrite: z.boolean().default(false),
      })
      .parse(request.body);
    response.locals.auditAttempt = {
      action: r2UploadAction(input.key, input.size, false),
      resource: `${response.locals.bucket}/${input.key}`,
    };
    const s3 = clientFactory(
      response.locals.account,
      response.locals.jurisdiction,
    );
    let expectedEtag: string | undefined;
    try {
      const existing = await s3.send(
        new HeadObjectCommand({
          Bucket: response.locals.bucket,
          Key: input.key,
        }),
      );
      if (!input.overwrite)
        throw new ApiError(409, "文件已存在，请选择覆盖或更改文件名");
      expectedEtag = existing.ETag;
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 404
      )
        throw error;
    }
    response.locals.auditAttempt.action = r2UploadAction(
      input.key,
      input.size,
      Boolean(expectedEtag),
    );
    const id = randomUUID();
    let uploadId: string | undefined;
    let url: string | undefined;
    const headers: Record<string, string> = {
      "Content-Type": input.contentType,
      "x-amz-meta-cloudseed-upload": id,
    };
    if (expectedEtag) headers["If-Match"] = expectedEtag;
    else headers["If-None-Match"] = "*";
    if (input.size > 32 * 1024 ** 2) {
      const result = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: response.locals.bucket,
          Key: input.key,
          ContentType: input.contentType,
          Metadata: { "cloudseed-upload": id },
        }),
      );
      uploadId = result.UploadId;
    } else {
      url = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: response.locals.bucket,
          Key: input.key,
          ContentType: input.contentType,
          Metadata: { "cloudseed-upload": id },
          IfMatch: expectedEtag,
          IfNoneMatch: expectedEtag ? undefined : "*",
        }),
        {
          expiresIn: 3600,
          unhoistableHeaders: new Set(["x-amz-meta-cloudseed-upload"]),
        },
      );
    }
    store.pruneStaleUploads();
    try {
      store.db
        .prepare(
          "INSERT INTO uploads(id,account_id,bucket,jurisdiction,object_key,size,upload_id,expected_etag,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          response.locals.account.id,
          response.locals.bucket,
          response.locals.jurisdiction,
          input.key,
          input.size,
          uploadId ?? null,
          expectedEtag ?? null,
          Date.now(),
        );
    } catch (error) {
      if (uploadId)
        await s3
          .send(
            new AbortMultipartUploadCommand({
              Bucket: response.locals.bucket,
              Key: input.key,
              UploadId: uploadId,
            }),
          )
          .catch(() => undefined);
      throw error;
    }
    const partSize = Math.max(
      16 * 1024 ** 2,
      Math.ceil(input.size / 9999 / 1024 ** 2) * 1024 ** 2,
    );
    response.json({ id, url, multipart: Boolean(uploadId), partSize, headers });
  });
  router.use("/buckets/:bucket/uploads/:upload", (request, response, next) => {
    const upload = store.db
      .prepare(
        "SELECT * FROM uploads WHERE id = ? AND account_id = ? AND bucket = ? AND jurisdiction = ?",
      )
      .get(
        String(request.params.upload),
        response.locals.account.id,
        response.locals.bucket,
        response.locals.jurisdiction,
      ) as unknown as Upload | undefined;
    if (!upload) return next(new ApiError(404, "上传任务不存在"));
    response.locals.upload = upload;
    response.locals.auditAttempt = {
      action:
        request.method === "DELETE"
          ? "取消 R2 上传"
          : r2UploadAction(
              upload.object_key,
              upload.size,
              Boolean(upload.expected_etag),
            ),
      resource: `${upload.bucket}/${upload.object_key}`,
    };
    next();
  });
  router.post(
    "/buckets/:bucket/uploads/:upload/part",
    async (request, response) => {
      const input = z
        .object({ partNumber: z.number().int().min(1).max(10000) })
        .parse(request.body);
      const upload = response.locals.upload as Upload;
      if (!upload.upload_id || upload.completed)
        throw new ApiError(400, "上传任务状态不正确");
      const url = await getSignedUrl(
        clientFactory(response.locals.account, response.locals.jurisdiction),
        new UploadPartCommand({
          Bucket: upload.bucket,
          Key: upload.object_key,
          UploadId: upload.upload_id,
          PartNumber: input.partNumber,
        }),
        { expiresIn: 3600 },
      );
      response.json({ url });
    },
  );
  router.post(
    "/buckets/:bucket/uploads/:upload/complete",
    async (request, response) => {
      const upload = response.locals.upload as Upload;
      if (upload.completed) return response.json({ ok: true });
      const input = z
        .object({
          parts: z
            .array(
              z.object({
                PartNumber: z.number().int().min(1).max(10000),
                ETag: z.string().min(1).max(256),
              }),
            )
            .max(10000)
            .optional(),
        })
        .parse(request.body);
      const s3 = clientFactory(
        response.locals.account,
        response.locals.jurisdiction,
      );
      if (upload.upload_id) {
        if (!input.parts?.length) throw new ApiError(400, "缺少分片列表");
        try {
          await s3.send(
            new CompleteMultipartUploadCommand({
              Bucket: upload.bucket,
              Key: upload.object_key,
              UploadId: upload.upload_id,
              MultipartUpload: {
                Parts: [...input.parts].sort(
                  (a, b) => a.PartNumber - b.PartNumber,
                ),
              },
              IfMatch: upload.expected_etag ?? undefined,
              IfNoneMatch: upload.expected_etag ? undefined : "*",
            }),
          );
        } catch (error) {
          // 完成请求可能已在 R2 成功，通过对象标识核对后允许安全重试
          const head = await s3
            .send(
              new HeadObjectCommand({
                Bucket: upload.bucket,
                Key: upload.object_key,
              }),
            )
            .catch(() => undefined);
          if (
            head?.Metadata?.["cloudseed-upload"] !== upload.id ||
            head.ContentLength !== upload.size
          )
            throw error;
        }
      }
      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: upload.bucket,
          Key: upload.object_key,
        }),
      );
      if (
        head.ContentLength !== upload.size ||
        head.Metadata?.["cloudseed-upload"] !== upload.id
      )
        throw new ApiError(409, "文件校验失败，请重新上传");
      store.db
        .prepare("UPDATE uploads SET completed = 1 WHERE id = ?")
        .run(upload.id);
      store.audit(
        r2UploadAction(
          upload.object_key,
          upload.size,
          Boolean(upload.expected_etag),
        ),
        response.locals.account.name,
        `${upload.bucket}/${upload.object_key}`,
        "success",
        `${upload.size} bytes`,
      );
      response.json({ ok: true });
    },
  );
  router.delete(
    "/buckets/:bucket/uploads/:upload",
    async (_request, response) => {
      const upload = response.locals.upload as Upload;
      if (upload.upload_id && !upload.completed) {
        try {
          await clientFactory(
            response.locals.account,
            response.locals.jurisdiction,
          ).send(
            new AbortMultipartUploadCommand({
              Bucket: upload.bucket,
              Key: upload.object_key,
              UploadId: upload.upload_id,
            }),
          );
        } catch (error) {
          if (
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode !== 404
          )
            throw error;
        }
      }
      store.db.prepare("DELETE FROM uploads WHERE id = ?").run(upload.id);
      response.json({ ok: true });
    },
  );

  for (const setting of [
    "cors",
    "lifecycle",
    "domains/custom",
    "domains/managed",
  ]) {
    router.get(`/buckets/:bucket/${setting}`, async (_request, response) => {
      try {
        const { result } = await accountClient(response.locals.account).call(
          `${bucketPath(response.locals.account, response.locals.bucket)}/${setting}`,
          { jurisdiction: response.locals.jurisdiction },
        );
        response.json(result ?? {});
      } catch (error) {
        if (
          setting === "cors" &&
          error instanceof ApiError &&
          error.status === 502 &&
          Array.isArray(error.details) &&
          error.details.length > 0 &&
          error.details.every((item) => item?.code === 10059)
        ) {
          response.json({ rules: [] });
          return;
        }
        throw error;
      }
    });
  }
  for (const setting of ["cors", "lifecycle"]) {
    router.put(`/buckets/:bucket/${setting}`, async (request, response) => {
      const input = z
        .object({ rules: z.array(z.record(z.string(), z.unknown())).max(100) })
        .parse(request.body);
      const action =
        setting === "cors" ? "更新 R2 CORS 规则" : "更新 R2 生命周期规则";
      response.locals.auditAttempt = {
        action,
        resource: response.locals.bucket,
      };
      await accountClient(response.locals.account).call(
        `${bucketPath(response.locals.account, response.locals.bucket)}/${setting}`,
        {
          method: "PUT",
          body: input,
          jurisdiction: response.locals.jurisdiction,
        },
      );
      store.audit(action, response.locals.account.name, response.locals.bucket);
      response.json({ ok: true });
    });
  }
  router.put("/buckets/:bucket/domains/managed", async (request, response) => {
    const input = z.object({ enabled: z.boolean() }).parse(request.body);
    const action = input.enabled ? "开启 r2.dev 访问" : "关闭 r2.dev 访问";
    response.locals.auditAttempt = { action, resource: response.locals.bucket };
    const { result } = await accountClient(response.locals.account).call(
      `${bucketPath(response.locals.account, response.locals.bucket)}/domains/managed`,
      {
        method: "PUT",
        body: input,
        jurisdiction: response.locals.jurisdiction,
      },
    );
    store.audit(action, response.locals.account.name, response.locals.bucket);
    response.json(result);
  });
  router.post("/buckets/:bucket/domains/custom", async (request, response) => {
    const input = z
      .object({
        domain: z.string().trim().min(3).max(253),
        zoneId: cfId,
        enabled: z.boolean().default(true),
        minTLS: z.enum(["1.2", "1.3"]).default("1.2"),
      })
      .parse(request.body);
    response.locals.auditAttempt = {
      action: "绑定 R2 自定义域名",
      resource: input.domain,
    };
    const { result: zone } = await accountClient(response.locals.account).call<
      Zone & { account: { id: string } }
    >(`/zones/${input.zoneId}`);
    if (
      zone.account.id !== response.locals.account.accountId ||
      !(input.domain === zone.name || input.domain.endsWith(`.${zone.name}`))
    )
      throw new ApiError(400, "请选择同账号下对应的域名");
    const { result } = await accountClient(response.locals.account).call(
      `${bucketPath(response.locals.account, response.locals.bucket)}/domains/custom`,
      {
        method: "POST",
        body: input,
        jurisdiction: response.locals.jurisdiction,
      },
    );
    store.audit(
      "绑定 R2 自定义域名",
      response.locals.account.name,
      input.domain,
    );
    response.json(result);
  });
  router.delete(
    "/buckets/:bucket/domains/custom/:domain",
    async (request, response) => {
      const domain = z.string().max(253).parse(request.params.domain);
      response.locals.auditAttempt = {
        action: "解绑 R2 自定义域名",
        resource: domain,
      };
      await accountClient(response.locals.account).call(
        `${bucketPath(response.locals.account, response.locals.bucket)}/domains/custom/${encodeURIComponent(domain)}`,
        { method: "DELETE", jurisdiction: response.locals.jurisdiction },
      );
      store.audit("解绑 R2 自定义域名", response.locals.account.name, domain);
      response.json({ ok: true });
    },
  );
  return router;
}
