# Architecture

`yijie-desktop` 是卖家的唯一客户端入口。它通过 `yijie-api` 创建和查询任务，通过本地或云端 `yijie-agent-host` 驱动 Codex Runtime，并展示工具调用审批和任务结果。UI 组件库使用 Naive UI。

## 目录

- `src/router/`：桌面端路由；
- `src/stores/`：Pinia 状态；
- `src/pages/`：Chat、任务、设置等页面；
- `src/api/`：API client 占位；
- `src-tauri/`：Tauri v2 shell 和本地命令；
- `sidecars/`：未来放置 Codex 与 Agent Host sidecar。

Tauri 只启用主窗口所需的最小 capability。WebView CSP 仅允许本地 IPC、API 和 Agent Host 端口；新增远端域名或系统权限必须先完成安全评审并更新 capability。
