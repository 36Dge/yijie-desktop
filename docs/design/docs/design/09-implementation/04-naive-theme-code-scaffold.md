# Naive UI 主题代码骨架


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 最后更新：2026-09-06
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

提供 Naive UI themeOverrides 落地方式。

## 适用范围

适用于 `yijie-desktop` 仓库的实际代码落地。

## 规范正文

核心文件：

```text
exports/src/design/theme/naive-theme.ts
```

主题必须集中配置，不允许页面局部覆盖。

```ts
// 应用入口 / 主题控制器：引用本应用已归位的文件，不 import docs/design/exports。
import './styles/variables.css'
import './styles/component-colors.css'
import { createNaiveThemeOverrides } from './design/theme/naive-theme'

export function resolveThemeOverrides() {
  const styles = getComputedStyle(document.documentElement)
  return createNaiveThemeOverrides((name) => styles.getPropertyValue(name).trim())
}
```

上例展示统一入口；完整 theme factory 参考 `exports/src/design/theme/naive-theme.ts`。颜色角色与共享适配 CSS 必须一起接入：中性普通文字、正文、2px focus、导航标记、disabled优先级、semantic ink、无阴影普通容器和浮层轻投影。不要再追加第二个候选/覆盖主题函数；完整状态见 [组件配色与状态矩阵](../04-components/09-component-color-state-matrix.md)。

`App.vue` 在设置 light/dark 的 `data-theme` 后，通过
`getComputedStyle(document.documentElement).getPropertyValue(name)` 读取 token。
不得把 `var(--token)` 直接传入 Naive UI 的颜色类 override；组件库会对颜色做运行时计算。

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

`exports/src/design/theme/naive-theme.ts`
