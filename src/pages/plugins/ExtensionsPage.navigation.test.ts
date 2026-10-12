// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { NDialogProvider, NMessageProvider } from "naive-ui";
import { defineComponent, ref } from "vue";
import { createMemoryHistory, RouterView } from "vue-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppRouter } from "../../router";
import { useExpertsStore } from "../../stores/experts.store";
import { expertEntry, expertSnapshot, expertTestId } from "../../test/expert-fixture";
import ExtensionsPage from "./ExtensionsPage.vue";

const native = vi.hoisted(() => ({ list: vi.fn(), scan: vi.fn(), subscribeDirectoryChanged: vi.fn() }));
const features = vi.hoisted(() => ({ expertsUiEnabled: true }));
vi.mock("../../authorization/experts-ui-config", () => features);
vi.mock("../../composables/useExpertsBinding", () => ({ useExpertsBinding: vi.fn() }));
vi.mock("../../composables/useChatExpertsBinding", () => ({ useChatExpertsBinding: vi.fn() }));
vi.mock("../../composables/useExpertSummon", () => ({ useExpertSummon: () => ({ session: ref(null), selected: ref(null), busy: ref(false), error: ref(null), summon: vi.fn() }) }));
vi.mock("../../stores/chat.store", () => ({ useChatStore: () => ({ context: null }) }));
vi.mock("../../stores/permission.store", () => ({ usePermissionStore: () => ({ hasCapability: () => true }) }));
vi.mock("../../api/skill-native-client", async (original) => ({ ...await original<typeof import("../../api/skill-native-client")>(), skillNativeClient: native }));

let view: ReturnType<typeof mount> | undefined;
let originalTitle: string;
beforeEach(() => {
  originalTitle = document.title;
  features.expertsUiEnabled = true;
  setActivePinia(createPinia());
  const snapshot = { schemaVersion: 1, scannedAt: "2026-10-11T00:00:00Z", skills: [] };
  native.list.mockResolvedValue(snapshot); native.scan.mockResolvedValue(snapshot);
  native.subscribeDirectoryChanged.mockResolvedValue(() => {});
  const experts = useExpertsStore(); experts.contextId = expertTestId(1); experts.scope = "local:test";
  experts.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
});
afterEach(() => { view?.unmount(); view = undefined; document.body.innerHTML = ""; document.title = originalTitle; vi.clearAllMocks(); });
async function render() {
  const otherPage = async () => defineComponent({ template: "<h1>其他页面</h1>" });
  const router = createAppRouter(createMemoryHistory(), { enabled: true, ready: true, ensureInitialized: async () => undefined, hasCapability: () => true }, {
    chat: otherPage, store: otherPage, workflows: otherPage, settings: otherPage, accessDenied: otherPage, plugins: async () => ExtensionsPage,
  }, true, true, true, true);
  await router.push("/plugins");
  view = mount(defineComponent({ components: { NDialogProvider, NMessageProvider, RouterView }, template: "<NMessageProvider><NDialogProvider><main><RouterView /></main></NDialogProvider></NMessageProvider>" }), { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return { page: view, router };
}

it("FEAT158 keeps the active tab focused through the real router for Arrow, Home and End keys", async () => {
  const { page, router } = await render();
  const tabs = page.findAll<HTMLButtonElement>('[role="tab"]');
  tabs[0]!.element.focus();
  for (const [from, key, to, tab] of [[0, "ArrowRight", 1, "experts"], [1, "ArrowLeft", 0, "skills"], [0, "End", 1, "experts"], [1, "Home", 0, "skills"]] as const) {
    await tabs[from]!.trigger("keydown", { key }); await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe(tab);
    expect(page.findAll('[role="tab"]')[to]!.element).toBe(tabs[to]!.element);
    expect(document.activeElement).toBe(tabs[to]!.element);
    expect(tabs[to]!.attributes("aria-selected")).toBe("true");
  }
});

it("FEAT158 still focuses headings for entry, changed context and other pages' query navigation", async () => {
  const { page, router } = await render();
  await router.push("/settings"); await flushPromises();
  expect(document.activeElement).toBe(page.get("h1").element);
  await router.push("/plugins?tab=experts"); await flushPromises();
  expect(document.activeElement).toBe(page.get("h1").element);
  const tabs = page.findAll<HTMLButtonElement>('[role="tab"]');
  tabs[1]!.element.focus();
  await router.replace("/plugins?tab=skills&from=/chat"); await flushPromises();
  expect(document.activeElement).toBe(page.get("h1").element);
  tabs[0]!.element.focus();
  await router.replace("/plugins?tab=experts&from=/chat"); await flushPromises();
  expect(document.activeElement).toBe(tabs[0]!.element);
  await router.push("/settings"); await flushPromises();
  const heading = page.get<HTMLElement>("h1"); heading.element.blur();
  await router.replace("/settings?tab=experts"); await flushPromises();
  expect(document.activeElement).toBe(heading.element);
});

it("FEAT158 preserves ordinary skill-page heading focus when experts are disabled", async () => {
  features.expertsUiEnabled = false;
  const { page, router } = await render();
  const heading = page.get<HTMLElement>("h1"); heading.element.blur();
  await router.replace("/plugins?tab=experts"); await flushPromises();
  expect(page.find('[role="tablist"][aria-label="扩展类型"]').exists()).toBe(false);
  expect(document.activeElement).toBe(heading.element);
});
