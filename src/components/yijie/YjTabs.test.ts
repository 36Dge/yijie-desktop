// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import YjTabs from "./YjTabs.vue";

const items = [
  { key: "sales", label: "近 7 天销售战报" },
  { key: "ads", label: "近 7 天店铺广告" },
  { key: "inventory", label: "FBA 库存总览" },
] as const;

function mountTabs(modelValue = "sales") {
  return mount(YjTabs, {
    attachTo: document.body,
    props: {
      ariaLabel: "经营快报范围",
      items,
      modelValue,
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("YjTabs", () => {
  it("exposes a single-select tablist and emits its string key on selection", async () => {
    const wrapper = mountTabs();
    const tablist = wrapper.get("[role='tablist']");
    const tabs = wrapper.findAll("[role='tab']");

    expect(tablist.attributes("aria-label")).toBe("经营快报范围");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]!.attributes("aria-selected")).toBe("true");
    expect(tabs[0]!.attributes("tabindex")).toBe("0");
    expect(tabs[1]!.attributes("aria-selected")).toBe("false");
    expect(tabs[1]!.attributes("tabindex")).toBe("-1");

    await tabs[1]!.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([["ads"]]);
  });

  it("links every tab to the supplied panel with stable ids", () => {
    const wrapper = mount(YjTabs, {
      props: {
        ariaLabel: "经营快报范围",
        items,
        modelValue: "sales",
        panelId: "store-brief-panel",
      },
    });
    const tabs = wrapper.findAll("[role='tab']");

    expect(tabs.map((tab) => tab.attributes("aria-controls"))).toEqual([
      "store-brief-panel",
      "store-brief-panel",
      "store-brief-panel",
    ]);
    expect(tabs.map((tab) => tab.attributes("id"))).toEqual([
      "store-brief-panel-tab-sales",
      "store-brief-panel-tab-ads",
      "store-brief-panel-tab-inventory",
    ]);
  });

  it.each([
    ["ArrowRight", 0, "ads", 1],
    ["ArrowLeft", 0, "inventory", 2],
    ["Home", 2, "sales", 0],
    ["End", 0, "inventory", 2],
  ])("handles %s with automatic activation", async (key, from, expectedKey, expectedFocus) => {
    const wrapper = mountTabs(items[from]!.key);
    const tabs = wrapper.findAll<HTMLButtonElement>("[role='tab']");
    tabs[from]!.element.focus();

    await tabs[from]!.trigger("keydown", { key });

    expect(wrapper.emitted("update:modelValue")).toEqual([[expectedKey]]);
    expect(document.activeElement).toBe(tabs[expectedFocus]!.element);
  });

  it("wraps ArrowRight from the final tab to the first tab", async () => {
    const wrapper = mountTabs("inventory");
    const tabs = wrapper.findAll<HTMLButtonElement>("[role='tab']");

    await tabs[2]!.trigger("keydown", { key: "ArrowRight" });

    expect(wrapper.emitted("update:modelValue")).toEqual([["sales"]]);
    expect(document.activeElement).toBe(tabs[0]!.element);
  });

  it("does not emit when the selected tab is clicked", async () => {
    const wrapper = mountTabs();

    await wrapper.get("[role='tab']").trigger("click");

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("has no serious or critical accessibility violations", async () => {
    const wrapper = mountTabs();
    const results = await axe.run(wrapper.element, {
      rules: { region: { enabled: false } },
    });

    expect(results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    )).toEqual([]);
  });
});
