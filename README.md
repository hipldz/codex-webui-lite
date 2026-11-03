# Codex Web UI

Codex 的网页界面，支持管理本机会话、执行任务和查看项目文件。Node 服务通过 stdio JSON-RPC 连接 `codex app-server`，浏览器通过 SSE 接收事件，通过 HTTP 提交操作。

登录状态、配置和会话记录由 Codex 管理；Web UI 不读取或保存 Codex 凭据。

![Codex Web UI 操作演示](https://hipldz.com/api/v1/website/image/ai-sharing/codex-webui-lite-demo.gif@original)

[功能](#功能) · [快速开始](#快速开始) · [使用说明](#使用说明) · [配置](#配置) · [部署](#部署) · [演示](#演示) · [开发与维护](#开发与维护) · [常见问题](#常见问题)

## 功能

- 分页浏览本机 Codex CLI、VS Code、exec、app-server 和子 agent 会话；支持新建、恢复、归档、批量操作和删除，可从已结束的历史回复创建分支。
- 流式显示回复，渲染 Markdown/GFM；支持表格、任务列表、删除线和代码块。
- 展开查看思考、命令、文件修改、工具调用、网页搜索、图片、hook、子 agent、review 和上下文压缩记录。
- 切换模型、推理强度和 Code / Plan 模式；支持原生提问、计划确认与审批。
- 全局权限保存在服务端，跨会话和浏览器同步；支持多会话并发与排队，默认并发 1，可配置为 1–4。
- 上传附件，预览图片，浏览、编辑和下载项目文件与会话文件，按文件查看 Diff。
- 查看上下文用量、账号额度和运行内存；接收任务完成、待回答和待审批通知。
- 支持亮色、暗色和跟随系统主题；对话一键到底、侧边栏拖拽调宽。
- 通过 SSE 实时同步回复和会话状态，断线自动重连并补发事件；支持后台运行、systemd 和 Nginx 子路径部署。

## 快速开始

### 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`。
- 已安装 `codex` CLI，并完成登录或配置好认证方式。
- 运行 Web UI 的用户能够执行 `codex`，并有权访问目标 workspace。

```bash
node --version
codex --version
```

### 安装与启动

```bash
cd /path/to/codex-webui-lite
npm install
npm run build
npm start
```

打开 <http://127.0.0.1:8765/>，选择 workspace 后发送任务。也可在启动前设置 `CODEX_WEB_DEFAULT_WORKSPACE`，见[默认工作目录](#默认工作目录)。

构建生成前端 `dist/` 和服务端 `dist-server/`。`npm start` 只启动已有构建；修改源码后需重新构建并重启。

默认仅监听本机地址，未启用访问认证。远程访问需配置[认证](#访问认证)和 [HTTPS 反向代理](#nginx-反向代理)。

## 使用说明

### 会话与工作目录

页面先加载最近 50 个会话，可继续加载历史。打开会话后，地址自动带上 `?session=<thread-id>`，刷新时等待 Codex 就绪后恢复该会话。子路径部署的地址例如：

```text
/codex/?session=<thread-id>
```

恢复期间显示 Loading，成功或失败后解除。`session` 可与 `file`、`scope` 参数组合定位文件；新建空白对话、选择新 workspace 或删除当前会话时清除旧参数。

workspace 的选择规则：

- **New thread** 使用 `CODEX_WEB_DEFAULT_WORKSPACE`；未配置或目录无效时需手动选择，不沿用上一个会话或 Web UI 项目目录。
- 已有会话和分支使用自身的工作目录，不受默认目录限制。目录不存在或无权访问时显示错误。
- 输入框上方的 **Folder** 显示当前目录，悬停查看完整路径。在已有会话中选择其他目录会开始新对话；选择相同目录或取消选择不改变会话。
- 目录选择器从当前目录开始，无已选目录时从服务账号主目录开始。支持向上浏览到根目录、隐藏目录、符号链接、绝对路径、`~` 路径和相对文件系统根目录的路径；Windows 可输入绝对路径切换盘符。
- 输入框草稿和待上传附件在当前页面内按会话或新对话工作区保留，刷新后不保留。

已完成的 Codex 文本回复可复制原始 Markdown。每个已结束轮次的最后一条文本回复或生成图片下方提供分支入口，通过原生 `thread/fork` 和该轮的 `lastTurnId` 创建新会话，只保留到该轮为止，源会话不变。原任务运行或排队时仍可从已结束的轮次分支，当前执行中的轮次需等待结束；分支不会停止原任务。

### 消息发送与恢复

页面区分发送中、排队、启动和执行状态，等待回答或审批时单独提示。服务端确认收到消息后才清空输入草稿；未确认或发送失败时保留文字和附件。

发送或启动失败的消息可通过 **Restore draft** 放回输入框，修改后重新发送。恢复时若已有其他草稿，会保留为可切换草稿。草稿仅在当前页面内保留，刷新后不保留。

### 模型、提问与计划

模型和 reasoning effort（推理强度）选项来自 `model/list`。切换模型时保留仍受支持的推理强度，否则回退到新模型默认值。

新建对话时，从默认 workspace 的有效 Codex 配置读取 `model` 和 `model_reasoning_effort`；选择其他目录后改读该目录配置。未指定时使用模型目录中的默认值。权限独立使用 [Web UI 全局设置](#全局权限)。

**Code / Plan** 决定下一轮直接执行还是先规划。原生计划以 Markdown 卡片展示，规划轮成功完成后提供：

- **Implement this plan**：切换到 Code，开始新一轮执行。
- **Revise plan**：切回 Plan，在输入框补充修改要求。

问题卡片支持选项、自定义答案、多问题导航和 `Ctrl / ⌘ + Enter` 提交。阻塞问题提交后任务继续；非阻塞问题可暂不回答或 dismiss。异步问题在任务运行时通过 `turn/steer` 回答，任务结束后通过新一轮发送答案。

输入框上方可定位待回答问题、重新打开审批面板；会话列表也会标记待回答和待审批状态。长问题、选项说明和用户消息可展开，已回答问题折叠为回执。

普通答案草稿保存在当前标签页，敏感答案使用密码输入框且不保存草稿。服务进程存活时可恢复待处理问题和近期回执；请求关闭、任务中断或 runtime 重启后显示为已关闭。回执使用有容量限制的内存缓存，不作为永久历史；无法确认有效性的历史问题仅供查看。

提问与计划使用 Codex experimental API。旧版 app-server 不支持 `collaborationMode` 时会明确报错，不会将规划请求改为执行请求。原实现按 `codex-cli 0.162.1` 导出的协议对接。

### 工作详情与用量

工具活动和过程更新默认折叠到 **Work details**。展开后可查看命令、读写文件、MCP/动态工具、网页搜索、图像、子 agent 和 review；摘要标记失败命令，有任务级时间记录时显示整轮完成耗时。

计划更新、hook、模型 reroute、安全等待、警告和 context compact 以状态行展示，compact 记录可随历史恢复。旧消息缺少阶段标记时，仅在同轮工具活动和后续回复足以判断的情况下折叠过程更新。

用户与 Codex 消息下方显示可用时间。历史消息优先使用 item 时间，旧版记录回退到轮次时间；整轮耗时使用任务级记录。

界面适配移动端和软键盘；上翻后可一键回到对话底部，桌面侧边栏可拖拽调宽、双击复位，宽度保存在当前浏览器。

**Changes / Diff** 按文件显示修改。输入区域显示上下文用量，Settings 显示运行资源和账号额度；账号窗口标为 **5-hour limit** 与 **Weekly limit**。认证方式未提供数据时显示 `Unavailable`。

### 文件目录与附件

| 目录                      | 用途                                       | 位置                                |
| ------------------------- | ------------------------------------------ | ----------------------------------- |
| Workspace / Project files | 项目源码、资源和构建产物；也是会话的 `cwd` | 默认目录或会话自身目录              |
| Session files             | 当前会话的附件和默认独立交付文件           | `${CODEX_HOME}/web-ui/<thread.id>/` |
| Codex home                | Codex 配置、认证、会话记录和 Web UI 设置   | `CODEX_HOME`，默认 `~/.codex`       |

默认 workspace 不改变 Codex home 或 Session files 的位置。例如 workspace 为 `/home/codex/workspace`、`CODEX_HOME=/home/codex/.codex` 时，会话文件位于 `/home/codex/.codex/web-ui/<thread.id>/`。

对话支持粘贴或选择任意类型附件：**每条消息最多 4 个，单文件和附件总量均不超过 10 MB**。图片可点击预览，附件可从会话中下载。

附件保存在 Session files，目录使用 app-server 的 `thread.id`，不是 `sessionId`。每轮向 Codex 提供实际文件路径；文本、图片和音频也直接传入模型，其他二进制文件按路径读取。

新附件保留原文件名，同名时依次使用 `example (2).pdf`、`example (3).pdf`，独占创建以避免覆盖。路径和不安全字符会清理，超长名称按 UTF-8 字节限制缩短，内部元数据保留前缀会添加下划线。附件与消息的关联仍由元数据 ID 和实际路径维护；旧附件继续按原路径读取。

### Files 面板

**Project files** 使用蓝色标识，浏览当前项目；**Session files** 使用紫色标识，浏览附件和生成文件。已有会话默认打开 Session files，尚未建立会话时仅能使用项目文件。

路径栏显示实际目录和 **Upload to** 目标，提供 **New** 与 **Upload**。浏览目录或打开文件会更新目标目录，根目录按钮返回当前范围根目录。**Browse other folders** 打开 workspace 选择器，为新对话选择其他目录；取消后返回文件面板。

切换 Project / Session 会清空搜索和预览；有未保存编辑时提示处理，操作过程中禁止切换范围。搜索仅覆盖当前范围，跳过构建产物和符号链接；最多扫描 5000 个条目、返回 100 个结果，达到时间或数量预算时提示缩小范围。

| 操作                 | 限制                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| Files 上传           | 单文件 10 MB、单批 25 MB、每次最多 10 个文件，不覆盖同名文件          |
| 文本预览与编辑       | 最大 10 MB；超过 1 MB 使用不带逐行 DOM 的轻量预览                     |
| 图片预览             | PNG、JPEG、GIF、WebP、SVG、BMP、AVIF                                  |
| 办公与其他二进制文件 | 支持上传、查看大小和下载，不解析或编辑 Word、PDF、Excel、压缩包等内容 |
| 创建与删除           | New 创建空文件；Delete 二次确认后删除当前文件，不删除目录或符号链接   |

文本预览与编辑支持常见代码和纯文本格式，包括 `.txt`、`.md`、`.json`、`.yaml`、`.csv`、`.js`、`.ts`、`.tsx`、`.py`、`.go`、`.rs`、`.java`、`.c/.cpp`、`.html`、`.css`、`.sh`、`.toml`、`.ini`、`.sql`、`.ps1`，以及 `Dockerfile`、`Makefile`、`.env`、`.gitignore`。

不支持预览的文件提供 Download 按钮。切换文件、关闭抽屉或离开页面时保护未保存编辑；保存前核对打开时的内容摘要，发现外部修改后拒绝覆盖。

### 文件链接与访问范围

回复中的项目文件和会话文件分别标记 **Project / Session**，点击后打开对应 Files 范围。父会话文件可在分支中预览或下载；带 `session`、`file` 和 `scope` 参数的链接可重新定位同一文件。

其他本地路径标记 **Local file**，可下载文件或预览图片。支持绝对路径、Windows 盘符路径、`file://` URL 和指向父目录的相对路径。文件需存在于运行 Web UI 的机器上，且服务账号可读；此入口需要会话上下文，仅用于预览和下载，不改变 workspace 或 Files 编辑范围。视频等大文件流式下载，不整文件读入内存。

Project / Session 文件接口绑定会话或服务端签发的 workspace 选择令牌，其他标签页切换会话不会改变当前页的操作目录。服务重启后，自选 workspace 令牌失效，需重新选择。目录选择器可访问服务账号有权访问的目录。

文件写入限制在当前 Project / Session 范围，禁止通过 `..`、绝对路径或符号链接逃逸。Session files 隐藏并保护附件元数据。审批仅显示在所属会话，后端检查 thread 和可选决策。

写接口只接受 `application/json`，拒绝跨来源操作。文件内容使用独立 CSP sandbox；HTML 等主动内容强制下载，SVG 可预览但不能执行脚本。

### 会话文件规则与旧数据

规则内置于 [server/web-instructions.ts](server/web-instructions.ts)。Web UI 启动时，在 `${CODEX_HOME}/AGENTS.md` 的 `codex-web:thread-files` 标记块内安装或更新规则，保留块外内容；一致时不重复写入。安装先于 app-server 启动，其他已运行的 Codex 会话需重新加载指令。

规则仅适用于带有 Web UI 文件上下文的轮次。每轮提供会话目录和本轮附件的绝对路径，内部上下文不显示在消息气泡中。相对 `CODEX_HOME` 按 Web UI 启动目录解析，并将同一绝对路径传给 Codex。

独立交付文件和附件默认直接保存在会话目录；用户指定其他位置时按用户要求处理。项目源码和构建产物仍在项目路径，项目 `cwd` 不变。后端创建会话目录，生成文件仍需由 Agent 保存。

旧版 workspace 下的 `.files/<thread.id>/`、`uploads/` 和 `CODEX_HOME/attachments/codex-web/` 附件继续从原记录读取，不自动迁移；新附件使用当前会话目录，不再创建项目 `.files` 或修改 `.gitignore`。分支的新文件使用新目录，历史附件继续引用父会话。

删除会话不会删除会话文件目录或旧项目文件，以保留交付文件和分支引用。确认不再需要后，可按会话目录手动清理。

### 主题与通知

**Settings → Appearance** 提供 Light、Dark 和 System，默认跟随系统。选择保存在当前浏览器 localStorage，同一站点标签页同步；不同浏览器和设备分别保存，存储被禁用时仅当前页面生效。切换立即生效，无需重启。

点击页面提示或 **Settings → Task notifications → Enable notifications** 授权，可用 **Send test notification** 检查。已允许或拒绝时不重复请求；拒绝后需在浏览器站点设置中重新允许，无痕窗口也需检查自身权限。

任务成功完成、待回答和待审批时发送通知，覆盖当前及其他会话。点击通知聚焦页面并定位对应会话或请求，保留部署子路径。失败、手动停止、历史恢复和列表刷新不触发成功通知。

同一页面去重；刷新或重连时仍待处理的请求可触发提醒，已提醒请求不会因重连或切换会话重复通知。之后才授权的，会补发当前待处理请求。

通知需要 **HTTPS 或 localhost**，且网页保持打开。后台标签页或最小化时仍可接收，节流和系统休眠可能带来延迟；关闭网页后的 Web Push 不在本版本范围。提示、声音由浏览器和系统通知设置决定，演示页面不自动申请权限或发送任务通知。

## 配置

### 环境变量

以下变量在 Web 服务启动时读取，实现见 [server/config.ts](server/config.ts) 和 [server/controller.ts](server/controller.ts)。

| 变量                          | 默认值      | 说明                                                              |
| ----------------------------- | ----------- | ----------------------------------------------------------------- |
| `CODEX_WEB_HOST`              | `127.0.0.1` | Node 监听地址                                                     |
| `CODEX_WEB_PORT`              | `8765`      | Node 监听端口                                                     |
| `CODEX_WEB_BASE_PATH`         | `/`         | 页面、静态资源和 API 的统一子路径，例如 `/codex`                  |
| `CODEX_WEB_DEFAULT_WORKSPACE` | 未设置      | 新对话默认目录，须存在且服务账号可访问                            |
| `CODEX_WEB_MAX_TURNS`         | `1`         | 整个 Web 服务同时执行的任务数，支持 `1`–`4`                       |
| `CODEX_WEB_AUTH`              | 未启用      | Basic Auth，格式为 `username:password`                            |
| `CODEX_HOME`                  | `~/.codex`  | Codex 配置与会话目录；Web UI 设置和会话文件保存在其中的 `web-ui/` |

辅助脚本变量：

| 变量                   | 默认值                         | 用途                                         |
| ---------------------- | ------------------------------ | -------------------------------------------- |
| `NODE_BIN`             | `PATH` 中的 `node`             | Linux / macOS 后台脚本使用的 Node 可执行文件 |
| `CODEX_WEB_VERIFY_URL` | `http://127.0.0.1:8876/codex/` | 浏览器验证脚本的目标地址，保留末尾 `/`       |

### 配置生效

项目不会自动加载 `.env`。shell 在启动前 `export`，PowerShell 设置 `$env:变量名`，systemd 使用 `EnvironmentFile`。后台脚本继承当前终端环境，不保存上次配置；在另一个终端重启时需重新设置全部所需变量。

环境变量修改后，重启 **Web 服务进程**；页面中的 Codex Restart 只重启 app-server。仅改环境变量无需构建，改源码则先构建再重启生产服务。

端口和子路径也支持命令行参数，非空环境变量优先：

```bash
npm start -- --port 9000 --base-path /codex
```

### 默认工作目录

在启动前设置，目录须已存在且服务账号可访问。已有前台服务先按 `Ctrl+C` 停止。

```bash
export CODEX_WEB_DEFAULT_WORKSPACE=/absolute/path/to/project
npm start
```

PowerShell：

```powershell
$env:CODEX_WEB_DEFAULT_WORKSPACE = "C:\path\to\project"
npm start
```

目录在服务启动时校验。不存在、不是目录或无法访问时，日志显示 `Ignoring invalid CODEX_WEB_DEFAULT_WORKSPACE`，新对话需手动选择。修复目录后也需重启服务并重新载入页面。建议使用绝对路径。

### 并发与排队

`CODEX_WEB_MAX_TURNS` 控制不同会话之间的并发，一次请求及其执行过程称为一轮任务（turn）。同一会话最多有一个待处理或执行中的任务；等待回答或审批仍占用名额。

设为 `2` 时，会话 A、B 可同时执行，C 提交后等待。切换会话、创建分支不会停止原任务，分支任务共用名额。此设置不限制任务内部的模型调用、工具调用或子 agent 数量。

队列总容量为 **8 + 并发数**，包含保存、等待、启动和执行中的任务，满额后拒绝新提交。无外部运行会话时，默认可执行 1 个、再等待 8 个。已发现的外部运行会话也占用调度名额，但不受此 Web UI 的并发设置控制。

请填写 `1`–`4` 的整数。实现先向下取整，再限制到此范围；未设置、空值或无法解析时使用 `1`。2 核 2 GB 机器可保留默认值。

停止旧前台服务后启动并发为 2 的实例：

```bash
export CODEX_WEB_MAX_TURNS=2
npm start
```

```powershell
$env:CODEX_WEB_MAX_TURNS = "2"
npm start
```

后台实例在当前终端设置变量后执行 `./scripts/codex-web.sh restart`，同时保留原端口、子路径和认证等变量。systemd 修改 `/etc/codex-web.env` 后执行 `sudo systemctl restart codex-web`。

排队内容暂存在系统临时目录，启动执行或取消后清除。停止或重启 Codex 会取消队列，服务重启后不自动执行旧任务。强制终止可能留下 `codex-web-queue-*` 临时目录，确认服务停止后可清理。

### 全局权限

输入框权限菜单作用于整个 Web UI 的新建、恢复和分支会话。设置保存在 `${CODEX_HOME}/web-ui/settings.json`，刷新、切换 workspace、换浏览器或重启服务后仍保留，其他已打开页面同步更新。首次默认 **Ask when needed**。

| 选项            | sandbox                   | 审批策略                  | 行为                                         |
| --------------- | ------------------------- | ------------------------- | -------------------------------------------- |
| Ask when needed | `workspace-write`         | `on-request`              | 在工作区范围内执行，越过边界时请求审批       |
| Full access     | `danger-full-access`      | `never`                   | 无 sandbox、无审批，在运行账号权限范围内执行 |
| Read-only       | `read-only`               | `on-request`              | 默认只读，需要提升权限时可请求审批           |
| Use config.toml | 当前 workspace 的有效配置 | 当前 workspace 的有效配置 | 使用自定义权限、命名方案和 reviewer 等设置   |

后端以已保存设置为准，不使用旧页面消息中的权限值。变更影响尚未启动的轮次：已执行的轮次保持原策略，排队任务启动时读取当时设置。保存失败保留原值并显示错误，不支持为不同会话分别固定权限预设。

例如会话 A 正以 Full access 执行，在 B 中改为 Ask when needed，A 当前轮不变，A 下一轮和尚未启动的排队任务使用 Ask。

选择 Ask、Full 或 Read-only 时，Web UI 应用预设并将 reviewer 设为 `user`；workspace 配置不覆盖该选择。仅 **Use config.toml** 会在下一轮前应用当前目录的有效配置。Web UI 设置不修改 CLI 或 VS Code 的 `config.toml`。

Ask when needed 将当前会话目录额外加入可写范围，不开放整个 `CODEX_HOME`；只读模式不允许 Agent 写文件。Use config.toml 下，传统 workspace-write 配置也加入会话目录，命名权限方案保持原定义，需在方案内允许对应访问。

### 自定义权限配置

Codex 权限由多个设置组合：

- `sandbox_mode`：文件和网络访问边界，支持 `read-only`、`workspace-write`、`danger-full-access`。
- `approval_policy`：何时进入审批，支持 `on-request`、`never` 或 `granular` 对象。
- `approvals_reviewer`：审批者，`user` 或 `auto_review`；后者不扩大 sandbox，也不审核 sandbox 内已允许的操作。

`workspace-write + never` 仍受 sandbox 限制；`danger-full-access + on-request` 没有工作区 sandbox 边界，不表示所有危险操作都会先询问。Full access 为 `danger-full-access + never`，只用于可信环境。[Sandbox 与审批说明](https://developers.openai.com/codex/sandboxing)

Web UI 没有单独的自动 reviewer 或 granular 按钮，需要这些配置时选择 **Use config.toml**。以下示例分别使用，不合并重复的顶层键。

#### Ask for approval

```toml
sandbox_mode = "workspace-write"
approval_policy = "on-request"
approvals_reviewer = "user"
```

#### Approve for me

保持 workspace sandbox，将符合条件的审批请求交给自动 reviewer：

```toml
sandbox_mode = "workspace-write"
approval_policy = "on-request"
approvals_reviewer = "auto_review"
```

#### 受限自动执行

在 workspace sandbox 内执行，越界操作直接拒绝或失败：

```toml
sandbox_mode = "workspace-write"
approval_policy = "never"
```

#### Read-only

```toml
sandbox_mode = "read-only"
approval_policy = "on-request"
approvals_reviewer = "user"
```

#### Granular approval

`granular` 按类别控制审批：`true` 允许进入审批流程，`false` 自动拒绝。支持 sandbox 提权、命令规则、MCP elicitation、权限申请和 Skill 脚本：

```toml
sandbox_mode = "workspace-write"
approvals_reviewer = "user"
approval_policy = { granular = { sandbox_approval = true, rules = true, mcp_elicitations = false, request_permissions = true, skill_approval = true } }
```

`approval_policy = "untrusted"` 已不再是可直接选择的策略，`on-failure` 已弃用；旧配置应改用受支持的策略。项目的 `trust_level = "untrusted"` 是另一项设置，仍可用于项目级信任管理。[Codex 配置参考](https://developers.openai.com/codex/config-reference/)

保留 workspace sandbox 并扩展指定目录：

```toml
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
writable_roots = ["/srv/shared"]
network_access = false
```

`writable_roots`、`network_access` 和临时目录选项只调整 workspace sandbox 边界。使用命名权限方案时，不要将 `default_permissions` 与旧式 `sandbox_mode` 或 `[sandbox_workspace_write]` 混用。[Codex 配置参考](https://developers.openai.com/codex/config-reference/)

## 部署

### 2 核 2 GB Linux 示例

准备专用用户，确保该用户已登录 `codex`，并能访问项目和 workspace。以下以项目 `/srv/codex-webui-lite`、用户 `codex` 为例，在该用户的终端执行：

```bash
cd /srv/codex-webui-lite
npm ci
npm run build
mkdir -p /home/codex/workspace

export CODEX_WEB_HOST=127.0.0.1
export CODEX_WEB_PORT=8765
export CODEX_WEB_BASE_PATH=/codex
export CODEX_WEB_MAX_TURNS=1
export CODEX_WEB_DEFAULT_WORKSPACE=/home/codex/workspace
export CODEX_WEB_AUTH='codex:替换为强密码'
npm start
```

先通过 `http://127.0.0.1:8765/codex/` 确认服务正常。远程访问交给 Nginx HTTPS 代理，代理路径与 `CODEX_WEB_BASE_PATH` 一致。

### 后台脚本

生产构建完成后，在项目根目录执行。脚本直接启动 `dist-server/index.js`，关闭终端后 Node 和 Codex 仍运行，但机器重启后不会自动恢复。

Linux / macOS：

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

Windows 执行策略阻止脚本时，可仅对本次命令放行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-web.ps1 start
```

脚本读取执行 `start` / `restart` 时的环境变量，不保存配置，也不加载 `.env`。例如：

```bash
export CODEX_WEB_BASE_PATH=/codex
export CODEX_WEB_PORT=8765
export CODEX_WEB_MAX_TURNS=1
mkdir -p "$HOME/workspace"
export CODEX_WEB_DEFAULT_WORKSPACE="$HOME/workspace"
./scripts/codex-web.sh start
```

```powershell
$env:CODEX_WEB_BASE_PATH = "/codex"
$env:CODEX_WEB_PORT = "8765"
$env:CODEX_WEB_MAX_TURNS = "1"
New-Item -ItemType Directory -Force -Path "$HOME/workspace" | Out-Null
$env:CODEX_WEB_DEFAULT_WORKSPACE = "$HOME/workspace"
.\scripts\codex-web.ps1 start
```

换终端重启时需重新设置全部所需变量；已运行时再次 `start` 不更新配置。日志和 PID 保存在 `.run/`，不会提交到 Git；Linux 日志为 `codex-web.log`，Windows 为 `codex-web.out.log` 和 `codex-web.error.log`。查看日志时按 `Ctrl+C` 只退出日志查看。

### systemd

长期运行可使用 systemd。替换项目路径、Node 路径和用户，不与后台脚本同时管理同一实例。

创建 `/etc/codex-web.env`，按 `command -v codex` 的结果调整 `PATH`，按 `command -v node` 调整后面的 `ExecStart`：

```ini
CODEX_WEB_HOST=127.0.0.1
CODEX_WEB_PORT=8765
CODEX_WEB_MAX_TURNS=1
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
WorkingDirectory=/srv/codex-webui-lite
Environment=HOME=/home/codex
EnvironmentFile=/etc/codex-web.env
ExecStart=/usr/bin/node --max-old-space-size=256 /srv/codex-webui-lite/dist-server/index.js
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

以上资源值用于 2 核 2 GB 主机：`MemoryHigh` 在接近 1.4 GB 时施加回收压力，`MemoryMax` 将 Web UI、Codex 及其子进程组限制在约 1.65 GB，为系统留出约 400 MB。资源项需 cgroup/systemd 支持，不支持的属性可移除。

启用服务并查看日志：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codex-web
sudo systemctl status codex-web
sudo journalctl -u codex-web -f
```

修改环境文件后执行 `sudo systemctl restart codex-web`；修改 service 文件后先 `daemon-reload` 再重启。源码更新后先构建：

```bash
cd /srv/codex-webui-lite
npm run build
sudo systemctl restart codex-web
```

### 访问认证

设置 `CODEX_WEB_AUTH` 保护页面、静态资源和 API。浏览器显示用户名与密码登录框，错误凭据返回 `401`。后台脚本示例，执行前保留其他所需变量：

```bash
export CODEX_WEB_AUTH='username:password'
./scripts/codex-web.sh restart
```

```powershell
$env:CODEX_WEB_AUTH = "username:password"
.\scripts\codex-web.ps1 restart
```

不设置或删除变量并重启可关闭认证：

```bash
unset CODEX_WEB_AUTH
./scripts/codex-web.sh restart
```

systemd 使用环境文件设置。用户名、密码均不能为空，只把第一个冒号作为分隔符，密码可包含额外冒号；格式错误时拒绝启动。

Basic Auth 仅对凭据做 Base64 编码，不加密连接。非本机网络访问需使用 HTTPS，不能直接将明文 HTTP 服务暴露到公网。

### Nginx 反向代理

将以下配置放入已配置 HTTPS 的 Nginx `server`，并设置 `CODEX_WEB_BASE_PATH=/codex`：

```nginx
location /codex/ {
    proxy_pass http://127.0.0.1:8765/codex/;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 75s;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

页面、静态资源、SSE 和操作 API 使用同一子路径。关闭响应缓冲以及时传输增量，允许长连接，并保留含非默认端口的 `Host` 供后端来源检查使用。

文件链接也保留子路径，例如 `/codex/?file=src%2Fserver%2Fusers.ts` 可在 Files 中预览。Nginx 负责 TLS 和代理，Node 负责管理 Codex、桥接协议和提供文件接口。

## 演示

### 服务内演示

在已启动服务中访问：

| 地址                                    | 场景                     |
| --------------------------------------- | ------------------------ |
| `http://127.0.0.1:8765/?demo=1`         | 聊天与模拟流式回复       |
| `http://127.0.0.1:8765/?demo=questions` | 多问题、选项和自定义回答 |
| `http://127.0.0.1:8765/?demo=plan`      | 计划确认与修改           |

子路径部署时补上对应路径。演示操作在浏览器中模拟，不发送模型任务，但 Web 服务本身仍启动 Codex。

### 纯静态 mock

从已有前端构建导出：

```bash
npm run mock:export
```

导出器读取 `dist/`，生成 `dist-mock/`，不运行构建、不启动服务、不修改真实页面。缺少 `dist/` 时需先构建；源码更新后也需先更新前端产物。重新导出会清空并替换 `dist-mock/`。

将整个 `dist-mock/` 交给静态服务器。Nginx 示例为 [`deploy/nginx-mock.conf`](deploy/nginx-mock.conf)，替换 `root` 后放入已包含的配置目录并重新加载；示例监听 `8080`。

页面顶部显示 **Static mock · 无后端** 并提供聊天、提问和计划场景链接。会话操作、预览、审批和模型选择使用演示数据，刷新后重置；托管时无需 CDN、Node、Codex 登录或 API 代理。真实文件下载、持久化和运行时管理需要后端。

静态资源使用相对路径。例如复制到 `/srv/www/codex-mock/` 后，在已有 `root /srv/www;` 的 Nginx `server` 中加入：

```nginx
location = /codex-mock {
    return 301 /codex-mock/$is_args$args;
}
location /codex-mock/ {
    try_files $uri $uri/ =404;
    add_header Cache-Control "no-cache";
}
```

访问 `/codex-mock/`，保留末尾 `/`。聊天默认使用 `/`，问题和计划场景分别为 `/?demo=questions`、`/?demo=plan`。

## 开发与维护

### 开发运行

```bash
cd /path/to/codex-webui-lite
npm install
npm run dev
```

默认地址为 `http://127.0.0.1:8765/`，不需要已有 `dist/` 或 `dist-server/`，环境变量与生产相同。前端由 Vite 即时加载，后端通过 `tsx server/index.ts --dev` 运行；后端未启用自动重启，修改 `server/` 后需手动重启。

### 目录与构建

| 路径           | 用途                               |
| -------------- | ---------------------------------- |
| `src/`         | React / TypeScript 前端源码        |
| `server/`      | Node / TypeScript 服务端源码       |
| `scripts/`     | 启停、静态导出、压缩与验证脚本     |
| `tests/`       | 事件流、事件重放和会话列表合并回归 |
| `deploy/`      | 部署配置示例                       |
| `dist/`        | Vite 生成的前端文件                |
| `dist-server/` | TypeScript 生成的服务端 JavaScript |
| `dist-mock/`   | 导出的纯静态演示                   |

`src/` 和 `server/` 分别构建到 `dist/` 和 `dist-server/`。生成目录已加入 `.gitignore`，不要手动修改或提交，可删除后重新构建。

`npm start` 实际执行以下命令，也可在构建后直接运行，减少 npm 父进程：

```bash
node --max-old-space-size=256 dist-server/index.js
```

### 格式化与验证

| 命令                   | 作用                                         |
| ---------------------- | -------------------------------------------- |
| `npm run format`       | Prettier 格式化源码与文档                    |
| `npm run format:check` | 仅检查格式                                   |
| `npm test`             | 不连接真实 Codex 的自动回归                  |
| `npm run build`        | 类型检查、前端构建、静态资源压缩和服务端编译 |

Prettier 配置在 [`.prettierrc.json`](.prettierrc.json)，生成目录、依赖、运行文件和 npm 管理的 `package-lock.json` 通过 [`.prettierignore`](.prettierignore) 排除。

浏览器脚本依赖 Python Playwright、Chromium 和已启动的 Web 服务。目前包含原开发机的 Chromium 路径及部分旧 UI 选择器，运行前需按本机环境和当前界面调整：

- [`scripts/verify_ui.py`](scripts/verify_ui.py)：检查演示界面、服务连接和历史恢复，截图保存到 `artifacts/screenshots/`。
- [`scripts/verify_streaming.py`](scripts/verify_streaming.py)：向真实 Codex 发送消息与附件，执行任务并产生用量。

两者通过 `CODEX_WEB_VERIFY_URL` 指定目标，默认 `http://127.0.0.1:8876/codex/`，使用已安装 Playwright 的 Python 环境运行。

### 内存与连接

浏览器使用一条 SSE 连接接收增量，状态和会话标题变化时服务端合并读取单个摘要后推送，避免轮询整个列表。列表刷新保留已加载的历史页和条目位置。

会话按每页 30 个原始 item 加载，更早内容按需读取，不截断到最后 500 个 item。Node 不缓存完整会话，优先使用 `thread/items/list`；旧版 Codex 回退到 `thread/read`，可能一次返回完整历史，超长会话可升级 Codex。恢复请求串行执行并限制排队数量；任务耗时使用不加载 item 的轮次元数据分页读取。

会话响应不含原始 `turns`，工具输出和 diff 有首包上限；生成图片通过受保护 URL 单独读取，避免重复传输 Base64。Settings 关闭时不持续读取资源数据。

| 项目        | 限制或行为                                                       |
| ----------- | ---------------------------------------------------------------- |
| 事件缓冲    | 同时限制 1000 条和 8 MiB                                         |
| SSE 补发    | 通常每批最多 512 KiB，单条较大事件单独发送                       |
| 心跳与重连  | 每 15 秒心跳，超时退避重连；慢客户端暂停写入，持续阻塞时断开     |
| HTTP 请求体 | 最大 16 MiB，大请求最多同时处理 1 个                             |
| 文件处理    | 预览、写入和上传最多同时处理 2 个，繁忙时返回可重试错误          |
| 静态资源    | 构建时生成 Brotli / Gzip，生产流式发送；缺少压缩产物时使用原文件 |

短暂断线静默恢复，持续超过 4 秒才显示可重试错误。游标失效、落后于缓冲窗口或服务重启时重新同步当前会话，保留侧边栏分页和滚动位置。

`codex app-server` 在 Web UI 启动时加载并常驻。首屏等待模型和会话列表就绪；Settings 提供 Start、Stop、Restart，显示 PID、状态和错误。

原有生产验证的参考值，实际占用随版本、任务和工具变化：

| 进程                 | 参考值       |
| -------------------- | ------------ |
| Web UI Node RSS      | 约 76–79 MB  |
| Codex app-server RSS | 约 92–129 MB |
| Node V8 heap 上限    | 256 MB       |

RSS 包含 Buffer 和原生内存，可能高于 heap usage，Codex 是独立子进程。Linux Resources 面板统计 Node、app-server、仍在进程树中的工具/MCP 子进程 RSS 和事件缓冲；共享内存可能重复计入，脱离进程树的服务不在统计中。Windows 无 `/proc`，子进程采样不可用。

并发限制只调度 Web UI 任务并等待已发现的外部会话，不限制其他 Codex 实例、编译器或 MCP 进程。项目构建、浏览器自动化和大型工具仍可能超过 2 GB 主机容量，需按任务控制资源；长期运行可配合 systemd。

## 常见问题

### 找不到 dist-server/index.js

先在项目根目录执行 `npm run build`，再启动服务。`npm start` 不自动构建。

### 模块 MIME 类型为 text/html

检查生产构建是否最新，`CODEX_WEB_BASE_PATH` 是否与 Nginx `location` 和 `proxy_pass` 一致，以及代理是否覆盖整个子路径，包括静态资源和 API。

### 新对话无法发送或未使用默认目录

1. 确认已选择 workspace；查看已有会话不要求预先选择目录。
2. 检查 `CODEX_WEB_DEFAULT_WORKSPACE` 是否指向存在且服务账号可访问的目录。
3. 确认变量传给了 Web 服务进程。shell 需在启动前 `export`，systemd 修改环境文件后需重启；仅写 `.env`、在其他终端设置或重启页面中的 Codex 均不生效。
4. 检查日志中的 `Ignoring invalid CODEX_WEB_DEFAULT_WORKSPACE`，修复后重启服务并重新载入页面；源码更新时先重新构建。
5. 点击 **New thread** 检查。旧的 `?session=<id>` 地址和分支仍使用原会话目录。

附件和独立交付文件查看 **Session files**，默认 workspace 只控制新会话的 `cwd`。

### 修改配置后未生效

环境变量需重启 Web 服务；全局权限从尚未启动的轮次生效。后台脚本不保存上次环境，换终端执行 `restart` 前需重新设置；已运行时再次 `start` 不更新配置。

### 多个会话只有一个在执行

默认 `CODEX_WEB_MAX_TURNS=1`。在启动前设为 `2`、`3` 或 `4` 并重启 Web 服务；等待回答、审批和已发现的外部运行会话也占用名额。完整规则见[并发与排队](#并发与排队)。

### 流式回复延迟或连接中断

检查 Nginx 是否关闭响应缓冲、允许 SSE 长连接并保留浏览器 Host，参照[反向代理配置](#nginx-反向代理)。短暂断线会自动恢复。

### 系统通知不出现

确认通过 HTTPS 或 localhost 访问、网页保持打开，浏览器站点权限允许通知；在 Settings 使用 **Send test notification** 检查。已拒绝的权限需在站点设置中重新允许，也检查系统勿扰模式。

### Account usage 显示 Unavailable

当前 Codex 认证方式未提供账号 usage / rate-limit 数据，不影响对话、文件和会话功能。

## 许可证

[MIT License](LICENSE)
