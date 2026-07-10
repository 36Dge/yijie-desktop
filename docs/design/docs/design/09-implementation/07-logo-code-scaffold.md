# Logo 代码骨架


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

提供易界 Logo 与 App Icon 的工程落地方式。

## 适用范围

适用于 `yijie-desktop` 仓库的实际代码落地。

## 规范正文

核心资产：

```text
docs/design/docs/public/brand/yijie-bag-logo.svg
docs/design/docs/public/brand/yijie-app-icon.svg
```

建议迁移到：

```text
src/assets/brand/yijie-bag-logo.svg
src/assets/brand/yijie-app-icon.svg
src/components/yijie/YjLogo.vue
```

`YjLogo` 支持：

```ts
type YjLogoVariant = 'mark' | 'horizontal' | 'icon-only'
type YjLogoSize = 'sm' | 'md' | 'lg'
```

App 打包时从 SVG 导出 PNG/ICNS，不手工维护多套源文件。

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

`docs/design/docs/design/03-ui-system/06-brand-assets.md`
