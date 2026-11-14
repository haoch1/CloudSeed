# CloudSeed

自托管的 Cloudflare DNS 与 R2 管理面板。使用 Cloudflare 官方开源 Kumo 组件库，提供中文控制台、浅色与深色模式、响应式导航和 Docker Compose 部署。

## 直接体验演示

服务启动后，打开 `/demo/overview` 即可免登录查看带有示例账号、域名和 R2 文件的完整界面。本地地址为 `http://127.0.0.1:3180/demo/overview`，登录页面也提供“演示模式”入口。

可以体验 DNS 记录编辑、代理切换、R2 目录导航、上传、预览、分享和删除。演示数据及修改保存在当前页面会话中，刷新页面会重置。演示中的文件链接适用于当前浏览器会话。

## 功能

### 账号与面板

- 添加、编辑、切换多个 Cloudflare 账号，分别验证 DNS 和 R2 连接。
- 用户名与密码登录、退出和修改密码。会话有效期为 12 小时，修改密码后全部会话失效。
- API Token 与 R2 S3 密钥采用 AES-256-GCM 加密存储。接口返回账号名称、Account ID 和配置状态。
- 记录资源修改、上传、删除和失败操作，按页查看操作结果。

### DNS 管理

- 读取账号下的全部域名及 DNS 记录，自动处理 API 分页。
- 新增、编辑和删除记录，设置 TTL、代理状态、MX 优先级及备注。
- 支持 A、AAAA、CNAME、MX、TXT、NS、PTR，以及使用结构化 JSON 编辑的 SRV、CAA、HTTPS、SVCB 等类型。
- 按名称、内容、备注、记录类型和代理状态筛选。
- 批量删除和切换代理状态，每次最多 200 条。
- 导出 JSON，导入包含 1–200 条记录的 JSON 数组。导入操作会新增记录。

### R2 管理

- 查看已有存储桶、管理桶设置和删除空桶
- 目录导航、对象列表分页、当前页文件筛选、新建文件夹。
- 拖拽上传、选择多文件，显示真实上传进度
- 浏览器通过预签名 URL 直传 R2。大于 32 MiB 的文件采用分片上传，单分片失败自动重试最多 3 次。
- 支持取消和失败后重新上传，上传完成后校验对象大小和上传任务标识
- 下载、批量删除、同账号同管辖区域复制和移动文件。复制和移动的单文件上限为 5 GiB。
- 预览图片、音视频、PDF，以及 1 MiB 以内的文本与代码。支持代码高亮、Markdown 预览和 CSV 表格视图。
- 生成 15 分钟、1 小时、24 小时或 7 天有效的下载分享链接。
- 文件预览与分享窗口显示已绑定的自定义域直链，支持复制链接
- 绑定和解绑自定义域名、切换 r2.dev 公共访问，编辑 CORS 与生命周期规则。

## 项目命名

| 项目项                          | 名称                       |
| ------------------------------- | -------------------------- |
| 项目目录、页面名称              | `CloudSeed`                |
| npm 包                          | `cloudseed`                |
| Docker Compose 项目、服务、容器 | `cloudseed`                |
| Docker 镜像                     | `ghcr.io/haoch1/cloudseed` |
| Node 服务进程标题               | `cloudseed`                |
| Docker 数据卷                   | `cloudseed-data`           |
| SQLite 数据库                   | `cloudseed.sqlite`         |

Windows 任务管理器中的可执行文件映像名称由 Node.js 决定，服务会设置 `process.title` 为 `cloudseed`。

## 环境要求

Docker 部署需要 Docker Engine 与 Docker Compose v2。本地开发需要 Node.js 24 或更高版本及 npm。服务器需要能访问 `api.cloudflare.com`，使用浏览器的设备需要能访问对应 R2 S3 域名。

## Docker 部署

公开镜像为 `ghcr.io/haoch1/cloudseed:latest`，支持 `linux/amd64` 架构。

在服务器执行以下命令，下载部署配置并启动服务

```bash
mkdir -p CloudSeed
cd CloudSeed
curl -fsSL https://raw.githubusercontent.com/haoch1/CloudSeed/main/compose.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/haoch1/CloudSeed/main/.env.example -o .env
docker compose pull
docker compose up -d
docker compose logs cloudseed
```

默认在 `127.0.0.1:3180` 提供服务，网页使用用户名和密码登录

`.env` 中的 `CLOUDSEED_IMAGE` 用于选择镜像，默认 `latest`，也可以填写 `ghcr.io/haoch1/cloudseed:sha-<完整提交 SHA>` 或 `ghcr.io/haoch1/cloudseed@sha256:<镜像摘要>` 固定版本

首次启动自动创建管理员，默认用户名为 `admin`。初始密码随机生成，通过 `docker compose logs cloudseed` 查看。未手动配置密码时，初始密码也保存在数据卷的 `/app/data/setup-token`。

```text
cloudseed 已启动 http://0.0.0.0:3180
初始用户名 admin
初始密码 <本实例随机生成的初始密码>
```

也可以在首次启动前，通过 `.env` 自行指定登录凭据。密码至少 12 个字符。

```dotenv
CLOUDSEED_ADMIN_USERNAME=admin
CLOUDSEED_ADMIN_PASSWORD=请替换为你自己的长密码
```

登录后进入 **设置 → 管理员密码** 修改密码。初始化环境变量仅在尚未创建管理员时生效。已有版本的管理员邮箱可继续作为用户名登录。

### 使用域名与 HTTPS

在 `.env` 中填写实际面板地址，并按服务器的反向代理配置设置 `TRUST_PROXY`。

```dotenv
BIND_ADDRESS=127.0.0.1
APP_PORT=3180
PUBLIC_URL=https://cloudseed.example.com
TRUST_PROXY=true
```

将可信 HTTPS 反向代理的上游指向 `http://127.0.0.1:3180`，转发正确的 `Host` 和 `X-Forwarded-Proto`。修改 `.env` 后重新执行 `docker compose up -d`。通过 HTTPS 登录时，会话 Cookie 会带上 `Secure` 标记。

若需要直接通过服务器端口访问，将 `BIND_ADDRESS` 改为服务器实际监听地址，例如 `0.0.0.0`，将 `PUBLIC_URL` 设置为浏览器使用的完整访问地址。服务器防火墙需放行选定端口。

### 日常维护命令

```bash
docker compose ps
docker compose logs -f cloudseed
docker compose restart cloudseed
docker compose pull
docker compose up -d
docker compose down
```

数据库、密钥和初始凭据保存在命名卷 `cloudseed-data` 中，普通重建或 `docker compose down` 会保留数据。`docker compose down -v` 会删除卷及其中的数据。

### 从源码构建镜像

下载完整源码后，在项目目录执行

```bash
cp .env.example .env
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

源码构建使用本机镜像 `cloudseed:local`，服务、容器和数据卷名称与预构建镜像部署相同

### GitHub 自动构建

推送到 `main`、推送 `v*` 版本标签或在 Actions 中手动运行 **CloudSeed Docker** 时，GitHub 会先执行测试和前后端构建，再构建两种架构的 Docker 镜像并推送到 GHCR

- `latest` 对应默认分支的镜像
- `sha-<完整提交 SHA>` 对应指定源码提交的镜像
- 推送 `v1.2.3` 这样的 Git 标签后，会生成 `1.2.3` 镜像标签
- 工作流发布后会启动容器，验证健康检查、网页响应和用户名密码登录
- 拉取请求会执行测试与构建检查

工作流使用仓库自带的 `GITHUB_TOKEN` 发布镜像，需要 `contents: read` 和 `packages: write` 权限

[源码仓库](https://github.com/haoch1/CloudSeed) · [镜像包](https://github.com/haoch1/CloudSeed/pkgs/container/cloudseed) · [构建记录](https://github.com/haoch1/CloudSeed/actions/workflows/docker.yml)

## Cloudflare API 权限配置

### 1. 准备 Account ID

登录 Cloudflare，进入目标账号的 R2 概览或账号首页，复制 **Account ID**。它是 32 位十六进制字符串。每个连接对应一个 Cloudflare Account ID。

### 2. 创建用于面板的 API Token

进入用户资料的 API Tokens，选择创建自定义 Token。也可以从编辑 Zone DNS 模板开始，再添加 R2 权限。[API Token 页面](https://dash.cloudflare.com/profile/api-tokens)

完整使用本面板需要以下权限。Cloudflare 控制台的 `Edit` 与 API 文档中的 `Write` 表示对应的写权限。

| 功能                                                     | 控制台中选择的权限                    | API 权限名称               |
| -------------------------------------------------------- | ------------------------------------- | -------------------------- |
| 列出域名、读取域名详情、验证域名所属账号                 | `Zone → Zone → Read`                  | `Zone Read`                |
| 读取、新增、修改、删除、批量操作 DNS 记录                | `Zone → DNS → Edit`                   | `DNS Write`                |
| 列出存储桶、删除空桶、管理对象、CORS、生命周期和域名绑定 | `Account → Workers R2 Storage → Edit` | `Workers R2 Storage Write` |

在资源范围中设置。

- **Account Resources** 选择目标 Cloudflare 账号。
- **Zone Resources** 选择该账号下需要管理的域名。需要管理全部域名时，选择相应账号下的所有 Zone。
- 为每个要连接的账号配置匹配的 Token 与资源范围。

仅使用 DNS 管理时，配置前两项即可，R2 页面会显示相应权限错误。需要管理完整 R2 功能时，加入账号级 R2 写权限。Token 可以设置到期时间，过期后可在 **设置 → 账号管理** 中替换。

权限以当前 Cloudflare 官方文档为准。[DNS API](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/) · [R2 认证与权限](https://developers.cloudflare.com/r2/api/tokens/)

### 3. 启用 R2

进入 Cloudflare 账号的 R2 Object Storage 页面，按控制台引导启用 R2 服务。Cloudflare 可能要求绑定付款方式。确认账号已经启用服务后，再验证面板中的 R2 连接。

### 4. 配置 R2 S3 凭据

面板文件传输使用 R2 的 S3 兼容接口。该接口连接 `*.r2.cloudflarestorage.com`。

添加账号时，面板会尝试验证当前 Token，并按 Cloudflare 官方规则推导 S3 凭据。

- Access Key ID 使用 Token 的 `id`。
- Secret Access Key 使用 Token 值的 SHA-256 哈希。

该 Token 仍需要具备对应资源的 R2 权限。若自动推导失败，可以在添加或编辑账号时展开 **R2 S3 凭据**，手动填写密钥。[官方推导规则](https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token)

手动生成步骤如下。

1. 在 R2 概览中打开 **Manage R2 API Tokens**。
2. 创建 Account API Token 或 User API Token。
3. 仅需要操作特定桶的文件时，可以选择 **Object Read & Write**，并指定桶范围。需要完整桶管理时，使用 **Admin Read & Write**。
4. 创建后复制 **Access Key ID** 与 **Secret Access Key**。Secret Access Key 仅展示一次。
5. 在面板的 **设置 → 账号管理** 中成对填写两个字段，保存后打开 R2 文件列表验证。

手动填写的 S3 凭据负责文件操作，账号表单里的 Cloudflare API Token 负责 DNS 和 R2 桶配置。仅有 Object Read & Write 的 S3 凭据时，桶配置仍取决于 Cloudflare API Token 的账号级 R2 权限。[R2 权限说明](https://developers.cloudflare.com/r2/api/tokens/)

### 5. 在面板中添加账号

打开 **设置 → 账号管理 → 添加账号**，填写账号名称、Account ID 和 Cloudflare API Token，按需填写 S3 凭据，然后点击 **验证并添加**。添加完成后，使用 **验证连接** 分别检查 DNS 和 R2 权限。

编辑已有账号时，Token 留空会保留原值。更换 Token 后，面板会重新尝试推导 S3 凭据。

## 使用教程

### DNS 记录

1. 从左上角切换到目标账号。
2. 打开 **DNS 管理**，选择域名。
3. 点击 **添加记录**，填写类型、名称、内容、TTL 和代理状态。
4. 名称可填写 `@`、相对名称 `www` 或完整域名 `www.example.com`。
5. A、AAAA、CNAME 可切换代理。MX、TXT 等类型使用仅 DNS。
6. 勾选记录后，可批量删除或修改代理状态。修改提交成功后，DNS 实际传播仍需要时间。

导出文件可以直接用于导入。导入会创建新记录，提交前请核对目标域名和记录数量。示例文件内容如下。

```json
[
  {
    "type": "A",
    "name": "www.example.com",
    "content": "192.0.2.10",
    "ttl": 1,
    "proxied": true,
    "comment": "网站入口"
  },
  {
    "type": "MX",
    "name": "example.com",
    "content": "mail.example.com",
    "priority": 10,
    "ttl": 3600
  }
]
```

### R2 浏览器上传与 CORS

上传或预览文本前，打开目标桶的 **设置 → CORS 跨域规则**，点击 **加入面板直传规则**，核对后保存。这会在现有配置中加入当前面板来源，并保留其他规则。编辑器保存的是完整规则集合。

手动配置示例如下。将来源替换为浏览器实际访问的面板地址，保留协议和端口，省略结尾斜杠。

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

保存后回到 **对象** 页面，通过上传按钮选择文件，或将文件拖入文件列表区域上传。同名对象会提示已存在。分片上传依赖 `ETag` 响应头，CORS 中需要保留该字段 [官方 CORS 说明](https://developers.cloudflare.com/r2/buckets/cors/)

取消或失败后，面板会尝试中止未完成的分片。失败任务的重试会重新上传该文件。离开对象页面会取消该页面的活动上传，浏览器关闭后重新选择文件上传。可以在生命周期规则中设置未完成分片的过期清理。

### R2 文件与分享

- 点击文件名预览，使用行尾按钮下载、分享、复制、移动和删除。
- 文件列表按前缀模拟文件夹，当前页搜索只筛选已加载的这一页对象。
- 复制和移动通过后端流式转发，使用目标对象不存在的条件写入，并保留对象元数据。移动先完成目标复制，再核对源对象 ETag 和修改时间后删除源文件。复制与删除是两个独立步骤，操作期间请避免其他程序同时改写源文件。
- 临时分享链接在有效期内可直接下载文件。该链接使用 R2 S3 域名。
- 删除存储桶前先清空对象，再在桶设置中输入完整桶名称确认。

### 自定义域名

1. 打开桶的 **设置 → 自定义域名 → 连接域名**。
2. 选择与桶同一个 Cloudflare 账号下的 Zone。
3. 填写访问域名，例如 `assets.example.com`，提交绑定。
4. 证书和域名状态需要一定时间生效，可刷新查看。

自定义域名和 r2.dev 公共访问会让相应地址下的对象可公开读取。临时分享链接独立使用 S3 域名，预签名 URL 适用于 S3 API 域名。[公开访问说明](https://developers.cloudflare.com/r2/buckets/public-buckets/) · [预签名 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

## R2 和 S3 接口的费用

使用 R2 的 S3 兼容接口没有额外接口开通费，实际存储和请求按 R2 用量计费。Standard 标准存储每月包含 10 GB-month 存储、100 万次 A 类和 1,000 万次 B 类操作，R2 出站流量免费。超出后分别为 $0.015/GB-month、$4.50/百万次 A 类、$0.36/百万次 B 类操作。以上为 2026-11-14 核对的官方价格。

列文件、上传和分片请求等会计入操作次数。Infrequent Access 低频存储有独立费率、数据取回费用与最低保存时长。具体账单以 Cloudflare 为准。[R2 官方价格](https://developers.cloudflare.com/r2/pricing/)

## 数据与备份

Docker 数据目录为 `/app/data`，本地运行默认使用项目下的 `data/`。

| 文件                                           | 内容                                               |
| ---------------------------------------------- | -------------------------------------------------- |
| `cloudseed.sqlite`                             | 管理员、会话、加密后的账号凭据、上传任务和操作记录 |
| `cloudseed.sqlite-wal`、`cloudseed.sqlite-shm` | SQLite 运行期间的事务文件                          |
| `encryption.key`                               | AES-256-GCM 加密密钥                               |
| `setup-token`                                  | 自动生成的初始管理员密码                           |

备份时先停止 `cloudseed` 服务，再复制完整数据目录或命名卷内容，完成后启动服务。恢复时将整套数据放回同名卷。数据库和 `encryption.key` 必须配套保存。启动时检测到已有数据库而密钥缺失会停止启动，等待恢复密钥。

## 本地开发

```bash
npm ci
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`，Vite 将 `/api` 代理到本机后端 `127.0.0.1:3180`，后端日志会显示首次创建的管理员用户名和密码

构建和运行生产版本。

```bash
npm run build
npm start
```

生产版本由 Express 同时提供前端静态文件和 API，访问 `http://127.0.0.1:3180`。

```bash
npm run typecheck
npm test
```

测试通过隔离的临时数据库和模拟 Cloudflare、R2 响应，验证凭据保护、认证、DNS PATCH、R2 区域和上传完成校验。真实账号联调需要配置实际凭据。

后端支持以下环境变量。

| 变量          | 默认值                                | 用途                              |
| ------------- | ------------------------------------- | --------------------------------- |
| `HOST`        | 本地 `127.0.0.1`，Docker 内 `0.0.0.0` | 服务监听地址                      |
| `PORT`        | `3180`                                | 后端端口                          |
| `DATA_DIR`    | 本地 `data`，Docker 内 `/app/data`    | 数据目录                          |
| `PUBLIC_URL`  | 空                                    | 面板实际访问地址，用于来源校验    |
| `TRUST_PROXY` | `false`                               | 单层可信反向代理场景设置为 `true` |

## 常见问题

### DNS 能使用，R2 提示权限错误

检查账号是否启用了 R2，Cloudflare API Token 是否包含目标账号的 `Workers R2 Storage Write`。文件操作还需要匹配的 S3 凭据及桶范围。

### 能看到桶，文件列表返回 AccessDenied

桶列表使用 Cloudflare REST API，文件列表使用 R2 S3 接口，检查 S3 凭据是否属于当前账号、是否包含目标桶，以及访问端点是否与目标桶匹配

### 上传报网络错误或 CORS 错误

在桶设置中加入实际面板来源。域名、协议或端口变化后，需要同步修改 CORS。检查 PUT 方法、允许请求头和 `ETag` 响应头配置。

### 大文件上传提示缺少 ETag

在 CORS 的 `exposeHeaders` 中加入 `ETag`，保存后重新上传。

### 反向代理后提示请求来源不匹配

检查 `PUBLIC_URL` 是否与浏览器地址一致，可信代理是否正确设置 `Host`、`X-Forwarded-Proto` 和 `TRUST_PROXY`。应用会拒绝不匹配的跨站修改请求。

### 删除桶失败

先删除桶内对象，确认没有仍在写入的应用，再删除空桶。

## 技术栈

React、TypeScript、Vite、Cloudflare Kumo、TanStack Query、Express、Node.js SQLite、AWS SDK for JavaScript v3。
