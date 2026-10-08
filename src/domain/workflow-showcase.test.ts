import { describe, expect, it } from "vitest";
import {
  MY_WORKFLOW_FILTERS,
  MY_WORKFLOWS,
  RECOMMENDED_WORKFLOWS,
  WORKFLOW_CATEGORIES,
} from "./workflow-showcase";

describe("workflow showcase model", () => {
  it("FEAT-151 preserves every top-level category from the reference", () => {
    expect(WORKFLOW_CATEGORIES.map(({ label }) => label)).toEqual([
      "全部",
      "电商获客",
      "批量出图",
      "全网比价",
      "内容创作",
      "视频生成",
      "数据分析",
      "私域运营",
      "更多",
    ]);
  });

  it("FEAT-151 preserves the complete my-workflow toolbar and cards", () => {
    expect(MY_WORKFLOW_FILTERS.map(({ label }) => label)).toEqual([
      "全部",
      "获客引流",
      "内容创作",
      "图片处理",
      "数据分析",
      "运营管理",
      "新建分类",
    ]);
    expect(MY_WORKFLOWS).toEqual([
      expect.objectContaining({
        title: "抖音电商获客工作流",
        badge: "电商获客",
        description: "通过关键词挖掘潜在客户，自动私信触达",
        modifiedAt: "2026-05-14 14:30",
      }),
      expect.objectContaining({
        title: "商品批量出图工作流",
        badge: "批量出图",
        description: "批量生成商品图，支持多种风格模板",
        modifiedAt: "2026-05-12 10:20",
      }),
      expect.objectContaining({
        title: "全网比价监控工作流",
        badge: "全网比价",
        description: "监控全网价格变动，自动推送低价信息",
        modifiedAt: "2026-05-10 09:15",
      }),
      expect.objectContaining({
        title: "小红书内容创作工作流",
        badge: "内容创作",
        description: "生成爆款笔记内容，支持图文自动排版",
        modifiedAt: "2026-05-08 16:45",
      }),
    ]);
  });

  it("FEAT-151 presents complementary cross-border workflow recommendations", () => {
    expect(RECOMMENDED_WORKFLOWS).toHaveLength(4);
    expect(RECOMMENDED_WORKFLOWS.map((workflow) => ({
      title: workflow.title,
      badge: workflow.badge,
      description: workflow.description,
      nodes: workflow.nodes.map(({ label }) => label),
      usage: workflow.usage,
      actions: workflow.actions,
    }))).toEqual([
      {
        title: "Listing 多语种本地化",
        badge: "热门",
        description: "结合目标市场与搜索词，生成地道的多语言商品文案",
        nodes: ["商品卖点", "目标市场", "本地化文案"],
        usage: "3.2k",
        actions: ["演示", "执行"],
      },
      {
        title: "广告搜索词优化",
        badge: "热门",
        description: "识别高消耗低转化词，整理否词与竞价调整建议",
        nodes: ["搜索词报告", "表现分析", "调整建议"],
        usage: "2.8k",
        actions: ["演示", "执行"],
      },
      {
        title: "FBA 智能补货规划",
        badge: "推荐",
        description: "结合销量、在途与交期，生成补货数量和发货计划",
        nodes: ["库存与销量", "补货测算", "发货计划"],
        usage: "1.9k",
        actions: ["演示", "执行"],
      },
      {
        title: "海外买家评价洞察",
        badge: "推荐",
        description: "归纳评价中的体验问题，提炼产品与页面改进方向",
        nodes: ["买家评价", "主题归纳", "改进方向"],
        usage: "1.6k",
        actions: ["演示", "执行"],
      },
    ]);
  });
});
