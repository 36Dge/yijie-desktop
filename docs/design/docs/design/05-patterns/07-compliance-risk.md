# 合规风险 Pattern


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义平台规则、类目合规、国家法规风险相关页面。

## 适用范围

适用于对应页面 pattern 的路由页面、业务组件、状态管理、接口接入和文案。

## 规范正文

合规页面必须突出风险摘要、影响范围、依据来源、建议动作和不确定性。风险表达必须专业谨慎，避免绝对化结论。

需要区分平台政策、国家法律、物流限制和类目规则。法规和政策内容必须通过知识库引用，不由前端硬编码。

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
