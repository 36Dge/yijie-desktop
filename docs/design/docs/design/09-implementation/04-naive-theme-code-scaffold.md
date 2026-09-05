# Naive UI 主题代码骨架


## 文档状态

- 状态：Accepted
- 版本：2.0.0
- 最后更新：2026-09-05
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
export function createNaiveThemeOverrides(readVariable) {
  const token = (name) => {
    const value = readVariable(name).trim()
    if (!value) throw new Error(`Missing design token: ${name}`)
    return value
  }

  return {
    common: {
      fontFamily: token('--yj-font-family-sans'),
      primaryColor: token('--yj-color-brand-primary'),
      primaryColorHover: token('--yj-color-brand-hover'),
      primaryColorPressed: token('--yj-color-brand-active'),
      borderRadius: token('--yj-radius-md'),
      bodyColor: token('--yj-color-bg-app'),
      cardColor: token('--yj-color-bg-card'),
      textColorBase: token('--yj-color-text-primary')
    },
    Button: {
      textColorPrimary: token('--yj-color-on-brand'),
      textColorHoverPrimary: token('--yj-color-on-brand'),
      textColorPressedPrimary: token('--yj-color-on-brand'),
      textColorFocusPrimary: token('--yj-color-on-brand')
    }
  }
}
```

上例仅展示主色、结构背景和实色主按钮前景的关键映射。完整配置还需覆盖 Menu、Layout、Card、Input、Modal 等控件及其亮暗状态，见 `exports/src/design/theme/naive-theme.ts`。不能只替换 primaryColor 而保留白字青柠按钮。

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
