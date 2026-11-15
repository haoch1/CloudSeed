import { Tabs } from "@cloudflare/kumo/components/tabs";
import { Select } from "@cloudflare/kumo/components/select";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, formatDate } from "../api";
import {
  Button,
  ErrorState,
  Input,
  Loading,
  PageHeader,
  SubmitButton,
  submit,
  useAction,
} from "../ui";
import { sessionDurationOptions } from "../../shared/session";
import Accounts from "./Accounts";

type SessionSettings = { durationSeconds: number; expiresAt: string };

function SessionDurationSettings() {
  const client = useQueryClient();
  const [draft, setDraft] = useState<number | null>(null);
  const { pending, run } = useAction();
  const query = useQuery({
    queryKey: ["session-duration"],
    queryFn: ({ signal }) =>
      api<SessionSettings>("/auth/session-duration", { signal }),
  });
  if (query.isPending)
    return (
      <section className="panel settings-section">
        <Loading />
      </section>
    );
  if (query.isError)
    return (
      <section className="panel settings-section">
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      </section>
    );
  const duration = draft ?? query.data.durationSeconds;
  return (
    <section className="panel settings-section">
      <h2>登录有效期</h2>
      <div className="settings-form form-stack">
        <div className="field">
          <Select
            aria-label="登录有效期"
            value={duration}
            onValueChange={(value) =>
              setDraft(value ?? query.data.durationSeconds)
            }
            renderValue={(value) =>
              sessionDurationOptions.find((option) => option.seconds === value)
                ?.label ?? "请选择"
            }
            disabled={pending}
          >
            {sessionDurationOptions.map((option) => (
              <Select.Option key={option.seconds} value={option.seconds}>
                {option.label}
              </Select.Option>
            ))}
          </Select>
          <small className="muted">
            当前登录有效至 {formatDate(query.data.expiresAt)}
          </small>
        </div>
        <div>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                const settings = await api<SessionSettings>(
                  "/auth/session-duration",
                  {
                    method: "PUT",
                    body: { durationSeconds: duration },
                  },
                );
                client.setQueryData(["session-duration"], settings);
                setDraft(null);
              }, "登录有效期已更新")
            }
          >
            保存设置
          </Button>
        </div>
      </div>
    </section>
  );
}

export default function Settings() {
  const { pending, run } = useAction();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab =
    tabParam === "security" || tabParam === "session" ? tabParam : "accounts";
  const tabs = (
    <Tabs
      className="page-tabs"
      labels={{ scrollStart: "向左滚动标签", scrollEnd: "向右滚动标签" }}
      tabs={[
        { value: "accounts", label: "账号管理" },
        { value: "security", label: "管理员密码" },
        { value: "session", label: "登录有效期" },
      ]}
      value={tab}
      onValueChange={(value) => setParams({ tab: value })}
    />
  );
  return (
    <>
      <PageHeader title="设置" />
      {tab === "accounts" ? (
        <Accounts navigation={tabs} />
      ) : tab === "session" ? (
        <>
          <div className="settings-toolbar">{tabs}</div>
          <SessionDurationSettings />
        </>
      ) : (
        <>
          <div className="settings-toolbar">{tabs}</div>
          <section className="panel settings-section">
            <form
              className="settings-form form-stack"
              onSubmit={(event) =>
                submit(event, (data) =>
                  run(async () => {
                    if (data.get("newPassword") !== data.get("confirmPassword"))
                      throw new Error("两次输入的密码不一致");
                    await api("/auth/password", {
                      method: "POST",
                      body: {
                        currentPassword: data.get("currentPassword"),
                        newPassword: data.get("newPassword"),
                      },
                    });
                    window.location.reload();
                  }),
                )
              }
            >
              <Input
                label="当前密码"
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
              />
              <Input
                label="新密码"
                type="password"
                name="newPassword"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
                description="至少 12 个字符"
              />
              <Input
                label="确认新密码"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
              />
              <div>
                <SubmitButton pending={pending}>更新密码</SubmitButton>
              </div>
            </form>
          </section>
        </>
      )}
    </>
  );
}
