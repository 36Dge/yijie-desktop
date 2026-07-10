# ADR 模板


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

提供设计系统相关架构决策记录模板。

## 适用范围

适用于设计系统变更、组件新增、token 修改、页面 pattern 新增和 AI/Codex 开发流程。

## 规范正文

```markdown
# ADR-XXXX: 决策标题

## 状态

Proposed / Accepted / Deprecated / Superseded

## 背景

为什么需要这个决策？

## 决策

最终决定是什么？

## 备选方案

列出比较过的方案。

## 选择原因

说明为什么选当前方案。

## 影响范围

影响哪些 token、组件、页面、文档、AI 规则。

## 迁移计划

如何迁移已有代码。

## 验收标准

如何判断完成。
```

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

`docs/adr/`
