import { z } from "zod";
import type { Account } from "../shared/types.js";
import type { Credentials } from "./store.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors?: { message: string; code?: number }[];
  result_info?: { total_pages?: number; page?: number; cursor?: string };
}
export type ManagedAccount = Account & { credentials: Credentials };

export class Cloudflare {
  constructor(
    private token: string,
    private transport: typeof fetch = fetch,
  ) {}

  async call<T>(
    path: string,
    options: { method?: string; body?: unknown; jurisdiction?: string } = {},
  ): Promise<{ result: T; info?: CloudflareResponse<T>["result_info"] }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    if (options.jurisdiction && options.jurisdiction !== "default")
      headers["cf-r2-jurisdiction"] = options.jurisdiction;
    const response = await this.transport(
      `https://api.cloudflare.com/client/v4${path}`,
      {
        method: options.method ?? "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = (await response.json()) as CloudflareResponse<T>;
    if (!response.ok || data.success === false) {
      const message =
        data.errors
          ?.map(
            (error) =>
              `${error.message}${error.code ? ` (${error.code})` : ""}`,
          )
          .join("；") || `Cloudflare 请求失败 (${response.status})`;
      throw new ApiError(
        response.status === 401 || response.status === 403
          ? 403
          : response.status === 429
            ? 429
            : 502,
        message,
        data.errors,
      );
    }
    return { result: data.result, info: data.result_info };
  }

  async list<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= 1000; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const response = await this.call<T[]>(
        `${path}${separator}page=${page}&per_page=50`,
      );
      result.push(...response.result);
      if (page >= (response.info?.total_pages ?? 1)) return result;
    }
    throw new ApiError(502, "分页超过处理上限，请缩小查询范围");
  }
}

export const cfId = z
  .string()
  .regex(/^[a-f0-9]{32}$/i, "请输入 32 位 Cloudflare ID");
export const jurisdictionSchema = z.enum(["default", "eu", "fedramp", "us"]);
export const dnsSchema = z
  .object({
    type: z.enum([
      "A",
      "AAAA",
      "CNAME",
      "MX",
      "TXT",
      "NS",
      "SRV",
      "CAA",
      "PTR",
      "HTTPS",
      "SVCB",
      "CERT",
      "DNSKEY",
      "DS",
      "LOC",
      "NAPTR",
      "SMIMEA",
      "SSHFP",
      "TLSA",
      "URI",
    ]),
    name: z.string().trim().min(1).max(253),
    content: z.string().max(65535).optional(),
    ttl: z
      .number()
      .int()
      .refine(
        (value) => value === 1 || (value >= 30 && value <= 86400),
        "TTL 应为自动或 30–86400 秒",
      ),
    proxied: z.boolean().optional(),
    priority: z.number().int().min(0).max(65535).optional(),
    comment: z.string().max(500).optional(),
    tags: z.array(z.string().max(500)).max(100).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((record, context) => {
    if (!record.content && !record.data)
      context.addIssue({ code: "custom", message: "填写记录内容或结构化数据" });
    if (record.proxied && !["A", "AAAA", "CNAME"].includes(record.type))
      context.addIssue({ code: "custom", message: "该记录类型不支持代理" });
  });

export function accountClient(account: ManagedAccount): Cloudflare {
  return new Cloudflare(account.credentials.token);
}
export function bucketPath(account: ManagedAccount, bucket: string): string {
  return `/accounts/${account.accountId}/r2/buckets/${encodeURIComponent(bucket)}`;
}
