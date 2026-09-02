# yijie-desktop

易界 AI Mac 桌面端，使用 Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI 和 pnpm。

## 仓库职责

- 卖家登录和店铺授权引导；
- Chat 对话流；
- Agent 任务进度展示；
- 工具调用审批；
- Listing、广告、合规、物流、经营分析等工作流入口；
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

标准 Tauri 本地启动默认使用无需用户登录的 Demo 快速闭环入口：

```bash
pnpm tauri:dev
```

`pnpm tauri:demo-fast` 是同一入口的显式别名。两者都会直达 Chat 主页面并自动启动本地
Agent Host / Codex Runtime。只有明确调试底层 Tauri 且不需要完整业务环境时才使用
`pnpm tauri:dev:raw`。详细边界见
[`docs/local-development.md`](docs/local-development.md)。

```bash
pnpm install
pnpm dev
```

底层 Tauri 调试（不装配完整业务环境）：

```bash
pnpm tauri:dev:raw
```

设计系统文档：

```bash
pnpm docs:dev
```

前端 UI 与交互规范位于 `docs/design/docs/design/`。

## 测试与构建

```bash
pnpm lint
pnpm test
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

`pnpm test` 默认执行 `demo_fast` 测试面，不运行历史 S10D-H production harness checker。
只有明确验证 `production_hardened` 时运行 `pnpm test:production-hardened` 或
`make test-production-hardened`；该入口保留 S10D-H checker，在其 WAL/axe RCA 完成前应继续如实失败。

## 安全要求

桌面端不得持久化平台 access token。高风险工具调用必须展示审批卡片，并由 `yijie-api` 与 `yijie-agent-host` 执行策略校验。

FEAT-125 本地类生产认证环境的受限 CA、`localhost` origin、Keychain v2 迁移与签名验证边界见
[`docs/security/FEAT-125-G3-NP-LOCAL.md`](docs/security/FEAT-125-G3-NP-LOCAL.md)。
