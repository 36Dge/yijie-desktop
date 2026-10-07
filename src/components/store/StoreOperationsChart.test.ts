// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EChartsOption } from "echarts";
import StoreOperationsChart from "./StoreOperationsChart.vue";

const mocks = vi.hoisted(() => {
  const instance = {
    dispose: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn<(option: EChartsOption, settings: unknown) => void>(),
    dispatchAction: vi.fn(),
    on: vi.fn<(event: string, listener: (event: { dataIndex: number; seriesIndex?: number }) => void) => void>(),
  };
  return { instance, init: vi.fn(() => instance), use: vi.fn(), removeMotionListener: vi.fn() };
});
vi.mock("echarts/core", () => ({ init: mocks.init, use: mocks.use }));

class ChartResizeObserver {
  static instances: ChartResizeObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor() { ChartResizeObserver.instances.push(this); }
}
const wrappers: ReturnType<typeof mount>[] = [];
function mountChart(props: InstanceType<typeof StoreOperationsChart>["$props"]) {
  const wrapper = mount(StoreOperationsChart, { attachTo: document.body, props });
  wrappers.push(wrapper);
  return wrapper;
}
function lastOption() {
  const option = mocks.instance.setOption.mock.lastCall?.[0];
  if (!option) throw new Error("Chart did not render");
  return option;
}
function chartClick(dataIndex: number, seriesIndex?: number) {
  const listener = mocks.instance.on.mock.calls.find(([event]) => event === "click")?.[1];
  if (!listener) throw new Error("No chart click handler");
  listener({ dataIndex, seriesIndex });
}

beforeEach(() => {
  vi.clearAllMocks();
  ChartResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", ChartResizeObserver);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: mocks.removeMotionListener }));
  document.documentElement.dataset.theme = "light";
  const tokens: Record<string, string> = {
    "--yj-color-brand-primary": "#c3f35b", "--yj-color-text-primary": "#27292a",
    "--yj-color-text-secondary": "#63696c", "--yj-color-border-default": "#dce0e2",
    "--yj-color-border-subtle": "#eceeed", "--yj-color-border-strong": "#c9cecb",
    "--yj-color-bg-elevated": "#ffffff", "--yj-color-bg-card": "#ffffff",
    "--yj-color-on-brand": "#25292a", "--yj-font-family-sans": "system-ui",
    "--yj-font-size-caption": "12px",
  };
  for (let index = 1; index <= 8; index++) tokens[`--yj-color-chart-series-${index}`] = "#64748b";
  for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(name, value);
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
  document.body.innerHTML = "";
});

describe("StoreOperationsChart", () => {
  it("keeps opportunity percentage and effort stable while scaling the estimated dollar value", async () => {
    const wrapper = mountChart({ kind: "opportunities", label: "增长机会分布", factor: 1, period: 30 });
    await flushPromises();
    expect(wrapper.get("caption").text()).toContain("最近 30 天");
    expect(wrapper.findAll("thead th").map((cell) => cell.text())).toEqual(["增长机会", "预估提升", "投入时长", "预估价值（USD）"]);
    expect(wrapper.findAll("tbody tr")).toHaveLength(6);
    expect(wrapper.get("tbody tr").text()).toContain("US$ 1,280");
    await wrapper.setProps({ factor: 0.5, period: 7 });
    expect(wrapper.get("tbody tr").text()).toContain("US$ 640");
    expect(wrapper.get("tbody tr").text()).toContain("24%");
    expect(wrapper.get("tbody tr").text()).toContain("1.2 小时");
    expect(wrapper.get("caption").text()).toContain("最近 7 天");
    await wrapper.get("tbody button").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([{ name: "广告否词", value: 24, formattedValue: "24%", seriesName: "预估提升" }]);
    expect(lastOption().color).toEqual(["#c3f35b", "#27292a", "#c9cecb"]);
    expect(lastOption().animation).toBe(false);
  });

  it("keeps sentiment counts balanced and emits positive counts for the left-facing concern bars", async () => {
    const wrapper = mountChart({ kind: "sentiment", label: "客户声音", factor: 1 });
    await flushPromises();
    const total = () => wrapper.findAll("tbody tr").reduce((sum, row) => sum + row.findAll("td").slice(0, 3).reduce((count, cell) => count + Number(cell.text()), 0), 0);
    expect(total()).toBe(186);
    chartClick(0, 2);
    expect(wrapper.emitted("select")?.[0]).toEqual([{ name: "包装防护", value: 13, formattedValue: "13 条反馈", seriesName: "待改善反馈" }]);
    await wrapper.get("tbody button").trigger("click");
    expect(wrapper.emitted("select")?.[1]).toEqual([{ name: "包装防护", value: 23, formattedValue: "23 条反馈", seriesName: "主题反馈总量" }]);
    await wrapper.setProps({ factor: 0.1353333333 });
    expect(total()).toBe(25);
    expect(wrapper.get(".ops-chart__sr-only").text()).toContain("25 条演示反馈");
  });

  it("keeps coverage percentages independent of sales scale and prevents hiding every series", async () => {
    const wrapper = mountChart({ kind: "coverage", label: "能力覆盖", factor: 1 });
    await flushPromises();
    const table = wrapper.get("table").text();
    await wrapper.setProps({ factor: 0.15 });
    expect(wrapper.get("table").text()).toBe(table);
    const legend = wrapper.get('[aria-label="切换覆盖率对比系列"]').findAll("button");
    await legend[0].trigger("click");
    expect(legend[0].attributes("aria-pressed")).toBe("false");
    await legend[1].trigger("click");
    expect(legend[1].attributes("aria-pressed")).toBe("true");
    expect(mocks.instance.dispatchAction).toHaveBeenCalledTimes(1);
    await wrapper.get("tbody button").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([{ name: "商品内容", value: 92, formattedValue: "92%", seriesName: "当前覆盖" }]);
    chartClick(1);
    expect(wrapper.emitted("select")?.[1]).toEqual([{ name: "接入前基线", value: 54, formattedValue: "54%", seriesName: "平均运营覆盖率" }]);
  });

  it("uses supplied spark values without rescaling and announces the last observation's unit", async () => {
    const wrapper = mountChart({ kind: "spark", label: "转化率", metric: "conversion", factor: 0.27, period: 7, sparkValues: [2.8, 3.1, 3.84], sparkUnit: "%" });
    await flushPromises();
    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.get(".ops-chart__sr-only").text()).toContain("3.84%");
    const series = lastOption().series;
    expect(Array.isArray(series) ? series[0]?.data : undefined).toEqual([2.8, 3.1, 3.84]);
    await wrapper.setProps({ factor: 3 });
    expect(wrapper.get(".ops-chart__sr-only").text()).toContain("3.84%");
    chartClick(0);
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("updates the existing chart and releases observers, motion listeners and renderer on normal unmount", async () => {
    const wrapper = mountChart({ kind: "sentiment", label: "客户声音" });
    await flushPromises();
    expect(mocks.init).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ period: 90, factor: 3 });
    expect(mocks.instance.setOption).toHaveBeenCalledTimes(2);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(mocks.instance.dispose).toHaveBeenCalledTimes(1);
    expect(ChartResizeObserver.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(mocks.removeMotionListener).toHaveBeenCalledOnce();
  });
});
