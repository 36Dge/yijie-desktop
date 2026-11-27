// @vitest-environment happy-dom
import { mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { NMessageProvider } from "naive-ui";
import { afterEach, describe, expect, it } from "vitest";
import UpcomingTaskPreview from "../UpcomingTaskPreview.vue";
import type { HomeCommerceTask } from "../commerce-tasks";
import SelectionWorkflow from "./SelectionWorkflow.vue";
import { products, selectionScenes } from "./examples";
import { publishingHandoff, workflowFor, type SelectionMode } from "./workflow";

let view: VueWrapper | undefined;
afterEach(() => { view?.unmount(); view = undefined; document.body.innerHTML = ""; });

const expectedPaths = {
  full: "opportunity pool filter demand competition definition sourcing inquiry targets logistics profit screening",
  follow: "pool filter competition sourcing targets logistics profit screening",
  bulk: "opportunity pool filter targets logistics profit screening",
  curated: "pool filter demand competition sourcing inquiry targets logistics profit screening",
  boutique: "opportunity pool filter demand competition sourcing inquiry targets logistics profit screening",
  develop: "opportunity pool demand competition definition sourcing inquiry targets logistics profit screening",
} as const;
function openWorkflow(mode: SelectionMode) {
  view = mount(SelectionWorkflow, { props: { scene: selectionScenes.find(s => s.id === mode)! }, attachTo: document.body });
  return view;
}
const next = (step: Pick<DOMWrapper<Element>, "get">) => step.get(".step-actions button").trigger("click");

describe("upcoming product selection examples", () => {
  it.each([
    ["full", "sweater", 8], ["follow", "hat", 5], ["bulk", "shoe", 10],
    ["curated", "bottle", 6], ["boutique", "gown", 3], ["develop", "headphone", 4],
  ] as const)("uses the designated product category throughout the %s example", (mode, category, count) => {
    const scene = selectionScenes.find(item => item.id === mode)!;
    const photos = scene.products.map(id => products[id].image);
    expect(photos).toHaveLength(count);
    expect(photos.every(Boolean)).toBe(true);
    expect(new Set(photos).size).toBe(count);
    expect(scene.products.every(id => id.startsWith(category))).toBe(true);
    for (const panel of scene.cover) {
      if (!("photos" in panel)) continue;
      for (const id of panel.photos) {
        expect(scene.products).toContain(id);
        if (panel.closeup) {
          expect(products[id].detailImage).toBeTruthy();
          expect(products[id].detailImage).not.toBe(products[id].image);
        }
      }
    }
  });

  it.each(selectionScenes)("uses the reference path for $label and keeps publishing downstream", scene => {
    const steps = workflowFor(scene.id);
    expect(steps.map(step => step.id)).toEqual(expectedPaths[scene.id].split(" "));
    for (const step of steps) {
      expect(step.checks.length).toBeGreaterThan(0);
      expect(step.purpose).toBeTruthy();
      expect(step.output).toBeTruthy();
    }
    expect(publishingHandoff.map(node => node.title)).toEqual(["商品信息优化", "智能定价", "合规终审", "发布"]);
  });

  it("opens all six examples from the sourcing tab, restores tile focus and preserves the composer draft", async () => {
    const task = ref<HomeCommerceTask>("listing");
    const text = ref("保留我的目标市场和预算");
    view = mount(defineComponent({ setup: () => () => h(NMessageProvider, null, { default: () => h(UpcomingTaskPreview, {
      task: task.value, text: text.value, "onUpdate:task": value => { task.value = value; },
      "onUpdate:text": value => { text.value = value; },
    }) }) }), { attachTo: document.body });
    expect(view.find(".selection-scenes").exists()).toBe(false);
    await view.get('input[value="sourcing"]').setValue();
    const grid = view.get(".selection-scenes");
    expect(grid.findAll(".sample__title strong").map(item => item.text())).toEqual(["全量", "跟卖", "铺货", "精铺", "精品", "开品"]);
    for (const scene of selectionScenes) {
      const selector = `button[aria-label="查看${scene.label}示例"]`;
      await grid.get(selector).trigger("click");
      expect(grid.get(".workflow-heading h2").text()).toBe(scene.label + "选品流程");
      expect(grid.findAll("[data-step]").map(step => step.attributes("data-step"))).toEqual(expectedPaths[scene.id].split(" "));
      await grid.get(".scene-gallery__back").trigger("click");
      expect(document.activeElement).toBe(grid.get(selector).element);
    }
    await view.get('input[value="video"]').setValue();
    expect(view.find(".selection-scenes").exists()).toBe(false);
    expect(view.get("textarea").element.value).toBe(text.value);
  });

  it("expands the sample inventory and requires a candidate before advancing", async () => {
    const workflow = openWorkflow("bulk");
    const pool = workflow.get('[data-step="pool"]');
    const candidates = selectionScenes.find(scene => scene.id === "bulk")!.products;
    const last = candidates[candidates.length - 1];
    expect(pool.findAll('input[type="checkbox"]')).toHaveLength(4);
    await pool.get(`input[value="${candidates[0]}"]`).setValue(false);
    expect(pool.get(".step-actions button").attributes("disabled")).toBeDefined();
    await pool.get(".more-choices").trigger("click");
    expect(pool.findAll('input[type="checkbox"]')).toHaveLength(10);
    await pool.get(`input[value="${last}"]`).setValue(true);
    await pool.get(".more-choices").trigger("click");
    await next(pool);
    expect(workflow.get('[data-step="filter"]').text()).toContain(products[last].name);
    expect(workflow.find('[data-step="sourcing"]').exists()).toBe(false);
  });

  it("matches each selected product, tracks site branches independently and reopens affected decisions after an edit", async () => {
    const workflow = openWorkflow("follow");
    const step = (id: string) => workflow.get(`[data-step="${id}"]`);
    const second = selectionScenes.find(scene => scene.id === "follow")!.products[1];
    await step("pool").get(`input[value="${second}"]`).setValue(true);
    for (const id of ["pool", "filter", "competition"]) await next(step(id));
    const groups = step("sourcing").findAll(".source-choices");
    expect(groups).toHaveLength(2);
    await groups[0]!.get('input[value="small"]').setValue();
    expect(step("sourcing").get(".step-actions button").attributes("disabled")).toBeDefined();
    await groups[1]!.get('input[value="volume"]').setValue();
    await next(step("sourcing"));
    await next(step("targets"));
    await next(step("logistics"));
    expect(step("profit").get(".estimate").text()).toContain("结余 ¥28");
    await workflow.get(".site-switch button:nth-child(2)").trigger("click");
    expect(step("logistics").attributes("data-state")).toBe("current");
    await next(step("logistics"));
    expect(step("profit").get(".estimate").text()).toContain("结余 ¥22");
    await next(step("profit"));
    await next(step("screening"));
    expect(workflow.get('.site-switch button[aria-pressed="true"]').text()).toContain("TikTok");
    expect(step("profit").attributes("data-state")).toBe("current");
    await next(step("profit"));
    await next(step("screening"));
    expect(workflow.get(".workflow-complete").text()).toContain("2 款商品、2 个站点");

    await step("pool").get(".step-heading").trigger("click");
    await step("pool").get(`input[value="${second}"]`).setValue(false);
    expect(step("pool").attributes("data-state")).toBe("current");
    expect(step("profit").attributes("data-state")).toBe("waiting");
    expect(workflow.find(".workflow-complete").exists()).toBe(false);
  });
});
