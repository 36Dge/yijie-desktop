// @vitest-environment happy-dom
import { mount, flushPromises } from "@vue/test-utils";
import { NMessageProvider } from "naive-ui";
import { defineComponent, h, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import UpcomingTaskPreview from "../UpcomingTaskPreview.vue";
import type { HomeCommerceTask } from "../commerce-tasks";
import { amazonReport } from "./amazon-report";
import { tiktokReport } from "./tiktok-report";
import { hasListingReport, listingScenes } from "./scenes";

describe("listing platform examples", () => {
  it("maps the six assigned products and limits report entry to Amazon and TK", () => {
    expect(listingScenes.map(s => s.productId)).toEqual(["B07QC4GG7R","1729471516161183979","B0H5J9QCKP","B0CCQMLB55","B0FZGW3MY5","B0F1K7WWPM"]);
    expect(listingScenes.filter(hasListingReport).map(s => s.id)).toEqual(["amazon","tk"]);
    expect(new Set(listingScenes.flatMap(s => s.photos.map(p => p.src))).size).toBe(12);
    expect(amazonReport.sections.map(s => s.id)).toEqual(["copy","visuals","traffic","reviews","strategy"]);
    expect(tiktokReport.sections.map(s => s.id)).toEqual(["basics","market","search","assessment","actions","conclusion"]);
  });

  it("opens both illustrated reports from the composer, navigates chapters and returns focus to the originating card", async () => {
    const task = ref<HomeCommerceTask>("image");
    const text = ref("继续编辑我的商品文案");
    const root = mount(defineComponent({ setup: () => () => h(NMessageProvider, null, { default: () => h(UpcomingTaskPreview, {
      task: task.value, text: text.value, "onUpdate:task": value => { task.value = value; }, "onUpdate:text": value => { text.value = value; },
    }) }) }), { attachTo: document.body, global: { stubs: { ListingChart: true } } });
    try {
      await root.get('input[value="listing"]').setValue();
      const grid = root.get(".listing-scenes");
      expect(root.get(".upcoming-task__composer").element.nextElementSibling).toBe(grid.element);
      expect(grid.findAll(".sample__title strong").map(n => n.text())).toEqual(listingScenes.map(s => s.label));
      expect(grid.findAll(".sample:disabled")).toHaveLength(4);
      for (const [id, report] of [["amazon", amazonReport], ["tk", tiktokReport]] as const) {
        const button = `button[data-scene="${id}"]`;
        await grid.get(button).trigger("click");
        await vi.waitFor(() => expect(grid.find(".listing-report h2").exists()).toBe(true)); await flushPromises();
        expect(grid.get(".listing-report h2").text()).toBe(report.name);
        expect(grid.get(".report-dateline").text()).toContain("示例数据");
        expect(grid.findAll(".report-section").map(n => n.get("h3").text())).toEqual(report.sections.map(s => s.title));
        const last = grid.findAll(".report-contents a").slice(-1)[0]!;
        await last.trigger("click");
        expect(document.activeElement?.textContent).toBe(report.sections[report.sections.length-1].title);
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        await grid.get(".copy-title").trigger("click"); await flushPromises();
        expect(writeText).toHaveBeenCalledWith(grid.get(".new-title p").text());
        expect(grid.get(".copy-status").text()).toBe("标题已复制");
        vi.unstubAllGlobals();
        await grid.get(".scene-gallery__back").trigger("click");
        expect(document.activeElement).toBe(grid.get(button).element);
      }
      await root.get('input[value="compliance"]').setValue();
      expect(root.find(".listing-scenes").exists()).toBe(false);
      expect(root.get<HTMLTextAreaElement>(".upcoming-task__composer textarea").element.value).toBe(text.value);
    } finally { vi.unstubAllGlobals(); root.unmount(); document.body.innerHTML = ""; }
  });

  it("keeps charts, sources and illustrative calculations consistent with their explanatory tables", () => {
    const all = [amazonReport, tiktokReport].flatMap(r => r.sections.flatMap(s => s.blocks));
    const charts = all.flatMap(b => b.type === "charts" ? b.charts : b.type === "chart" ? [b] : []);
    expect(new Set(charts.map(c => c.kind))).toEqual(new Set(["bar","line","pie"]));
    const distribution = charts.find(c => c.title === "按搜索意图归因")!;
    expect(distribution.points.reduce((sum,[,v]) => sum+v,0)).toBe(100);
    expect(charts.find(c => c.title === "样本起售价分布")!.points.reduce((sum,[,v]) => sum+v,0)).toBe(5);
    expect(charts.find(c => c.title === "一周销售观察示例")!.points.reduce((sum,[,v]) => sum+v,0)).toBe(11121);
    expect(charts.every(c => c.points.length>0 && c.points.every(([name,num]) => !!name && Number.isFinite(num)))).toBe(true);
  });
});
