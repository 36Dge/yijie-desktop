// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { NDialogProvider, NMessageProvider } from "naive-ui";
import { defineComponent, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExpertsStore } from "../../stores/experts.store";
import { parseNativeSkillCatalog } from "../../domain/native-skill-marketplace";
import { expertEntry, expertSnapshot, expertTestId } from "../../test/expert-fixture";
import { nativeCatalogFixture, nativeSkillFixture } from "../../test/native-skill-fixture";
import ExpertMarketPanel from "../../components/experts/ExpertMarketPanel.vue";
import ExtensionsPage from "./ExtensionsPage.vue";

const navigation = vi.hoisted(() => ({ route: { path: "/plugins", fullPath: "/plugins", query: {} as Record<string, string> }, replace: vi.fn(), push: vi.fn() }));
const native = vi.hoisted(() => ({
  list: vi.fn(), scan: vi.fn(), subscribeDirectoryChanged: vi.fn(),
  importSkill: vi.fn(), importDialog: { open: vi.fn(), close: vi.fn() },
}));
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
  native.importDialog.open.mockResolvedValue(undefined);
  native.importDialog.close.mockResolvedValue(undefined);
  const experts = useExpertsStore(); experts.contextId = expertTestId(1); experts.scope = "local:test";
  experts.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
});
afterEach(() => { view?.unmount(); view = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); });
function render() {
  view = mount(defineComponent({ components: { ExtensionsPage, NMessageProvider, NDialogProvider }, template: "<NMessageProvider><NDialogProvider><ExtensionsPage /></NDialogProvider></NMessageProvider>" }), { attachTo: document.body });
  return view;
}

describe("extensions page tab continuity", () => {
  it("refreshes only the active catalog and puts its import action immediately to the right", async () => {
    const refreshExperts = vi.spyOn(useExpertsStore(), "refresh").mockResolvedValue();
    const page = render(); await flushPromises();
    const header = page.get(".yj-page-header__actions");
    const refresh = header.get('button[aria-label="刷新数据"]');
    expect(refresh.text()).toBe("");
    expect(refresh.find("svg").exists()).toBe(true);
    expect(refresh.attributes("data-yj-tooltip")).toBe("刷新数据");
    expect(refresh.find(".n-button__border").exists()).toBe(false);
    const upcoming = header.get('[data-yj-tooltip="即将支持"]');
    expect(upcoming.attributes("tabindex")).toBe("0");
    expect(header.findAll("button").map(button => button.text())).toEqual(["", "导入专家"]);
    expect(upcoming.get("button").attributes("disabled")).toBeDefined();
    await upcoming.trigger("mouseenter"); await flushPromises();
    expect(document.body.textContent).toContain("即将支持");
    await upcoming.get("button").trigger("click");
    expect(native.importDialog.open).not.toHaveBeenCalled();
    await refresh.trigger("click");
    expect(refreshExperts).toHaveBeenCalledOnce();
    expect(native.scan).not.toHaveBeenCalled();

    await page.findAll('[role="tab"]')[1]!.trigger("click"); await flushPromises();
    expect(header.findAll("button").map(button => button.text())).toEqual(["", "导入技能"]);
    expect(page.findAll("button").filter(button => button.text() === "导入技能")).toHaveLength(1);
    await header.get('button[aria-label="刷新数据"]').trigger("click"); await flushPromises();
    expect(native.scan).toHaveBeenCalledWith("user_retry", expect.any(AbortSignal));
    expect(refreshExperts).toHaveBeenCalledOnce();
    await header.get('button[aria-haspopup="dialog"]').trigger("click"); await flushPromises();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("安装技能");
    expect(native.importDialog.open).toHaveBeenCalledOnce();
    expect(native.importSkill).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus, search terms and scroll positions independent across tabs", async () => {
    const page = render(); await flushPromises();
    const tabs = page.findAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.map(item => item.text())).toEqual(["专家", "技能"]);
    expect(tabs[0]!.attributes("aria-selected")).toBe("true");
    await tabs[1]!.trigger("click"); await flushPromises();
    const skillsPanel = page.get<HTMLElement>('[aria-label="技能目录"]');
    await page.get('input[aria-label="搜索技能"]').setValue("技能关键词");
    skillsPanel.element.scrollTop = 160;
    tabs[1]!.element.focus(); await tabs[1]!.trigger("keydown", { key: "ArrowLeft" }); await flushPromises();
    expect(document.activeElement).toBe(tabs[0]!.element);
    expect(page.findAll('[role="tab"]')[0]!.element).toBe(tabs[0]!.element);
    const expertPanel = page.get<HTMLElement>('[aria-label="专家列表"]');
    expertPanel.element.scrollTop = 80;
    expect(page.get<HTMLInputElement>('input[aria-label="搜索专家"]').element.value).toBe("");
    await page.get('input[aria-label="搜索专家"]').setValue("未匹配的正常搜索");
    expect(page.text()).toContain("未找到匹配专家");
    await tabs[0]!.trigger("keydown", { key: "ArrowRight" }); await flushPromises();
    expect(document.activeElement).toBe(tabs[1]!.element);
    expect(page.get<HTMLInputElement>('input[aria-label="搜索技能"]').element.value).toBe("技能关键词");
    expect(skillsPanel.element.scrollTop).toBe(160);
    await tabs[1]!.trigger("keydown", { key: "Home" }); await flushPromises();
    expect(document.activeElement).toBe(tabs[0]!.element);
    expect((page.get('input[aria-label="搜索专家"]').element as HTMLInputElement).value).toBe("未匹配的正常搜索");
    expect(expertPanel.element.scrollTop).toBe(80);
  });

  it("filters built-in and imported skills by name, description or category and restores the catalog on clear", async () => {
    const catalog = nativeCatalogFixture({ ...nativeSkillFixture, display_name: "订单核对" });
    catalog.skills.push(...["销售谈判专家", "供应商评估"].map((display_name, index) => ({
      ...nativeSkillFixture,
      id: `builtin-${index}`,
      origin: "builtin" as const,
      category: "sourcing-selection",
      display_name,
      description: index === 0 ? "准备 B2B 沟通草案" : "分析采购风险",
      runtime_name: "",
      installation_state: "not_installed" as const,
      enabled: false,
      runtime_visible: false,
    })));
    native.scan.mockResolvedValue(parseNativeSkillCatalog(catalog));
    navigation.route.query = { tab: "skills" };
    const page = render(); await flushPromises();
    const search = page.get<HTMLInputElement>('input[aria-label="搜索技能"]');
    const panel = page.get('[aria-label="技能目录"]');
    const names = () => panel.findAll(".skill-card__title").map(card => card.text());

    expect(panel.get(".skill-marketplace__count").text()).toBe("3 个技能");
    expect(panel.get(".skill-marketplace__summary p").text()).toBe("在对话中选择已启用的技能，再发送消息开始任务。");
    await search.setValue("  b2b  ");
    expect(names()).toEqual(["销售谈判专家"]);
    expect(panel.get(".skill-marketplace__count").text()).toBe("1 个技能");
    expect(panel.get(".yj-section__count").text()).toBe("1");
    await search.setValue("货源与选品");
    expect(names()).toEqual(["销售谈判专家", "供应商评估"]);
    expect(panel.get(".yj-section__count").text()).toBe("2");
    await search.setValue("订单");
    expect(names()).toEqual(["订单核对"]);
    expect(panel.get(".yj-section__title").text()).toBe("我的技能");
    await search.setValue("没有这个技能");
    expect(panel.text()).toContain("未找到匹配技能");
    expect(panel.get(".skill-marketplace__count").text()).toBe("0 个技能");
    expect(panel.find(".yj-section").exists()).toBe(false);
    await search.setValue("");
    expect(names()).toEqual(["销售谈判专家", "供应商评估", "订单核对"]);
    expect(panel.get(".skill-marketplace__count").text()).toBe("3 个技能");
    expect(panel.findAll(".yj-section")).toHaveLength(6);
    expect(native.scan).toHaveBeenCalledTimes(1);
  });

  it("closes details when switching away and returns to the default expert tab on a fresh visit", async () => {
    const page = render(); await flushPromises();
    await page.findAll('[role="tab"]')[0]!.trigger("click"); await flushPromises();
    const panel = page.findComponent(ExpertMarketPanel);
    await panel.get(".expert-card__details").trigger("click"); await flushPromises();
    expect(document.body.textContent).toContain("专家帮你做");
    await page.findAll('[role="tab"]')[1]!.trigger("click"); await flushPromises();
    expect(panel.props("active")).toBe(false);
    expect(panel.findComponent({ name: "Modal" }).exists()).toBe(false);
    page.unmount(); view = undefined;
    navigation.route.query = {}; navigation.route.fullPath = "/plugins";
    const revisited = render(); await flushPromises();
    expect(revisited.findAll('[role="tab"]')[0]!.attributes("aria-selected")).toBe("true");
  });

  it("preserves an explicit skill link from the chat menu", async () => {
    navigation.route.query = { tab: "skills" };
    navigation.route.fullPath = "/plugins?tab=skills";
    const page = render(); await flushPromises();
    expect(page.findAll('[role="tab"]')[1]!.attributes("aria-selected")).toBe("true");
    expect(page.get('[aria-label="技能目录"]').isVisible()).toBe(true);
    expect(page.get('[aria-label="专家列表"]').isVisible()).toBe(false);
  });
});
