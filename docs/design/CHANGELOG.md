# Design System 变更记录

## 2.1.1 — 2026-09-07

按用户确认收敛 Skill 广场局部视觉：分类图标采用透明背景的中性轮廓与品牌青柠笔画；可操作 Skill 卡片 hover/focus 边框及安装按钮以青柠强调。保留现有独立 Skill 图标、排版、尺寸、表面、状态和权限语义，明确只读/忙碌排除与中性键盘焦点。全局 token 与按钮主题不变。

`contract-impact = none`：仅改变 Desktop renderer 的局部外观；Desktop 跨进程接口、API/Agent Host 协议与本地持久状态均无可观察变化。

## 2.1.0 — 2026-09-06

用户确认组件配色矩阵并授权正式同步。新增正文、控件边界、局部交互、文本选区与可读语义前景角色，统一普通中性文字/图标、导航与筛选选中、2px 中性焦点、普通容器无阴影及浮层轻投影。状态矩阵覆盖 readonly/disabled/loading 和 selected/error/focus 组合。

正式 token、主题、共享 CSS、参考导出及文档站预览同步；候选目录经用户授权清理，冻结候选由 Git 历史保存，文档站矩阵冻结副本与最终验收记录保留。品牌主色与 SVG Logo、字体、间距、圆角、布局、组件 API、业务规则不变。详见 [决策记录](docs/design/08-governance/08-component-color-convergence.md)。

## 2.0.0 — 2026-09-05

采用 A「清爽青柠」＋01「纯白通透」，引入商品包裹 / YJ 负形 SVG 品牌资产。详见 [历史决策](docs/design/08-governance/07-lime-white-brand-refresh.md)。其中组件普通文字、soft/hover/selected、焦点与阴影用法由 2.1.0 的明确状态规则覆盖，其余规则继续有效。
