# Design Token 代码骨架


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 最后更新：2026-09-06
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

提供 CSS variables 和 TypeScript token 的落地示例。

## 适用范围

适用于 `yijie-desktop` 仓库的实际代码落地。

## 规范正文

核心文件见：

```text
exports/src/styles/variables.css
```

关键 token：

```css
:root {
  --yj-color-brand-primary: #C3F35B;
  --yj-color-brand-hover: #D0F780;
  --yj-color-brand-active: #B1E343;
  --yj-color-brand-soft: #FFFFFF;
  --yj-color-brand-text: #25282B;
  --yj-color-on-brand: #25282B;
  --yj-color-text-primary: #25282B;
  --yj-color-text-body: #25282B;
  --yj-color-text-secondary: #51565D;
  --yj-color-border-control: #8C939B;
  --yj-color-focus-ring: #25282B;
  --yj-focus-ring-width: 2px;
  --yj-color-text-selection-bg: #C3F35B;
  --yj-color-text-selection-ink: #25282B;
  --yj-color-chart-series-1: #4B651D;
  --yj-color-bg-app: #FFFFFF;
  --yj-color-bg-page: #FFFFFF;
  --yj-color-bg-card: #FFFFFF;
  --yj-color-bg-elevated: #FFFFFF;
  --yj-font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --yj-space-4: 16px;
  --yj-radius-lg: 12px;
  --yj-shadow-card: none;
  --yj-shadow-control-focus: 0 0 0 var(--yj-focus-ring-width) var(--yj-color-focus-ring);
  --yj-shadow-popover: 0 6px 20px rgba(37, 40, 43, .10);
}

[data-theme="dark"] {
  --yj-color-text-primary: #F5F7FA;
  --yj-color-text-body: #E6E9ED;
  --yj-color-text-secondary: #C2C7CE;
  --yj-color-border-control: #6A727C;
  --yj-color-focus-ring: #F5F7FA;
  --yj-color-chart-series-1: #C3F35B;
  --yj-color-bg-app: #191C20;
  --yj-color-bg-page: #191C20;
  --yj-color-bg-card: #25282B;
  --yj-color-bg-elevated: #2E3237;
  --yj-color-brand-soft: #25282B;
  --yj-color-brand-text: #F5F7FA;
  --yj-shadow-card: none;
  --yj-shadow-popover: 0 6px 20px rgba(0, 0, 0, .28);
}
```

暗色主题通过 `[data-theme="dark"]` 覆盖，不在组件中判断主题。以上为节选，完整 token 以颜色章节及 `exports/src/styles/variables.css` 为准。亮暗主题的青柠主色和 on-brand 石墨前景相同。普通卡片与输入无阴影，浮层才使用轻投影；soft 只保留中性兼容槽位，新控件直接按角色取色。运行应用在入口同时导入 variables.css 和 component-colors.css；参考导出包含同名文件，不由应用跨目录直接导入。

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

`exports/src/styles/variables.css`
