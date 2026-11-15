export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isDemoMode(): boolean {
  return (
    typeof window !== "undefined" &&
    /^\/demo(?:\/|$)/.test(window.location.pathname)
  );
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  if (isDemoMode()) {
    const { demoRequest } = await import("./demo");
    return demoRequest<T>(path, options);
  }
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    signal: options.signal,
    headers: { "Content-Type": "application/json", "X-CloudSeed-Request": "1" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "服务响应格式异常" }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new RequestError(
      response.status,
      data.error || `请求失败 (${response.status})`,
    );
  }
  return data as T;
}

export function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(size: number): string {
  if (!size) return "0 B";
  const index = Math.min(4, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** index).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}`;
}

export function formatDate(value?: string): string {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

const zonePlanLabels = new Map([
  ["free", "Free"],
  ["free website", "Free"],
  ["pro", "Pro"],
  ["pro website", "Pro"],
  ["business", "Business"],
  ["business website", "Business"],
  ["enterprise", "Enterprise"],
  ["enterprise website", "Enterprise"],
]);

export function formatZonePlan(name?: string): string {
  const value = name?.trim();
  return value ? (zonePlanLabels.get(value.toLowerCase()) ?? value) : "—";
}

export function r2ObjectUrl(domain: string, key: string): string {
  return `https://${domain}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
