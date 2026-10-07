/** Local visual prototype only. No transport models or persistent state. */
export type StoreDashboardTab = "overview" | "ai";
export type StoreDashboardState =
  "ready" | "loading" | "empty" | "error" | "denied";
export type StoreDashboardMetric = "sales" | "profit" | "orders";
export const dashboardShops = [
  { id: "all", label: "全部店铺", detail: "3 家演示店铺", factor: 1 },
  {
    id: "home",
    label: "YIJIE HOME · 美国站",
    detail: "Amazon · 美国站",
    factor: 0.58,
  },
  {
    id: "life",
    label: "YIJIE LIFE · 英国站",
    detail: "Amazon · 英国站",
    factor: 0.27,
  },
  {
    id: "studio",
    label: "YIJIE STUDIO · 德国站",
    detail: "Amazon · 德国站",
    factor: 0.15,
  },
] as const;
export const dashboardTabs = [
  { key: "overview", label: "经营总览" },
  { key: "ai", label: "AI 运营" },
] as const;
export const opportunityData = [
  {
    id: "ads",
    category: "广告提效",
    title: "把预算留给高转化关键词",
    description:
      "12 个低效词消耗了 18% 广告预算，易界已完成归因并整理调整建议。",
    impact: "预计节省 $1,280 / 月",
    priority: "优先处理",
    icon: "skillPpcCampaign",
    evidence: [
      "12 个关键词的 ACOS 高于 40%，高于目标值 24%。",
      "「ceramic mug set」转化率 8.6%，预算利用率仅 62%。",
      "建议缩减低效词预算，将 15% 预算分配至高转化词组。",
    ],
    steps: [
      "分析关键词与广告表现",
      "生成预算与否词建议",
      "整理调整清单和效果追踪方案",
    ],
    result: "已生成预算调整方案与重点关键词建议。",
  },
  {
    id: "listing",
    category: "Listing 优化",
    title: "让热销商品获得更多自然流量",
    description: "3 个潜力商品缺少核心搜索词，标题与五点描述的优化草稿已就绪。",
    impact: "预计转化提升 8–12%",
    priority: "增长机会",
    icon: "skillListingReview",
    evidence: [
      "3 个商品共覆盖 26 个高相关搜索词，其中 9 个尚未出现在标题中。",
      "点击率 2.7%，低于同类演示基准 3.4%。",
      "建议先优化陶瓷马克杯套装，并对新旧标题进行对照观察。",
    ],
    steps: [
      "梳理搜索词与商品卖点",
      "生成标题与五点描述草稿",
      "生成优化前后对照报告",
    ],
    result: "已生成重点商品的标题、卖点与搜索词优化示例。",
  },
  {
    id: "reviews",
    category: "口碑洞察",
    title: "把用户反馈变成产品改进",
    description: "从近期 186 条评价中发现「包装防护」是最集中的体验改善点。",
    impact: "覆盖 5 款重点商品",
    priority: "持续关注",
    icon: "skillReviewAnalysis",
    evidence: [
      "186 条演示评价中，23 条提到运输包装。",
      "相关反馈集中在陶瓷系列，占该系列低星评价的 61%。",
      "建议增加内托防护，并在详情页补充包装与售后说明。",
    ],
    steps: [
      "聚类评价与情绪信号",
      "定位产品与体验改善点",
      "生成产品改进及内容建议",
    ],
    result: "已生成评价洞察与产品体验改善清单。",
  },
] as const;
export interface StoreOpportunity {
  id: string;
  category: string;
  title: string;
  description: string;
  impact: string;
  priority: string;
  icon: (typeof opportunityData)[number]["icon"];
  evidence: readonly string[];
  steps: readonly string[];
  result: string;
  resultSections?: readonly { label: string; content: string }[];
}
export interface DashboardProduct {
  id: string;
  name: string;
  category: string;
  monogram: string;
  sales: number;
  orders: number;
  conversion: number;
  growth: number;
  score: number;
  opportunity: string;
}
const products: DashboardProduct[] = [
  {
    id: "YJ-HM-001",
    name: "陶瓷马克杯套装",
    category: "家居生活",
    monogram: "MU",
    sales: 104740,
    orders: 1842,
    conversion: 4.82,
    growth: 24.6,
    score: 92,
    opportunity: "补充核心搜索词",
  },
  {
    id: "YJ-HM-002",
    name: "极简桌面收纳盒",
    category: "收纳整理",
    monogram: "OR",
    sales: 62380,
    orders: 1524,
    conversion: 4.16,
    growth: 18.2,
    score: 88,
    opportunity: "拓展高转化词",
  },
  {
    id: "YJ-HM-003",
    name: "棉麻抱枕组合",
    category: "家居生活",
    monogram: "CO",
    sales: 48720,
    orders: 1132,
    conversion: 3.76,
    growth: 12.4,
    score: 85,
    opportunity: "优化场景主图",
  },
  {
    id: "YJ-HM-004",
    name: "便携手冲咖啡壶",
    category: "厨房用品",
    monogram: "CF",
    sales: 41260,
    orders: 824,
    conversion: 3.42,
    growth: -3.2,
    score: 76,
    opportunity: "调整广告预算",
  },
  {
    id: "YJ-HM-005",
    name: "天然香薰蜡烛",
    category: "家居生活",
    monogram: "CA",
    sales: 36580,
    orders: 986,
    conversion: 3.84,
    growth: 16.8,
    score: 90,
    opportunity: "扩展关联推荐",
  },
  {
    id: "YJ-HM-006",
    name: "轻量随行保温杯",
    category: "户外出行",
    monogram: "TB",
    sales: 32480,
    orders: 812,
    conversion: 3.21,
    growth: 9.7,
    score: 83,
    opportunity: "优化五点描述",
  },
  {
    id: "YJ-HM-007",
    name: "竹木厨房置物架",
    category: "厨房用品",
    monogram: "KT",
    sales: 29940,
    orders: 640,
    conversion: 3.18,
    growth: 6.3,
    score: 81,
    opportunity: "完善尺寸信息",
  },
  {
    id: "YJ-HM-008",
    name: "柔软亲肤浴巾",
    category: "个人护理",
    monogram: "BT",
    sales: 28420,
    orders: 744,
    conversion: 3.62,
    growth: 11.5,
    score: 87,
    opportunity: "提炼评论卖点",
  },
];
export function dashboardFactor(shop: string, period: number): number {
  return (
    ((dashboardShops.find((item) => item.id === shop)?.factor ?? 1) * period) /
    30
  );
}
export function dashboardProducts(factor: number): DashboardProduct[] {
  return products.map((item) => ({
    ...item,
    sales: Math.round(item.sales * factor),
    orders: Math.round(item.orders * factor),
  }));
}
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
export function dashboardStats(factor: number) {
  const rows = dashboardProducts(factor);
  const sales = rows.reduce((total, row) => total + row.sales, 0);
  const orders = rows.reduce((total, row) => total + row.orders, 0);
  return {
    sales,
    profit: Math.round(sales * 0.283),
    orders,
    visitors: Math.round(221458 * factor),
    adSpend: Math.round(sales * 0.083),
    aiRevenue: Math.round(42860 * factor),
    saved: Math.round(6280 * factor),
    hours: Math.round(126 * factor),
    completed: Math.max(1, Math.round(48 * factor)),
    goal: Math.round(420000 * factor),
  };
}
export function dashboardCsv(rows: DashboardProduct[]): string {
  return (
    "\uFEFF" +
    [
      "商品,SKU,销售额(USD),订单量,转化率(%),环比(%),AI评分",
      ...rows.map((item) =>
        [
          item.name,
          item.id,
          item.sales,
          item.orders,
          item.conversion,
          item.growth,
          item.score,
        ].join(","),
      ),
    ].join("\r\n")
  );
}

export const opportunityResults: Record<
  string,
  { title: string; sections: { label: string; content: string }[] }
> = {
  ads: {
    title: "广告优化建议清单",
    sections: [
      {
        label: "01 · 控制低效消耗",
        content:
          "对「cheap mugs」与「coffee gift」词组降低竞价 15%，保留 7 天观察期；连续无转化词列入否词候选。",
      },
      {
        label: "02 · 扩大高意向触达",
        content:
          "「ceramic mug set」每日预算由 $40 调整为 $46，优先维持精准匹配，保留原投放组用于对照。",
      },
      {
        label: "03 · 追踪与回退",
        content:
          "观察 ACOS、转化率及销售额。7 天后复盘；若 ACOS 超过 28% 或订单下降 10%，恢复原预算并重新分析。",
      },
    ],
  },
  listing: {
    title: "陶瓷马克杯套装 · 内容草稿",
    sections: [
      {
        label: "标题建议",
        content:
          "Ceramic Coffee Mug Set of 4, 12 oz Stoneware Cups with Comfortable Handles, Minimalist Mugs for Home & Office",
      },
      {
        label: "核心卖点",
        content:
          "突出 4 件套与 12 oz 容量；展示握柄细节、杯口与釉面；补充尺寸对照图，帮助用户判断使用场景。",
      },
      {
        label: "搜索词与验证",
        content:
          "建议补充 ceramic coffee cups、stoneware mug set、minimalist mugs；容量与材质为本地演示设定，上线前需核对实物。",
      },
    ],
  },
  reviews: {
    title: "客户声音 · 改善清单",
    sections: [
      {
        label: "高频问题：包装防护",
        content:
          "23 / 186 条演示评价提到包装。建议使用独立内托与杯柄缓冲结构，优先覆盖陶瓷系列。",
      },
      {
        label: "页面表达：建立合理预期",
        content:
          "增加包装细节与开箱示意图，说明套装件数、尺寸及清洁方式，减少理解偏差。",
      },
      {
        label: "复盘指标",
        content:
          "改进后连续 14 天跟踪包装相关低星评价占比与退款原因，并与改进前 14 天进行对照。",
      },
    ],
  },
};

const productContent: Record<string, string> = {
  "YJ-HM-001":
    "标题优先表达陶瓷材质、套装数量和容量；补充 ceramic coffee cups 与 stoneware mug set 等相关词，避免重复堆叠。",
  "YJ-HM-002":
    "将桌面收纳、分区整理和适用空间作为关键词分组，使用 desk organizer 与 desktop storage box 进行内容关联。",
  "YJ-HM-003":
    "主图保留清晰商品主体，辅图展示沙发、阅读角等搭配场景，补充面料纹理与尺寸示意。",
  "YJ-HM-004":
    "将 coffee pour over 高意向词单独观察，降低泛词竞价 15%；7 天后比较转化率与 ACOS，再决定预算分配。",
  "YJ-HM-005":
    "围绕居家放松与礼物场景补充关联推荐，清晰标注香型和燃烧时长，避免未经验证的功效描述。",
  "YJ-HM-006":
    "五点描述按容量、保温表现、携带方式、清洁和适用场景排序；补充实测数据后再发布相关性能描述。",
  "YJ-HM-007":
    "增加整体长宽高、分层高度与可放置物品的对照图，明确安装方式与承重测试条件。",
  "YJ-HM-008":
    "从评价中提炼柔软度、吸水性与洗后体验，补充材质与洗护说明，并持续观察相应反馈。",
};
export function getProductOpportunity(
  product: DashboardProduct,
): StoreOpportunity {
  const base =
    opportunityData[
      product.id === "YJ-HM-004" ? 0 : product.id === "YJ-HM-008" ? 2 : 1
    ];
  return {
    ...base,
    id: `product-${product.id}`,
    title: `${product.name}：${product.opportunity}`,
    description: `围绕${product.category}商品的经营表现，生成可复核的优化方案。`,
    impact: `AI 内容评分 ${product.score} / 100`,
    evidence: [
      `当前周期销售额 $${money(product.sales)}，共 ${money(product.orders)} 单，转化率 ${product.conversion}%。`,
      `销售额环比 ${product.growth > 0 ? "+" : ""}${product.growth}%，AI 内容评分 ${product.score} 分。`,
      productContent[product.id] ?? product.opportunity,
    ],
    steps: ["梳理商品表现与内容", "生成针对性优化建议", "整理方案与复盘指标"],
    result: `已为「${product.name}」生成优化方案。`,
  };
}
export function getOpportunityResult(item: StoreOpportunity) {
  if (item.resultSections)
    return {
      title: `${item.category} · 分析结果`,
      sections: item.resultSections,
    };
  if (!item.id.startsWith("product-")) return opportunityResults[item.id];
  const product = products.find((row) => `product-${row.id}` === item.id);
  if (!product) return undefined;
  return {
    title: `${product.name} · 优化方案`,
    sections: [
      {
        label: "01 · 优化重点",
        content: productContent[product.id] ?? product.opportunity,
      },
      {
        label: "02 · 执行前复核",
        content:
          "核对商品规格、素材与文案，保留原内容作为对照。所有参数均来自模拟样本，真实应用前需重新确认。",
      },
      {
        label: "03 · 效果追踪",
        content: `观察调整后 7 天的点击、转化与评价变化，以当前 ${product.conversion}% 转化率为演示基线，记录改动与结果。`,
      },
    ],
  };
}
