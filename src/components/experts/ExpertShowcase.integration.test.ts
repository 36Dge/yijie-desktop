// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { NConfigProvider, NDialogProvider } from "naive-ui";
import { defineComponent, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpertShowcase } from "../../domain/expert-showcase";
import { useExpertsStore } from "../../stores/experts.store";
import { expertEntry, expertSnapshot, expertTestId } from "../../test/expert-fixture";
import ExpertMarketPanel from "./ExpertMarketPanel.vue";

// Ordinary display fixtures; no filesystem, native transport, or provider calls.
const showcaseEntries: readonly ExpertShowcase[] = [
  {
    id: "sample-display-analyst",
    name: "报表整理顾问",
    description: "整理普通示例报表，解释趋势与差异。",
    version: "1.2.3",
    author: "示例工作室",
    iconUrl: "/test-assets/sample-display-analyst.png",
    tags: ["趋势分析", "报表整理"],
    quickPrompts: ["请整理这份示例报表。", "请说明两个月的趋势差异。"],
    usageCount: null,
    category: "数据分析",
  },
  {
    id: "sample-display-editor",
    name: "内容编辑顾问",
    description: "整理示例文章的结构与表达。",
    version: "2.0.0",
    author: "内容研究室",
    iconUrl: null,
    tags: ["文章编辑", "表达优化"],
    quickPrompts: ["请整理这篇示例文章。"],
    usageCount: null,
    category: "内容创作",
  },
];
const analyst = showcaseEntries[0]!;
const navigation = vi.hoisted(() => ({ route: { fullPath: "/plugins?tab=experts" } }));
vi.mock("vue-router", () => ({ useRoute: () => navigation.route }));

let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  setActivePinia(createPinia());
  navigation.route = reactive({ fullPath: "/plugins?tab=experts" });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function render(query = ref(""), active = ref(true)) {
  wrapper = mount(defineComponent({
    components: { NConfigProvider, NDialogProvider, ExpertMarketPanel },
    setup: () => ({ query, active, showcaseEntries }),
    template: "<NConfigProvider><NDialogProvider><ExpertMarketPanel v-model:query='query' :active='active' :showcase-entries='showcaseEntries' /></NDialogProvider></NConfigProvider>",
  }), { attachTo: document.body });
  return wrapper;
}

function readyNativeCatalog() {
  const store = useExpertsStore();
  store.contextId = expertTestId(1);
  store.scope = "sample-scope";
  store.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
  return store;
}

function showcaseTrigger(view: ReturnType<typeof render>, entry = analyst) {
  return view.get<HTMLButtonElement>(`button[aria-label="查看 ${entry.name} 展示详情"]`);
}

describe("display-only expert catalog integration", () => {
  it.each(["close", "escape"] as const)("opens the selected display card and restores its trigger after %s", async (action) => {
    readyNativeCatalog();
    const view = render();
    const trigger = showcaseTrigger(view);
    // Mouse activation on macOS need not focus the trigger before opening.
    expect(document.activeElement).not.toBe(trigger.element);
    await trigger.trigger("click");
    await flushPromises();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    for (const content of [analyst.name, analyst.description, analyst.version, analyst.author!, ...analyst.tags, ...analyst.quickPrompts]) {
      expect(dialog.textContent).toContain(content);
    }
    if (action === "close") dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭专家详情"]')!.click();
    else document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger.element);
  });

  it.each([analyst.name, analyst.tags[0]!, analyst.author!])("finds display experts by %s and clears the filter", async (search) => {
    readyNativeCatalog();
    const query = ref("");
    const view = render(query);
    query.value = search;
    await flushPromises();
    expect(showcaseTrigger(view).isVisible()).toBe(true);
    expect(view.find(`button[aria-label="查看 ${showcaseEntries[1]!.name} 展示详情"]`).exists()).toBe(false);
    expect(view.find(".expert-card__details").exists()).toBe(false);
    query.value = "";
    await flushPromises();
    expect(showcaseTrigger(view, showcaseEntries[1]!).isVisible()).toBe(true);
    expect(view.find(".expert-card__details").exists()).toBe(true);
  });

  it("keeps the real native catalog alongside display experts", () => {
    readyNativeCatalog();
    const view = render();
    expect(view.get(".expert-card__details").attributes("aria-label")).toBe(`查看 ${expertEntry.display.displayName} 详情`);
    for (const entry of showcaseEntries) expect(showcaseTrigger(view, entry).isVisible()).toBe(true);
    const summon = view.findAll("button").find(button => button.text() === "召唤专家");
    expect(summon).toBeDefined();
    expect(summon!.attributes("disabled")).toBeUndefined();
  });

  it.each(["identity unavailable", "catalog read failed"] as const)("keeps display details readable when the native %s", async (condition) => {
    const store = useExpertsStore();
    if (condition === "catalog read failed") {
      store.contextId = expertTestId(1);
      store.error = "本地专家目录暂不可用。";
    }
    const view = render();
    await showcaseTrigger(view).trigger("click");
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(analyst.description);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(analyst.quickPrompts[0]);
  });

  it("does not summon, prepare, remove, or recover from display cards and example questions", async () => {
    const store = readyNativeCatalog();
    const execute = vi.spyOn(store, "execute").mockResolvedValue(false);
    const recover = vi.spyOn(store, "recover").mockResolvedValue(false);
    const refresh = vi.spyOn(store, "refresh").mockResolvedValue(undefined);
    const view = render();
    const panel = view.getComponent(ExpertMarketPanel);
    await showcaseTrigger(view).trigger("click");
    await flushPromises();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    for (const prompt of analyst.quickPrompts) {
      const item = [...dialog.querySelectorAll<HTMLElement>(".expert-detail__prompts p")].find(element => element.textContent?.trim() === prompt);
      expect(item, `Expected a readable example question: ${prompt}`).toBeDefined();
      item!.click();
    }
    await flushPromises();
    expect(panel.emitted("summon")).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    const actionText = [...dialog.querySelectorAll("button")].map(button => button.textContent?.trim());
    expect(actionText).not.toContain("准备资源");
    expect(actionText).not.toContain("移除资源");
    expect(actionText).not.toContain("召唤专家");
  });
});
