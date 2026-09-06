# 表单组件规范


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义输入、选择、校验、分组、提交和授权配置表单规范。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

## 表单结构

表单应由标题、说明、字段组、字段说明、错误提示和操作区组成。复杂表单使用分组或步骤，不将大量字段堆在一个卡片中。

## 校验

错误提示必须靠近字段，说明原因和修复方式。不得只提示“格式错误”。

## 敏感字段

Token、密钥、授权信息、Webhook secret 等敏感字段默认隐藏，提供复制、重置、重新授权等明确操作。不得在日志或页面明文展示完整 secret。

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

`docs/design/docs/design/06-content/03-error-empty-loading.md`、`docs/design/docs/design/04-components/03-action-components.md`
