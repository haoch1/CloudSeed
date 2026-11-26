import type { ReactNode } from "react";

const tableColumns = {
  summary: [1],
  zones: [5, 1, 1],
  records: [0.35, 3, 0.8, 4, 1.5, 1, 1, 0.7],
  buckets: [5, 1.3, 1.8],
  objects: [0.35, 5, 1, 1.8, 0.5],
  audit: [1.8, 1.5, 1.2, 4, 0.75],
  accounts: [2, 2.4, 1, 1.7, 2],
  domains: [2.5, 1, 0.8, 1],
  links: [1, 4, 0.5],
};

type TableKind = keyof typeof tableColumns;
type PreviewKind = "text" | "media" | "audio" | "pdf" | "compact";

export function SkeletonLine({
  width,
  height,
}: {
  width: string;
  height?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className="skeleton-line"
      style={{ width, height }}
    />
  );
}

export function SkeletonRegion({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`skeleton-region ${className}`} role="status" aria-busy="true">
      <span className="skeleton-announcement">{label}</span>
      {children}
    </div>
  );
}

function TableShape({
  kind,
  rows,
  header,
  footer,
}: {
  kind: TableKind;
  rows: number;
  header: boolean;
  footer: boolean;
}) {
  const columns = tableColumns[kind];
  const layout = {
    gridTemplateColumns: columns.map((width) => `minmax(0, ${width}fr)`).join(" "),
  };
  return (
    <>
      {header && (
        <div className="skeleton-table-row skeleton-table-head" style={layout}>
          {columns.map((_, index) => (
            <SkeletonLine key={index} width="min(80%, 5rem)" />
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, row) => (
        <div className="skeleton-table-row" style={layout} key={row}>
          {columns.map((_, column) => (
            <SkeletonLine
              key={column}
              width={`min(${[80, 62, 72][(row + column) % 3]}%, ${kind === "links" && column === 1 ? 32 : 15}rem)`}
            />
          ))}
        </div>
      ))}
      {footer && (
        <div className="skeleton-table-footer">
          <SkeletonLine width="6rem" />
        </div>
      )}
    </>
  );
}

export function TableSkeleton({
  kind,
  label,
  rows = 5,
  header = true,
  footer = false,
}: {
  kind: TableKind;
  label: string;
  rows?: number;
  header?: boolean;
  footer?: boolean;
}) {
  return (
    <SkeletonRegion label={label}>
      <TableShape kind={kind} rows={rows} header={header} footer={footer} />
    </SkeletonRegion>
  );
}

export function ToolbarShape({ tabs = false }: { tabs?: boolean }) {
  return (
    <div className="skeleton-toolbar">
      <SkeletonLine width={tabs ? "min(13rem, 70%)" : "100%"} height="2.25rem" />
      {!tabs && <SkeletonLine width="2.25rem" height="2.25rem" />}
    </div>
  );
}

export function SessionShape() {
  return (
    <div className="skeleton-stack">
      <SkeletonLine width="6rem" height="1.15rem" />
      <SkeletonLine width="5rem" height="2.25rem" />
      <SkeletonLine width="min(100%, 14rem)" />
      <SkeletonLine width="5rem" height="2.25rem" />
    </div>
  );
}

export function BucketSettingsShape() {
  return (
    <div className="settings-stack">
      <section className="panel settings-section">
        <SkeletonLine width="7rem" height="1.15rem" />
        <SkeletonLine width="min(100%, 18rem)" height="2rem" />
      </section>
      <section className="panel settings-section">
        <SkeletonLine width="9rem" height="1.15rem" />
        <div className="skeleton-editor">
          <SkeletonLine width="36%" />
          <SkeletonLine width="62%" />
          <SkeletonLine width="48%" />
        </div>
      </section>
    </div>
  );
}

export function PreviewSkeleton({
  kind,
  toolbar = false,
}: {
  kind: PreviewKind;
  toolbar?: boolean;
}) {
  return (
    <SkeletonRegion label="正在加载文件预览" className={toolbar ? "preview-frame" : ""}>
      {toolbar && (
        <div className="preview-toolbar">
          <SkeletonLine width="6rem" />
          <SkeletonLine width="7rem" />
        </div>
      )}
      {kind === "text" ? (
        <div className="skeleton-editor skeleton-preview-text">
          {[32, 70, 56, 77, 40, 65].map((width) => (
            <SkeletonLine key={width} width={`${width}%`} />
          ))}
        </div>
      ) : (
        <div className={`skeleton-preview-block is-${kind}`} aria-hidden="true" />
      )}
    </SkeletonRegion>
  );
}

export function AuthSkeleton({ brand }: { brand: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-brand">{brand}</div>
      <SkeletonRegion label="正在检查登录状态" className="auth-card skeleton-stack">
        <SkeletonLine width="8rem" height="1.25rem" />
        <SkeletonLine width="72%" />
        <SkeletonLine width="4rem" />
        <SkeletonLine width="100%" height="2.25rem" />
        <SkeletonLine width="4rem" />
        <SkeletonLine width="100%" height="2.25rem" />
        <SkeletonLine width="100%" height="2.25rem" />
      </SkeletonRegion>
    </div>
  );
}

export function PageSkeleton({ path, search }: { path: string; search: string }) {
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  const bucket = path === "/r2" && params.has("bucket");
  const settings = path === "/settings" || path === "/accounts";
  const kind = pageTableKind(path, params.has("zone"), bucket, settings);

  return (
    <SkeletonRegion label="正在加载页面" className="skeleton-page">
      <SkeletonLine width="min(12rem, 80%)" height="1.5rem" />
      {!kind ? (
        <div className="overview-resources">
          {["zones", "buckets"].map((key) => (
            <section className="panel" key={key}>
              <div className="skeleton-table-footer">
                <SkeletonLine width="6rem" />
              </div>
              <TableShape kind="summary" rows={3} header={false} footer={false} />
            </section>
          ))}
        </div>
      ) : (
        <>
          <ToolbarShape tabs={settings || bucket} />
          {bucket && tab === "settings" ? (
            <BucketSettingsShape />
          ) : settings && tab === "session" ? (
            <section className="panel settings-section">
              <SessionShape />
            </section>
          ) : settings && tab === "security" ? (
            <section className="panel settings-section skeleton-stack">
              {["current", "new", "confirm"].map((key) => (
                <div className="field" key={key}>
                  <SkeletonLine width="5rem" />
                  <SkeletonLine width="min(100%, 26rem)" height="2.25rem" />
                </div>
              ))}
            </section>
          ) : (
            <section className="panel">
              <TableShape kind={kind} rows={5} header footer={!settings} />
            </section>
          )}
        </>
      )}
    </SkeletonRegion>
  );
}

function pageTableKind(
  path: string,
  zone: boolean,
  bucket: boolean,
  settings: boolean,
): TableKind | undefined {
  if (path === "/dns") return zone ? "records" : "zones";
  if (path === "/r2") return bucket ? "objects" : "buckets";
  if (path === "/audit") return "audit";
  if (settings) return "accounts";
}
