# 设置与权限 Pattern


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义账户、主题、安全、运行时、店铺权限和插件权限设置页面。

## 适用范围

适用于对应页面 pattern 的路由页面、业务组件、状态管理、接口接入和文案。

## 规范正文

设置页使用左侧设置导航 + 右侧设置区块。敏感设置必须二次确认。授权、密钥、运行时、插件权限等信息必须隐藏敏感值并支持审计。

主题设置提供跟随系统、亮色、暗色。默认值为跟随系统。

### Chat 审批模式入口与弹层

2026-09-09 按用户要求收紧审批弹层，并贯穿白色、青柠和石墨色主题：

- 模式菜单使用 `--yj-layout-permission-menu-width`（380px），完全访问确认框使用 `--yj-layout-permission-confirm-width`（420px）；两者均为亮暗共用的局部布局 token，窄视口至少留出 40px 总边距，不影响其他弹层。
- 菜单外内边距和选项内边距均为 `space-2`，选项标题为 14px / 22px，说明为 12px / 18px；说明完整换行，禁止省略风险信息。菜单圆角为 `radius-lg`，选项为 `radius-md`。
- 常态入口使用卡片表面、细中性边框及青柠底石墨图标；展开时普通模式入口使用青柠底石墨字。当前选项使用中性局部底和青柠圆形勾选标记，其他项保留白色表面与石墨文字，暗色映射既有石墨表面与浅色文字。
- 完全访问入口、选项标题和图标保留 warning 语义，说明使用可读的 secondary；确认开启按钮使用青柠底石墨字。青柠表示交互和选中，不表示审批已通过或权限安全。
- 禁用入口使用 disabled 文字和中性图标底；hover / pressed 与键盘中性焦点可独立识别。保留原有方向键、Esc、忙碌禁用和首次完全访问二次确认行为。

`contract-impact = none`：仅调整 Desktop 组件布局与配色；Desktop 的权限操作、API/Agent Host 通信及本地持久状态均无可观察的契约变化。

## AI / Codex 必须遵守

- 新页面必须先匹配既有 pattern；没有匹配项时先补 pattern 文档。
- 不允许在页面中重新创造布局、状态和交互流程。
- 必须包含 loading、empty、error、permission denied 状态。
- 涉及 Agent 的页面必须展示过程和结果。

## 实现要求

页面文件放在 `src/pages/` 对应业务目录，复杂逻辑进入 `src/domain/` 或 composables。页面只负责组合组件和绑定状态，不承载复杂业务规则。

## 验收清单

- [ ] 页面结构符合 pattern。
- [ ] 主操作明确。
- [ ] 数据和状态完整。
- [ ] 风险/权限/错误已覆盖。
- [ ] 组件复用而非页面堆叠。

## 关联文件

`docs/design/docs/design/04-components/`、`src/pages/`、`src/domain/`
