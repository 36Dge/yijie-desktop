// @vitest-environment happy-dom

import { mount, type DOMWrapper } from "@vue/test-utils";
import axe from "axe-core";
import { defineComponent, nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import StoreAiOperations from "./StoreAiOperations.vue";
import StoreDashboardChart from "./StoreDashboardChart.vue";
import StoreOperationsChart from "./StoreOperationsChart.vue";
import { dashboardStats } from "../../domain/store-dashboard";
import { storeAiScenes } from "../../domain/store-ai-scenes";

const chartStub = defineComponent({
  props: [
    "kind",
    "label",
    "factor",
    "period",
    "metric",
    "variant",
    "sparkValues",
    "sparkUnit",
  ],
  emits: ["select"],
  template: '<div role="img" :aria-label="label" />',
});
const wrappers: ReturnType<typeof mount>[] = [];
function mountOperations() {
  const wrapper = mount(StoreAiOperations, {
    attachTo: document.body,
    props: {
      factor: 1,
      period: 30,
      stats: dashboardStats(1),
      completedIds: [],
      shop: "all",
    },
    global: {
      stubs: {
        StoreDashboardChart: chartStub,
        StoreOperationsChart: chartStub,
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
function button(wrapper: Pick<DOMWrapper<Element>, "findAll">, label: string) {
  const found = wrapper
    .findAll("button")
    .find((item) => item.text().trim() === label);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

describe("StoreAiOperations", () => {
  it("pairs outcome metrics and six scenarios with distinct analytical views without sparkle icons", () => {
    const wrapper = mountOperations();
    expect(wrapper.findAll(".aiops-metric")).toHaveLength(4);
    expect(wrapper.findAll(".aiops-scene")).toHaveLength(6);
    expect(
      wrapper
        .findAllComponents(StoreOperationsChart)
        .map((chart) => chart.props("kind")),
    ).toEqual([
      "spark",
      "spark",
      "spark",
      "spark",
      "opportunities",
      "sentiment",
      "coverage",
      "spark",
      "spark",
      "spark",
      "spark",
      "spark",
      "spark",
    ]);
    expect(wrapper.getComponent(StoreDashboardChart).props("kind")).toBe(
      "impact",
    );
    expect(
      wrapper
        .get('[aria-label="场景目标筛选"]')
        .findAll("button")
        .map((item) => item.text()),
    ).toEqual([
      "全部场景",
      "降 ACOS",
      "提转化",
      "防差评",
      "提流量",
      "盯竞品",
      "健康诊断",
    ]);
    expect(wrapper.find(".lucide-sparkles").exists()).toBe(false);
    expect(wrapper.text()).toContain("关联变化不等同于因果收益");
  });

  it.each([
    ["降 ACOS", "搜索词表现分析", "scene-acos"],
    ["提转化", "Listing 全漏斗转化分析", "scene-conversion"],
    ["防差评", "中差评归因分析", "scene-reviews"],
    ["提流量", "Listing 流量归因分析", "scene-traffic"],
    ["盯竞品", "竞品变化与机会追踪", "scene-competitors"],
    ["健康诊断", "店铺销售健康诊断", "scene-health"],
  ])(
    "filters %s and emits its own evidence, steps and generated result sections",
    async (goal, title, id) => {
      const wrapper = mountOperations();
      const goals = wrapper.get('[aria-label="场景目标筛选"]');
      await button(goals, goal).trigger("click");
      expect(button(goals, goal).attributes("aria-pressed")).toBe("true");
      expect(wrapper.findAll(".aiops-scene")).toHaveLength(1);
      expect(wrapper.get(".aiops-scene h3").text()).toBe(title);
      await wrapper.get(`[aria-label="查看${title}"]`).trigger("click");
      const opportunity = wrapper.emitted("opportunity")?.[0]?.[0];
      expect(opportunity).toMatchObject({ id });
      expect(opportunity).toMatchObject(
        storeAiScenes.find((scene) => scene.opportunity.id === id)!.opportunity,
      );
      await button(goals, "全部场景").trigger("click");
      expect(wrapper.findAll(".aiops-scene")).toHaveLength(6);
    },
  );

  it("keeps the focused card and chart mounted while switching scenes without stale content or actions", async () => {
    const wrapper = mountOperations();
    const goals = wrapper.get('[aria-label="场景目标筛选"]');
    const card = wrapper.get(".aiops-scene").element;
    const chart = wrapper.get(".aiops-scene").getComponent(StoreOperationsChart).vm;
    await button(goals, "降 ACOS").trigger("click");
    expect(wrapper.get(".aiops-scene").element).toBe(card);
    expect(wrapper.get(".aiops-scene").getComponent(StoreOperationsChart).vm).toBe(chart);

    for (const scene of storeAiScenes.slice(1)) {
      const control = button(goals, {
        conversion: "提转化", reviews: "防差评", traffic: "提流量",
        competitors: "盯竞品", health: "健康诊断", acos: "降 ACOS",
      }[scene.id]);
      (control.element as HTMLButtonElement).focus();
      await control.trigger("click");
      expect(document.activeElement).toBe(control.element);
      expect(wrapper.get(".aiops-scene").element).toBe(card);
      const currentChart = wrapper.get(".aiops-scene").getComponent(StoreOperationsChart);
      expect(currentChart.vm).toBe(chart);
      expect(currentChart.props()).toMatchObject({
        metric: scene.chart.metric,
        variant: scene.chart.variant,
        sparkValues: scene.chart.values,
        sparkUnit: scene.chart.unit,
        label: scene.chart.label,
      });
      expect(wrapper.get(".aiops-scene h3").text()).toBe(scene.title);
      await wrapper.get(`[aria-label="查看${scene.title}"]`).trigger("click");
      expect(wrapper.emitted("opportunity")?.slice(-1)[0]?.[0]).toEqual(scene.opportunity);
    }
    await button(goals, "全部场景").trigger("click");
    expect(wrapper.findAll(".aiops-scene")).toHaveLength(6);
    expect(wrapper.get(".aiops-scene").element).toBe(card);
    expect(wrapper.get(".aiops-scene").getComponent(StoreOperationsChart).vm).toBe(chart);
    expect(wrapper.findAll(".aiops-scene h3").map((heading) => heading.text())).toEqual(storeAiScenes.map((scene) => scene.title));
  });

  it("restores the containing page's scroll offset after a scene update changes the scroll range", async () => {
    const wrapper = mountOperations();
    const scroller = document.createElement("main");
    scroller.style.overflowY = "auto";
    document.body.append(scroller);
    scroller.append(wrapper.element);
    const goals = wrapper.get('[aria-label="场景目标筛选"]');
    await button(goals, "降 ACOS").trigger("click");
    await nextTick();
    scroller.scrollTop = 240;
    const update = button(goals, "提转化").trigger("click");
    // Model the browser clamping the scroll offset while the chart updates.
    scroller.scrollTop = 180;
    await update;
    await nextTick();
    expect(scroller.scrollTop).toBe(240);
    expect(wrapper.get(".aiops-scene h3").text()).toBe("Listing 全漏斗转化分析");
    expect((wrapper.get(".aiops-scene-grid").element as HTMLElement).style.minHeight).toBe("");
  });

  it("reacts to completed IDs in opportunity filters, task counts and reopenable activity", async () => {
    const wrapper = mountOperations();
    const filters = wrapper.get('[aria-label="增长机会筛选"]');
    await button(filters, "已完成").trigger("click");
    expect(wrapper.get(".aiops-empty").text()).toContain("还没有已生成的方案");
    await button(wrapper, "查看全部机会").trigger("click");
    expect(wrapper.findAll(".aiops-opportunity")).toHaveLength(3);
    await wrapper.setProps({ completedIds: ["ads", "scene-reviews"] });
    expect(wrapper.get(".aiops-heading__actions").text()).toContain(
      "2 个机会待处理",
    );
    expect(
      wrapper.get('[aria-label="已完成运营任务"] .aiops-metric__value').text(),
    ).toBe("50项");
    const completionChart = wrapper
      .findAllComponents(StoreOperationsChart)
      .find((chart) => chart.props("label") === "已完成运营任务走势");
    expect(completionChart?.props("sparkValues")?.slice(-1)[0]).toBe(50);
    expect(completionChart?.props("sparkUnit")).toBe("项");
    await button(filters, "待处理").trigger("click");
    expect(wrapper.findAll(".aiops-opportunity")).toHaveLength(2);
    await button(filters, "已完成").trigger("click");
    expect(wrapper.findAll(".aiops-opportunity")).toHaveLength(1);
    await button(wrapper.get(".aiops-opportunity"), "查看结果").trigger(
      "click",
    );
    expect(wrapper.emitted("opportunity")?.[0]?.[0]).toMatchObject({
      id: "ads",
    });
    expect(wrapper.get(".aiops-timeline li").text()).toContain(
      "中差评归因分析方案已生成",
    );
    await button(wrapper.get(".aiops-timeline li"), "查看结果").trigger(
      "click",
    );
    expect(wrapper.emitted("opportunity")?.[1]?.[0]).toMatchObject({
      id: "scene-reviews",
    });
    expect(wrapper.get('[aria-label="查看中差评归因分析"]').text()).toBe(
      "查看结果",
    );
  });

  it("resets local filters for a different scope while scaling monetary charts and preserving percentage samples", async () => {
    const wrapper = mountOperations();
    const goals = wrapper.get('[aria-label="场景目标筛选"]');
    const opportunities = wrapper.get('[aria-label="增长机会筛选"]');
    await button(goals, "防差评").trigger("click");
    await button(opportunities, "已完成").trigger("click");
    await wrapper.setProps({
      shop: "home",
      factor: 0.5,
      stats: dashboardStats(0.5),
      period: 7,
    });
    expect(button(goals, "全部场景").attributes("aria-pressed")).toBe("true");
    expect(button(opportunities, "全部").attributes("aria-pressed")).toBe(
      "true",
    );
    expect(wrapper.findAll(".aiops-scene")).toHaveLength(6);
    expect(
      wrapper.get('[aria-label="AI 关联销售额"] .aiops-metric__value').text(),
    ).toBe("$21,430");
    expect(wrapper.get(".aiops-voice-metrics").text()).toContain("93");
    const charts = wrapper.findAllComponents(StoreOperationsChart);
    for (const chart of charts) {
      expect(chart.props("factor")).toBe(0.5);
      expect(chart.props("period")).toBe(7);
    }
    expect(
      charts
        .find((chart) => chart.props("label") === "示例转化率走势")
        ?.props("sparkValues")
        ?.slice(-1)[0],
    ).toBe(3.84);
    expect(
      charts
        .find((chart) => chart.props("label") === "自然流量关联销售走势")
        ?.props("sparkValues")
        ?.slice(-1)[0],
    ).toBe(592);
    expect(wrapper.getComponent(StoreDashboardChart).props("period")).toBe(7);
  });

  it("forwards chart inspection with units and provides actionable brief and review entry points", async () => {
    const wrapper = mountOperations();
    const inspection = {
      name: "包装防护",
      value: 23,
      formattedValue: "23 条反馈",
      seriesName: "待改善反馈",
    };
    const chart = wrapper
      .findAllComponents(StoreOperationsChart)
      .find((item) => item.props("kind") === "sentiment");
    chart!.vm.$emit("select", inspection);
    await nextTick();
    expect(wrapper.emitted("inspect")?.[0]).toEqual([inspection]);
    await button(wrapper, "查看运营简报").trigger("click");
    expect(wrapper.emitted("report")).toHaveLength(1);
    await button(wrapper, "查看归因样例").trigger("click");
    expect(wrapper.emitted("opportunity")?.[0]?.[0]).toMatchObject({
      id: "scene-reviews",
    });
  });

  it("keeps its actual buttons and named charts free of serious or critical accessibility issues", async () => {
    const wrapper = mountOperations();
    const result = await axe.run(wrapper.element, {
      rules: { region: { enabled: false } },
    });
    expect(
      result.violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      ),
    ).toEqual([]);
  });
});
