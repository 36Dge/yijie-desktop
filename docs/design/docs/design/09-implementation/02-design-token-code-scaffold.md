# Design Token 代码骨架


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
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
  --yj-color-brand-primary: #95BF47;
  --yj-color-brand-hover: #A3C95C;
  --yj-color-brand-active: #7FA33C;
  --yj-color-brand-soft: #F3F8EA;
  --yj-font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --yj-space-4: 16px;
  --yj-radius-lg: 12px;
  --yj-shadow-card: 0 8px 24px rgba(24, 35, 15, 0.08);
}
```

暗色主题通过 `[data-theme="dark"]` 覆盖，不在组件中判断主题。

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
