# Codex Web UI

一个运行在本机的轻量 Codex Web UI。浏览器通过 HTTP API 和增量轮询连接 Node 服务，Node 再通过 stdio JSON-RPC 管理常驻的 `codex app-server`。

Codex 的登录状态、配置和 session 仍由 Codex 自己管理；Web UI 不读取或保存 Codex 凭据。

![Codex Web UI 操作演示](https://hipldz.com/api/v1/website/image/ai-sharing/codex-webui-lite-demo.gif@original)

## 功能

- 从 app-server 分页加载本机 Codex CLI、VS Code、exec、app-server 和 sub-agent sessions
- 创建、恢复、Branch、归档、取消归档、批量操作和删除 session
- 当前 session 写入 `?session=<id>`，刷新页面后自动恢复
- 用户授权后，任务成功完成、需要回答或审批时显示系统通知，点击可返回对应会话
- 新对话默认使用 `CODEX_WEB_DEFAULT_WORKSPACE`；未配置或目录无效时手动选择 workspace；已有 session 自动恢复自己的 workspace
- 从真实 `model/list` 读取模型与 reasoning effort
- 流式显示回答、thinking、命令、文件修改、工具调用、网页搜索、图片、hook、子 agent、review、计划更新与警告
- AI 回复在浏览器端渲染 Markdown/GFM，支持表格、任务列表、删除线与代码块
- 每轮活动汇总为可展开的时间线；保留文件/命令摘要和历史 context compact 记录
- 执行中原生提问：选项、自定义回答、多问题导航、快捷提交、待回答提示、草稿恢复与提交回执；同时支持阻塞问题和非阻塞问题
- Code / Plan 模式切换；原生计划以独立卡片展示，完成后可确认执行或继续修改
- Composer 可选择会话权限：按需确认、Full access（无 sandbox / 无审批）或只读；设置会作用于后续 turn
- 可在输入框粘贴或选择任意类型文件作为附件；图片支持点击预览，所有附件均会在会话中保留并可下载
- 输入框附件单条消息最多 4 个，单个文件和所有附件合计均限制为 10 MB；附件直接保存在 `${CODEX_HOME}/web-ui/<thread.id>/`（默认 `~/.codex/web-ui/<thread.id>/`），每轮会把具体文件路径告诉 Codex；文本、图片和音频也会直接传入模型，其他二进制文件可由 Codex 按路径读取
- 文件树、文本文件创建/删除、预览、编辑与下载；Project files 与 Session files 分开浏览和上传
- 按文件查看 Changes/Diff
- 显示 context window、实时内存占用，以及独立的 5-hour / Weekly account usage 窗口
- 支持部署在 `/codex/` 之类的反向代理子路径；不要求 WebSocket 反代

## 浏览器通知

点击页面提示条或 **Settings → Task notifications → Enable notifications**，由用户操作触发浏览器权限请求。已允许或拒绝时不会重复弹出权限请求；拒绝后需在浏览器的站点设置中手动允许。Settings 会显示当前权限状态，授权后可点击 **Send test notification** 检查通知。无痕窗口中也需要检查该窗口的站点权限。

任务成功完成、收到待回答问题或待审批请求时发送系统通知，包括当前打开和其他会话的新事件；失败、手动停止、恢复历史或刷新列表不会触发成功通知。同一页面收到重复事件不会重复通知。点击通知会聚焦页面，必要时打开对应的 `?session=<id>` 会话，问题和审批通知会定位到相应请求，并保留部署子路径。

通知需要 **HTTPS 或 localhost**；通过普通 HTTP 的远程 IP/域名访问时不可用。网页需保持打开，切换标签页或最小化浏览器仍可接收，但后台轮询和浏览器节流可能带来延迟。关闭网页后的通知需要额外实现 Web Push，本版本不包含该能力。系统是否弹出提示、播放声音仍由浏览器通知设置及 Windows 勿扰模式决定。演示页面不会自动申请权限或发送任务通知。

## 提问与计划交互

输入框工具栏的 **Code / Plan** 切换决定下一轮是直接执行还是先规划。Plan 使用 Codex 内置的规划模式；收到原生计划后显示 Markdown 计划卡片。只有规划轮成功完成，才出现 **Implement this plan** 和 **Revise plan**。执行会切换到 Code 并开始新一轮；修改会将输入框切回 Plan，供用户补充要求。

Codex 的 `item/tool/requestUserInput` 会显示问题卡片。可以选择选项，或在协议允许时填写自己的答案；多问题支持逐项导航，所有问题回答后统一提交。支持 `Ctrl / ⌘ + Enter`。阻塞问题提交后当前任务继续；非阻塞问题可暂不回答或主动 dismiss。异步消息中的结构化问题也会显示卡片：任务运行时通过 `turn/steer` 回答，任务结束后通过新一轮发送答案。

较长的问题和选项说明先显示摘要，可展开全文；待回答的选项和输入入口保留在对话中，已回答的问题折叠为可展开的回执。长用户消息也可展开或收起，并保留换行。输入框上方可跳转到待回答问题；需要审批时会打开独立的审批面板，关闭面板后可以从输入框上方重新打开。会话列表标记等待回答或审批的会话，工作活动默认折叠，摘要会标记失败的命令。历史会话中标记为过程更新的消息也会折叠；旧记录没有阶段标记时，只在同一轮的工具调用和后续回复能表明它是过程更新时折叠，无法确定的消息仍保持可见。

普通答案草稿保存在当前浏览器标签页，敏感答案使用密码输入框且不保存草稿。服务进程存活时，刷新或重新打开会话可恢复待回答问题和近期回执；请求被 Codex 关闭、任务中断或 runtime 重启后，会显示为已关闭，避免向失效请求提交。回执使用有容量限制的内存缓存，不作为永久历史存储；从原生历史恢复但无法确定是否仍有效的问题仅供查看。

演示页面可使用 `?demo=questions` 查看多问题交互，或使用 `?demo=plan` 查看计划确认。演示无需运行模型，回答与执行仅在浏览器中模拟。

这些原生接口属于 Codex experimental API。本次按本机 `codex-cli 0.162.1` 导出的协议实现；较旧的 app-server 若不支持 `collaborationMode`，发送会明确报错，不会静默把规划请求改成执行请求。

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

## 代码格式化

项目使用 Prettier，配置在 `.prettierrc.json`。格式化源码与文档：

```bash
npm run format
```

仅检查格式，不修改文件：

```bash
npm run format:check
```

生成目录、依赖目录、运行文件和 npm 管理的 `package-lock.json` 通过 `.prettierignore` 排除。

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

脚本继承执行 `start` / `restart` 的当前终端中的 `CODEX_WEB_*` 和 `CODEX_HOME` 环境变量，不保存这些变量，也不自动加载 `.env` 文件。例如：

```bash
export CODEX_WEB_BASE_PATH=/codex
export CODEX_WEB_PORT=8765
mkdir -p "$HOME/workspace"
export CODEX_WEB_DEFAULT_WORKSPACE="$HOME/workspace"
./scripts/codex-web.sh start
```

```powershell
$env:CODEX_WEB_BASE_PATH = "/codex"
$env:CODEX_WEB_PORT = "8765"
New-Item -ItemType Directory -Force -Path "$HOME/workspace" | Out-Null
$env:CODEX_WEB_DEFAULT_WORKSPACE = "$HOME/workspace"
.\scripts\codex-web.ps1 start
```

在另一个终端执行 `restart` 时，需先重新设置所需变量；已经运行时再次执行 `start` 不会更新配置。需要持久配置时，使用下方 systemd 的 `EnvironmentFile`。

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
Description=Codex Web UI
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

| 变量                          | 默认值      | 说明                                                                                                    |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `CODEX_WEB_HOST`              | `127.0.0.1` | Node 监听地址                                                                                           |
| `CODEX_WEB_PORT`              | `8765`      | Node 监听端口                                                                                           |
| `CODEX_WEB_BASE_PATH`         | `/`         | 页面及 HTTP API 的统一子路径                                                                            |
| `CODEX_WEB_DEFAULT_WORKSPACE` | 未设置      | 启动及每次新建对话时默认选中的 workspace 目录；目录不存在或不可用时忽略，仍需手动选择                   |
| `CODEX_WEB_AUTH`              | 未启用      | 可选 Basic Auth，格式为 `username:password`                                                             |
| `CODEX_HOME`                  | `~/.codex`  | Codex 配置与 sessions 所在目录；Web UI 规则写入其中的 `AGENTS.md`，会话文件保存在 `web-ui/<thread.id>/` |

页面会先加载最近 50 个本地 session。workspace 的选择规则如下：

- 打开已有 session 或刷新带 `?session=<id>` 的地址时，恢复该 session 自己的 workspace。
- 每次点击 **New thread** 时，恢复 `CODEX_WEB_DEFAULT_WORKSPACE` 指定的目录，并重新读取该目录的模型、reasoning effort 与权限默认配置。
- 未设置默认目录，或启动时发现目录不存在、不是目录或无法访问时，新建对话需手动选择 workspace；不会将 Web UI 项目目录或上一个 session 的目录自动当成已选 workspace。
- 新对话首次发送前可以手动选择其他目录，本次对话使用该目录；再次点击 **New thread** 时仍恢复配置的默认目录。仅浏览或取消目录选择器不会改变当前 workspace。
- Workspace 选择器从当前工作目录开始；无已选目录时从服务账号的主目录开始。可以向上浏览到文件系统根目录，输入绝对路径、`~` 路径或相对文件系统根目录的路径，也可显示隐藏目录及进入符号链接目录。Windows 下可以通过输入绝对路径切换盘符。
- 默认工作目录只决定新会话的起点，不限制已有会话的位置。已有会话使用自己的实际工作目录，项目文件链接按该目录解析，会话附件和独立交付文件使用各自的 Session files 目录；不会受默认目录或用户主目录的位置影响。目录不存在或服务账号无权访问时，会话中才显示相应错误。
- 在已有会话中选择相同目录只关闭选择器；选择其他目录会开始新对话，不改变已有会话的工作目录。输入框草稿和待上传附件在当前页面内按会话或新对话工作区分别保留，刷新页面后不保留。

`CODEX_WEB_DEFAULT_WORKSPACE` 应指向已存在且服务运行用户可访问的目录，推荐使用绝对路径。默认目录在 Web 服务启动时读取和校验；修改环境变量或修复无效目录后需重启 Web 服务，再重新载入页面。仅修改环境变量不需要重新构建；更新 `src/` 或 `server/` 源码时，生产模式必须先重新构建再重启。

各类目录的用途分别是：

| 目录                      | 用途                                            | 配置方式                                                                            |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Workspace / Project files | 对话的工作目录（`cwd`），用于项目源码和项目资源 | 新对话默认取 `CODEX_WEB_DEFAULT_WORKSPACE`，也可手动选择；已有 session 使用自身目录 |
| Codex home                | Codex 配置、认证与 session 记录                 | `CODEX_HOME`，未设置时为 `~/.codex`                                                 |
| Session files             | 当前会话的附件与默认独立交付文件                | 固定为 `${CODEX_HOME}/web-ui/<thread.id>/`                                          |

例如 `CODEX_WEB_DEFAULT_WORKSPACE=/home/codex/workspace`、`CODEX_HOME=/home/codex/.codex` 时，新对话的 `cwd` 是 `/home/codex/workspace`，附件与默认独立交付文件保存在 `/home/codex/.codex/web-ui/<thread.id>/`。设置默认 workspace 不会改变 Codex home 或 Session files 的位置。

Composer 上传文件使用 app-server 返回的 `thread.id`（不是 `sessionId`），保存在 `${CODEX_HOME}/web-ui/<thread.id>/example.pdf`。新附件优先保留原文件名，同一会话中遇到同名文件或目录时依次使用 `example (2).pdf`、`example (3).pdf`，以独占创建避免覆盖已有文件。文件名中的路径和不安全字符会被清理，超长名称会按 UTF-8 字节限制缩短，内部元数据保留前缀会添加下划线。附件与消息的关联仍由元数据中的 ID 和实际路径维护。已有附件保持原名和原位置，带消息 ID 前缀的旧附件继续按记录的路径读取；老会话后续上传的附件也使用新命名规则。未设置 `CODEX_HOME` 时默认使用 `~/.codex`；相对路径按 Web UI 启动目录解析，并将同一绝对路径传给 Codex。项目的 `cwd` 保持不变，不再在项目中创建 `.files` 或修改 `.gitignore`。

Web UI 的会话文件规则内置于 [server/web-instructions.ts](server/web-instructions.ts)，无需独立模板文件。启动时检查 `${CODEX_HOME}/AGENTS.md`，将内置规则安装到 `codex-web:thread-files` 标记块中。规则一致时不重复写入；内置规则更新时只更新这个块，保留其他内容。规则只适用于带有 Web UI 文件上下文的轮次。每轮仅提供当前会话目录的绝对路径和本轮附件路径，内部上下文不显示在消息气泡里。安装发生在启动 Codex app-server 之前；此前已运行的其他 Codex 会话需要重新加载全局指令。

默认独立交付文件与附件直接保存在会话目录，用户指定其他位置时尊重用户要求；项目源码和构建产物仍保存在项目路径。后端确保会话目录存在，但生成文件仍由 Agent 保存。Ask when needed 模式只将当前会话目录额外加入可写范围，不开放整个 `CODEX_HOME`；只读模式不允许 Agent 写文件。Use config.toml 的传统 workspace-write 配置也增加当前会话目录；命名权限配置保持原定义，其访问范围需要用户在该配置中允许。

恢复旧会话时，workspace 下的 `.files/<thread.id>/`、旧版 `uploads/` 和 `CODEX_HOME/attachments/codex-web/` 附件仍从原位置读取，不自动迁移。分叉会话的新文件使用新 thread 目录，历史附件继续引用父会话；历史回复中的父会话文件链接可预览图片或直接下载原文件。删除会话不会删除新会话目录或项目中的旧文件，避免误删交付文件和分叉仍在使用的文件；确认不再需要后，可按 thread 目录手动清理。

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

### 纯静态 mock（无需 Node 后端）

如果只想预览 WebUI，可以把已有前端产物导出为独立 mock：

```bash
npm run mock:export
```

导出器只读取已有的 `dist/`，生成 `dist-mock/`，不运行构建、不启动服务，也不修改真实页面。若尚无 `dist/`，需先在构建机器上生成前端产物；重新导出会清空并替换 `dist-mock/`。源码更新后，也需先更新 `dist/` 再导出。

将整个 `dist-mock/` 交给 Nginx 托管即可。参考 [`deploy/nginx-mock.conf`](deploy/nginx-mock.conf)，把其中 `root` 改为部署目录，然后将配置放入 Nginx 已包含的配置目录并重新加载 Nginx。该示例监听 `8080`：

- `/`：自动进入聊天 mock，可模拟发送和流式回复。
- `/?demo=questions`：多问题、选项与自定义回答。
- `/?demo=plan`：计划确认与修改。

顶部会标明 **Static mock · 无后端** 并提供三个场景链接。界面复用现有 React 产物；不需要 CDN、Node 服务、Codex 登录或 API 反向代理。会话操作、文件预览、审批和模型选择均使用现有演示逻辑，数据在刷新后重置；文件下载、真实文件持久化和运行时管理需要真实后端，不属于这个 mock。

支持静态子路径部署，资源均使用相对路径。例如将 `dist-mock/` 复制到 `/srv/www/codex-mock/`，在已有 `root /srv/www;` 的 Nginx server 内加入：

```nginx
location = /codex-mock {
    return 301 /codex-mock/$is_args$args;
}
location /codex-mock/ {
    try_files $uri $uri/ =404;
    add_header Cache-Control "no-cache";
}
```

访问 `/codex-mock/` 即可，记得保留目录末尾的 `/`。纯静态版只能演示交互；连接真实 Codex 请使用下方的后端反向代理配置。

### 真实 Codex 后端

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

点击后直接在 Files 抽屉中预览；复制到新标签页打开也不会跳出 `/codex/`。当前 workspace、当前会话文件目录及分叉继承的会话文件链接可按对应范围打开；其他位置的普通文件链接会显示为不可用。

## Files 文件管理与上传

Files 抽屉顶部提供两个独立入口：

- **Project files**：当前会话的项目目录，使用蓝色标识，浏览源码与项目资源。
- **Session files**：当前会话的附件与生成文件，使用紫色标识，存放在 `${CODEX_HOME}/web-ui/<thread.id>/`。已有会话默认打开此入口；新会话尚未建立时仅能使用项目文件。

两个入口分别显示用途、可展开的实际存储路径和明确的 Upload to 目标。路径栏提供 New 和 Upload；点击目录或打开文件会更新目标目录，点击根目录按钮可以回到当前范围的根目录。使用 **Browse other folders** 可以打开 Workspace 选择器，为新对话选择其他目录；取消选择会返回原文件面板。切换入口时清空当前搜索和预览，有未保存的编辑时会提示保留或放弃。操作过程中禁止切换范围，防止上传目标发生混淆。搜索只覆盖当前范围。

聊天文件链接会识别项目路径和当前会话路径，显示 Project / Session 标记，并自动打开对应入口；图片通过相应范围预览和下载。带 `file`、`scope` 和 `session` 参数的链接可重新定位同一会话文件。会话中的其他本地文件链接（例如输出到桌面的文件）显示 Local file 标记，可直接下载；图片可直接预览。支持绝对路径、Windows 盘符路径、`file://` URL，以及从项目目录指向父目录的相对路径。

Local file 链接由服务端读取，文件必须存在于运行 Codex Web UI 的机器上，且服务账号具有读取权限。该入口需要已恢复或创建的会话上下文，仅用于预览和下载，不会切换会话工作目录或改变 Files 抽屉的编辑范围；文件不存在或不可读取时会显示相应错误。视频等大文件通过流式下载返回，不会整文件读入内存。

New 创建空文件，预览顶部的 Delete 会在二次确认后删除当前文件。Files 抽屉的文件接口根据 Project / Session 范围解析根目录并检查路径；Session files 不展示或允许修改内部附件元数据。Delete 不会删除目录或符号链接。

限制：

- 单文件最大 10 MB
- 单批最大 25 MB
- 单次最多选择 10 个文件
- 不覆盖同名文件
- 只能写入当前选择的 Project files 或 Session files 范围，不能通过 `..`、绝对路径或符号链接逃逸

文本文件上传后可以直接预览和编辑；二进制文件会出现在文件树中，不支持预览时会在预览区中央提供大号 Download 按钮。

Files 只对常见纯文本和代码格式启用预览/编辑，例如 `.txt`、`.md`、`.json`、`.yaml`、`.csv`、`.js`、`.ts`、`.tsx`、`.py`、`.go`、`.rs`、`.java`、`.c/.cpp`、`.html`、`.css`、`.sh`、`.toml`、`.ini`、`.sql`、`.ps1`，以及 `Dockerfile`、`Makefile`、`.env`、`.gitignore` 等。文本预览/编辑上限为 10 MB；超过 1 MB 时使用不带逐行 DOM 的轻量预览。

PNG、JPEG、GIF、WebP、SVG、BMP 和 AVIF 会直接显示图片预览并可下载。Word、PDF、Excel、压缩包和其他二进制/办公格式可以上传到当前选择的 Project files 或 Session files，但 Files 不会尝试解析或编辑，只显示文件大小、不可预览说明和下载入口。

## 多标签页与文件保护

文件 API 和下载/预览 URL 使用 thread 或服务端签发的 workspace 选择令牌；Project files 的读写范围绑定所选工作目录，Session files 绑定对应会话目录。切换另一个标签页的会话不会修改当前标签页的操作目录。服务重启后自选 workspace 的令牌会失效，需要重新选择目录。具有 Web UI 访问权限的客户端可在目录选择器中选择服务账号有权访问的目录。审批只展示在所属会话中，后端也检查审批的 thread 和可选决策。

Files 搜索会查找子目录中的文件名/相对路径，跳过构建产物与符号链接；最多扫描 5000 个条目、返回 100 个结果，超过时间/数量预算时提示缩小搜索范围。切换文件、关闭抽屉、离开页面前会保护未保存编辑；保存时核对打开文件时的内容摘要，发现外部修改会拒绝覆盖。

写接口仅接受 `application/json`，拒绝跨来源操作。反向代理需要保留浏览器的 Host（含非默认端口），如上面的 `$http_host`。文件内容使用独立的 CSP sandbox；HTML 等主动内容强制下载，SVG 可作为图片预览但不能执行脚本。

## Session URL

打开或创建 session 成功后，浏览器地址会自动包含：

```text
/codex/?session=<thread-id>
```

刷新该地址会等待 Codex app-server ready，然后自动执行 thread resume。点击 session 或通过 URL 恢复 session 时，页面会立即显示全局 Loading 遮罩，并在恢复成功或失败后解除，避免重复点击。`session` 可以与 `file` 参数共存；选择新 workspace、创建空白对话或删除当前 session 时会清除旧的 session 参数。

每条已完成的 Codex 文本回复下方提供复制与分支操作。复制会保留回答的原始 Markdown；分支使用 app-server 原生 `thread/fork` 与该回复的 `lastTurnId` 创建新 session，只保留到这条回复为止，后续对话不会带入，原 session 也不会被修改。这里不提供点赞、点踩等无关操作。Thread/Turn 提供的时间会显示在用户与 Codex 消息下方；历史消息使用 turn 开始/完成时间，实时消息使用 item 事件时间。

点击 New thread 时，默认模型、reasoning effort 与权限会按默认 workspace 的有效 `config.toml` 重新加载；手动选择其他 workspace 后，改为读取所选目录的配置。模型与 reasoning effort 对应 `model`、`model_reasoning_effort`；仅在配置未指定时，才回退到 app-server 模型目录中标记为默认的模型。

## 内存说明

Node 不维护浏览器 WebSocket。浏览器在生成时高频拉取增量状态，空闲时自动降频，页面隐藏时降为 15 秒；提交新 turn 后会立即唤醒轮询。Session 列表从 app-server 分页加载，打开会话按每页 30 个原始 item 加载，更早内容按需加载，不再截断到最后 500 个 item，Settings 关闭时不会持续读取资源数据。

会话 JSON 不包含 app-server 返回的原始 `turns`，工具输出和 diff 也有首包上限。生成图片通过受保护的图片 URL 单独读取，不会把 Base64 图片重复塞进会话响应。

`codex app-server` 会在 Web UI 启动时冷加载并常驻。页面显示分阶段的全局 Loading，模型和首屏 session 同时就绪后再进入 UI。Settings 提供 Start、Stop 和 Restart，并显示 PID、运行状态与错误。

生产验证中的参考值：

- Web UI Node RSS：约 76–79 MB
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

确认新对话已选中 workspace。未设置 `CODEX_WEB_DEFAULT_WORKSPACE` 或默认目录无效时，需在 workspace picker 中手动选择目录；查看已有 session 不要求预先选择 workspace。

### 新建对话没有使用配置的默认目录

1. 确认变量名是 `CODEX_WEB_DEFAULT_WORKSPACE`，且指向已存在、服务运行用户可访问的目录。
2. 确认变量传给了启动 Web 服务的进程：shell 需在 `start` / `restart` 前 `export`；systemd 需修改其 `EnvironmentFile` 后重启服务。在其他终端设置变量或仅写入项目 `.env` 不会更新正在运行的服务。
3. 检查服务日志是否包含 `Ignoring invalid CODEX_WEB_DEFAULT_WORKSPACE`；如有，修复目录或权限后重启服务。
4. 更新过源码时，先重新执行 `npm run build`，再重启 Web 服务并重新载入页面，确保前后端都使用最新版本。
5. 点击 **New thread** 检查目录。刷新旧的 `?session=<id>` 地址会恢复旧 session 的 workspace；分支也继承源 session 的 workspace。

默认目录只控制新对话的工作目录。若检查的是附件或独立交付文件，应在 **Session files** 中查看 `${CODEX_HOME}/web-ui/<thread.id>/`。

### Account usage 显示 Unavailable

当前 Codex 认证方式没有提供账号 usage/rate-limit 接口。对话、文件和 session 功能仍可正常使用。

## 许可证

本项目采用 [MIT License](LICENSE)。
