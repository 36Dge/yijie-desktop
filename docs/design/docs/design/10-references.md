# 参考资料


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

记录本设计系统采用的行业参考、技术库和规范来源。

## 适用范围

适用于设计系统维护、技术选型复核和后续 ADR。

## 规范正文

## 平台与设计原则

- Apple Human Interface Guidelines：macOS / Apple 平台体验参考。
- Material Design 3 Design Tokens：Design Token 分层思想参考。
- WCAG 2.2：可访问性基线参考。

## 技术库

- Naive UI：Vue 3 UI 组件库。
- Lucide：主图标库。
- ECharts：图表库。
- Iconify / unplugin-icons：受控备用图标方案。

## 品牌资产

- 平台品牌图标优先使用官方素材。
- Simple Icons 只能作为审核后的备用参考，不作为默认来源。

## 内部文档

- `docs/design/docs/design/00-final-decisions.md`
- `docs/design/docs/design/07-ai-codex/01-ai-development-rules.md`
- `docs/design/docs/design/08-governance/06-deferred-policy-decisions.md`

## AI / Codex 必须遵守

- 不允许直接复制外部规范的大段内容。
- 不允许以外部库默认样式替代易界规范。
- 不允许使用未确认授权的品牌资产。

## 实现要求

引用外部方案时，应在 ADR 或文档中说明引用目的和本项目的具体约束。外部规范不自动覆盖易界已确认决策。

## 验收清单

- [ ] 参考资料用途明确。
- [ ] 品牌资产来源可追溯。
- [ ] 外部规范未替代内部决策。
- [ ] 技术库与实际依赖一致。

## 关联文件

`docs/design/docs/design/00-final-decisions.md`
