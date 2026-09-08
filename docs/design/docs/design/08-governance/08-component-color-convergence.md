# ADR-DESIGN-20260906：组件配色与状态收敛

## 状态与授权

- 状态：Accepted
- 版本：2.1.0
- 日期：2026-09-06
- 用户已经明确确认候选方案，授权执行正式设计规范覆盖与活跃页面/共享组件同步（原任务第 4–5 项）。
- `contract-impact = none`：本次收敛颜色角色、状态 CSS、焦点和阴影；不改变 Desktop 跨进程交互、API / Agent Host 协议、Tauri 能力、持久化格式/值及业务操作语义。此分类不覆盖已存在的独立 Skills 修复。

2.1.0 沿用 2.0.0 品牌主色、SVG Logo、主题选择机制与组件 API，新增正文/状态前景/控件边界角色及完整状态矩阵，按既有 minor 规则发布设计规范。未改动章节保留各自版本；这不是公共协议或应用版本升级。

## 已批准依据

- [用户确认的组件矩阵原文（冻结副本）](/reviews/2026-09-06-component-colors.txt)
- 原候选矩阵及评审资料保存在 Git 提交 `e6bf08f655f3b7f123405575bb62a4aad7adc89b` 的历史目录 `docs/design/proposals/2026-09-06-component-colors/` 中，可按该提交查阅或恢复。
- 原矩阵 SHA-256：`3f9e9617a8c070b1a8090cfcdc847d58aa361350e3a31e74c7a9cb45c76dfef8`
- 用户随后授权删除工作区的 `proposals/` 目录；原审计、状态图谱、三页 Chrome 对照、离线评审与验证记录由上述 Git 历史保留。文档站的矩阵冻结副本、正式规范与最终验收记录继续保留。
- 冻结文本保留当时的 Proposed 字样，表示审查时状态；本 ADR 记录之后发生的用户确认，不倒改原文件。

本次候选目录清理的 `contract-impact = none`：只移除历史评审文件并更新文档引用，Desktop 运行实现、API / Agent Host 交互及本地持久状态均无可观察变化。

## 决策

1. 亮色背景/导航/卡片保持纯白，暗色保持中性石墨表面。主体白底已落地，不通过换回灰底解决组件层级问题。
2. 主文字、正文、次说明、元信息、禁用分角色；普通图标、正文、链接使用中性颜色。只读、权限原因、错误原因与加载说明不套禁用色。
3. 主操作青柠填充配石墨；导航原底配 3px 青柠标记，小筛选选中实色青柠。实色青柠控件的 hover/pressed 使用已定义的青柠明度；其他操作的中性 hover/pressed 仅作用于局部控件。
4. 焦点统一 2px 中性无 glow；selected+focus、error+focus 保持各自信息。普通卡片/输入无投影，真实浮层使用轻投影。
5. 原生文本选择使用青柠底、石墨字，保持原生选择/复制/输入法行为。图表首色独立固定，原状态色与图表语义不随 brand-text 中性化而丢失；小字/状态图标新增可读 semantic ink。
6. 保留现有字体、字号、布局、间距、圆角、路由、权限、读写边界、审批与业务状态。Logo、几何母版、SVG 派生资产不重新生成或改写。

## 权威与实现位置

- [颜色 Tokens](../02-tokens/02-color-tokens.md) 定义精确角色；[组件配色与状态矩阵](../04-components/09-component-color-state-matrix.md) 定义逐组件状态与组合，取代 2.0.0 中冲突的 softgreen/深绿普通文字、品牌 focus 与普通容器阴影条目。
- 运行时唯一颜色源为 `src/styles/variables.css`，唯一 Naive UI 主题入口为 `src/design/theme/naive-theme.ts`；`src/styles/component-colors.css` 是少量共享状态适配，不形成并行候选主题。
- 已有 Yj 和业务组件按各自职责消费角色，不把业务代码搬入 exports；`docs/design/exports/` 同步参考颜色/主题/图标与共享适配 CSS，应用不能直接导入 exports/proposals。
- 文档站使用参考角色与真实 Naive UI 控件，构建包括品牌一致性与参考类型检查。

## 保护边界与验证

本次开始前的保护快照位于 `.local/color-convergence/start.json`。既有独立 Skills 修复、其他仓库、原提案和离线评审证据不因本次视觉收敛被覆盖或重新归类。

正式规范生效不等于全部运行环境都已验收。构建、类型、真实组件/页面状态、主题切换与窗口检查的实际结果由本次验证记录说明；Chrome 组件验证不得称为 Tauri/WebKit 或原生验收。未执行项明确记录，不用历史 PASS 代替本轮结果。


## 原生最小视口验收补充

本轮原生窗口实测发现：外框 1180 × 760 的 WebKit 内容视口实际为 1180 × 728（本机标题栏占 32px），旧内部 `min-height: 760px` 会裁切底部设置。仅将 `YjAppShell` 和 `ChatPage .chat-workspace` 的 min-height 收敛为窗口最小高度与实际 UI 视口的较小值；不修改原生 window 配置、字号/间距 token 或 uiZoom。

该可用视口约束详见 [窗口与页面密度基线](../01-foundations/06-window-density-baseline.md)。它修复外框尺寸与内容高度混用，不改变已批准配色矩阵或既有布局尺度。参考 exports 没有这两个布局组件，因此不为此增加业务组件副本。

相应 9 项浏览器几何检查确认：1180 × 728 内容视口无 document overflow，设置底部为 712px、历史 Chat composer 底部为 708px；1180 × 760 内容视口及 1440 × 900 的既有几何保持不变。这些数值属于浏览器回归证据；原生窗口的尺寸观察与浏览器几何检查分别记录，不合并为完整原生验收结论。
