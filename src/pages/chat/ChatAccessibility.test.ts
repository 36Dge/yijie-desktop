// @vitest-environment happy-dom

import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatProject } from "../../domain/chat-ipc";
import { useChatStore } from "../../stores/chat.store";
import ChatPage from "./ChatPage.vue";

const PROJECT: ChatProject = Object.freeze({
  projectId: "019c1a00-0000-7000-8000-000000000001",
  safeName: "Synthetic Accessibility Workspace",
  pinnedAt: null,
  lastUsedAt: 1,
  available: true,
});

async function mountReadyEntry() {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useChatStore(pinia);
  store.phase = "ready";
  store.context = {
    contextId: "019c1a00-0000-7000-8000-000000000002",
    expiresAtEpochSeconds: 2_000_000_000,
    allowedActions: ["read_projects", "use_project", "create_session"],
  };
  store.projects = [PROJECT];
  store.localReadiness = {
    lifecycle: "ready",
    host: "ready",
    runtime: "ready",
    storage: "ready",
    canSend: true,
    issueCode: null,
    retryable: false,
    recovery: "none",
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/chat", component: ChatPage }],
  });
  await router.push("/chat");
  await router.isReady();
  const wrapper = mount(ChatPage, {
    attachTo: document.body,
    global: { plugins: [pinia, router] },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FEAT-126 production chat accessibility", () => {
  it("has no serious or critical axe violations in the ready new-task surface", async () => {
    const wrapper = await mountReadyEntry();
    const results = await axe.run(wrapper.element, {
      rules: {
        // happy-dom has no layout engine, so contrast is verified in the browser matrix.
        "color-contrast": { enabled: false },
      },
    });
    const blocking = results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical",
    );
    expect(blocking).toEqual([]);
  });
});
