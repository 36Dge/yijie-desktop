# 推荐文件结构


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

给出 `yijie-desktop` 中 Design System 的推荐落地目录。

## 适用范围

适用于 `yijie-desktop` 仓库的实际代码落地。

## 规范正文

```text
yijie-desktop/
  docs/
    design/
      ...本规范文档

  src/
    design/
      tokens/
        color.ts
        typography.ts
        spacing.ts
        radius.ts
        shadow.ts
        motion.ts
        zIndex.ts
      theme/
        naive-theme.ts
        echarts-theme.ts
      constants/
        layout.ts
        density.ts

    styles/
      variables.css
      component-colors.css  # 统一Naive状态/文本选区颜色适配
      global.css
      reset.css

    icons/
      registry.ts
      types.ts
      custom/
        brands/
        yijie/

    components/
      yijie/
        YjIcon.vue
        YjLogo.vue
        YjPage.vue
        YjPageHeader.vue
        YjSection.vue
        YjCard.vue
        YjMetricCard.vue
        YjDataTable.vue
        YjChartCard.vue
        YjEmpty.vue
        YjStatusTag.vue
        YjAgentTimeline.vue
        YjToolCallCard.vue
        YjApprovalCard.vue
```

业务页面只能组合这些基础设施，不应在页面中创造长期复用的样式和结构。

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

`exports/src/`
