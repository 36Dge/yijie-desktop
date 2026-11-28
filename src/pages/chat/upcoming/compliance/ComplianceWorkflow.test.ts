// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { NMessageProvider } from "naive-ui";
import { afterEach, describe, expect, it } from "vitest";
import UpcomingTaskPreview from "../UpcomingTaskPreview.vue";
import type { HomeCommerceTask } from "../commerce-tasks";
import { draftIssue, makeDraft, recordFromDraft } from "./manual";
import { complianceScenes } from "./scenes";

const expected = [
  ["外观专利", "B0GRK9KZ2P"], ["发明专利", "B0FCSW4DNS"], ["图形商标", "B0G67KHJ47"],
  ["文本商标", "B07WP389M9"], ["政策合规", "B00O9MZ1UY"], ["版权", "B0H2DCF4M2"],
];
let view: VueWrapper | undefined;
afterEach(() => { view?.unmount(); view = undefined; document.body.innerHTML = ""; });

function mountPreview() {
  const task = ref<HomeCommerceTask>("compliance");
  const text = ref("保留原有任务草稿");
  view = mount(defineComponent({ setup: () => () => h(NMessageProvider, null, { default: () => h(UpcomingTaskPreview, {
    task: task.value, text: text.value, "onUpdate:task": value => { task.value = value; },
    "onUpdate:text": value => { text.value = value; },
  }) }) }), { attachTo: document.body });
  return view;
}

describe("manual compliance examples", () => {
  it("opens the six ASINs in order beneath the composer, with only manual entry", async () => {
    const app = mountPreview();
    const gallery = app.get(".compliance-scenes");
    expect(app.get(".upcoming-task__composer").element.nextElementSibling).toBe(gallery.element);
    expect(complianceScenes.map(s => [s.label, s.asin])).toEqual(expected);
    expect(gallery.findAll(".sample__title strong").map(n => n.text())).toEqual(expected.map(x => x[0]));
    expect(gallery.find("h2").exists()).toBe(false);
    for (const scene of complianceScenes) {
      const selector = `button[data-scene="${scene.id}"]`;
      expect(gallery.get(selector).get("img").attributes("src")).toContain(scene.asin);
      await gallery.get(selector).trigger("click");
      expect(gallery.get("h2").text()).toBe(scene.label + "检测");
      expect(gallery.text()).toContain(scene.asin);
      expect(gallery.text()).not.toMatch(/雷达|上传产品链接/);
      expect(gallery.find('input[type="url"]').exists()).toBe(false);
      expect(gallery.find('input[type="file"]').exists()).toBe(scene.id !== "word");
      expect(gallery.find("textarea").exists()).toBe(!!scene.listing);
      expect(gallery.get(".start-check").attributes("disabled")).toBeUndefined();
      await gallery.get(".manual-form").trigger("submit");
      await flushPromises();
      const record = gallery.get(".record");
      expect(record.element.hasAttribute("open")).toBe(true);
      expect(record.text()).toContain("待复核");
      expect(record.findAll(".review-point").length).toBeGreaterThan(1);
      await gallery.get(".scene-gallery__back").trigger("click");
      expect(document.activeElement).toBe(gallery.get(selector).element);
    }
    expect(app.get<HTMLTextAreaElement>(".upcoming-task__composer textarea").element.value).toBe("保留原有任务草稿");
  });

  it("validates the fields that belong to each reference form", () => {
    for (const scene of complianceScenes) {
      const draft = makeDraft(scene, true);
      expect(draftIssue(scene, draft)).toBe("");
      if (scene.target) {
        const targets = draft.targets;
        draft.targets = []; expect(draftIssue(scene, draft)).toContain("请选择");
        draft.targets = targets;
      }
      if (scene.listing) {
        const title = draft.title;
        draft.title = "日常商品";
        expect(draftIssue(scene, draft)).toBe(scene.id === "policy" ? "" : "请使用英文填写产品标题与描述");
        draft.title = "こんにちは";
        expect(draftIssue(scene, draft)).toContain("填写产品标题");
        draft.title = title;
        draft.description = ""; expect(draftIssue(scene, draft)).toContain("产品描述");
        draft.description = "a".repeat(scene.listing.descriptionLimit + 1);
        expect(draftIssue(scene, draft)).toContain("字数上限");
        draft.description = "A product description.";
      }
      draft.image = null;
      expect(!!draftIssue(scene, draft)).toBe(["appearance", "graphic", "copyright"].includes(scene.id));
      if (scene.id === "invention") {
        draft.extended = true; expect(draftIssue(scene, draft)).toContain("参考图");
      }
      expect(draftIssue(scene, makeDraft(scene, false))).toBeTruthy();
    }
  });

  it("keeps record snapshots, search and manual review statuses separate across examples and tabs", async () => {
    const app = mountPreview();
    const gallery = () => app.get(".compliance-scenes");
    const open = (id: string) => gallery().get(`button[data-scene="${id}"]`).trigger("click");
    await open("word");
    const form = gallery().get(".manual-form");
    await form.get('input[placeholder="输入产品 SKU 编号"]').setValue("POTTY-7");
    await form.get("select").setValue("示例品牌关注词库");
    await form.trigger("submit"); await flushPromises();
    expect(gallery().get(".record").text()).toContain("文案中出现了 BabyBjörn");
    await form.get('input[placeholder="输入产品 SKU 编号"]').setValue("CHANGED");
    expect(gallery().get(".record").text()).not.toContain("CHANGED");
    await gallery().get(".review-filter select").setValue("已复核");
    expect(gallery().find(".record").exists()).toBe(false);
    await gallery().get(".review-filter select").setValue("全部");
    for (const box of gallery().findAll(".review-point input")) await box.setValue(true);
    expect(gallery().get(".record-status").text()).toBe("已复核");
    await gallery().get(".search-field input").setValue("another SKU");
    expect(gallery().find(".record").exists()).toBe(false);
    await gallery().get(".search-field input").setValue("potty-7");
    expect(gallery().find(".record").exists()).toBe(true);
    await gallery().get(".scene-gallery__back").trigger("click");
    await open("copyright");
    expect(gallery().find(".record").exists()).toBe(false);
    await app.get('input[value="video"]').setValue();
    await app.get('input[value="compliance"]').setValue();
    await open("word");
    expect(gallery().get(".record-status").text()).toBe("已复核");
  });

  it("reflects the submitted scan scope, site features and optional recognition in the review plan", () => {
    for (const id of ["copyright", "invention", "policy"] as const) {
      const scene = complianceScenes.find(s => s.id === id)!;
      const draft = makeDraft(scene, true);
      draft.extended = true; draft.features = "净含量"; draft.targets = ["Amazon · 德国站"];
      const record = recordFromDraft(scene, draft, 1);
      const text = record.points.map(point => point.title + point.note).join(" ");
      expect(text).toContain({ copyright: "全网扫描范围", invention: "智能识别复核", policy: "净含量" }[id]);
      if (id === "policy") expect(record.fields).toContainEqual({ label: "上架平台与站点", value: "Amazon · 德国站" });
      expect(record.reviewed).toEqual([]);
    }
  });
});
