# 颜色 Tokens


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界品牌色、文本色、背景色、边框色、状态色、Agent 色和图表色。

## 适用范围

适用于所有 UI 颜色，包括 Naive UI 主题、业务组件、图标、图表和状态反馈。

## 规范正文

## 品牌主色

品牌主色：`#95BF47`。

## 品牌色派生规则

在亮色主题中：

| Token | 值 | 用途 |
|---|---|---|
| `--yj-color-brand-primary` | `#95BF47` | 主按钮、选中态、品牌强调 |
| `--yj-color-brand-hover` | `#A3C95C` | hover |
| `--yj-color-brand-active` | `#7FA33C` | active / pressed |
| `--yj-color-brand-soft` | `#F3F8EA` | 轻背景 |
| `--yj-color-brand-subtle` | `#E5F0D3` | 弱强调背景 |
| `--yj-color-brand-border` | `#D2E5B5` | 品牌弱边框 |
| `--yj-color-brand-text` | `#4E6325` | 浅背景上的品牌文字 |

在暗色主题中：

| Token | 值 | 用途 |
|---|---|---|
| `--yj-color-brand-primary` | `#A6CC62` | 暗色主按钮 |
| `--yj-color-brand-hover` | `#B4D679` | hover |
| `--yj-color-brand-active` | `#8CB241` | active |
| `--yj-color-brand-soft` | `rgba(149, 191, 71, 0.16)` | 暗色轻背景 |
| `--yj-color-brand-border` | `rgba(166, 204, 98, 0.32)` | 暗色品牌边框 |

派生逻辑：hover 轻微提亮，active 加深，soft 降低饱和并提高明度，暗色主题整体提高明度与对比。

## 文本色

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-text-primary` | `#18230F` | `#F4F7EF` | 主文本 |
| `--yj-color-text-secondary` | `#526046` | `#C6D0BC` | 次文本 |
| `--yj-color-text-tertiary` | `#7A8670` | `#98A58E` | 辅助说明 |
| `--yj-color-text-disabled` | `#AEB7A5` | `#687460` | 禁用 |

## 背景色

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-bg-app` | `#F7F9F3` | `#0F140C` | App 底色 |
| `--yj-color-bg-page` | `#FAFBF7` | `#141A10` | 页面底色 |
| `--yj-color-bg-card` | `#FFFFFF` | `#1B2316` | 卡片 |
| `--yj-color-bg-elevated` | `#FFFFFF` | `#222B1C` | 弹层 |
| `--yj-color-bg-subtle` | `#F1F5EA` | `#20281A` | 弱背景 |

## 状态色

| 状态 | 颜色 | 用途 |
|---|---|---|
| Success | `#16A34A` | 成功、完成、健康 |
| Warning | `#D97706` | 警告、需注意 |
| Error | `#DC2626` | 错误、失败、危险 |
| Info | `#2563EB` | 信息、提示 |
| Neutral | `#64748B` | 中性状态 |

## Agent 状态色

| 状态 | 色值 | 用途 |
|---|---|---|
| Thinking | `#8B5CF6` | 思考中 |
| Running | `#2563EB` | 执行中 |
| Waiting | `#D97706` | 等待用户/审批 |
| Success | `#16A34A` | 完成 |
| Failed | `#DC2626` | 失败 |
| Paused | `#64748B` | 暂停 |

## AI / Codex 必须遵守

- 不允许直接写 `#95BF47` 到业务组件中，必须使用 token。
- 不允许只用绿色表达所有正向状态。
- 不允许使用未经定义的红、黄、蓝、紫。
- 不允许用颜色作为唯一语义，需要配合文字、图标或状态标签。

## 实现要求

颜色落地到 `src/styles/variables.css`，Naive UI 主题从 CSS variables 引用。ECharts 色板从 chart token 引用，不单独定义散落数组。

## 验收清单

- [ ] 所有颜色来自 token。
- [ ] 亮色和暗色都定义。
- [ ] 状态色与品牌色区分清楚。
- [ ] Agent 状态色统一。
- [ ] 图表不破坏状态色语义。

## 关联文件

`exports/src/styles/variables.css`、`docs/design/docs/design/03-ui-system/04-data-visualization.md`
