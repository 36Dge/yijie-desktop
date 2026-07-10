# yijie-desktop

易界 AI Mac 桌面端，使用 Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI 和 pnpm。

## 仓库职责

- 卖家登录和店铺授权引导；
- Chat 对话流；
- Agent 任务进度展示；
- 工具调用审批；
- Listing、广告、合规、物流、经营分析等工作台入口；
- 本地 Codex / Agent Host sidecar 管理；
- Mac App 签名、打包和自动更新。

## 不负责什么

- 不负责 Admin 管理后台；
- 不负责业务后端主状态；
- 不负责平台 API token 管理；
- 不负责连接器实现；
- 不负责 RAG 检索实现；
- 不负责 Codex 源码维护。

## 本地开发

```bash
pnpm install
pnpm dev
```

Tauri 开发：

```bash
pnpm tauri:dev
```

设计系统文档：

```bash
pnpm docs:dev
```

前端 UI 与交互规范位于 `docs/design/docs/design/`。

## 测试与构建

```bash
pnpm lint
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 安全要求

桌面端不得持久化平台 access token。高风险工具调用必须展示审批卡片，并由 `yijie-api` 与 `yijie-agent-host` 执行策略校验。
