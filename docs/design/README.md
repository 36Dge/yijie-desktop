# 易界 yijie Design System / UX 规范文档包

这是 `yijie-desktop` 的终版 Design System / UX 规范，面向人类研发、设计、产品与 AI/Codex 协作开发。

## 已确认的关键决策

- 品牌主色：`#95BF47`。
- Hover / active / soft：由本规范按 token 规则派生。
- Logo 与 App Icon：初始方案由本规范生成，形态为“手提袋 + YJ 字母”。
- 产品显示名称：中文 `易界`，英文/技术命名 `yijie`，品牌缩写 `YJ` / `YIJIE`。
- 默认主题：跟随系统。
- 主图标库：Lucide。
- 页面密度：标准。
- 最小窗口尺寸：1180 × 760；推荐默认窗口 1280 × 820。
- 图表库：ECharts。
- 插画风格：线性。
- 文案语气：专业。
- 国际化范围：中文。
- 品牌图标来源：官方素材优先。
- 操作审批策略、Agent 风险等级：后期由业务策略定义；本规范只定义 UI 承接方式。

## 使用方式

```bash
pnpm install
pnpm docs:dev
```

打开本地 VitePress 站点后，从首页进入 `Design System`。

## 推荐落地位置

```text
yijie-desktop/
  docs/design/       # 设计系统文档站与可迁移代码骨架
  src/design/        # 根据 exports/src/design 落地 token 与主题
  src/styles/        # 根据 exports/src/styles 落地 CSS variables
  src/icons/         # 根据 exports/src/icons 落地图标注册表
  src/components/yijie/
```

## 给 Codex 的最重要规则

所有 UI 代码必须遵守 `docs/design/docs/design/07-ai-codex/01-ai-development-rules.md`，尤其是：

- 不允许硬编码品牌色、状态色、字号、圆角、阴影。
- 图标必须通过 `YjIcon` 与 `src/icons/registry.ts` 使用。
- 新页面必须优先复用 `YjPage`、`YjPageHeader`、`YjCard`、`YjMetricCard`、`YjDataTable`、`YjAgentTimeline` 等业务组件。
- 涉及店铺、广告、Listing、库存、价格、买家消息等高影响操作时，UI 必须接入审批/确认能力，即便审批策略后期才由业务定义。
