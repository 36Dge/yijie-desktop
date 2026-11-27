// @vitest-environment happy-dom
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { NDialogProvider, NMessageProvider } from "naive-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatModelClient, chatModelsEnabled, defaultModelProfile, kimiK31Candidate, parseModelCatalog } from "../../../api/chat-model-client";
import { runtimePermissionClient } from "../../../api/runtime-permission-client";
import { modelDefinitions as legacyModels } from "../../../domain/chat-models.generated";
import { modelDefinitions as currentModels } from "../../../domain/chat-models-v2.generated";
import { createAppRouteRecords } from "../../../router";
import { useChatStore, type ChatSubmissionResult } from "../../../stores/chat.store";
import ChatPage from "../ChatPage.vue";
import UpcomingTaskPreview from "./UpcomingTaskPreview.vue";

const ipc = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@tauri-apps/api/core", async original => ({ ...await original<typeof import("@tauri-apps/api/core")>(), invoke: ipc }));
const drag = vi.hoisted(() => ({ unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => drag.unlisten }) }));

const toast = "新版服务未接通真实服务，请切到已发布版本";
const released = 'input[value="published"]';
const upcoming = 'input[value="upcoming"]';
let view: VueWrapper;

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(runtimePermissionClient, "get").mockResolvedValue({ mode: "ask", busy: false, fullAccessConfirmed: false });
  if (chatModelsEnabled) {
    const profiles = kimiK31Candidate ? currentModels : legacyModels;
    vi.spyOn(chatModelClient, "catalog").mockResolvedValue(parseModelCatalog({
      schema_version: kimiK31Candidate ? 2 : 1, default_profile: defaultModelProfile,
      models: profiles.map(profile => ({ profile, available: true, reason: "ready" })),
    }));
    vi.spyOn(chatModelClient, "state").mockResolvedValue({ profileId: "minimax-m3-high-v1", revision: 1, state: "ready" });
  }
});
afterEach(() => {
  view?.unmount();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function openChat() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const chat = useChatStore(pinia);
  chat.context = {
    contextId: "019c1a00-0000-7000-8000-000000000006",
    expiresAtEpochSeconds: 2_000_000_000,
    allowedActions: ["create_session", "read_sessions", "submit_turn", "use_project"],
  };
  chat.phase = "ready";
  chat.draftTarget = { type: "new" };
  chat.draftTargetReady = true;
  chat.localReadiness = { lifecycle: "ready", host: "ready", runtime: "ready", storage: "ready", canSend: true, issueCode: null, retryable: false, recovery: "none" };
  const router = createRouter({ history: createMemoryHistory(), routes: createAppRouteRecords(undefined, true) });
  await router.push("/chat");
  await router.isReady();
  view = mount(defineComponent({ setup: () => () =>
    h(NMessageProvider, null, { default: () => h(NDialogProvider, null, { default: () => h(RouterView) }) }),
  }), { attachTo: document.body, global: { plugins: [pinia, router] } });
  await flushPromises();
  return { chat, router };
}

describe("new task versions", () => {
  async function openPreviewAlone() {
    setActivePinia(undefined);
    view = mount(defineComponent({ setup: () => () =>
      h(NMessageProvider, null, { default: () => h(UpcomingTaskPreview, { text: "预览任务", task: "image" }) }),
    }), { attachTo: document.body });
    await flushPromises();
  }

  it.each([
    ["添加", "添加图片或文件"], ["关联店铺", "授权新店铺"], ["MiniMax-M3", "Kimi K3.1 Pro"],
    ["选择工作空间", "选择本地文件夹"], ["权限设置", "完全访问"],
  ])("opens the %s menu locally and shows the service toast on selection", async (label, option) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await openPreviewAlone();
    await view.get(`button[aria-label="${label}"]`).trigger("click");
    await flushPromises();
    const menu = document.querySelector(`[role="menu"][aria-label="${label}"]`);
    expect(menu).not.toBeNull();
    const item = new DOMWrapper(menu!).findAll('[role="menuitem"]').find(button => button.text() === option);
    expect(item).toBeDefined();
    await item!.trigger("click");
    await flushPromises();
    expect(document.querySelector(".n-message__content")?.textContent).toBe(toast);
    expect(view.get("textarea").element.value).toBe("预览任务");
    expect(ipc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows line breaks and IME composition, and only shows a toast when Enter submits", async () => {
    await openPreviewAlone();
    const input = view.get("textarea");
    await input.trigger("keydown", { key: "Enter", shiftKey: true });
    await input.trigger("compositionstart");
    await input.trigger("keydown", { key: "Enter" });
    await input.trigger("compositionend");
    expect(document.body.textContent).not.toContain(toast);
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(document.querySelector(".n-message__content")?.textContent).toBe(toast);
    expect(ipc).not.toHaveBeenCalled();
  });

  it("keeps the published draft and its leases, and stops published polling and drop handling in the preview", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_YIJIE_ENV", "local");
    vi.stubEnv("VITE_YIJIE_LOCAL_PROFILE", "demo_fast");
    vi.stubEnv("VITE_YIJIE_RUNTIME_PERMISSIONS_ENABLED", "true");
    const permissions = vi.mocked(runtimePermissionClient.get);
    const { chat } = await openChat();
    const send = vi.spyOn(chat, "createSessionWithResult").mockResolvedValue({ status: "not_accepted" });
    expect(view.get<HTMLInputElement>(released).element.checked).toBe(true);
    expect(view.findComponent(UpcomingTaskPreview).exists()).toBe(false);
    await view.get("textarea").setValue("已发布草稿");
    expect(permissions).toHaveBeenCalled();
    permissions.mockClear();
    if (chatModelsEnabled) vi.mocked(chatModelClient.catalog).mockClear();
    ipc.mockClear();
    const fetch = vi.spyOn(window, "fetch");

    await view.get(upcoming).setValue();
    await flushPromises();
    expect(view.findComponent(ChatPage).exists()).toBe(false);
    expect(drag.unlisten).toHaveBeenCalledOnce();
    expect(view.get("textarea").element.value).toBe("");
    expect(view.findAll(".commerce-nav label").map(item => item.text())).toEqual([
      "电商生图", "电商视频", "选品分析", "listing 优化", "合规检测", "达人建联",
    ]);
    await view.get('input[value="video"]').setValue();
    await view.get("textarea").setValue("预览视频草稿");
    await view.get("form").trigger("submit");
    await flushPromises();
    expect(document.body.textContent).toContain(toast);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(5200);
    expect(permissions).not.toHaveBeenCalled();
    if (chatModelsEnabled) expect(chatModelClient.catalog).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(ipc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    await view.get(released).setValue();
    expect(view.get("textarea").element.value).toBe("已发布草稿");
    expect(view.find(".commerce-nav").exists()).toBe(false);
    await view.get(upcoming).setValue();
    expect(view.get("textarea").element.value).toBe("预览视频草稿");
    expect(view.get<HTMLInputElement>('input[value="video"]').element.checked).toBe(true);
  });

  it("finishes a published submission on the same chat page and opens its accepted session", async () => {
    const { chat, router } = await openChat();
    const pageId = view.getComponent(ChatPage).vm.$.uid;
    let finish!: (response: ChatSubmissionResult) => void;
    const send = vi.spyOn(chat, "createSessionWithResult").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await view.get("textarea").setValue("正式任务");
    await view.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[1]).toBe("正式任务");
    expect(view.get<HTMLInputElement>(upcoming).element.disabled).toBe(true);
    const sessionId = "019c1a00-0000-7000-8000-000000000002";
    finish({
      status: "local_durable_accepted", draftTarget: { type: "new" }, sessionId,
      turnId: "019c1a00-0000-7000-8000-000000000003", operationId: "019c1a00-0000-7000-8000-000000000020",
    });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/chat/${sessionId}`);
    expect(view.getComponent(ChatPage).vm.$.uid).toBe(pageId);
    expect(view.find(upcoming).exists()).toBe(false);
    await router.push("/chat");
    await flushPromises();
    expect(view.get<HTMLInputElement>(upcoming).element.disabled).toBe(false);
  });

  it("resets the preview on navigation and keeps sessions and scheduled drafts on the published page", async () => {
    const { router } = await openChat();
    for (const destination of ["/chat/019c1a00-0000-7000-8000-000000000002", "/chat?create=schedule"]) {
      await view.get(upcoming).setValue();
      await view.get("textarea").setValue("预览专用");
      await router.push(destination);
      await flushPromises();
      expect(view.find(upcoming).exists()).toBe(false);
      expect(view.findComponent(ChatPage).exists()).toBe(true);
      await router.push("/chat");
      await flushPromises();
      expect(view.get<HTMLInputElement>(released).element.checked).toBe(true);
      expect(view.get("textarea").element.value).toBe("");
    }
  });
});
