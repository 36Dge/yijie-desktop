# 窗口与页面密度基线


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界桌面端窗口尺寸、页面密度和布局尺度。

## 适用范围

适用于 App Shell、页面容器、列表、表格、表单、Chat、任务详情和右侧上下文面板。

## 规范正文

## 页面密度

易界采用**标准密度**。标准密度适合长时间经营工作：比紧凑密度更易读，比宽松密度更高效。

## 窗口尺寸

- 最小窗口尺寸：1180 × 760。
- 推荐默认窗口：1280 × 820。
- 大屏优化宽度：1440 × 900 及以上。

## 布局尺度

- 左侧主导航：72px 图标模式，240px 展开模式。
- Chat 会话列表：280px。
- 右侧上下文面板：320px 至 380px。
- 页面主内容最大宽度：数据页可全宽，表单页建议 960px。
- 页面 padding：24px；大屏可用 32px。

## 表格密度

- 标准行高：48px。
- 紧凑表格仅用于高密度数据页，必须由页面级配置明确启用。
- 表格操作列必须固定宽度，避免按钮换行。

## AI / Codex 必须遵守

- 不允许为单个页面临时定义全新密度。
- 不允许在最小窗口下出现横向主体滚动，除数据表格内部横向滚动外。
- 不允许把页面 padding 写死为非 token 值。
- 不允许在标准密度页面中混入过小字号或过窄行高。

## 实现要求

布局常量写入 `src/design/constants/layout.ts`，CSS 使用 `--yj-layout-*`、`--yj-space-*` token。页面组件通过 `YjPage`、`YjPageHeader`、`YjSection` 控制结构。

## 验收清单

- [ ] 页面在 1180 × 760 可用。
- [ ] 标准密度一致。
- [ ] 表格、列表、卡片行高统一。
- [ ] 面板宽度来自布局常量。
- [ ] 页面没有任意 padding/margin。

## 关联文件

`docs/design/docs/design/02-tokens/04-spacing-layout-tokens.md`、`exports/src/design/constants/layout.ts`
