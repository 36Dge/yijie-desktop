# 终版决策记录

## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 来源：基于项目方反馈固化
- 生效范围：`yijie-desktop` Design System / UX 规范

## P0 决策

| 编号 | 决策项 | 终版结果 | 落地位置 |
|---|---|---|---|
| P0-01 | 品牌主色 | `#95BF47`；hover/active/soft 由本规范派生 | `02-tokens/02-color-tokens.md` |
| P0-02 | Logo 与 App Icon | 初始生成：手提袋 + YJ 字母 | `03-ui-system/06-brand-assets.md`、`docs/design/docs/public/brand/` |
| P0-03 | 产品显示名称 | 中文：易界；英文/技术名：yijie；品牌缩写：YJ/YIJIE | 全局文案与品牌资产 |
| P0-04 | 视觉气质 | 专业可信、清爽高效、数据驱动、AI 可控、跨境经营感 | `01-foundations/03-brand-personality.md` |
| P0-05 | 默认主题 | 跟随系统 | `03-ui-system/05-theme-dark-mode.md` |
| P0-06 | 主图标库 | Lucide | `03-ui-system/02-iconography.md` |
| P0-07 | 页面密度 | 标准 | `01-foundations/06-window-density-baseline.md` |
| P0-08 | 最小窗口尺寸 | 最小 1180 × 760；推荐 1280 × 820 | `01-foundations/06-window-density-baseline.md` |
| P0-09 | 首批核心页面范围 | 首批页面优先级一致，不区分先后 | `05-patterns/` |
| P0-10 | Figma/品牌稿 | 无；本规范提供初始可落地资产 | `docs/design/docs/public/brand/` |

## P1 决策

| 编号 | 决策项 | 终版结果 | 落地位置 |
|---|---|---|---|
| P1-01 | 图表库 | ECharts | `03-ui-system/04-data-visualization.md` |
| P1-02 | 图表色板 | 本规范定义趋势、类目、风险、对比色 | `03-ui-system/04-data-visualization.md` |
| P1-03 | 插画风格 | 线性 | `03-ui-system/03-illustration-imagery.md` |
| P1-04 | 文案语气 | 专业 | `06-content/01-copywriting.md` |
| P1-05 | 国际化范围 | 中文 | `06-content/02-i18n-l10n.md` |
| P1-06 | 品牌图标来源 | 官方素材优先 | `03-ui-system/02-iconography.md` |
| P1-07 | 操作审批策略 | 后期由业务策略定义；本规范只定义 UI 承接 | `08-governance/06-deferred-policy-decisions.md` |
| P1-08 | Agent 风险等级 | 后期由业务策略定义；本规范只定义展示接口 | `08-governance/06-deferred-policy-decisions.md` |

## 不再保留的待确认项

本规范不再保留 P0/P1 待确认项。审批策略和 Agent 风险等级不是设计系统缺失，而是明确纳入后续业务策略治理；当前 UI 必须以“可承接后续策略”为原则设计。

## 对 AI/Codex 的意义

AI/Codex 不需要再猜测以下内容：品牌色、默认主题、图标来源、页面密度、图表库、插画风格、文案语气、语言范围。任何新页面、新组件、新样式都必须按本决策执行。
