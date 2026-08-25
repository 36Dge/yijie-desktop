// @vitest-environment happy-dom

import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_NEW_DRAFT_TARGET } from "./domain/chat-ipc";
import { useChatStore } from "./stores/chat.store";
import App from "./App.vue";

const chatPermissionLifecycle = vi.hoisted(() => ({
  synchronize: vi.fn(async () => undefined),
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
