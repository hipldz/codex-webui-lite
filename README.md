# Codex Web Harness

一个运行在本机的轻量 Codex Web UI。浏览器通过 HTTP API 和增量轮询连接 Node 服务，Node 再通过 stdio JSON-RPC 管理常驻的 `codex app-server`。

Codex 的登录状态、配置和 session 仍由 Codex 自己管理；Web UI 不读取或保存 Codex 凭据。

## 功能

- 从 app-server 分页加载本机 Codex CLI、VS Code、exec、app-server 和 sub-agent sessions
- 创建、恢复、Branch、归档、取消归档、批量操作和删除 session
- 当前 session 写入 `?session=<id>`，刷新页面后自动恢复
- 创建新对话前从当前用户 home 中选择 workspace；已有 session 自动恢复自己的 workspace
- 从真实 `model/list` 读取模型与 reasoning effort
- 流式显示回答、thinking、命令、文件修改、工具调用、网页搜索、图片、hook、子 agent、review、计划更新与警告
- AI 回复在浏览器端渲染 Markdown/GFM，支持表格、任务列表、删除线与代码块
- 每轮活动汇总为可展开的时间线；保留文件/命令摘要和历史 context compact 记录
- Composer 可选择会话权限：按需确认、Full access（无 sandbox / 无审批）或只读；设置会作用于后续 turn
- 可在输入框粘贴或选择任意类型文件作为附件；图片支持点击预览，所有附件均会在会话中保留并可下载
- 输入框附件单条消息最多 4 个，单个文件和所有附件合计均限制为 10 MB；附件直接保存在当前 thread 的 workspace `.files/<thread.id>/`，每轮会把具体文件路径告诉 Codex；文本、图片和音频也会直接传入模型，其他二进制文件可由 Codex 按路径读取
- 文件树、文本文件创建/删除、预览、编辑与下载；支持向 workspace 目录上传文件
- 按文件查看 Changes/Diff
- 显示 context window、实时内存占用，以及独立的 5-hour / Weekly account usage 窗口
- 支持部署在 `/codex/` 之类的反向代理子路径；不要求 WebSocket 反代

## 目录说明

| 路径           | 用途                               | 是否手工修改   |
| -------------- | ---------------------------------- | -------------- |
| `src/`         | React/TSX 前端源码                 | 是             |
| `server/`      | Node/TypeScript 服务端源码         | 是             |
| `public/`      | 原样复制的静态资源                 | 是             |
| `scripts/`     | Playwright 验证脚本                | 是             |
| `dist/`        | Vite 生成的前端生产文件            | 否，可删除重建 |
| `dist-server/` | TypeScript 生成的服务端 JavaScript | 否，可删除重建 |

`server/` 与 `dist-server/` 不是两套源码：

```text
server/*.ts  -- npm run build -->  dist-server/*.js
src/*        -- npm run build -->  dist/*
```

仓库只维护 `src/` 和 `server/`。`dist/`、`dist-server/` 已加入 `.gitignore`，不要直接编辑或提交。当前生成目录被删除是正常的，执行 `npm run build` 会重新创建。

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- 已安装且可直接执行的 `codex` CLI
- Codex 已完成登录或配置好可用的认证方式

检查：

```bash
node --version
codex --version
```

## 开发运行

开发模式不需要 `dist/` 或 `dist-server/`：

```bash
cd /home/pldz/local/codex-scripts/web-ui
npm install
npm run dev
```

默认打开：

```text
http://127.0.0.1:8765/
```

前端修改由 Vite 即时加载，后端入口通过 `tsx server/index.ts --dev` 运行。

## 会话权限

Codex 的会话权限是多个设置组合出来的，不是单一的“权限等级”：

- `sandbox_mode` 限定命令可访问的文件和网络范围：`read-only`、`workspace-write` 或 `danger-full-access`。
- `approval_policy` 决定哪些操作会暂停并进入审批：`on-request`、`never` 或按类别配置的 `granular`。
- `approvals_reviewer` 决定由谁审核符合条件的审批请求：`user`（默认）或 `auto_review`。`auto_review` 只改变审核者，不扩大 sandbox，也不会审核 sandbox 内已经允许的操作。

常用组合如下：

| 行为              | `sandbox_mode`       | `approval_policy` | `approvals_reviewer`    | 效果                                                                                  |
| ----------------- | -------------------- | ----------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| Ask for approval  | `workspace-write`    | `on-request`      | `user`                  | 在 workspace 内读写和运行常规命令；需要越过 sandbox 边界时向用户请求审批。            |
| Approve for me    | `workspace-write`    | `on-request`      | `auto_review`           | sandbox 边界与 Ask 相同；符合条件的审批请求交给自动 reviewer 审核。                   |
| Full access       | `danger-full-access` | `never`           | 通常不需要设置          | 不受 sandbox 限制，也不暂停等待审批。只用于可信环境。                                 |
| 受限自动执行      | `workspace-write`    | `never`           | 不适用                  | 在 workspace sandbox 范围内自动执行；需要越过边界时不会弹出审批，操作会被拒绝或失败。 |
| Read-only         | `read-only`          | `on-request`      | `user`                  | 默认只读；需要提升权限的操作可以请求用户审批。                                        |
| Granular approval | 任意 sandbox         | `granular` 对象   | `user` 或 `auto_review` | 分别决定不同类别的请求可否进入审批流程。                                              |

`never` 控制是否等待审批，不会解除 sandbox 限制；因此 `workspace-write + never` 不是 Full access。相反，`danger-full-access + on-request` 虽然可以组合，但因为没有 workspace sandbox 边界，不能把它当成“所有危险操作都会先问我”。官方将 Full access 定义为 `danger-full-access + never`。[Sandbox 与审批说明](https://developers.openai.com/codex/sandboxing)

如果只需要让 `workspace-write` 多写几个指定目录，可以用 `[sandbox_workspace_write].writable_roots` 扩展范围，并继续保留 sandbox；`network_access` 和临时目录选项也只调整该 sandbox 的边界，不会将它变成 Full access：

```toml
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
writable_roots = ["/srv/shared"]
network_access = false
```

### Ask for approval

这是常见的本地开发模式：

```toml
sandbox_mode = "workspace-write"
approval_policy = "on-request"
approvals_reviewer = "user"
```

### Approve for me

它与 Ask 使用相同 sandbox，只把符合条件的审批请求交给自动 reviewer；reviewer 可以审核并批准或拒绝请求，但不会扩大 sandbox 权限：

```toml
sandbox_mode = "workspace-write"
approval_policy = "on-request"
approvals_reviewer = "auto_review"
```

### 受限自动执行

适合不需要交互审批、但仍要限制在 workspace 范围内的任务：

```toml
sandbox_mode = "workspace-write"
approval_policy = "never"
```

### Read-only

```toml
sandbox_mode = "read-only"
approval_policy = "on-request"
approvals_reviewer = "user"
```

### Granular approval

`granular` 可以逐类允许或拒绝审批提示。某字段为 `true` 时，该类请求可以进入审批流程；为 `false` 时会自动拒绝，而不是弹窗。字段包括 sandbox 提权、命令规则、MCP elicitation、权限申请和 Skill 脚本审批：

```toml
sandbox_mode = "workspace-write"
approvals_reviewer = "user"
approval_policy = { granular = { sandbox_approval = true, rules = true, mcp_elicitations = false, request_permissions = true, skill_approval = true } }
```

`approval_policy = "untrusted"` 已不再是可直接选择的策略，`on-failure` 已弃用；旧配置应改用受支持的策略。项目的 `trust_level = "untrusted"` 是另一项设置，仍可用于项目级信任管理。[Codex 配置参考](https://developers.openai.com/codex/config-reference/)

Web UI 的权限菜单目前提供 **Ask when needed**、**Full access**、**Read-only** 和 **Use config.toml**，没有单独的 Approve for me 或 granular 按钮。页面会读取当前 workspace 的有效配置；命名权限方案、自动 reviewer、自定义 sandbox 规则、granular 策略或其他非标准组合应选择 **Use config.toml**，这样已有会话也会在发送下一条消息前应用配置。手动选择 Ask、Full 或 Read-only 时，则使用对应预设，并将 reviewer 设为 `user`。

要让页面默认显示并使用 **Full access**，在运行 Web 服务的同一用户的 `$CODEX_HOME/config.toml` 中（未设置 `CODEX_HOME` 时是 `~/.codex/config.toml`）设置：

```toml
approval_policy = "never"
sandbox_mode = "danger-full-access"
```

重启 Web 服务并重新载入页面。配置生效后，权限菜单应显示 **Full access**。若项目可信，也可以在 workspace 下的 `.codex/config.toml` 配置项目级默认。不要把 `default_permissions` 与旧式 `sandbox_mode` 或 `[sandbox_workspace_write]` 混用；使用命名权限方案时保留该方案，并在页面选择 **Use config.toml**。[Codex 配置参考](https://developers.openai.com/codex/config-reference/)

`Full access` 会允许 Codex 在当前运行账户的权限范围内执行命令。只应在本机、可信 workspace 和已理解任务影响时使用。

## 活动时间线与用量

- app-server 的结构化 item 会按 turn 显示；命令、读写文件、MCP/动态工具、网页搜索、图像、子 agent 和 review 都可展开查看详情。
- 计划、hook、模型 reroute、安全等待、警告和 context compact 显示为独立状态行；compact 记录会随 session 历史保留。
- 设置抽屉中的 account usage 会将 app-server 返回的 primary / secondary 窗口明确标为 **5-hour limit** 与 **Weekly limit**。认证方式未提供该接口时，面板显示 `Unavailable`。

## 生产运行

生产模式必须先构建：

```bash
cd /home/pldz/local/codex-scripts/web-ui
npm install
npm run build
npm start
```

`npm run build` 会同时生成：

- `dist/`：浏览器静态资源
- `dist-server/`：Node 可执行 JavaScript

`npm start` 只负责启动已有构建，不会自动重新 build。修改 `src/` 或 `server/` 后，需要再次执行 `npm run build`。

`npm start` 实际执行：

```bash
node --max-old-space-size=256 dist-server/index.js
```

如果希望少一个 npm 父进程，也可以在 build 后直接运行上面的 Node 命令。

### 2 核 2GB Linux 服务器

准备一个专用 Linux 用户，并确保该用户安装了符合要求的 Node.js、已登录 `codex` CLI，且有权访问项目目录和 workspace。Codex 登录信息必须属于运行 Web 服务的同一个用户。以下命令假设当前终端已切换到 `codex` 用户。

以下以项目位于 `/srv/codex-scripts/web-ui`、运行用户为 `codex` 为例：

```bash
cd /srv/codex-scripts/web-ui
npm ci
npm run build
mkdir -p /home/codex/workspace

export CODEX_WEB_HOST=127.0.0.1
export CODEX_WEB_PORT=8765
export CODEX_WEB_BASE_PATH=/codex
export CODEX_WEB_DEFAULT_WORKSPACE=/home/codex/workspace
export CODEX_WEB_AUTH='codex:替换为强密码'
npm start
```

先以前台方式确认服务正常。Node 默认只监听本机回环地址，外部访问应经过 Nginx HTTPS 反向代理；Basic Auth 不加密连接，不能用明文 HTTP 暴露到公网。Nginx 配置见本 README 的 [Nginx](#nginx) 一节。反向代理路径需与 `CODEX_WEB_BASE_PATH` 一致。

## 后台运行

项目提供 Linux/macOS shell 与 Windows PowerShell 两个生命周期脚本。它们直接启动 `dist-server/index.js`，关闭启动它们的终端后，Node 和自动创建的 `codex app-server` 仍会继续运行。

使用前必须完成一次生产构建：

```bash
npm run build
```

Linux/macOS：

```bash
./scripts/codex-web.sh start
./scripts/codex-web.sh status
./scripts/codex-web.sh logs
./scripts/codex-web.sh restart
./scripts/codex-web.sh stop
```

PowerShell：

```powershell
.\scripts\codex-web.ps1 start
.\scripts\codex-web.ps1 status
.\scripts\codex-web.ps1 logs
.\scripts\codex-web.ps1 restart
.\scripts\codex-web.ps1 stop
```

如果 Windows 阻止执行本地脚本，可以仅对本次命令放行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-web.ps1 start
```

脚本继承当前终端中的 `CODEX_WEB_*` 和 `CODEX_HOME` 环境变量。例如：

```bash
export CODEX_WEB_BASE_PATH=/codex
export CODEX_WEB_PORT=8765
./scripts/codex-web.sh start
```

```powershell
$env:CODEX_WEB_BASE_PATH = "/codex"
$env:CODEX_WEB_PORT = "8765"
.\scripts\codex-web.ps1 start
```

运行日志和 PID 保存在 `.run/`，该目录不会提交到 Git。`logs` 命令中的 `Ctrl+C` 只会退出日志查看，不会停止服务。

后台脚本能跨终端关闭继续运行，但不会在机器重启后自动恢复。需要开机自动启动时，可按下方 systemd 配置运行。

Linux systemd 示例（把项目路径、Node 路径和账户名换成服务器实际值）：

先创建 `/etc/codex-web.env`，并按 `command -v codex` 的结果调整 `PATH`，确保 systemd 能找到 Codex CLI：

```ini
CODEX_WEB_HOST=127.0.0.1
CODEX_WEB_PORT=8765
CODEX_WEB_BASE_PATH=/codex
CODEX_WEB_DEFAULT_WORKSPACE=/home/codex/workspace
CODEX_WEB_AUTH=codex:替换为强密码
CODEX_HOME=/home/codex/.codex
PATH=/home/codex/.local/bin:/usr/local/bin:/usr/bin:/bin
```

```bash
sudo chown root:root /etc/codex-web.env
sudo chmod 600 /etc/codex-web.env
```

创建 `/etc/systemd/system/codex-web.service`：

```ini
[Unit]
Description=Codex Web
After=network.target

[Service]
Type=simple
User=codex
Group=codex
WorkingDirectory=/srv/codex-scripts/web-ui
Environment=HOME=/home/codex
EnvironmentFile=/etc/codex-web.env
ExecStart=/usr/bin/node --max-old-space-size=256 /srv/codex-scripts/web-ui/dist-server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077
MemoryHigh=1400M
MemoryMax=1650M
CPUQuota=180%

[Install]
WantedBy=multi-user.target
```

`MemoryHigh` 会在服务进程组接近 1.4GB 时施加回收压力，`MemoryMax` 将 Web UI、Codex app-server 及其子进程限制在 1.65GB，为 2GB 主机上的系统进程留出约 400MB。`MemoryHigh`、`MemoryMax` 和 `CPUQuota` 需要 Linux cgroup/systemd 支持；若启动时报不认识这些属性，可移除对应配置项。

启用服务并查看日志：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codex-web
sudo systemctl status codex-web
sudo journalctl -u codex-web -f
```

修改代码后重新构建并重启：

```bash
cd /srv/codex-scripts/web-ui
npm run build
sudo systemctl restart codex-web
```

systemd 和 `scripts/codex-web.sh` 不要同时管理同一个实例。

## Workspace 与环境变量

所有变量都是可选的：

| 变量                          | 默认值      | 说明                                                                                                                  |
| ----------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `CODEX_WEB_HOST`              | `127.0.0.1` | Node 监听地址                                                                                                         |
| `CODEX_WEB_PORT`              | `8765`      | Node 监听端口                                                                                                         |
| `CODEX_WEB_BASE_PATH`         | `/`         | 页面及 HTTP API 的统一子路径                                                                                          |
| `CODEX_WEB_DEFAULT_WORKSPACE` | 未设置      | 启动时默认选中的 workspace 目录；目录不存在或不可用时忽略，仍需手动选择                                               |
| `CODEX_WEB_AUTH`              | 未启用      | 可选 Basic Auth，格式为 `username:password`                                                                           |
| `CODEX_HOME`                  | `~/.codex`  | Codex sessions、旧版 Web UI 附件缓存和 Codex 原始生成图片所在目录；新版输入框附件保存在 thread workspace 的 `.files/` |

页面会先加载最近 50 个本地 session；打开已有 session 时使用该 session 自己的 workspace。设置 `CODEX_WEB_DEFAULT_WORKSPACE` 后，新对话默认使用指定目录；未设置或目录无效时，从当前用户 home 中手动选择 workspace。

Composer 上传文件使用 app-server 返回的 `thread.id`（不是 `sessionId`）作为目录名，例如 `.files/<thread.id>/<message-id>-0-example.pdf`。恢复和分叉 session 后也按各自 thread 的 ID 和 cwd 定位；旧版 `.files/<thread.id>/uploads/` 和 `CODEX_HOME/attachments/codex-web/` 附件仍可读取。删除 thread 不会自动删除 workspace 下的 `.files/<thread.id>/`，以免误删其中的图片或其他工作文件。

Web UI 不会创建或修改 workspace 的 `AGENTS.md`。可按需将 [AGENTS.md.template](AGENTS.md.template) 的内容手动加入 `~/.codex/AGENTS.md`。每轮输入都会向 Codex 传入具体的 `.files/<thread.id>/` 路径，但这段内部说明不会显示在用户消息气泡里。上传文件与 Codex 生成的独立交付文件（图片、文档、音频、导出文件等）都直接放在该目录，不再按类型分子目录；上传文件名前缀用于避免重名。用户明确指定其他交付路径时以用户要求为准；源码修改、项目文件和必须位于原路径的构建产物仍留在项目目录。Codex 的 `cwd` 仍是项目 workspace，不会切到 `.files/`。生成文件的归档由 Agent 执行，不是后端自动搬运，因此受当前权限和执行结果影响。首次保存附件时，如果 workspace 根目录已有 `.gitignore`，Web UI 会追加 `.files/` 忽略规则；不会为此新建 `.gitignore`，已存在相同规则时也不会重复追加。

子路径部署示例：

```bash
export CODEX_WEB_HOST=127.0.0.1
export CODEX_WEB_PORT=8765
export CODEX_WEB_BASE_PATH=/codex
npm start
```

访问：

```text
http://127.0.0.1:8765/codex/
```

注意：只写 `CODEX_WEB_BASE_PATH=/codex` 而不使用 `export`，后续单独执行的 `npm start` 不会继承这个变量。

## 访问认证

默认不启用认证，行为与此前一致。如需保护整个页面、静态资源和 HTTP API，启动前设置：

```bash
export CODEX_WEB_AUTH='username:password'
./scripts/codex-web.sh restart
```

PowerShell：

```powershell
$env:CODEX_WEB_AUTH = "username:password"
.\scripts\codex-web.ps1 restart
```

浏览器打开页面时会显示用户名/密码登录框。用户名或密码错误时，页面和 HTTP API 都返回 `401`。

不设置或删除该变量即可关闭认证：

```bash
unset CODEX_WEB_AUTH
./scripts/codex-web.sh restart
```

密码中允许包含额外的冒号，程序只把第一个冒号视为用户名与密码的分隔符。用户名和密码都不能为空；格式错误时服务会拒绝启动。

Basic Auth 只是访问门槛，凭据本身仅做 Base64 编码。通过非本机网络访问时必须使用 Nginx HTTPS，不能直接把 HTTP 服务暴露到公网。

## Nginx

Nginx 可以负责 TLS 和反向代理，但不能替代 Node。Node 仍需要：

- 启动并管理 `codex app-server`
- 在 stdio JSON-RPC 与浏览器 HTTP API 之间桥接
- 提供受 workspace 范围保护的文件读写接口

配置示例：

```nginx
location /codex/ {
    proxy_pass http://127.0.0.1:8765/codex/;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

同时设置：

```bash
export CODEX_WEB_BASE_PATH=/codex
```

页面静态资源、轮询和操作 API 都会使用同一个 base path。

聊天回答中的本地文件链接也会使用该 base path。例如设置 `/codex` 后，workspace 文件链接会转换为：

```text
/codex/?file=src%2Fserver%2Fusers.ts
```

点击后直接在 Files 抽屉中预览；复制到新标签页打开也不会跳出 `/codex/`。只有当前 workspace 内的文件可以打开，workspace 外的绝对路径会显示为不可用链接。

## Files 文件管理与上传

Files 抽屉的路径栏提供 New 和 Upload。默认在 workspace 根目录操作；先点击文件树中的目录，可以切换目标目录。New 创建空文件，预览顶部的 Delete 会在二次确认后删除当前文件。创建、删除和上传都被限制在当前 workspace 内；Delete 不会删除目录或符号链接。

限制：

- 单文件最大 10 MB
- 单批最大 25 MB
- 单次最多选择 10 个文件
- 不覆盖同名文件
- 只能写入当前 workspace，不能通过 `..`、绝对路径或符号链接逃逸

文本文件上传后可以直接预览和编辑；二进制文件会出现在文件树中，不支持预览时会在预览区中央提供大号 Download 按钮。

Files 只对常见纯文本和代码格式启用预览/编辑，例如 `.txt`、`.md`、`.json`、`.yaml`、`.csv`、`.js`、`.ts`、`.tsx`、`.py`、`.go`、`.rs`、`.java`、`.c/.cpp`、`.html`、`.css`、`.sh`、`.toml`、`.ini`、`.sql`、`.ps1`，以及 `Dockerfile`、`Makefile`、`.env`、`.gitignore` 等。文本预览/编辑上限为 10 MB；超过 1 MB 时使用不带逐行 DOM 的轻量预览。

PNG、JPEG、GIF、WebP、SVG、BMP 和 AVIF 会直接显示图片预览并可下载。Word、PDF、Excel、压缩包和其他二进制/办公格式可以上传和保存在 workspace 中，但 Files 不会尝试解析或编辑，只显示文件大小、不可预览说明和下载入口。

## 多标签页与文件保护

文件 API 和下载/预览 URL 明确携带 thread 或 workspace 上下文，切换另一个标签页的会话不会修改当前标签页的操作目录。审批只展示在所属会话中，后端也检查审批的 thread 和可选决策。

Files 搜索会查找子目录中的文件名/相对路径，跳过构建产物与符号链接；最多扫描 5000 个条目、返回 100 个结果，超过时间/数量预算时提示缩小搜索范围。切换文件、关闭抽屉、离开页面前会保护未保存编辑；保存时核对打开文件时的内容摘要，发现外部修改会拒绝覆盖。

写接口仅接受 `application/json`，拒绝跨来源操作。反向代理需要保留浏览器的 Host（含非默认端口），如上面的 `$http_host`。文件内容使用独立的 CSP sandbox；HTML 等主动内容强制下载，SVG 可作为图片预览但不能执行脚本。

## Session URL

打开或创建 session 成功后，浏览器地址会自动包含：

```text
/codex/?session=<thread-id>
```

刷新该地址会等待 Codex app-server ready，然后自动执行 thread resume。点击 session 或通过 URL 恢复 session 时，页面会立即显示全局 Loading 遮罩，并在恢复成功或失败后解除，避免重复点击。`session` 可以与 `file` 参数共存；选择新 workspace、创建空白对话或删除当前 session 时会清除旧的 session 参数。

每条已完成的 Codex 文本回复下方提供复制与分支操作。复制会保留回答的原始 Markdown；分支使用 app-server 原生 `thread/fork` 与该回复的 `lastTurnId` 创建新 session，只保留到这条回复为止，后续对话不会带入，原 session 也不会被修改。这里不提供点赞、点踩等无关操作。Thread/Turn 提供的时间会显示在用户与 Codex 消息下方；历史消息使用 turn 开始/完成时间，实时消息使用 item 事件时间。

New thread 的默认模型与 reasoning effort 来自当前工作区生效的 `config.toml`（`model`、`model_reasoning_effort`）。仅在配置未指定时，才回退到 app-server 模型目录中标记为默认的模型；不会再直接把模型列表第一项当成用户配置。

## 内存说明

Node 不维护浏览器 WebSocket。浏览器在生成时高频拉取增量状态，空闲时自动降频，页面隐藏时降为 15 秒；提交新 turn 后会立即唤醒轮询。Session 列表从 app-server 分页加载，打开会话按每页 30 个原始 item 加载，更早内容按需加载，不再截断到最后 500 个 item，Settings 关闭时不会持续读取资源数据。

会话 JSON 不包含 app-server 返回的原始 `turns`，工具输出和 diff 也有首包上限。生成图片通过受保护的图片 URL 单独读取，不会把 Base64 图片重复塞进会话响应。

`codex app-server` 会在 Web UI 启动时冷加载并常驻。页面显示分阶段的全局 Loading，模型和首屏 session 同时就绪后再进入 UI。Settings 提供 Start、Stop 和 Restart，并显示 PID、运行状态与错误。

生产验证中的参考值：

- Harness Node RSS：约 76–79 MB
- Codex app-server RSS：约 92–129 MB
- Node V8 heap 上限：256 MB

RSS 包含 V8 之外的 Buffer 和原生内存，因此可能高于当前 heap usage。Codex app-server 是独立子进程，也会单独占用内存。

### 2 核 2G 的默认运行策略

- Web UI 默认同时执行 **1 个 turn**，最多再排队 **8 个**；可通过 `CODEX_WEB_MAX_TURNS=1..4` 调整并行数。排队内容暂存在系统临时目录，避免 Base64 附件常驻 Node 堆；启动执行或取消后清除。停止/重启 Codex 会取消队列，不会在服务重启后自动执行旧任务。强制杀进程可能留下 `codex-web-queue-*` 临时目录，可在确认服务已停止后清理。
- 并行限制针对此 Web UI 提交的任务，并会等待已发现的外部运行会话；不能替代操作系统对其他 Codex 实例、编译器或 MCP 进程的资源限制。
- Node 不缓存打开过的完整会话。优先使用 `thread/items/list` 分页读取；不支持该接口的旧版 Codex 回退到 `thread/read`。旧版上游仍可能一次返回完整历史，因此超长会话建议升级 Codex。历史恢复请求串行执行，限制排队数量。
- 增量事件缓冲同时限制 **1000 条 / 8 MiB**，每次轮询通常最多读取 **512 KiB**（单条较大事件单独返回）。游标失效、缓冲溢出或服务重启时，会重新同步当前会话。切回前台立即轮询，失败后退避重连。
- HTTP 请求体限制 16 MiB，大请求只允许 1 个同时处理；文件预览/写入/上传最多同时处理 2 个。繁忙时返回可重试错误，不无限堆积请求。
- `npm run build` 预生成 Brotli/Gzip 静态文件，生产服务直接流式发送压缩产物，不在每次请求时消耗 CPU 压缩。旧构建没有压缩文件时自动使用原文件。
- Linux 的 Resources 面板采样 Node、app-server 和仍在进程树中的工具/MCP 子进程 RSS，并展示事件缓冲占用。RSS 相加可能重复计算共享内存；已脱离进程树的服务不在统计中。Windows 无 `/proc`，子进程采样显示不可用。

以上限制用于降低 Web UI 自身开销，不保证所有用户任务都能在 2G 内运行。尤其是项目构建、浏览器自动化和大型工具，仍应结合实际任务检查整机内存。

### 长期运行

已有后台脚本适合手动管理；需要崩溃恢复和开机启动时，使用上方的 systemd 配置。不要同时用后台脚本和 systemd 启动同一个端口。

## 验证

不连接真实 Codex 的自动回归：

```bash
npm test
npm run build
python scripts/verify_regressions.py
```

浏览器回归需要 Python Playwright 和 Chromium；覆盖中文输入、发送失败、断线同步、审批隔离、文件搜索/编辑保护、手机与横屏布局。测试使用模拟 API，不会执行真实模型任务。截图保存在 `artifacts/regressions/`。

分页参数参考上游 [ThreadItemsListParams](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadItemsListParams.json) 和 [ThreadResumeParams](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadResumeParams.json)。真实 CLI 兼容性与流式验证仍使用下面的脚本。

先启动一个生产服务：

```bash
npm run build
CODEX_WEB_PORT=8876 CODEX_WEB_BASE_PATH=/codex npm start
```

运行完整 UI 验证：

```bash
/home/pldz/local/venv/bin/python scripts/verify_ui.py
```

运行真实 Codex 流式验证：

```bash
CODEX_WEB_VERIFY_URL=http://127.0.0.1:8876/codex/ \
/home/pldz/local/venv/bin/python scripts/verify_streaming.py
```

截图输出到 `artifacts/screenshots/`。

开发 UI fixture：

```text
http://127.0.0.1:8765/?demo=1
```

`?demo=1` 不会连接真实 Codex，只用于 UI 开发与截图验证。

## 常见问题

### `Cannot find module dist-server/index.js`

尚未生产构建，先执行：

```bash
npm run build
```

### 浏览器提示模块 MIME 类型是 `text/html`

通常是旧构建或 base path/proxy 不一致：

1. 重新执行 `npm run build`
2. 确认 `CODEX_WEB_BASE_PATH` 与 Nginx location 一致
3. 确认代理了整个 `/codex/`，包括静态资源和 HTTP API

### 新对话无法发送

先在 workspace picker 中选择目录。查看已有 session 不要求预先选择 workspace。

### Account usage 显示 Unavailable

当前 Codex 认证方式没有提供账号 usage/rate-limit 接口。对话、文件和 session 功能仍可正常使用。
