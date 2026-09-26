// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount } from "@vue/test-utils";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import WorkflowPage from "./WorkflowPage.vue";

function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/", component: { template: "<div />" } },
    { path: "/workflows/new", component: { template: "<div />" } },
  ] });
  return mount(WorkflowPage, { attachTo: document.body, global: { plugins: [router] } });
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
    expect(wrapper.get(".yj-page-header__description").text()).toBe("集中查看常用自动化流程与推荐方案，点击创建工作流按钮开始。下方电商工作流方案为展示作用，并无实际实现。");
    expect(wrapper.get(".workflow-page__create-highlight").text()).toBe("创建工作流");
    expect(wrapper.get('[aria-label="工作流能力分类"] li').text()).toContain("全部");
    expect(wrapper.findAll('[aria-label="工作流能力分类"] li').map((item) => item.text()))
      .toEqual(["全部", "电商获客", "批量出图", "全网比价", "内容创作", "视频生成", "数据分析", "私域运营", "更多"]);
    expect(wrapper.findAll('[aria-label="我的工作流分类"] li').map((item) => item.text().trim()))
      .toEqual(["全部", "获客引流", "内容创作", "图片处理", "数据分析", "运营管理", "新建分类"]);
    expect(wrapper.text()).toContain("最近修改");
    expect(wrapper.get(".workflow-page__create-card").element.tagName).toBe("BUTTON");
    expect(wrapper.findAll(".workflow-summary-card")).toHaveLength(4);
    expect(wrapper.findAll(".recommended-workflow-card")).toHaveLength(4);
    expect(wrapper.text()).toContain("查看全部");
  });

  it("FEAT-151 renders the workflow content and actions without recommendation flow diagrams", () => {
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

    expect(wrapper.findAll(".recommended-workflow-card__flow")).toHaveLength(0);
    expect(wrapper.findAll(".recommended-workflow-card__node")).toHaveLength(0);
    expect(wrapper.findAll(".recommended-workflow-card__action").map((action) => action.text()))
      .toEqual(["演示", "执行", "演示", "执行", "演示", "执行", "演示", "执行"]);
  });

  it("FEAT-151 switches local controls independently while retaining every card and its order", async () => {
    const wrapper = mountPage();
    const cardContent = () => wrapper.findAll("article").map((card) => card.text());
    const originalContent = cardContent();

    const category = wrapper.get('[aria-label="工作流能力分类"]');
    const filters = wrapper.get('[aria-label="我的工作流分类"]');
    const views = wrapper.get('[aria-label="排序和视图"]');
    for (const group of [category, filters, views]) {
      const buttons = group.findAll("button");
      expect(buttons[0]!.attributes("aria-pressed")).toBe("true");
      for (const button of buttons) {
        await button.trigger("click");
        expect(button.attributes("aria-pressed")).toBe("true");
        expect(group.findAll('[aria-pressed="true"]')).toHaveLength(1);
        expect(cardContent()).toEqual(originalContent);
      }
    }
    expect(category.findAll('[aria-pressed="true"]')[0]!.text()).toBe("更多");
    expect(filters.findAll('[aria-pressed="true"]')[0]!.text()).toBe("新建分类");
    expect(views.get('[aria-label="列表视图"]').attributes("aria-pressed")).toBe("true");

    const sort = wrapper.get<HTMLSelectElement>('select[aria-label="工作流排序"]');
    expect(sort.findAll("option").map((option) => option.text())).toEqual(["最近修改", "最近创建", "名称排序"]);
    for (const value of ["created", "name", "modified"]) {
      await sort.setValue(value);
      expect(sort.element.value).toBe(value);
      expect(cardContent()).toEqual(originalContent);
    }

    for (const button of wrapper.findAll(".workflow-page__view-all")) {
      await button.trigger("click");
      expect(button.attributes("aria-pressed")).toBe("true");
      await button.trigger("click");
      expect(button.attributes("aria-pressed")).toBe("false");
    }
    for (const more of wrapper.findAll(".workflow-summary-card__more")) {
      const beforeClick = more.html();
      await more.trigger("click");
      expect(more.html()).toBe(beforeClick);
      expect(more.attributes("role")).toBe("img");
      expect(more.attributes("aria-pressed")).toBeUndefined();
      expect(more.attributes("tabindex")).toBeUndefined();
    }
    for (const card of wrapper.findAll(".recommended-workflow-card")) {
      const [demo, execute] = card.findAll("button");
      await demo!.trigger("click");
      expect(demo!.attributes("aria-pressed")).toBe("true");
      await execute!.trigger("click");
      expect(demo!.attributes("aria-pressed")).toBe("false");
      expect(execute!.attributes("aria-pressed")).toBe("true");
      expect(cardContent()).toEqual(originalContent);
    }
    wrapper.unmount();
    const remounted = mountPage();
    expect(remounted.get('[aria-label="工作流能力分类"] button').attributes("aria-pressed")).toBe("true");
    expect(remounted.get('[aria-label="列表视图"]').attributes("aria-pressed")).toBe("false");
    expect(remounted.get<HTMLSelectElement>("select").element.value).toBe("modified");
    expect(remounted.findAll('.recommended-workflow-card [aria-pressed="true"]')).toHaveLength(0);
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
