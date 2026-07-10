# Design Token 架构


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界视觉值的唯一来源，避免 AI 在页面中硬编码样式。

## 适用范围

适用于颜色、字体、间距、圆角、阴影、边框、动效、层级、透明度、图表和组件主题。

## 规范正文

易界采用三层 token 架构：

## 1. Primitive Tokens

原始值，例如 `green-500`、`gray-900`、`space-4`、`radius-md`。Primitive token 不直接表达业务含义。

## 2. Semantic Tokens

语义值，例如 `text-primary`、`bg-page`、`border-subtle`、`brand-primary`、`status-success`。业务页面必须优先使用 semantic token。

## 3. Component Tokens

组件值，例如 `button-primary-bg`、`card-radius`、`chat-bubble-assistant-bg`、`agent-running-color`。复杂组件必须使用 component token。

## 命名规则

CSS 变量以 `--yj-` 开头：

```css
--yj-color-brand-primary
--yj-color-text-primary
--yj-space-4
--yj-radius-md
--yj-shadow-card
```

TypeScript token 使用 camelCase：

```ts
yjColorBrandPrimary
yjSpace4
yjRadiusMd
```

## 修改规则

任何 token 修改都必须说明影响范围。如果是破坏性变更，需要 ADR 或版本记录。

## AI / Codex 必须遵守

- 不允许在 `.vue` 文件中硬编码 HEX、RGB、HSL、box-shadow、border-radius、font-size。
- 不允许新增 token 但不更新文档。
- 不允许在业务页面直接使用 primitive color，必须使用 semantic token。
- 不允许通过局部 CSS 覆盖 Naive UI 核心视觉来绕过 themeOverrides。

## 实现要求

Token 同步到 `src/styles/variables.css`、`src/design/tokens/*.ts`、`src/design/theme/naive-theme.ts`。所有业务组件只消费 token，不定义独立视觉体系。

## 验收清单

- [ ] Token 有命名、用途、亮色/暗色值。
- [ ] 页面没有硬编码视觉值。
- [ ] Naive UI themeOverrides 使用 token。
- [ ] 新组件没有私有色板。

## 关联文件

`exports/src/styles/variables.css`、`exports/src/design/theme/naive-theme.ts`
