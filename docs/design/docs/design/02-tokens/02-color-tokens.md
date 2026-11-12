# 颜色 Tokens

## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 最后更新：2026-09-06
- 适用仓库：`yijie-desktop`
- 依据：[组件配色收敛决策](../08-governance/08-component-color-convergence.md)

## 目标与适用范围

定义文字、背景、品牌填充、边界、交互、独立状态与图表颜色，适用于所有页面、Naive UI、Yj 组件及参考导出。逐控件的 default / hover / pressed / selected / focus / readonly / disabled / loading / error 与组合规则，以 [组件配色与状态矩阵](../04-components/09-component-color-state-matrix.md) 为准。

## 品牌与空间原则

保持 A「清爽青柠」＋01「纯白通透」：亮色内容区保持白色，主文字石墨，主操作青柠配石墨。2026-11-05 按用户要求，左侧导航及其顶部窗口操作区域使用中性浅灰，以底色区分内容区，移除导航右侧分割线。普通文本、工具图标、链接和焦点使用中性角色。普通导航、卡片、输入、图标容器不再消费浅绿或深绿底色。

本版新增正文、控件状态与可读语义前景角色，收窄品牌色的使用范围；品牌主色与 Logo、字体、字号、间距、圆角、页面结构和业务交互继续保持。

## 品牌与兼容 Tokens

| Token | 亮色 | 暗色 | 规则 |
|---|---|---|---|
| `--yj-color-brand-primary` | `#C3F35B` | `#C3F35B` | 主操作填充、明确选中、Logo 折面 |
| `--yj-color-brand-hover` | `#D0F780` | `#D0F780` | 青柠填充 hover |
| `--yj-color-brand-active` | `#B1E343` | `#B1E343` | 青柠填充 pressed |
| `--yj-color-on-brand` | `#25282B` | `#25282B` | 青柠上的文字和图标 |
| `--yj-color-brand-text` | `#25282B` | `#F5F7FA` | 兼容文字入口，已中性化；新代码按实际角色取 primary/body/secondary |
| `--yj-color-brand-soft` / `brand-subtle` | `#FFFFFF` | `#25282B` | 兼容槽位；新普通控件不靠它表达选中 |
| `--yj-color-brand-border` | `#E2E5E8` | `#414850` | 兼容中性边框；不是焦点色 |
| `--yj-color-text-selection-bg` | `#C3F35B` | `#C3F35B` | 仅原生文本选区 |
| `--yj-color-text-selection-ink` | `#25282B` | `#25282B` | 原生选中文本前景 |

桌面功能区默认禁用文字拖选，包括侧栏、页面说明、筛选、卡片和弹层操作。对话正文、展开的思考与工具输出、报告预览等供阅读的内容用 `.yj-selectable-text` 标记。文本输入框与代码块支持原生选区，输入、复制和输入法沿用浏览器行为。

亮暗主题均用青柠底与石墨字绘制实际选中的文字。白字在青柠底上的对比度仅约 1.29:1。

## 对话正文文本超链（2026-11-02）

用户要求正文中的引用标签使用易界主题色，覆盖下方普通中性链接规则，仅适用于对话 Markdown 文本超链。
`--yj-color-chat-link` 亮色为 `#4B651D`（可读的深青柠），暗色使用品牌 `#C3F35B`；白底不直接使用亮青柠文字。
默认无下划线，hover/键盘焦点显示下划线并保留中性焦点环；完整地址放在统一 tooltip，支持 hover、focus 和 Esc。
原始 Markdown、复制及目标地址保持，不将普通正文、搜索来源列表或导航整体改为绿色。

正文中的文件链接及图标使用 `--yj-color-chat-file-link`。2026-11-10 按用户要求复用输入框已选技能的 `--yj-color-connector-composer-mention`，亮色为 `#668000`，暗色为 `#D0F780`。悬停或键盘聚焦时，文件名显示点状下划线，完整路径显示在统一 tooltip 中。

同日产物文档调整为独立卡片：中性标题、次级大小、按格式着色的文档图标。底纹 `--yj-color-chat-artifact-bg` 亮色为 `#F2F2F2`、暗色为 `#25282B`；悬停底纹 `--yj-color-chat-artifact-hover` 分别为 `#ECEEF0`、`#30363D`。卡片悬停或键盘焦点进入时显示右侧“另存为”图标，只有图标显示该 tooltip。正文中的文件链接仍使用上述青柠色。

按用户随后要求对齐 WorkBuddy：产物标题使用专用 `--yj-color-chat-artifact-title`（亮色 `#000000`、暗色 `#FFFFFF`），大小使用 `--yj-color-chat-artifact-meta`（亮色 `#00000080`、暗色 `#FFFFFF80`）。实心折角图标通过 `--yj-color-document-*` 统一提供各文档格式的纸张颜色、白色标识和浅色折角，不沿用状态语义色。

同日权限入口及菜单的“完全访问权限”缩短为“完全访问”。`contract-impact = none`：仅修改 Desktop 展示文案及文件链接颜色，权限审批行为、API/Agent Host、Native IPC、本地持久状态与重放语义不变。

## 文字与图标

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-text-primary` | `#25282B` | `#F5F7FA` | 标题、关键值、操作标签 |
| `--yj-color-text-body` | `#25282B` | `#E6E9ED` | 正文、输入内容、正常解释 |
| `--yj-color-text-secondary` | `#51565D` | `#C2C7CE` | 补充说明、次级标签 |
| `--yj-color-text-tertiary` | `#6F757D` | `#969EA8` | 时间、单位、元信息、placeholder |
| `--yj-color-text-disabled` | `#A5ABB2` | `#69717B` | 真正不可用控件，不能承担正常说明 |
| `--yj-color-icon-default` | `#25282B` | `#F5F7FA` | 普通操作图标 |
| `--yj-color-icon-muted` | `#6F757D` | `#969EA8` | 辅助图标 |
| `--yj-color-icon-subtle` | muted 85% + 页面底色 15% | muted 85% + 页面底色 15% | 回答操作与图片预览工具栏的弱化图标；悬停恢复 muted，选中、错误、禁用和键盘焦点保留独立语义 |

只读值、错误原因、加载说明和权限原因仍使用 body/secondary，不得降为 disabled。普通链接使用中性文字并以链接语义/下划线识别。深绿只留给图表，真实 success 继续走独立状态体系。

## 结构与局部状态背景

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-bg-app` / `bg-page` | `#FFFFFF` | `#191C20` | App、页面 |
| `--yj-color-bg-nav` | `#F7F7F7` | `#22262A` | 左侧导航及其顶部窗口操作区域 |
| `--yj-color-nav-hover` | `#EAEAEA` | `#30363D` | 侧栏内控件 hover 与选中底、顶部侧栏开关 hover |
| `--yj-color-nav-pressed` | `#DEDEDE` | `#414850` | 侧栏内控件及顶部侧栏开关 pressed |
| `--yj-color-nav-muted` | `#60666E` | `#969EA8` | 侧栏辅助文字，保持灰底上的小字可读性 |
| `--yj-color-bg-card` | `#FFFFFF` | `#25282B` | 卡片、输入区 |
| `--yj-color-bg-elevated` | `#FFFFFF` | `#2E3237` | 弹层 |
| `--yj-color-bg-subtle` | `#FFFFFF` | `#22262A` | 兼容内嵌表面，不代替普通表格/卡片背景 |
| `--yj-color-bg-composer-tray` | `#F4F5F6` | `#22262A` | 用户指定的 Chat Composer 圆角底座，仅带工作空间与权限底栏时使用 |
| `--yj-color-control-hover` | `#F7F8F9` | `#30363D` | 小控件/可操作行 hover |
| `--yj-color-control-pressed` | `#ECEEF0` | `#414850` | 小控件 pressed |
| `--yj-color-control-disabled-bg` | `#F7F8F9` | `#30363D` | 局部 disabled 底 |
| `--yj-color-control-track` | `#B8BEC5` | `#B8BEC5` | 未选中 Switch 轨道 |

导航 selected 使用中性灰底，不显示青柠侧边条；侧栏局部将 control-hover / control-pressed 映射到 nav-hover / nav-pressed，使选中项与浅灰侧栏保持层次。任务行仍遵循原规则，按下不额外加深。小筛选 selected 使用实色青柠配石墨。局部状态底不扩散到内容页面或卡片；普通表格不默认铺灰色斑马纹。

## 边界与焦点

### 全局 Tooltip（2026-11-05）

2026-11-07 用户明确限定使用范围：保留图标按钮、正文网址、图表数据和产物文件路径提示；移除普通标题、思考摘要、命令、名称、状态、卡片文案及店铺／模型／工作空间等文字选择入口上的提示。该范围覆盖本文和历史组件规范中更宽泛的 tooltip 要求。统一样式只约束获准保留的提示，不能作为新增 tooltip 的依据，也不将旧 `title`、`aria-label` 或省略文字自动升级为提示气泡。hover 视觉样式、点击和键盘操作保持。

来源核对：`a3bbc397309e2b9184dfdb99f9826cdd4d8dd6de`（2026-11-06）新增 `YjTooltip` 并批量替换旧 `title`，把命令、摘要及选择入口等原生标题提示变成明显的自定义气泡；这些旧属性分别可追溯到执行轨迹 `1134c68`、模型选择 `8da8270` 和店铺界面 `8d74159` 等实现。统一样式的提交及旧设计文档不构成逐处新增提示的用户授权。本次移除无明确需求的包装及原生 `title`，保留用户确认的四类提示。`contract-impact = none`：仅 Desktop 展示层；Desktop/API/Agent Host、Native IPC、权限、本地持久状态和重放语义不变。

按用户要求实际查看 WorkBuddy，并核对其已安装资源中的通用提示参数：字号12px、行高20px、常规字重400、圆角8px、上下4px/左右8px内边距、最大宽度320px、箭头10×3px、背景模糊4px、无边框及阴影。短提示按内容自适应，单行高度28px；长标题、路径与链接在最大宽度内换行，并受视口限制。

亮色提示及箭头使用易界石墨色 `#25282B`，不透明度约92%（`--yj-color-tooltip-bg: #25282BEB`），配白字。在白色页面上呈现为 `#36393C`，文字对比度约11.6:1。暗色模式保留 `#FFFFFFBF` 浅底黑字。ECharts Canvas 提示使用相应的不透明底色：亮色 `#36393C`、暗色 `#C9C9CA`。

获准使用的 Naive `NTooltip` 通过全局主题和 `tooltips.css` 应用统一样式；仅在用户已确认的提示位置使用 `YjTooltip`，保留原触发元素、可访问名称、点击与键盘操作，支持悬停、键盘焦点及Esc关闭。保留iframe的文档标题语义；组件的卡片标题、菜单和交互式图片预览继续使用各自组件规范。

`contract-impact = none`：仅Desktop呈现与提示交互适配；Desktop/API/Agent Host跨进程接口、权限审批、原生能力、路由目标和本地持久状态均无变化。

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-border-subtle` | `#ECEEF0` | `#30363D` | 装饰分隔 |
| `--yj-color-border-default` | `#E2E5E8` | `#414850` | 普通容器/次按钮边框 |
| `--yj-color-border-strong` | `#B8BEC5` | `#69717B` | 中性较强分隔 |
| `--yj-color-border-control` | `#8C939B` | `#6A727C` | Input、Checkbox/Radio、选择器可读轮廓 |
| `--yj-color-border-control-hover` | `#60666E` | `#969EA8` | 控件 hover；暗色浮层内输入/选择器默认轮廓 |
| `--yj-color-focus-ring` | `#25282B` | `#F5F7FA` | 中性焦点 |
| `--yj-focus-ring-width` | `2px` | `2px` | 统一清晰焦点，无模糊、无 glow |

默认卡片边框组织空间，不是唯一可操作提示。控件边界需在所处表面可读：暗色 control 对 card 超过 3:1，但对 elevated 约 2.65:1，因此浮层内输入与选择器使用 control-hover 轮廓。focus 与 selected 可共存；error 边界保留错误色，focus 外环仍是中性 2 px，不能互相覆盖。

## 独立状态色与可读前景

原状态主色和 Agent 状态不变；2.1.0 仅补充小字/图标可读前景，避免把品牌色用于状态。

| 状态 | 原主色 | 亮色语义前景 | 暗色语义前景 |
|---|---|---|---|
| Success | `#16A34A` | `#166534` | `#86EFAC` |
| Warning | `#D97706` | `#92400E` | `#FCD34D` |
| Error | `#DC2626` | `#B91C1C` | `#FCA5A5` |
| Info | `#2563EB` | `#1D4ED8` | `#93C5FD` |
| Neutral | `#64748B` | 按正常文字角色 | 按正常文字角色 |

可读前景 token 为 `--yj-color-semantic-success-ink`、`warning-ink`、`error-ink`、`info-ink`。用于真实状态标签、Alert 标题/图标与指标状态小字；长说明用 body。Agent thinking/running/waiting/success/failed/paused 仍分别为 `#8B5CF6` / `#2563EB` / `#D97706` / `#16A34A` / `#DC2626` / `#64748B`。

## 图表独立性

图表首序列固定亮色 `#4B651D`、暗色 `#C3F35B`，不得再间接绑定已经中性化的 brand-text。其他系列语义及各 pattern 的更严格图表限制不变；图表不能因为普通图标变中性而全部变成石墨。

## 对比与实际验证

| 不透明前景 / 背景 | 对比约值 |
|---|---|
| primary / 纯白 | 14.82:1 |
| secondary `#51565D` / 纯白 | 7.40:1 |
| tertiary / 纯白 | 4.65:1 |
| on-brand / 青柠 | 11.50:1 |
| 亮色 control 轮廓 / 纯白 | 3.11:1 |
| 暗色 control 轮廓 / card | 3.04:1 |

文字目标至少 4.5:1，必要控件轮廓与焦点至少 3:1；叠层和透明度后的实际结果必须独立检查，不用四舍五入掩盖未达标值。普通 NInput/NSpin 的 loading 图标为 primary，error/warning 输入 spinner 使用相应 semantic ink，主青柠按钮内部 spinner 使用 on-brand。

## 实现与验收

- 唯一运行时颜色来源为 `src/styles/variables.css`；Naive UI 统一由 `src/design/theme/naive-theme.ts` 读取解析后的 token，并由 `src/styles/component-colors.css` 承接无法通过主题键表达的少量全局状态。
- `exports/` 只提供同规则的参考源码，应用不能直接 import exports 或冻结 proposal。文档站使用参考颜色、主题和适配 CSS，不能另写一套配色。
- 必须验证亮暗、正常/只读/禁用、selected+focus、error+focus、loading 前景和浮层内控件。测试结果按实际范围记录，不能由规范生效推出全应用已验收。

参见：[组件配色与状态矩阵](../04-components/09-component-color-state-matrix.md)、[Naive UI 集成](../03-ui-system/01-naive-ui-integration.md)、[明暗主题](../03-ui-system/05-theme-dark-mode.md)。
