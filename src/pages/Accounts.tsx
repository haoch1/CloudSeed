import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PlusIcon,
  PencilSimpleIcon,
  TrashIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react";
import { api, formatDate } from "../api";
import { useAccount } from "../context";
import {
  Button,
  Input,
  EmptyState,
  Table,
  Modal,
  Confirm,
  SubmitButton,
  FormDisclosure,
  submit,
  useAction,
  useToast,
} from "../ui";
import type { Account } from "../../shared/types";

function AccountForm({
  account,
  onClose,
}: {
  account?: Account;
  onClose: () => void;
}) {
  const { pending, run } = useAction();
  const client = useQueryClient();
  return (
    <Modal
      title={account ? "编辑 Cloudflare 账号" : "添加 Cloudflare 账号"}
      onClose={onClose}
      busy={pending}
    >
      <form
        onSubmit={(event) =>
          submit(event, (data) =>
            run(
              async () => {
                const input = Object.fromEntries(data);
                await api(`/accounts${account ? `/${account.id}` : ""}`, {
                  method: account ? "PATCH" : "POST",
                  body: input,
                });
                await client.invalidateQueries();
                onClose();
              },
              account ? "账号已更新" : "账号已添加",
            ),
          )
        }
      >
        <div className="modal-body form-stack">
          <Input
            label="账号名称"
            name="name"
            required
            maxLength={80}
            defaultValue={account?.name}
            placeholder="例如 个人账号"
          />
          <Input
            label="Account ID"
            name="accountId"
            required
            minLength={32}
            maxLength={32}
            defaultValue={account?.accountId}
            placeholder="Cloudflare 账号的 32 位 ID"
          />
          <Input
            label="Cloudflare API Token"
            name="token"
            type="password"
            required={!account}
            autoComplete="new-password"
            description={account ? "留空保留现有 Token" : undefined}
          />
          <a
            className="external-link"
            href="https://dash.cloudflare.com/profile/api-tokens"
            target="_blank"
            rel="noreferrer"
          >
            创建 API Token
            <ArrowSquareOutIcon size={14} />
          </a>
          <FormDisclosure label="R2 S3 凭据（可选）">
            <Input
              label="Access Key ID"
              name="accessKeyId"
              autoComplete="off"
            />
            <Input
              label="Secret Access Key"
              name="secretAccessKey"
              type="password"
              autoComplete="new-password"
              description={account ? "留空保留现有凭据" : undefined}
            />
          </FormDisclosure>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <SubmitButton pending={pending}>
            {account ? "保存账号" : "验证并添加"}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export default function Accounts({ navigation }: { navigation: ReactNode }) {
  const { accounts, account: active, setAccount } = useAccount();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const client = useQueryClient();
  const { pending, run } = useAction();
  const notify = useToast();
  return (
    <>
      <div className="settings-toolbar">
        {navigation}
        <Button variant="primary" onClick={() => setEditing("new")}>
          <PlusIcon size={16} />
          添加账号
        </Button>
      </div>
      <div className="panel">
        {!accounts.length ? (
          <EmptyState
            title="还没有连接账号"
            action={
              <Button onClick={() => setEditing("new")}>
                <PlusIcon />
                添加账号
              </Button>
            }
          />
        ) : (
          <div className="table-scroll">
            <Table layout="fixed" className="accounts-table">
              <colgroup>
                <col />
                <col style={{ width: 300 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 280 }} />
              </colgroup>
              <Table.Header>
                <Table.Row>
                  <Table.Head>账号</Table.Head>
                  <Table.Head>Account ID</Table.Head>
                  <Table.Head>R2 S3 凭据</Table.Head>
                  <Table.Head>添加时间</Table.Head>
                  <Table.Head>操作</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {accounts.map((account) => (
                  <Table.Row key={account.id}>
                    <Table.Cell>{account.name}</Table.Cell>
                    <Table.Cell>
                      <code>{account.accountId}</code>
                    </Table.Cell>
                    <Table.Cell>
                      {account.hasS3 ? (
                        <span
                          className="inline-good"
                          title={
                            account.s3CredentialType === "token"
                              ? "根据 API Token 推导，是否可用取决于 Token 的 R2 权限"
                              : "已保存 S3 凭据，是否可用取决于其 R2 权限"
                          }
                        >
                          <CheckCircleIcon />
                          {account.s3CredentialType === "token"
                            ? "Token 推导"
                            : "已配置"}
                        </span>
                      ) : (
                        "待配置"
                      )}
                    </Table.Cell>
                    <Table.Cell className="nowrap">
                      {formatDate(account.createdAt)}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="row-actions">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(async () => {
                              const result = await api<{
                                dns: boolean;
                                r2: boolean;
                                errors: (string | null)[];
                              }>(`/accounts/${account.id}/verify`, {
                                method: "POST",
                              });
                              notify(
                                `DNS ${result.dns ? "连接正常" : result.errors[0]}；R2 ${result.r2 ? "连接正常" : result.errors[1]}`,
                                !result.dns || !result.r2,
                              );
                            })
                          }
                        >
                          验证连接
                        </Button>
                        <Button
                          size="sm"
                          disabled={active?.id === account.id}
                          onClick={() => setAccount(account.id)}
                        >
                          {active?.id === account.id ? "当前" : "切换"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          shape="square"
                          aria-label={`编辑 ${account.name}`}
                          onClick={() => setEditing(account)}
                        >
                          <PencilSimpleIcon />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          shape="square"
                          aria-label={`移除 ${account.name}`}
                          onClick={() => setDeleting(account)}
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </div>
      {editing && (
        <AccountForm
          account={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Confirm
          title={`移除 ${deleting.name}`}
          onClose={() => setDeleting(null)}
          confirmText="移除账号"
          onConfirm={async () => {
            await api(`/accounts/${deleting.id}`, { method: "DELETE" });
            await client.invalidateQueries();
          }}
        >
          将移除此面板保存的账号连接
        </Confirm>
      )}
    </>
  );
}
