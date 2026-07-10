# Design System 文档标准


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

规定本设计系统中每份文档必须具备的结构，保证人类与 AI/Codex 都能稳定理解并执行。

## 适用范围

适用于 `docs/design/docs/design/` 下所有规范文档、组件文档、模式文档、实现文档和治理文档。

## 规范正文

每个文档必须包含以下部分，不可省略：

1. **文档状态**：状态、版本、适用仓库、适用技术栈、默认语言。
2. **目标**：说明该文档解决什么问题。
3. **适用范围**：说明适用于哪些页面、组件或代码。
4. **规范正文**：给出明确规则，不写空泛建议。
5. **AI / Codex 必须遵守**：写成可执行规则。
6. **实现要求**：说明代码如何落地。
7. **验收清单**：用于 PR / UI Review / Codex 自查。
8. **关联文件**：列出实现或上游规范位置。

文档中的规则必须使用“必须 / 禁止 / 应该 / 可以”表达强弱，不使用“建议尽量”“看情况”等模糊措辞。

当信息来自业务策略且尚未定义时，不允许自行猜测，必须写入 `08-governance/06-deferred-policy-decisions.md`。当信息已经由项目方反馈确认时，必须写入 `00-final-decisions.md`。

## AI / Codex 必须遵守

- 新增规范文档时必须复制本结构。
- 不允许只写目录大纲而没有规则。
- 不允许将设计原则写成无法测试的口号。
- 不允许把待业务决策的问题伪装成设计决策。

## 实现要求

文档文件名使用两位序号加 kebab-case，例如 `02-color-tokens.md`。组件规范文档必须提供组件职责、不负责事项、props 原则、状态、可访问性、Do/Don't 和验收清单。

## 验收清单

- [ ] 文档包含全部强制章节。
- [ ] 文档没有未标记的假设。
- [ ] AI 规则可以直接复制进 `AGENTS.md` 或 Codex prompt。
- [ ] 规则可被 PR review 检查。

## 关联文件

`docs/design/docs/design/00-final-decisions.md`、`docs/design/docs/design/08-governance/06-deferred-policy-decisions.md`
