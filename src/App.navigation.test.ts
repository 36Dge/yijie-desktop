// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";
import { createAppRouter } from "./router";
import { usePermissionStore } from "./stores/permission.store";
import type { PermissionProjection } from "./domain/permissions";

const client = vi.hoisted(() => ({ listMyTenants: vi.fn(), getMyCapabilities: vi.fn() }));
vi.mock("./api/permission-client", async (original) => ({
  ...await original<typeof import("./api/permission-client")>(), permissionClient: client,
}));
vi.mock("./authorization/local-profile", async (original) => ({
  ...await original<typeof import("./authorization/local-profile")>(), demoFastLocalProfileEnabled: true,
}));
vi.mock("./authorization/chat-permission-lifecycle", () => ({
  createChatPermissionLifecycle: () => ({
    synchronize: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
    retry: vi.fn(async () => true), prepareExecution: vi.fn(async () => true),
  }),
}));
vi.mock("./api/market-connectors-client", async (original) => ({
  ...await original<typeof import("./api/market-connectors-client")>(), marketConnectorsEnabled: false,
}));

const tenantId = "019c1a00-0000-7000-8000-000000000001";
let wrapper: VueWrapper | undefined;
let pinia: Pinia;

function projection(capabilities: PermissionProjection["capabilities"] = ["task.create", "task.read"]): PermissionProjection {
  const expiresAtEpochMs = Date.now() + 300_000;
  return { tenantId, authorizationRevision: 1, capabilities, expiresAtEpochMs,
    expiresAt: new Date(expiresAtEpochMs).toISOString() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T08:00:00Z"));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#000000" }));
  client.listMyTenants.mockResolvedValue([{ tenantId, displayName: "本地工作空间" }]);
  client.getMyCapabilities.mockImplementation(async () => projection());
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  disposePinia(pinia);
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openApp() {
  const store = usePermissionStore(pinia);
  const page = { template: "<h1>新建任务</h1>" };
  const settings = { template: "<h1>设置</h1>" };
  const router = createAppRouter(createMemoryHistory(), {
    enabled: true, get ready() { return store.isReady; },
    ensureInitialized: store.ensureInitialized, hasCapability: store.hasCapability,
  }, { chat: async () => page, settings: async () => settings,
    store: async () => page, workflows: async () => page, plugins: async () => page,
    accessDenied: async () => ({ template: "<h1>无权访问</h1>" }),
  }, true);
  await router.push("/");
  await router.isReady();
  wrapper = mount(App, { global: { plugins: [pinia, router], stubs: {
    YjAppShell: { template: "<main><slot /></main>" }, ScheduledUpdates: true, ChatDeletionUpdates: true,
  } } });
  await flushPromises();
  return { router, store };
}

describe("default task page and permission refresh", () => {
  it("opens a new task and returns to it after an expired projection is refreshed", async () => {
    const { router, store } = await openApp();
    expect(router.currentRoute.value.path).toBe("/chat");
    expect(wrapper!.find("h1").text()).toBe("新建任务");
    // A suspended/background window can resume after its projection expires.
    vi.setSystemTime(Date.now() + 301_000);
    let complete!: (value: PermissionProjection) => void;
    client.getMyCapabilities.mockReturnValueOnce(new Promise<PermissionProjection>(resolve => { complete = resolve; }));
    const refresh = store.refresh();
    await flushPromises();
    expect(store.phase).toBe("loading");
    expect(store.hasCapability("task.create")).toBe(false);
    expect(router.currentRoute.value.path).toBe("/chat");
    expect(wrapper!.find("h1").exists()).toBe(false);
    complete(projection());
    await refresh;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/chat");
    expect(wrapper!.find("h1").text()).toBe("新建任务");
  });

  it("preserves a deliberate visit to Settings when permission refresh completes", async () => {
    const { router, store } = await openApp();
    await router.push("/settings");
    vi.setSystemTime(Date.now() + 301_000);
    await store.refresh();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/settings");
    expect(wrapper!.find("h1").text()).toBe("设置");
  });

  it("still removes access when a refreshed projection no longer permits new tasks", async () => {
    const { router, store } = await openApp();
    vi.setSystemTime(Date.now() + 301_000);
    client.getMyCapabilities.mockImplementationOnce(async () => ({ ...projection([]), authorizationRevision: 2 }));
    await store.refresh();
    await flushPromises();
    expect(store.hasCapability("task.create")).toBe(false);
    expect(router.currentRoute.value.path).toBe("/access-denied");
    expect(wrapper!.find("h1").text()).toBe("无权访问");
  });
});
