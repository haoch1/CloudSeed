import { Select } from "@cloudflare/kumo/components/select";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar, useSidebar } from "@cloudflare/kumo/components/sidebar";
import { CloudflareLogo } from "@cloudflare/kumo/components/cloudflare-logo";
import {
  HouseIcon,
  TreeStructureIcon,
  DatabaseIcon,
  UserIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  MoonIcon,
  SunIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import { api, isDemoMode } from "./api";
import { resetDemoSession } from "./demo-session";
import { AccountContext } from "./context";
import {
  AuthSkeleton,
  PageSkeleton,
  SkeletonLine,
  SkeletonRegion,
} from "./Skeleton";
import {
  Button,
  ErrorBoundary,
  Input,
  ErrorState,
  submit,
  SubmitButton,
  useAction,
  Text,
} from "./ui";
import type { Account } from "../shared/types";
import { Overview } from "./pages/Overview";
const Dns = lazy(() => import("./pages/Dns"));
const R2 = lazy(() => import("./pages/R2"));
const Settings = lazy(() => import("./pages/Settings"));
const Audit = lazy(() => import("./pages/Audit"));
type AuthStatus = {
  authenticated: boolean;
  username?: string;
  email?: string;
};
function BrandMark() {
  return (
    <>
      <CloudflareLogo variant="glyph" className="brand-logo" />
      <Text variant="heading" size="lg" as="strong">
        CloudSeed
      </Text>
    </>
  );
}

function AuthScreen() {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const { pending, run } = useAction();
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <BrandMark />
      </div>
      <div className="auth-card">
        <Text variant="heading" size="lg" as="h1">
          登录
        </Text>
        <form
          onSubmit={(event) =>
            submit(event, (data) =>
              run(async () => {
                setError("");
                try {
                  await api("/auth/login", {
                    method: "POST",
                    body: Object.fromEntries(data),
                  });
                  await client.invalidateQueries({ queryKey: ["auth"] });
                } catch (issue) {
                  setError((issue as Error).message);
                }
              }),
            )
          }
        >
          <Input
            label="用户名"
            name="username"
            autoComplete="username"
            passwordManagerIgnore={false}
            required
          />
          <Input
            label="密码"
            name="password"
            type="password"
            minLength={12}
            maxLength={256}
            required
            autoComplete="current-password"
            passwordManagerIgnore={false}
          />
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <SubmitButton pending={pending}>登录</SubmitButton>
        </form>
        <a className="demo-entry" href="/demo/overview">
          演示模式
        </a>
      </div>
    </div>
  );
}
const navigation = [
  { path: "/overview", label: "概览", icon: HouseIcon },
  { path: "/dns", label: "DNS 管理", icon: TreeStructureIcon },
  { path: "/r2", label: "R2 对象存储", icon: DatabaseIcon },
  { path: "/audit", label: "操作记录", icon: ClockCounterClockwiseIcon },
  { path: "/settings", label: "设置", icon: GearSixIcon },
];
function NavigationMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Sidebar.Menu>
      {navigation.map((item) => (
        <Sidebar.MenuButton
          key={item.path}
          icon={item.icon}
          active={location.pathname.startsWith(item.path)}
          onClick={() => {
            navigate(item.path);
            if (isMobile) setOpenMobile(false);
          }}
        >
          {item.label}
        </Sidebar.MenuButton>
      ))}
    </Sidebar.Menu>
  );
}
function Shell({ username }: { username: string }) {
  const demo = isDemoMode();
  const accountStorageKey = demo
    ? "cloudseed-demo-account"
    : "cloudseed-account";
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: ({ signal }) => api<Account[]>("/accounts", { signal }),
  });
  const [selected, setSelected] = useState(
    () => localStorage.getItem(accountStorageKey) || "",
  );
  const [dark, setDark] = useState(
    () => localStorage.getItem("cloudseed-theme") === "dark",
  );
  const account =
    accounts.data?.find((item) => item.id === selected) ?? accounts.data?.[0];
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const { pending, run } = useAction();
  const pageSkeleton = (
    <PageSkeleton path={location.pathname} search={location.search} />
  );
  useLayoutEffect(() => {
    document.body.setAttribute("data-1p-ignore", "true");
    document.body.setAttribute("data-op-ignore", "true");
    return () => {
      document.body.removeAttribute("data-1p-ignore");
      document.body.removeAttribute("data-op-ignore");
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.mode = dark ? "dark" : "light";
    localStorage.setItem("cloudseed-theme", dark ? "dark" : "light");
  }, [dark]);
  const changeAccount = useCallback(
    (id: string) => {
      setSelected(id);
      localStorage.setItem(accountStorageKey, id);
      navigate(location.pathname);
    },
    [accountStorageKey, location.pathname, navigate],
  );
  const accountContextValue = useMemo(
    () => ({
      accounts: accounts.data ?? [],
      account,
      setAccount: changeAccount,
    }),
    [accounts.data, account, changeAccount],
  );
  return (
    <AccountContext.Provider value={accountContextValue}>
      <Sidebar.Provider
        defaultOpen
        defaultWidth={240}
        mobileBreakpoint={800}
        animationDuration={200}
        style={
          {
            "--sidebar-width": "240px",
            "--sidebar-easing": "cubic-bezier(0.2, 0, 0, 1)",
          } as CSSProperties
        }
        className={demo ? "app-layout demo-mode" : "app-layout"}
      >
        <Sidebar className="app-sidebar">
          <Sidebar.Header className="sidebar-header">
            <NavLink className="brand" to="/overview">
              <BrandMark />
            </NavLink>
            <div className="account-switch">
              {accounts.isPending ? (
                <SkeletonRegion label="正在加载 Cloudflare 账号">
                  <SkeletonLine width="100%" height="2.25rem" />
                </SkeletonRegion>
              ) : (
                <Select
                  aria-label="切换 Cloudflare 账号"
                  renderValue={() => account?.name || "添加 Cloudflare 账号"}
                  value={account?.id ?? ""}
                  onValueChange={(value) => changeAccount(value ?? "")}
                >
                  {!accounts.data?.length && (
                    <Select.Option value="">添加 Cloudflare 账号</Select.Option>
                  )}
                  {accounts.data?.map((item) => (
                    <Select.Option key={item.id} value={item.id}>
                      {item.name}
                    </Select.Option>
                  ))}
                </Select>
              )}
            </div>
          </Sidebar.Header>
          <Sidebar.Content>
            <Sidebar.Group>
              <NavigationMenu />
            </Sidebar.Group>
          </Sidebar.Content>
          <Sidebar.Footer className="sidebar-footer">
            <Sidebar.Trigger aria-label="收起或展开侧栏" />
          </Sidebar.Footer>
        </Sidebar>
        <div className="app-main">
          <header className="topbar">
            <div className="topbar-path">
              <span className="mobile-menu">
                <Sidebar.Trigger aria-label="打开导航" />
              </span>
            </div>
            <div className="topbar-actions">
              {demo && (
                <>
                  <span className="demo-label">演示模式</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      resetDemoSession();
                      window.location.reload();
                    }}
                  >
                    重置演示
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                shape="square"
                aria-label={dark ? "切换浅色模式" : "切换深色模式"}
                onClick={() => setDark((value) => !value)}
              >
                {dark ? <SunIcon size={19} /> : <MoonIcon size={19} />}
              </Button>
              <Button
                variant="ghost"
                shape="square"
                aria-label="账号管理"
                title={username}
                onClick={() => navigate("/settings?tab=accounts")}
              >
                <UserIcon size={19} />
              </Button>
              <Button
                variant="ghost"
                shape="square"
                aria-label={demo ? "退出演示" : "退出登录"}
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    if (demo) {
                      resetDemoSession();
                      window.location.assign("/");
                      return;
                    }
                    await api("/auth/logout", { method: "POST" });
                    client.clear();
                    window.location.reload();
                  })
                }
              >
                <SignOutIcon size={19} />
              </Button>
            </div>
          </header>
          <main className="page-content">
            {accounts.error ? (
              <ErrorState
                error={accounts.error}
                retry={() => void accounts.refetch()}
              />
            ) : accounts.isPending ? (
              pageSkeleton
            ) : (
              <ErrorBoundary resetKey={location.pathname + location.search}>
                <Suspense key={location.pathname} fallback={pageSkeleton}>
                  <Routes>
                    <Route path="/overview" element={<Overview />} />
                    <Route
                      path="/accounts"
                      element={<Navigate to="/settings?tab=accounts" replace />}
                    />
                    <Route path="/dns" element={<Dns />} />
                    <Route path="/r2" element={<R2 />} />
                    <Route path="/audit" element={<Audit />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route
                      path="*"
                      element={<Navigate to="/overview" replace />}
                    />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            )}
          </main>
        </div>
      </Sidebar.Provider>
    </AccountContext.Provider>
  );
}
export function App() {
  const client = useQueryClient();
  const auth = useQuery({
    queryKey: ["auth"],
    queryFn: ({ signal }) => api<AuthStatus>("/auth/status", { signal }),
  });
  useEffect(() => {
    const expire = () => {
      void client.cancelQueries();
      client.setQueryData<AuthStatus>(["auth"], { authenticated: false });
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== "auth",
      });
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, [client]);
  if (auth.error)
    return (
      <div className="auth-page">
        <ErrorState error={auth.error} retry={() => void auth.refetch()} />
      </div>
    );
  if (!auth.data) return <AuthSkeleton brand={<BrandMark />} />;
  if (!auth.data.authenticated) return <AuthScreen />;
  return <Shell username={auth.data.username || auth.data.email || "admin"} />;
}
