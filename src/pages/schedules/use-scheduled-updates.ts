import { computed, onScopeDispose, watch } from "vue";
import { createScheduledTaskNativeClient, ScheduledTaskNativeError } from "../../api/scheduled-task-native-client";
import { onScheduledRunCreated } from "../../api/chat-history-events";
import type { ImportantUpdate, ImportantUpdates } from "../../api/generated/scheduled-task-ipc-v2.gen";
import { useChatStore } from "../../stores/chat.store";
import { usePermissionStore } from "../../stores/permission.store";
import { publishScheduledRunChanges } from "./scheduled-run-changes";

/** Read-only app-wide observation, not a scheduler or a second run state machine. */
export function useScheduledUpdates(
  changed: (item: ImportantUpdate, announce: boolean) => void,
  clear: () => void,
  client = createScheduledTaskNativeClient(),
  listenForCreation = onScheduledRunCreated,
) {
  const chat = useChatStore(); const permissions = usePermissionStore();
  const scope = computed(() => permissions.isReady && permissions.hasCapability("schedule.read") && permissions.selectedTenantId !== null
    ? `${permissions.selectedTenantId}:${permissions.authorizationRevision}` : null);
  const seen = new Map<string, ImportantUpdate["state"]>();
  const observed = new Map<string, {
    state: ImportantUpdate["state"]; done: boolean; verifyVisible: boolean; sessionId?: string; turnId?: string;
  }>();
  let sidebarInitialized = false;
  let recordHead: string | undefined;
  let sidebarReads = new AbortController();
  let initialized = false; let disposed = false; let epoch = 0; let busy = false;
  const startIntervals = [150, 350, 1000];
  let startCheck = startIntervals.length;
  let wakePending = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(ms: number) {
    clearTimeout(timer);
    if (!disposed && scope.value && chat.context) timer = setTimeout(() => { void refresh(); }, ms);
  }
  function resetSidebar() {
    sidebarReads.abort();
    sidebarReads = new AbortController();
    observed.clear();
    sidebarInitialized = false;
    startCheck = startIntervals.length;
    wakePending = false;
    recordHead = undefined;
    chat.scheduledSidebar.clear();
  }
  function needsSidebarRead(id: string, state: ImportantUpdate["state"]) {
    const prior = observed.get(id);
    if (!prior || prior.state !== state || !prior.done) return true;
    return prior.verifyVisible && !!prior.sessionId && !chat.scheduledSidebar.has(prior.sessionId)
      && chat.sessions.some(row => row.sessionId === prior.sessionId);
  }
  async function syncSidebar(feed: ImportantUpdates, contextId: string, signal: AbortSignal, changedPlans: Set<string>) {
    if (chat.phase === "binding" || chat.phase === "loading") return;
    const firstRead = !sidebarInitialized;
    const wanted = new Map(feed.items.filter(item => needsSidebarRead(item.run_id, item.state)).map(item => [item.run_id, item.plan_id]));
    const feedIds = new Set(feed.items.map(item => item.run_id));
    for (const [id, prior] of observed) {
      if (!feedIds.has(id) && !prior.done) wanted.set(id, "");
    }
    if (!wanted.size && !feed.truncated) { sidebarInitialized = true; return; }
    // The compact notification feed prioritizes attention. In a truncated feed, also follow new chronological records.
    let scanRecent = feed.truncated;
    let nextHead: string | undefined;
    let cursor: string | undefined;
    do {
      const { data } = await client.call("schedule_list_records_v1", { schemaVersion: 1, requestId: crypto.randomUUID(),
        contextId, payload: { limit: 50, ...(cursor ? { cursor } : {}) } });
      if (signal.aborted) return;
      for (const record of data.items) {
        const key = JSON.stringify(record.key);
        nextHead ??= key;
        if (key === recordHead) scanRecent = false;
        if (record.kind !== "run") continue;
        const id = record.key.run_id;
        const expectedPlan = wanted.get(id);
        wanted.delete(id);
        const state = record.attention === "needs_attention" ? "needs_attention"
          : record.run.native_outcome === "unobserved" ? "pending" : record.run.native_outcome;
        if ((!scanRecent && expectedPlan === undefined) || (expectedPlan && expectedPlan !== record.plan.plan_id)
          || record.run.run_id !== id || record.run.plan_id !== record.plan.plan_id || !needsSidebarRead(id, state)) continue;
        if (!firstRead && observed.get(id)?.state !== state) changedPlans.add(record.plan.plan_id);
        const { conversation_id: sessionId, local_turn_id: turnId } = record.conversation;
        const discover = !firstRead || state === "pending" || state === "needs_attention";
        let done = record.conversation.status === "deleted" || record.run.delivery_state === "cancelled" || record.run.native_outcome !== "unobserved";
        let verifyVisible = false;
        if (record.conversation.status === "available" && sessionId && turnId) {
          const marker = chat.scheduledSidebar.get(sessionId);
          // An active row already follows chat metadata. Only re-read its turn if that row or its run changes.
          if (state === "pending" && marker?.turnId === turnId && marker.state === "running" && record.run.delivery_state === "accepted") continue;
          try { done = await chat.syncScheduledSidebarTurn(record, discover, signal); }
          catch { done = false; } // One unavailable chat must not hide other runs.
          if (signal.aborted) return;
          verifyVisible = done && (chat.scheduledSidebar.get(sessionId)?.turnId === turnId || !chat.sessions.some(row => row.sessionId === sessionId));
        } else {
          const prior = observed.get(id);
          if (prior?.sessionId && chat.scheduledSidebar.get(prior.sessionId)?.turnId === prior.turnId) chat.scheduledSidebar.delete(prior.sessionId);
        }
        observed.delete(id);
        observed.set(id, { state, done, verifyVisible, sessionId, turnId });
      }
      cursor = data.next_cursor;
      if (!recordHead) scanRecent = false;
    } while (cursor && (wanted.size || scanRecent));
    for (const id of wanted.keys()) if (!feedIds.has(id)) observed.delete(id);
    while (observed.size > 1000) observed.delete(observed.keys().next().value!);
    recordHead = nextHead;
    sidebarInitialized = true;
  }
  async function refresh() {
    if (busy || disposed || !scope.value || !chat.context) return;
    busy = true; wakePending = false; const ticket = epoch; const context = chat.context.contextId;
    let delay = 3000;
    try {
      const result = await client.call("schedule_list_important_updates_v1", { schemaVersion: 1, requestId: crypto.randomUUID(), contextId: context, payload: {} });
      if (disposed || epoch !== ticket || chat.context?.contextId !== context) return;
      const changedPlans = new Set<string>();
      for (const item of result.data.items) {
        const previous = seen.get(item.run_id);
        if (previous !== item.state) {
          if (initialized) changedPlans.add(item.plan_id);
          // On open, old completions stay in history; unresolved attention is visible.
          changed(item, item.state !== "pending" && (initialized || item.state === "needs_attention"));
        }
        seen.delete(item.run_id); seen.set(item.run_id, item.state);
      }
      initialized = true;
      // The native feed is bounded. Retain only a bounded in-memory dedup history.
      while (seen.size > 1000) seen.delete(seen.keys().next().value!);
      if (chat.hasAction("read_sessions")) await syncSidebar(result.data, context, sidebarReads.signal, changedPlans);
      if (!disposed && epoch === ticket && chat.context?.contextId === context) publishScheduledRunChanges(context, changedPlans);
    } catch (error) {
      delay = 30000;
      if (epoch === ticket && error instanceof ScheduledTaskNativeError && ["scope_denied", "permission_denied", "context_invalid", "storage_disabled"].includes(error.code)) {
        resetSidebar();
        clear();
        // No capability or ordinary SQL15: wait for the authority/context watcher.
        delay = -1;
      }
    } finally {
      busy = false;
      if (ticket !== epoch || wakePending) schedule(0);
      else if (delay >= 0) schedule(delay === 3000 && startCheck < startIntervals.length ? startIntervals[startCheck++]! : delay);
    }
  }
  watch([scope, () => chat.context?.contextId, () => chat.hasAction("read_sessions")], ([key, context], previous) => {
    epoch++; clearTimeout(timer);
    resetSidebar();
    if (key !== previous?.[0] || !key || !context) { seen.clear(); initialized = false; clear(); }
    if (key && context) void refresh();
  }, { immediate: true, flush: "sync" });
  void listenForCreation(() => {
    if (disposed || !scope.value || !chat.context || !chat.hasAction("read_sessions")) return;
    startCheck = 0;
    wakePending = true;
    clearTimeout(timer);
    if (!busy) void refresh();
  }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => { /* Polling also supports older clients. */ });
  onScopeDispose(() => { disposed = true; epoch++; clearTimeout(timer); unlisten?.(); seen.clear(); resetSidebar(); clear(); });
  return { refresh };
}
