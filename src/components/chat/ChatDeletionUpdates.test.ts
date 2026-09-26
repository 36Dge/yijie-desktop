// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { useChatStore } from "../../stores/chat.store";
import ChatDeletionUpdates from "./ChatDeletionUpdates.vue";

const warning = vi.hoisted(() => vi.fn());
const historyChanged = vi.hoisted(() => ({ handler: (() => {}) as () => void, unlisten: vi.fn() }));
vi.mock("naive-ui", () => ({ useNotification: () => ({ warning }) }));
vi.mock("../../api/chat-history-events", () => ({ onChatHistoryChanged: async (handler: () => void) => {
  historyChanged.handler = handler;
  return historyChanged.unlisten;
} }));

describe("local history deletion notification", () => {
  it("announces the incomplete remote result once even when route cleanup clears the selection", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useChatStore();
    const wrapper = mount(ChatDeletionUpdates, { global: { plugins: [pinia] } });
    const status = { operationId: "019c1a00-0000-7000-8000-000000000007",
      desktopState: "complete" as const, hostState: "incomplete" as const, runtimeState: "incomplete" as const,
      outcomeCode: "local_history_deleted", lastErrorCode: null, requestedAt: 1, completedAt: 2, expiresAt: 3 };
    store.cleanupStatus = { ...status, completedAt: null };
    expect(warning).not.toHaveBeenCalled();
    store.cleanupStatus = status;
    store.cleanupStatus = null;
    store.cleanupStatus = { ...status };
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({
      title: "本地任务记录已删除", content: expect.stringContaining("无法确认"), duration: 0, closable: true,
    }));
    wrapper.unmount();
  });

  it("refreshes unselected sidebar records on native completion and defers while binding", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useChatStore();
    store.context = { contextId: "019c1a00-0000-7000-8000-000000000007",
      expiresAtEpochSeconds: 2_000_000_000, allowedActions: ["read_sessions"] };
    store.phase = "binding";
    const reload = vi.spyOn(store, "reloadSessions").mockResolvedValue();
    const wrapper = mount(ChatDeletionUpdates, { global: { plugins: [pinia] } });
    await flushPromises();
    historyChanged.handler();
    expect(reload).not.toHaveBeenCalled();
    store.phase = "ready";
    await flushPromises();
    expect(reload).toHaveBeenCalledOnce();
    historyChanged.handler();
    await flushPromises();
    expect(reload).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(historyChanged.unlisten).toHaveBeenCalled();
  });
});
