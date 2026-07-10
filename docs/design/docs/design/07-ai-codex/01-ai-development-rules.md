# AI / Codex 开发规则


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
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

## 样式约束

禁止：

```css
color: #95BF47;
padding: 17px;
border-radius: 11px;
box-shadow: 0 8px 30px rgba(0,0,0,.2);
```

应该：

```css
color: var(--yj-color-brand-primary);
padding: var(--yj-space-4);
border-radius: var(--yj-radius-lg);
box-shadow: var(--yj-shadow-card);
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

`yijie-desktop/AGENTS.md`、`docs/design/docs/design/07-ai-codex/06-agents-md-snippet.md`
