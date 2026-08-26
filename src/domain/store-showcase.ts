export const STORE_SHOWCASE_NOTICE = "演示数据，不代表真实店铺";

export type StoreBriefId = "sales" | "ads" | "inventory";
export type StoreMetricTrend = "up" | "down" | "neutral";

export interface StoreBriefMetric {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly comparison: string;
  readonly trend: StoreMetricTrend;
}

export interface StoreBusinessBrief {
  readonly id: StoreBriefId;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly metrics: readonly StoreBriefMetric[];
}

export const STORE_BUSINESS_BRIEFS = [
  {
    id: "sales",
    label: "近 7 天销售战报",
    title: "近 7 天销售战报",
    description: "汇总最近 7 天的演示销售表现，帮助快速识别增长与退货信号。",
    metrics: [
      {
        id: "sales-amount",
        label: "销售额",
        value: "128,640",
        unit: "元",
        comparison: "较上一演示周期 +12.8%",
        trend: "up",
      },
      {
        id: "order-count",
        label: "订单量",
        value: "1,286",
        unit: "单",
        comparison: "较上一演示周期 +9.4%",
        trend: "up",
      },
      {
        id: "top-asin-contribution",
        label: "Top 1 ASIN 贡献",
        value: "18.6",
        unit: "%",
        comparison: "演示结构占比较平稳",
        trend: "neutral",
      },
      {
        id: "top-return-rate",
        label: "Top 1 退货榜",
        value: "YJ-DEMO-12",
        unit: "ASIN",
        comparison: "演示退货率 4.8%",
        trend: "up",
      },
      {
        id: "fastest-growing-asin",
        label: "销量暴跌的 ASIN",
        value: "3",
        unit: "个",
        comparison: "演示商品 YJ-DEMO-07 跌幅最大",
        trend: "down",
      },
    ],
  },
  {
    id: "ads",
    label: "近 7 天店铺广告",
    title: "近 7 天店铺广告",
    description: "以合成口径展示最近 7 天广告投入、归因销售与效率变化。",
    metrics: [
      {
        id: "ad-attributed-sales",
        label: "广告销售额",
        value: "68,420",
        unit: "元",
        comparison: "较上一演示周期 +8.6%",
        trend: "up",
      },
      {
        id: "ad-spend",
        label: "广告花费",
        value: "12,860",
        unit: "元",
        comparison: "较上一演示周期 -3.2%",
        trend: "down",
      },
      {
        id: "ad-orders",
        label: "广告订单",
        value: "542",
        unit: "单",
        comparison: "较上一演示周期 +6.1%",
        trend: "up",
      },
      {
        id: "acos",
        label: "ACOS",
        value: "18.8",
        unit: "%",
        comparison: "较上一演示周期 -2.3 个百分点",
        trend: "down",
      },
      {
        id: "roas",
        label: "ROAS",
        value: "5.32",
        unit: "倍",
        comparison: "较上一演示周期 +0.48",
        trend: "up",
      },
    ],
  },
  {
    id: "inventory",
    label: "FBA 库存总览",
    title: "FBA 库存总览",
    description: "以合成库存快照展示可售、预留、在途与异常库存结构。",
    metrics: [
      {
        id: "sellable-inventory",
        label: "可售库存",
        value: "4,862",
        unit: "件",
        comparison: "预计覆盖 36 个演示销售日",
        trend: "neutral",
      },
      {
        id: "unsellable-inventory",
        label: "不可售库存",
        value: "76",
        unit: "件",
        comparison: "占演示总库存 1.0%",
        trend: "down",
      },
      {
        id: "reserved-inventory",
        label: "预留库存",
        value: "318",
        unit: "件",
        comparison: "包含演示调拨与待发货数量",
        trend: "neutral",
      },
      {
        id: "inbound-inventory",
        label: "在途库存",
        value: "1,240",
        unit: "件",
        comparison: "预计分 3 个演示批次到仓",
        trend: "up",
      },
      {
        id: "planned-inventory",
        label: "计划数",
        value: "860",
        unit: "件",
        comparison: "未来 14 天演示补货计划",
        trend: "neutral",
      },
    ],
  },
] as const satisfies readonly StoreBusinessBrief[];

export function getStoreBusinessBrief(id: StoreBriefId): StoreBusinessBrief {
  return STORE_BUSINESS_BRIEFS.find((brief) => brief.id === id) ?? STORE_BUSINESS_BRIEFS[0];
}

export const STORE_CURATED_FILTERS = [
  { id: "all", label: "全部" },
  { id: "reduce-acos", label: "降 ACOS" },
  { id: "improve-conversion", label: "提转化" },
  { id: "prevent-bad-reviews", label: "防差评" },
  { id: "prevent-stockout", label: "防断货" },
  { id: "check-sales", label: "查销量" },
  { id: "increase-traffic", label: "提流量" },
  { id: "track-competitors", label: "盯竞品" },
  { id: "health-check", label: "健康诊断" },
] as const;

export const STORE_ROLE_FILTERS = [
  { id: "all", label: "全部" },
  { id: "store-owner", label: "店铺负责人" },
  { id: "sourcing-manager", label: "选品经理" },
  { id: "operations-specialist", label: "运营专员" },
  { id: "ads-optimizer", label: "广告优化师" },
  { id: "supply-chain", label: "供应链" },
] as const;

export type StoreCuratedFilterId = (typeof STORE_CURATED_FILTERS)[number]["id"];
export type StoreRoleFilterId = (typeof STORE_ROLE_FILTERS)[number]["id"];
export type StoreSceneBadge = "精品" | "热门" | "免费版" | "关联";

export interface StoreFilterOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

export interface StoreScene {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly badges: readonly StoreSceneBadge[];
  readonly demoPopularity: number;
  readonly curatedFilters: readonly Exclude<StoreCuratedFilterId, "all">[];
  readonly roleFilters: readonly Exclude<StoreRoleFilterId, "all">[];
}

export const STORE_SCENES = [
  {
    id: "search-term-performance",
    title: "搜索词表现分析",
    description: "拆解演示搜索词的花费、点击和转化效率，识别高价值词与低效词。",
    badges: ["精品", "热门"],
    demoPopularity: 11_025,
    curatedFilters: ["reduce-acos"],
    roleFilters: ["ads-optimizer"],
  },
  {
    id: "store-ad-health-v2",
    title: "店铺广告健康诊断v2",
    description: "综合评估演示广告结构、浪费活动与增长机会，给出分层改进方向。",
    badges: ["精品", "热门"],
    demoPopularity: 341,
    curatedFilters: ["reduce-acos"],
    roleFilters: ["store-owner"],
  },
  {
    id: "keyword-placement-diagnosis",
    title: "关键词投放诊断",
    description: "检查演示关键词的出价、匹配类型与广告位效率，整理优化清单。",
    badges: ["精品", "热门"],
    demoPopularity: 1_672,
    curatedFilters: ["reduce-acos"],
    roleFilters: [],
  },
  {
    id: "keyword-indexing-optimization",
    title: "关键词埋词优化",
    description: "基于合成搜索词表现优化 Listing 埋词，提升自然关键词覆盖度。",
    badges: ["免费版", "热门"],
    demoPopularity: 2_096,
    curatedFilters: ["reduce-acos"],
    roleFilters: ["ads-optimizer"],
  },
  {
    id: "high-click-no-conversion-seven-days",
    title: "近7天广告点击多但无转化的",
    description: "定位演示周期内高点击零转化的投放项，并给出预算调整建议。",
    badges: [],
    demoPopularity: 2_355,
    curatedFilters: ["reduce-acos"],
    roleFilters: [],
  },
  {
    id: "listing-funnel-conversion",
    title: "Listing全漏斗转化分析",
    description: "分析曝光、点击、购买与售后演示漏斗，定位主要转化断点。",
    badges: ["精品", "热门"],
    demoPopularity: 815,
    curatedFilters: ["improve-conversion"],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "listing-image-diagnosis",
    title: "Listing主图图片优化诊断",
    description: "从演示竞品对比中识别主副图信息差距，输出可执行的改善方向。",
    badges: ["精品", "热门"],
    demoPopularity: 3_886,
    curatedFilters: ["improve-conversion"],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "store-ad-organic-conversion",
    title: "全店广告和自然订单转化情况",
    description: "以合成订单拆分广告与自然转化占比，呈现店铺转化结构。",
    badges: ["热门"],
    demoPopularity: 1_575,
    curatedFilters: ["improve-conversion"],
    roleFilters: [],
  },
  {
    id: "click-no-order-asin",
    title: "点击多不出单的ASIN",
    description: "筛出演示高点击但未出单的 ASIN，帮助快速定位转化漏洞。",
    badges: [],
    demoPopularity: 3_390,
    curatedFilters: ["improve-conversion"],
    roleFilters: ["store-owner"],
  },
  {
    id: "low-conversion-sku",
    title: "广告点击多但转化低的SKU有哪些",
    description: "汇总演示高点击低转化 SKU，估算浪费并提出诊断方向。",
    badges: [],
    demoPopularity: 1_002,
    curatedFilters: ["improve-conversion"],
    roleFilters: [],
  },
  {
    id: "high-conversion-keywords",
    title: "近14天转化率好的关键词有哪些",
    description: "筛出演示周期内转化稳定的关键词，为后续扩量提供参考。",
    badges: [],
    demoPopularity: 2_514,
    curatedFilters: ["improve-conversion"],
    roleFilters: [],
  },
  {
    id: "bad-review-attribution-30d",
    title: "30天差评归因",
    description: "归纳近 30 天演示差评主题，整理原因与优先处理建议。",
    badges: ["热门"],
    demoPopularity: 3_148,
    curatedFilters: ["prevent-bad-reviews"],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "asin-critical-review-one-year",
    title: "近1年ASIN中差评分析",
    description: "聚合一年期演示中差评问题，识别长期共性与改善方向。",
    badges: ["热门"],
    demoPopularity: 2_332,
    curatedFilters: ["prevent-bad-reviews"],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "store-feedback-diagnosis",
    title: "店铺Feedback诊断",
    description: "按演示站点归纳评价主题，识别服务体验风险并提出行动建议。",
    badges: [],
    demoPopularity: 2_603,
    curatedFilters: ["prevent-bad-reviews"],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "bad-review-analysis-seven-days",
    title: "7天中差评分析",
    description: "快速汇总近 7 天演示评价变化，定位短期质量与体验风险。",
    badges: [],
    demoPopularity: 1_306,
    curatedFilters: ["prevent-bad-reviews"],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "fba-stock-check",
    title: "FBA库存盘点",
    description: "按演示库存盘点周转与异常结构，识别潜在缺货信号。",
    badges: ["热门"],
    demoPopularity: 2_222,
    curatedFilters: ["prevent-stockout"],
    roleFilters: ["supply-chain"],
  },
  {
    id: "fba-inbound",
    title: "看FBA在途",
    description: "汇总演示在途批次与预计到仓节奏，辅助安排补货。",
    badges: [],
    demoPopularity: 1_514,
    curatedFilters: ["prevent-stockout"],
    roleFilters: ["supply-chain"],
  },
  {
    id: "fba-unsellable",
    title: "看FBA不可售",
    description: "归纳演示不可售库存原因与处理优先级，减少库存损失。",
    badges: [],
    demoPopularity: 2_104,
    curatedFilters: ["prevent-stockout"],
    roleFilters: ["supply-chain"],
  },
  {
    id: "fba-frozen-reserved",
    title: "看FBA冻结占用",
    description: "分析演示冻结占用结构，识别长期冻结并给出处理建议。",
    badges: [],
    demoPopularity: 1_682,
    curatedFilters: ["prevent-stockout"],
    roleFilters: ["supply-chain"],
  },
  {
    id: "weekly-sales-analysis",
    title: "本周销售情况分析",
    description: "汇总本周演示订单、销售与广告结构，快速掌握经营动态。",
    badges: ["热门"],
    demoPopularity: 2_518,
    curatedFilters: ["check-sales"],
    roleFilters: ["store-owner"],
  },
  {
    id: "declining-products",
    title: "销量暴跌的商品",
    description: "识别本周演示销量跌幅最大的 ASIN，提示优先排查流量、库存与转化。",
    badges: ["热门"],
    demoPopularity: 4_726,
    curatedFilters: ["check-sales"],
    roleFilters: ["store-owner"],
  },
  {
    id: "weekly-top-ten-child-asin",
    title: "本周销售TOP10子ASIN",
    description: "按本周演示销量列出前十子 ASIN，便于快速识别核心商品。",
    badges: [],
    demoPopularity: 2_424,
    curatedFilters: ["check-sales"],
    roleFilters: [],
  },
  {
    id: "monthly-top-ten-child-asin",
    title: "本月销售TOP10子ASIN",
    description: "按本月演示销量展示前十子 ASIN 与变化概览。",
    badges: [],
    demoPopularity: 3_149,
    curatedFilters: ["check-sales"],
    roleFilters: [],
  },
  {
    id: "top-ten-child-ranking-three-days",
    title: "近3天TOP10销售子ASIN排名",
    description: "展示近 3 天演示销量排名与趋势，识别短期增长和下滑商品。",
    badges: [],
    demoPopularity: 2_910,
    curatedFilters: ["check-sales"],
    roleFilters: ["store-owner"],
  },
  {
    id: "operations-profit-report-30d",
    title: "运营负责人利润报表（近30天）",
    description: "按演示负责人、店铺与站点汇总销售和利润，用于经营复盘。",
    badges: [],
    demoPopularity: 1_946,
    curatedFilters: ["check-sales"],
    roleFilters: [],
  },
  {
    id: "listing-traffic-attribution",
    title: "Listing流量归因分析",
    description: "拆解演示自然与广告流量占比，识别下滑渠道并提出优化建议。",
    badges: ["精品", "热门"],
    demoPopularity: 2_874,
    curatedFilters: ["increase-traffic"],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "alexa-shopping-diagnosis",
    title: "Alexa购物助手推荐诊断（竞品支持多asin）v3",
    description: "从演示可读性与内容覆盖维度诊断推荐机会，输出文案方向。",
    badges: ["热门"],
    demoPopularity: 1_284,
    curatedFilters: ["increase-traffic"],
    roleFilters: [],
  },
  {
    id: "competitor-attribution-2",
    title: "竞品归因2.0",
    description: "从演示销量与流量变化定位竞品影响，辅助判断市场动作。",
    badges: ["免费版", "热门"],
    demoPopularity: 21_419,
    curatedFilters: ["track-competitors"],
    roleFilters: ["sourcing-manager"],
  },
  {
    id: "aba-search-term-analysis",
    title: "ABA搜索词分析",
    description: "分析演示搜索词趋势与竞争流量机会，形成选品和投放参考。",
    badges: ["免费版"],
    demoPopularity: 2_188,
    curatedFilters: ["track-competitors"],
    roleFilters: [],
  },
  {
    id: "store-sales-health-diagnosis",
    title: "店铺销售健康诊断",
    description: "综合演示销售表现与异常信号，标记经营风险和优化优先级。",
    badges: ["精品", "热门"],
    demoPopularity: 1_260,
    curatedFilters: ["health-check"],
    roleFilters: [],
  },
  {
    id: "customer-experience-health-v2",
    title: "店铺客户体验健康诊断-v2",
    description: "从演示评价与服务反馈诊断客户体验，整理改善方向。",
    badges: ["精品"],
    demoPopularity: 1_056,
    curatedFilters: ["health-check"],
    roleFilters: ["store-owner"],
  },
  {
    id: "daily-listing-anomaly",
    title: "每日异常Listing监控",
    description: "汇总演示 Listing 的评分、销量、排名与转化异常信号。",
    badges: [],
    demoPopularity: 1_057,
    curatedFilters: ["health-check"],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "child-listing-performance",
    title: "子体Listing表现",
    description: "按子体拆解演示 Listing 转化、点击与广告表现，定位优化重点。",
    badges: ["关联"],
    demoPopularity: 3_435,
    curatedFilters: [],
    roleFilters: ["store-owner"],
  },
  {
    id: "weekly-sales-report-with-ads",
    title: "本周销售战报（含广告）",
    description: "融合演示销售与广告数据，提供本周经营概览。",
    badges: ["热门"],
    demoPopularity: 1_135,
    curatedFilters: [],
    roleFilters: ["store-owner"],
  },
  {
    id: "fortnight-traffic-overview",
    title: "双周流量总览",
    description: "对比两周演示流量变化趋势，快速发现渠道异常。",
    badges: [],
    demoPopularity: 1_727,
    curatedFilters: [],
    roleFilters: ["store-owner"],
  },
  {
    id: "store-today-sales",
    title: "店铺今日销售",
    description: "查看今日演示销售额、订单与退款等核心经营指标。",
    badges: ["精品", "关联"],
    demoPopularity: 5_047,
    curatedFilters: [],
    roleFilters: ["store-owner"],
  },
  {
    id: "parent-asin-return-attribution",
    title: "父ASIN变体退货归因分析",
    description: "按演示变体维度归纳退货原因，识别主要问题和改善方向。",
    badges: ["精品", "关联"],
    demoPopularity: 1_242,
    curatedFilters: [],
    roleFilters: ["sourcing-manager"],
  },
  {
    id: "child-asin-return-depth",
    title: "子ASIN退货深度分析",
    description: "分析演示子 ASIN 退货明细，定位具体问题与改善方向。",
    badges: ["精品", "关联"],
    demoPopularity: 1_299,
    curatedFilters: [],
    roleFilters: ["sourcing-manager"],
  },
  {
    id: "parent-asin-variant-two-dimensions",
    title: "父ASIN变体二维诊断",
    description: "从销量与退货两个演示维度观察变体表现与改善机会。",
    badges: ["关联"],
    demoPopularity: 694,
    curatedFilters: [],
    roleFilters: ["sourcing-manager"],
  },
  {
    id: "amazon-listing-copy-competitor-2026",
    title: "Amazon Listing文案对比竞品优化（2026新规版）",
    description: "基于合成商品事实对比竞品表达，生成合规的文案改善建议。",
    badges: ["热门"],
    demoPopularity: 336,
    curatedFilters: [],
    roleFilters: ["sourcing-manager"],
  },
  {
    id: "asin-variant-expansion",
    title: "ASIN变体扩展空间分析",
    description: "分析演示颜色、尺寸和款式覆盖，发现可补充的变体机会。",
    badges: [],
    demoPopularity: 698,
    curatedFilters: [],
    roleFilters: ["sourcing-manager"],
  },
  {
    id: "amazon-qa-generator",
    title: "Amazon问答生成器",
    description: "基于合成商品卖点生成问答内容，补充 Listing 信息覆盖。",
    badges: [],
    demoPopularity: 1_324,
    curatedFilters: [],
    roleFilters: ["sourcing-manager"],
  },
  {
    id: "asin-multidimensional-analysis",
    title: "ASIN多维度分析与优化",
    description: "从流量、转化、评价与库存等演示维度输出优化建议。",
    badges: [],
    demoPopularity: 2_045,
    curatedFilters: [],
    roleFilters: ["sourcing-manager"],
  },
  {
    id: "listing-quality-analysis",
    title: "Listing质量分析",
    description: "从标题、图片、五点与描述评估演示 Listing 质量并输出建议。",
    badges: ["精品", "关联"],
    demoPopularity: 5_484,
    curatedFilters: [],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "listing-title-alexa",
    title: "Listing标题Alexa化优化（优化至75个字符）",
    description: "将演示标题调整为清晰可读的短格式，提升语音搜索可发现性。",
    badges: ["精品", "关联"],
    demoPopularity: 351,
    curatedFilters: [],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "listing-image-ai",
    title: "Listing图片AI生图",
    description: "使用合成商品素材展示主图与场景图创意方向。",
    badges: ["免费版", "热门"],
    demoPopularity: 3_203,
    curatedFilters: [],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "aba-asin-keyword-reverse",
    title: "ABA-ASIN关键词反查",
    description: "以演示 ASIN 反查关键词价值线索，挖掘流量入口。",
    badges: [],
    demoPopularity: 1_675,
    curatedFilters: [],
    roleFilters: ["operations-specialist"],
  },
  {
    id: "ad-placement-leverage",
    title: "广告位高杠杆场景分析",
    description: "比较演示广告位投入产出，识别高杠杆优化机会。",
    badges: ["精品"],
    demoPopularity: 336,
    curatedFilters: [],
    roleFilters: ["ads-optimizer"],
  },
  {
    id: "store-ad-health",
    title: "店铺广告健康诊断",
    description: "诊断演示广告健康度与结构风险，形成优化优先级。",
    badges: ["精品", "热门"],
    demoPopularity: 2_160,
    curatedFilters: [],
    roleFilters: ["ads-optimizer"],
  },
  {
    id: "ad-matrix-generator",
    title: "广告矩阵生成",
    description: "依据合成商品属性与关键词数据，整理广告投放矩阵方案。",
    badges: ["精品"],
    demoPopularity: 341,
    curatedFilters: [],
    roleFilters: ["ads-optimizer"],
  },
  {
    id: "ad-structure-diagnosis-v2",
    title: "广告结构诊断v2",
    description: "诊断演示广告活动与关键词结构合理性，输出结构优化建议。",
    badges: ["精品"],
    demoPopularity: 578,
    curatedFilters: [],
    roleFilters: ["ads-optimizer"],
  },
  {
    id: "low-output-budget-exhausted",
    title: "今昨两天预算花光的低产出广告活动",
    description: "识别演示预算提前耗尽且产出偏低的活动，提示调整方向。",
    badges: [],
    demoPopularity: 2_763,
    curatedFilters: [],
    roleFilters: ["ads-optimizer"],
  },
  {
    id: "fba-claim-advice",
    title: "FBA丢损索赔建议",
    description: "识别演示丢损记录并生成核对清单，降低库存资金损失。",
    badges: ["精品", "关联"],
    demoPopularity: 1_414,
    curatedFilters: [],
    roleFilters: ["supply-chain"],
  },
  {
    id: "fba-promotion-clearance",
    title: "看FBA促销清仓",
    description: "查看演示库存状态，识别可参与促销清仓的滞销商品。",
    badges: [],
    demoPopularity: 1_639,
    curatedFilters: [],
    roleFilters: ["supply-chain"],
  },
] as const satisfies readonly StoreScene[];

const DEFAULT_CURATED_SCENE_IDS = [
  "search-term-performance",
  "store-ad-health-v2",
  "keyword-placement-diagnosis",
  "keyword-indexing-optimization",
  "high-click-no-conversion-seven-days",
  "listing-funnel-conversion",
] as const;

const DEFAULT_ROLE_SCENE_IDS = [
  "store-ad-health-v2",
  "customer-experience-health-v2",
  "child-listing-performance",
  "top-ten-child-ranking-three-days",
  "weekly-sales-report-with-ads",
  "click-no-order-asin",
  "weekly-sales-analysis",
  "declining-products",
  "fortnight-traffic-overview",
  "store-today-sales",
  "parent-asin-return-attribution",
  "child-asin-return-depth",
] as const;

function scenesById(ids: readonly string[]): readonly StoreScene[] {
  const catalog = new Map<string, StoreScene>(STORE_SCENES.map((scene) => [scene.id, scene]));
  return ids.flatMap((id) => {
    const scene = catalog.get(id);
    return scene ? [scene] : [];
  });
}

export function getCuratedScenes(filterId: StoreCuratedFilterId): readonly StoreScene[] {
  if (filterId === "all") {
    return scenesById(DEFAULT_CURATED_SCENE_IDS);
  }
  return STORE_SCENES.filter((scene) =>
    (scene.curatedFilters as readonly Exclude<StoreCuratedFilterId, "all">[]).includes(filterId),
  );
}

export function getRoleScenes(filterId: StoreRoleFilterId): readonly StoreScene[] {
  if (filterId === "all") {
    return scenesById(DEFAULT_ROLE_SCENE_IDS);
  }
  return STORE_SCENES.filter((scene) =>
    (scene.roleFilters as readonly Exclude<StoreRoleFilterId, "all">[]).includes(filterId),
  );
}

export function formatDemoPopularity(scene: StoreScene): string {
  return `演示热度 · ${scene.demoPopularity.toLocaleString("zh-CN")}`;
}
