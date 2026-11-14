import { Tabs } from "@cloudflare/kumo/components/tabs";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Input, PageHeader, SubmitButton, submit, useAction } from "../ui";
import Accounts from "./Accounts";

export default function Settings() {
  const { pending, run } = useAction();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "security" ? "security" : "accounts";
  const tabs = (
    <Tabs
      className="page-tabs"
      labels={{ scrollStart: "向左滚动标签", scrollEnd: "向右滚动标签" }}
      tabs={[
        { value: "accounts", label: "账号管理" },
        { value: "security", label: "管理员密码" },
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
