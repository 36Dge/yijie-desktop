# 终版决策记录

## 文档状态

- 状态：Accepted
- 色彩与品牌基线版本：2.0.0
- 最后更新：2026-09-05
- 来源：基于项目方反馈固化；2026-09-05 用户明确授权以已选配色与截图 Logo 覆盖规范的色彩、主题及品牌部分
- 生效范围：`yijie-desktop` Design System / UX 规范

## P0 决策

| 编号 | 决策项 | 终版结果 | 落地位置 |
|---|---|---|---|
| P0-01 | 品牌主色与空间 | A「清爽青柠」＋01「纯白通透」；青柠 `#C3F35B` + 石墨 `#25282B`；亮色背景、导航、卡片 `#FFFFFF`，以留白、间距、细中性边框分层 | `02-tokens/02-color-tokens.md` |
| P0-02 | Logo 与 App Icon | 使用用户截图中的商品包裹折面 + YJ 负形，重建为 SVG 矢量资产；提供亮色、暗色与单色适配 | `03-ui-system/06-brand-assets.md`、`docs/design/docs/public/brand/` |
| P0-03 | 产品显示名称 | 中文：易界；英文/技术名：yijie；品牌缩写：YJ/YIJIE | 全局文案与品牌资产 |
| P0-04 | 视觉气质 | 专业可信、清爽高效、数据驱动、AI 可控、跨境经营感 | `01-foundations/03-brand-personality.md` |
| P0-05 | 默认主题 | 跟随系统；暗色采用中性石墨背景 `#191C20`、卡片 `#25282B`、弹层 `#2E3237`、主文字 `#F5F7FA`，品牌青柠同亮色 | `03-ui-system/05-theme-dark-mode.md` |
| P0-06 | 主图标库 | Lucide | `03-ui-system/02-iconography.md` |
| P0-07 | 页面密度 | 标准 | `01-foundations/06-window-density-baseline.md` |
| P0-08 | 最小窗口尺寸 | 最小 1180 × 760；推荐 1280 × 820 | `01-foundations/06-window-density-baseline.md` |
| P0-09 | 首批核心页面范围 | 首批页面优先级一致，不区分先后 | `05-patterns/` |
| P0-10 | Figma/品牌稿 | 以用户确认的 Logo 截图为形态参考，以本规范 SVG 为工程资产；无 Figma 文件 | `docs/design/docs/public/brand/` |

本次只替换色系搭配、主题和 Logo；其余基础决策、页面布局、组件及行为规则保持有效。详见 [2.0.0 更新记录](./08-governance/07-lime-white-brand-refresh.md)。

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
