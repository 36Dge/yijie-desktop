// @vitest-environment happy-dom

import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifactReportChartModel } from "../../domain/chat-artifact-report-chart";

const mocks = vi.hoisted(() => {
  const instance = {
    clear: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn(),
  };
  return {
    init: vi.fn(() => instance),
    instance,
    use: vi.fn(),
  };
});

vi.mock("echarts/core", () => ({ init: mocks.init, use: mocks.use }));
vi.mock("echarts/charts", () => ({ BarChart: {}, LineChart: {}, PieChart: {} }));
vi.mock("echarts/components", () => ({ AriaComponent: {}, GridComponent: {}, TooltipComponent: {} }));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

import YjChartCard from "./YjChartCard.vue";

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const model = createArtifactReportChartModel({
  ordinal: 0,
  id: "synthetic-chart",
  type: "chart",
  required: false,
  truncated: false,
  title: "季度订单",
  chartType: "bar",
  labels: ["Q1", "Q2"],
  series: [{ ordinal: 0, name: "订单", values: [12, 18] }],
  aligned: true,
});

function assertSafeStructure(value: unknown): void {
  if (typeof value === "function") throw new Error("function is forbidden");
  if (typeof value === "string" && /(?:https?:|data:|javascript:|formatter)/i.test(value)) {
    throw new Error("URL or formatter is forbidden");
  }
  if (Array.isArray(value)) {
    value.forEach(assertSafeStructure);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (/formatter/i.test(key)) throw new Error("formatter key is forbidden");
      assertSafeStructure(nested);
    }
  }
}

beforeEach(() => {
  TestResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  mocks.init.mockClear();
  mocks.instance.clear.mockClear();
  mocks.instance.dispose.mockClear();
  mocks.instance.resize.mockClear();
  mocks.instance.setOption.mockClear();
  document.documentElement.dataset.theme = "light";
  const tokens: Record<string, string> = {
    "--yj-color-text-primary": "#18230f",
    "--yj-color-text-secondary": "#526046",
    "--yj-color-bg-elevated": "#ffffff",
    "--yj-color-border-default": "#d6dec8",
    "--yj-color-border-subtle": "#e6ecdd",
    "--yj-font-family-sans": "system-ui",
    "--yj-color-chart-series-1": "#6b8e23",
    "--yj-color-chart-series-2": "#356bea",
    "--yj-color-chart-series-3": "#0e7490",
    "--yj-color-chart-series-4": "#7c3aed",
    "--yj-color-chart-series-5": "#b45309",
    "--yj-color-chart-series-6": "#c2410c",
    "--yj-color-chart-series-7": "#dc2626",
    "--yj-color-chart-series-8": "#475569",
  };
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, value);
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
});

describe("YjChartCard", () => {
  it("owns one Canvas chart with a closed safe option, HTML legend and visible table", async () => {
    const wrapper = mount(YjChartCard, { attachTo: document.body, props: { model } });
    await flushPromises();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.instance.setOption).toHaveBeenCalledTimes(1);
    const option = mocks.instance.setOption.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(option).sort()).toEqual([
      "animation", "aria", "backgroundColor", "color", "grid", "series", "tooltip", "xAxis", "yAxis",
    ]);
    expect(option.animation).toBe(false);
    expect(() => assertSafeStructure(option)).not.toThrow();
    expect(wrapper.get("[data-testid='yj-chart-legend']").text()).toContain("订单");
    expect(wrapper.get("table").isVisible()).toBe(true);
    expect(wrapper.get("[data-testid='yj-chart-canvas']").attributes("tabindex")).toBeUndefined();
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();
  });

  it("clears, disposes and disconnects on model change, theme change and unmount", async () => {
    const wrapper = mount(YjChartCard, { attachTo: document.body, props: { model } });
    await flushPromises();
    const firstObserver = TestResizeObserver.instances[0];

    await wrapper.setProps({ model: createArtifactReportChartModel({
      ordinal: 1,
      id: "second",
      type: "chart",
      required: false,
      truncated: false,
      title: "趋势",
      chartType: "line",
      labels: ["A"],
      series: [{ ordinal: 0, name: "值", values: [1] }],
      aligned: true,
    }) });
    await flushPromises();
    expect(mocks.instance.clear).toHaveBeenCalled();
    expect(mocks.instance.dispose).toHaveBeenCalled();
    expect(firstObserver?.disconnect).toHaveBeenCalled();

    document.documentElement.dataset.theme = "dark";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.init.mock.calls.length).toBeGreaterThanOrEqual(3);

    wrapper.unmount();
    expect(TestResizeObserver.instances[TestResizeObserver.instances.length - 1]?.disconnect).toHaveBeenCalled();
  });

  it("isolates resize/init failures to the current card and retains its authoritative table", async () => {
    const wrapper = mount(YjChartCard, { attachTo: document.body, props: { model } });
    await flushPromises();
    mocks.instance.resize.mockImplementationOnce(() => { throw new Error("synthetic resize failure"); });
    TestResizeObserver.instances[0]?.fire();
    await flushPromises();

    expect(wrapper.get("[data-testid='yj-chart-fallback']").text()).toContain("表格");
    expect(wrapper.get("table").text()).toContain("Q1");
    expect(wrapper.text()).not.toContain("synthetic resize failure");
    wrapper.unmount();

    mocks.init.mockImplementationOnce(() => { throw new Error("synthetic init failure"); });
    const initFailure = mount(YjChartCard, { attachTo: document.body, props: { model } });
    await flushPromises();
    expect(initFailure.get("[data-testid='yj-chart-fallback']").text()).toContain("表格");
    expect(initFailure.get("table").text()).toContain("Q1");
    expect(initFailure.text()).not.toContain("synthetic init failure");
    initFailure.unmount();
  });
});
