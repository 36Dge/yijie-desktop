# 操作组件规范


## 文档状态

- 状态：Accepted
- 版本：2.0.0
- 最后更新：2026-09-05
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义按钮、按钮组、菜单操作、危险操作和批量操作的 UX 规则。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

## 按钮层级

- Primary：页面主操作，一个区块最多一个。
- Secondary：次操作。
- Tertiary：弱操作。
- Danger：危险操作。
- Ghost：工具栏或图标按钮。

## 颜色与状态

- Primary：使用 `--yj-color-brand-primary` 背景，文字、图标始终使用 `--yj-color-on-brand`；hover/pressed 分别使用品牌 hover/active，不能继承白色前景。
- Secondary：亮色为白底、石墨文字和细中性边框；暗色使用主题卡片或浮层色与可读前景。
- Tertiary / Ghost：使用中性文字；文本型品牌操作使用 `--yj-color-brand-text`，不直接使用浅青柠小字。
- Danger、loading、disabled 与焦点继续使用独立语义 token，不用青柠替代风险或禁用状态。

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
