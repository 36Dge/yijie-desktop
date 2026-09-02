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

  it("FEAT-151 preserves all recommended workflow copy, nodes, usage, and actions", () => {
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
        title: "智能抖音获客工作流",
        badge: "热门",
        description: "精准挖掘抖音潜在客户，自动化触达转化",
        nodes: ["抖音", "AI", "私信"],
        usage: "3.2k",
        actions: ["演示", "执行"],
      },
      {
        title: "电商商品批量出图工作流",
        badge: "热门",
        description: "批量生成多平台商品图，提升运营效率",
        nodes: ["商品", "批量出图", "商品图"],
        usage: "2.8k",
        actions: ["演示", "执行"],
      },
      {
        title: "全网比价监控工作流",
        badge: "推荐",
        description: "实时监控全网价格，智能推送低价信息",
        nodes: ["全网价格", "比价", "数据"],
        usage: "1.9k",
        actions: ["演示", "执行"],
      },
      {
        title: "小红书爆款内容生成工作流",
        badge: "推荐",
        description: "AI生成爆款笔记，图文排版一键搞定",
        nodes: ["小红书", "AI", "图文"],
        usage: "1.6k",
        actions: ["演示", "执行"],
      },
    ]);
  });
});
