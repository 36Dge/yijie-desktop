# Codex Prompt 片段


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 最后更新：2026-09-06
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

提供可复制到 Codex 任务中的前端开发约束片段。

## 适用范围

适用于 Codex/AI 生成或修改 `yijie-desktop` 前端代码的所有任务。

## 规范正文

## 新页面 Prompt 片段

```text
请在 yijie-desktop 中实现该页面。必须遵守 docs/design 下的设计系统：使用 YjPage/YjPageHeader/YjSection/YjCard 等组件；颜色、间距、圆角、字体必须使用 token；图标必须通过 YjIcon 和 registry；页面必须包含 loading、empty、error、permission denied 状态；默认中文文案，专业语气；兼容亮色和暗色主题。
```

## 色彩与品牌改造 Prompt 片段

```text
采用已确认的 2.1.0 组件配色与状态基线：A「清爽青柠」＋01「纯白通透」。亮色背景、导航、卡片使用纯白 token，正文使用石墨；青柠主操作配石墨文字/图标，导航selected保持原底+3px青柠标记，小筛选实色青柠；普通hover/pressed使用局部中性底；空间通过既有留白、间距及细中性边框区分。暗色使用中性石墨背景、卡片和弹层层级。Logo 引用商品包裹 / YJ 负形 SVG 的对应主题变体。普通正文/图标中性，focus为2px中性无glow，普通卡片/输入无阴影，readonly正常读值、disabled单独表达，selected+focus与error+focus可并存。色值与所有状态以04-components/09-component-color-state-matrix.md为准；保留当前字体、间距、圆角尺度、布局、组件 API、交互和独立语义状态色。
```

## 新组件 Prompt 片段

```text
请新增 Yj* 组件。组件必须有清晰 props、slots、状态、可访问性属性，样式使用 CSS variables，不硬编码视觉值，并提供基础使用示例。
```

## 图表 Prompt 片段

```text
请使用 ECharts 并接入易界图表主题。图表必须包含标题、单位、时间范围、tooltip、loading/empty/error 状态，不允许使用随机色板。
```

## AI / Codex 必须遵守

- 必须先读取本设计系统相关文档。
- 必须优先复用已有组件和 token。
- 必须输出可运行、可测试、可审查的代码。
- 不允许引入未经批准的新库、新风格、新视觉资产。

## 实现要求

所有 Codex 任务应在 prompt 或 `AGENTS.md` 中引用本规范。复杂页面生成前应先输出页面结构计划，再写代码。

## 验收清单

- [ ] 符合 design token。
- [ ] 使用 `Yj*` 组件。
- [ ] 图标走 registry。
- [ ] 状态完整。
- [ ] 无硬编码视觉值。

## 关联文件

`yijie-desktop/AGENTS.md`
