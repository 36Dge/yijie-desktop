// @vitest-environment happy-dom

import { flushPromises, mount, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h, inject } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_NEW_DRAFT_TARGET } from "./domain/chat-ipc";
import { useChatStore } from "./stores/chat.store";
import { useSidebarStore } from "./stores/sidebar.store";
import YjAppShell from "./components/yijie/YjAppShell.vue";
import App from "./App.vue";
import { CHAT_AUTHORITY_RETRY_KEY } from "./authorization/chat-authority-recovery";

const chatPermissionLifecycle = vi.hoisted(() => ({
  synchronize: vi.fn(async () => undefined),
  retry: vi.fn(async () => true),
  stop: vi.fn(async () => undefined),
}));

vi.mock("./authorization/chat-ui-config", () => ({ localChatUiEnabled: true }));
vi.mock("./authorization/permission-ui-config", () => ({
  authoritativePermissionUiEnabled: false,
}));
vi.mock("./authorization/chat-permission-lifecycle", () => ({
  createChatPermissionLifecycle: () => chatPermissionLifecycle,
}));
vi.mock("./authorization/app-permission-policy", async () => {
  const actual = await vi.importActual<typeof import("./authorization/app-permission-policy")>(
    "./authorization/app-permission-policy",
  );
  return { ...actual, canRenderProtectedPath: () => true };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("App chat route synchronization", () => {
  it("uses one titlebar toggle across chat and business routes while preserving content and preference", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const sidebar = useSidebarStore(pinia);
    const persist = vi.fn();
    sidebar.hydrate({ getItem: () => "collapsed", setItem: persist });
    const router = createRouter({ history: createMemoryHistory(), routes: [
      {path: "/chat", component: {template: "<div />"}},
      {path: "/store", component: {template: "<div />"}},
    ] });
    await router.push("/chat");
    await router.isReady();
    const wrapper = mount(YjAppShell, {
      slots: {default: '<input aria-label="保留任务输入" value="草稿" />'},
      global: {plugins: [pinia, router]},
    });
    const input = wrapper.get("input").element;
    expect(wrapper.find(".yj-sidebar--collapsed").exists()).toBe(true);
    expect(wrapper.find(".yj-sidebar__toggle").exists()).toBe(false);
    expect(wrapper.get(".yj-window-titlebar").text()).toBe("");
    await wrapper.get('[aria-label="展开侧栏"]').trigger("click");
    expect(wrapper.find(".yj-sidebar--collapsed").exists()).toBe(false);
    expect(wrapper.get("input").element).toBe(input);
    expect(persist).toHaveBeenLastCalledWith("yijie.desktop.ui.sidebar.v1", "expanded");
    await router.push("/store");
    await flushPromises();
    expect(wrapper.findAll(".yj-window-titlebar__sidebar-toggle")).toHaveLength(1);
    await wrapper.get('[aria-label="收起侧栏"]').trigger("click");
    await router.push("/chat");
    await flushPromises();
    expect(wrapper.find(".yj-sidebar--collapsed").exists()).toBe(true);
    expect(wrapper.get('[aria-label="展开侧栏"]').attributes("aria-expanded")).toBe("false");
    wrapper.unmount();
  });

  it("provides the Chat authority retry through the App lifecycle", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: () => "#000000",
    }));
    chatPermissionLifecycle.retry.mockClear();
    const pinia = createPinia();
    setActivePinia(pinia);
    const page = defineComponent({
      setup() {
        const retry = inject(CHAT_AUTHORITY_RETRY_KEY);
        return () => h("button", {
          class: "retry-authority",
          onClick: () => { void retry?.(); },
        }, "retry");
      },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/chat", component: page }],
    });
    await router.push("/chat");
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [pinia, router] } });

    await wrapper.get(".retry-authority").trigger("click");
    await flushPromises();

    expect(chatPermissionLifecycle.retry).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("applies accessible frontend zoom and cleans root state on unmount", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: () => "#000000",
    }));
    const pinia = createPinia();
    setActivePinia(pinia);
    const page = { template: "<div />" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/chat", component: page },
        { path: "/settings", component: page },
      ],
    });
    await router.push("/chat");
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [pinia, router] } });
    const zoomEvent = new KeyboardEvent("keydown", {
      key: "=",
      metaKey: true,
      cancelable: true,
    });

    window.dispatchEvent(zoomEvent);
    await flushPromises();

    expect(zoomEvent.defaultPrevented).toBe(true);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.2");
    expect(document.documentElement.style.getPropertyValue("--yj-ui-scale")).toBe("1.2");
    expect(document.documentElement.style.getPropertyValue("--yj-layout-window-min-width"))
      .toBe("983.3333333333334px");
    expect(document.documentElement.style.getPropertyValue("--yj-layout-window-min-height"))
      .toBe("633.3333333333334px");
    expect(document.documentElement.style.getPropertyValue("--yj-ui-viewport-width"))
      .toBe("83.33333333333333vw");
    expect(document.documentElement.style.getPropertyValue("--yj-ui-viewport-height"))
      .toBe("83.33333333333333vh");
    expect(document.documentElement.dataset.uiZoomPercent).toBe("120");
    expect(wrapper.get(".app-zoom-announcement").text()).toBe("界面缩放 120%");

    wrapper.unmount();

    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--yj-ui-scale")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--yj-layout-window-min-width")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--yj-layout-window-min-height")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--yj-ui-viewport-width")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--yj-ui-viewport-height")).toBe("");
    expect(document.documentElement.dataset.uiZoomPercent).toBeUndefined();
  });

  it("keeps a ready /chat draft stable without clearing it again", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: () => "#000000",
    }));
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useChatStore(pinia);
    store.phase = "ready";
    store.context = {
      contextId: "019c1a00-0000-7000-8000-000000000003",
      expiresAtEpochSeconds: 2_000_000_000,
      allowedActions: ["create_session"],
    };
    store.selectedSessionId = null;
    store.draftTarget = CHAT_NEW_DRAFT_TARGET;
    store.draftTargetReady = true;
    const clearSelectedSession = vi.spyOn(store, "clearSelectedSession");
    const page = { template: "<div />" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/chat", component: page },
        { path: "/settings", component: page },
      ],
    });
    await router.push("/settings");
    await router.isReady();
    const wrapper = shallowMount(App, { global: { plugins: [pinia, router] } });

    await router.push("/chat");
    await flushPromises();

    expect(clearSelectedSession).not.toHaveBeenCalled();
    expect(store.phase).toBe("ready");
    wrapper.unmount();
  });

  it("only follows a deletion disposition from the route that was actually deleted", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: () => "#000000",
    }));
    const deletedSessionId = "019c1a00-0000-7000-8000-000000000004";
    const nextSessionId = "019c1a00-0000-7000-8000-000000000005";
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useChatStore(pinia);
    store.phase = "ready";
    store.context = {
      contextId: "019c1a00-0000-7000-8000-000000000003",
      expiresAtEpochSeconds: 2_000_000_000,
      allowedActions: ["read_sessions"],
    };
    store.selectedSessionId = deletedSessionId;
    const page = { template: "<div />" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/chat", component: page },
        { path: "/chat/:sessionId", component: page },
        { path: "/settings", component: page },
      ],
    });
    await router.push("/settings");
    await router.isReady();
    const wrapper = shallowMount(App, { global: { plugins: [pinia, router] } });
    const disposition = {
      kind: "navigate" as const,
      deletedSessionId,
      nextSessionId,
      path: `/chat/${nextSessionId}` as const,
    };

    store.deleteDisposition = disposition;
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/settings");

    store.deleteDisposition = null;
    await router.push(`/chat/${deletedSessionId}`);
    await flushPromises();
    store.deleteDisposition = { ...disposition };
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/chat/${nextSessionId}`);
    wrapper.unmount();
  });

  it("does not clear a newly selected session on a phase-only change before navigation commits", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: () => "#000000",
    }));
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useChatStore(pinia);
    store.phase = "resyncing";
    store.context = {
      contextId: "019c1a00-0000-7000-8000-000000000003",
      expiresAtEpochSeconds: 2_000_000_000,
      allowedActions: ["read_sessions"],
    };
    store.selectedSessionId = "019c1a00-0000-7000-8000-000000000004";
    const clearSelectedSession = vi.spyOn(store, "clearSelectedSession");
    const page = { template: "<div />" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/chat", component: page },
        { path: "/chat/:sessionId", component: page },
        { path: "/settings", component: page },
      ],
    });
    await router.push("/chat");
    await router.isReady();
    const wrapper = shallowMount(App, { global: { plugins: [pinia, router] } });

    store.phase = "ready";
    await flushPromises();

    expect(clearSelectedSession).not.toHaveBeenCalled();
    expect(store.selectedSessionId).toBe("019c1a00-0000-7000-8000-000000000004");
    wrapper.unmount();
  });

  it("clears an unavailable deleted-session draft when navigating to the new-task route", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: () => "#000000",
    }));
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useChatStore(pinia);
    const sessionId = "019c1a00-0000-7000-8000-000000000004";
    store.phase = "unavailable";
    store.context = {
      contextId: "019c1a00-0000-7000-8000-000000000003",
      expiresAtEpochSeconds: 2_000_000_000,
      allowedActions: ["read_sessions", "create_session"],
    };
    store.selectedSessionId = sessionId;
    store.draftTarget = { type: "session", sessionId };
    store.draftTargetReady = false;
    store.attachmentErrorCode = "chat_resource_not_found";
    store.lastErrorCode = "chat_resource_not_found";
    const clearSelectedSession = vi.spyOn(store, "clearSelectedSession").mockImplementation(async () => {
      store.selectedSessionId = null;
      store.draftTarget = CHAT_NEW_DRAFT_TARGET;
      store.draftTargetReady = true;
      store.attachmentErrorCode = null;
      store.lastErrorCode = null;
      store.phase = "ready";
    });
    const page = { template: "<div />" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/chat", component: page },
        { path: "/chat/:sessionId", component: page },
        { path: "/settings", component: page },
      ],
    });
    await router.push(`/chat/${sessionId}`);
    await router.isReady();
    const wrapper = shallowMount(App, { global: { plugins: [pinia, router] } });

    await router.push("/chat");
    await flushPromises();

    expect(clearSelectedSession).toHaveBeenCalledOnce();
    expect(store.selectedSessionId).toBeNull();
    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftTargetReady).toBe(true);
    expect(store.attachmentErrorCode).toBeNull();
    expect(store.lastErrorCode).toBeNull();
    expect(store.phase).toBe("ready");
    wrapper.unmount();
  });

  it("keeps phase-only selection failure under the initiating route synchronization", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: () => "#000000",
    }));
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useChatStore(pinia);
    const sessionId = "019c1a00-0000-7000-8000-000000000004";
    store.phase = "ready";
    store.context = {
      contextId: "019c1a00-0000-7000-8000-000000000003",
      expiresAtEpochSeconds: 2_000_000_000,
      allowedActions: ["read_sessions", "create_session"],
    };
    store.selectedSessionId = null;
    store.draftTarget = CHAT_NEW_DRAFT_TARGET;
    store.draftTargetReady = true;
    let finishSelection: (() => void) | undefined;
    vi.spyOn(store, "selectSession").mockImplementation(async (nextSessionId) => {
      store.selectedSessionId = nextSessionId;
      store.phase = "resyncing";
      await new Promise<void>((resolve) => { finishSelection = resolve; });
      store.lastErrorCode = "chat_resource_not_found";
      store.phase = "unavailable";
    });
    const clearSelectedSession = vi.spyOn(store, "clearSelectedSession").mockImplementation(async () => {
      store.selectedSessionId = null;
      store.draftTarget = CHAT_NEW_DRAFT_TARGET;
      store.draftTargetReady = true;
      store.lastErrorCode = null;
      store.phase = "ready";
    });
    const page = { template: "<div />" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/chat", component: page },
        { path: "/chat/:sessionId", component: page },
        { path: "/settings", component: page },
      ],
    });
    await router.push("/chat");
    await router.isReady();
    const wrapper = shallowMount(App, { global: { plugins: [pinia, router] } });

    await router.push(`/chat/${sessionId}`);
    await flushPromises();
    expect(store.phase).toBe("resyncing");
    finishSelection?.();
    await flushPromises();

    expect(clearSelectedSession).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.path).toBe("/chat");
    expect(store.selectedSessionId).toBeNull();
    wrapper.unmount();
  });
});
