# 易界 yijie Design System / UX 规范文档包

这是 `yijie-desktop` 的 Design System / UX 规范，面向人类研发、设计、产品与 AI/Codex 协作开发。当前色彩与品牌基线为 `2.0.0`，已接受 A「清爽青柠」＋01「纯白通透」。

## 已确认的关键决策

- 亮色背景、导航、卡片：纯白 `#FFFFFF`；主要文字：石墨 `#25282B`。
- 主操作与选中强调：青柠 `#C3F35B`，实色青柠上的文字、图标使用石墨。
- 空间层级：留白、间距和细中性边框；不再使用大面积灰底或浅绿底区分版块。
- Hover / active / soft：由颜色 token 统一定义，soft 仅用于局部交互状态。
- 暗色：石墨背景 `#191C20`、卡片 `#25282B`、弹层 `#2E3237`；主文字 `#F5F7FA`，青柠保持 `#C3F35B`。
- Logo 与 App Icon：采用用户确认的“商品包裹折面 + YJ 负形”，使用真实矢量 SVG。
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

## 本次更新边界

本次覆盖色系搭配、主题映射、品牌资产及其使用规则。字体、间距尺度、圆角尺度、布局结构、组件 API、交互、权限和内容规则继续有效。新需求与现有页面后续改造均使用新基线；规范与 `exports/` 是文档和迁移参考，本次不代表活跃 `src/` 已完成视觉迁移。

决策与迁移说明见 [色彩与品牌更新记录](docs/design/08-governance/07-lime-white-brand-refresh.md)。

## 使用方式

```bash
pnpm install
pnpm docs:dev
```

从 `yijie-desktop` 根目录执行 `pnpm docs:build` 会依次校验 SVG 与母版一致性、规范站和参考导出的 TypeScript / Vue 类型，再构建文档。单独校验参考代码可执行 `pnpm --dir docs/design typecheck:reference`；此命令使用设计目录内独立 `tsconfig.json`，不代表活跃应用已完成视觉迁移。

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
