// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import StorePage from "./StorePage.vue";

function mountPage() {
  return mount(StorePage, { attachTo: document.body });
}

function tablist(wrapper: ReturnType<typeof mountPage>, label: string) {
  return wrapper.get(`[role="tablist"][aria-label="${label}"]`);
}

async function selectTab(
  wrapper: ReturnType<typeof mountPage>,
  listLabel: string,
  tabLabel: string,
): Promise<void> {
  const tab = tablist(wrapper, listLabel)
    .findAll('[role="tab"]')
    .find((candidate) => candidate.text().trim() === tabLabel);
  if (!tab) throw new Error(`Tab not found: ${listLabel} / ${tabLabel}`);
  await tab.trigger("click");
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("StorePage", () => {
  it("FEAT-150 renders the three required modules and explicit synthetic-data boundary", () => {
    const wrapper = mountPage();

    expect(wrapper.get("h1").text()).toBe("我的店铺");
    expect(wrapper.findAll("h2").map((heading) => heading.text())).toEqual([
      "经营快报",
      "精选场景",
      "角色场景推荐",
    ]);
    expect(wrapper.text()).toContain("本页指标、趋势和场景热度均为本地合成内容");
    expect(wrapper.text()).toContain("无店铺数据连接");
  });

  it("FEAT-150 exposes all 18 reference states with the approved defaults", () => {
    const wrapper = mountPage();
    const briefTabs = tablist(wrapper, "经营快报类型").findAll('[role="tab"]');
    const curatedTabs = tablist(wrapper, "精选场景筛选").findAll('[role="tab"]');
    const roleTabs = tablist(wrapper, "角色场景筛选").findAll('[role="tab"]');

    expect(briefTabs).toHaveLength(3);
    expect(curatedTabs).toHaveLength(9);
    expect(roleTabs).toHaveLength(6);
    expect([...briefTabs, ...curatedTabs, ...roleTabs]).toHaveLength(18);
    expect(briefTabs.find((tab) => tab.attributes("aria-selected") === "true")?.text())
      .toBe("近 7 天销售战报");
    expect(curatedTabs.find((tab) => tab.attributes("aria-selected") === "true")?.text())
      .toBe("全部");
    expect(roleTabs.find((tab) => tab.attributes("aria-selected") === "true")?.text())
      .toBe("全部");
    expect(curatedTabs.map((tab) => tab.text())).toContain("防差评");
    expect(curatedTabs.map((tab) => tab.text()).includes("放差评")).toBe(false);

    for (const panelId of ["store-brief-panel", "store-curated-panel", "store-role-panel"]) {
      const panel = wrapper.get(`#${panelId}`);
      const selectedTab = wrapper.get(`[role="tab"][aria-controls="${panelId}"][aria-selected="true"]`);
      expect(panel.attributes("role")).toBe("tabpanel");
      expect(panel.attributes("aria-labelledby")).toBe(selectedTab.attributes("id"));
    }
  });

  it("FEAT-150 switches to genuine advertising and FBA metric sets", async () => {
    const wrapper = mountPage();

    expect(wrapper.findAll(".yj-metric-card")).toHaveLength(5);
    expect(wrapper.text()).toContain("销售额");

    await selectTab(wrapper, "经营快报类型", "近 7 天店铺广告");
    expect(wrapper.findAll(".yj-metric-card")).toHaveLength(5);
    expect(wrapper.text()).toContain("广告销售额");
    expect(wrapper.text()).toContain("ACOS");
    expect(wrapper.text()).not.toContain("销量增长最快的 ASIN");

    await selectTab(wrapper, "经营快报类型", "FBA 库存总览");
    expect(wrapper.findAll(".yj-metric-card")).toHaveLength(5);
    expect(wrapper.text()).toContain("可售库存");
    expect(wrapper.text()).toContain("在途库存");
  });

  it("FEAT-150 filters curated and role scenarios independently", async () => {
    const wrapper = mountPage();

    await selectTab(wrapper, "精选场景筛选", "防差评");
    expect(wrapper.text()).toContain("30天差评归因");
    expect(wrapper.text()).toContain("店铺Feedback诊断");
    expect(wrapper.text()).not.toContain("广告位商机市场景分析");

    await selectTab(wrapper, "角色场景筛选", "供应链");
    expect(wrapper.text()).toContain("FBA丢损索赔建议");
    expect(wrapper.text()).toContain("看FBA促销清仓");
    expect(tablist(wrapper, "精选场景筛选").get('[role="tab"][aria-selected="true"]').text())
      .toBe("防差评");
  });

  it("FEAT-150 omits every excluded or fake action", () => {
    const wrapper = mountPage();

    for (const excluded of [
      "多端同步",
      "立即授权",
      "需授权",
      "查看全部场景",
      "立即体验",
    ]) {
      expect(wrapper.text()).not.toContain(excluded);
    }
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find('[aria-label*="分页"]').exists()).toBe(false);
    expect(wrapper.findAll("button").every((button) => button.attributes("role") === "tab"))
      .toBe(true);
    expect(wrapper.findAll(".store-scene-card a")).toHaveLength(0);
    expect(wrapper.findAll(".store-scene-card button")).toHaveLength(0);
  });

  it("FEAT-150 has no serious or critical accessibility violations", async () => {
    const wrapper = mountPage();
    const results = await axe.run(wrapper.element, {
      rules: { region: { enabled: false } },
    });

    expect(results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    )).toEqual([]);
  });
});
