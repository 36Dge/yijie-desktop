# Architecture

`yijie-desktop` 是卖家的唯一客户端入口。公开或生产形态通过 `yijie-api` 创建和查询任务；本地
`demo_fast` 形态使用 Rust 固定身份/租户投影和本地 public-task binding，不依赖 API 或 IdP 启动。
两种形态都通过本地或云端 `yijie-agent-host` 驱动 Codex Runtime，并展示工具调用审批和任务结果。
UI 组件库使用 Naive UI。

## 目录

- `src/router/`：桌面端路由；
- `src/stores/`：Pinia 状态；
- `src/pages/`：Chat、任务、设置等页面；
- `src/api/`：API client 占位；
- `src-tauri/`：Tauri v2 shell 和本地命令；
- `sidecars/`：未来放置 Codex 与 Agent Host sidecar。

Tauri 只启用主窗口所需的最小 capability。WebView CSP 仅允许本地 IPC、API 和 Agent Host 端口；新增远端域名或系统权限必须先完成安全评审并更新 capability。

FEAT-125 S5A 将 OIDC code flow、系统浏览器打开、loopback callback、token 刷新和
`GET /v1/me/tenants` / `GET /v1/me/capabilities` 固定传输保留在 Rust 边界内。WebView
不接收 access/refresh token，也不能传入 URL、HTTP method、任意 header 或 body。该能力默认关闭；
生产 IdP 与 API origin 在 G3/G5 前不得配置或激活。

## Local Demo direct-entry

`YIJIE_ENV=local + YIJIE_LOCAL_PROFILE=demo_fast` 只用于快速本地业务验证。标准入口是
`pnpm tauri:dev`，`pnpm tauri:demo-fast` 是同一启动器的显式别名；启动器同时设置
renderer/native profile、清除 OIDC/白名单/专项测试残留，
Desktop 启动后直接进入 `/chat`。该模式不显示或接收账号、密码、登录、退出登录，不请求
`/v1/me/*` 或 `/v2/tasks`。Rust 仍严格校验固定 owner、tenant、authorization revision、capability、
session 与 Artifact scope；Agent Host 的 owner-only loopback token 和 MiniMax Key 文件仍作为机器凭据保留。
缺少精确 local conjunction 时继续使用原鉴权路径。决策见中央仓 ADR-0018。

## FEAT-128 Structured Artifact native boundary

FEAT-128 S4 在 Rust/Tauri 边界内提供默认关闭的 structured Artifact authority。权威公共 wire 固定到
`yijie-contracts@ea48fe190e18afba728712d1e2cc79cda57f581b`；Desktop 只接受 v3 closed event/report schema，
校验 owner/session identity、canonical Host href、MIME、大小、SHA-256 与内容 magic，然后直接写入 SQLCipher
schema v8 BLOB。安全提交与 pending ACK intent 在同一事务完成；ACK 丢失可幂等重放，内容从本地 commit 起
保留 168 小时，过期清除写入 content-free receipt，session 删除通过外键级联并显式复核。

私有 `chat_load_history_v3` 只返回 opaque Artifact ID、类型、provenance、状态、单调进度和安全展示 metadata；
不返回正文、digest、Host href、绝对路径、token 或临时预览句柄。该只读 command 是 S4 唯一新增 WebView
边界；本切片没有资源正文读取面、capability、CSP、外部 origin、renderer/store、保存对话框或真实 provider
集成。native transfer 只有 `YIJIE_CHAT_ARTIFACTS_V3_ENABLED=true` 时可创建，未设置或任何其他值均关闭；
flag 关闭后已持久化 metadata 仍可只读恢复。这些后续能力分别留给 S5-S9，并继续受独立安全门禁约束。
