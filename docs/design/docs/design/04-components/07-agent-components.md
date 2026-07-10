# Agent 组件规范


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义 AI/Agent 执行过程、工具调用、审批、结果和日志的组件规范。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

## 必备组件

- `YjAgentTimeline`：任务阶段与进度。
- `YjToolCallCard`：工具调用摘要、参数摘要、结果摘要。
- `YjApprovalCard`：等待用户确认或审批。
- `YjAgentResultPanel`：最终结果。
- `YjAgentTraceDrawer`：详细日志与调试信息。

## 状态

Agent UI 至少支持：thinking、running、waiting、success、failed、paused、cancelled。风险等级后期由业务策略定义，当前 UI 必须能接收并展示后端返回的风险字段。

## 工具调用展示

工具调用不得直接暴露敏感参数。应显示工具名称、目的、影响范围、状态、耗时和可查看详情入口。

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

`docs/design/docs/design/05-patterns/03-agent-task-flow.md`、`docs/design/docs/design/08-governance/06-deferred-policy-decisions.md`
