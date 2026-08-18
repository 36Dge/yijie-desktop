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
        { path: "/tasks", component: page },
        { path: "/chat", component: page },
        { path: "/settings", component: page },
      ],
    });
    await router.push("/tasks");
    await router.isReady();
    const wrapper = shallowMount(App, { global: { plugins: [pinia, router] } });

    await router.push("/chat");
    await flushPromises();

    expect(clearSelectedSession).not.toHaveBeenCalled();
    expect(store.phase).toBe("ready");
    wrapper.unmount();
  });
});
