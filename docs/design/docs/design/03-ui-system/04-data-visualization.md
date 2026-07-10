# 数据可视化规范


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界使用 ECharts 进行经营数据、广告数据、物流数据和风险数据展示的规则。

## 适用范围

适用于趋势图、柱状图、环图、漏斗、表格图表组合、指标卡和风险分布。

## 规范正文

## 图表库

易界图表库使用 **ECharts**。

## 图表设计原则

- 先结论，后图表。
- 图表标题必须说明指标含义。
- Tooltip 必须展示单位、时间范围、同比/环比含义。
- 图表不得只靠颜色表达风险。
- 图表与指标卡应组合使用。

## 类目色板

| 序号 | 颜色 | 用途 |
|---|---|---|
| 1 | `#95BF47` | 主业务线 / 品牌 |
| 2 | `#4C84FF` | 对比系列 |
| 3 | `#22B8CF` | 流量 / 访问 |
| 4 | `#8B5CF6` | AI / 智能分析 |
| 5 | `#F59E0B` | 警示类目 |
| 6 | `#F97316` | 成本 / 消耗 |
| 7 | `#EF4444` | 风险 / 下降 |
| 8 | `#64748B` | 其他 / 中性 |

## 趋势色

- 主趋势：品牌绿。
- 对比趋势：蓝色。
- 预测/AI 建议：紫色虚线。
- 风险阈值：橙色或红色虚线。

## 风险色

风险色必须和文案、图标、标签一起使用：

- 正常：绿色。
- 关注：橙色。
- 异常：红色。
- 未知：灰色。

## 图表高度

- 小图：180px。
- 标准图：280px。
- 大图：360px。
- Dashboard 主图：320px。

## AI / Codex 必须遵守

- 不允许随机生成图表色板。
- 不允许让 ECharts 默认主题直接暴露。
- 不允许图表没有空态、错误态和加载态。
- 不允许只展示图表不展示关键结论。
- 不允许图表单位缺失。

## 实现要求

创建 `src/design/theme/echarts-theme.ts`。所有图表通过 `YjChartCard` 或领域图表组件承载，统一 loading、empty、error、title、description、tooltip 和 data zoom。

## 验收清单

- [ ] 图表使用 ECharts 主题。
- [ ] 有标题、单位、时间范围。
- [ ] 有 tooltip。
- [ ] 有空态/加载/错误。
- [ ] 颜色来自图表 token。

## 关联文件

`docs/design/docs/design/09-implementation/06-echarts-code-scaffold.md`、`src/design/theme/echarts-theme.ts`
