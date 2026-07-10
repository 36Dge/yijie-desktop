# UI Review 清单


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义人类和 Codex 自查 UI 的检查项。

## 适用范围

适用于 Codex/AI 生成或修改 `yijie-desktop` 前端代码的所有任务。

## 规范正文

## 结构检查

- 页面是否选择了正确 pattern？
- 是否复用了 `Yj*` 组件？
- 是否存在一次性复杂布局？

## 视觉检查

- 是否有硬编码颜色/字号/间距？
- 是否兼容亮色/暗色？
- 图标是否来自 registry？

## 状态检查

- Loading / Empty / Error / Permission 是否完整？
- Agent 任务是否有过程可见性？
- 高影响操作是否预留确认/审批？

## 内容检查

- 文案是否中文且专业？
- 数据是否有单位和时间范围？
- 风险结论是否过度绝对？

## AI / Codex 必须遵守

- 必须先读取本设计系统相关文档。
- 必须优先复用已有组件和 token。
- 必须输出可运行、可测试、可审查的代码。
- 不允许引入未经批准的新库、新风格、新视觉资产。

## 实现要求

所有 Codex 任务应在 prompt 或 `AGENTS.md` 中引用本规范。复杂页面生成前应先输出页面结构计划，再写代码。

## 验收清单

- [ ] 符合 design token。
- [ ] 使用 `Yj*` 组件。
- [ ] 图标走 registry。
- [ ] 状态完整。
- [ ] 无硬编码视觉值。

## 关联文件

`docs/design/docs/design/08-governance/05-quality-gates.md`
