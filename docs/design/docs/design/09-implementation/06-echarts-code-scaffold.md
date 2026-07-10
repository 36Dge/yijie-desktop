# ECharts 代码骨架


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

提供 ECharts 主题和图表组件落地方式。

## 适用范围

适用于 `yijie-desktop` 仓库的实际代码落地。

## 规范正文

核心文件建议：

```text
src/design/theme/echarts-theme.ts
src/components/yijie/YjChartCard.vue
```

ECharts 配置必须从统一主题取色：

```ts
export const yijieChartPalette = [
  '#95BF47', '#4C84FF', '#22B8CF', '#8B5CF6',
  '#F59E0B', '#F97316', '#EF4444', '#64748B'
]
```

`YjChartCard` 必须封装 title、description、loading、empty、error、timeRange 和 tooltip 约定。

## AI / Codex 必须遵守

- 代码必须与文档一致。
- 不允许只更新文档不提供可落地结构。
- 不允许只复制代码片段而不接入现有工程。
- 不允许绕过类型检查。

## 实现要求

实现文件应逐步从 `exports/` 迁移到 `yijie-desktop/src/`，并在 PR 中说明迁移范围。

## 验收清单

- [ ] 文件放置位置正确。
- [ ] 命名符合规范。
- [ ] 可通过 typecheck。
- [ ] 与 token 和主题一致。
- [ ] 有使用示例。

## 关联文件

`docs/design/docs/design/03-ui-system/04-data-visualization.md`
