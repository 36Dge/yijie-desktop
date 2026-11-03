import { ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { ChatSession } from "../domain/chat-ipc";
import type { SidebarPreferenceStorage } from "../domain/sidebar-preference";
import { readChatReadingReceipts, writeChatReadingReceipts, type ChatReadingReceipt } from "../domain/chat-reading-preference";

export const useChatReadingStore = defineStore("chat-reading", () => {
  const receipts = shallowRef<readonly ChatReadingReceipt[]>([]);
  const latestRequest = shallowRef<{ id: number; sessionId: string; acknowledge: boolean } | null>(null);
  const knownTurns = ref<Record<string, string>>({});
  let requestSequence = 0;
  let hydrated = false;
  let storage: SidebarPreferenceStorage | undefined;

  function hydrate(nextStorage?: SidebarPreferenceStorage): void {
    if (hydrated) return;
    const saved = readChatReadingReceipts(nextStorage);
    receipts.value = saved.entries;
    storage = saved.writable ? nextStorage : undefined;
    hydrated = true;
  }

  function commit(entries: readonly ChatReadingReceipt[]): void {
    receipts.value = entries;
    // Viewing a task must remain usable when ordinary UI preference storage is unavailable.
    try { if (storage) writeChatReadingReceipts(storage, entries); } catch { /* keep this session's receipt */ }
  }

  function markViewed(session: ChatSession, turnId: string | null): void {
    if (session.latestTurnStatus !== "completed") return;
    const old = receipts.value.find(entry => entry.sessionId === session.sessionId);
    if (old?.activityAt === session.lastActivityAt && old.turnId === turnId) return;
    commit([...receipts.value.filter(entry => entry.sessionId !== session.sessionId), {
      sessionId: session.sessionId, activityAt: session.lastActivityAt, turnId,
    }]);
  }

  function hasUnreadCompletion(session: ChatSession): boolean {
    if (session.latestTurnStatus !== "completed") return false;
    if (latestRequest.value?.sessionId === session.sessionId && latestRequest.value.acknowledge) return false;
    const receipt = receipts.value.find(entry => entry.sessionId === session.sessionId);
    if (!receipt) return true;
    const knownTurn = knownTurns.value[session.sessionId];
    if (receipt.turnId && knownTurn && receipt.turnId !== knownTurn) return true;
    return session.lastActivityAt > receipt.activityAt;
  }

  function observeSessions(sessions: readonly ChatSession[]): void {
    // Reset at a new run even if two turns share the same second-resolution activity time.
    const changed = new Set(sessions.filter(session => ["queued", "streaming", "inProgress", "failed", "interrupted"].includes(session.latestTurnStatus ?? "")).map(session => session.sessionId));
    const retained = receipts.value.filter(entry => !changed.has(entry.sessionId));
    if (retained.length !== receipts.value.length) commit(retained);
    if (latestRequest.value && changed.has(latestRequest.value.sessionId)) {
      latestRequest.value = { ...latestRequest.value, acknowledge: false };
    }
  }

  function observeLatestTurn(session: ChatSession, turnId: string, completed: boolean): void {
    knownTurns.value[session.sessionId] = turnId;
    // A read/resync can update activityAt for the very same completed turn.
    // Do not turn that metadata refresh into a new unread notification.
    if (completed && receipts.value.some(entry => entry.sessionId === session.sessionId && entry.turnId === turnId)) {
      markViewed(session, turnId);
    }
  }

  function requestLatest(session: ChatSession): void {
    latestRequest.value = { id: ++requestSequence, sessionId: session.sessionId, acknowledge: session.latestTurnStatus === "completed" };
    markViewed(session, null);
  }

  function finishLatest(id: number, session: ChatSession, turnId: string, completed: boolean): void {
    if (latestRequest.value?.id !== id || latestRequest.value.sessionId !== session.sessionId) return;
    if (latestRequest.value.acknowledge && completed) markViewed(session, turnId);
    latestRequest.value = null;
  }

  function cancelLatest(): void { latestRequest.value = null; }

  return { receipts, latestRequest, hydrate, hasUnreadCompletion, observeSessions, observeLatestTurn, requestLatest, finishLatest, cancelLatest };
});
