# 布局组件规范


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 最后更新：2026-09-06
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义页面、区块、分栏、面板等布局组件。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

## 必备组件

- `YjAppShell`：应用壳，包含左侧导航、顶部状态区、主内容区。
- `YjPage`：页面容器，控制 padding、最大宽度、背景。
- `YjPageHeader`：页面标题、描述、主操作、次操作、面包屑。
- `YjSection`：页面区块，控制标题、说明、操作和内容间距。
- `YjSplitPane`：左右或中右分栏，适用于 Chat + 上下文。
- `YjRightPanel`：任务上下文、详情、审批等右侧面板。

## 规则

页面不得直接使用裸 `div` 构建整体布局。任何新页面必须先从 `YjPage` 开始，再组合区块和卡片。左右分栏必须使用布局组件，不在页面里硬编码宽度。

亮色模式中 App Shell、导航、页面、普通卡片和上下文面板使用纯白结构背景 token，层级由已有间距尺度、留白和细中性边框表达；不得以灰色或浅绿色大面积铺底替代结构。暗色使用主题定义的中性石墨层级；浮层按既有规则使用必要阴影。此次更新不调整布局尺寸、圆角尺度或组件职责。

本类组件的文字、图标、背景、边界、2px 中性焦点、普通容器无阴影与真实浮层轻投影，以 [组件配色与状态矩阵](./09-component-color-state-matrix.md) 为准。readonly 保留正常读值；disabled 只作用于不可用控件；error 与 selected 不能抹掉焦点。现有组件职责、布局与交互不变。

## AI / Codex 必须遵守

- 优先复用现有 `Yj*` 组件，不重复造相同 UI。
- 新组件必须定义 props、slots、状态、空态、错误态和可访问性要求。
- 不允许在业务页面中复制组件内部结构。
- 不允许组件内部硬编码视觉值。

## 实现要求

组件文件使用 PascalCase，例如 `YjMetricCard.vue`。复杂组件应配套 `types.ts`、`README.md` 或文档说明。组件样式使用 token 和 CSS variables。

## 验收清单

- [ ] 组件职责单一。
- [ ] Props 命名清晰。
- [ ] 支持 loading/disabled/error/empty 等必要状态。
- [ ] 可访问性完整。
- [ ] 有基础测试或 Story 示例。

## 关联文件

`docs/design/docs/design/05-patterns/01-app-shell-navigation.md`、`docs/design/docs/design/01-foundations/06-window-density-baseline.md`
