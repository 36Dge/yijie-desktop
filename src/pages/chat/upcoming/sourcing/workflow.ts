// Local projection of the six presets in the selection workflow reference.
export type SelectionMode = "full" | "follow" | "bulk" | "curated" | "boutique" | "develop";
export type StepId = "opportunity" | "pool" | "filter" | "demand" | "competition" | "definition" | "sourcing" | "inquiry" | "targets" | "logistics" | "profit" | "screening";

interface Check { name: string; modes?: readonly SelectionMode[] }
interface NodeDefinition { title: string; purpose: string; output: string; checks: readonly Check[] }
export interface WorkflowStep { id: StepId; title: string; purpose: string; output: string; checks: readonly string[] }

const paths: Record<SelectionMode, readonly StepId[]> = {
  full: ["opportunity", "pool", "filter", "demand", "competition", "definition", "sourcing", "inquiry", "targets", "logistics", "profit", "screening"],
  follow: ["pool", "filter", "competition", "sourcing", "targets", "logistics", "profit", "screening"],
  bulk: ["opportunity", "pool", "filter", "targets", "logistics", "profit", "screening"],
  curated: ["pool", "filter", "demand", "competition", "sourcing", "inquiry", "targets", "logistics", "profit", "screening"],
  boutique: ["opportunity", "pool", "filter", "demand", "competition", "sourcing", "inquiry", "targets", "logistics", "profit", "screening"],
  develop: ["opportunity", "pool", "demand", "competition", "definition", "sourcing", "inquiry", "targets", "logistics", "profit", "screening"],
};

const nodes: Record<StepId, NodeDefinition> = {
  opportunity: {
    title: "机会发现/选市场",
    purpose: "发现可研究的市场与细分赛道，结合经营条件判断优先方向。",
    output: "带人群、场景、需求假设、依据与优先级的机会方向。目标已明确时跳过平台推荐",
    checks: [
      { name: "平台站点适配推荐", modes: ["boutique", "develop"] },
      { name: "市场机会扫描" },
      { name: "细分赛道发现" },
      { name: "市场需求分析", modes: ["boutique", "develop"] },
      { name: "市场容量分析", modes: ["boutique", "develop"] },
      { name: "市场竞争分析", modes: ["boutique", "develop"] },
      { name: "趋势与进入窗口", modes: ["boutique", "develop"] },
      { name: "经营适配与类目利润空间初判", modes: ["boutique", "develop"] },
      { name: "赛道机会比较与优先级", modes: ["boutique", "develop"] },
      { name: "类目侵权与禁限售预筛" },
    ],
  },
  pool: {
    title: "构建商品池",
    purpose: "把不同来源的线索转成可继续筛选的候选商品。",
    output: "带来源的候选商品集合",
    checks: [
      { name: "商品发现与类目召回", modes: ["bulk", "curated", "boutique", "develop"] },
      { name: "关键词关联商品", modes: ["curated", "boutique", "develop"] },
      { name: "同行店铺与对标商品" },
      { name: "榜单与趋势商品", modes: ["bulk", "curated"] },
      { name: "货盘与自有商品导入", modes: ["follow", "bulk", "curated"] },
      { name: "链接/图片/商品清单", modes: ["follow", "boutique", "develop"] },
      { name: "同款与历史商品去重" },
      { name: "多轮累积与补足候选", modes: ["bulk", "curated", "boutique"] },
    ],
  },
  filter: {
    title: "数据筛选",
    purpose: "依据研究平台/站点与来源能力提供指标和策略，让用户调整经营条件并缩小候选范围。",
    output: "符合本轮条件的候选集合",
    checks: [
      { name: "指标过滤" },
      { name: "选品策略", modes: ["bulk", "curated", "boutique"] },
    ],
  },
  demand: {
    title: "需求验证",
    purpose: "判断需求真实、持续且适合当前进入。",
    output: "需求判断与待验证问题",
    checks: [
      { name: "商品需求与付费意愿验证" },
      { name: "历史销售趋势验证" },
      { name: "需求周期分析" },
      { name: "跨平台需求交叉验证", modes: ["boutique", "develop"] },
      { name: "用户痛点与退货风险洞察" },
      { name: "目标用户与问题界定" },
      { name: "场景匹配分析" },
      { name: "商品进入时机分析" },
    ],
  },
  competition: {
    title: "竞争验证",
    purpose: "判断在目标市场中是否有可进入的位置。",
    output: "竞争结论与差异化方向",
    checks: [
      { name: "竞品与替代方案对标" },
      { name: "头部/品牌集中度", modes: ["curated", "boutique", "develop"] },
      { name: "市场价格带与成交区间" },
      { name: "获客与内容竞争门槛", modes: ["curated", "boutique", "develop"] },
      { name: "差异化与开发定位", modes: ["boutique", "develop"] },
      { name: "商品价格定位与价值支撑", modes: ["curated", "boutique", "develop"] },
      { name: "跨平台可比价格分析" },
    ],
  },
  definition: {
    title: "产品定义",
    purpose: "把已验证的问题与竞争缺口转成可开发的产品方案，约定规格、价值假设、风险边界和验收标准。",
    output: "版本化产品定义、方案、验收标准与开发前置待确认项",
    checks: [
      { name: "产品概念与改进方案池" },
      { name: "产品定义与验收标准" },
      { name: "差评反选" },
      { name: "迭代与互补产品方向" },
      { name: "开发前置风险清单" },
    ],
  },
  sourcing: {
    title: "供应链寻源",
    purpose: "找到与商品或开发方案匹配的供应候选。",
    output: "可比较的货源/工厂候选",
    checks: [
      { name: "1688以图寻源", modes: ["follow", "curated", "boutique"] },
      { name: "货源排序与多选", modes: ["follow", "curated", "boutique"] },
      { name: "供应商标签筛选" },
      { name: "多货盘与自有供应链", modes: ["boutique", "develop"] },
      { name: "供应商能力评估", modes: ["boutique", "develop"] },
      { name: "开发工厂与工艺匹配", modes: ["develop"] },
      { name: "开发可行性与立项复核", modes: ["develop"] },
      { name: "技术与生产可行性初筛", modes: ["develop"] },
      { name: "交付能力评估" },
      { name: "供应商质量稳定性评估" },
      { name: "供应风险与备选方案" },
    ],
  },
  inquiry: {
    title: "供应链询盘",
    purpose: "把展示价格与资料变成可使用的采购条件。",
    output: "报价、规格与交期确认结果",
    checks: [
      { name: "样品功能与目标用户验证", modes: ["develop"] },
      { name: "打样迭代与退出判断", modes: ["develop"] },
      { name: "定版规格与量产条件", modes: ["develop"] },
      { name: "询盘与报价收集" },
      { name: "供应商报价与采购条款分析" },
      { name: "规格/包装/重量确认" },
      { name: "交期与补货承诺确认" },
      { name: "开发打样与样品验收", modes: ["boutique", "develop"] },
      { name: "报价版本与有效期" },
    ],
  },
  targets: {
    title: "发布目标",
    purpose: "选择一个或多个平台站点，为后续测算建立独立目标。",
    output: "平台 × 站点目标集合",
    checks: [
      { name: "平台与站点选择" },
      { name: "多平台/多站点组合" },
      { name: "目标店铺与经营主体" },
      { name: "店型与经营方式匹配", modes: ["curated", "boutique", "develop"] },
      { name: "目标方案保留与变更", modes: ["curated", "boutique", "develop"] },
    ],
  },
  logistics: {
    title: "物流履约",
    purpose: "为当前平台站点确认可采用的交付方案。",
    output: "当前目标的履约方案与成本依据",
    checks: [
      { name: "官方物流方案与估价" },
      { name: "货代/第三方报价", modes: ["curated", "boutique", "develop"] },
      { name: "包装尺寸与计费重量", modes: ["curated", "boutique", "develop"] },
      { name: "头程/尾程/仓储组合" },
      { name: "时效与运输适配" },
      { name: "按目标确认履约方案" },
      { name: "渠道与履约方案比较" },
    ],
  },
  profit: {
    title: "利润测算",
    purpose: "在当前平台站点测算收益与投入，并比较经营可行性。",
    output: "当前目标的测算结果与经营假设",
    checks: [
      { name: "采购与物流粗估利润" },
      { name: "预期利润达标筛选" },
      { name: "多币种成本归一" },
      { name: "平台费用与全成本拆解", modes: ["curated", "boutique", "develop"] },
      { name: "保本价与目标价反算", modes: ["follow", "curated", "boutique", "develop"] },
      { name: "盈亏平衡与敏感性分析", modes: ["boutique", "develop"] },
      { name: "多目标利润对比", modes: ["curated", "boutique", "develop"] },
      { name: "开发投入与回收边界", modes: ["develop"] },
    ],
  },
  screening: {
    title: "合规初筛",
    purpose: "按当前平台站点排查继续推进的基本资格与风险。",
    output: "当前目标的初筛结论与待补事项",
    checks: [
      { name: "站点准入与禁限售" },
      { name: "主体与销售资质" },
      { name: "法规认证与文件缺口预筛" },
      { name: "已知知识产权风险" },
      { name: "平台站点独立结论" },
      { name: "依据、版本与人工复核", modes: ["curated", "boutique", "develop"] },
      { name: "商品安全与运输风险预筛" },
      { name: "合规表达预筛" },
    ],
  },
};

const development: Partial<Record<StepId, Partial<Pick<WorkflowStep, "purpose" | "output" | "checks">>>> = {
  opportunity: {
    output: "与经营条件匹配的研究赛道、目标人群与机会假设",
    checks: ["细分赛道发现", "赛道机会比较与优先级", "类目侵权与禁限售预筛", "平台站点适配推荐", "市场机会扫描", "市场需求分析", "市场容量分析", "市场竞争分析", "趋势与进入窗口", "经营适配与类目利润空间初判"],
  },
  pool: {
    purpose: "在已选赛道内收集在售商品、关键词和对标资料作为需求与竞争证据，不把参考商品直接等同待开发方案。",
    output: "带来源、规格与研究线索的参考商品池",
    checks: ["链接/图片/商品清单", "关键词关联商品", "同行店铺与对标商品", "商品发现与类目召回", "同款与历史商品去重"],
  },
  demand: {
    purpose: "验证目标用户、使用场景、问题强度与付费动机，将需求事实与待验证假设分开。",
    output: "用户问题、需求/周期/场景证据与商品进入时机判断",
    checks: ["目标用户与问题界定", "商品需求与付费意愿验证", "场景匹配分析", "用户痛点与退货风险洞察", "历史销售趋势验证", "需求周期分析", "跨平台需求交叉验证", "商品进入时机分析"],
  },
  competition: {
    purpose: "比较具体参考商品与替代方案，确认差异化、价格价值支撑与可进入的位置。",
    output: "竞品缺口、替代分析、差异化价值与价格假设",
    checks: ["差异化与开发定位", "竞品与替代方案对标", "商品价格定位与价值支撑", "头部/品牌集中度", "市场价格带与成交区间", "获客与内容竞争门槛", "跨平台可比价格分析"],
  },
  definition: {
    output: "可比较的产品概念、定版前规格、验收标准与风险待确认项",
  },
  sourcing: {
    purpose: "复用供应链寻源节点匹配工厂和工艺，评估能力、交付、质量稳定性与供应风险，并复核是否继续询盘打样。",
    output: "供应候选、工艺可行性、开发条件与继续/补证/停止建议",
    checks: ["开发工厂与工艺匹配", "技术与生产可行性初筛", "开发可行性与立项复核", "供应商质量稳定性评估", "供应商标签筛选", "多货盘与自有供应链", "供应商能力评估", "交付能力评估", "供应风险与备选方案"],
  },
  inquiry: {
    purpose: "复用供应链询盘节点确认报价和交期、组织样品与用户验证，未通过时返工或退出。通过后定版规格与量产条件。",
    output: "验收记录、定版规格、量产报价与实际包装重量",
    checks: ["开发打样与样品验收", "样品功能与目标用户验证", "打样迭代与退出判断", "定版规格与量产条件", "询盘与报价收集", "供应商报价与采购条款分析", "规格/包装/重量确认", "交期与补货承诺确认", "报价版本与有效期"],
  },
  logistics: {
    purpose: "基于验收定版的重量、尺寸和包装，逐站比较物流与履约方案，并保留对成本、时效与现金占用的影响。",
    output: "各目标的可比较履约方案、报价、时效与限制",
  },
  profit: {
    purpose: "复用利润测算节点，以定版报价与逐站履约条件测算利润、开发投入回收及盈亏压力。",
    output: "逐目标利润、开发投入回收假设与继续/补证/停止建议",
    checks: ["开发投入与回收边界", "盈亏平衡与敏感性分析", "平台费用与全成本拆解", "采购与物流粗估利润", "预期利润达标筛选", "多币种成本归一", "保本价与目标价反算", "多目标利润对比"],
  },
  screening: {
    purpose: "按定版商品与目标站点复核准入、认证文件、安全运输、知识产权及商品主张风险。最终文案和图片留给合规终审。",
    output: "各目标的预筛结论、证据缺口与复核事项",
  },
};

export function workflowFor(mode: SelectionMode): WorkflowStep[] {
  return paths[mode].map(id => {
    const node = nodes[id];
    const override = mode === "develop" ? development[id] : undefined;
    return {
      id, title: node.title,
      purpose: override?.purpose ?? node.purpose,
      output: override?.output ?? node.output,
      checks: override?.checks ?? node.checks
        .filter(check => mode === "full" || !check.modes || check.modes.includes(mode))
        .map(check => check.name),
    };
  });
}

export const publishingHandoff = [
  { title: "商品信息优化", purpose: "按目标市场整理适合发布的商品信息。", output: "待定价与终审的商品资料" },
  { title: "智能定价", purpose: "把经营目标转成每个目标市场的实际价格方案。", output: "待发布的SKU价格" },
  { title: "合规终审", purpose: "基于最终商品资料、价格和目标市场完成发布前核验。", output: "可发布或需处理的最终资料" },
  { title: "发布", purpose: "把确认后的资料交给对应目标店铺发布。", output: "各目标发布结果与后续处理状态" },
] as const;
