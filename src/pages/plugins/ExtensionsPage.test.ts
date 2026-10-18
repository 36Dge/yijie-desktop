// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { NDialogProvider, NMessageProvider } from "naive-ui";
import { defineComponent, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExpertsStore } from "../../stores/experts.store";
import { expertEntry, expertSnapshot, expertTestId } from "../../test/expert-fixture";
import ExpertMarketPanel from "../../components/experts/ExpertMarketPanel.vue";
import ExtensionsPage from "./ExtensionsPage.vue";

const navigation = vi.hoisted(() => ({ route: { path: "/plugins", fullPath: "/plugins", query: {} as Record<string, string> }, replace: vi.fn(), push: vi.fn() }));
const native = vi.hoisted(() => ({ list: vi.fn(), scan: vi.fn(), subscribeDirectoryChanged: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => navigation.route, useRouter: () => navigation }));
vi.mock("../../authorization/experts-ui-config", () => ({ expertsUiEnabled: true }));
vi.mock("../../composables/useExpertsBinding", () => ({ useExpertsBinding: vi.fn() }));
vi.mock("../../composables/useChatExpertsBinding", () => ({ useChatExpertsBinding: vi.fn() }));
vi.mock("../../composables/useExpertSummon", () => ({ useExpertSummon: () => ({ session: ref(null), selected: ref(null), busy: ref(false), error: ref(null), summon: vi.fn() }) }));
vi.mock("../../stores/chat.store", () => ({ useChatStore: () => ({ context: null }) }));
vi.mock("../../stores/permission.store", () => ({ usePermissionStore: () => ({ hasCapability: () => true }) }));
vi.mock("../../api/skill-native-client", async (original) => ({ ...await original<typeof import("../../api/skill-native-client")>(), skillNativeClient: native }));

let view: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  setActivePinia(createPinia());
  navigation.route = reactive({ path: "/plugins", fullPath: "/plugins", query: {} });
  navigation.replace.mockImplementation(async ({ query }: { query: Record<string, string> }) => {
    navigation.route.query = query;
    navigation.route.fullPath = `/plugins?${new URLSearchParams(query)}`;
  });
  const snapshot = { schemaVersion: 1, scannedAt: "2026-10-11T00:00:00Z", skills: [] };
  native.list.mockResolvedValue(snapshot); native.scan.mockResolvedValue(snapshot);
  native.subscribeDirectoryChanged.mockResolvedValue(() => {});
  const experts = useExpertsStore(); experts.contextId = expertTestId(1); experts.scope = "local:test";
  experts.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
});
afterEach(() => { view?.unmount(); view = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); });
function render() {
  view = mount(defineComponent({ components: { ExtensionsPage, NMessageProvider, NDialogProvider }, template: "<NMessageProvider><NDialogProvider><ExtensionsPage /></NDialogProvider></NMessageProvider>" }), { attachTo: document.body });
  return view;
}

describe("extensions page tab continuity", () => {
  it("keeps the same keyboard tab nodes, expert search and independent panel positions", async () => {
    const page = render(); await flushPromises();
    const tabs = page.findAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.map(item => item.text())).toEqual(["专家", "技能"]);
    expect(tabs[1]!.attributes("aria-selected")).toBe("true");
    const skillsPanel = page.get<HTMLElement>('[aria-label="技能目录"]');
    skillsPanel.element.scrollTop = 160;
    tabs[1]!.element.focus(); await tabs[1]!.trigger("keydown", { key: "ArrowLeft" }); await flushPromises();
    expect(document.activeElement).toBe(tabs[0]!.element);
    expect(page.findAll('[role="tab"]')[0]!.element).toBe(tabs[0]!.element);
    const expertPanel = page.get<HTMLElement>('[aria-label="专家列表"]');
    expertPanel.element.scrollTop = 80;
    await page.get('input[aria-label="搜索专家"]').setValue("未匹配的正常搜索");
    expect(page.text()).toContain("未找到匹配专家");
    await tabs[0]!.trigger("keydown", { key: "ArrowRight" }); await flushPromises();
    expect(document.activeElement).toBe(tabs[1]!.element);
    expect(skillsPanel.element.scrollTop).toBe(160);
    await tabs[1]!.trigger("keydown", { key: "Home" }); await flushPromises();
    expect(document.activeElement).toBe(tabs[0]!.element);
    expect((page.get('input[aria-label="搜索专家"]').element as HTMLInputElement).value).toBe("未匹配的正常搜索");
    expect(expertPanel.element.scrollTop).toBe(80);
  });

  it("closes details when switching away and returns to the default skill tab on a fresh visit", async () => {
    const page = render(); await flushPromises();
    await page.findAll('[role="tab"]')[0]!.trigger("click"); await flushPromises();
    const panel = page.findComponent(ExpertMarketPanel);
    await panel.get(".expert-card__details").trigger("click"); await flushPromises();
    expect(document.body.textContent).toContain("可以这样提问");
    await page.findAll('[role="tab"]')[1]!.trigger("click"); await flushPromises();
    expect(panel.props("active")).toBe(false);
    expect(panel.findComponent({ name: "Modal" }).exists()).toBe(false);
    page.unmount(); view = undefined;
    navigation.route.query = {}; navigation.route.fullPath = "/plugins";
    const revisited = render(); await flushPromises();
    expect(revisited.findAll('[role="tab"]')[1]!.attributes("aria-selected")).toBe("true");
  });
});
