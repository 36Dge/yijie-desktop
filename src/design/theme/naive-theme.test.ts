// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import { darkTheme, NButton, NCheckbox, NConfigProvider, NInput, NMenu, NSpin, NSwitch, NTag } from "naive-ui";
import { readFileSync } from "node:fs";

const variables = readFileSync("src/styles/variables.css", "utf8");
const componentColors = readFileSync("src/styles/component-colors.css", "utf8");
const mounted: VueWrapper[] = [];
import { createNaiveThemeOverrides } from "./naive-theme";
import { createArtifactReportEChartsTheme } from "./echarts-theme";

function themeReader(theme: "light" | "dark") {
  const style = document.createElement("style");
  style.dataset.colorThemeTest = "true";
  style.textContent = variables + componentColors;
  document.head.append(style);
  document.documentElement.dataset.theme = theme;
  return (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex.replace("#", "").match(/.{2}/g)!.map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  document.head.querySelectorAll("style[data-color-theme-test]").forEach((style) => style.remove());
  delete document.documentElement.dataset.theme;
});

describe("design 2.1 resolved component colors", () => {
  it.each(["light", "dark"] as const)("keeps primary controls and text readable in %s", (theme) => {
    const read = themeReader(theme);
    const overrides = createNaiveThemeOverrides(read);
    const button = overrides.Button!;
    const graphite = read("--yj-color-on-brand");
    expect(overrides.common?.primaryColor).toBe("#c3f35b");
    expect(JSON.stringify(overrides)).not.toContain("var(");
    expect(overrides.Card?.paddingMedium).toBe("20px");
    expect(overrides.Button?.heightMedium).toBe("36px");
    for (const foreground of [button.textColorPrimary, button.textColorHoverPrimary,
      button.textColorPressedPrimary, button.textColorFocusPrimary]) {
      expect(foreground).toBe(graphite);
      for (const fill of ["primary", "hover", "active"]) {
        expect(contrast(String(foreground), read(`--yj-color-brand-${fill}`))).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(button.textColorDisabledPrimary).toBe(read("--yj-color-text-disabled"));
    expect(button.colorDisabledPrimary).toBe(read("--yj-color-control-disabled-bg"));
    expect(button.opacityDisabled).toBe("1");
    for (const text of [button.textColorTextPrimary, button.textColorGhostPrimary]) {
      expect(contrast(String(text), read("--yj-color-bg-page"))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(String(overrides.Menu!.itemTextColorActive), read("--yj-color-bg-nav")))
      .toBeGreaterThanOrEqual(4.5);
    expect(overrides.Checkbox?.checkMarkColor).toBe(graphite);
    expect(overrides.Radio?.dotColorActive).toBe(graphite);
    expect(overrides.Switch?.buttonColor).toBe(graphite);
    expect(overrides.Pagination?.itemTextColorActive).toBe(graphite);
    expect(overrides.Tag?.textColorChecked).toBe(graphite);
    expect(contrast(read("--yj-color-focus-ring"), read("--yj-color-bg-page")))
      .toBeGreaterThanOrEqual(3);
    expect(read("--yj-color-text-on-accent")).toBe(graphite);
  });

  it.each(["light", "dark"] as const)("keeps chart lines and tooltip readable in %s", (theme) => {
    const read = themeReader(theme);
    const chart = createArtifactReportEChartsTheme(read);
    expect(chart.color[0]).toBe(theme === "light" ? "#4b651d" : "#c3f35b");
    expect(contrast(chart.color[0], read("--yj-color-bg-card"))).toBeGreaterThanOrEqual(3);
    expect(contrast(chart.tooltip.textStyle.color, chart.tooltip.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(chart.color).toHaveLength(8);
    expect(read("--yj-color-success")).toBe("#16a34a");
    expect(read("--yj-color-warning")).toBe("#d97706");
    expect(read("--yj-color-error")).toBe("#dc2626");
  });


  it.each(["light", "dark"] as const)("keeps actual shared controls neutral and preserves disabled choices in %s", async (theme) => {
    const read = themeReader(theme);
    const overrides = createNaiveThemeOverrides(read);
    const onSwitchChange = vi.fn();
    const wrapper = mount({
      render: () => h(NConfigProvider, {
        theme: theme === "dark" ? darkTheme : null,
        themeOverrides: overrides,
      }, { default: () => h("div", [
        h(NButton, { secondary: true, "data-testid": "secondary" }, { default: () => "查看详情" }),
        h(NButton, { type: "primary", loading: true, "data-testid": "loading-action" }, { default: () => "分析中" }),
        h(NInput, { value: "只读店铺", readonly: true, status: "error", "data-testid": "field" }),
        h(NMenu, { value: "store", options: [{ label: "店铺", key: "store" }], "data-testid": "menu" }),
        h(NCheckbox, { checked: true, "data-testid": "checkbox" }, { default: () => "包含广告数据" }),
        h(NSwitch, { value: true, disabled: true, "onUpdate:value": onSwitchChange, "data-testid": "disabled-switch" }),
        h(NTag, { checkable: true, checked: true, disabled: true, "data-testid": "disabled-tag" }, { default: () => "已选" }),
        h(NSpin, { show: true, "data-testid": "spin" }),
      ]) }),
    }, { attachTo: document.body });
    mounted.push(wrapper);
    const css = (id: string, key: string) => getComputedStyle(wrapper.get(`[data-testid="${id}"]`).element)
      .getPropertyValue(key).trim();
    expect(css("secondary", "--n-color")).toBe(read("--yj-color-bg-card"));
    expect(css("secondary", "--n-color-hover")).toBe(read("--yj-color-control-hover"));
    expect(css("secondary", "--n-text-color")).toBe(read("--yj-color-text-primary"));
    expect(css("loading-action", "--n-text-color")).toBe(read("--yj-color-on-brand"));
    expect(css("field", "--n-border")).toBe(`1px solid ${read("--yj-color-border-control")}`);
    expect(css("field", "--n-border-error")).toBe(`1px solid ${read("--yj-color-error")}`);
    expect(css("field", "--n-box-shadow-focus-error")).toBe(read("--yj-shadow-control-focus"));
    expect(wrapper.get<HTMLInputElement>("input").element.readOnly).toBe(true);
    expect(wrapper.get<HTMLInputElement>("input").element.value).toBe("只读店铺");
    expect(css("menu", "--n-item-color-active")).toBe(read("--yj-color-bg-nav"));
    expect(css("checkbox", "--n-check-mark-color")).toBe(read("--yj-color-on-brand"));
    expect(css("disabled-switch", "--n-rail-color-active")).toBe(read("--yj-color-control-disabled-bg"));
    expect(css("disabled-tag", "--n-color-checked")).toBe(read("--yj-color-control-disabled-bg"));
    expect(css("disabled-tag", "--n-text-color-checked")).toBe(read("--yj-color-text-disabled"));
    expect(wrapper.get('[data-testid="disabled-switch"]').attributes("aria-checked")).toBe("true");
    await wrapper.get('[data-testid="disabled-switch"]').trigger("click");
    expect(onSwitchChange).not.toHaveBeenCalled();
  });

  it.each(["light", "dark"] as const)("separates readable text, necessary boundaries and surface depth in %s", (theme) => {
    const read = themeReader(theme);
    const overrides = createNaiveThemeOverrides(read);
    for (const role of ["primary", "body", "secondary", "tertiary"]) {
      expect(contrast(read(`--yj-color-text-${role}`), read("--yj-color-bg-card"))).toBeGreaterThanOrEqual(4.5);
    }
    for (const status of ["success", "warning", "error", "info"]) {
      expect(contrast(read(`--yj-color-semantic-${status}-ink`), read("--yj-color-bg-card"))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(read("--yj-color-border-control"), read("--yj-color-bg-card"))).toBeGreaterThanOrEqual(3);
    expect(contrast(read("--yj-color-border-control-hover"), read("--yj-color-bg-elevated"))).toBeGreaterThanOrEqual(3);
    expect(read("--yj-focus-ring-width")).toBe("2px");
    expect(read("--yj-shadow-control-focus")).toBe(`0 0 0 2px ${read("--yj-color-focus-ring")}`);
    expect(read("--yj-shadow-xs")).toBe("none");
    expect(read("--yj-shadow-card")).toBe("none");
    expect(overrides.Popover?.boxShadow).toBe(read("--yj-shadow-popover"));
    expect(overrides.Spin?.color).toBe(read("--yj-color-text-primary"));
    expect(overrides.Input?.loadingColor).toBe(read("--yj-color-text-primary"));
    expect(read("--yj-color-text-selection-bg")).toBe(read("--yj-color-brand-primary"));
    expect(read("--yj-color-text-selection-ink")).toBe(read("--yj-color-on-brand"));
  });

  it("fails fast when a required design token is missing", () => {
    expect(() => createNaiveThemeOverrides(() => "")).toThrow(
      "Missing design token: --yj-font-family-sans",
    );
  });
});
