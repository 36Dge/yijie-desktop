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

保持 A「清爽青柠」＋01「纯白通透」：亮色结构全白，主文字石墨，主操作青柠配石墨。普通文本、工具图标、链接和焦点使用中性角色。普通导航、卡片、输入、图标容器不再消费浅绿或深绿底色。

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

文本选区只改变绘制色，不改变选择、复制、输入法行为；不能把整个输入框当成 selected 后填青柠。亮暗主题的青柠都配石墨前景，白字/青柠仅约 1.29:1，禁止用于有效文本。

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

只读值、错误原因、加载说明和权限原因仍使用 body/secondary，不得降为 disabled。普通链接使用中性文字并以链接语义/下划线识别。深绿只留给图表，真实 success 继续走独立状态体系。

## 结构与局部状态背景

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--yj-color-bg-app` / `bg-page` / `bg-nav` | `#FFFFFF` | `#191C20` | App、页面、导航 |
| `--yj-color-bg-card` | `#FFFFFF` | `#25282B` | 卡片、输入区 |
| `--yj-color-bg-elevated` | `#FFFFFF` | `#2E3237` | 弹层 |
| `--yj-color-bg-subtle` | `#FFFFFF` | `#22262A` | 兼容内嵌表面，不代替普通表格/卡片背景 |
| `--yj-color-control-hover` | `#F7F8F9` | `#30363D` | 小控件/可操作行 hover |
| `--yj-color-control-pressed` | `#ECEEF0` | `#414850` | 小控件 pressed |
| `--yj-color-control-disabled-bg` | `#F7F8F9` | `#30363D` | 局部 disabled 底 |
| `--yj-color-control-track` | `#B8BEC5` | `#B8BEC5` | 未选中 Switch 轨道 |

导航 selected 常态保持 bg-nav，以内侧 3 px 青柠标记表达；hover/pressed 仅当前项使用中性局部底，标记保持。小筛选 selected 使用实色青柠配石墨。H/A/disabled 的中性底不得扩散到整个页面、导航或卡片；普通表格不默认铺灰色斑马纹。

## 边界与焦点

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
