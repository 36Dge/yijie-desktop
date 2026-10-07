// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { opportunityData } from "../domain/store-dashboard";
import { useStoreDashboard } from "./useStoreDashboard";

const mounted: ReturnType<typeof mount>[] = [];
function setupDashboard() {
  let dashboard!: ReturnType<typeof useStoreDashboard>;
  const wrapper = mount(defineComponent({ setup() { dashboard = useStoreDashboard(); return () => null; } }));
  mounted.push(wrapper);
  return { dashboard, wrapper };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.useRealTimers();
});

describe("useStoreDashboard", () => {
  it.each(["query", "sort", "shop", "period"] as const)("resets pagination when %s changes", async (filter) => {
    const { dashboard } = setupDashboard();
    dashboard.page.value = 2;
    if (filter === "query") dashboard.query.value = "厨房";
    if (filter === "sort") dashboard.sort.value = "score";
    if (filter === "shop") dashboard.shop.value = "life";
    if (filter === "period") dashboard.period.value = 90;
    await nextTick();
    expect(dashboard.page.value).toBe(1);
    expect(dashboard.visibleProducts.value.length).toBeGreaterThan(0);
  });

  it("starts a single simulated execution and preserves completed results on reopening", async () => {
    const { dashboard } = setupDashboard();
    dashboard.runOpportunity();
    expect(vi.getTimerCount()).toBe(0);
    dashboard.openOpportunity(opportunityData[0]);
    dashboard.runOpportunity();
    dashboard.runOpportunity();
    expect(vi.getTimerCount()).toBe(1);
    dashboard.closeOpportunity();
    expect(dashboard.opportunity.value?.id).toBe("ads");
    await vi.advanceTimersByTimeAsync(2550);
    expect(dashboard.completedIds.value).toEqual(["ads"]);
    expect(dashboard.execution.value).toBe("done");
    expect(dashboard.executionStep.value).toBe(3);
    dashboard.closeOpportunity();
    dashboard.openOpportunity(opportunityData[0]);
    dashboard.runOpportunity();
    await vi.advanceTimersByTimeAsync(4000);
    expect(dashboard.completedIds.value).toEqual(["ads"]);
    expect(dashboard.execution.value).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets an explicitly selected preview state supersede a pending refresh", async () => {
    const { dashboard } = setupDashboard();
    dashboard.refresh();
    expect(dashboard.state.value).toBe("loading");
    dashboard.setState("empty");
    await vi.advanceTimersByTimeAsync(1000);
    expect(dashboard.state.value).toBe("empty");
    expect(dashboard.refreshed.value).toBe(false);
    expect(dashboard.toast.value).toBe("");
    dashboard.refresh();
    await vi.advanceTimersByTimeAsync(650);
    expect(dashboard.state.value).toBe("ready");
    expect(dashboard.refreshed.value).toBe(true);
    expect(dashboard.toast.value).toBe("演示数据已更新");
  });

  it("isolates generated plans by shop and restores a shop's session results when returning", async () => {
    const { dashboard } = setupDashboard();
    dashboard.shop.value = "home";
    await nextTick();
    dashboard.openOpportunity(opportunityData[0]);
    dashboard.runOpportunity();
    await vi.advanceTimersByTimeAsync(2550);
    expect(dashboard.completedIds.value).toEqual(["ads"]);

    dashboard.shop.value = "life";
    await nextTick();
    expect(dashboard.completedIds.value).toEqual([]);
    expect(dashboard.opportunity.value).toBeNull();
    expect(dashboard.execution.value).toBe("idle");
    expect(dashboard.executionStep.value).toBe(0);
    dashboard.openOpportunity(opportunityData[0]);
    expect(dashboard.execution.value).toBe("idle");
    dashboard.closeOpportunity();
    dashboard.openOpportunity(opportunityData[1]);
    dashboard.runOpportunity();
    await vi.advanceTimersByTimeAsync(2550);
    expect(dashboard.completedIds.value).toEqual(["listing"]);

    dashboard.shop.value = "home";
    await nextTick();
    expect(dashboard.completedIds.value).toEqual(["ads"]);
    dashboard.openOpportunity(opportunityData[0]);
    expect(dashboard.execution.value).toBe("done");
    expect(dashboard.executionStep.value).toBe(3);
    dashboard.period.value = 7;
    await nextTick();
    expect(dashboard.completedIds.value).toEqual(["ads"]);
    expect(dashboard.execution.value).toBe("done");

    dashboard.shop.value = "all";
    await nextTick();
    expect(dashboard.completedIds.value).toEqual([]);
  });

  it("dismisses an unstarted opportunity when switching shop", async () => {
    const { dashboard } = setupDashboard();
    dashboard.openOpportunity(opportunityData[2]);
    dashboard.shop.value = "studio";
    await nextTick();
    expect(dashboard.opportunity.value).toBeNull();
    expect(dashboard.execution.value).toBe("idle");
    expect(dashboard.executionStep.value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["empty", "error", "denied"] as const)("recovers %s with either scope filter and preserves the selected tab", async (state) => {
    const { dashboard } = setupDashboard();
    dashboard.tab.value = "ai";
    dashboard.setState(state);
    dashboard.shop.value = "home";
    await nextTick();
    expect(dashboard.state.value).toBe("ready");
    expect(dashboard.tab.value).toBe("ai");
    dashboard.setState(state);
    dashboard.period.value = 7;
    await nextTick();
    expect(dashboard.state.value).toBe("ready");
    expect(dashboard.tab.value).toBe("ai");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not interrupt a loading preview or pending refresh when the scope changes", async () => {
    const { dashboard } = setupDashboard();
    dashboard.setState("loading");
    dashboard.shop.value = "life";
    await nextTick();
    expect(dashboard.state.value).toBe("loading");
    dashboard.refresh();
    dashboard.period.value = 90;
    await nextTick();
    expect(dashboard.state.value).toBe("loading");
    await vi.advanceTimersByTimeAsync(650);
    expect(dashboard.state.value).toBe("ready");
  });

  it("keeps a newer notification visible for its full duration", async () => {
    const { dashboard } = setupDashboard();
    dashboard.notify("演示数据已更新");
    await vi.advanceTimersByTimeAsync(3000);
    dashboard.notify("方案已就绪");
    await vi.advanceTimersByTimeAsync(1000);
    expect(dashboard.toast.value).toBe("方案已就绪");
    await vi.advanceTimersByTimeAsync(2500);
    expect(dashboard.toast.value).toBe("");
  });

  it("cleans up refresh, notification and execution timers when leaving the page", async () => {
    const { dashboard, wrapper } = setupDashboard();
    dashboard.refresh();
    dashboard.notify("正在查看演示");
    dashboard.openOpportunity(opportunityData[1]);
    dashboard.runOpportunity();
    expect(vi.getTimerCount()).toBe(3);
    wrapper.unmount();
    mounted.splice(mounted.indexOf(wrapper), 1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(dashboard.completedIds.value).toEqual([]);
    expect(dashboard.executionStep.value).toBe(0);
    expect(dashboard.refreshed.value).toBe(false);
  });
});
