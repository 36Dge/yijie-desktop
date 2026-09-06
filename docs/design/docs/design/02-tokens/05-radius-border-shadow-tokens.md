# 圆角、边框与阴影 Tokens


## 文档状态

- 状态：Accepted
- 版本：2.1.0
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
- `border-control`：输入/选择控件轮廓，亮色 `#8C939B`、暗色 `#6A727C`。
- `border-control-hover`：hover 轮廓，亮色 `#60666E`、暗色 `#969EA8`；暗色浮层内 Input/Select 的默认边界也使用此角色。
- `focus-ring`：中性焦点，亮色 `#25282B`、暗色 `#F5F7FA`，宽度 `--yj-focus-ring-width: 2px`，无模糊/无 glow。selected 标记与 error 边框不能覆盖焦点。

| 边框 token | 亮色 | 暗色 |
|---|---|---|
| `--yj-color-border-subtle` | `#ECEEF0` | `#30363D` |
| `--yj-color-border-default` | `#E2E5E8` | `#414850` |
| `--yj-color-border-strong` | `#B8BEC5` | `#69717B` |

亮色页面、导航与卡片均为纯白；保持既有间距和圆角，通过留白与细边框区分区域，不新增灰底或绿灰底作为空间分层。

## 阴影

- `shadow-xs` / `shadow-card`：兼容 token，值为 none；普通卡片与输入所有状态不加投影。
- `shadow-popover`：Popover、Dropdown。
- `shadow-modal`：Modal、Drawer。

普通卡片、图标底板和输入使用细边框，hover/focus 也不浮起。真实 Popover、Dropdown、Modal 和 Drawer 才使用统一轻投影；焦点的 2px 零模糊色环不是投影，不得再叠加 glow 或卡片阴影。

| Token | 亮色 | 暗色 |
|---|---|---|
| `--yj-shadow-xs` | `none` | `none` |
| `--yj-shadow-card` | `none` | `none` |
| `--yj-shadow-popover` | `0 6px 20px rgba(37, 40, 43, 0.10)` | `0 6px 20px rgba(0, 0, 0, 0.28)` |
| `--yj-shadow-modal` | 与 `shadow-popover` 相同 | 与 `shadow-popover` 相同 |

2.1.0 按用户批准的组件状态方案统一焦点宽度和轻投影，圆角与布局间距尺度不变。完整组合见 [组件配色与状态矩阵](../04-components/09-component-color-state-matrix.md)。

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
