import { Select } from "@cloudflare/kumo/components/select";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { api } from "../../api";
import { useAccount } from "../../context";
import {
  Button,
  Input,
  ErrorState,
  Loading,
  Modal,
  Confirm,
  Field,
  SubmitButton,
  Switch,
  Table,
  Text,
  Status,
  submit,
  useAction,
} from "../../ui";
import type { BucketDomain, Zone } from "../../../shared/types";
function JsonSetting({
  title,
  path,
  request,
  cors = false,
  jurisdiction,
}: {
  title: string;
  path: string;
  request: typeof api;
  cors?: boolean;
  jurisdiction: string;
}) {
  const query = useQuery({
    queryKey: ["bucket-setting", path, jurisdiction],
    queryFn: ({ signal }) =>
      request<{
        rules?: Record<string, unknown>[];
      }>(path, { signal }),
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { pending, run } = useAction();
  const client = useQueryClient();
  const value =
    draft ?? JSON.stringify({ rules: query.data?.rules ?? [] }, null, 2);
  return (
    <section className="panel settings-section">
      <div>
        <Text variant="heading" as="h2">
          {title}
        </Text>
        {cors && (
          <p className="muted">上传和预览需要允许当前面板地址，添加规则后请保存。</p>
        )}
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <textarea
            aria-label={`${title} JSON`}
            className="code-input"
            rows={9}
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
          />
          <div className="actions">
            {cors && (
              <Button
                onClick={() =>
                  run(async () => {
                    let current: { rules?: { id?: string }[] };
                    try {
                      current = JSON.parse(value);
                    } catch {
                      throw new Error("JSON 格式不正确，请检查语法");
                    }
                    const rules = (current.rules ?? []).filter(
                      (rule) => rule.id !== "cloudseed",
                    );
                    rules.push({
                      id: "cloudseed",
                      allowed: {
                        origins: [window.location.origin],
                        methods: ["GET", "HEAD", "PUT"],
                        headers: ["*"],
                      },
                      exposeHeaders: ["ETag"],
                      maxAgeSeconds: 3600,
                    } as {
                      id?: string;
                    });
                    setDraft(JSON.stringify({ rules }, null, 2));
                  })
                }
              >
                加入面板直传规则
              </Button>
            )}
            <Button
              variant="primary"
              disabled={pending || draft === null}
              onClick={() =>
                run(async () => {
                  try {
                    JSON.parse(value);
                  } catch {
                    throw new Error("JSON 格式不正确，请检查语法");
                  }
                  setConfirming(true);
                })
              }
            >
              保存规则
            </Button>
          </div>
        </>
      )}
      {confirming && (
        <Confirm
          title={`保存${title}`}
          confirmText="保存规则"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await request(path, { method: "PUT", body: JSON.parse(value) });
            setDraft(null);
            await client.invalidateQueries({
              queryKey: ["bucket-setting", path, jurisdiction],
            });
          }}
        >
          将使用编辑器中的完整规则替换此桶的现有配置
        </Confirm>
      )}
    </section>
  );
}
export function BucketSettings({
  base,
  bucket,
  request,
  onDeleted,
  jurisdiction,
}: {
  base: string;
  bucket: string;
  request: typeof api;
  onDeleted: () => void;
  jurisdiction: string;
}) {
  const { account } = useAccount();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [managedChange, setManagedChange] = useState<boolean | null>(null);
  const { pending, run } = useAction();
  const client = useQueryClient();
  const domains = useQuery({
    queryKey: ["domains", base, jurisdiction],
    queryFn: ({ signal }) =>
      request<{
        domains: BucketDomain[];
      }>(`${base}/domains/custom`, { signal }),
  });
  const managed = useQuery({
    queryKey: ["managed-domain", base, jurisdiction],
    queryFn: ({ signal }) =>
      request<{
        domain: string;
        enabled: boolean;
      }>(`${base}/domains/managed`, { signal }),
  });
  const zones = useQuery({
    queryKey: ["zones", account?.id],
    queryFn: ({ signal }) =>
      api<Zone[]>(`/accounts/${account!.id}/dns/zones`, { signal }),
    enabled: Boolean(account) && adding,
  });
  return (
    <div className="settings-stack">
      <section className="panel settings-section">
        <div className="section-heading">
          <div>
            <Text variant="heading" as="h2">
              自定义域名
            </Text>
          </div>
          <Button onClick={() => setAdding(true)}>
            <PlusIcon />
            连接域名
          </Button>
        </div>
        {domains.isPending ? (
          <Loading />
        ) : domains.error ? (
          <ErrorState
            error={domains.error}
            retry={() => void domains.refetch()}
          />
        ) : !domains.data?.domains?.length ? (
          <p className="muted">尚未绑定自定义域名</p>
        ) : (
          <div className="table-scroll">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.Head>域名</Table.Head>
                  <Table.Head>访问状态</Table.Head>
                  <Table.Head>证书状态</Table.Head>
                  <Table.Head>操作</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {domains.data.domains.map((domain) => (
                  <Table.Row key={domain.domain}>
                    <Table.Cell>{domain.domain}</Table.Cell>
                    <Table.Cell>
                      {domain.enabled ? "已启用" : "已禁用"}
                    </Table.Cell>
                    <Table.Cell>
                      <Status value={domain.status?.ssl || "待查询"} />
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        variant="ghost"
                        size="sm"
                        shape="square"
                        aria-label={`解绑 ${domain.domain}`}
                        onClick={() => setRemoving(domain.domain)}
                      >
                        <TrashIcon />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </section>
      <section className="panel settings-section">
        <div className="switch-field">
          <div>
            <Text variant="heading" as="h2">
              r2.dev 公共访问
            </Text>
            <code className="public-url" title={managed.data?.domain}>
              {managed.data?.domain || "—"}
            </code>
          </div>
          {managed.isPending ? (
            <Loading />
          ) : managed.error ? (
            <ErrorState
              error={managed.error}
              retry={() => void managed.refetch()}
            />
          ) : (
            <Switch
              checked={managed.data?.enabled ?? false}
              onCheckedChange={setManagedChange}
              aria-label="r2.dev 公共访问"
            />
          )}
        </div>
      </section>
      <JsonSetting
        key={`${base}-cors`}
        title="CORS 跨域规则"
        path={`${base}/cors`}
        request={request}
        jurisdiction={jurisdiction}
        cors
      />
      <JsonSetting
        key={`${base}-lifecycle`}
        title="生命周期规则"
        path={`${base}/lifecycle`}
        request={request}
        jurisdiction={jurisdiction}
      />
      <section className="panel settings-section danger-section">
        <div>
          <Text variant="heading" as="h2">
            删除存储桶
          </Text>
          <p className="muted">请先清空桶内对象，删除后无法恢复。</p>
        </div>
        <Button
          variant="secondary-destructive"
          onClick={() => setDeleting(true)}
        >
          删除存储桶
        </Button>
      </section>
      {adding && (
        <Modal
          title="连接自定义域名"
          onClose={() => setAdding(false)}
          busy={pending}
        >
          <form
            onSubmit={(event) =>
              submit(event, (data) =>
                run(async () => {
                  await request(`${base}/domains/custom`, {
                    method: "POST",
                    body: {
                      domain: data.get("domain"),
                      zoneId: data.get("zoneId"),
                      enabled: true,
                      minTLS: "1.2",
                    },
                  });
                  await domains.refetch();
                  setAdding(false);
                }, "域名已提交绑定，可刷新查看生效状态"),
              )
            }
          >
            <div className="modal-body form-stack">
              {zones.error && (
                <ErrorState
                  error={zones.error}
                  retry={() => void zones.refetch()}
                />
              )}
              <Field label="所属域名">
                <Select
                  key={zones.data?.[0]?.id}
                  defaultValue={zones.data?.[0]?.id}
                  name="zoneId"
                  required
                  disabled={zones.isPending}
                  aria-label="所属域名"
                  renderValue={(value) =>
                    zones.data?.find((zone) => zone.id === value)?.name || value
                  }
                >
                  {zones.data?.map((zone) => (
                    <Select.Option key={zone.id} value={zone.id}>
                      {zone.name}
                    </Select.Option>
                  ))}
                </Select>
              </Field>
              <Input
                label="访问域名"
                name="domain"
                required
                placeholder="assets.example.com"
              />
              <p className="muted">绑定后，域名可公开访问桶内对象</p>
            </div>
            <div className="modal-footer">
              <Button
                type="button"
                onClick={() => setAdding(false)}
                disabled={pending}
              >
                取消
              </Button>
              <SubmitButton pending={pending}>连接域名</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <Confirm
          title={`解绑 ${removing}`}
          onClose={() => setRemoving(null)}
          confirmText="解绑域名"
          onConfirm={async () => {
            await request(
              `${base}/domains/custom/${encodeURIComponent(removing)}`,
              { method: "DELETE" },
            );
            await domains.refetch();
          }}
        >
          将移除此桶的自定义域名绑定
        </Confirm>
      )}
      {managedChange !== null && (
        <Confirm
          title={
            managedChange ? "启用 r2.dev 公共访问" : "关闭 r2.dev 公共访问"
          }
          confirmText="确认修改"
          onClose={() => setManagedChange(null)}
          onConfirm={async () => {
            await request(`${base}/domains/managed`, {
              method: "PUT",
              body: { enabled: managedChange },
            });
            await managed.refetch();
          }}
        >
          {managedChange
            ? "启用后，可通过 r2.dev 地址公开访问桶内对象"
            : "将关闭此桶通过 r2.dev 地址的公开访问"}
        </Confirm>
      )}
      {deleting && (
        <Confirm
          title={`删除 ${bucket}`}
          confirmation={bucket}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await request(base, {
              method: "DELETE",
              body: { confirmation: bucket },
            });
            await client.invalidateQueries({ queryKey: ["buckets"] });
            onDeleted();
          }}
        >
          此桶需要为空，删除后无法恢复
        </Confirm>
      )}
    </div>
  );
}
