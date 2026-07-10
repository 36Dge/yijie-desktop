# 组件编写标准


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

规定易界业务组件的创建、命名、API、状态、样式和测试标准。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

## 组件分类

1. **基础封装组件**：`YjIcon`、`YjLogo`、`YjStatusTag`。
2. **布局组件**：`YjPage`、`YjPageHeader`、`YjSection`、`YjSplitPane`。
3. **数据组件**：`YjMetricCard`、`YjDataTable`、`YjChartCard`。
4. **Agent 组件**：`YjAgentTimeline`、`YjToolCallCard`、`YjApprovalCard`。
5. **电商领域组件**：`YjStoreCard`、`YjListingScore`、`YjComplianceRiskBadge`。

## 组件 API 原则

- Props 使用业务语义，不暴露内部样式细节。
- 视觉变体使用 `variant`、`tone`、`size`，不接受任意颜色。
- 事件使用 `onConfirm`、`onCancel`、`onRetry` 等清晰语义。
- Slots 用于扩展内容，不用于破坏组件结构。

## 状态要求

所有复杂组件必须考虑 loading、empty、error、disabled、readonly、selected、active 状态。

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

`src/components/yijie/`、`docs/design/docs/design/09-implementation/05-component-api-examples.md`
