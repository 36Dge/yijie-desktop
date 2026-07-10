# 跨境电商领域组件规范


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义店铺、平台、商品、Listing、广告、合规、物流等领域组件。

## 适用范围

适用于 `src/components/yijie/` 下对应组件，以及所有引用这些组件的页面。

## 规范正文

## 领域组件

- `YjStoreCard`：店铺信息、平台、授权状态。
- `YjPlatformBadge`：平台标识，使用官方品牌素材。
- `YjListingScore`：Listing 评分与维度。
- `YjComplianceRiskBadge`：合规风险标签。
- `YjAdMetricGroup`：广告指标组。
- `YjLogisticsStatus`：物流节点与异常。
- `YjProductSnapshot`：商品缩略信息。

## 规则

领域组件必须使用业务语义 props，不接受泛型字典直接渲染。平台信息必须明确来源和同步时间。合规与广告建议必须显示“建议”而不是未经确认的“结论”。

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

`docs/design/docs/design/05-patterns/`、`docs/design/docs/design/03-ui-system/02-iconography.md`
