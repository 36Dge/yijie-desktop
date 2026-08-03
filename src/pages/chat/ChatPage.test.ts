// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatHistoryPage, ChatProject, ChatSession } from "../../domain/chat-ipc";
import { useChatStore } from "../../stores/chat.store";
import ChatPage from "./ChatPage.vue";

const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";
const TURN_ID = "019c1a00-0000-7000-8000-000000000003";

const PROJECT: ChatProject = {
  projectId: PROJECT_ID,
  safeName: "Synthetic Workspace",
  pinnedAt: null,
  lastUsedAt: 1,
  available: true,
};

const SESSION: ChatSession = {
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  title: "本地合成任务",
  titleSource: "fallback",
  pinnedAt: null,
  lastActivityAt: 3,
  latestTurnStatus: "completed",
  projectAvailable: true,
};

const HISTORY: ChatHistoryPage = {
  turns: [{
    turnId: TURN_ID,
    status: "completed",
    terminalAt: 3,
    reasoningStatus: "complete",
    reasoningReasonCode: null,
    messages: [
      { messageId: "019c1a00-0000-7000-8000-000000000004", role: "user", content: "检查标题", status: "complete", ordinal: 1, createdAt: 1 },
      { messageId: "019c1a00-0000-7000-8000-000000000005", role: "assistant", content: "标题检查完成", status: "complete", ordinal: 2, createdAt: 2 },
    ],
    reasoning: [{ itemOrdinal: 0, status: "complete", reasonCode: null, totalBytes: 12, partCount: 1, finalizedAtMs: 2 }],
  }],
  nextCursor: null,
};

async function mountPage(path: string, active = false) {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useChatStore(pinia);
  store.phase = active ? "ready" : "ready";
  store.context = {
    contextId: "019c1a00-0000-7000-8000-000000000006",
    expiresAtEpochSeconds: 2_000_000_000,
    allowedActions: [
      "read_sessions", "create_session", "submit_turn", "rename_session", "pin_session",
      "interrupt_turn", "delete_session", "read_projects", "use_project", "pin_project",
      "remove_project", "read_cleanup",
    ],
  };
  store.projects = [PROJECT];
  store.sessions = active ? [SESSION] : [];
  store.selectedSessionId = active ? SESSION_ID : null;
  store.history = active ? HISTORY : null;
  store.localReadiness = {
    lifecycle: "ready", host: "ready", runtime: "ready", storage: "ready",
    canSend: true, issueCode: null, retryable: false, recovery: "none",
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: ChatPage },
      { path: "/chat/:sessionId", component: ChatPage },
      { path: "/settings", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(ChatPage, { attachTo: document.body, global: { plugins: [pinia, router] } });
  await flushPromises();
  return { wrapper, store, router };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FEAT-126 ChatPage", () => {
  it("creates exactly one session from the real composer and routes only after success", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    const createSession = vi.spyOn(store, "createSession").mockResolvedValue(SESSION_ID);
    await wrapper.get("textarea").setValue("检查标题");
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith(PROJECT_ID, "检查标题");
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/模型选择|推理强度|语音输入/);
  });

  it("keeps input and displays stable recovery copy when create fails", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    vi.spyOn(store, "createSession").mockRejectedValue(new Error("synthetic raw error /private/path"));
    await wrapper.get("textarea").setValue("保留这段输入");
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();

    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("保留这段输入");
    expect(router.currentRoute.value.path).toBe("/chat");
    expect(wrapper.text()).toContain("本地服务暂时繁忙");
    expect(wrapper.text()).not.toContain("/private/path");
  });

  it("renders historical and streaming assistant/raw reasoning as literal selectable text", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    expect(wrapper.text()).toContain("检查标题");
    expect(wrapper.text()).toContain("标题检查完成");
    expect(wrapper.text()).toContain("模型推理记录");
    expect(wrapper.find('[aria-label="复制"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label*="赞"]').exists()).toBe(false);

    store.phase = "streaming";
    store.liveReasoning = [{ itemOrdinal: 0, contentIndex: 0, text: "<script>not executable</script>" }];
    store.liveAssistantText = "正在生成的回答";
    await flushPromises();
    expect(wrapper.text()).toContain("<script>not executable</script>");
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find('[aria-label="停止生成"]').exists()).toBe(true);
  });

  it("opens the read-only permission policy without exposing writable approval", async () => {
    const { wrapper } = await mountPage("/chat");
    await wrapper.get(".chat-composer__permission").trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("只读访问 · 禁止写入");
    expect(document.body.textContent).toContain("不能在页面中提升权限");
    expect(document.body.textContent).not.toContain("允许写入");
  });

  it("projects cleanup pending instead of removing the session optimistically", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    store.cleanupStatus = {
      operationId: "019c1a00-0000-7000-8000-000000000007",
      desktopState: "complete",
      hostState: "pending",
      runtimeState: "pending",
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    };
    await flushPromises();
    expect(wrapper.text()).toContain("正在永久删除任务");
    expect(wrapper.text()).not.toContain("任务已永久删除");
  });
});
