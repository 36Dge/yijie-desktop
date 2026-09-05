# Naive UI 集成规范


## 文档状态

- 状态：Accepted
- 版本：2.0.0
- 最后更新：2026-09-05
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义 Naive UI 在易界中的角色、主题接入方式和二次封装边界。

## 适用范围

适用于所有基于 Naive UI 的按钮、表单、表格、弹窗、抽屉、消息、菜单和主题配置。

## 规范正文

Naive UI 是基础组件库，不是易界完整设计系统。易界设计系统由 design tokens、业务组件、页面 patterns、内容规范和 Codex 规则共同构成。

## 使用原则

- 基础控件可直接使用 Naive UI，但视觉必须由 `themeOverrides` 控制。
- 复杂业务组件必须封装为 `Yj*` 组件。
- 页面不得直接堆叠大量 Naive UI 组件形成一次性布局。
- 全局 Provider 必须集中在应用入口配置。

主题映射必须同时覆盖背景与控件前景：亮色布局、菜单和卡片为纯白；青柠 Primary 按钮的默认、hover、pressed 和 focus 前景为石墨。Menu 选中态使用局部品牌 token，文本型按钮使用可读品牌文字 token；暗色采用中性石墨层级。仅修改 `common.primaryColor` 不能视为完成本次配色接入。

当前参考主题支持普通按钮、实心 `type="primary"`、`text` 和 `ghost` 品牌按钮，以及颜色 Tokens 中列出的选中控件。Naive UI 的 `secondary` / `tertiary` / `quaternary` 与 `type="primary"` 组合会直接把主填充色用于文字，不能依靠 `textColorPrimary` 等全局文字键修正；本规范示例不使用这些组合。后续确需使用时，在共享 `Yj*` 按钮封装中提供可读的文字/底色映射并验证明暗状态，不在业务页面临时补色。

## 推荐 Provider

```vue
<n-config-provider :theme="resolvedTheme" :theme-overrides="resolvedThemeOverrides">
  <n-dialog-provider>
    <n-message-provider>
      <n-notification-provider>
        <RouterView />
      </n-notification-provider>
    </n-message-provider>
  </n-dialog-provider>
</n-config-provider>
```

## 封装边界

应该封装：页面容器、指标卡、Agent Timeline、ApprovalCard、ToolCallCard、DataTable、Empty、StatusTag、Icon、Logo。

可以直接使用：普通 Button、Input、Select、Switch、Tooltip、Modal，但必须遵守主题和文案规范。

## AI / Codex 必须遵守

- 不允许在页面局部覆盖 Naive UI 样式来创造新风格。
- 不允许为每个页面重新配置 themeOverrides。
- 不允许业务页面直接处理复杂状态展示，应沉淀组件。
- 不允许使用 Naive UI 默认主题而不接入易界 token。

## 实现要求

`src/design/theme/naive-theme.ts` 是 Naive UI 主题唯一入口。`App.vue` 或 provider 层根据系统主题选择 light/dark，并在主题切换后通过 `getComputedStyle` 把 CSS token 解析为实际值，再调用 `createNaiveThemeOverrides`。Naive UI 会对颜色做运行时运算，禁止把 `var(--token)` 字符串直接传入颜色类 override。业务组件不得直接 import 多套主题。

## 验收清单

- [ ] Naive UI 主题集中配置。
- [ ] 颜色、圆角、字体来自 token。
- [ ] 业务组件有二次封装。
- [ ] 页面没有一次性复杂样式。

## 关联文件

`exports/src/design/theme/naive-theme.ts`、`docs/design/docs/design/09-implementation/04-naive-theme-code-scaffold.md`
