# 导航组件规范


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 最后更新：2026-09-06
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义侧边栏、顶部导航、面包屑、标签页、步骤导航和页面内导航。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

## 必备组件

- `YjSidebar`：主导航。
- `YjNavItem`：导航项，图标来自 `YjIcon`。
- `YjBreadcrumb`：详情页路径。
- `YjTabs`：页面内切换。
- `YjStepNav`：授权、插件安装、任务配置等流程。

## 规则

导航文案使用中文，短而明确。主导航图标必须来自 registry。当前选中状态使用品牌色语义 token，不直接写品牌色。导航不得承载过多二级菜单，复杂管理入口应放设置或独立页面。

亮色导航容器为纯白；普通导航文字/图标使用 primary。选中项常态保持导航原底，以内侧 3px 青柠标记表达；hover/pressed 仅该项使用中性局部底，选中标记保留。焦点为 2px 中性且可与 selected 共存。小型筛选 selected 使用青柠填充与 on-brand，线形内容 Tabs 使用中性文字与下划线。暗色按相同角色映射中性石墨表面。品牌区继续使用已批准 SVG，Logo 形态不变。

完整状态与 N/A 范围见 [组件配色与状态矩阵](./09-component-color-state-matrix.md)。

`YjSidebar` 必须支持 240px 展开和 72px 收起两种 token 化尺寸。收起控件固定在侧栏右边界并与品牌区垂直居中；状态作为非敏感本地 UI 偏好跨路由和应用重启保留，读取失败时默认展开。

`YjNavItem` 至少支持 `default`、`hover`、`focus-visible`、`selected`、`disabled` 和权限过滤后的 `hidden` 语义：

- `selected` 对应当前真实路由并设置 `aria-current="page"`。
- `disabled` 用于用户有权但能力尚未开放的模块，不执行路由或点击行为。
- `hidden` 由权限投影在渲染前过滤，不进入视觉树和可访问性树；它不能替代服务端授权。
- 72px 模式下，可用入口必须通过 tooltip 和可访问名称表达完整文案。

## AI / Codex 必须遵守

- 优先复用现有 `Yj*` 组件，不重复造相同 UI。
- 新组件必须定义 props、slots、状态、空态、错误态和可访问性要求。
- 不允许在业务页面中复制组件内部结构。
- 不允许组件内部硬编码视觉值。

## 实现要求

组件文件使用 PascalCase，例如 `YjMetricCard.vue`。复杂组件应配套 `types.ts`、`README.md` 或文档说明。组件样式使用 token 和 CSS variables。

## 验收清单

- [ ] 组件职责单一。
- [ ] Props 命名清晰。
- [ ] 支持 loading/disabled/error/empty 等必要状态。
- [ ] 可访问性完整。
- [ ] 有基础测试或 Story 示例。
- [ ] 侧栏偏好在首次启动、正常恢复和损坏回退三种情况下行为确定。
- [ ] selected、disabled、hidden 三种导航语义有组件或路由测试。

## 变更记录

- 2026-09-06 / 2.1.0：用户确认组件配色收敛；普通导航原底+3px 青柠标记、小筛选实色青柠、中性 hover/focus。尺寸、路由与权限语义不变。

- 2026-09-05 / 2.0.0：按用户批准基线更新导航空间、选中配色和品牌资产；侧栏尺寸、偏好、路由与状态行为不变。

- 2026-07-30 / 1.1.0：段成威确认 FEAT-124 继续执行；增加 FEAT-124 所需的 240/72px 收起行为、本地偏好和导航权限/禁用语义。

## 关联文件

`src/icons/registry.ts`、`docs/design/docs/design/05-patterns/01-app-shell-navigation.md`
