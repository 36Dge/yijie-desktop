# Design Token 代码骨架


## 文档状态

- 状态：Accepted
- 版本：2.0.0
- 最后更新：2026-09-05
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
  --yj-color-brand-soft: #F0F8DF;
  --yj-color-brand-text: #4B651D;
  --yj-color-on-brand: #25282B;
  --yj-color-text-primary: #25282B;
  --yj-color-bg-app: #FFFFFF;
  --yj-color-bg-page: #FFFFFF;
  --yj-color-bg-card: #FFFFFF;
  --yj-color-bg-elevated: #FFFFFF;
  --yj-font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --yj-space-4: 16px;
  --yj-radius-lg: 12px;
  --yj-shadow-card: 0 8px 24px rgba(37, 40, 43, 0.08);
}

[data-theme="dark"] {
  --yj-color-text-primary: #F5F7FA;
  --yj-color-bg-app: #191C20;
  --yj-color-bg-page: #191C20;
  --yj-color-bg-card: #25282B;
  --yj-color-bg-elevated: #2E3237;
  --yj-color-brand-soft: #2E3823;
  --yj-color-brand-text: #C3F35B;
  --yj-shadow-card: 0 8px 24px rgba(0, 0, 0, 0.20);
}
```

暗色主题通过 `[data-theme="dark"]` 覆盖，不在组件中判断主题。以上为节选，完整 token 以颜色章节及 `exports/src/styles/variables.css` 为准。亮暗主题的青柠主色和 on-brand 石墨前景相同。普通白色卡片优先使用间距和细中性边框分层，不能只因存在 shadow token 就叠加默认阴影；soft token 只用于局部交互状态。

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
