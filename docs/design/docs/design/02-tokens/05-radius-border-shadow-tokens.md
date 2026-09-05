# 圆角、边框与阴影 Tokens


## 文档状态

- 状态：Accepted
- 版本：2.0.0
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义卡片、按钮、输入框、弹窗、标签、面板等组件的圆角、边框和层级阴影。

## 适用范围

适用于所有容器、控件、弹层和业务组件。

## 规范正文

## 圆角

| Token | 值 | 用途 |
|---|---|---|
| `radius-xs` | 4px | 小标签、状态点 |
| `radius-sm` | 6px | Tag、Badge |
| `radius-md` | 8px | 按钮、输入框 |
| `radius-lg` | 12px | 卡片、表格容器 |
| `radius-xl` | 16px | 弹窗、抽屉、重要容器 |
| `radius-full` | 999px | 头像、圆形按钮、状态点 |

## 边框

- `border-subtle`：弱边框，用于卡片分隔。
- `border-default`：默认控件边框。
- `border-strong`：分隔强边界；选中需同时配合可读文字与局部标记。
- `focus-ring`：键盘聚焦与关键交互边界，亮色使用 `#4B651D`、暗色使用 `#C3F35B`。浅边框不能独立承担 focus 提示。

| 边框 token | 亮色 | 暗色 |
|---|---|---|
| `--yj-color-border-subtle` | `#ECEEF0` | `#30363D` |
| `--yj-color-border-default` | `#E2E5E8` | `#414850` |
| `--yj-color-border-strong` | `#B8BEC5` | `#69717B` |

亮色页面、导航与卡片均为纯白；保持既有间距和圆角，通过留白与细边框区分区域，不新增灰底或绿灰底作为空间分层。

## 阴影

- `shadow-xs`：轻微悬浮。
- `shadow-card`：卡片悬浮。
- `shadow-popover`：Popover、Dropdown。
- `shadow-modal`：Modal、Drawer。

阴影必须克制，桌面端不使用大面积重阴影。普通静态卡片优先使用细边框；`shadow-card` 仅在需要表达悬浮关系时使用。亮色阴影使用中性石墨，去掉旧绿色阴影；暗色阴影使用黑色并配合边框建立层级。

| Token | 亮色 | 暗色 |
|---|---|---|
| `--yj-shadow-xs` | `0 1px 2px rgba(37, 40, 43, 0.06)` | `0 1px 2px rgba(0, 0, 0, 0.16)` |
| `--yj-shadow-card` | `0 8px 24px rgba(37, 40, 43, 0.08)` | `0 8px 24px rgba(0, 0, 0, 0.20)` |
| `--yj-shadow-popover` | `0 12px 32px rgba(37, 40, 43, 0.12)` | `0 12px 32px rgba(0, 0, 0, 0.28)` |
| `--yj-shadow-modal` | `0 24px 64px rgba(37, 40, 43, 0.18)` | `0 24px 64px rgba(0, 0, 0, 0.36)` |

本次只调整颜色和暗色透明度；阴影尺寸、圆角与间距值保持原规范。

## AI / Codex 必须遵守

- 不允许组件随意定义 9px、11px、18px 圆角。
- 不允许把普通卡片做成重阴影漂浮效果。
- 不允许弹窗和卡片使用同级阴影。
- 不允许删除可交互控件的 focus 边界。

## 实现要求

圆角、边框和阴影通过 token 和 Naive UI themeOverrides 落地。业务组件只使用语义 class，例如 `.yj-card`、`.yj-panel`。

## 验收清单

- [ ] 控件圆角符合规则。
- [ ] 弹层层级明显高于卡片。
- [ ] focus 状态清晰。
- [ ] 阴影克制且一致。

## 关联文件

`exports/src/styles/variables.css`、`exports/src/design/theme/naive-theme.ts`
