import type { AuditEntry } from "./types.js";

type RecordSummary = { id?: string; name?: string; type?: string };

export type DnsBatchChanges = {
  deletes?: { id: string }[];
  patches?: { id: string; proxied: boolean }[];
  posts?: { name: string; type: string }[];
};

export type DnsBatchResult = {
  deletes?: RecordSummary[];
  patches?: RecordSummary[];
  posts?: RecordSummary[];
};

export type AuditDescription = {
  action: string;
  resource: string;
  detail: string;
};

export function dnsRecordResource(
  record: RecordSummary | undefined,
  fallback: string,
): string {
  if (typeof record?.name !== "string" || !record.name) return fallback;
  return typeof record.type === "string" && record.type
    ? `${record.name} (${record.type})`
    : record.name;
}

export function describeDnsUpdate(
  input: Record<string, unknown>,
  zoneName: string,
  id: string,
  record?: RecordSummary,
): AuditDescription {
  const proxyOnly =
    Object.keys(input).length === 1 && typeof input.proxied === "boolean";
  return {
    action: proxyOnly
      ? input.proxied
        ? "开启 DNS 代理"
        : "关闭 DNS 代理"
      : "修改 DNS 记录",
    resource: dnsRecordResource(record, `${zoneName} / ${id}`),
    detail: "",
  };
}

export function describeDnsBatch(
  input: DnsBatchChanges,
  zoneName: string,
  result?: DnsBatchResult,
): AuditDescription {
  const deletes = input.deletes ?? [];
  const patches = input.patches ?? [];
  const posts = input.posts ?? [];
  const enabled = patches.filter((item) => item.proxied).length;
  const disabled = patches.length - enabled;
  const count = deletes.length + patches.length + posts.length;

  if (count === 1) {
    if (deletes.length) {
      const record = Array.isArray(result?.deletes)
        ? result.deletes.find((item) => item?.id === deletes[0].id)
        : undefined;
      return {
        action: "删除 DNS 记录",
        resource: dnsRecordResource(record, `${zoneName} / ${deletes[0].id}`),
        detail: "",
      };
    }
    if (patches.length) {
      const record = Array.isArray(result?.patches)
        ? result.patches.find((item) => item?.id === patches[0].id)
        : undefined;
      return describeDnsUpdate(
        { proxied: patches[0].proxied },
        zoneName,
        patches[0].id,
        record,
      );
    }
    return {
      action: "新增 DNS 记录",
      resource: dnsRecordResource(
        Array.isArray(result?.posts) ? result.posts[0] : undefined,
        dnsRecordResource(posts[0], zoneName),
      ),
      detail: "",
    };
  }

  const detail = [
    deletes.length && `删除 ${deletes.length} 条`,
    enabled && `开启代理 ${enabled} 条`,
    disabled && `关闭代理 ${disabled} 条`,
    posts.length && `新增 ${posts.length} 条`,
  ]
    .filter(Boolean)
    .join("，");
  let action = "批量变更 DNS 记录";
  if (deletes.length && !patches.length && !posts.length)
    action = "批量删除 DNS 记录";
  else if (posts.length && !deletes.length && !patches.length)
    action = "批量新增 DNS 记录";
  else if (patches.length && !deletes.length && !posts.length)
    action =
      enabled === patches.length
        ? "批量开启 DNS 代理"
        : disabled === patches.length
          ? "批量关闭 DNS 代理"
          : "批量调整 DNS 代理";
  return { action, resource: zoneName, detail };
}

const auditRequestRules: [string, RegExp, string][] = [
  [
    "POST",
    /^\/api\/accounts\/[^/]+\/dns\/zones\/[^/]+\/batch$/,
    "DNS 批量操作",
  ],
  [
    "POST",
    /^\/api\/accounts\/[^/]+\/dns\/zones\/[^/]+\/records$/,
    "新增 DNS 记录",
  ],
  [
    "PATCH",
    /^\/api\/accounts\/[^/]+\/dns\/zones\/[^/]+\/records\/[^/]+$/,
    "修改 DNS 记录",
  ],
  [
    "DELETE",
    /^\/api\/accounts\/[^/]+\/dns\/zones\/[^/]+\/records\/[^/]+$/,
    "删除 DNS 记录",
  ],
  ["POST", /^\/api\/accounts\/[^/]+\/r2\/buckets$/, "创建 R2 桶"],
  ["DELETE", /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+$/, "删除 R2 桶"],
  [
    "POST",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/link$/,
    "生成 R2 访问链接",
  ],
  [
    "POST",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/delete-objects$/,
    "删除 R2 对象",
  ],
  [
    "POST",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/copy$/,
    "复制或移动 R2 对象",
  ],
  [
    "POST",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/uploads(?:\/[^/]+\/(?:part|complete))?$/,
    "上传 R2 对象",
  ],
  [
    "DELETE",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/uploads\/[^/]+$/,
    "取消 R2 上传",
  ],
  [
    "PUT",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/cors$/,
    "更新 R2 CORS 规则",
  ],
  [
    "PUT",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/lifecycle$/,
    "更新 R2 生命周期规则",
  ],
  [
    "PUT",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/domains\/managed$/,
    "更新 r2.dev 访问",
  ],
  [
    "POST",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/domains\/custom$/,
    "绑定 R2 自定义域名",
  ],
  [
    "DELETE",
    /^\/api\/accounts\/[^/]+\/r2\/buckets\/[^/]+\/domains\/custom\/[^/]+$/,
    "解绑 R2 自定义域名",
  ],
  ["POST", /^\/api\/accounts$/, "添加账号"],
  ["PATCH", /^\/api\/accounts\/[^/]+$/, "更新账号"],
  ["DELETE", /^\/api\/accounts\/[^/]+$/, "移除面板账号"],
  ["POST", /^\/api\/accounts\/[^/]+\/verify$/, "验证账号连接"],
  ["POST", /^\/api\/auth\/password$/, "修改管理员密码"],
  ["POST", /^\/api\/auth\/setup$/, "初始化管理员"],
  ["POST", /^\/api\/auth\/login$/, "登录"],
  ["POST", /^\/api\/auth\/logout$/, "退出登录"],
];

export function auditActionForRequest(
  method: string,
  path: string,
): string | undefined {
  return auditRequestRules.find(
    ([verb, pattern]) => verb === method && pattern.test(path),
  )?.[2];
}

export function displayAuditAction(
  action: string,
  status: string,
  resource: string,
): string {
  if (action === "批量修改 DNS") return "DNS 操作（旧记录）";
  return status === "failed"
    ? (auditActionForRequest(action, resource) ?? action)
    : action;
}

export function auditMatches(
  entry: Pick<
    AuditEntry,
    "action" | "accountName" | "resource" | "status" | "detail"
  >,
  search: string,
): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  const statusLabel =
    (
      { success: "成功", failed: "失败", partial: "部分完成" } as Record<
        string,
        string
      >
    )[entry.status] ?? entry.status;
  return [
    displayAuditAction(entry.action, entry.status, entry.resource),
    entry.action,
    entry.accountName,
    entry.resource,
    entry.detail,
    entry.status,
    statusLabel,
    entry.action === "批量修改 DNS" ? "旧记录未保存具体操作类型" : "",
  ].some((value) => value.toLowerCase().includes(term));
}

export function r2UploadAction(
  key: string,
  size: number,
  overwrite: boolean,
): string {
  if (size === 0 && key.endsWith("/")) return "创建 R2 文件夹";
  return overwrite ? "覆盖 R2 对象" : "上传 R2 对象";
}
