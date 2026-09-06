# AI / Codex 开发规则


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 最后更新：2026-09-06
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义 Codex 开发易界桌面端 UI 时的强制规则。

## 适用范围

适用于 Codex/AI 生成或修改 `yijie-desktop` 前端代码的所有任务。

## 规范正文

## 强制规则

1. 所有颜色必须来自 `src/styles/variables.css` 或 token，不允许硬编码 HEX。
2. 所有图标必须通过 `YjIcon`，不允许页面直接 import 图标库。
3. 所有页面必须基于 `YjPage`、`YjPageHeader`、`YjSection` 等布局组件。
4. 所有业务卡片优先使用 `YjCard`、`YjMetricCard`、`YjChartCard`、`YjDataTable`。
5. Agent UI 必须使用 `YjAgentTimeline`、`YjToolCallCard`、`YjApprovalCard` 等组件。
6. 页面必须包含 loading、empty、error、permission denied 状态。
7. 默认文案为中文，语气专业。
8. 默认主题跟随系统，所有页面必须兼容亮色和暗色。
9. 页面标准密度，不允许随意缩小字号或间距。
10. 不允许将平台 token、真实店铺数据、真实卖家数据写入示例或 mock。

## 色彩与品牌基线

新页面与现有页面后续改造均采用 A「清爽青柠」＋01「纯白通透」：

- 亮色的 App、页面、导航、卡片与面板均使用纯白结构背景 token；以留白、既有间距尺度和细中性边框区分空间。
- 主文字使用石墨；主按钮使用青柠背景与 `--yj-color-on-brand` 石墨文字/图标，hover 与 pressed 也保持这一前景色。普通链接和文本型操作直接使用 `--yj-color-text-primary`；操作中的正文说明使用 `--yj-color-text-body`，新代码不使用 brand-text 兼容槽位。
- 普通 UI 不消费浅绿/深绿 soft：导航常态保持原底+3px 青柠标记，小筛选实色青柠；hover/pressed 用局部中性底。
- 暗色使用中性石墨背景、卡片、弹层层级；同样的青柠主按钮配石墨字。成功、警告、失败、Agent 状态保持独立语义。
- Logo 统一引用品牌章节的商品包裹 / YJ 负形 SVG 及亮暗变体，不重绘轮廓、不嵌入 PNG。

准确值以 [颜色 Tokens](../02-tokens/02-color-tokens.md)、[主题与暗色模式](../03-ui-system/05-theme-dark-mode.md)、[品牌资产](../03-ui-system/06-brand-assets.md) 为准。此次基线不改变字体、间距、圆角尺度、布局结构和交互规则。

普通文字按 primary/body/secondary/metadata/disabled 分角色；正文和普通工具图标不使用深绿或青柠，图表首色独立固定。所有新页面及现有页面修改都必须逐项查 [组件配色与状态矩阵](../04-components/09-component-color-state-matrix.md)：2px 中性 focus、普通卡片/输入无阴影、浮层轻投影、readonly/disabled 与组合优先级不可省略。

## 样式约束

禁止：

```css
color: #C3F35B;
padding: 17px;
border-radius: 11px;
box-shadow: 0 8px 30px rgba(0,0,0,.2);
```

应该：

```css
color: var(--yj-color-text-primary);
padding: var(--yj-space-4);
border-radius: var(--yj-radius-lg);
box-shadow: none; /* 普通卡片/输入不使用浮层投影 */
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
- [ ] 亮色为纯白结构空间，暗色为中性石墨层级，青柠实色控件配石墨文字。
- [ ] Logo 为当前批准 SVG 的正确主题变体。

## 关联文件

`yijie-desktop/AGENTS.md`、`docs/design/docs/design/07-ai-codex/06-agents-md-snippet.md`
