// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import YjMetricCard from "./YjMetricCard.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("YjMetricCard", () => {
  it("renders a labelled value, unit, supporting text, and explicit trend", () => {
    const wrapper = mount(YjMetricCard, {
      props: {
        label: "销售额",
        value: "¥126,480",
        unit: "人民币",
        supportingText: "过去 7 天 · 演示数据",
        trend: {
          direction: "up",
          value: "较前 7 天 12.4%",
          tone: "success",
        },
      },
    });

    expect(wrapper.get("article").attributes("aria-labelledby")).toBe(
      wrapper.get("h3").attributes("id"),
    );
    expect(wrapper.text()).toContain("销售额");
    expect(wrapper.text()).toContain("¥126,480");
    expect(wrapper.text()).toContain("人民币");
    expect(wrapper.text()).toContain("过去 7 天 · 演示数据");
    expect(wrapper.get(".yj-metric-card__trend").attributes("aria-label"))
      .toBe("趋势上升，较前 7 天 12.4%");
    expect(wrapper.get(".yj-metric-card__trend").classes())
      .toContain("yj-metric-card__trend--success");
  });

  it("renders zero and safely replaces an empty string with an em dash", async () => {
    const wrapper = mount(YjMetricCard, {
      props: { label: "缺货商品", value: 0, unit: "个" },
    });

    expect(wrapper.text()).toContain("0");
    expect(wrapper.text()).toContain("个");

    await wrapper.setProps({ value: "" });
    expect(wrapper.text()).toContain("—");
    expect(wrapper.find(".yj-metric-card__unit").exists()).toBe(false);
  });

  it("is display-only", () => {
    const wrapper = mount(YjMetricCard, {
      props: { label: "广告订单", value: 214, unit: "单" },
    });

    expect(wrapper.find("button").exists()).toBe(false);
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.find("input").exists()).toBe(false);
  });

  it("has no serious or critical accessibility violations", async () => {
    const wrapper = mount(YjMetricCard, {
      attachTo: document.body,
      props: {
        label: "库存健康度",
        value: 88,
        unit: "分",
        supportingText: "FBA 库存总览 · 演示数据",
        trend: { direction: "flat", value: "较昨日持平" },
      },
    });
    const results = await axe.run(wrapper.element, {
      rules: { region: { enabled: false } },
    });

    expect(results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    )).toEqual([]);
  });
});
