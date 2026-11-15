import type {
  Account,
  AuditEntry,
  Bucket,
  BucketDomain,
  DnsRecord,
  ObjectItem,
  Zone,
} from "../shared/types";
import {
  auditMatches,
  describeDnsBatch,
  describeDnsUpdate,
  dnsRecordResource,
  r2UploadAction,
} from "../shared/audit";

interface DemoObject {
  item: ObjectItem;
  content: Blob;
}
interface DemoBucket {
  account: string;
  jurisdiction: string;
  bucket: Bucket;
  objects: Map<string, DemoObject>;
  cors: { rules: unknown[] };
  lifecycle: { rules: unknown[] };
  domains: BucketDomain[];
  managed: { domain: string; enabled: boolean };
}
interface DemoOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

const now = new Date().toISOString();
const primaryId = "demo-personal";
const projectId = "demo-project";
const primaryZone = "1".repeat(32);
const accounts: Account[] = [
  {
    id: primaryId,
    name: "个人账号",
    accountId: "a".repeat(32),
    hasS3: true,
    s3CredentialType: "token",
    createdAt: now,
  },
  {
    id: projectId,
    name: "项目账号",
    accountId: "b".repeat(32),
    hasS3: true,
    s3CredentialType: "manual",
    createdAt: now,
  },
];
const zones = new Map<string, Zone[]>([
  [
    primaryId,
    [
      {
        id: primaryZone,
        name: "cloudseed.example",
        status: "active",
        plan: { name: "Free" },
        name_servers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      },
      {
        id: "2".repeat(32),
        name: "seedlab.example",
        status: "active",
        plan: { name: "Free" },
        name_servers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      },
      {
        id: "3".repeat(32),
        name: "notes.example",
        status: "pending",
        plan: { name: "Free" },
        name_servers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      },
    ],
  ],
  [
    projectId,
    [
      {
        id: "4".repeat(32),
        name: "studio.example",
        status: "active",
        plan: { name: "Pro" },
        name_servers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      },
    ],
  ],
]);
const id = () => crypto.randomUUID().replaceAll("-", "");
const records = new Map<string, DnsRecord[]>();
for (const list of zones.values()) {
  for (const zone of list) {
    records.set(zone.id, [
      {
        id: id(),
        type: "A",
        name: zone.name,
        content: "192.0.2.10",
        ttl: 1,
        proxied: true,
        proxiable: true,
        comment: "主站",
      },
      {
        id: id(),
        type: "CNAME",
        name: `www.${zone.name}`,
        content: zone.name,
        ttl: 1,
        proxied: true,
        proxiable: true,
      },
      {
        id: id(),
        type: "A",
        name: `api.${zone.name}`,
        content: "192.0.2.20",
        ttl: 300,
        proxied: false,
        proxiable: true,
        comment: "API 服务",
      },
      {
        id: id(),
        type: "MX",
        name: zone.name,
        content: `mail.${zone.name}`,
        priority: 10,
        ttl: 3600,
        proxied: false,
        proxiable: false,
      },
      {
        id: id(),
        type: "TXT",
        name: zone.name,
        content: `v=spf1 include:_spf.${zone.name} ~all`,
        ttl: 3600,
        proxied: false,
        proxiable: false,
      },
      {
        id: id(),
        type: "TXT",
        name: `_dmarc.${zone.name}`,
        content: "v=DMARC1; p=quarantine",
        ttl: 3600,
        proxied: false,
        proxiable: false,
      },
    ]);
  }
}
const buckets: DemoBucket[] = [];
function addObject(bucket: DemoBucket, key: string, content: Blob) {
  bucket.objects.set(key, {
    item: {
      key,
      size: content.size,
      lastModified: new Date().toISOString(),
      etag: '"demo-etag"',
    },
    content,
  });
}
function addBucket(account: string, name: string, jurisdiction = "default") {
  const bucket: DemoBucket = {
    account,
    jurisdiction,
    bucket: {
      name,
      creation_date: now,
      location: "apac",
      storage_class: "Standard",
    },
    objects: new Map(),
    cors: { rules: [] },
    lifecycle: { rules: [] },
    domains: [],
    managed: { domain: `pub-${name}.r2.dev`, enabled: false },
  };
  buckets.push(bucket);
  return bucket;
}
const assets = addBucket(primaryId, "website-assets");
assets.domains.push({
  domain: "cdn.cloudseed.example",
  enabled: true,
  status: { ownership: "active", ssl: "active" },
  zoneId: primaryZone,
});
addObject(
  assets,
  "readme.md",
  new Blob(
    [
      "# CloudSeed\n\n这是 R2 对象存储的演示文件。\n\n可以尝试预览、上传、复制、移动、分享和删除文件。\n刷新页面可以重新加载示例数据",
    ],
    { type: "text/markdown" },
  ),
);
addObject(
  assets,
  "config.json",
  new Blob(
    [
      JSON.stringify(
        {
          name: "CloudSeed",
          environment: "demo",
          features: ["DNS 管理", "R2 对象存储"],
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  ),
);
addObject(
  assets,
  "docs/getting-started.md",
  new Blob(
    [
      "# 快速开始\n\n1. 添加 Cloudflare 账号\n2. 选择域名管理 DNS\n3. 打开 R2 上传文件\n",
    ],
    { type: "text/markdown" },
  ),
);
addObject(
  assets,
  "docs/changelog.txt",
  new Blob(["CloudSeed 0.1.0\nDNS 记录管理\nR2 文件管理\nKumo 中文控制台\n"], {
    type: "text/plain",
  }),
);
const backups = addBucket(primaryId, "site-backups");
addObject(
  backups,
  "2026-11/dns-records.json",
  new Blob([JSON.stringify(records.get(primaryZone), null, 2)], {
    type: "application/json",
  }),
);
const uploads = addBucket(projectId, "project-uploads");
addObject(
  uploads,
  "welcome.txt",
  new Blob(["欢迎体验 CloudSeed 演示界面"], { type: "text/plain" }),
);
addBucket(primaryId, "eu-archive", "eu");
const audit: AuditEntry[] = [
  {
    id: 3,
    action: "新增 DNS 记录",
    accountName: "个人账号",
    resource: "api.cloudseed.example (A)",
    status: "success",
    detail: "",
    createdAt: new Date(Date.now() - 180000).toISOString(),
  },
  {
    id: 2,
    action: "上传 R2 对象",
    accountName: "个人账号",
    resource: "website-assets/config.json",
    status: "success",
    detail: "",
    createdAt: new Date(Date.now() - 900000).toISOString(),
  },
  {
    id: 1,
    action: "添加账号",
    accountName: "项目账号",
    resource: "演示账号",
    status: "success",
    detail: "",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];
function log(action: string, account: string, resource: string, detail = "") {
  audit.unshift({
    id: (audit[0]?.id ?? 0) + 1,
    action,
    accountName: accounts.find((item) => item.id === account)?.name ?? "",
    resource,
    status: "success",
    detail,
    createdAt: new Date().toISOString(),
  });
}
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

async function dispatch(path: string, options: DemoOptions): Promise<unknown> {
  options.signal?.throwIfAborted();
  const url = new URL(path, "https://cloudseed.example");
  const method = options.method ?? "GET";
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const body = (options.body ?? {}) as Record<string, any>;
  if (path === "/auth/status")
    return {
      initialized: true,
      authenticated: true,
      username: "demo",
      email: "demo@cloudseed.example",
    };
  if (path === "/auth/password")
    throw new Error("演示账号使用免登录访问，可从正式控制台管理管理员密码");
  if (segments[0] === "audit") {
    const requestedPage = Number(url.searchParams.get("page"));
    const page = Number.isFinite(requestedPage)
      ? Math.max(1, Math.min(100000, Math.floor(requestedPage)))
      : 1;
    const search = (url.searchParams.get("search") ?? "").trim();
    if (search.length > 200) throw new Error("搜索内容最多 200 个字符");
    const filtered = search
      ? audit.filter((entry) => auditMatches(entry, search))
      : audit;
    return {
      items: filtered.slice((page - 1) * 50, page * 50),
      total: filtered.length,
    };
  }
  if (segments[0] !== "accounts") throw new Error("演示接口不存在");
  if (segments.length === 1) {
    if (method === "GET") return accounts;
    if (method === "POST") {
      const account: Account = {
        id: id(),
        name: body.name,
        accountId: body.accountId,
        hasS3: true,
        s3CredentialType:
          body.accessKeyId && body.secretAccessKey ? "manual" : "token",
        createdAt: new Date().toISOString(),
      };
      accounts.push(account);
      zones.set(account.id, []);
      log("添加账号", account.id, account.accountId);
      return account;
    }
  }
  const account = required(
    accounts.find((item) => item.id === segments[1]),
    "演示账号不存在",
  );
  if (segments.length === 2) {
    if (method === "PATCH") {
      account.name = body.name;
      account.accountId = body.accountId;
      if (body.accessKeyId && body.secretAccessKey)
        account.s3CredentialType = "manual";
      else if (body.token) account.s3CredentialType = "token";
      log("更新账号", account.id, account.accountId);
      return account;
    }
    if (method === "DELETE") {
      log("移除面板账号", account.id, account.accountId);
      accounts.splice(accounts.indexOf(account), 1);
      return { ok: true };
    }
  }
  if (segments[2] === "verify")
    return { dns: true, r2: true, errors: [null, null] };
  if (segments[2] === "dns") {
    const accountZones = zones.get(account.id) ?? [];
    if (segments.length === 4) return accountZones;
    const zone = required(
      accountZones.find((item) => item.id === segments[4]),
      "演示域名不存在",
    );
    const current = records.get(zone.id) ?? [];
    if (segments[5] === "batch") {
      const deletes = new Set<string>(
        (body.deletes ?? []).map((item: { id: string }) => item.id),
      );
      const patches = new Map<string, Partial<DnsRecord>>(
        (body.patches ?? []).map((item: DnsRecord) => [item.id, item]),
      );
      const deleted = current.filter((item) => deletes.has(item.id));
      const remaining = current
        .filter((item) => !deletes.has(item.id))
        .map((item) => ({ ...item, ...patches.get(item.id) }));
      const patched = remaining.filter((item) => patches.has(item.id));
      const posted = (body.posts ?? []).map((item: DnsRecord) => ({
        ...item,
        id: id(),
      }));
      records.set(zone.id, [...remaining, ...posted]);
      const result = { deletes: deleted, patches: patched, posts: posted };
      const audit = describeDnsBatch(body, zone.name, result);
      log(audit.action, account.id, audit.resource, audit.detail);
      return result;
    }
    if (segments.length === 6) {
      if (method === "GET") return current;
      if (method === "POST") {
        const record = {
          ...body,
          id: id(),
          proxiable: ["A", "AAAA", "CNAME"].includes(body.type),
        } as DnsRecord;
        current.push(record);
        records.set(zone.id, current);
        log("新增 DNS 记录", account.id, `${record.name} (${record.type})`);
        return record;
      }
    }
    const record = required(
      current.find((item) => item.id === segments[6]),
      "演示记录不存在",
    );
    if (method === "PATCH") {
      Object.assign(record, body);
      const audit = describeDnsUpdate(body, zone.name, record.id, record);
      log(audit.action, account.id, audit.resource);
      return record;
    }
    if (method === "DELETE") {
      records.set(
        zone.id,
        current.filter((item) => item.id !== record.id),
      );
      log("删除 DNS 记录", account.id, dnsRecordResource(record, zone.name));
      return { ok: true };
    }
  }
  if (segments[2] !== "r2") throw new Error("演示接口不存在");
  const jurisdiction = url.searchParams.get("jurisdiction") || "default";
  const accountBuckets = buckets.filter(
    (item) => item.account === account.id && item.jurisdiction === jurisdiction,
  );
  if (segments.length === 4) {
    if (method === "GET") return accountBuckets.map((item) => item.bucket);
    if (accountBuckets.some((item) => item.bucket.name === body.name))
      throw new Error("存储桶已存在");
    const bucket = addBucket(account.id, body.name, jurisdiction);
    log("创建 R2 桶", account.id, body.name);
    return bucket.bucket;
  }
  const bucket = required(
    accountBuckets.find((item) => item.bucket.name === segments[4]),
    "演示存储桶不存在",
  );
  if (segments.length === 5 && method === "DELETE") {
    if (body.confirmation !== bucket.bucket.name)
      throw new Error("请输入完整桶名称确认删除");
    if (bucket.objects.size) throw new Error("请先清空桶内对象");
    buckets.splice(buckets.indexOf(bucket), 1);
    log("删除 R2 桶", account.id, bucket.bucket.name);
    return { ok: true };
  }
  const action = segments.slice(5).join("/");
  if (action === "objects") {
    const prefix = url.searchParams.get("prefix") || "";
    const folders = new Set<string>();
    const files: ObjectItem[] = [];
    for (const { item } of [...bucket.objects.values()].sort((a, b) =>
      a.item.key.localeCompare(b.item.key),
    )) {
      if (!item.key.startsWith(prefix)) continue;
      const tail = item.key.slice(prefix.length);
      if (tail.includes("/")) folders.add(`${prefix}${tail.split("/")[0]}/`);
      else files.push(item);
    }
    const offset = Number(url.searchParams.get("cursor")) || 0;
    return {
      objects: files.slice(offset, offset + 100),
      folders: [...folders],
      cursor: files.length > offset + 100 ? String(offset + 100) : undefined,
    };
  }
  if (action === "demo-upload") {
    options.signal?.throwIfAborted();
    const existing = bucket.objects.has(body.key);
    if (existing && !body.overwrite)
      throw new Error("文件已存在，请选择覆盖或更改文件名");
    if (!(body.file instanceof Blob)) throw new Error("请选择文件");
    addObject(bucket, body.key, body.file);
    log(
      r2UploadAction(body.key, body.file.size, existing),
      account.id,
      `${bucket.bucket.name}/${body.key}`,
    );
    return { ok: true };
  }
  if (action === "link") {
    const object = required(bucket.objects.get(body.key), "演示文件不存在");
    return { url: URL.createObjectURL(object.content) };
  }
  if (action === "delete-objects") {
    const keys = body.keys as string[];
    keys.forEach((key) => bucket.objects.delete(key));
    log(
      keys.length === 1 ? "删除 R2 对象" : "批量删除 R2 对象",
      account.id,
      keys.length === 1
        ? `${bucket.bucket.name}/${keys[0]}`
        : bucket.bucket.name,
      `成功 ${keys.length}，失败 0`,
    );
    return { deleted: keys, errors: [] };
  }
  if (action === "copy") {
    const source = required(bucket.objects.get(body.key), "源文件不存在");
    const target = required(
      accountBuckets.find(
        (item) => item.bucket.name === body.destinationBucket,
      ),
      "目标存储桶不存在",
    );
    if (target.objects.has(body.destinationKey))
      throw new Error("目标文件已存在，请使用其他名称");
    addObject(target, body.destinationKey, source.content);
    if (body.move) bucket.objects.delete(body.key);
    log(
      body.move ? "移动 R2 对象" : "复制 R2 对象",
      account.id,
      `${bucket.bucket.name}/${body.key} → ${target.bucket.name}/${body.destinationKey}`,
    );
    return { ok: true };
  }
  if (action === "cors" || action === "lifecycle") {
    if (method === "GET") return bucket[action];
    bucket[action] = { rules: body.rules };
    log(
      action === "cors" ? "更新 R2 CORS 规则" : "更新 R2 生命周期规则",
      account.id,
      bucket.bucket.name,
    );
    return { ok: true };
  }
  if (action === "domains/managed") {
    if (method === "PUT") {
      bucket.managed.enabled = body.enabled;
      log(
        body.enabled ? "开启 r2.dev 访问" : "关闭 r2.dev 访问",
        account.id,
        bucket.bucket.name,
      );
    }
    return bucket.managed;
  }
  if (action === "domains/custom") {
    if (method === "GET") return { domains: bucket.domains };
    const zone = required(
      (zones.get(account.id) ?? []).find((item) => item.id === body.zoneId),
      "请选择同账号下的域名",
    );
    if (!(body.domain === zone.name || body.domain.endsWith(`.${zone.name}`)))
      throw new Error("访问域名与所选域名不匹配");
    const domain: BucketDomain = {
      domain: body.domain,
      zoneId: zone.id,
      enabled: true,
      status: { ownership: "active", ssl: "active" },
    };
    bucket.domains.push(domain);
    log("绑定 R2 自定义域名", account.id, body.domain);
    return domain;
  }
  if (
    segments[5] === "domains" &&
    segments[6] === "custom" &&
    method === "DELETE"
  ) {
    bucket.domains = bucket.domains.filter(
      (item) => item.domain !== segments[7],
    );
    log("解绑 R2 自定义域名", account.id, segments[7]);
    return { ok: true };
  }
  throw new Error("该演示操作暂不可用");
}

export async function demoRequest<T>(
  path: string,
  options: DemoOptions = {},
): Promise<T> {
  const result = await dispatch(path, options);
  return structuredClone(result) as T;
}
