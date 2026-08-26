// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreScene } from "../../domain/store-showcase";
import StoreSceneCard from "./StoreSceneCard.vue";

const scene: StoreScene = {
  id: "listing-conversion-check",
  title: "Listing 转化健康诊断",
  description: "从内容完整度与流量承接角度梳理值得优先检查的展示项。",
  badges: ["精品", "热门"],
  demoPopularity: 12800,
  curatedFilters: ["improve-conversion", "health-check"],
  roleFilters: ["store-owner", "operations-specialist"],
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("StoreSceneCard", () => {
  it("renders the typed scene as a semantic, non-clickable article", () => {
    const wrapper = mount(StoreSceneCard, { props: { scene } });
    const article = wrapper.get("article");

    expect(article.attributes("aria-labelledby")).toBe(wrapper.get("h3").attributes("id"));
    expect(article.attributes("aria-describedby")).toBe(
      wrapper.get(".store-scene-card__description").attributes("id"),
    );
    expect(wrapper.get("[aria-label='场景标签']").element.tagName).toBe("UL");
    expect(wrapper.findAll(".store-scene-card__badge").map((badge) => badge.text()))
      .toEqual(["精品", "热门"]);
    expect(wrapper.text()).toContain("Listing 转化健康诊断");
    expect(wrapper.text()).toContain("从内容完整度与流量承接角度");
    expect(wrapper.get(".store-scene-card__meta").text()).toBe("演示热度 · 12,800");
    expect(wrapper.find("button").exists()).toBe(false);
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("授权");
  });

  it("does not expose internal filter keys as user-facing metadata", () => {
    const wrapper = mount(StoreSceneCard, { props: { scene } });

    expect(wrapper.text()).not.toContain("improve-conversion");
    expect(wrapper.text()).not.toContain("store-owner");
  });

  it("omits the tag list when the scene has no badges", () => {
    const wrapper = mount(StoreSceneCard, {
      props: { scene: { ...scene, badges: [] } },
    });

    expect(wrapper.find("[aria-label='场景标签']").exists()).toBe(false);
    expect(wrapper.text()).toContain(scene.title);
  });

  it("has no serious or critical accessibility violations", async () => {
    const wrapper = mount(StoreSceneCard, {
      attachTo: document.body,
      props: { scene },
    });
    const results = await axe.run(wrapper.element, {
      rules: { region: { enabled: false } },
    });

    expect(results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    )).toEqual([]);
  });
});
