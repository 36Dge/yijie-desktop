# 颜色 Tokens


## 文档状态

- 状态：Accepted
- 版本：2.0.0
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界品牌色、文本色、背景色、边框色、状态色、Agent 色和图表色。

## 适用范围

适用于所有 UI 颜色，包括 Naive UI 主题、业务组件、图标、图表和状态反馈。

## 规范正文

## 品牌配色与空间原则

采用 **A「清爽青柠」＋01「纯白通透」**：白色承载空间，石墨承载信息，青柠标识主操作与选中强调。

- 亮色的 App、页面、导航、卡片、弹层和通用弱背景统一为纯白 `#FFFFFF`。
- 空间层级通过留白、现有间距、细边框建立；普通卡片不依赖灰色或泛绿色大底区分。
- 青柠只用于主操作、品牌图形和选中强调。淡青柠是局部交互语义色，不是页面底色。
- 主操作文字与图标使用石墨 `--yj-color-on-brand`，亮暗主题均不得改成白色。
- 字号、间距、圆角、布局、组件交互与状态语义保持原规范，仅替换色系与品牌资产。

## 品牌色与交互色

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-brand-primary` | `#C3F35B` | `#C3F35B` | 主操作填充、选中标记、品牌强调 |
| `--yj-color-brand-hover` | `#D0F780` | `#D0F780` | 主操作 hover 填充 |
| `--yj-color-brand-active` | `#B1E343` | `#B1E343` | 主操作 active / pressed 填充 |
| `--yj-color-brand-soft` | `#F0F8DF` | `#2E3823` | 局部选中背景 |
| `--yj-color-brand-subtle` | `#F0F8DF` | `#39462A` | 局部品牌弱强调；不得用于大面积空间底色 |
| `--yj-color-brand-border` | `#C9D7B3` | `#61783C` | 品牌辅助装饰边界，不能单独作为 focus 指示 |
| `--yj-color-brand-text` | `#4B651D` | `#C3F35B` | 链接、文本按钮、品牌辅助文字 |
| `--yj-color-on-brand` | `#25282B` | `#25282B` | 青柠填充上的文字和图标 |
| `--yj-color-focus-ring` | `#4B651D` | `#C3F35B` | 键盘焦点、关键交互边界 |
| `--yj-color-control-track` | `#B8BEC5` | `#B8BEC5` | Switch 未选中轨道，搭配石墨滑块和轨道内文字；不用于页面背景 |

`brand-primary` 是填充色，`brand-text` 是文字色，不得互换。亮色主题中不能在白底上直接用青柠作为正文、细线图标或唯一的交互边界。选中态需要同时提供可读文字及位置、边界或标记。

## 文本色与图标色

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-text-primary` | `#25282B` | `#F5F7FA` | 主文本 |
| `--yj-color-text-secondary` | `#60666E` | `#C2C7CE` | 次文本 |
| `--yj-color-text-tertiary` | `#6F757D` | `#969EA8` | 辅助说明、占位说明 |
| `--yj-color-text-disabled` | `#A5ABB2` | `#69717B` | 禁用，不承担有效信息 |
| `--yj-color-icon-default` | `#60666E` | `#C2C7CE` | 默认图标 |
| `--yj-color-icon-muted` | `#6F757D` | `#969EA8` | 辅助图标 |

## 背景色

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-bg-app` | `#FFFFFF` | `#191C20` | App 底色 |
| `--yj-color-bg-page` | `#FFFFFF` | `#191C20` | 页面底色 |
| `--yj-color-bg-nav` | `#FFFFFF` | `#191C20` | 导航、侧栏 |
| `--yj-color-bg-card` | `#FFFFFF` | `#25282B` | 卡片、输入区 |
| `--yj-color-bg-elevated` | `#FFFFFF` | `#2E3237` | 弹层 |
| `--yj-color-bg-subtle` | `#FFFFFF` | `#22262A` | 表头、通用内嵌区域 |

亮色通用背景刻意同值。不得为制造层级重新引入灰底、绿灰底或整页青柠渐变。暗色使用中性石墨层级，避免把亮色直接反相为黑底绿字。

## 边框色

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-border-subtle` | `#ECEEF0` | `#30363D` | 装饰分隔、卡片细边框 |
| `--yj-color-border-default` | `#E2E5E8` | `#414850` | 默认容器和控件边框 |
| `--yj-color-border-strong` | `#B8BEC5` | `#69717B` | 较强分隔、容器强调 |

浅边框用于空间组织，不承担唯一的可操作提示。键盘 focus 使用 `focus-ring`；主操作通过青柠填充、石墨文字和清晰的焦点边界形成完整识别。

## 配色对比基线

以下为不透明色块按 sRGB 相对亮度公式计算的文本对比值，组件实际叠加、透明度与状态仍需验收：

| 文字 / 背景 | 对比值 |
|---|---|
| 石墨 `#25282B` / 纯白 `#FFFFFF` | 14.82 : 1 |
| 次文本 `#60666E` / 纯白 | 5.80 : 1 |
| 辅助文本 `#6F757D` / 纯白 | 4.65 : 1 |
| 石墨 / 青柠 `#C3F35B` | 11.50 : 1 |
| 石墨 / hover `#D0F780`、active `#B1E343` | 12.21 : 1、9.84 : 1 |
| 品牌文字 `#4B651D` / 纯白、局部选中 `#F0F8DF` | 6.61 : 1、6.04 : 1 |
| 暗色主文本 `#F5F7FA` / App `#191C20` | 15.93 : 1 |
| 暗色辅助文本 `#969EA8` / 弹层 `#2E3237` | 4.76 : 1 |

白字 / 青柠仅 1.29 : 1，禁止作为有效文本组合。禁用文本不得用于正常说明、权限限制原因或空态提示。

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

- 不允许直接写 `#C3F35B` 到业务组件中，必须使用 token。
- 不允许恢复旧绿灰色页面底色，或使用白字青柠主按钮。
- 不允许只用绿色表达所有正向状态。
- 不允许使用未经定义的红、黄、蓝、紫。
- 不允许用颜色作为唯一语义，需要配合文字、图标或状态标签。

## 实现要求

规范参考实现位于 `exports/src/styles/variables.css`；Naive UI 主题从解析后的 CSS variables 读取实际色值。ECharts 统一使用 `exports/src/design/theme/echarts-theme.ts` 中的品牌首色与既有多系列色板，不在页面散落数组。品牌色板首色为青柠 `#C3F35B`；为保持白底细线与数据点的可见性，默认亮色图表首序列使用 `brand-text` 派生色 `#4B651D`，暗色首序列使用青柠。其他系列语义色保持不变。

Naive UI 保持 `common.primaryColor` 为青柠填充色，并按语义显式覆盖共享控件：

| 控件 | 填充与边界 | 文字与图标 |
|---|---|---|
| 实心 primary Button | 青柠及 hover / active 派生 | default / hover / pressed / focus / disabled 均使用 `on-brand` |
| text / ghost Button | 透明或既有控件背景 | `brand-text` |
| Menu 选中与子项选中 | `brand-soft`，导航容器使用 `bg-nav` | `text-primary`，亮色为石墨，暗色为正常浅色文本 |
| Checkbox / Radio | 选中青柠，未选中使用中性可见轮廓 | 选中勾选标记 / 圆点为石墨 |
| Switch | 选中青柠，未选中中性 `control-track` | 滑块和轨道内文字为石墨 |
| Tabs / RadioButton | 局部选中背景，细线标记使用可读 `brand-text` | 选中文字使用 `text-primary` |
| Select 及共享内部选择器 | 选中选项使用 `brand-soft`，focus 使用 `focus-ring` | 选中文字使用 `text-primary`，勾选标记使用 `brand-text` |
| Pagination | 当前页青柠填充 | 当前页石墨字，hover / pressed 使用 `brand-text` |
| 可选 Tag / primary Tag | checked 青柠；primary 使用 `brand-soft` | checked 石墨字；primary 使用 `brand-text` |

Menu 的竖向青柠选中条由导航封装的局部 CSS 提供，Naive UI 没有独立竖向 indicator 主题键；不可把渐变塞入 `itemColorActive`，该键按 `background-color` 消费。水平 Menu 和 Tabs 的细线采用 `brand-text` 保证白底可见性。选中条仅是辅助品牌提示，不能替代可读选中文字与状态语义。

颜色覆盖不改变控件交互，不全局重写 success / warning / error / info 类型。`inverted` Menu 不是主题切换方案，导航按统一 light / dark theme 渲染。未列出的复杂组件、局部 `themeOverrides` 和自定义渲染在迁移时仍需检查；不得仅修改 `common.primaryColor` 后假定所有继承该颜色的文字、选中图标和焦点都已适配。

按钮覆盖范围与 `secondary` / `tertiary` / `quaternary` 品牌组合的限制见 [Naive UI 集成规范](../03-ui-system/01-naive-ui-integration.md)。这些组合不能直接使用浅青柠作为文字色，需经共享封装后再使用。

`exports/` 是迁移参考，不参与应用打包；本次规范更新不代表活跃 `src/` 页面已经完成改造。后续需求与现有页面改造均按这套 token 执行。

## 验收清单

- [ ] 所有颜色来自 token。
- [ ] 亮色和暗色都定义，所有普通亮色空间背景为纯白。
- [ ] 主按钮亮暗主题均为青柠底石墨字，文本与 ghost 控件可读。
- [ ] 层级依靠留白、间距和细边框，焦点边界清晰。
- [ ] 状态色与品牌色区分清楚。
- [ ] Agent 状态色统一。
- [ ] 图表不破坏状态色语义。

## 关联文件

`exports/src/styles/variables.css`、`docs/design/docs/design/03-ui-system/04-data-visualization.md`
