# 间距与布局 Tokens


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界标准密度下的间距、页面 padding、布局宽度和栅格规则。

## 适用范围

适用于页面容器、卡片、表单、列表、表格、Chat、Agent 时间线和右侧面板。

## 规范正文

## 4px 基础栅格

| Token | 值 |
|---|---|
| `--yj-space-0` | 0 |
| `--yj-space-1` | 4px |
| `--yj-space-2` | 8px |
| `--yj-space-3` | 12px |
| `--yj-space-4` | 16px |
| `--yj-space-5` | 20px |
| `--yj-space-6` | 24px |
| `--yj-space-8` | 32px |
| `--yj-space-10` | 40px |
| `--yj-space-12` | 48px |
| `--yj-space-16` | 64px |

## 页面间距

- 页面 padding：24px。
- 大屏页面 padding：32px。
- 区块间距：24px。
- 卡片内部：20px。
- 表单项间距：16px。
- 按钮组间距：8px 或 12px。

## 布局宽度

- 左导航展开：240px。
- 左导航收起：72px。
- Chat 会话列表：280px。
- 右侧上下文面板：320–380px。
- 表单最大宽度：720–960px。
- 定时任务创建、编辑及草案确认弹窗：520px（`--yj-layout-schedule-form-width`），竖向分组；标题和底部操作固定，内容超高时在弹窗内滚动，按实际缩放后的可用视口限制宽高。
- 定时任务页签与筛选工具栏同排：搜索、状态、排序的标准宽度为 240 / 112 / 112px（`--yj-layout-schedule-search-width` / `--yj-layout-schedule-state-width` / `--yj-layout-schedule-sort-width`）；状态与排序组件等宽，排序显示“最新优先”或“最早优先”。执行记录页的任务筛选与状态筛选同为 112px（`--yj-layout-schedule-plan-filter-width` 引用状态宽度 token），占位文字为“全部任务”，下拉仅显示任务标题；下拉菜单可随标题内容展开，宽度不超过可用视口。可用宽度不足时换行。列表空状态最小高度为 360px（`--yj-layout-schedule-empty-min-height`）。
- 新建任务内容列最大宽度：760px（`--yj-layout-chat-entry-max`）；活跃会话输入区最大宽度继续为 880px。
- 详情页主内容建议最大宽度：1120px。

## AI / Codex 必须遵守

- 不允许使用非 4px 栅格间距，例如 13px、17px、27px、31px。
- 不允许同级卡片出现不同 padding。
- 不允许在页面里直接写 layout magic number。
- 不允许让布局宽度散落在多个组件中。

## 实现要求

布局 token 写入 `src/design/constants/layout.ts` 和 CSS variables。组件暴露 `size` 或 `density` 时只能映射到 token，不接受任意数字。

## 验收清单

- [ ] 间距符合 4px 栅格。
- [ ] 页面 padding 统一。
- [ ] 面板宽度来自常量。
- [ ] 标准密度没有被破坏。

## 关联文件

`docs/design/docs/design/01-foundations/06-window-density-baseline.md`、`exports/src/styles/variables.css`

- 定时任务执行记录详情：520px（`--yj-layout-schedule-record-width`），五项标签/值布局，底部操作右对齐；窗口不足时保留 16px 两侧安全间距，长内容在弹窗内滚动。
