import type { YjIconName } from "../icons/registry";

export type WorkflowAccent = "brand" | "blue" | "cyan" | "green" | "orange" | "purple";
export type WorkflowPublicationStatus = "published" | "unpublished";

export interface MyWorkflowFilter {
  readonly id: string;
  readonly label: string;
  readonly icon?: YjIconName;
  readonly selected?: boolean;
}

export interface MyWorkflow {
  readonly id: string;
  readonly title: string;
  readonly badge: string;
  readonly description: string;
  readonly modifiedAt: string;
  readonly icon: YjIconName;
  readonly accent: WorkflowAccent;
  readonly nodeCount: number;
  readonly status: WorkflowPublicationStatus;
}

export interface RecommendedWorkflowNode {
  readonly label: string;
  readonly icon: YjIconName;
  readonly accent: WorkflowAccent;
}

export interface RecommendedWorkflow {
  readonly id: string;
  readonly icon: YjIconName;
  readonly title: string;
  readonly badge: "热门" | "推荐";
  readonly description: string;
  readonly category: string;
  readonly input: string;
  readonly output: string;
  readonly nodes: readonly RecommendedWorkflowNode[];
  readonly usage: string;
  readonly actions: readonly ["预览", "使用工作流"];
}

export const MY_WORKFLOW_FILTERS: readonly MyWorkflowFilter[] = [
  { id: "all", label: "全部", selected: true },
  { id: "acquisition", label: "获客引流" },
  { id: "content", label: "内容创作" },
  { id: "image", label: "图片处理" },
  { id: "analytics", label: "数据分析" },
  { id: "operations", label: "运营管理" },
  { id: "new-category", label: "新建分类", icon: "plus" },
];

export const MY_WORKFLOWS: readonly MyWorkflow[] = [
  {
    id: "douyin-acquisition",
    title: "抖音电商获客工作流",
    badge: "电商获客",
    description: "通过关键词挖掘潜在客户，自动私信触达",
    modifiedAt: "2026-05-14 14:30",
    icon: "workflowAcquisition",
    accent: "purple",
    nodeCount: 6,
    status: "published",
  },
  {
    id: "product-batch-image",
    title: "商品批量出图工作流",
    badge: "批量出图",
    description: "批量生成商品图，支持多种风格模板",
    modifiedAt: "2026-05-12 10:20",
    icon: "workflowBatchImages",
    accent: "orange",
    nodeCount: 4,
    status: "published",
  },
  {
    id: "network-price-monitor",
    title: "全网比价监控工作流",
    badge: "全网比价",
    description: "监控全网价格变动，自动推送低价信息",
    modifiedAt: "2026-05-10 09:15",
    icon: "workflowPriceMonitor",
    accent: "green",
    nodeCount: 5,
    status: "published",
  },
  {
    id: "xiaohongshu-content",
    title: "小红书内容创作工作流",
    badge: "内容创作",
    description: "生成爆款笔记内容，支持图文自动排版",
    modifiedAt: "2026-05-08 16:45",
    icon: "workflowSocialContent",
    accent: "blue",
    nodeCount: 7,
    status: "unpublished",
  },
];

export const RECOMMENDED_WORKFLOWS: readonly RecommendedWorkflow[] = [
  {
    id: "listing-localization",
    icon: "workflowLocalization",
    title: "Listing 多语种本地化",
    badge: "热门",
    description: "结合目标市场与搜索词，生成地道的多语言商品文案",
    category: "内容创作",
    input: "商品卖点、目标市场、目标语言与搜索词",
    output: "适合目标市场的商品标题、卖点与描述",
    nodes: [
      { label: "商品卖点", icon: "skillProductDescription", accent: "brand" },
      { label: "目标市场", icon: "skillCrossBorderSelection", accent: "brand" },
      { label: "本地化文案", icon: "workflowLocalization", accent: "brand" },
    ],
    usage: "3.2k",
    actions: ["预览", "使用工作流"],
  },
  {
    id: "ad-search-term-optimization",
    icon: "workflowAdOptimization",
    title: "广告搜索词优化",
    badge: "热门",
    description: "识别高消耗低转化词，整理否词与竞价调整建议",
    category: "广告优化",
    input: "广告搜索词报告、花费、转化与投放目标",
    output: "待排除搜索词与竞价调整建议",
    nodes: [
      { label: "搜索词报告", icon: "skillKeywordResearch", accent: "brand" },
      { label: "表现分析", icon: "skillResearch", accent: "brand" },
      { label: "调整建议", icon: "workflowAdOptimization", accent: "brand" },
    ],
    usage: "2.8k",
    actions: ["预览", "使用工作流"],
  },
  {
    id: "fba-replenishment-planning",
    icon: "workflowReplenishment",
    title: "FBA 智能补货规划",
    badge: "推荐",
    description: "结合销量、在途与交期，生成补货数量和发货计划",
    category: "库存管理",
    input: "销量、可用库存、在途数量与补货交期",
    output: "建议补货数量与发货计划",
    nodes: [
      { label: "库存与销量", icon: "skillInventorySync", accent: "brand" },
      { label: "补货测算", icon: "workflowReplenishment", accent: "brand" },
      { label: "发货计划", icon: "skillDropshipping", accent: "brand" },
    ],
    usage: "1.9k",
    actions: ["预览", "使用工作流"],
  },
  {
    id: "overseas-review-insights",
    icon: "workflowReviewInsights",
    title: "海外买家评价洞察",
    badge: "推荐",
    description: "归纳评价中的体验问题，提炼产品与页面改进方向",
    category: "评价分析",
    input: "买家评价、商品信息与目标市场",
    output: "主要体验问题与产品、页面改进建议",
    nodes: [
      { label: "买家评价", icon: "workflowReviewInsights", accent: "brand" },
      { label: "主题归纳", icon: "skillContentBreakdown", accent: "brand" },
      { label: "改进方向", icon: "skillProductOptimization", accent: "brand" },
    ],
    usage: "1.6k",
    actions: ["预览", "使用工作流"],
  },
];
