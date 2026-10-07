// @vitest-environment happy-dom

import { mount, type DOMWrapper } from "@vue/test-utils";
import axe from "axe-core";
import { defineComponent, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StorePage from "./StorePage.vue";
import StoreDashboardChart from "../../components/store/StoreDashboardChart.vue";
import StoreAiOperations from "../../components/store/StoreAiOperations.vue";
import { opportunityData } from "../../domain/store-dashboard";
import { storeAiScenes } from "../../domain/store-ai-scenes";

const chartStub = defineComponent({
  props: ["kind", "factor", "period", "metric", "label"],
  emits: ["select"],
  template: '<div :aria-label="label"><button @click="$emit(\'select\', { name: \'自然搜索\', value: 1200 })">查看图表数据点</button></div>',
});
const operationsStub = defineComponent({
  props: ["factor", "period", "stats", "completedIds", "shop"],
  emits: ["opportunity", "report", "inspect"],
  template: '<section aria-label="AI 运营工作台" />',
});
vi.mock("naive-ui", async () => {
  const { defineComponent } = await import("vue");
  return {
    NDrawer: defineComponent({
      props: ["show"],
      emits: ["update:show"],
      template: '<section v-if="show" data-testid="drawer"><slot /></section>',
    }),
    NDrawerContent: defineComponent({
      props: ["title"],
      template: '<div><h2>{{ title }}</h2><slot /><footer><slot name="footer" /></footer></div>',
    }),
    NModal: defineComponent({
      props: ["show", "title"],
      emits: ["update:show"],
      template: '<section v-if="show" data-testid="modal"><h2>{{ title }}</h2><slot /></section>',
    }),
  };
});

const wrappers: ReturnType<typeof mount>[] = [];
function mountPage() {
  const wrapper = mount(StorePage, {
    attachTo: document.body,
    global: { stubs: { teleport: true, StoreDashboardChart: chartStub, StoreAiOperations: operationsStub } },
  });
  wrappers.push(wrapper);
  return wrapper;
}

function button(wrapper: Pick<DOMWrapper<Element>, "findAll">, label: string) {
  const result = wrapper.findAll("button").find((candidate) => candidate.text().trim() === label);
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("StorePage dashboard", () => {
  it("opens the new overview and keeps the legacy modules out of both tabs", async () => {
    const wrapper = mountPage();
    expect(wrapper.get("h1").text()).toBe("我的店铺");
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(["经营总览", "AI 运营"]);
    expect(wrapper.findAllComponents(StoreDashboardChart).map((chart) => chart.props("kind"))).toEqual(["trend", "categories", "funnel", "channels", "channelConversion", "productGrowth"]);
    expect(wrapper.text()).toContain("经营趋势");
    expect(wrapper.text()).toContain("易界 AI 洞察");
    expect(wrapper.text()).toContain("所有数据均为演示");
    for (const label of ["经营快报", "精选场景", "角色场景推荐", "库存分析"]) expect(wrapper.text()).not.toContain(label);
    await button(wrapper, "AI 运营").trigger("click");
    expect(wrapper.findComponent(StoreAiOperations).exists()).toBe(true);
    expect(wrapper.findAllComponents(StoreDashboardChart)).toHaveLength(0);
    expect(wrapper.find(".sd-product-table").exists()).toBe(false);
  });

  it("keeps tab focus, selection and panel labeling in sync for keyboard navigation", async () => {
    const wrapper = mountPage();
    const tabs = wrapper.findAll('[role="tab"]');
    (tabs[0].element as HTMLButtonElement).focus();
    await tabs[0].trigger("keydown", { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs[1].element);
    expect(tabs[1].attributes("aria-selected")).toBe("true");
    expect(tabs[1].attributes("tabindex")).toBe("0");
    expect(tabs[0].attributes("tabindex")).toBe("-1");
    expect(wrapper.get('[role="tabpanel"]').attributes("aria-labelledby")).toBe(tabs[1].attributes("id"));
    await tabs[1].trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(tabs[0].element);
    expect(tabs[0].attributes("aria-selected")).toBe("true");
    await tabs[0].trigger("keydown", { key: "ArrowLeft" });
    expect(tabs[1].attributes("aria-selected")).toBe("true");
    await tabs[1].trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(tabs[1].element);
  });

  it("links shop and period filters to metrics, chart inputs, product rows and the AI tab", async () => {
    const wrapper = mountPage();
    const originalSales = wrapper.get(".sd-hero__value").text();
    const originalProductSales = wrapper.get(".sd-product-table tbody tr td:nth-child(2)").text();
    await wrapper.get('[aria-label="选择店铺"]').setValue("home");
    await wrapper.get('[aria-label="时间范围"]').setValue("7");
    expect(wrapper.find(".sd-context").exists()).toBe(false);
    expect((wrapper.get('[aria-label="选择店铺"]').element as HTMLSelectElement).value).toBe("home");
    expect((wrapper.get('[aria-label="时间范围"]').element as HTMLSelectElement).value).toBe("7");
    expect(wrapper.get(".sd-hero__value").text()).not.toBe(originalSales);
    expect(wrapper.get(".sd-product-table tbody tr td:nth-child(2)").text()).not.toBe(originalProductSales);
    for (const chart of wrapper.findAllComponents(StoreDashboardChart)) {
      expect(chart.props("factor")).toBeCloseTo(0.58 * 7 / 30);
      expect(chart.props("period")).toBe(7);
    }
    await button(wrapper.get('[aria-label="趋势指标"]'), "利润").trigger("click");
    expect(wrapper.findComponent(StoreDashboardChart).props("metric")).toBe("profit");
    expect(wrapper.get(".sd-trend-stat").text()).toContain("预估利润");
    await button(wrapper, "AI 运营").trigger("click");
    const operations = wrapper.getComponent(StoreAiOperations);
    const scopedAiRevenue = operations.props("stats").aiRevenue;
    expect(operations.props("shop")).toBe("home");
    expect(operations.props("period")).toBe(7);
    expect(operations.props("factor")).toBeCloseTo(0.58 * 7 / 30);
    await wrapper.get('[aria-label="选择店铺"]').setValue("all");
    expect(operations.props("stats").aiRevenue).toBeGreaterThan(scopedAiRevenue);
    expect(operations.props("shop")).toBe("all");
    expect((wrapper.get('[aria-label="时间范围"]').element as HTMLSelectElement).value).toBe("7");
  });

  it("paginates, filters by SKU, recovers from no results, and sorts the product table", async () => {
    const wrapper = mountPage();
    const previous = wrapper.get('[aria-label="上一页商品"]');
    const next = wrapper.get('[aria-label="下一页商品"]');
    expect(previous.attributes("disabled")).toBeDefined();
    expect(wrapper.findAll(".sd-product-name")).toHaveLength(5);
    await next.trigger("click");
    expect(wrapper.findAll(".sd-product-name")).toHaveLength(3);
    expect(wrapper.get(".sd-pagination").text()).toContain("6–8");
    expect(next.attributes("disabled")).toBeDefined();
    await wrapper.get('[aria-label="搜索商品"]').setValue("yj-hm-001");
    expect(wrapper.findAll(".sd-product-name")).toHaveLength(1);
    expect(wrapper.get(".sd-product-name").text()).toContain("陶瓷马克杯套装");
    expect(wrapper.get(".sd-pagination").text()).toContain("1 / 1");
    await wrapper.get('[aria-label="搜索商品"]').setValue("不存在的商品");
    expect(wrapper.get(".sd-table-empty").text()).toContain("没有找到");
    await button(wrapper, "清空筛选").trigger("click");
    expect(wrapper.findAll(".sd-product-name")).toHaveLength(5);
    await wrapper.get('[aria-label="商品排序"]').setValue("score");
    expect(wrapper.findAll(".sd-product-name")[1].text()).toContain("天然香薰蜡烛");
    await wrapper.get('[aria-label="下一页商品"]').trigger("click");
    await wrapper.get('[aria-label="商品排序"]').setValue("growth");
    expect(wrapper.get(".sd-pagination").text()).toContain("1 / 2");
    expect(wrapper.get(".sd-product-name").text()).toContain("陶瓷马克杯套装");
  });

  it("opens product and chart details and connects the brief to AI operations", async () => {
    const wrapper = mountPage();
    await wrapper.get(".sd-product-name").trigger("click");
    expect(wrapper.get('[data-testid="modal"]').text()).toContain("商品经营详情");
    expect(wrapper.get('[data-testid="modal"]').text()).toContain("陶瓷马克杯套装");
    await button(wrapper, "查看优化建议").trigger("click");
    expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="drawer"]').text()).toContain("陶瓷马克杯套装：补充核心搜索词");
    await button(wrapper.get('[data-testid="drawer"]'), "关闭").trigger("click");
    wrapper.findComponent(StoreDashboardChart).vm.$emit("select", { name: "自然搜索", value: 1200 });
    await nextTick();
    expect(wrapper.get('[data-testid="modal"]').text()).toContain("1,200");
    await button(wrapper, "知道了").trigger("click");
    await button(wrapper, "经营简报").trigger("click");
    expect(wrapper.get('[data-testid="drawer"]').text()).toContain("最近 30 天");
    await button(wrapper, "前往 AI 运营").trigger("click");
    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false);
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe("AI 运营");
  });

  it("generates an emitted AI opportunity and returns its store-scoped completion to the child", async () => {
    const wrapper = mountPage();
    await button(wrapper, "AI 运营").trigger("click");
    const operations = wrapper.getComponent(StoreAiOperations);
    operations.vm.$emit("opportunity", opportunityData[0]);
    await nextTick();
    await button(wrapper, "模拟生成方案").trigger("click");
    expect(button(wrapper.get('[data-testid="drawer"]'), "关闭").attributes("disabled")).toBeDefined();
    await vi.advanceTimersByTimeAsync(850);
    expect(wrapper.findAll(".sd-execution .is-complete")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1700);
    expect(wrapper.get(".sd-generated-plan").text()).toContain("广告优化建议清单");
    expect(wrapper.get(".sd-generated-plan").text()).toContain("ceramic mug set");
    await button(wrapper, "完成").trigger("click");
    expect(operations.props("completedIds")).toEqual(["ads"]);
    operations.vm.$emit("opportunity", opportunityData[0]);
    await nextTick();
    expect(wrapper.find(".sd-result").exists()).toBe(true);
    expect(wrapper.findAll("button").some((item) => item.text() === "模拟生成方案")).toBe(false);
    await button(wrapper, "完成").trigger("click");
    await wrapper.get('[aria-label="选择店铺"]').setValue("home");
    expect(operations.props("completedIds")).toEqual([]);
    await wrapper.get('[aria-label="选择店铺"]').setValue("all");
    expect(operations.props("completedIds")).toEqual(["ads"]);
  });

  it("routes AI report and inspection events to readable, correctly formatted overlays", async () => {
    const wrapper = mountPage();
    await button(wrapper, "AI 运营").trigger("click");
    const operations = wrapper.getComponent(StoreAiOperations);
    operations.vm.$emit("report");
    await nextTick();
    expect(wrapper.get('[data-testid="drawer"]').text()).toContain("经营简报");
    await button(wrapper.get('[data-testid="drawer"]'), "关闭").trigger("click");
    operations.vm.$emit("inspect", { name: "商品详情", value: 3.84, formattedValue: "3.84%", seriesName: "转化率" });
    await nextTick();
    const modal = wrapper.get('[data-testid="modal"]');
    expect(modal.text()).toContain("商品详情 · 转化率");
    expect(modal.text()).toContain("3.84%");
  });

  it("renders a scenario's own generated sections through the local analysis flow", async () => {
    const wrapper = mountPage();
    await button(wrapper, "AI 运营").trigger("click");
    const operations = wrapper.getComponent(StoreAiOperations);
    operations.vm.$emit("opportunity", storeAiScenes.find((scene) => scene.id === "competitors")!.opportunity);
    await nextTick();
    expect(wrapper.get('[data-testid="drawer"]').text()).toContain("从竞品变化中找到差异化表达");
    await button(wrapper, "模拟生成方案").trigger("click");
    await vi.advanceTimersByTimeAsync(2550);
    expect(wrapper.get(".sd-generated-plan").text()).toContain("明确优势");
    expect(wrapper.get(".sd-generated-plan").text()).toContain("不因一次调价直接启动跟价");
    expect(operations.props("completedIds")).toEqual(["scene-competitors"]);
  });

  it("opens the selected growth-chart product and never renders a sparkle icon", async () => {
    const wrapper = mountPage();
    const chart = wrapper.findAllComponents(StoreDashboardChart).find((item) => item.props("kind") === "productGrowth");
    expect(chart).toBeDefined();
    chart!.vm.$emit("select", { name: "柔软亲肤浴巾", value: 11.5 });
    await nextTick();
    expect(wrapper.get('[data-testid="modal"]').text()).toContain("柔软亲肤浴巾");
    expect(wrapper.find(".lucide-sparkles").exists()).toBe(false);
    await button(wrapper, "查看优化建议").trigger("click");
    expect(wrapper.find(".lucide-sparkles").exists()).toBe(false);
  });

  it("keeps a selected towel's identity and improvement plan through simulation", async () => {
    const wrapper = mountPage();
    await wrapper.get('[aria-label="搜索商品"]').setValue("浴巾");
    await wrapper.get(".sd-product-name").trigger("click");
    expect(wrapper.get('[data-testid="modal"]').text()).toContain("柔软亲肤浴巾");
    await button(wrapper, "查看优化建议").trigger("click");
    const drawer = wrapper.get('[data-testid="drawer"]');
    expect(drawer.text()).toContain("柔软亲肤浴巾：提炼评论卖点");
    expect(drawer.text()).not.toContain("陶瓷");
    expect(drawer.text()).toContain("吸水性");
    await button(drawer, "模拟生成方案").trigger("click");
    await vi.advanceTimersByTimeAsync(2550);
    expect(wrapper.get(".sd-result").text()).toContain("柔软亲肤浴巾");
    expect(wrapper.get(".sd-generated-plan").text()).toContain("柔软亲肤浴巾 · 优化方案");
    expect(wrapper.get(".sd-generated-plan").text()).toContain("洗护说明");
    expect(wrapper.get(".sd-generated-plan").text()).not.toContain("ceramic");
    await button(wrapper, "完成").trigger("click");
    await wrapper.get(".sd-product-action").trigger("click");
    expect(wrapper.get(".sd-generated-plan").text()).toContain("柔软亲肤浴巾 · 优化方案");
    expect(wrapper.findAll("button").some((item) => item.text() === "模拟生成方案")).toBe(false);
  });

  it.each([
    ["empty", "这个时段还没有经营数据", "恢复演示数据"],
    ["error", "数据暂时未能加载", "重新加载"],
    ["denied", "当前店铺暂不可查看", "恢复演示数据"],
  ])("offers recovery from the %s preview without network work", async (state, title, recovery) => {
    const wrapper = mountPage();
    await wrapper.get('[aria-label="演示页面状态"]').setValue(state);
    expect(wrapper.get(".sd-state h2").text()).toBe(title);
    expect(wrapper.find(".sd-overview-grid").exists()).toBe(false);
    await button(wrapper, recovery).trigger("click");
    expect(wrapper.get('[role="tabpanel"]').attributes("aria-busy")).toBe("true");
    expect(wrapper.get(".sd-loading").text()).toContain("正在更新演示数据");
    expect(wrapper.get('[aria-label="刷新演示数据"]').attributes("disabled")).toBeDefined();
    await vi.advanceTimersByTimeAsync(650);
    expect(wrapper.get('[role="tabpanel"]').attributes("aria-busy")).toBe("false");
    expect(wrapper.find(".sd-overview-grid").exists()).toBe(true);
    expect(wrapper.get('[role="status"]').text()).toContain("演示数据已更新");
  });

  it("has no serious or critical static accessibility violations in either tab", async () => {
    vi.useRealTimers();
    const wrapper = mountPage();
    for (const label of ["经营总览", "AI 运营"]) {
      await button(wrapper, label).trigger("click");
      const results = await axe.run(wrapper.get(".store-dashboard").element, { rules: { region: { enabled: false } } });
      expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
    }
  });
});
