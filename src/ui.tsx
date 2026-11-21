import {
  Component,
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Button,
  RefreshButton as KumoRefreshButton,
} from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Collapsible } from "@cloudflare/kumo/components/collapsible";
import { Input as KumoInput } from "@cloudflare/kumo/components/input";
import { Table } from "@cloudflare/kumo/components/table";
import { Switch } from "@cloudflare/kumo/components/switch";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Text } from "@cloudflare/kumo/components/text";
import {
  XIcon,
  WarningCircleIcon,
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CaretDownIcon,
} from "@phosphor-icons/react";

export { Button, Table, Switch, Text };

export function Input({
  passwordManagerIgnore = true,
  ...props
}: ComponentProps<typeof KumoInput>) {
  return <KumoInput {...props} passwordManagerIgnore={passwordManagerIgnore} />;
}

export function FormDisclosure({
  label,
  defaultOpen = false,
  accessory,
  children,
}: {
  label: ReactNode;
  defaultOpen?: boolean;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root className="form-disclosure" defaultOpen={defaultOpen}>
      <div className="form-disclosure-header">
        <Collapsible.Trigger type="button" className="form-disclosure-trigger">
          <CaretDownIcon size={14} aria-hidden="true" />
          {label}
        </Collapsible.Trigger>
        {accessory}
      </div>
      <Collapsible.Panel
        className="form-disclosure-panel form-stack"
        keepMounted
      >
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

const refreshDuration = 1200;

export function RefreshButton({
  loading = false,
  disabled,
  onClick,
  ...props
}: ComponentProps<typeof KumoRefreshButton>) {
  const [spinning, setSpinning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <KumoRefreshButton
      {...props}
      style={
        {
          ...props.style,
          "--animate-refresh": `refresh ${refreshDuration}ms linear infinite`,
        } as CSSProperties
      }
      loading={loading || spinning}
      disabled={disabled || loading || spinning}
      aria-busy={loading || spinning}
      onClick={(event) => {
        setSpinning(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setSpinning(false), refreshDuration);
        onClick?.(event);
      }}
    />
  );
}

const ToastContext = createContext<(message: string, error?: boolean) => void>(
  () => {},
);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<
    { id: number; message: string; error: boolean }[]
  >([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setMessages((current) => current.filter((item) => item.id !== id));
  }, []);
  const notify = useCallback(
    (message: string, error = false) => {
      const id = Date.now() + Math.random();
      setMessages((current) => {
        const next = [...current, { id, message, error }];
        if (next.length > 5) {
          for (const dropped of next.slice(0, next.length - 5)) {
            const droppedTimer = timers.current.get(dropped.id);
            if (droppedTimer !== undefined) {
              clearTimeout(droppedTimer);
              timers.current.delete(dropped.id);
            }
          }
          return next.slice(-5);
        }
        return next;
      });
      const timer = setTimeout(() => dismiss(id), error ? 10000 : 4000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" aria-live="polite">
        {messages.map((item) => (
          <div
            key={item.id}
            className={`toast ${item.error ? "toast-error" : ""}`}
          >
            {item.error ? (
              <WarningCircleIcon size={20} />
            ) : (
              <CheckCircleIcon size={20} />
            )}
            <span>{item.message}</span>
            <button
              aria-label="关闭通知"
              onClick={() => dismiss(item.id)}
            >
              <XIcon />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useAction() {
  const notify = useToast();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const run = useCallback(
    async (operation: () => Promise<void>, success?: string) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      try {
        await operation();
        if (success) notify(success);
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "操作失败，请重试",
          true,
        );
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [notify],
  );
  return { pending, run };
}

export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: { resetKey?: string }) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  render() {
    if (this.state.error) {
      return (
        <div className="panel">
          <ErrorState
            error={new Error("页面加载出现异常，请重试或刷新页面")}
            retry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  busy = false,
  className,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog size={wide ? "xl" : "lg"} className={`modal ${className ?? ""}`}>
        <div className="modal-heading">
          <Dialog.Title render={<Text variant="heading" size="lg" as="h2" />}>
            {title}
          </Dialog.Title>
          <Button
            variant="secondary"
            shape="square"
            aria-label="关闭对话框"
            disabled={busy}
            onClick={onClose}
          >
            <XIcon size={18} />
          </Button>
        </div>
        {children}
      </Dialog>
    </Dialog.Root>
  );
}

export function Confirm({
  title,
  children,
  confirmText = "确认删除",
  confirmation,
  onConfirm,
  onClose,
  className,
}: {
  title: string;
  children: ReactNode;
  confirmText?: string;
  confirmation?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  className?: string;
}) {
  const [input, setInput] = useState("");
  const { pending, run } = useAction();
  return (
    <Modal title={title} onClose={onClose} busy={pending} className={className}>
      <div className="modal-body">
        <div className="muted">{children}</div>
        {confirmation && (
          <Input
            label={`输入 ${confirmation} 确认`}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
          />
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose} disabled={pending}>
          取消
        </Button>
        <Button
          variant="destructive"
          disabled={pending || Boolean(confirmation && input !== confirmation)}
          onClick={() =>
            run(async () => {
              await onConfirm();
              onClose();
            })
          }
        >
          <ActionLabel pending={pending}>{confirmText}</ActionLabel>
        </Button>
      </div>
    </Modal>
  );
}

export function PageHeader({
  title,
  actions,
  eyebrow,
}: {
  title: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="breadcrumbs">{eyebrow}</div>}
        <Text variant="heading" size="lg" as="h1">
          {title}
        </Text>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Empty
      className="empty-state"
      title={title}
      description={description}
      contents={action}
    />
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <WarningCircleIcon size={22} />
      <div>{error instanceof Error ? error.message : "加载失败"}</div>
      {retry && (
        <Button size="sm" onClick={retry}>
          <ArrowClockwiseIcon />
          重试
        </Button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      正在加载…
    </div>
  );
}
export function SubmitButton({
  pending,
  children = "保存",
}: {
  pending: boolean;
  children?: ReactNode;
}) {
  return (
    <Button
      variant="primary"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      <ActionLabel pending={pending}>{children}</ActionLabel>
    </Button>
  );
}
function ActionLabel({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <span className="button-label" data-pending={pending}>
      <span className="button-label-idle" aria-hidden={pending}>
        {children}
      </span>
      <span className="button-label-pending" aria-hidden={!pending}>
        处理中…
      </span>
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
export function Status({ value }: { value: string }) {
  const good = ["active", "success", "connected", "enabled"].includes(value);
  const labels: Record<string, string> = {
    active: "正常",
    pending: "待生效",
    success: "成功",
    failed: "失败",
    partial: "部分完成",
    moved: "迁移中",
    deactivated: "已停用",
  };
  return (
    <span
      className={`status ${good ? "status-good" : ["failed", "deactivated"].includes(value) ? "status-bad" : "status-neutral"}`}
    >
      <span />
      {labels[value] || value}
    </span>
  );
}
export function submit(event: FormEvent, callback: (data: FormData) => void) {
  event.preventDefault();
  callback(new FormData(event.currentTarget as HTMLFormElement));
}
