// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import axe from "axe-core";
import { createPinia, setActivePinia } from "pinia";
import { NMessageProvider } from "naive-ui";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseSkillCatalogSnapshot,
  type SkillCatalogSnapshot,
} from "../../domain/skill-marketplace";
import SkillMarketplacePage from "./SkillMarketplacePage.vue";

const SKILL_ID = "yijie.content-marketing.copywriting";
const permissionState = vi.hoisted(() => ({ canManage: true }));
const directoryEventState = vi.hoisted(() => ({
  handler: null as (() => void) | null,
  unlisten: vi.fn(),
}));
const nativeMock = vi.hoisted(() => ({
  list: vi.fn(),
  scan: vi.fn(),
  install: vi.fn(),
  setEnabled: vi.fn(),
  uninstall: vi.fn(),
  subscribeDirectoryChanged: vi.fn(),
}));

vi.mock("../../stores/permission.store", () => ({
  usePermissionStore: () => ({
    hasCapability: (capability: string) =>
      capability === "plugin.manage" && permissionState.canManage,
  }),
}));

vi.mock("../../api/skill-native-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/skill-native-client")>();
  return { ...actual, skillNativeClient: nativeMock };
});

function snapshot(
  overrides: Record<string, unknown> = {},
): SkillCatalogSnapshot {
  return parseSkillCatalogSnapshot({
    schemaVersion: 1,
    scannedAt: "2026-08-25T08:00:00Z",
    skills: [{
      id: SKILL_ID,
      runtimeName: "copywriting",
      category: "content-marketing",
      order: 0,
      displayName: "跨境营销文案",
      description: "根据已确认的商品事实和受众生成跨境营销文案。",
      version: "0.1.0",
      iconKey: "edit",
      riskLevel: "medium",
      riskReasons: ["营销文案可能包含未经证实的声明。"],
      sourceType: "internal",
      licenseExpression: "LicenseRef-YiJie-Local-Development-Only",
      executionMode: "model-only",
      networkAccess: "none",
      filesystemAccess: "none",
      requiredTools: [],
      catalogStatus: "installable",
      maintenanceStatus: "maintained",
      capabilityReadiness: "ready",
      installationStatus: "not_installed",
      enabled: false,
      runtimeVisible: false,
      failureCode: "",
      ...overrides,
    }],
  });
}

function reviewedCatalogSnapshot(): SkillCatalogSnapshot {
  const template = snapshot().skills[0]!;
  const categories = [
    ["sourcing-selection", 5, "skillSourcing"],
    ["market-research", 9, "skillResearch"],
    ["content-marketing", 7, "skillContent"],
    ["traffic-advertising", 9, "skillTraffic"],
    ["store-operations", 8, "skillOperations"],
  ] as const;
  return parseSkillCatalogSnapshot({
    schemaVersion: 1,
    scannedAt: "2026-08-25T08:00:00Z",
    skills: categories.flatMap(([category, count, iconKey]) =>
      Array.from({ length: count }, (_, index) => ({
        ...template,
        id: `yijie.${category}.fixture-${index}`,
        runtimeName: `${category}-fixture-${index}`,
        category,
        order: index,
        displayName: `${category} ${index}`,
        iconKey,
        executionMode: index === 0 ? "model-only" : "tool-assisted",
        networkAccess: index === 0 ? "none" : "required",
        requiredTools: index === 0 ? [] : ["browser.search"],
        capabilityReadiness: index === 0 ? "ready" : "degraded",
      }))),
  });
}

const TestHost = defineComponent({
  components: { NMessageProvider, SkillMarketplacePage },
  template: `
    <n-message-provider>
      <SkillMarketplacePage />
    </n-message-provider>
  `,
});

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(TestHost, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
      stubs: { teleport: true },
    },
  });
}

function buttonByText(wrapper: ReturnType<typeof mountPage>, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().trim() === text);
  if (button === undefined) throw new Error(`Button not found: ${text}`);
  return button;
}

beforeEach(() => {
  permissionState.canManage = true;
  directoryEventState.handler = null;
  directoryEventState.unlisten.mockReset();
  const initial = snapshot();
  nativeMock.list.mockResolvedValue(initial);
  nativeMock.scan.mockResolvedValue(initial);
  nativeMock.install.mockResolvedValue(snapshot({
    installationStatus: "installed",
    enabled: true,
    runtimeVisible: true,
  }));
  nativeMock.setEnabled.mockImplementation(async (_skillId: string, enabled: boolean) =>
    snapshot({
      installationStatus: "installed",
      enabled,
      runtimeVisible: enabled,
    })
  );
  nativeMock.uninstall.mockResolvedValue(initial);
  nativeMock.subscribeDirectoryChanged.mockImplementation(async (handler: () => void) => {
    directoryEventState.handler = handler;
    return directoryEventState.unlisten;
  });
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("SkillMarketplacePage", () => {
  it("renders only the native catalog in the fixed five-category order", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(nativeMock.scan).toHaveBeenCalledWith("page_open", expect.any(AbortSignal));
    expect(wrapper.get("h1").text()).toBe("Skill 广场");
    expect(wrapper.findAll(".yj-section__title").map((heading) => heading.text())).toEqual([
      "货源与选品",
      "市场调研与分析",
      "内容创作与营销",
      "流量获取与广告",
      "店铺运营与基建",
    ]);
    expect(wrapper.findAll(".yj-section__count").map((count) => count.text())).toEqual([
      "0", "0", "1", "0", "0",
    ]);
    expect(wrapper.findAll(".skill-card")).toHaveLength(1);
    expect(wrapper.text()).toContain("跨境营销文案");
  });

  it("renders all 38 reviewed cards with exact 5/9/7/9/8 category counts", async () => {
    nativeMock.scan.mockResolvedValue(reviewedCatalogSnapshot());
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findAll(".skill-card")).toHaveLength(38);
    expect(wrapper.findAll(".yj-section__count").map((count) => count.text()))
      .toEqual(["5", "9", "7", "9", "8"]);
    expect(wrapper.findAll('button[aria-label^="安装 "]')).toHaveLength(38);
  });

  it("installs from the renderer-safe skill ID and converges to native state", async () => {
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get(`button[aria-label="安装 跨境营销文案"]`).trigger("click");
    await flushPromises();

    expect(nativeMock.install).toHaveBeenCalledWith(SKILL_ID);
    expect(wrapper.find(`button[aria-label="安装 跨境营销文案"]`).exists()).toBe(false);
    expect(wrapper.get('[aria-label="停用 跨境营销文案"]')).toBeDefined();
    expect(wrapper.text()).toContain("模型可用");
  });

  it("requires the exact uninstall confirmation and leaves cancel side-effect free", async () => {
    const installed = snapshot({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    });
    nativeMock.scan.mockResolvedValue(installed);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get(`button[aria-label="卸载 跨境营销文案"]`).trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("卸载此技能");
    expect(wrapper.text()).toContain("卸载后需要重新安装才能使用。");

    await buttonByText(wrapper, "取消").trigger("click");
    await flushPromises();
    expect(nativeMock.uninstall).not.toHaveBeenCalled();

    await wrapper.get(`button[aria-label="卸载 跨境营销文案"]`).trigger("click");
    await buttonByText(wrapper, "确认").trigger("click");
    await flushPromises();

    expect(nativeMock.uninstall).toHaveBeenCalledWith(SKILL_ID);
    expect(wrapper.get(`button[aria-label="安装 跨境营销文案"]`)).toBeDefined();
  });

  it("uses list and hides all mutation controls for plugin.read-only access", async () => {
    permissionState.canManage = false;
    const wrapper = mountPage();
    await flushPromises();

    expect(nativeMock.list).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(nativeMock.scan).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("当前仅可查看 Skill");
    expect(wrapper.find(`button[aria-label="安装 跨境营销文案"]`).exists()).toBe(false);
  });

  it("rescans after a content-free native directory change and unlistens on teardown", async () => {
    const wrapper = mountPage();
    await flushPromises();
    nativeMock.scan.mockClear();

    directoryEventState.handler?.();
    await flushPromises();

    expect(nativeMock.scan).toHaveBeenCalledWith("directory_changed", expect.any(AbortSignal));
    wrapper.unmount();
    expect(directoryEventState.unlisten).toHaveBeenCalledTimes(1);
  });

  it("restores an externally moved installed Skill to the offline install action", async () => {
    nativeMock.scan
      .mockResolvedValueOnce(snapshot({
        installationStatus: "installed",
        enabled: true,
        runtimeVisible: true,
      }))
      .mockResolvedValueOnce(snapshot());
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('[aria-label="停用 跨境营销文案"]')).toBeDefined();

    directoryEventState.handler?.();
    await flushPromises();

    expect(wrapper.find('[aria-label="停用 跨境营销文案"]').exists()).toBe(false);
    expect(wrapper.get('button[aria-label="安装 跨境营销文案"]')).toBeDefined();
  });

  it("has no serious or critical accessibility violations in the real catalog state", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const results = await axe.run(wrapper.element, {
      rules: { region: { enabled: false } },
    });

    expect(results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical"
    )).toEqual([]);
  });
});
