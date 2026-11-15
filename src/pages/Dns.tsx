import { Select } from "@cloudflare/kumo/components/select";
import { Popover } from "@cloudflare/kumo/components/popover";
import { Fragment, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  PlusIcon,
  DownloadIcon,
  UploadIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ArrowLeftIcon,
  FunnelIcon,
  BookOpenIcon,
} from "@phosphor-icons/react";
import { api, downloadJson, formatZonePlan } from "../api";
import { useAccount } from "../context";
import {
  Button,
  RefreshButton,
  Input,
  Switch,
  PageHeader,
  EmptyState,
  ErrorState,
  Loading,
  Table,
  Status,
  Modal,
  Confirm,
  Field,
  SubmitButton,
  FormDisclosure,
  submit,
  useAction,
  useToast,
} from "../ui";
import type { DnsRecord, Zone } from "../../shared/types";
const recordTypes = [
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
];
const structuredTypes = [
  "SRV",
  "CAA",
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
];
function writableRecord(record: DnsRecord) {
  const { type, name, content, ttl, proxied, priority, comment, tags, data } =
    record;
  return { type, name, content, ttl, proxied, priority, comment, tags, data };
}
function ProxyCloud({ proxied }: { proxied: boolean }) {
  return (
    <svg
      viewBox="0 0 24 16"
      fill="currentColor"
      className={`proxy-cloud ${proxied ? "is-proxied" : "is-dns-only"}`}
      aria-hidden="true"
    >
      <path d="M3 15a3 3 0 0 1-.5-5.96A4 4 0 0 1 6.5 5c.4 0 .8.06 1.2.18A6 6 0 0 1 19.5 7v.25A3.9 3.9 0 1 1 20 15H3Z" />
    </svg>
  );
}
function ProxyStatus({
  record,
  pending,
  onToggle,
}: {
  record: DnsRecord;
  pending: boolean;
  onToggle: () => void;
}) {
  const canProxy =
    record.proxiable ?? ["A", "AAAA", "CNAME"].includes(record.type);
  const proxied = canProxy && Boolean(record.proxied);
  const content = (
    <>
      <ProxyCloud proxied={proxied} />
      <span className="proxy-label">{proxied ? "已代理" : "仅 DNS"}</span>
    </>
  );
  return canProxy ? (
    <button
      className="proxy-status"
      aria-label={`${record.name} ${record.type} ${proxied ? "已代理，切换为仅 DNS" : "仅 DNS，开启代理"}`}
      disabled={pending}
      onClick={onToggle}
    >
      {content}
    </button>
  ) : (
    <span className="proxy-status">{content}</span>
  );
}

function RecordForm({
  record,
  zoneName,
  base,
  onClose,
  onDelete,
  onBusyChange,
}: {
  record?: DnsRecord;
  zoneName: string;
  base: string;
  onClose: () => void;
  onDelete?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [type, setType] = useState(record?.type || "A");
  const [proxied, setProxied] = useState(record?.proxied ?? false);
  const [ttl, setTtl] = useState(record?.ttl ?? 1);
  const canProxy = ["A", "AAAA", "CNAME"].includes(type);
  const isProxied = canProxy && proxied;
  const { pending, run } = useAction();
  const client = useQueryClient();
  const contentLabel =
    type === "A" ? "IPv4 地址" : type === "AAAA" ? "IPv6 地址" : "目标内容";
  const ttlOptions = Array.from(
    new Set([1, 60, 120, 300, 600, 1800, 3600, 7200, 86400, ttl]),
  );
  const relativeName = record
    ? record.name === zoneName
      ? "@"
      : record.name.endsWith(`.${zoneName}`)
        ? record.name.slice(0, -(zoneName.length + 1))
        : record.name
    : "";
  const nameField = (
    <Input
      label="名称"
      name="name"
      defaultValue={relativeName}
      required
      maxLength={253}
      autoFocus={Boolean(record)}
    />
  );
  const typeField = (
    <Field label="类型">
      <Select
        value={type}
        onValueChange={(value) => setType(value ?? "A")}
        aria-label="记录类型"
      >
        {recordTypes.map((item) => (
          <Select.Option key={item} value={item}>
            {item}
          </Select.Option>
        ))}
      </Select>
    </Field>
  );
  const form = (
    <form
      className={record ? "dns-inline-form" : undefined}
      onSubmit={(event) =>
        submit(event, (form) => {
          onBusyChange?.(true);
          void run(async () => {
            const rawName = String(form.get("name")).trim();
            const name =
              rawName === "@"
                ? zoneName
                : rawName === zoneName || rawName.endsWith(`.${zoneName}`)
                  ? rawName
                  : `${rawName}.${zoneName}`;
            const input = {
              type,
              name,
              content: String(form.get("content") || ""),
              ttl: isProxied ? 1 : ttl,
              proxied: isProxied,
              comment: String(form.get("comment") || ""),
              ...(type === "MX"
                ? { priority: Number(form.get("priority")) }
                : {}),
              ...(structuredTypes.includes(type)
                ? { data: JSON.parse(String(form.get("data"))) }
                : {}),
            };
            await api(`${base}/records${record ? `/${record.id}` : ""}`, {
              method: record ? "PATCH" : "POST",
              body: input,
            });
            await client.invalidateQueries({ queryKey: ["records"] });
            onClose();
          }, "DNS 记录已保存").finally(() => onBusyChange?.(false));
        })
      }
    >
      <div
        className={
          record
            ? `dns-inline-fields${canProxy ? " has-proxy" : ""}`
            : "modal-body form-stack"
        }
      >
        <div className="dns-name-grid">
          {record ? (
            <>
              {nameField}
              {typeField}
            </>
          ) : (
            <>
              {typeField}
              {nameField}
            </>
          )}
        </div>
        <div
          className={
            canProxy ? "dns-value-grid" : "dns-value-fields form-stack"
          }
        >
          {structuredTypes.includes(type) ? (
            <Field
              label="结构化数据 JSON"
              hint="填写 Cloudflare API 对应记录类型的 data 字段"
            >
              <textarea
                name="data"
                className="code-input"
                rows={6}
                defaultValue={JSON.stringify(record?.data ?? {}, null, 2)}
                required
              />
            </Field>
          ) : type === "TXT" ? (
            <Field label="文本内容">
              <textarea
                name="content"
                rows={4}
                defaultValue={record?.content}
                required
                maxLength={65535}
              />
            </Field>
          ) : (
            <Input
              label={contentLabel}
              name="content"
              defaultValue={record?.content}
              required
              maxLength={65535}
            />
          )}
          {canProxy && (
            <div className="field">
              <span id="record-proxy-label">代理状态</span>
              <div className="proxy-control">
                <Switch
                  checked={proxied}
                  onCheckedChange={setProxied}
                  aria-labelledby="record-proxy-label"
                />
                <span className="proxy-status">
                  <ProxyCloud proxied={isProxied} />
                  <span className="proxy-label">
                    {isProxied ? "已代理" : "仅 DNS"}
                  </span>
                </span>
              </div>
            </div>
          )}
          <Field label="TTL">
            <Select
              value={isProxied ? 1 : ttl}
              onValueChange={(value) => setTtl(value ?? 1)}
              disabled={isProxied}
              aria-label="TTL"
              renderValue={(value) => (value === 1 ? "自动" : `${value} 秒`)}
            >
              {ttlOptions.map((value) => (
                <Select.Option key={value} value={value}>
                  {value === 1 ? "自动" : `${value} 秒`}
                </Select.Option>
              ))}
            </Select>
          </Field>
        </div>
        {type === "MX" && (
          <div className="dns-priority-field">
            <Input
              label="优先级"
              name="priority"
              type="number"
              min={0}
              max={65535}
              defaultValue={record?.priority ?? 10}
              required
            />
          </div>
        )}
        <FormDisclosure
          label="记录属性"
          accessory={
            <a
              className="record-attributes-docs"
              href="https://developers.cloudflare.com/dns/manage-dns-records/reference/record-attributes/"
              target="_blank"
              rel="noreferrer"
              aria-label="查看记录属性文档"
              title="记录属性文档"
            >
              <BookOpenIcon size={12} aria-hidden="true" />
            </a>
          }
        >
          <Input
            label="备注"
            name="comment"
            defaultValue={record?.comment}
            maxLength={500}
          />
        </FormDisclosure>
      </div>
      <div className={record ? "dns-inline-footer" : "modal-footer"}>
        <SubmitButton pending={pending}>保存</SubmitButton>
        <Button type="button" onClick={onClose} disabled={pending}>
          取消
        </Button>
        {record && onDelete && (
          <Button
            type="button"
            variant="secondary-destructive"
            onClick={onDelete}
            disabled={pending}
          >
            <TrashIcon size={16} />
            删除
          </Button>
        )}
      </div>
    </form>
  );
  return record ? (
    form
  ) : (
    <Modal title="添加记录" onClose={onClose} busy={pending} wide>
      {form}
    </Modal>
  );
}
export default function Dns() {
  const { account } = useAccount();
  const [params, setParams] = useSearchParams();
  const zoneId = params.get("zone");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [proxy, setProxy] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<DnsRecord | "new" | null>(null);
  const [recordSaving, setRecordSaving] = useState(false);
  const [deleting, setDeleting] = useState<DnsRecord[] | null>(null);
  const [importing, setImporting] = useState<Record<string, unknown>[] | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const { pending, run } = useAction();
  const notify = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const zones = useQuery({
    queryKey: ["zones", account?.id],
    queryFn: ({ signal }) =>
      api<Zone[]>(`/accounts/${account!.id}/dns/zones`, { signal }),
    enabled: Boolean(account),
  });
  const zone = zones.data?.find((item) => item.id === zoneId);
  const base = `/accounts/${account?.id}/dns/zones/${zoneId}`;
  const records = useQuery({
    queryKey: ["records", account?.id, zoneId],
    queryFn: ({ signal }) => api<DnsRecord[]>(`${base}/records`, { signal }),
    enabled: Boolean(account && zone),
  });
  const filtered = (records.data ?? []).filter(
    (record) =>
      `${record.name} ${record.content} ${record.comment ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (type === "all" || type === record.type) &&
      (proxy === "all" || String(Boolean(record.proxied)) === proxy),
  );
  const selectedRecords = (records.data ?? []).filter((record) =>
    selected.has(record.id),
  );
  const availableZones = (zones.data ?? []).filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  async function refreshRecords() {
    setSelected(new Set());
    await client.invalidateQueries({ queryKey: ["records"] });
  }
  if (!account)
    return (
      <>
        <PageHeader title="DNS 管理" />
        <div className="panel">
          <EmptyState
            title="先连接 Cloudflare 账号"
            action={
              <Button onClick={() => navigate("/settings?tab=accounts")}>
                添加账号
              </Button>
            }
          />
        </div>
      </>
    );
  return (
    <>
      <PageHeader
        title={zone ? `${zone.name} 的 DNS 记录` : "DNS 管理"}
        eyebrow={
          zone ? (
            <button
              className="text-link back-link"
              onClick={() => {
                setParams({});
                setSearch("");
                setSelected(new Set());
              }}
            >
              <ArrowLeftIcon size={14} />
              全部域名
            </button>
          ) : undefined
        }
      />
      {zones.isPending ? (
        <Loading />
      ) : zones.error ? (
        <ErrorState error={zones.error} retry={() => void zones.refetch()} />
      ) : !zone ? (
        <>
          <div className="resource-search">
            <div className="search-input">
              <MagnifyingGlassIcon />
              <Input
                aria-label="搜索域名"
                placeholder="搜索域名"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <RefreshButton
              aria-label="刷新域名"
              loading={zones.isFetching}
              onClick={() => void zones.refetch()}
            />
          </div>
          <section className="panel">
            {!availableZones.length ? (
              <EmptyState title="暂无匹配的域名" />
            ) : (
              <div className="table-scroll">
                <Table layout="fixed" className="zones-table">
                  <colgroup>
                    <col />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 110 }} />
                  </colgroup>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>域名</Table.Head>
                      <Table.Head>状态</Table.Head>
                      <Table.Head>套餐</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {availableZones.map((item) => (
                      <Table.Row key={item.id}>
                        <Table.Cell>
                          <button
                            className="resource-link name-cell"
                            onClick={() => {
                              setParams({ zone: item.id });
                              setSearch("");
                            }}
                          >
                            {item.name}
                          </button>
                        </Table.Cell>
                        <Table.Cell>
                          <Status value={item.status} />
                        </Table.Cell>
                        <Table.Cell>
                          {formatZonePlan(item.plan?.name)}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
            <div className="table-footer">
              共 {availableZones.length} 个域名
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="resource-toolbar dns-toolbar">
            <div className="search-input">
              <MagnifyingGlassIcon size={18} />
              <Input
                aria-label="搜索 DNS 记录"
                placeholder="搜索 DNS 记录"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Popover>
              <Popover.Trigger render={<Button />}>
                <FunnelIcon size={18} />
                筛选器
                {(type !== "all" || proxy !== "all") && (
                  <span className="filter-count">
                    {Number(type !== "all") + Number(proxy !== "all")}
                  </span>
                )}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="bottom" align="start" sideOffset={8}>
                  <Popover.Popup className="filter-popup form-stack">
                    <Popover.Title>筛选 DNS 记录</Popover.Title>
                    <Field label="记录类型">
                      <Select
                        aria-label="筛选记录类型"
                        value={type}
                        onValueChange={(value) => setType(value ?? "all")}
                        renderValue={(value) =>
                          value === "all" ? "所有类型" : value
                        }
                      >
                        <Select.Option value="all">所有类型</Select.Option>
                        {recordTypes.map((item) => (
                          <Select.Option key={item} value={item}>
                            {item}
                          </Select.Option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="代理状态">
                      <Select
                        aria-label="筛选代理状态"
                        value={proxy}
                        onValueChange={(value) => setProxy(value ?? "all")}
                        renderValue={(value) =>
                          ({
                            all: "所有代理状态",
                            true: "已代理",
                            false: "仅 DNS",
                          })[String(value)]
                        }
                      >
                        <Select.Option value="all">所有代理状态</Select.Option>
                        <Select.Option value="true">已代理</Select.Option>
                        <Select.Option value="false">仅 DNS</Select.Option>
                      </Select>
                    </Field>
                    <Button
                      onClick={() => {
                        setType("all");
                        setProxy("all");
                      }}
                    >
                      重置筛选
                    </Button>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover>
            <Button onClick={() => fileInput.current?.click()}>
              <UploadIcon size={18} />
              导入
            </Button>
            <Button
              disabled={!records.data}
              onClick={() =>
                downloadJson(
                  `${zone.name}-dns.json`,
                  records.data?.map(writableRecord),
                )
              }
            >
              <DownloadIcon size={18} />
              导出
            </Button>
            <Button
              variant="primary"
              disabled={recordSaving}
              onClick={() => setEditing("new")}
            >
              <PlusIcon size={18} />
              添加记录
            </Button>
            <RefreshButton
              aria-label="刷新 DNS 记录"
              loading={records.isFetching}
              onClick={() => void records.refetch()}
            />
            <input
              hidden
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void run(async () => {
                    const data = JSON.parse(await file.text());
                    if (
                      !Array.isArray(data) ||
                      data.length < 1 ||
                      data.length > 200
                    )
                      throw new Error(
                        "请选择包含 1–200 条记录的 JSON 数组文件",
                      );
                    setImporting(data);
                  });
                event.target.value = "";
              }}
            />
          </div>
          <section className="panel">
            <div className="table-caption">
              共 {records.data?.length ?? 0} 条 DNS 记录
            </div>
            {selectedRecords.length > 0 && (
              <div className="selection-bar">
                <strong>已选 {selectedRecords.length} 条</strong>
                <Button
                  size="sm"
                  variant="secondary-destructive"
                  disabled={recordSaving}
                  onClick={() => setDeleting(selectedRecords)}
                >
                  删除
                </Button>
                <Button
                  size="sm"
                  disabled={
                    pending ||
                    recordSaving ||
                    selectedRecords.some(
                      (item) => !["A", "AAAA", "CNAME"].includes(item.type),
                    )
                  }
                  onClick={() =>
                    run(async () => {
                      await api(`${base}/batch`, {
                        method: "POST",
                        body: {
                          patches: selectedRecords.map((item) => ({
                            id: item.id,
                            proxied: true,
                          })),
                        },
                      });
                      await refreshRecords();
                    }, "代理状态已更新")
                  }
                >
                  开启代理
                </Button>
                <Button
                  size="sm"
                  disabled={
                    pending ||
                    recordSaving ||
                    selectedRecords.some(
                      (item) => !["A", "AAAA", "CNAME"].includes(item.type),
                    )
                  }
                  onClick={() =>
                    run(async () => {
                      await api(`${base}/batch`, {
                        method: "POST",
                        body: {
                          patches: selectedRecords.map((item) => ({
                            id: item.id,
                            proxied: false,
                          })),
                        },
                      });
                      await refreshRecords();
                    }, "代理状态已更新")
                  }
                >
                  仅 DNS
                </Button>
                <button
                  className="text-link"
                  onClick={() => setSelected(new Set())}
                >
                  取消选择
                </button>
              </div>
            )}
            {records.isPending ? (
              <Loading />
            ) : records.error ? (
              <ErrorState
                error={records.error}
                retry={() => void records.refetch()}
              />
            ) : !filtered.length ? (
              <EmptyState
                title={
                  records.data?.length ? "没有匹配的记录" : "暂无 DNS 记录"
                }
              />
            ) : (
              <div className="table-scroll">
                <Table layout="fixed" className="dns-records-table">
                  <colgroup>
                    <col style={{ width: 44 }} />
                    <col style={{ width: "24%" }} />
                    <col style={{ width: 70 }} />
                    <col />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 95 }} />
                    <col style={{ width: 72 }} />
                  </colgroup>
                  <Table.Header>
                    <Table.Row>
                      <Table.CheckHead
                        label="选择全部记录"
                        checked={filtered.every((item) =>
                          selected.has(item.id),
                        )}
                        indeterminate={
                          filtered.some((item) => selected.has(item.id)) &&
                          !filtered.every((item) => selected.has(item.id))
                        }
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked
                              ? new Set(filtered.map((item) => item.id))
                              : new Set(),
                          )
                        }
                      />
                      <Table.Head>名称</Table.Head>
                      <Table.Head>类型</Table.Head>
                      <Table.Head>内容</Table.Head>
                      <Table.Head>代理状态</Table.Head>
                      <Table.Head>TTL</Table.Head>
                      <Table.Head>备注</Table.Head>
                      <Table.Head />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {filtered.map((record) => {
                      const isEditing =
                        editing !== null &&
                        editing !== "new" &&
                        editing.id === record.id;
                      return (
                        <Fragment key={record.id}>
                          <Table.Row
                            variant={
                              selected.has(record.id) ? "selected" : "default"
                            }
                          >
                            <Table.CheckCell
                              label={`选择 ${record.name} ${record.type}`}
                              checked={selected.has(record.id)}
                              onCheckedChange={(checked) =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(record.id);
                                  else next.delete(record.id);
                                  return next;
                                })
                              }
                            />
                            <Table.Cell>
                              <strong className="dns-name" title={record.name}>
                                {record.name}
                              </strong>
                            </Table.Cell>
                            <Table.Cell>{record.type}</Table.Cell>
                            <Table.Cell>
                              <span
                                className="record-content"
                                title={
                                  record.content || JSON.stringify(record.data)
                                }
                              >
                                {record.content || JSON.stringify(record.data)}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <ProxyStatus
                                record={record}
                                pending={pending || recordSaving || isEditing}
                                onToggle={() =>
                                  run(async () => {
                                    await api(`${base}/records/${record.id}`, {
                                      method: "PATCH",
                                      body: { proxied: !record.proxied },
                                    });
                                    await refreshRecords();
                                  }, "代理状态已更新")
                                }
                              />
                            </Table.Cell>
                            <Table.Cell className="nowrap">
                              {record.ttl === 1 ? "自动" : `${record.ttl} 秒`}
                            </Table.Cell>
                            <Table.Cell>
                              <span
                                className="record-comment muted"
                                title={record.comment}
                              >
                                {record.comment || "—"}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <div className="row-actions">
                                <button
                                  className="table-action"
                                  disabled={recordSaving}
                                  aria-label={`${isEditing ? "关闭" : "编辑"} ${record.name} ${record.type}`}
                                  aria-expanded={isEditing}
                                  aria-controls={
                                    isEditing
                                      ? `dns-editor-${record.id}`
                                      : undefined
                                  }
                                  onClick={() =>
                                    setEditing(isEditing ? null : record)
                                  }
                                >
                                  {isEditing ? "关闭" : "编辑"}
                                </button>
                              </div>
                            </Table.Cell>
                          </Table.Row>
                          {isEditing && (
                            <Table.Row
                              className="dns-edit-row"
                              id={`dns-editor-${record.id}`}
                            >
                              <Table.Cell colSpan={8}>
                                <RecordForm
                                  key={record.id}
                                  record={record}
                                  zoneName={zone.name}
                                  base={base}
                                  onClose={() =>
                                    setEditing((current) =>
                                      current &&
                                      current !== "new" &&
                                      current.id === record.id
                                        ? null
                                        : current,
                                    )
                                  }
                                  onDelete={() => setDeleting([record])}
                                  onBusyChange={setRecordSaving}
                                />
                              </Table.Cell>
                            </Table.Row>
                          )}
                        </Fragment>
                      );
                    })}
                  </Table.Body>
                </Table>
              </div>
            )}
            <div className="table-footer">
              显示 {filtered.length} 条，共 {records.data?.length ?? 0} 条记录
            </div>
          </section>
          {editing === "new" && (
            <RecordForm
              key="new"
              zoneName={zone.name}
              base={base}
              onClose={() => setEditing(null)}
            />
          )}
          {deleting && (
            <Confirm
              title={`删除 ${deleting.length} 条 DNS 记录`}
              onClose={() => setDeleting(null)}
              onConfirm={async () => {
                if (deleting.length > 200)
                  throw new Error("每次最多删除 200 条记录");
                await api(`${base}/batch`, {
                  method: "POST",
                  body: { deletes: deleting.map((item) => ({ id: item.id })) },
                });
                if (
                  editing &&
                  editing !== "new" &&
                  deleting.some((item) => item.id === editing.id)
                )
                  setEditing(null);
                await refreshRecords();
              }}
            >
              将删除选中的记录，请确认相关网站和邮件服务已完成调整
            </Confirm>
          )}
          {importing && (
            <Confirm
              title="导入 DNS 记录"
              confirmText="确认导入"
              onClose={() => setImporting(null)}
              onConfirm={async () => {
                await api(`${base}/batch`, {
                  method: "POST",
                  body: { posts: importing },
                });
                await refreshRecords();
                notify("记录已导入");
              }}
            >
              将在 {zone.name} 新增 {importing.length} 条记录
            </Confirm>
          )}
        </>
      )}
    </>
  );
}
