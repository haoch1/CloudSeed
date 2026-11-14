import { Select } from "@cloudflare/kumo/components/select";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  PlusIcon,
  UploadSimpleIcon,
  FolderIcon,
  FileIcon,
  DownloadIcon,
  LinkIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  CaretRightIcon,
  DotsThreeIcon,
  CopyIcon,
  ArrowsLeftRightIcon,
  CheckCircleIcon,
  XIcon,
  CloudArrowUpIcon,
} from "@phosphor-icons/react";
import { api, formatBytes, formatDate, r2ObjectUrl } from "../api";
import { useAccount } from "../context";
import {
  Button,
  RefreshButton,
  Input,
  Text,
  PageHeader,
  EmptyState,
  ErrorState,
  Loading,
  Table,
  Modal,
  Confirm,
  Field,
  SubmitButton,
  submit,
  useAction,
  useToast,
} from "../ui";
import { uploadFile, type UploadTask } from "../upload";
import { BucketSettings } from "./r2/BucketSettings";
import type {
  Bucket,
  BucketDomain,
  ObjectItem,
  ObjectPage,
} from "../../shared/types";

const TextPreview = lazy(() => import("./r2/TextPreview"));

function ObjectLinks({
  base,
  jurisdiction,
  objectKey,
  request,
}: {
  base: string;
  jurisdiction: string;
  objectKey: string;
  request: typeof api;
}) {
  const domains = useQuery({
    queryKey: ["domains", base, jurisdiction],
    queryFn: ({ signal }) =>
      request<{ domains: BucketDomain[] }>(`${base}/domains/custom`, {
        signal,
      }),
  });
  const { pending, run } = useAction();
  const notify = useToast();
  const enabled = (domains.data?.domains ?? []).filter(
    (domain) => domain.enabled,
  );
  return (
    <section className="panel object-links">
      {domains.isPending ? (
        <Loading />
      ) : domains.error ? (
        <ErrorState
          error={domains.error}
          retry={() => void domains.refetch()}
        />
      ) : (
        <Table layout="fixed">
          <colgroup>
            <col style={{ width: 100 }} />
            <col />
          </colgroup>
          <Table.Header>
            <Table.Row>
              <Table.Head>类型</Table.Head>
              <Table.Head>URL</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {enabled.length ? (
              enabled.map((domain) => {
                const url = r2ObjectUrl(domain.domain, objectKey);
                return (
                  <Table.Row key={domain.domain}>
                    <Table.Cell className="muted">自定义域</Table.Cell>
                    <Table.Cell>
                      <div className="object-public-url">
                        <a href={url} target="_blank" rel="noreferrer">
                          <code>{url}</code>
                        </a>
                        <Button
                          type="button"
                          variant="ghost"
                          shape="square"
                          size="sm"
                          disabled={pending}
                          aria-label={`复制 ${domain.domain} 链接`}
                          onClick={() =>
                            run(async () => {
                              await navigator.clipboard.writeText(url);
                              notify("链接已复制");
                            })
                          }
                        >
                          <CopyIcon size={16} />
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              })
            ) : (
              <Table.Row>
                <Table.Cell className="muted">自定义域</Table.Cell>
                <Table.Cell className="muted">暂无可用的自定义域名</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}
    </section>
  );
}
function FilePreview({
  item,
  base,
  jurisdiction,
  request,
  onClose,
}: {
  item: ObjectItem;
  base: string;
  jurisdiction: string;
  request: typeof api;
  onClose: () => void;
}) {
  const [mediaError, setMediaError] = useState(false);
  const link = useQuery({
    queryKey: ["preview", base, jurisdiction, item.key],
    queryFn: () =>
      request<{
        url: string;
      }>(`${base}/link`, {
        method: "POST",
        body: { key: item.key },
      }),
    gcTime: 0,
  });
  const extension = item.key.split(".").at(-1)?.toLowerCase() || "";
  const isText = [
    "txt",
    "md",
    "markdown",
    "json",
    "csv",
    "tsv",
    "js",
    "ts",
    "tsx",
    "jsx",
    "css",
    "html",
    "xml",
    "yml",
    "yaml",
    "log",
    "toml",
    "sh",
    "py",
    "go",
    "rs",
    "sql",
    "conf",
    "ini",
    "bash",
    "zsh",
    "c",
    "cpp",
    "h",
    "swift",
    "kt",
  ].includes(extension);
  const isImage = [
    "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico",
  ].includes(extension);
  const isVideo = ["mp4", "webm", "mov", "m4v"].includes(extension);
  const isAudio = ["mp3", "wav", "ogg", "m4a", "flac"].includes(extension);
  const text = useQuery({
    queryKey: ["preview-text", base, jurisdiction, item.key],
    queryFn: async ({ signal }) => {
      let response: Response;
      try {
        response = await fetch(link.data!.url, { signal });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error("无法加载文件，请检查存储桶 CORS 和网络连接");
      }
      if (!response.ok) throw new Error(`预览加载失败 (${response.status})`);
      return response.text();
    },
    enabled: Boolean(link.data && isText && item.size <= 1024 ** 2),
    gcTime: 0,
  });
  return (
    <Modal
      title={item.key.split("/").at(-1) || item.key}
      onClose={onClose}
      wide
      className="file-preview-modal"
    >
      <div className="preview-meta">
        {formatBytes(item.size)}
        <span>{formatDate(item.lastModified)}</span>
      </div>
      <div className="preview-links">
        <ObjectLinks
          base={base}
          jurisdiction={jurisdiction}
          objectKey={item.key}
          request={request}
        />
      </div>
      <div className="preview-body">
        {link.isPending ? (
          <Loading />
        ) : link.error ? (
          <ErrorState error={link.error} />
        ) : isImage || isVideo || isAudio || extension === "pdf" ? (
          <div className="preview-frame">
            <div className="preview-toolbar">
              <div className="preview-toolbar-title">
                <FileIcon size={18} />
                {isImage
                  ? "图片预览"
                  : isVideo
                    ? "视频预览"
                    : isAudio
                      ? "音频预览"
                      : "PDF 预览"}
              </div>
              <a
                className="preview-open-link"
                href={link.data!.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                在新标签页打开
              </a>
            </div>
            {mediaError ? (
              <ErrorState error={new Error("文件加载失败，请检查网络或文件格式")} />
            ) : extension === "pdf" ? (
              <iframe
                className="preview-pdf"
                title="PDF 预览"
                sandbox="allow-scripts allow-same-origin allow-downloads"
                src={link.data!.url}
              />
            ) : (
              <div className={`preview-media-stage ${isAudio ? "is-audio" : ""}`}>
                {isImage ? (
                  <img
                    alt={item.key}
                    src={link.data!.url}
                    onError={() => setMediaError(true)}
                  />
                ) : isVideo ? (
                  <video
                    controls
                    preload="metadata"
                    src={link.data!.url}
                    onError={() => setMediaError(true)}
                  />
                ) : (
                  <audio
                    controls
                    preload="metadata"
                    src={link.data!.url}
                    onError={() => setMediaError(true)}
                  />
                )}
              </div>
            )}
          </div>
        ) : isText && item.size <= 1024 ** 2 ? (
          text.isPending ? (
            <Loading />
          ) : text.error ? (
            <ErrorState error={text.error} />
          ) : (
            <Suspense fallback={<Loading />}>
              <TextPreview text={text.data ?? ""} extension={extension} />
            </Suspense>
          )
        ) : (
          <EmptyState
            title="下载后查看此文件"
            description="文本预览支持 1 MiB 以内的文件"
          />
        )}
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  );
}
function CopyFile({
  item,
  base,
  buckets,
  move,
  request,
  onClose,
}: {
  item: ObjectItem;
  base: string;
  buckets: Bucket[];
  move: boolean;
  request: typeof api;
  onClose: () => void;
}) {
  const { pending, run } = useAction();
  const client = useQueryClient();
  return (
    <Modal
      title={move ? "移动文件" : "复制文件"}
      onClose={onClose}
      busy={pending}
    >
      <form
        onSubmit={(event) =>
          submit(event, (data) =>
            run(
              async () => {
                await request(`${base}/copy`, {
                  method: "POST",
                  body: {
                    key: item.key,
                    destinationKey: data.get("destinationKey"),
                    destinationBucket: data.get("destinationBucket"),
                    move,
                  },
                });
                await client.invalidateQueries({ queryKey: ["objects"] });
                onClose();
              },
              move ? "文件已移动" : "文件已复制",
            ),
          )
        }
      >
        <div className="modal-body form-stack">
          <div className="muted">源文件 {item.key}</div>
          <Field label="目标存储桶">
            <Select
              name="destinationBucket"
              aria-label="目标存储桶"
              defaultValue={buckets[0]?.name}
              required
            >
              {buckets.map((bucket) => (
                <Select.Option key={bucket.name} value={bucket.name}>
                  {bucket.name}
                </Select.Option>
              ))}
            </Select>
          </Field>
          <Input
            label="目标对象路径"
            name="destinationKey"
            required
            defaultValue={item.key}
            description="支持同账号、同管辖区域的存储桶，单文件最大 5 GiB"
          />
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            取消
          </Button>
          <SubmitButton pending={pending}>
            {move ? "移动" : "复制"}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
function ShareFile({
  item,
  base,
  jurisdiction,
  request,
  onClose,
}: {
  item: ObjectItem;
  base: string;
  jurisdiction: string;
  request: typeof api;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const { pending, run } = useAction();
  const notify = useToast();
  return (
    <Modal title="分享链接" onClose={onClose}>
      <form
        onSubmit={(event) =>
          submit(event, (data) =>
            run(async () => {
              const result = await request<{
                url: string;
              }>(`${base}/link`, {
                method: "POST",
                body: {
                  key: item.key,
                  expires: Number(data.get("expires")),
                  download: true,
                },
              });
              setUrl(result.url);
            }),
          )
        }
      >
        <div className="modal-body form-stack">
          <div className="break-all">{item.key}</div>
          <ObjectLinks
            base={base}
            jurisdiction={jurisdiction}
            objectKey={item.key}
            request={request}
          />
          <Field label="有效期">
            <Select
              name="expires"
              defaultValue="3600"
              aria-label="有效期"
              renderValue={(value) =>
                (
                  ({
                    "900": "15 分钟",
                    "3600": "1 小时",
                    "86400": "24 小时",
                    "604800": "7 天",
                  }) as Record<string, string>
                )[String(value)]
              }
            >
              <Select.Option value="900">15 分钟</Select.Option>
              <Select.Option value="3600">1 小时</Select.Option>
              <Select.Option value="86400">24 小时</Select.Option>
              <Select.Option value="604800">7 天</Select.Option>
            </Select>
          </Field>
          <Input
            label="临时链接"
            value={url}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            关闭
          </Button>
          <Button
            disabled={!url || pending}
            type="button"
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(url);
                notify("链接已复制");
              })
            }
          >
            复制链接
          </Button>
          <SubmitButton pending={pending}>生成链接</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
function Objects({
  base,
  bucket,
  jurisdiction,
  buckets,
  prefix,
  setPrefix,
  request,
}: {
  base: string;
  bucket: string;
  jurisdiction: string;
  buckets: Bucket[];
  prefix: string;
  setPrefix: (prefix: string) => void;
  request: typeof api;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<ObjectItem | null>(null);
  const [copying, setCopying] = useState<{
    item: ObjectItem;
    move: boolean;
  } | null>(null);
  const [sharing, setSharing] = useState<ObjectItem | null>(null);
  const [folder, setFolder] = useState(false);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const controllers = useRef(new Map<string, AbortController>());
  const client = useQueryClient();
  const notify = useToast();
  const { pending, run } = useAction();
  const query = new URLSearchParams({ prefix, ...(cursor ? { cursor } : {}) });
  const objects = useQuery({
    queryKey: ["objects", base, prefix, cursor],
    queryFn: ({ signal }) =>
      request<ObjectPage>(`${base}/objects?${query}`, { signal }),
  });
  useEffect(
    () => () => {
      controllers.current.forEach((controller) => controller.abort());
    },
    [],
  );
  useEffect(() => {
    setCursor(undefined);
    setHistory([]);
    setSelected(new Set());
  }, [prefix]);
  function updateTask(id: string, update: Partial<UploadTask>) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...update } : task)),
    );
  }
  async function startUploads(files: File[], retry?: UploadTask) {
    if (uploading) return;
    const next = retry
      ? [{ ...retry, status: "queued" as const, error: undefined, progress: 0 }]
      : files.map((file) => ({
          id: crypto.randomUUID(),
          file,
          key: `${prefix}${file.webkitRelativePath || file.name}`,
          progress: 0,
          status: "queued" as const,
        }));
    if (retry) updateTask(retry.id, next[0]);
    else setTasks((current) => [...current, ...next]);
    setUploading(true);
    const batchController = new AbortController();
    next.forEach((task) => controllers.current.set(task.id, batchController));
    for (const task of next) {
      if (batchController.signal.aborted) {
        updateTask(task.id, { status: "cancelled" });
        continue;
      }
      updateTask(task.id, { status: "uploading" });
      try {
        await uploadFile(
          base,
          task.file,
          task.key,
          false,
          batchController.signal,
          (progress) => updateTask(task.id, { progress }),
          request,
        );
        updateTask(task.id, { status: "done", progress: 100 });
      } catch (error) {
        updateTask(task.id, {
          status: batchController.signal.aborted ? "cancelled" : "failed",
          error: (error as Error).message,
        });
      } finally {
        controllers.current.delete(task.id);
      }
    }
    next.forEach((task) => controllers.current.delete(task.id));
    setUploading(false);
    await client.invalidateQueries({ queryKey: ["objects", base] });
  }
  const filteredObjects = (objects.data?.objects ?? []).filter(
    (item) =>
      item.key !== prefix &&
      item.key.toLowerCase().includes(search.toLowerCase()),
  );
  const folders = (objects.data?.folders ?? []).filter((item) =>
    item.toLowerCase().includes(search.toLowerCase()),
  );
  const items = [...folders, ...filteredObjects.map((item) => item.key)];
  const chosen = filteredObjects
    .filter((item) => selected.has(item.key))
    .map((item) => item.key);
  const parts = prefix.split("/").filter(Boolean);
  const objectPath = `${bucket}/${prefix}`;
  async function refresh() {
    setSelected(new Set());
    await client.invalidateQueries({ queryKey: ["objects", base] });
  }
  async function download(item: ObjectItem) {
    const result = await request<{
      url: string;
    }>(`${base}/link`, {
      method: "POST",
      body: { key: item.key, download: true },
    });
    const anchor = document.createElement("a");
    anchor.href = result.url;
    anchor.download = item.key.split("/").at(-1) || "download";
    anchor.rel = "noreferrer";
    anchor.click();
  }
  return (
    <div
      className="objects-workspace"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = uploading ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (uploading) return;
        void startUploads(Array.from(event.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="object-drop-overlay" role="status">
          <UploadSimpleIcon size={72} aria-hidden="true" />
          <span>{uploading ? "正在上传" : "松开以上传文件"}</span>
        </div>
      )}
      <div className="object-search">
        <div className="search-input">
          <MagnifyingGlassIcon size={18} />
          <Input
            aria-label="筛选当前页文件"
            placeholder="筛选当前页对象"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div className="file-toolbar">
        <nav className="object-breadcrumbs" aria-label="对象路径">
          <button onClick={() => setPrefix("")}>{bucket}</button>
          <span aria-hidden="true">/</span>
          {parts.map((part, index) => (
            <span key={index}>
              <button
                onClick={() =>
                  setPrefix(`${parts.slice(0, index + 1).join("/")}/`)
                }
              >
                {part}
              </button>
              <span aria-hidden="true">/</span>
            </span>
          ))}
          <button
            className="path-copy"
            aria-label="复制路径"
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(objectPath);
                notify("路径已复制");
              })
            }
          >
            <CopyIcon size={16} />
          </button>
        </nav>
        <div className="actions">
          {!uploadOpen && (
            <Button disabled={uploading} onClick={() => setUploadOpen(true)}>
              <UploadSimpleIcon size={18} />
              上传
            </Button>
          )}
          <Button variant="primary" onClick={() => setFolder(true)}>
            <PlusIcon size={18} />
            添加文件夹
          </Button>
          <RefreshButton
            aria-label="刷新文件"
            loading={objects.isFetching}
            onClick={() => void refresh()}
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void startUploads(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>
      </div>
      {uploadOpen && (
        <section className="panel upload-panel">
          <div className="upload-panel-heading">
            <Button
              variant="ghost"
              shape="square"
              size="sm"
              aria-label="关闭上传区域"
              onClick={() => setUploadOpen(false)}
            >
              <XIcon size={18} />
            </Button>
          </div>
          <div className="upload-drop-target">
            <UploadSimpleIcon size={128} aria-hidden="true" />
            <div>
              拖拽文件到此处，或
              <button
                className="text-link"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                从计算机中选择
              </button>
            </div>
          </div>
        </section>
      )}
      {tasks.length > 0 && (
        <div className="upload-queue panel">
          <div className="section-heading">
            <Text variant="heading" as="h2">
              上传任务{" "}
              <span className="muted">
                {tasks.filter((task) => task.status === "done").length}/
                {tasks.length}
              </span>
            </Text>
            {uploading ? (
              <Button
                size="sm"
                onClick={() =>
                  controllers.current.forEach((controller) =>
                    controller.abort(),
                  )
                }
              >
                取消上传
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setTasks([])}>
                清空记录
              </Button>
            )}
          </div>
          {tasks.map((task) => (
            <div className="upload-task" key={task.id}>
              {task.status === "done" ? (
                <CheckCircleIcon className="inline-good" size={18} />
              ) : (
                <FileIcon size={18} />
              )}
              <div>
                <strong className="ellipsis">{task.key}</strong>
                {task.status === "uploading" && (
                  <progress value={task.progress} max={100} />
                )}
                {task.error && task.status === "failed" && (
                  <small className="form-error">{task.error}</small>
                )}
              </div>
              <span className="muted">
                {task.status === "uploading"
                  ? `${Math.round(task.progress)}%`
                  : {
                      queued: "等待中",
                      done: "已完成",
                      failed: "失败",
                      cancelled: "已取消",
                    }[task.status]}
              </span>
              <Button
                className={
                  ["failed", "cancelled"].includes(task.status)
                    ? ""
                    : "reserved-action"
                }
                size="sm"
                disabled={uploading}
                onClick={() => void startUploads([], task)}
              >
                重试
              </Button>
            </div>
          ))}
        </div>
      )}
      <section className="panel">
        {chosen.length > 0 && (
          <div className="selection-bar">
            <strong>已选 {chosen.length} 个文件</strong>
            <Button
              size="sm"
              variant="secondary-destructive"
              onClick={() => setDeleting(chosen)}
            >
              删除所选
            </Button>
            <button
              className="text-link"
              onClick={() => setSelected(new Set())}
            >
              取消选择
            </button>
          </div>
        )}
        {objects.isPending ? (
          <Loading />
        ) : objects.error ? (
          <ErrorState
            error={objects.error}
            retry={() => void objects.refetch()}
          />
        ) : !items.length ? (
          <EmptyState title={search ? "没有匹配的文件" : "此目录为空"} />
        ) : (
          <div className="table-scroll">
            <Table layout="fixed" className="object-table">
              <colgroup>
                <col style={{ width: 44 }} />
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 220 }} />
                <col style={{ width: 80 }} />
              </colgroup>
              <Table.Header>
                <Table.Row>
                  <Table.CheckHead
                    label="选择当前页全部文件"
                    checked={
                      filteredObjects.length > 0 &&
                      filteredObjects.every((item) => selected.has(item.key))
                    }
                    indeterminate={
                      filteredObjects.some((item) => selected.has(item.key)) &&
                      !filteredObjects.every((item) => selected.has(item.key))
                    }
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked
                          ? new Set(filteredObjects.map((item) => item.key))
                          : new Set(),
                      )
                    }
                  />
                  <Table.Head>对象</Table.Head>
                  <Table.Head>大小</Table.Head>
                  <Table.Head>最后修改</Table.Head>
                  <Table.Head>
                    <span className="sr-only">操作</span>
                  </Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {folders.map((folder) => (
                  <Table.Row key={folder}>
                    <Table.Cell />
                    <Table.Cell>
                      <button
                        className="resource-link name-cell"
                        onClick={() => setPrefix(folder)}
                      >
                        <FolderIcon size={18} />
                        {folder.slice(prefix.length)}
                      </button>
                    </Table.Cell>
                    <Table.Cell>—</Table.Cell>
                    <Table.Cell>—</Table.Cell>
                    <Table.Cell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPrefix(folder)}
                      >
                        打开
                        <CaretRightIcon />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
                {filteredObjects.map((item) => (
                  <Table.Row
                    key={item.key}
                    variant={selected.has(item.key) ? "selected" : "default"}
                  >
                    <Table.CheckCell
                      label={`选择 ${item.key}`}
                      checked={selected.has(item.key)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(item.key);
                          else next.delete(item.key);
                          return next;
                        })
                      }
                    />
                    <Table.Cell>
                      <button
                        className="file-name"
                        onClick={() => setPreview(item)}
                      >
                        <span>{item.key.slice(prefix.length)}</span>
                      </button>
                    </Table.Cell>
                    <Table.Cell className="nowrap">
                      {formatBytes(item.size)}
                    </Table.Cell>
                    <Table.Cell className="nowrap muted">
                      {formatDate(item.lastModified)}
                    </Table.Cell>
                    <Table.Cell>
                      <DropdownMenu>
                        <DropdownMenu.Trigger
                          render={
                            <Button
                              variant="ghost"
                              shape="square"
                              size="sm"
                              aria-label={`${item.key} 更多操作`}
                            />
                          }
                        >
                          <DotsThreeIcon size={22} />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content align="end">
                          <DropdownMenu.Item
                            icon={DownloadIcon}
                            onClick={() => run(() => download(item))}
                          >
                            下载
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            icon={LinkIcon}
                            onClick={() => setSharing(item)}
                          >
                            分享链接
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            icon={CopyIcon}
                            onClick={() => setCopying({ item, move: false })}
                          >
                            复制
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            icon={ArrowsLeftRightIcon}
                            onClick={() => setCopying({ item, move: true })}
                          >
                            移动
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item
                            icon={TrashIcon}
                            variant="danger"
                            onClick={() => setDeleting([item.key])}
                          >
                            删除
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
        <div className="table-footer">
          <span>当前页 {items.length} 项</span>
          <div className="actions">
            <Button
              size="sm"
              disabled={!history.length}
              onClick={() => {
                setCursor(history.at(-1));
                setHistory((current) => current.slice(0, -1));
                setSelected(new Set());
              }}
            >
              上一页
            </Button>
            <Button
              size="sm"
              disabled={!objects.data?.cursor}
              onClick={() => {
                setHistory((current) => [...current, cursor]);
                setCursor(objects.data!.cursor);
                setSelected(new Set());
              }}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>
      {!uploadOpen && (
        <button className="upload-prompt" onClick={() => setUploadOpen(true)}>
          <CloudArrowUpIcon size={16} />
          拖放开始上传
        </button>
      )}
      {preview && (
        <FilePreview
          item={preview}
          base={base}
          jurisdiction={jurisdiction}
          request={request}
          onClose={() => setPreview(null)}
        />
      )}
      {sharing && (
        <ShareFile
          item={sharing}
          base={base}
          jurisdiction={jurisdiction}
          request={request}
          onClose={() => setSharing(null)}
        />
      )}
      {copying && (
        <CopyFile
          {...copying}
          base={base}
          request={request}
          buckets={buckets}
          onClose={() => setCopying(null)}
        />
      )}
      {deleting && (
        <Confirm
          title={
            deleting.length === 1 ? "要删除此文件吗？" : "要删除这些文件吗？"
          }
          className="file-delete-dialog"
          confirmText="删除"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const result = await request<{
              deleted: string[];
              errors: {
                key: string;
                error: string;
              }[];
            }>(`${base}/delete-objects`, {
              method: "POST",
              body: { keys: deleting },
            });
            await refresh();
            if (result.errors.length)
              throw new Error(
                `成功 ${result.deleted.length} 个，失败 ${result.errors.length} 个，${result.errors.map((item) => `${item.key} ${item.error}`).join("；")}`,
              );
            notify("文件已删除");
          }}
        >
          {deleting.length === 1 ? (
            <p>
              从 {bucket} 中删除 <strong>{deleting[0]}</strong> 是永久性的，无法撤销。
            </p>
          ) : (
            <>
              <p>
                从 {bucket} 中删除以下 {deleting.length} 个文件是永久性的，无法撤销。
              </p>
              <ul className="file-delete-list">
                {deleting.map((key) => (
                  <li key={key}>{key}</li>
                ))}
              </ul>
            </>
          )}
        </Confirm>
      )}
      {folder && (
        <Modal
          title="新建文件夹"
          onClose={() => setFolder(false)}
          busy={pending}
        >
          <form
            onSubmit={(event) =>
              submit(event, (data) =>
                run(async () => {
                  const name = String(data.get("name")).trim();
                  if (/[\\/]/.test(name))
                    throw new Error("文件夹名称不能包含斜杠");
                  await uploadFile(
                    base,
                    new File([], name),
                    `${prefix}${name}/`,
                    false,
                    new AbortController().signal,
                    () => {},
                    request,
                  );
                  await refresh();
                  setFolder(false);
                }, "文件夹已创建"),
              )
            }
          >
            <div className="modal-body">
              <Input label="文件夹名称" name="name" required maxLength={255} />
            </div>
            <div className="modal-footer">
              <Button type="button" onClick={() => setFolder(false)}>
                取消
              </Button>
              <SubmitButton pending={pending}>创建</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
export default function R2() {
  const { account } = useAccount();
  const [params, setParams] = useSearchParams();
  const bucket = params.get("bucket");
  const jurisdiction = params.get("jurisdiction") || "default";
  const prefix = params.get("prefix") || "";
  const tab = params.get("tab") || "objects";
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const collection = `/accounts/${account?.id}/r2/buckets`;
  const suffix = `jurisdiction=${encodeURIComponent(jurisdiction)}`;
  const request: typeof api = (path, options) =>
    api(withJurisdiction(path, jurisdiction), options);
  // 管辖区域作为路径查询参数追加，避免对象键与区域发生混淆
  const query = useQuery({
    queryKey: ["buckets", account?.id, jurisdiction],
    queryFn: ({ signal }) =>
      api<Bucket[]>(`${collection}?${suffix}`, { signal }),
    enabled: Boolean(account),
  });
  const base = `${collection}/${encodeURIComponent(bucket || "")}`;
  const filtered = (query.data ?? []).filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  function changeParams(values: Record<string, string>) {
    setParams({ ...Object.fromEntries(params), ...values });
  }
  if (!account)
    return (
      <>
        <PageHeader title="R2 对象存储" />
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
      {bucket ? (
        <div className="bucket-heading">
          <button
            className="text-link back-link"
            onClick={() => setParams({ jurisdiction })}
          >
            <ArrowLeftIcon size={16} />
            全部存储桶
          </button>
          <Text variant="heading" size="lg" as="h1">
            {bucket}
          </Text>
        </div>
      ) : (
        <PageHeader title="R2 对象存储" />
      )}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !bucket ? (
        <>
          <div className="resource-search">
            <div className="search-input">
              <MagnifyingGlassIcon />
              <Input
                aria-label="搜索存储桶"
                placeholder="搜索存储桶"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <RefreshButton
              aria-label="刷新存储桶"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            />
          </div>
          <section className="panel">
            {!filtered.length ? (
              <EmptyState title={search ? "暂无匹配的存储桶" : "暂无存储桶"} />
            ) : (
              <div className="table-scroll">
                <Table layout="fixed" className="buckets-table">
                  <colgroup>
                    <col />
                    <col style={{ width: 160 }} />
                    <col style={{ width: 220 }} />
                  </colgroup>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>存储桶名称</Table.Head>
                      <Table.Head>存储类别</Table.Head>
                      <Table.Head>创建时间</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {filtered.map((item) => (
                      <Table.Row key={item.name}>
                        <Table.Cell>
                          <button
                            className="resource-link name-cell"
                            onClick={() => changeParams({ bucket: item.name })}
                          >
                            {item.name}
                          </button>
                        </Table.Cell>
                        <Table.Cell>
                          {item.storage_class === "InfrequentAccess"
                            ? "低频存储"
                            : "标准存储"}
                        </Table.Cell>
                        <Table.Cell className="muted nowrap">
                          {formatDate(item.creation_date)}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
            <div className="table-footer">共 {filtered.length} 个存储桶</div>
          </section>
        </>
      ) : (
        <>
          <div className="resource-tabs">
            <Tabs
              labels={{
                scrollStart: "向左滚动标签",
                scrollEnd: "向右滚动标签",
              }}
              tabs={[
                { value: "objects", label: "对象" },
                { value: "settings", label: "设置" },
              ]}
              value={tab}
              onValueChange={(value) => changeParams({ tab: value })}
            />
          </div>
          {tab === "settings" ? (
            <BucketSettings
              key={`${base}-${jurisdiction}`}
              jurisdiction={jurisdiction}
              base={base}
              bucket={bucket}
              request={request}
              onDeleted={() => setParams({ jurisdiction })}
            />
          ) : (
            <Objects
              request={request}
              key={`${account.id}-${bucket}-${jurisdiction}`}
              base={base}
              bucket={bucket}
              jurisdiction={jurisdiction}
              buckets={query.data ?? []}
              prefix={prefix}
              setPrefix={(value) => changeParams({ prefix: value })}
            />
          )}
        </>
      )}
    </>
  );
}
// 子功能通过请求路径携带区域信息，后端统一从查询参数读取
export function withJurisdiction(path: string, jurisdiction: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}jurisdiction=${encodeURIComponent(jurisdiction)}`;
}
