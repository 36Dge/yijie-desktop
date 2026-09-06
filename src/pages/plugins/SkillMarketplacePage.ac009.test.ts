// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { NButton, NMessageProvider, NModal, NTooltip } from "naive-ui";
import { defineComponent, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseSkillCatalogSnapshot,
  type SkillCatalogSnapshot,
} from "../../domain/skill-marketplace";
import { SkillNativeClientError } from "../../api/skill-native-client";
import SkillMarketplacePage from "./SkillMarketplacePage.vue";

const SKILL_ID = "yijie.content-marketing.copywriting";
const permissionState = vi.hoisted(() => ({ canManage: true }));
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

function snapshot(overrides: Record<string, unknown> = {}): SkillCatalogSnapshot {
  return parseSkillCatalogSnapshot({
    schemaVersion: 1,
    scannedAt: "2026-08-26T08:00:00Z",
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
      licenseExpression: "LicenseRef-YiJie-Desktop-Distribution",
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

function emptySnapshot(): SkillCatalogSnapshot {
  return parseSkillCatalogSnapshot({
    schemaVersion: 1,
    scannedAt: "2026-08-26T08:00:00Z",
    skills: [],
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

const mountedWrappers: ReturnType<typeof mount>[] = [];
let tokenStyle: HTMLStyleElement | null = null;

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(TestHost, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
      stubs: { teleport: true },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

function buttonByText(wrapper: ReturnType<typeof mountPage>, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().trim() === text);
  if (button === undefined) throw new Error(`Button not found: ${text}`);
  return button;
}

function installThemeTokens(): void {
  tokenStyle = document.createElement("style");
  tokenStyle.textContent = readFileSync(
    resolve(process.cwd(), "src/styles/variables.css"),
    "utf8",
  );
  document.head.append(tokenStyle);
}

beforeEach(() => {
  permissionState.canManage = true;
  nativeMock.list.mockReset();
  nativeMock.scan.mockReset();
  nativeMock.install.mockReset();
  nativeMock.setEnabled.mockReset();
  nativeMock.uninstall.mockReset();
  nativeMock.subscribeDirectoryChanged.mockReset();

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
  nativeMock.subscribeDirectoryChanged.mockResolvedValue(vi.fn());

  document.documentElement.dataset.theme = "light";
  installThemeTokens();
});

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount();
  tokenStyle?.remove();
  tokenStyle = null;
  document.documentElement.removeAttribute("data-theme");
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("FEAT-129 AC-009 automated acceptance", () => {
  it("keeps the install tooltip available to pointer and keyboard users", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const install = wrapper.get(`button[aria-label="安装 跨境营销文案"]`);
    const tooltip = wrapper.findAllComponents(NTooltip).find((candidate) =>
      candidate.props("trigger") === "manual"
    );

    expect(tooltip).toBeDefined();
    expect(tooltip?.props("show")).toBe(false);
    await install.trigger("mouseenter");
    expect(tooltip?.props("show")).toBe(true);
    await install.trigger("mouseleave");
    expect(tooltip?.props("show")).toBe(false);
    await install.trigger("focus");
    expect(tooltip?.props("show")).toBe(true);
    await install.trigger("blur");
    expect(tooltip?.props("show")).toBe(false);
  });

  it("announces initial loading, renders empty, and recovers from the empty action", async () => {
    let resolveInitialScan: ((value: SkillCatalogSnapshot) => void) | undefined;
    nativeMock.scan.mockImplementationOnce(() =>
      new Promise<SkillCatalogSnapshot>((resolve) => { resolveInitialScan = resolve; })
    );
    const wrapper = mountPage();
    await nextTick();

    const loading = wrapper.get('[role="status"][aria-busy="true"]');
    expect(loading.text()).toContain("正在读取内置清单并扫描本地 Skill");
    expect(wrapper.findAll(".n-skeleton")).not.toHaveLength(0);

    resolveInitialScan?.(emptySnapshot());
    await flushPromises();
    expect(wrapper.get(".yj-empty").text()).toContain("当前客户端没有可展示的 Skill");

    nativeMock.scan.mockResolvedValueOnce(snapshot());
    await wrapper.get(".yj-empty button").trigger("click");
    await flushPromises();
    expect(nativeMock.scan).toHaveBeenLastCalledWith("user_retry", expect.any(AbortSignal));
    expect(wrapper.get(`button[aria-label="安装 跨境营销文案"]`)).toBeDefined();
  });

  it("renders per-card installing feedback and blocks duplicate input", async () => {
    let resolveInstall: ((value: SkillCatalogSnapshot) => void) | undefined;
    nativeMock.install.mockImplementationOnce(() =>
      new Promise<SkillCatalogSnapshot>((resolve) => { resolveInstall = resolve; })
    );
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get(`button[aria-label="安装 跨境营销文案"]`).trigger("click");
    await nextTick();
    const card = wrapper.get(".skill-card");
    expect(card.attributes("aria-busy")).toBe("true");
    expect(card.text()).toContain("正在安装");
    expect(wrapper.get(`button[aria-label="安装 跨境营销文案"]`).attributes("disabled"))
      .toBeDefined();
    expect(nativeMock.install).toHaveBeenCalledTimes(1);

    resolveInstall?.(snapshot({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    }));
    await flushPromises();
    expect(card.attributes("aria-busy")).toBe("false");
    expect(card.text()).toContain("模型可用");
  });

  it("keeps an atomic failure visible and retries from the same card", async () => {
    nativeMock.install
      .mockRejectedValueOnce(new SkillNativeClientError("bundle-invalid"))
      .mockResolvedValueOnce(snapshot({
        installationStatus: "installed",
        enabled: true,
        runtimeVisible: true,
      }));
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get(`button[aria-label="安装 跨境营销文案"]`).trigger("click");
    await flushPromises();
    expect(wrapper.get(".skill-card [role=alert]").text())
      .toContain("内置 Skill 资源未通过完整性或路径安全校验");
    expect(wrapper.get(`button[aria-label="重试安装 跨境营销文案"]`)).toBeDefined();

    window.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(nativeMock.scan).toHaveBeenLastCalledWith("window_resume", expect.any(AbortSignal));
    expect(wrapper.get(`button[aria-label="重试安装 跨境营销文案"]`)).toBeDefined();
    expect(wrapper.get(".skill-card [role=alert]").text())
      .toContain("内置 Skill 资源未通过完整性或路径安全校验");

    await wrapper.get(`button[aria-label="重试安装 跨境营销文案"]`).trigger("click");
    await flushPromises();
    expect(nativeMock.install).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".skill-card [role=alert]").exists()).toBe(false);
    expect(wrapper.text()).toContain("模型可用");
  });

  it("supports uninstall cancel, Escape, and danger confirmation while restoring focus", async () => {
    nativeMock.scan.mockResolvedValueOnce(snapshot({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    }));
    const wrapper = mountPage();
    await flushPromises();
    const uninstall = wrapper.get(`button[aria-label="卸载 跨境营销文案"]`);

    await uninstall.trigger("click");
    await flushPromises();
    expect(wrapper.getComponent(NModal).props("show")).toBe(true);
    const dangerAction = wrapper.findAllComponents(NButton).find((candidate) =>
      candidate.props("type") === "error"
    );
    expect(dangerAction?.text()).toBe("确认");
    expect(uninstall.attributes("title")).toBe("卸载");

    await buttonByText(wrapper, "取消").trigger("click");
    await flushPromises();
    expect(nativeMock.uninstall).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(uninstall.element);

    await uninstall.trigger("click");
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
    }));
    await flushPromises();
    expect(wrapper.getComponent(NModal).props("show")).toBe(false);
    expect(nativeMock.uninstall).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(uninstall.element);

    await uninstall.trigger("click");
    await buttonByText(wrapper, "确认").trigger("click");
    await flushPromises();
    expect(nativeMock.uninstall).toHaveBeenCalledWith(SKILL_ID);
    expect(wrapper.get(`button[aria-label="安装 跨境营销文案"]`)).toBeDefined();
  });

  it("resolves card colors from distinct light and dark theme tokens", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get(".skill-card")).toBeDefined();
    const tokenProbe = document.createElement("div");
    tokenProbe.style.backgroundColor = "var(--yj-color-bg-card)";
    document.body.append(tokenProbe);

    document.documentElement.dataset.theme = "light";
    const lightRoot = getComputedStyle(document.documentElement);
    expect(lightRoot.colorScheme).toBe("light");
    expect(lightRoot.getPropertyValue("--yj-color-bg-card").trim()).toBe("#ffffff");
    expect(getComputedStyle(tokenProbe).backgroundColor).toBe("#ffffff");

    document.documentElement.dataset.theme = "dark";
    const darkRoot = getComputedStyle(document.documentElement);
    expect(darkRoot.colorScheme).toBe("dark");
    expect(darkRoot.getPropertyValue("--yj-color-bg-card").trim()).toBe("#25282b");
    expect(getComputedStyle(tokenProbe).backgroundColor).toBe("#25282b");
  });

  it("locks the minimum-window grid and horizontal-overflow prevention invariants", () => {
    const tauriConfig = JSON.parse(readFileSync(
      resolve(process.cwd(), "src-tauri/tauri.conf.json"),
      "utf8",
    )) as { app: { windows: Array<Record<string, unknown>> } };
    const marketplaceSource = readFileSync(
      resolve(process.cwd(), "src/pages/plugins/SkillMarketplacePage.vue"),
      "utf8",
    );
    const cardSource = readFileSync(
      resolve(process.cwd(), "src/components/skills/SkillCard.vue"),
      "utf8",
    );
    const shellSource = readFileSync(
      resolve(process.cwd(), "src/components/yijie/YjAppShell.vue"),
      "utf8",
    );

    expect(tauriConfig.app.windows[0]).toMatchObject({
      minWidth: 1180,
      minHeight: 760,
    });
    expect(marketplaceSource).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(marketplaceSource).toMatch(/\.skill-marketplace__grid > li\s*{[^}]*min-width:\s*0;/s);
    expect(cardSource).toMatch(/\.skill-card\s*{[^}]*min-width:\s*0;/s);
    expect(cardSource).toMatch(/\.skill-card\s*{[^}]*background:\s*var\(--yj-color-bg-card\);/s);
    expect(shellSource).toMatch(/\.yj-app-shell__content\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*auto;/s);
    expect(shellSource).toMatch(/\.yj-app-shell\s*{[^}]*overflow:\s*hidden;/s);
    expect(cardSource).toMatch(
      /\.skill-card__delete:hover,[\s\S]*color:\s*var\(--yj-color-error\);[\s\S]*background:\s*var\(--yj-color-error-soft\);/,
    );
    expect(`${marketplaceSource}\n${cardSource}`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
