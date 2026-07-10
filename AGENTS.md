# AGENTS.md

## 仓库职责

`yijie-desktop` 是易界 AI 面向卖家的 Mac 桌面端，负责登录、店铺授权引导、Chat、Agent 任务进度、工具调用审批、结果展示、本地 sidecar 管理和 Mac App 发布。

## 禁止事项

- 不实现 Admin 管理后台；
- 不直接处理平台 access token；
- 不实现连接器 API 调用；
- 不维护 Codex Runtime 源码；
- 不绕过审批策略执行高风险操作。

## 技术栈

Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、pnpm、Rust。

## Design System / UX 规则

- 所有前端 UI 代码必须遵守 `docs/design/docs/design/` 下的设计系统规范。
- 复杂页面或交互改动前，必须先阅读对应 pattern、component、token 或 AI/Codex 规则文档。
- Naive UI 只能通过集中主题覆盖接入；图表使用 ECharts 与易界图表主题。
- 图标必须通过 `YjIcon` 和 `src/icons/registry.ts` 使用，不允许页面直接引入任意图标库。
- 不允许硬编码颜色、字号、间距、圆角、阴影或 z-index；必须使用 design token 和 CSS variables。
- 新页面应优先复用 `YjPage`、`YjPageHeader`、`YjSection`、`YjCard`、`YjMetricCard`、`YjDataTable`、`YjChartCard` 等 `Yj*` 组件。
- 页面必须覆盖 loading、empty、error、permission denied 和 ready 状态。
- 界面文案默认中文，语气专业；亮色和暗色主题都必须可用。
- 涉及店铺、广告、Listing、库存、价格、买家消息等高影响操作时，必须包含确认或审批 UI 承接点。
- 不提交真实卖家数据、平台 token、cookie、凭据或未授权品牌资产。

## 开发命令

```bash
pnpm install
pnpm dev
pnpm tauri:dev
pnpm build
pnpm docs:dev
```

## 安全要求

本地敏感信息必须使用系统 Keychain 或后续安全存储方案。平台 token 不得持久化在前端存储中。
