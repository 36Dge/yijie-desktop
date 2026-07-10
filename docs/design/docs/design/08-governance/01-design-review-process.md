# 设计评审流程


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义 UI 设计和前端实现的评审流程。

## 适用范围

适用于设计系统变更、组件新增、token 修改、页面 pattern 新增和 AI/Codex 开发流程。

## 规范正文

## 评审类型

- 轻量评审：小组件、小页面调整。
- 标准评审：新增页面、新组件、新 pattern。
- 架构评审：token、主题、图标体系、导航体系、Agent 关键体验。

## 流程

1. Codex 或研发提交变更说明。
2. 自查 UI Review 清单。
3. 设计/产品/前端 owner review。
4. 必要时更新文档或 ADR。
5. 合并后记录版本。

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

`docs/design/docs/design/07-ai-codex/03-ui-review-checklist.md`
