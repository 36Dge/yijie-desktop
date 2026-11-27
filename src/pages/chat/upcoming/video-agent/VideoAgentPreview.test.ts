// @vitest-environment happy-dom
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive, ref, toRaw } from "vue";
import { NMessageProvider } from "naive-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import UpcomingTaskPreview from "../UpcomingTaskPreview.vue";
import AgentConfigDialog from "../agent/AgentConfigDialog.vue";
import { describeConfig } from "../agent/presentation";
import type { HomeCommerceTask } from "../commerce-tasks";
import { configureVideoDirection, newVideoAgentState, videoDemoConfig, type VideoConfig } from "./draft";
import { videoScenes } from "./scenes";

const toast = "新版服务未接通真实服务，请切到已发布版本";
let view: VueWrapper | undefined;
afterEach(() => { view?.unmount(); view = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("upcoming video agent", () => {
  it.each(Object.values(videoScenes))("applies the $label sample and its actual input, placement and output settings", scene => {
    const config = videoDemoConfig(scene.id);
    const summary = describeConfig(config);
    const primary = scene.id === "motion" ? "起始图" : "商品图";
    expect(summary.primary).toBe(primary);
    expect(summary.missing).toEqual([]);
    expect(config.materials[primary]?.[0]?.src).toBe(scene.input.src);
    expect(config.materials.参考视频?.[0]?.src).toBe(scene.reference?.src);
    expect(config.materials.参考视频?.[0]?.poster).toBe(scene.reference?.poster);
    expect(summary.directionLabel).toBe(scene.label + " · 生成视频");
    expect(summary.settingsLabel).toBe((scene.id === "replicate" ? 15 : 10) + "秒 · 9:16 · 音频开");
    expect([config.platform, config.market, config.language]).toEqual(["TikTok", "美国站", "英语"]);
  });

  it("returns focus and the two replica inputs to the local draft and only shows a toast on send", async () => {
    const state = ref(newVideoAgentState());
    const text = ref("保留商品特写");
    const task = ref<HomeCommerceTask>("video");
    const fetch = vi.spyOn(window, "fetch");
    view = mount(defineComponent({ setup: () => () => h(NMessageProvider, null, { default: () => h(UpcomingTaskPreview, {
      text: text.value, task: task.value, videoState: state.value,
      "onUpdate:videoState": value => { state.value = value; },
      "onUpdate:task": value => { task.value = value; },
    }) }) }), { attachTo: document.body });
    const gallery = view.get(".video-scenes");
    expect(gallery.find("h2").exists()).toBe(false);
    expect(gallery.findAll(".sample")).toHaveLength(6);
    expect(gallery.find("video").exists()).toBe(false);
    for (const scene of Object.values(videoScenes)) {
      const images = gallery.get(`[data-scene="${scene.id}"]`).findAll(".cover-frame img").map(image => image.attributes("src"));
      expect(images).toEqual(scene.cover.map(frame => frame.src));
      expect(new Set(images).size).toBeGreaterThan(1);
      expect(scene.cover.filter(frame => frame.kind !== "image").length).toBeGreaterThanOrEqual(2);
    }
    expect(view.find(".video-prompt").exists()).toBe(false);
    await gallery.get('button[aria-label="查看复刻爆款示例"]').trigger("click");
    expect(gallery.get("video[controls]").attributes("src")).toBe(videoScenes.replicate.result.src);
    await gallery.get('button[aria-label="播放宽腿裤爆款穿搭参考视频"]').trigger("click");
    await flushPromises();
    const material = new DOMWrapper(document.querySelector<HTMLElement>(".video-material")!);
    expect(material.get("video[controls]").attributes("src")).toBe(videoScenes.replicate.reference!.src);
    await material.get('button[aria-label="关闭素材预览"]').trigger("click");
    expect(state.value.config).toBeNull();
    await gallery.get(".scene-use").trigger("click");
    await flushPromises();
    expect(state.value.config?.materials.参考视频).toHaveLength(1);
    expect(view.get(".video-prompt").text()).toContain("15秒 · 9:16 · 音频开");
    expect(view.get("textarea").element.value).toBe(text.value);
    expect(document.activeElement).toBe(view.get("textarea").element);
    await gallery.get(".scene-gallery__back").trigger("click");
    await gallery.get('button[aria-label="查看图转视频示例"]').trigger("click");
    expect(state.value.config?.direction).toBe("replicate");
    expect(view.get(".video-prompt").text()).toContain("复刻爆款");
    await view.get("form").trigger("submit");
    await flushPromises();
    expect(document.body.textContent).toContain(toast);
    await view.get('input[value="image"]').setValue();
    expect(view.find(".video-scenes").exists()).toBe(false);
    expect(view.find(".video-prompt").exists()).toBe(false);
    await view.get('input[value="video"]').setValue();
    expect(view.get(".video-prompt").text()).toContain("复刻爆款");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("edits duration, aspect ratio, audio and targeting on a separate draft until confirmation", async () => {
    const initial = videoDemoConfig("replicate");
    view = mount(AgentConfigDialog, { props: { config: initial, section: "settings" }, attachTo: document.body });
    await flushPromises();
    const dialog = new DOMWrapper(document.querySelector<HTMLElement>(".agent-config")!);
    const seconds = dialog.get('input[aria-label="视频时长"]');
    expect(dialog.get('button[aria-label="增加视频时长"]').attributes("disabled")).toBeDefined();
    await seconds.setValue("4");
    expect(dialog.get('button[aria-label="缩短视频时长"]').attributes("disabled")).toBeDefined();
    await dialog.get('button[aria-label="增加视频时长"]').trigger("click");
    await dialog.findAll(".video-ratios button").find(item => item.text().startsWith("16:9"))!.trigger("click");
    await dialog.get('input[aria-label="生成音频"]').setValue(false);
    await dialog.get('select[aria-label="目标站点"]').setValue("日本站");
    expect(initial.duration).toBe(15);
    expect(initial.generateAudio).toBe(true);
    await dialog.get("footer button").trigger("click");
    const [saved] = view.emitted<[VideoConfig]>("confirm")![0]!;
    expect([saved.duration, saved.ratio, saved.generateAudio, saved.language]).toEqual([5, "16:9", false, "日语"]);
  });

  it("can reopen an edited product-to-start-image configuration and keeps both material slots independent", () => {
    const draft = reactive(videoDemoConfig("seeding"));
    configureVideoDirection(draft, "motion");
    const reopened = structuredClone(toRaw(draft));
    expect(reopened.materials.起始图?.[0]?.src).toBe(videoScenes.seeding.input.src);
    draft.materials.起始图![0]!.name = "新起始图";
    expect(draft.materials.商品图![0]!.name).toBe(videoScenes.seeding.input.name);
  });
});
