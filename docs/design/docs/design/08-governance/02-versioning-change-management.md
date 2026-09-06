# 版本与变更管理


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义设计系统版本策略和破坏性变更处理。

## 适用范围

适用于设计系统变更、组件新增、token 修改、页面 pattern 新增和 AI/Codex 开发流程。

## 规范正文

## 版本格式

使用语义化版本：`major.minor.patch`。

- patch：文案修正、说明补充、非破坏 token 增补。
- minor：新增组件、pattern、token。
- major：品牌色、主题架构、核心组件 API、导航体系等破坏性变更。

## 变更记录

每次变更必须记录：变更内容、影响范围、迁移方式、是否需要 Codex 更新 prompt 或 AGENTS.md。

当前组件配色与状态规范为 2.1.0，详见 [2026-09-06 已接受更新记录](./08-component-color-convergence.md)。本次保持 2.0.0 的品牌主色、Logo、主题选择机制和组件 API，增补/收敛颜色角色与状态映射，按 minor 管理。未改动章节保持各自版本，不代表活跃应用或接口版本同步升级。2.0.0 的品牌决策保留为历史来源。

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

`CHANGELOG.md`、`docs/design/docs/design/08-governance/03-adr-template.md`
