// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { NMessageProvider } from "naive-ui";
import { defineComponent, h, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import UpcomingTaskPreview from "../UpcomingTaskPreview.vue";
import type { HomeCommerceTask } from "../commerce-tasks";
import { newContacts, outcomes } from "./campaign";

let root: VueWrapper | undefined;
afterEach(() => { root?.unmount(); root = undefined; document.body.innerHTML = ""; vi.unstubAllGlobals(); });
function openPage() {
  const task = ref<HomeCommerceTask>("outreach");
  const text = ref("保留我的合作条件");
  root = mount(defineComponent({ setup: () => () => h(NMessageProvider, null, { default: () => h(UpcomingTaskPreview, {
    task: task.value, text: text.value, "onUpdate:task": value => { task.value = value; },
    "onUpdate:text": value => { text.value = value; },
  }) }) }), { attachTo: document.body });
  return root;
}
const contact = (id: string) => `[data-person="${id}"]`;
const openCase = (app: VueWrapper) => app.get(".case-toggle").trigger("click");

describe("creator outreach preview", () => {
  it("leads with four illustrated functions and discloses the campaign only when requested", async () => {
    const app = openPage();
    const showcase = app.get(".outreach-showcase");
    expect(app.get(".upcoming-task__composer").element.nextElementSibling).toBe(showcase.element);
    expect(showcase.get("h2").text()).toBe("达人建联");
    expect(showcase.findAll(".feature-copy h3").map(h => h.text())).toEqual(["筛选达人", "合作邀约", "寄样跟进", "效果复盘"]);
    expect(showcase.findAll(".feature-art")).toHaveLength(4);
    expect(showcase.find(".scene-gallery, .sample, .outreach-workspace, video").exists()).toBe(false);
    expect(showcase.get(".case-example").element.previousElementSibling).toBe(showcase.get(".feature-story").element);
    for (const link of showcase.findAll(".feature-index a")) {
      await link.trigger("click");
      expect(document.activeElement?.textContent).toBe(link.text());
    }
    const toggle = showcase.get(".case-toggle");
    await openCase(app);
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(showcase.get(".outreach-workspace").findAll("h2")).toHaveLength(0);
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(showcase.find(".creator-list").exists()).toBe(false);
    expect(document.activeElement).toBe(toggle.element);
  });

  it("lets readers compare works, invitation languages and returns without changing case records", async () => {
    const app = openPage(), showcase = app.get(".outreach-showcase");
    const switches = (key: string) => showcase.get(`[data-feature="${key}"]`).findAll(".art-switch button");
    const firstCovers = showcase.findAll(".work-pair img").map(img => img.attributes("src"));
    await switches("discover")[1].trigger("click");
    expect(showcase.findAll(".work-pair img").map(img => img.attributes("src"))).not.toEqual(firstCovers);
    expect(switches("discover")[1].attributes("aria-pressed")).toBe("true");
    await switches("invite")[1].trigger("click");
    expect(showcase.get(".letter-sheet blockquote").attributes("lang")).toBe("zh-CN");
    expect(showcase.get(".letter-sheet blockquote").text()).toContain("陶杯");
    expect(showcase.get(".review-ratio strong").text()).toBe("3.0×");
    await switches("review")[1].trigger("click");
    expect(showcase.get(".review-ratio strong").text()).toBe("4.0×");
    expect(showcase.get(".review-statement").text()).toContain("$1,680");
    expect(showcase.get(".ring-label").text()).toContain("$420");
    expect(showcase.get(".cost-key").text()).toContain("$252");
    expect(showcase.find(".outreach-workspace").exists()).toBe(false);
    await openCase(app);
    expect(showcase.get(".results-ledger").text()).toContain("5.09×");
  });

  it("keeps the case filters and primary action in sync", async () => {
    const app = openPage();
    await openCase(app);
    const page = app.get(".outreach-workspace");
    expect(page.findAll(".creator-row")).toHaveLength(5);
    const topic = page.get('[aria-label="筛选内容方向"]'), phase = page.get('[aria-label="筛选合作进度"]');
    await topic.setValue("日常收纳"); await phase.setValue("sampled");
    expect(page.findAll(".creator-row")).toHaveLength(0);
    await page.get(".empty-list button").trigger("click");
    expect(page.findAll(".creator-row")).toHaveLength(5);
    await topic.setValue("包袋测评"); await phase.setValue("invited");
    await page.get(".campaign-action").trigger("click"); await flushPromises();
    expect(page.get(contact("morgan") + " .creator-row").attributes("aria-expanded")).toBe("true");
    expect(page.get(".editor-top label").text()).toBe("跟进草稿");
    expect((topic.element as HTMLSelectElement).value).toBe("包袋测评");
    await page.get(".record-button").trigger("click"); await flushPromises();
    expect(page.find(".empty-list").exists()).toBe(true);
    expect(document.activeElement).toBe(phase.element);
    expect(page.get(".directory-notice").text()).toContain("待寄样");
  });

  it("keeps editable, copyable language drafts independent of other people, templates and the main prompt", async () => {
    const app = openPage();
    await openCase(app);
    const workspace = () => app.get(".outreach-workspace");
    await workspace().get(".campaign-action").trigger("click");
    const editor = () => workspace().get<HTMLTextAreaElement>(".contact-detail textarea");
    await editor().setValue("");
    expect(workspace().get(".record-button").attributes("disabled")).toBeDefined();
    await editor().setValue("Hi Jules, try the tote with your navy blazer.");
    await workspace().get('[aria-label="草稿语言"]').setValue("zh");
    expect(editor().element.value).toContain("成交佣金");
    await editor().setValue("Jules，想看看你背上这件样品的效果。");
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await workspace().get(".copy-button").trigger("click"); await flushPromises();
    expect(writeText).toHaveBeenCalledWith("Jules，想看看你背上这件样品的效果。");
    vi.unstubAllGlobals();
    await app.get('input[value="listing"]').setValue();
    expect(app.find(".outreach-workspace").exists()).toBe(false);
    await app.get('input[value="outreach"]').setValue();
    expect(app.find(".outreach-workspace").exists()).toBe(false);
    await openCase(app);
    await workspace().get(contact("morgan") + " .creator-row").trigger("click");
    expect(editor().element.value).toContain("Hi Morgan");
    await workspace().get(contact("jules") + " .creator-row").trigger("click");
    expect(editor().element.value).toBe("Hi Jules, try the tote with your navy blazer.");
    await workspace().get(".record-button").trigger("click");
    expect(editor().element.value).toContain("following up");
    expect(workspace().get(".contact-history").text()).toContain("navy blazer");
    expect(app.get<HTMLTextAreaElement>(".upcoming-task__composer textarea").element.value).toBe("保留我的合作条件");
  });

  it("records each milestone and updates reply, sample spend and attributed sales from the same contacts", async () => {
    const app = openPage();
    await openCase(app);
    const page = app.get(".outreach-workspace"), creator = page.get(contact("jules"));
    expect(page.get(".results-ledger").text()).toContain("75%");
    expect(page.get(".results-ledger").text()).toContain("$1,296");
    await creator.get(".creator-row").trigger("click");
    for (const label of ["待回复", "待寄样", "待发布", "已发布"]) {
      await creator.get(".record-button").trigger("click"); await flushPromises();
      expect(creator.get(".row-stage").text()).toBe(label);
    }
    expect(creator.findAll(".contact-history li")).toHaveLength(4);
    expect(page.get(".cost-breakdown").text()).toContain("3 件 × $30");
    expect(page.get(".results-ledger").text()).toContain("已归因 1 / 2 条内容");
    const input = creator.get(".order-form input");
    await input.setValue("-1");
    expect(creator.get(".record-button").attributes("disabled")).toBeDefined();
    await input.setValue("6"); await creator.get(".order-form").trigger("submit");
    expect(page.get(".results-ledger").text()).toContain("$1,620");
    expect(page.get(".results-ledger").text()).toContain("30 单");
    expect(page.get(".results-ledger").text()).toContain("4.86×");
    expect(page.get(".results-ledger").text()).toContain("$333");
    expect(page.get(".results-ledger").text()).toContain("已归因 2 / 2 条内容");
  });

  it("keeps the cutoff between pending attribution and a measured zero, and handles a fresh empty list", () => {
    expect(outcomes([])).toMatchObject({ replied: 0, cost: 0, replyRate: "—", returnRatio: "—", attributed: 0 });
    const people = newContacts();
    expect(outcomes(people)).toMatchObject({ samples: 6000, commission: 19440, revenue: 129600, attributed: 1 });
    const published = people.find(p => p.attributedOrders !== undefined)!;
    delete published.attributedOrders;
    expect(outcomes(people)).toMatchObject({ published: 1, attributed: 0, returnRatio: "—" });
    published.attributedOrders = 0;
    expect(outcomes(people)).toMatchObject({ revenue: 0, attributed: 1, returnRatio: "0.00×" });
    expect(outcomes(newContacts()).orders).toBe(24);
  });
});
