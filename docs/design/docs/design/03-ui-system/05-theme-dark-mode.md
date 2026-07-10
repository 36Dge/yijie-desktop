# 主题与暗色模式规范


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界亮色、暗色和跟随系统主题的行为。

## 适用范围

适用于全局主题、Naive UI、ECharts、图标、代码块、表格和弹层。

## 规范正文

## 默认策略

易界默认主题为**跟随系统**。

用户设置中可以提供三种选项：

1. 跟随系统。
2. 亮色。
3. 暗色。

## 主题状态来源

主题状态由 `theme.store.ts` 或等价 store 管理，并持久化到本地安全或普通偏好设置中。

## 暗色主题要求

- 背景不使用纯黑，使用深绿色/中性色混合。
- 品牌色在暗色中适当提亮。
- 边框提高透明度但保持层级。
- 图表色在暗色中必须可读。
- 空态插画和 logo 在暗色中不能失真。

## 主题切换

主题切换使用 120ms–180ms 过渡，不做夸张动画。切换不应重置页面状态、表单状态或 Agent 任务状态。

## AI / Codex 必须遵守

- 不允许只实现亮色主题。
- 不允许用 CSS filter 反转图标或 logo 代替暗色适配。
- 不允许主题切换导致路由刷新或任务中断。
- 不允许图表在暗色下使用不可读颜色。

## 实现要求

主题能力集中在 `src/stores/theme.store.ts`、`src/design/theme/naive-theme.ts`、`src/design/theme/echarts-theme.ts`、`src/styles/variables.css`。组件不得自行判断系统主题，必须消费统一 store 或 CSS variables。

## 验收清单

- [ ] 默认跟随系统。
- [ ] 用户可以切换主题。
- [ ] Naive UI 和 ECharts 同步主题。
- [ ] 切换不丢失页面状态。
- [ ] 暗色下对比度可读。

## 关联文件

`exports/src/design/theme/naive-theme.ts`、`docs/design/docs/design/02-tokens/02-color-tokens.md`
