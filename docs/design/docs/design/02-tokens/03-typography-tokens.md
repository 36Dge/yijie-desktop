# 字体 Tokens


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界桌面端字体栈、字号、行高、字重和文本层级。

## 适用范围

适用于标题、正文、说明、表格、表单、代码、指标数字和空态文案。

## 规范正文

## 字体栈

```css
--yj-font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
--yj-font-family-mono: "SF Mono", Menlo, Monaco, Consolas, monospace;
```

不内置第三方字体文件，不提交字体文件到仓库。

## 字体层级

| Token | 字号 / 行高 / 字重 | 用途 |
|---|---|---|
| `display` | 32 / 40 / 600 | 极少数空态或欢迎页 |
| `page-title` | 24 / 32 / 600 | 页面标题 |
| `section-title` | 18 / 26 / 600 | 区块标题 |
| `card-title` | 16 / 24 / 600 | 卡片标题 |
| `body` | 14 / 22 / 400 | 默认正文 |
| `body-strong` | 14 / 22 / 600 | 强调正文 |
| `caption` | 12 / 18 / 400 | 辅助说明 |
| `code` | 13 / 20 / 400 | 代码、ID、日志 |
| `metric-lg` | 28 / 36 / 650 | 核心指标 |
| `metric-md` | 22 / 30 / 650 | 次级指标 |

## 中文排版

中文界面避免过长句。按钮文案优先 2 到 6 个汉字。解释性文案使用短句，必要时使用列表。

## 数字排版

指标数字使用 `font-variant-numeric: tabular-nums;`，保证表格与指标卡对齐。

## AI / Codex 必须遵守

- 不允许在页面中临时写 13px、15px、17px、19px 等非规范字号。
- 不允许在同一页面使用过多字重。
- 不允许正文小于 12px。
- 不允许把说明文案做成低对比度不可读文本。

## 实现要求

字体 token 写入 CSS variables。组件通过 class 或 token 使用，不在 scoped style 里直接写 font-size。指标组件必须启用 tabular numeric。

## 验收清单

- [ ] 页面字号层级不超过 4 类。
- [ ] 标题、正文、说明层级清晰。
- [ ] 表格和指标数字对齐。
- [ ] 没有临时字号。

## 关联文件

`exports/src/styles/variables.css`、`docs/design/docs/design/06-content/01-copywriting.md`
