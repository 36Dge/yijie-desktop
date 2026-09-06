# Codex 页面生成契约


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 最后更新：2026-09-06
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义 Codex 新增页面时必须遵循的流程。

## 适用范围

适用于 Codex/AI 生成或修改 `yijie-desktop` 前端代码的所有任务。

## 规范正文

## 页面生成前

Codex 必须先判断页面类型：Chat、Agent 任务、数据页、流程页、设置页、领域分析页。

颜色和品牌采用当前 2.1.0 组件配色基线，先读颜色 token、暗色主题和品牌资产章节。新需求与现有页面改造都使用纯白/石墨空间、青柠主操作及商品包裹 / YJ SVG；旧页面截图不是旧灰绿底色继续使用的依据。

## 页面生成步骤

1. 选择 pattern。
2. 列出需要复用的 `Yj*` 组件。
3. 定义页面状态：loading、empty、error、ready、permission denied。
4. 定义数据来源和 mock 数据。
5. 定义主操作和风险操作。
6. 编写 Vue 页面。
7. 补充类型、store 或 composable。
8. 运行 lint/typecheck/test。
9. 检查亮色、暗色及 1180 × 760 下的阅读层级、按钮前景色、Logo 变体与键盘焦点；不改动已确认的布局和交互规范。

## 输出要求

页面代码必须清晰分层：页面组合 UI，composable 管状态，domain 放业务模型，api 放接口调用。

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

`docs/design/docs/design/05-patterns/`、`src/pages/`
