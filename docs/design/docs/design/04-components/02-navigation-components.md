# 导航组件规范


## 文档状态

- 状态：Accepted
- 版本：2.2.1
- 最后更新：2026-10-18
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义侧边栏、顶部导航、面包屑、标签页、步骤导航和页面内导航。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

2026-09-08 起，按钮、筛选项和说明标签的尺寸统一遵循[组件尺寸规范](./10-component-sizing.md)，颜色角色保持原规范。

## 必备组件

- `YjSidebar`：主导航。
- `YjNavItem`：导航项，图标来自 `YjIcon`。
- `YjBreadcrumb`：详情页路径。
- `YjTabs`：页面内切换。
- `YjStepNav`：授权、插件安装、任务配置等流程。

## 规则

导航文案使用中文，短而明确。主导航图标必须来自 registry。侧栏当前选中状态使用中性灰底语义 token，不显示青柠标记。导航不得承载过多二级菜单，复杂管理入口应放设置或独立页面。

亮色导航容器为纯白；普通导航文字/图标使用 primary。侧栏 YjNavItem 选中项使用 control-hover 浅灰底，移除内侧青柠描边；hover/pressed 仅该项使用中性局部底。焦点为 2px 中性且可与 selected 共存。小型筛选 selected 使用青柠填充与 on-brand，线形内容 Tabs 使用中性文字与青柠色选中下划线。暗色按相同角色映射中性石墨表面。品牌区继续使用已批准 SVG，Logo 形态不变。

完整状态与 N/A 范围见 [组件配色与状态矩阵](./09-component-color-state-matrix.md)。

### 内容标签页

我的店铺「经营总览 / AI 运营」、扩展「专家 / 技能」、连接器「市场 / 已安装」统一使用
`YjTabs variant="line"`，页面只负责工具栏布局与分隔线，不覆盖组件内部选中样式。

- 标签高度 48px，字号 16px（使用 `--yj-font-size-card-title`）、行高 22px，左右内边距 4px，标签间距 24px；透明背景，无胶囊边框。
- 未选项使用 tertiary 文字色、400 字重，hover/pressed 使用 primary；选中项以 600 字重、primary
  文字色及 4px 青柠色圆角下划线共同表达。下划线沿文字宽度，与底部分隔线衔接。亮暗主题均使用 brand-primary，键盘焦点保留中性焦点环。
- 标签行下方使用细分隔线。店铺页恢复原有 20px 内容间距与筛选工具栏留白；扩展和连接器沿用 24px 内容间距。标签靠左，筛选或搜索靠右，空间不足时工具栏换行。
- 数量通过条目的 `count` 展示为附属文字，使用 caption 字号、secondary 色与等宽数字，
  可访问名称同时包含标签和数量。
- 切换仍使用原有点击、方向键、Home / End 和单一 Tab 停靠点；沿用已有路由和面板状态。
- `YjTabs` 的默认 `pill` 形态继续服务既有紧凑切换场景；本次仅迁移上述三组内容标签页。

本次 `contract-impact = none`：仅调整 Desktop 进程内展示，跨进程调用、API / Agent Host、
路由参数和本地持久状态均无可观察变化。

`YjSidebar` 必须支持 240px 展开和 72px 收起两种 token 化尺寸。唯一收起控件位于 `YjWindowTitlebar`，在原生三色窗口按钮右侧；状态作为非敏感本地 UI 偏好跨路由和应用重启保留，读取失败时默认展开。

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

- 2026-10-18 / 2.2.1：三组内容标签页字号统一由 14px 增加至 16px；扩展页将专家移至技能前，沿用原有默认选中和路由行为。

- 2026-10-16 / 2.2.0：按用户最新截图恢复原店铺页的青柠色选中下划线与尺寸，并将相同样式提供给扩展和连接器；该规则覆盖本轮早先的中性下划线方案。

- 2026-09-08 后续微调：用户反馈灰底偏重，选中底改用更浅的 control-hover；亮色为 #F7F8F9，暗色为 #30363D。

- 2026-09-08：按用户要求将侧栏选中项改为中性灰底，移除青柠标记；保留路由、键盘焦点与折叠语义。

- 2026-09-06 / 2.1.0：用户确认组件配色收敛；普通导航原底+3px 青柠标记、小筛选实色青柠、中性 hover/focus。尺寸、路由与权限语义不变。

- 2026-09-05 / 2.0.0：按用户批准基线更新导航空间、选中配色和品牌资产；侧栏尺寸、偏好、路由与状态行为不变。

- 2026-07-30 / 1.1.0：段成威确认 FEAT-124 继续执行；增加 FEAT-124 所需的 240/72px 收起行为、本地偏好和导航权限/禁用语义。

## 关联文件

`src/icons/registry.ts`、`docs/design/docs/design/05-patterns/01-app-shell-navigation.md`
