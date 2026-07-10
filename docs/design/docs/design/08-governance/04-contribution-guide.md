# 贡献指南


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义研发、设计、产品和 Codex 如何向设计系统贡献内容。

## 适用范围

适用于设计系统变更、组件新增、token 修改、页面 pattern 新增和 AI/Codex 开发流程。

## 规范正文

## 新增组件

新增组件前必须确认没有现有组件可复用。新增后必须补文档、示例、状态和测试。

## 新增 token

新增 token 必须说明语义和使用场景，不允许为单个页面创建 token。

## 新增图标

新增图标必须进入 registry。品牌图标必须记录官方来源。

## 新增 pattern

新增页面 pattern 必须说明页面目标、结构、状态、组件和验收清单。

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

`docs/design/docs/design/01-documentation-standard.md`
