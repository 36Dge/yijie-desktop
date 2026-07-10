# 后续业务策略预留


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

记录已明确后期定义、当前不得猜测的策略项。

## 适用范围

适用于设计系统变更、组件新增、token 修改、页面 pattern 新增和 AI/Codex 开发流程。

## 规范正文

## 当前后续定义项

1. 操作审批策略：哪些操作必须审批、审批层级、审批人、审批时效、撤销规则。
2. Agent 风险等级：风险等级枚举、颜色映射、动作要求、日志要求、阻断规则。

## 当前 UI 必须做的事情

虽然具体策略后期定义，UI 现在必须具备承接能力：

- `YjApprovalCard` 能展示后端返回的审批原因、影响范围、确认/取消/查看详情。
- `YjToolCallCard` 能展示工具调用摘要和敏感信息脱敏结果。
- `YjAgentTimeline` 能展示等待审批状态。
- 所有高影响操作按钮可接入 `approvalRequired` 或等价字段。

## 当前 UI 不允许做的事情

- 不允许自行定义风险等级名称。
- 不允许自行决定哪些操作必须审批。
- 不允许把审批策略写死在前端。
- 不允许用颜色隐含风险等级而没有策略来源。

## 后续落地方式

后续业务策略确定后，应新增 ADR，并更新：

- `06-content/04-risk-and-approval-copy.md`
- `04-components/07-agent-components.md`
- `04-components/03-action-components.md`
- `07-ai-codex/01-ai-development-rules.md`
- 相关 TypeScript 类型和后端 contract。

## AI / Codex 必须遵守

- 不允许绕过设计系统直接合并 UI 变更。
- 不允许无记录修改 token、品牌资产、图标来源或组件 API。
- 不允许将后续业务策略问题伪装成已确定设计规则。

## 实现要求

设计系统变更应通过 PR、评审、版本记录和必要 ADR 管理。Codex 生成的变更同样需要人类 review。

## 验收清单

- [ ] 变更范围明确。
- [ ] 文档和代码同步。
- [ ] 影响页面已检查。
- [ ] 必要时有 ADR。
- [ ] 无待确认伪装成终版。

## 关联文件

`docs/design/docs/design/06-content/04-risk-and-approval-copy.md`、`YjApprovalCard`、`YjAgentTimeline`
