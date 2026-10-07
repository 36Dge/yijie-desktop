import type { StoreOpportunity } from "./store-dashboard";

export const storeAiGoals = [
  { id: "all", label: "全部场景" },
  { id: "acos", label: "降 ACOS" },
  { id: "conversion", label: "提转化" },
  { id: "reviews", label: "防差评" },
  { id: "traffic", label: "提流量" },
  { id: "competitors", label: "盯竞品" },
  { id: "health", label: "健康诊断" },
] as const;

export type StoreAiGoal = (typeof storeAiGoals)[number]["id"];
export interface StoreAiScene {
  id: Exclude<StoreAiGoal, "all">;
  title: string;
  description: string;
  primary: { label: string; value: number; unit: string; scale?: boolean };
  secondary: { label: string; value: string };
  chart: {
    metric: "revenue" | "conversion" | "efficiency";
    label: string;
    variant: number;
    values: readonly number[];
    unit: string;
    scale?: boolean;
  };
  opportunity: StoreOpportunity & {
    resultSections: { label: string; content: string }[];
  };
}

export const storeAiScenes: readonly StoreAiScene[] = [
  {
    id: "acos",
    title: "搜索词表现分析",
    description: "定位高消耗低转化词，找到预算调整的具体方向。",
    primary: { label: "低效关键词", value: 12, unit: "个" },
    secondary: { label: "可优化消耗占比", value: "18.0%" },
    chart: {
      metric: "efficiency",
      label: "广告 ACOS 走势",
      variant: 1,
      values: [32.1, 31.2, 29.8, 30.1, 27.2, 26.6, 25.4, 23.6],
      unit: "%",
    },
    opportunity: {
      id: "scene-acos",
      category: "搜索词表现分析",
      title: "从 12 个低效词开始改善广告效率",
      description:
        "按花费、订单与 ACOS 对搜索词分组，提供可以逐项复核的预算建议。",
      impact: "预计可减少 18% 低效消耗",
      priority: "优先处理",
      icon: "skillPpcCampaign",
      evidence: [
        "12 个词组连续产生点击但转化偏低，占演示广告预算的 18%。",
        "精准词 ceramic mug set 转化率为 8.6%，预算利用率为 62%。",
        "高意向词与泛词混合投放，预算分配存在优化空间。",
      ],
      steps: [
        "按搜索词拆分花费与订单",
        "识别低效消耗和增长词组",
        "生成预算建议与复盘清单",
      ],
      result: "已生成搜索词分组、预算调整和效果追踪清单。",
      resultSections: [
        {
          label: "低效词处理",
          content:
            "将 cheap mugs 与 coffee gift 加入观察组，竞价降低 15%；保留有转化词，连续无转化词进入否词候选清单。",
        },
        {
          label: "增长词配置",
          content:
            "为 ceramic mug set 单独建立精准匹配观察组，将每日预算从 $40 调整为 $46 的建议提交复核。",
        },
        {
          label: "7 天复盘",
          content:
            "同步观察 ACOS、广告订单和自然订单。若订单下降超过 10%，恢复原预算并重新检查词组相关性。",
        },
      ],
    },
  },
  {
    id: "conversion",
    title: "Listing 全漏斗转化分析",
    description: "联动曝光、点击和支付，识别详情页流失位置。",
    primary: { label: "访问转化率", value: 3.84, unit: "%" },
    secondary: { label: "潜力商品", value: "3 款" },
    chart: {
      metric: "conversion",
      label: "示例转化率走势",
      variant: 0,
      values: [2.9, 3.1, 3.02, 3.26, 3.4, 3.32, 3.61, 3.84],
      unit: "%",
    },
    opportunity: {
      id: "scene-conversion",
      category: "Listing 转化诊断",
      title: "先补齐影响购买判断的内容",
      description:
        "陶瓷马克杯、桌面收纳盒和棉麻抱枕的点击表现较好，但购买信息仍有缺口。",
      impact: "预计转化改善 8–12%",
      priority: "增长机会",
      icon: "skillListingReview",
      evidence: [
        "访问至支付转化率为 3.84%，同组优化目标为 4.20%。",
        "3 款商品缺少完整尺寸对照、使用场景或材质说明。",
        "9 个高相关搜索词尚未覆盖到标题与核心卖点。",
      ],
      steps: [
        "分解曝光至支付的漏斗",
        "识别商品内容缺口",
        "生成内容调整和对照观察方案",
      ],
      result: "已生成商品内容改进顺序与转化追踪方案。",
      resultSections: [
        {
          label: "内容补充顺序",
          content:
            "马克杯补充容量与套装数量；收纳盒增加内部尺寸和分区图；抱枕补充面料、尺寸与搭配场景。",
        },
        {
          label: "标题与五点",
          content:
            "把商品类型、核心材质和规格前置，再表达使用场景。只使用与商品实物一致的搜索词，不重复堆叠。",
        },
        {
          label: "对照观察",
          content:
            "分批修改商品，保留修改前记录，观察 14 天点击率、加购率与支付转化，避免把短期波动直接视为优化收益。",
        },
      ],
    },
  },
  {
    id: "reviews",
    title: "中差评归因分析",
    description: "把分散的评价反馈整理成产品与体验改进清单。",
    primary: { label: "包装相关反馈", value: 23, unit: "条" },
    secondary: { label: "评价样本", value: "186 条" },
    chart: {
      metric: "efficiency",
      label: "包装相关反馈占比",
      variant: 3,
      values: [18.6, 17.2, 18.1, 16.5, 15.8, 14.1, 13.6, 12.4],
      unit: "%",
    },
    opportunity: {
      id: "scene-reviews",
      category: "中差评归因",
      title: "优先处理陶瓷系列的包装反馈",
      description:
        "以下为 186 条固定演示样本的归因案例；其中 23 条提到包装，集中在陶瓷系列。",
      impact: "形成 3 项产品与内容建议",
      priority: "持续关注",
      icon: "skillReviewAnalysis",
      evidence: [
        "包装相关反馈占样本的 12.4%。",
        "陶瓷系列低星评价中，包装主题占 61%。",
        "尺寸理解偏差和清洁说明不足是另外两个可改善主题。",
      ],
      steps: [
        "聚类评价主题与情绪",
        "定位具体商品和问题",
        "形成改善清单与观察指标",
      ],
      result: "已生成包装、规格表达和洗护说明的改善清单。",
      resultSections: [
        {
          label: "包装防护",
          content:
            "优先评估杯柄缓冲与独立内托，增加开箱检查点；在实测验证后再更新相关说明。",
        },
        {
          label: "页面预期",
          content:
            "增加容量、尺寸参照和包装件数图，明确清洁方式，避免用户依据场景图片误判商品大小。",
        },
        {
          label: "持续追踪",
          content:
            "按周统计包装相关低星评价占比与退款原因。对比改善前后同等周期，记录样本量和变化。",
        },
      ],
    },
  },
  {
    id: "traffic",
    title: "Listing 流量归因分析",
    description: "分清自然与广告增长，定位值得继续投入的来源。",
    primary: { label: "自然流量销售贡献", value: 58, unit: "%" },
    secondary: { label: "高潜搜索词", value: "9 个" },
    chart: {
      metric: "revenue",
      label: "自然流量关联销售走势",
      variant: 2,
      values: [560, 640, 602, 780, 822, 904, 1060, 1184],
      unit: "USD",
      scale: true,
    },
    opportunity: {
      id: "scene-traffic",
      category: "流量归因分析",
      title: "扩大高意向自然搜索的覆盖",
      description:
        "自然流量贡献 58% 销售额，仍有高相关长尾词尚未得到充分覆盖。",
      impact: "发现 9 个内容优化切入点",
      priority: "增长机会",
      icon: "skillListingReview",
      evidence: [
        "自然流量占演示销售额 58%，广告与站外分别为 27% 和 15%。",
        "9 个高相关词与商品材质、规格和使用场景直接相关。",
        "陶瓷马克杯与桌面收纳盒的自然搜索增长更明显。",
      ],
      steps: [
        "拆分流量来源与成交贡献",
        "识别增长搜索词",
        "生成内容覆盖与观察建议",
      ],
      result: "已生成自然搜索词覆盖和来源对照计划。",
      resultSections: [
        {
          label: "内容切入点",
          content:
            "按材质、规格和场景组织长尾词，在标题、五点和图片说明中分配相关信息，保持可读性。",
        },
        {
          label: "来源对照",
          content:
            "单独记录自然、广告和站外来源的访问与订单；推广活动期间不要把全部增长归因给自然搜索优化。",
        },
        {
          label: "观察计划",
          content:
            "连续 14 天观察搜索词覆盖、自然访问、点击和支付变化，优先保留有持续转化的词组。",
        },
      ],
    },
  },
  {
    id: "competitors",
    title: "竞品变化与机会追踪",
    description: "对照价格、内容和评价变化，建立有依据的竞争判断。",
    primary: { label: "跟踪竞品", value: 6, unit: "款" },
    secondary: { label: "值得关注的变化", value: "3 项" },
    chart: {
      metric: "conversion",
      label: "竞品价格指数 · 首期 = 100",
      variant: 5,
      values: [100, 101.4, 102.3, 100.9, 104.5, 103.2, 106.8, 108.2],
      unit: "点",
    },
    opportunity: {
      id: "scene-competitors",
      category: "竞品机会分析",
      title: "从竞品变化中找到差异化表达",
      description:
        "六款同类演示商品出现内容、规格表达与价格调整，值得结合自身优势逐项对照。",
      impact: "整理 3 项差异化内容建议",
      priority: "观察机会",
      icon: "skillListingReview",
      evidence: [
        "6 款竞品中，2 款新增了规格对照图。",
        "3 款竞品近期评价集中提到包装和易清洁体验。",
        "当前商品在套装件数与材质表达上存在可突出的信息。",
      ],
      steps: ["汇总竞品变化", "对照内容与评价差异", "生成差异化表达建议"],
      result: "已生成竞品变化摘要和差异化内容清单。",
      resultSections: [
        {
          label: "明确优势",
          content:
            "先核对自身套装件数、材质与包装事实，把经过验证的差异放入规格图与核心卖点，避免笼统宣称优于竞品。",
        },
        {
          label: "补齐基础信息",
          content:
            "新增尺寸和适用场景对照，减少用户在不同商品之间比较时的信息缺口。",
        },
        {
          label: "保持观察",
          content:
            "每周记录同组商品的价格、内容和评价变化，不因一次调价直接启动跟价；先检查利润与转化表现。",
        },
      ],
    },
  },
  {
    id: "health",
    title: "店铺销售健康诊断",
    description: "从销售、广告和体验信号中形成一份经营检查清单。",
    primary: { label: "经营健康评分", value: 86, unit: "/ 100" },
    secondary: { label: "待复核信号", value: "4 项" },
    chart: {
      metric: "efficiency",
      label: "经营健康指数走势",
      variant: 4,
      values: [72, 75, 74, 78, 82, 81, 84, 86],
      unit: "分",
    },
    opportunity: {
      id: "scene-health",
      category: "经营健康诊断",
      title: "保持增长，同时处理四个经营信号",
      description:
        "从销售增长、广告效率、内容质量与客户反馈四个维度形成可执行的检查顺序。",
      impact: "4 个维度 · 一份优先级清单",
      priority: "定期复盘",
      icon: "skillPpcCampaign",
      evidence: [
        "当前经营健康评分为 86 / 100，整体增长保持正向。",
        "广告低效消耗、内容缺口、包装反馈和单品转化波动需要复核。",
        "便携手冲咖啡壶销售环比下降 3.2%，建议单独观察。",
      ],
      steps: ["汇总经营核心指标", "识别异常与改善信号", "生成本周经营检查清单"],
      result: "已生成按影响和处理顺序排列的经营检查清单。",
      resultSections: [
        {
          label: "优先处理",
          content:
            "先检查广告低效词及手冲咖啡壶的流量和转化变化，区分曝光减少、点击变化与支付流失。",
        },
        {
          label: "持续改善",
          content:
            "补齐三个潜力商品的购买信息，组织包装反馈复盘，逐项记录负责人、调整内容与观察周期。",
        },
        {
          label: "下次复盘",
          content:
            "7 天后查看销售额、利润率、ACOS 和包装相关低星评价占比，保留原始数据与调整记录。",
        },
      ],
    },
  },
];
