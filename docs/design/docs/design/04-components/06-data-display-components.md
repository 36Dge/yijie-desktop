# 数据展示组件规范


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义指标卡、表格、列表、详情、标签、图表卡等数据展示组件。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

2026-09-08 起，按钮、筛选项和说明标签的尺寸统一遵循[组件尺寸规范](./10-component-sizing.md)，颜色角色保持原规范。

## 必备组件

- `YjMetricCard`：展示核心指标、趋势、环比/同比。
- `YjDataTable`：统一表格行为。
- `YjDescriptionList`：详情字段。
- `YjChartCard`：图表容器。
- `YjStatusTag`：状态标签。

## 规则

数据展示必须明确单位、时间范围和数据来源。空值不能显示为 `null` 或 `undefined`，应显示 `—` 或业务文案。表格操作必须可追踪，批量操作必须显示影响数量。

本类组件的文字、图标、背景、边界、2px 中性焦点、普通容器无阴影与真实浮层轻投影，以 [组件配色与状态矩阵](./09-component-color-state-matrix.md) 为准。readonly 保留正常读值；disabled 只作用于不可用控件；error 与 selected 不能抹掉焦点。现有组件职责、布局与交互不变。

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

`docs/design/docs/design/03-ui-system/04-data-visualization.md`、`docs/design/docs/design/06-content/05-data-metric-copy.md`
