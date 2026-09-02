import type { YjIconName } from "../icons/registry";

export type WorkflowAccent = "brand" | "blue" | "cyan" | "green" | "orange" | "purple";

export interface WorkflowCategory {
  readonly id: string;
  readonly label: string;
  readonly icon: YjIconName;
  readonly accent: WorkflowAccent;
  readonly selected?: boolean;
}

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
}

export interface RecommendedWorkflowNode {
  readonly label: string;
  readonly icon: YjIconName;
  readonly accent: WorkflowAccent;
}

export interface RecommendedWorkflow {
  readonly id: string;
  readonly title: string;
  readonly badge: "热门" | "推荐";
  readonly description: string;
  readonly nodes: readonly RecommendedWorkflowNode[];
  readonly usage: string;
  readonly actions: readonly ["演示", "执行"];
}

export const WORKFLOW_CATEGORIES: readonly WorkflowCategory[] = [
  { id: "all", label: "全部", icon: "workspace", accent: "brand", selected: true },
  { id: "acquisition", label: "电商获客", icon: "store", accent: "orange" },
  { id: "batch-image", label: "批量出图", icon: "image", accent: "blue" },
  { id: "price-compare", label: "全网比价", icon: "scanSearch", accent: "cyan" },
  { id: "content", label: "内容创作", icon: "edit", accent: "purple" },
  { id: "video", label: "视频生成", icon: "video", accent: "orange" },
  { id: "analytics", label: "数据分析", icon: "skillResearch", accent: "green" },
  { id: "private-operations", label: "私域运营", icon: "user", accent: "purple" },
  { id: "more", label: "更多", icon: "more", accent: "brand" },
];

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
    icon: "workflow",
    accent: "purple",
  },
  {
    id: "product-batch-image",
    title: "商品批量出图工作流",
    badge: "批量出图",
    description: "批量生成商品图，支持多种风格模板",
    modifiedAt: "2026-05-12 10:20",
    icon: "image",
    accent: "orange",
  },
  {
    id: "network-price-monitor",
    title: "全网比价监控工作流",
    badge: "全网比价",
    description: "监控全网价格变动，自动推送低价信息",
    modifiedAt: "2026-05-10 09:15",
    icon: "scanSearch",
    accent: "green",
  },
  {
    id: "xiaohongshu-content",
    title: "小红书内容创作工作流",
    badge: "内容创作",
    description: "生成爆款笔记内容，支持图文自动排版",
    modifiedAt: "2026-05-08 16:45",
    icon: "edit",
    accent: "blue",
  },
];

export const RECOMMENDED_WORKFLOWS: readonly RecommendedWorkflow[] = [
  {
    id: "smart-douyin-acquisition",
    title: "智能抖音获客工作流",
    badge: "热门",
    description: "精准挖掘抖音潜在客户，自动化触达转化",
    nodes: [
      { label: "抖音", icon: "video", accent: "blue" },
      { label: "AI", icon: "assistant", accent: "green" },
      { label: "私信", icon: "message", accent: "cyan" },
    ],
    usage: "3.2k",
    actions: ["演示", "执行"],
  },
  {
    id: "ecommerce-batch-image",
    title: "电商商品批量出图工作流",
    badge: "热门",
    description: "批量生成多平台商品图，提升运营效率",
    nodes: [
      { label: "商品", icon: "store", accent: "purple" },
      { label: "批量出图", icon: "image", accent: "orange" },
      { label: "商品图", icon: "fileImage", accent: "blue" },
    ],
    usage: "2.8k",
    actions: ["演示", "执行"],
  },
  {
    id: "network-price-compare",
    title: "全网比价监控工作流",
    badge: "推荐",
    description: "实时监控全网价格，智能推送低价信息",
    nodes: [
      { label: "全网价格", icon: "skillResearch", accent: "blue" },
      { label: "比价", icon: "scanSearch", accent: "orange" },
      { label: "数据", icon: "skillResearch", accent: "green" },
    ],
    usage: "1.9k",
    actions: ["演示", "执行"],
  },
  {
    id: "xiaohongshu-viral-content",
    title: "小红书爆款内容生成工作流",
    badge: "推荐",
    description: "AI生成爆款笔记，图文排版一键搞定",
    nodes: [
      { label: "小红书", icon: "edit", accent: "orange" },
      { label: "AI", icon: "assistant", accent: "green" },
      { label: "图文", icon: "fileImage", accent: "blue" },
    ],
    usage: "1.6k",
    actions: ["演示", "执行"],
  },
];
