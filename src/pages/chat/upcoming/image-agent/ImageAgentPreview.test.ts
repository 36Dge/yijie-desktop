// @vitest-environment happy-dom
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { NMessageProvider } from "naive-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import UpcomingTaskPreview from "../UpcomingTaskPreview.vue";
import AgentConfigDialog from "../agent/AgentConfigDialog.vue";
import { demoConfig, missingSlots, newImageAgentState, outputCount, type ImageConfig } from "./draft";
import { imageScenes, type SceneId } from "./scenes";
import type { HomeCommerceTask } from "../commerce-tasks";

let view: VueWrapper | undefined;
afterEach(() => { view?.unmount(); view = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("upcoming image agent", () => {
  it.each(Object.values(imageScenes))("applies the original $label inputs and example output count", scene => {
    const config = demoConfig(scene.id, null);
    expect(config.direction).toBe(scene.id);
    expect(config.product.name).toBe(scene.product.name);
    expect(missingSlots(config)).toEqual([]);
    expect(scene.materials.map(m => m.src)).toEqual(scene.input.images.map(i => i.src));
    for (const image of [...scene.input.images, ...scene.result.images]) {
      expect(image.thumbnail).toBeTruthy();
      expect(image.thumbnail).not.toBe(image.src);
    }
    expect(outputCount(config)).toBe(scene.id === "suite" ? 4 : scene.id === "aplus" ? 2 : 1);
    expect([config.platform, config.market, config.language]).toEqual(["亚马逊", "美国站", "英语"]);
  });

  it("browses examples separately from the applied draft and returns focus to the prompt on apply", async () => {
    const state = ref(newImageAgentState());
    const text = ref("保留构图说明");
    const task = ref<HomeCommerceTask>("image");
    view = mount(defineComponent({ setup: () => () => h(NMessageProvider, null, { default: () => h(UpcomingTaskPreview, {
      text: text.value, task: task.value, imageState: state.value,
      "onUpdate:imageState": value => { state.value = value; },
      "onUpdate:task": value => { task.value = value; },
    }) }) }), { attachTo: document.body });
    const fetch = vi.spyOn(window, "fetch");
    const gallery = view.get(".image-scenes");
    expect(gallery.find("h2").exists()).toBe(false);
    expect(gallery.findAll(".sample")).toHaveLength(6);
    await gallery.get('button[aria-label="查看白底主图示例"]').trigger("click");
    expect(view.find(".image-prompt").exists()).toBe(false);
    await gallery.get(".scene-use").trigger("click");
    await flushPromises();
    expect(state.value.config?.product.name).toBe("蓝色格纹宽檐防晒帽");
    expect(view.get("textarea").element.value).toBe(text.value);
    expect(document.activeElement).toBe(view.get("textarea").element);
    expect(view.get(".image-prompt").text()).toContain("1张 · 自适应");
    await gallery.get(".scene-gallery__back").trigger("click");
    await gallery.get('button[aria-label="查看A+ 图示例"]').trigger("click");
    await gallery.findAll(".result-picker button")[1]!.trigger("click");
    expect(gallery.get(".scene-asset img").attributes("src")).toBe(imageScenes.aplus.result.images[1]!.src);
    expect(state.value.config?.direction).toBe("white");
    expect(state.value.config?.product.name).toBe("蓝色格纹宽檐防晒帽");
    await gallery.get(".scene-gallery__back").trigger("click");
    expect(document.activeElement).toBe(gallery.get('button[aria-label="查看A+ 图示例"]').element);
    await view.get('input[value="video"]').setValue();
    expect(view.find(".image-scenes").exists()).toBe(false);
    expect(view.find(".image-prompt").exists()).toBe(false);
    await view.get('input[value="image"]').setValue();
    expect(view.get(".image-prompt").text()).toContain("白底主图");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("edits a draft transactionally and requires both images for product replacement", async () => {
    const base = demoConfig("white", null);
    view = mount(AgentConfigDialog, { props: { config: base, section: "settings" }, attachTo: document.body });
    await flushPromises();
    const dialog = new DOMWrapper(document.querySelector<HTMLElement>(".agent-config")!);
    await dialog.get('button[aria-label="增加生成数量"]').trigger("click");
    expect(base.sizes.white.count).toBe(1);
    const replace = dialog.findAll(".agent-directions button").find(btn => btn.text() === "商品替换")!;
    await replace.trigger("click");
    expect(dialog.get("footer button").attributes("disabled")).toBeDefined();
    expect(dialog.get("footer").text()).toContain("参考图");
    await dialog.findAll(".agent-directions button").find(btn => btn.text() === "白底主图")!.trigger("click");
    await dialog.get("footer button").trigger("click");
    const saved = view.emitted("confirm")![0]![0] as ImageConfig;
    expect(saved.sizes.white.count).toBe(2);
    expect(base.sizes.white.count).toBe(1);
  });

  it("counts only enabled suite outputs and keeps each direction's settings independent", () => {
    const suite = demoConfig("suite", null);
    suite.suite.outputs.mobileAPlus = { enabled: true, count: 2 };
    expect(outputCount(suite)).toBe(6);
    suite.suite.advanced = false;
    expect(outputCount(suite)).toBe(4);
    suite.suite.aPlus = false;
    expect(outputCount(suite)).toBe(3);
    const next = demoConfig("model", suite);
    next.suite.outputs.white.count++;
    expect(suite.suite.outputs.white.count).toBe(1);
    const sourceFiles = Object.keys(imageScenes).flatMap(id => {
      const scene = imageScenes[id as SceneId]; return [...scene.input.images, ...scene.result.images].map(image => image.src);
    });
    expect(new Set(sourceFiles).size).toBe(17);
  });
});
