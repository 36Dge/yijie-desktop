# AGENTS.md 片段


## 文档状态

- 状态：Accepted
- 版本：2.0.0
- 最后更新：2026-09-05
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

提供可直接写入 `yijie-desktop/AGENTS.md` 的设计系统规则。

## 适用范围

适用于 Codex/AI 生成或修改 `yijie-desktop` 前端代码的所有任务。

## 规范正文

```markdown
## Design System / UX Rules

- All UI code must follow `docs/design/docs/design/`.
- Use Tauri v2 + Vue 3 + Vite + TypeScript + Pinia + Vue Router + Naive UI.
- Use Naive UI through centralized theme overrides.
- Use ECharts for charts and the Yijie chart theme.
- Use Lucide icons only through `YjIcon` and `src/icons/registry.ts`.
- Do not hardcode colors, font sizes, spacing, radii, shadows, or z-index.
- Use `YjPage`, `YjPageHeader`, `YjSection`, `YjCard`, `YjMetricCard`, `YjDataTable`, `YjChartCard` before creating page-specific markup.
- All pages must support loading, empty, error, permission denied, and ready states.
- UI copy must be Chinese and professional.
- Default theme follows system setting; all pages must work in light and dark themes.
- Follow the accepted 2.0.0 color/brand baseline: pure-white light surfaces, graphite text, lime primary controls with graphite foreground; use whitespace, existing spacing tokens, and thin neutral borders for hierarchy.
- Dark mode uses neutral graphite surface levels; keep the same lime brand accent and independent semantic status colors.
- Use the approved parcel / YJ negative-space SVG assets with the correct light/dark variant. Do not use the legacy bag mark or embed raster images in SVG.
- This color/brand refresh does not change typography, spacing/radius scales, layout, component APIs, or interaction rules.
- High-impact commerce operations must include confirmation or approval UI hooks. The exact policy is defined later by backend/business policy.
- Do not commit real seller data, platform tokens, cookies, credentials, or unlicensed brand assets.
```

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

`yijie-desktop/AGENTS.md`
