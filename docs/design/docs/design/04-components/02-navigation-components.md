# 导航组件规范


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
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

## 关联文件

`src/icons/registry.ts`、`docs/design/docs/design/05-patterns/01-app-shell-navigation.md`
