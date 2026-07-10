# 质量门禁


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义设计系统相关 PR 必须通过的检查。

## 适用范围

适用于设计系统变更、组件新增、token 修改、页面 pattern 新增和 AI/Codex 开发流程。

## 规范正文

## 必过检查

- TypeScript typecheck。
- ESLint。
- 单元测试或组件测试。
- 设计 token 使用检查。
- 图标 registry 检查。
- 暗色模式目视检查。
- Loading/Empty/Error 状态检查。

## UI 检查

PR 必须附带截图或录屏，至少包含亮色和暗色。复杂页面需要覆盖最小窗口尺寸 1180 × 760。

## 安全检查

不得包含真实店铺数据、平台 token、cookie、密钥、未授权品牌资产。

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
