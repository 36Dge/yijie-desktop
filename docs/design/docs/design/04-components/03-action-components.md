# 操作组件规范


## 文档状态

- 状态：Accepted
- 版本：2.1.0
- 最后更新：2026-09-06
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义按钮、按钮组、菜单操作、危险操作和批量操作的 UX 规则。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

2026-09-08 起，按钮、筛选项和说明标签的尺寸统一遵循[组件尺寸规范](./10-component-sizing.md)，颜色角色保持原规范。

## 按钮层级

- Primary：页面主操作，一个区块最多一个。
- Secondary：次操作。
- Tertiary：弱操作。
- Danger：危险操作。
- Ghost：工具栏或图标按钮。

## 颜色与状态

- Primary：可操作 default/hover/pressed/focus/loading 使用品牌填充与 on-brand；disabled 使用禁用前景/底色。hover/pressed 分别使用品牌 hover/active，不能继承白色前景。
- Secondary：亮色为白底、石墨文字和细中性边框；暗色使用主题卡片或浮层色与可读前景。
- Tertiary / Ghost：普通链接与文本操作直接使用 `--yj-color-text-primary`，正文说明使用 `--yj-color-text-body`；新代码不使用 brand-text 兼容槽位。
- Danger 保留独立语义。focus 为 2px 中性无 glow；普通 loading 使用当前中性前景，青柠按钮内部 spinner 为 on-brand。readonly 不用于动作按钮，disabled 与 loading 不混同。

完整颜色、状态优先级及原生 primary+secondary 等反例见 [组件配色与状态矩阵](./09-component-color-state-matrix.md)。

## 高影响操作

涉及平台写操作、广告预算、价格、库存、Listing 发布、买家消息、授权变更的动作必须接入确认或审批能力。具体审批策略后期由业务定义，UI 现在必须预留入口。

## 批量操作

批量操作必须显示影响范围和数量，例如“将修改 24 个商品的价格”。

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

`docs/design/docs/design/06-content/04-risk-and-approval-copy.md`、`docs/design/docs/design/08-governance/06-deferred-policy-decisions.md`
