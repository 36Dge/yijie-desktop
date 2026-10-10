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
    expect(wrapper.get(".yj-page-header__description").text()).toBe("集中查看常用自动化流程与推荐方案，点击创建工作流按钮开始。");
    expect(wrapper.findAll('[aria-label="我的工作流分类"] li').map((item) => item.text().trim()))
      .toEqual(["全部", "获客引流", "内容创作", "图片处理", "数据分析", "运营管理", "新建分类"]);
    expect(wrapper.text()).toContain("最近修改");
    expect(wrapper.get(".workflow-page__create-card").element.tagName).toBe("BUTTON");
    expect(wrapper.findAll(".workflow-summary-card")).toHaveLength(4);
    expect(wrapper.findAll(".workflow-summary-card__status").map(status => status.text())).toEqual(["已发布", "已发布", "已发布", "未发布"]);
    expect(wrapper.findAll(".workflow-summary-card__action").map(action => action.text())).toEqual(["进入工作流", "进入工作流", "进入工作流", "进入编辑"]);
    expect(wrapper.findAll(".workflow-summary-card__nodes").map(nodes => nodes.text())).toEqual(["6 个节点", "4 个节点", "5 个节点", "7 个节点"]);
    expect(wrapper.findAll(".recommended-workflow-card")).toHaveLength(4);
    expect(wrapper.text()).toContain("查看全部");
  });

  it("FEAT-151 renders the workflow content and actions without recommendation flow diagrams", () => {
    const wrapper = mountPage();

    for (const expected of [
      "抖音电商获客工作流",
      "商品批量出图工作流",
      "全网比价监控工作流",
      "小红书内容创作工作流",
      "Listing 多语种本地化",
      "结合目标市场与搜索词，生成地道的多语言商品文案",
      "广告搜索词优化",
      "识别高消耗低转化词，整理否词与竞价调整建议",
      "FBA 智能补货规划",
      "结合销量、在途与交期，生成补货数量和发货计划",
      "海外买家评价洞察",
      "归纳评价中的体验问题，提炼产品与页面改进方向",
      "3.2k",
      "2.8k",
      "1.9k",
      "1.6k",
    ]) {
      expect(wrapper.text()).toContain(expected);
    }

    expect(wrapper.get('[aria-label="我的工作流列表"]').text()).not.toContain("修改于");
    expect(wrapper.get('[aria-label="我的工作流列表"]').findAll("time")).toHaveLength(0);
    expect(wrapper.findAll(".recommended-workflow-card__flow")).toHaveLength(0);
    expect(wrapper.findAll(".recommended-workflow-card__node")).toHaveLength(0);
    expect(wrapper.findAll(".recommended-workflow-card__action").map((action) => action.text()))
      .toEqual(["预览", "使用工作流", "预览", "使用工作流", "预览", "使用工作流", "预览", "使用工作流"]);
  });

  it("FEAT-151 switches local controls independently while retaining every card and its order", async () => {
    const wrapper = mountPage();
    const cardContent = () => wrapper.findAll("article").map((card) => card.text());
    const originalContent = cardContent();

    const filters = wrapper.get('[aria-label="我的工作流分类"]');
    const views = wrapper.get('[aria-label="排序和视图"]');
    for (const group of [filters, views]) {
      const buttons = group.findAll("button");
      expect(buttons[0]!.attributes("aria-pressed")).toBe("true");
      for (const button of buttons) {
        await button.trigger("click");
        expect(button.attributes("aria-pressed")).toBe("true");
        expect(group.findAll('[aria-pressed="true"]')).toHaveLength(1);
        expect(cardContent()).toEqual(originalContent);
      }
    }
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
    expect(wrapper.findAll(".workflow-summary-card__more")).toHaveLength(0);
    expect(wrapper.findAll('.recommended-workflow-card [aria-pressed]')).toHaveLength(0);
    wrapper.unmount();
    const remounted = mountPage();
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
