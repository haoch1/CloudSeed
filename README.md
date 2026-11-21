# CloudSeed

轻量、自托管的 Cloudflare DNS 与 R2 对象存储管理面板。基于 Cloudflare 官方开源设计系统 [Kumo](https://github.com/cloudflare/kumo) 构建，提供中文控制台、深浅色主题、多账号切换与 Docker 一键部署。

[![CloudSeed Docker](https://github.com/haoch1/CloudSeed/actions/workflows/docker.yml/badge.svg)](https://github.com/haoch1/CloudSeed/actions/workflows/docker.yml)
· [镜像包 (GHCR)](https://github.com/haoch1/CloudSeed/pkgs/container/cloudseed)
· [构建记录](https://github.com/haoch1/CloudSeed/actions/workflows/docker.yml)

---

## 功能特性

### 多账号与安全
- **多账号管理**：集中管理多个 Cloudflare 账号，支持随时切换并分别检测 DNS 与 R2 连通性。
- **凭据加密存储**：API Token 与 R2 S3 密钥采用 AES-256-GCM 加密保存在本地 SQLite 中，接口绝不回传明文密钥。
- **会话与审计**：支持自定义面板登录有效期（默认 30 天）、修改密码后使全部会话失效，以及跨分页全文检索操作记录。

### DNS 管理
- **完整记录支持**：自动拉取账号下所有域名与分页记录，支持 A、AAAA、CNAME、MX、TXT、NS、PTR，以及 SRV、CAA、HTTPS、SVCB 等结构化 JSON 记录。
- **高效编辑与筛选**：行内快捷编辑、一键切换代理状态，支持按关键字、类型与代理状态组合筛选。
- **批量与导入导出**：支持批量删除、批量开关代理（单次最多 200 条），支持 JSON 导出与导入。

### R2 对象存储
- **浏览器直传与并发分片**：通过预签名 URL 直传 R2，支持拖拽与多文件上传；超过 32 MiB 自动启用 3 路并发分片上传，失败自动退避重试，上传完成后校验文件大小与任务标识。
- **文件管理与在线预览**：支持目录导航、新建文件夹、下载、批量删除、同账号同区域复制/移动（单文件最大 5 GiB）；支持图片、音视频、PDF 以及 1 MiB 以内的代码高亮、Markdown 和 CSV 表格预览。
- **分享与桶配置**：支持生成 15 分钟至 7 天临时下载链接、展示自定义域名直链，以及管理自定义域名绑定、`r2.dev` 公共访问、CORS 与生命周期规则。

### 免登录演示模式
启动服务后访问 `/demo/overview`（或点击登录页的 **演示模式**），即可免登录体验完整界面与交互。演示数据仅保存在当前浏览器会话中，点击 **重置演示** 或刷新即可恢复。

---

## 快速部署（Docker Compose）

预构建镜像为 `ghcr.io/haoch1/cloudseed:latest`（`linux/amd64`），需要 Docker Engine 与 Docker Compose v2。

```bash
mkdir -p CloudSeed && cd CloudSeed
curl -fsSL https://raw.githubusercontent.com/haoch1/CloudSeed/main/compose.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/haoch1/CloudSeed/main/.env.example -o .env
docker compose pull
docker compose up -d
docker compose logs cloudseed
```

默认监听 `127.0.0.1:3180`。首次启动会自动创建管理员（默认用户名 `admin`），随机初始密码会输出在启动日志中，并保存在数据卷 `/app/data/setup-token`。

如需在首次启动前自行指定管理员凭据，可在 `.env` 中配置（密码至少 12 位，仅在尚未初始化管理员时生效）：

```dotenv
CLOUDSEED_ADMIN_USERNAME=admin
CLOUDSEED_ADMIN_PASSWORD=请替换为至少12位的强密码
```

### 使用域名与 HTTPS 反向代理

在 `.env` 中配置实际访问地址并启用 `TRUST_PROXY`：

```dotenv
BIND_ADDRESS=127.0.0.1
APP_PORT=3180
PUBLIC_URL=https://cloudseed.example.com
TRUST_PROXY=true
```

将反向代理上游指向 `http://127.0.0.1:3180`，并正确转发 `Host` 与 `X-Forwarded-Proto`，修改 `.env` 后执行 `docker compose up -d` 生效。

### 升级与维护

```bash
# 拉取最新镜像并重启升级
docker compose pull && docker compose up -d

# 清理无用旧镜像
docker image prune -f

# 查看日志 / 停止服务
docker compose logs -f cloudseed
docker compose down
```

<details>
<summary>从源码本地构建镜像</summary>

```bash
cp .env.example .env
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

</details>

---

## Cloudflare 凭据配置

### 1. 创建 API Token

前往 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 创建自定义 Token，并按需授予以下权限：

| 功能范围 | 控制台权限路径 | 说明 |
| --- | --- | --- |
| 域名列表与校验 | `Zone → Zone → Read` | 必需（DNS 管理） |
| DNS 记录增删改查 | `Zone → DNS → Edit` | 必需（DNS 管理） |
| R2 存储桶与设置管理 | `Account → Workers R2 Storage → Edit` | 使用 R2 功能时必需 |

在 **Account Resources** 与 **Zone Resources** 中选择对应账号及需要管理的域名范围，复制账号的 32 位 **Account ID** 后在面板的 **设置 → 账号管理 → 添加账号** 中填写即可。

### 2. R2 S3 凭据

文件列表与传输使用 R2 S3 兼容接口（`*.r2.cloudflarestorage.com`）：
- **自动推导**：添加账号时，面板会自动验证 Token 并按 [Cloudflare 官方规则](https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token) 推导 S3 凭据（需该 Token 具备 R2 权限）。
- **手动填写**：若需使用独立 R2 密钥或自动推导不可用，可在添加/编辑账号时展开 **R2 S3 凭据**，填写在 R2 控制台 **Manage R2 API Tokens** 中创建的 `Access Key ID` 与 `Secret Access Key`。

### 3. 配置 R2 CORS（浏览器直传与文本预览）

使用浏览器上传或在线预览文本前，进入目标桶的 **设置 → CORS 跨域规则**，点击 **加入面板直传规则** 并保存。手动配置参考：

```json
{
  "rules": [
    {
      "id": "cloudseed",
      "allowed": {
        "origins": ["https://cloudseed.example.com"],
        "methods": ["GET", "HEAD", "PUT"],
        "headers": ["*"]
      },
      "exposeHeaders": ["ETag"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

> [!NOTE]
> 分片上传依赖响应头 `ETag`，请务必保留 `exposeHeaders: ["ETag"]`；若面板访问协议、域名或端口变更，需同步更新 `origins`。

---

## 数据与备份

容器数据持久化在命名卷 `cloudseed-data`（挂载路径 `/app/data`，本地开发默认 `./data`）：

| 文件 | 说明 |
| --- | --- |
| `cloudseed.sqlite`（及 `-wal` / `-shm`） | 管理员账号、会话、加密后的 Cloudflare 凭据、上传任务与操作记录 |
| `encryption.key` | AES-256-GCM 加密主密钥（**必须与数据库配套备份**） |
| `setup-token` | 首次启动自动生成的初始管理员密码 |

备份前请先执行 `docker compose down` 停止服务，再完整备份数据目录；若存在数据库但缺少 `encryption.key`，服务会拒绝启动以防数据损坏。

---

## 本地开发

环境要求：Node.js 24+ 及 npm。

```bash
npm ci
npm run dev       # 前端 http://127.0.0.1:5173，后端 http://127.0.0.1:3180
npm run typecheck # 类型检查
npm test          # 运行单元测试与集成测试
npm run build     # 构建前后端生产产物
npm start         # 启动生产服务（Express 托管前端与 API）
```

<details>
<summary>环境变量参考</summary>

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | 本地 `127.0.0.1`，容器 `0.0.0.0` | 服务监听地址 |
| `PORT` | `3180` | 服务监听端口 |
| `DATA_DIR` | 本地 `data`，容器 `/app/data` | SQLite 与密钥存储目录 |
| `PUBLIC_URL` | 空 | 面板实际访问 URL，用于来源校验 |
| `TRUST_PROXY` | `false` | 单层可信反向代理后设为 `true` |
| `CLOUDSEED_ADMIN_USERNAME` | `admin` | 首次启动初始化管理员用户名 |
| `CLOUDSEED_ADMIN_PASSWORD` | 自动生成 | 首次启动初始化管理员密码（至少 12 位） |

</details>

---

## 常见问题

<details>
<summary>上传提示网络错误、CORS 错误或缺少 ETag</summary>

请在目标桶的 **设置 → CORS 跨域规则** 中加入当前浏览器访问的面板来源（包含协议与端口、不含末尾斜杠），并确保允许 `GET`、`HEAD`、`PUT` 方法且 `exposeHeaders` 包含 `ETag`。

</details>

<details>
<summary>反向代理后提示“请求来源与面板地址不匹配”</summary>

请检查 `.env` 中的 `PUBLIC_URL` 是否与浏览器实际访问地址完全一致，同时确认反向代理已正确转发 `Host`、`X-Forwarded-Proto` 且 `TRUST_PROXY=true`。

</details>

<details>
<summary>能看到 R2 存储桶，但打开文件列表返回 AccessDenied</summary>

存储桶列表使用 Cloudflare REST API，文件操作使用 R2 S3 接口。请检查账号配置中的 R2 S3 凭据是否属于当前账号，以及是否对目标桶拥有读写权限。

</details>

---

## 技术栈

React 19 · TypeScript · Vite · Cloudflare Kumo · TanStack Query · Express 5 · Node.js SQLite · AWS SDK v3
