// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import WorkflowPage from "./WorkflowPage.vue";

function mountPage() {
  return mount(WorkflowPage, { attachTo: document.body });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WorkflowPage", () => {
  it("FEAT-151 renders the complete reference information in the approved order", () => {
    const wrapper = mountPage();

    expect(wrapper.get("h1").text()).toBe("工作流");
    expect(wrapper.findAll("h2").map((heading) => heading.text())).toEqual([
      "我的工作流",
      "推荐工作流",
    ]);
    expect(wrapper.get('[aria-label="工作流能力分类（仅展示）"] li').text()).toContain("全部");
    expect(wrapper.findAll('[aria-label="工作流能力分类（仅展示）"] li').map((item) => item.text()))
      .toEqual(["全部", "电商获客", "批量出图", "全网比价", "内容创作", "视频生成", "数据分析", "私域运营", "更多"]);
    expect(wrapper.findAll('[aria-label="我的工作流分类（仅展示）"] li').map((item) => item.text().trim()))
      .toEqual(["全部", "获客引流", "内容创作", "图片处理", "数据分析", "运营管理", "新建分类"]);
    expect(wrapper.text()).toContain("最近修改");
    expect(wrapper.text()).toContain("创建工作流");
    expect(wrapper.findAll(".workflow-summary-card")).toHaveLength(4);
    expect(wrapper.findAll(".recommended-workflow-card")).toHaveLength(4);
    expect(wrapper.text()).toContain("查看全部");
  });

  it("FEAT-151 renders every workflow timestamp, recommendation node, usage, and action label", () => {
    const wrapper = mountPage();

    for (const expected of [
      "抖音电商获客工作流",
      "2026-05-14 14:30",
      "商品批量出图工作流",
      "2026-05-12 10:20",
      "全网比价监控工作流",
      "2026-05-10 09:15",
      "小红书内容创作工作流",
      "2026-05-08 16:45",
      "智能抖音获客工作流",
      "精准挖掘抖音潜在客户，自动化触达转化",
      "电商商品批量出图工作流",
      "批量生成多平台商品图，提升运营效率",
      "实时监控全网价格，智能推送低价信息",
      "小红书爆款内容生成工作流",
      "AI生成爆款笔记，图文排版一键搞定",
      "3.2k",
      "2.8k",
      "1.9k",
      "1.6k",
    ]) {
      expect(wrapper.text()).toContain(expected);
    }

    expect(wrapper.findAll(".recommended-workflow-card__flow")).toHaveLength(4);
    expect(wrapper.findAll(".recommended-workflow-card__node")).toHaveLength(12);
    expect(wrapper.findAll(".recommended-workflow-card__action").map((action) => action.text()))
      .toEqual(["演示", "执行", "演示", "执行", "演示", "执行", "演示", "执行"]);
  });

  it("FEAT-151 keeps every page-local control display-only", () => {
    const wrapper = mountPage();

    expect(wrapper.find("button").exists()).toBe(false);
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.findAll('[aria-disabled="true"]').length).toBeGreaterThan(20);
  });

  it("FEAT-151 has no API, native command, or browser persistence dependency", () => {
    const source = [
      "src/domain/workflow-showcase.ts",
      "src/pages/workflows/WorkflowPage.vue",
      "src/components/workflows/WorkflowSummaryCard.vue",
      "src/components/workflows/RecommendedWorkflowCard.vue",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");

    expect(source).not.toMatch(/\b(fetch|axios|invoke|localStorage|sessionStorage|indexedDB)\b/);
    expect(source).not.toMatch(/@tauri-apps\/api/);
  });

  it("FEAT-151 has no serious or critical accessibility violations", async () => {
    const wrapper = mountPage();
    const results = await axe.run(wrapper.element, {
      rules: { region: { enabled: false } },
    });

    expect(results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    )).toEqual([]);
  });
});
