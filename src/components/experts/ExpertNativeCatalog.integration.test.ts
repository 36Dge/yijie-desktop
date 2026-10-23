// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { NConfigProvider, NDialogProvider } from "naive-ui";
import { defineComponent, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExpertNativeClient, expertNativeClient } from "../../api/expert-native-client";
import { useExpertSummon } from "../../composables/useExpertSummon";
import { expertShowcaseCatalog } from "../../data/expert-showcase-catalog";
import type { CatalogEntry, CatalogSnapshot } from "../../domain/experts.generated";
import { useChatComposerDraftStore } from "../../stores/chat-composer-drafts.store";
import { useChatExpertsStore } from "../../stores/chat-experts.store";
import { useExpertsStore } from "../../stores/experts.store";
import { expertEntry, expertTestId } from "../../test/expert-fixture";
import ExpertAvatar from "./ExpertAvatar.vue";
import ExpertMarketPanel from "./ExpertMarketPanel.vue";

// Normal Native response fixtures exercise the existing generated client and
// stores. They do not install packages, send model requests or claim native QA.
const integrated = [
  ["market-researcher", "行业研究员"],
  ["linkfox-expert-1688-sourcing-expert", "亚马逊1688找货源专家"],
  ["linkfox-expert-aigc-videogen-viral-replicate", "跨境电商爆款视频复刻专家"],
  ["linkfox-expert-aigc-imagegen-mannequin-to-model", "跨境电商服装人台换模特图专家"],
  ["chuhaijiang-tiktok-shop-operations-expert", "TikTok店铺运营专家"],
  ["tradebuddy-baojia", "NextB2B报价专家"],
  ["report-viz-expert", "数据报告可视化专家"],
  ["xiaohongshu-copywriter", "小红书爆款笔记策划"],
  ["agentgrid-comic-storyboard-director", "漫剧编剧与分镜师"],
  ["cross-border-ecommerce-operations-expert", "跨境电商运营专家"],
] as const;
const entries: CatalogEntry[] = [
  { ...expertEntry, display: { ...expertEntry.display, expertId: "jd-ops-expert", displayName: "资深电商运营操盘手" }, state: "ready" },
  ...integrated.map(([expertId, displayName]): CatalogEntry => ({
    ...expertEntry,
    display: { ...expertEntry.display, expertId, displayName },
    description: `${displayName}的原生目录说明`,
    quickPrompts: [`请按${displayName}的资料整理本次任务。`],
    state: "ready",
  })),
];
const snapshot = (experts = entries): CatalogSnapshot => ({ experts, canManage: true, executionAvailable: true });
const navigation = vi.hoisted(() => ({ route: { path: "/plugins", fullPath: "/plugins?tab=experts", query: {} }, push: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => navigation.route, useRouter: () => ({ push: navigation.push }) }));
let wrapper: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  setActivePinia(createPinia());
  navigation.route = reactive({ path: "/plugins", fullPath: "/plugins?tab=experts", query: {} });
  navigation.push.mockReset();
});
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function readyCatalog(data = snapshot()) {
  const store = useExpertsStore();
  store.scope = "test-scope"; store.contextId = expertTestId(1); store.snapshot = data;
  useChatExpertsStore().bind(expertTestId(1), "test-scope");
  return store;
}
function render() {
  const Content = defineComponent({
    components: { ExpertMarketPanel },
    setup: () => ({ summon: useExpertSummon(), expertShowcaseCatalog }),
    template: "<ExpertMarketPanel :showcase-entries='expertShowcaseCatalog' :selected-expert='summon.selected.value' :summon-busy='summon.busy.value' :summon-error='summon.error.value' @summon='summon.summon' />",
  });
  wrapper = mount(defineComponent({
    components: { NConfigProvider, NDialogProvider, Content },
    template: "<NConfigProvider><NDialogProvider><Content /></NDialogProvider></NConfigProvider>",
  }), { attachTo: document.body });
  return wrapper;
}

describe("ten adapted experts use the existing Native catalog and summon flow", () => {
  it("shows the original and ten integrated cards once, without display-only substitutes", () => {
    readyCatalog(); const view = render();
    expect(view.findAll(".expert-card")).toHaveLength(11);
    expect(view.findAll(".expert-showcase-card")).toHaveLength(0);
    expect(view.text()).toContain("11 位专家");
    for (const [, name] of integrated) {
      const card = view.get(`button[aria-label='查看 ${name} 详情']`);
      expect(card.find("img").exists()).toBe(true);
      expect(view.find(`button[aria-label='查看 ${name} 展示详情']`).exists()).toBe(false);
    }
    expect(view.get("button[aria-label='查看 资深电商运营操盘手 详情']").get("img").attributes("src"))
      .toContain("jd-ops-expert.png");
  });

  it.each(["older catalog", "initial loading", "read failure"] as const)("does not invent integrated cards during %s", (condition) => {
    const store = readyCatalog(snapshot(entries.slice(0, 1)));
    if (condition === "initial loading") { store.snapshot = null; store.refreshing = true; }
    if (condition === "read failure") { store.snapshot = null; store.error = "专家服务暂不可用。"; }
    const view = render();
    expect(view.findAll(".expert-card")).toHaveLength(condition === "older catalog" ? 1 : 0);
    expect(view.findAll(".expert-showcase-card")).toHaveLength(0);
    for (const [, name] of integrated) expect(view.text()).not.toContain(name);
    if (condition === "initial loading") expect(view.find('[role="status"]').exists()).toBe(true);
    if (condition === "read failure") expect(view.text()).toContain("可点击「重新读取」重试");
  });

  it.each(integrated)("prepares %s through the existing client and only prefills its quick question", async (expertId, name) => {
    const entry = entries.find(item => item.display.expertId === expertId)!;
    readyCatalog(snapshot(entries.map(item => item === entry ? { ...item, state: "available" } : item)));
    const transport = vi.fn(async (command, { request }) => ({
      schemaVersion: 1,
      requestId: request.requestId,
      data: command === "experts_prepare_v1"
        ? { ...request.payload, action: "prepare", state: "succeeded" }
        : snapshot(),
    }));
    const client = createExpertNativeClient(transport);
    vi.spyOn(expertNativeClient, "prepare").mockImplementation(client.prepare);
    vi.spyOn(expertNativeClient, "snapshot").mockImplementation(client.snapshot);
    const submit = vi.spyOn(expertNativeClient, "submit");
    const binding = vi.spyOn(expertNativeClient, "setBinding");
    const view = render();
    await view.get(`button[aria-label='查看 ${name} 详情']`).trigger("click");
    await flushPromises();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector("img")).not.toBeNull();
    expect(dialog.textContent).toContain(entry.description);
    expect(transport).not.toHaveBeenCalled();
    [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === `去试试：${entry.quickPrompts[0]}`)!.click();
    await flushPromises();
    expect(transport.mock.calls.map(call => call[0])).toEqual(["experts_prepare_v1", "experts_snapshot_v1"]);
    expect(transport.mock.calls[0]![1].request.payload.expert).toEqual({ expertId, version: entry.display.version });
    const drafts = useChatComposerDraftStore();
    expect(drafts.expert("new")).toEqual(entry.display);
    expect(drafts.texts.new).toBe(entry.quickPrompts[0]);
    expect(navigation.push).toHaveBeenCalledWith({ path: "/chat", query: { focus: "composer" } });
    expect(submit).not.toHaveBeenCalled(); expect(binding).not.toHaveBeenCalled();
  });

  it("keeps Native unavailable state even when a local avatar exists", async () => {
    const entry = entries[1]!;
    readyCatalog(snapshot([{ ...entry, state: "unavailable" }]));
    const view = render();
    const card = view.get(".expert-card");
    expect(card.find("img").exists()).toBe(true);
    expect(card.text()).toContain("暂不可用");
    expect(card.findAll("button").find(button => button.text() === "召唤专家")!.attributes("disabled")).toBeDefined();
    await card.get(".expert-card__details").trigger("click"); await flushPromises();
    expect([...document.querySelectorAll<HTMLButtonElement>(".expert-detail__prompts button")].every(button => button.disabled)).toBe(true);
  });

  it("falls back to the declared icon when artwork fails, and resets for another expert", async () => {
    wrapper = mount(ExpertAvatar, { props: { expertId: integrated[0][0], iconKey: "skillOperations" } });
    await wrapper.get("img").trigger("error");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find(".yj-icon").exists()).toBe(true);
    await wrapper.setProps({ expertId: integrated[1][0] });
    expect(wrapper.find("img").exists()).toBe(true);
    await wrapper.setProps({ expertId: "unknown-expert", iconKey: "unknown-icon" });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find(".yj-icon").exists()).toBe(true);
  });
});
