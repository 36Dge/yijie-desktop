import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { marketHostNativeClient, MarketChatError, marketChatErrorMessage, type MarketHostNativeClient } from "../api/market-host-native-client";
import type { Decision, MarketApproval, NativeObservation, ToolsReadMode } from "../domain/market-host-v2-native.generated";

/** Native events invalidate tool displays; the timer reads only lightweight approvals. */
export function useMarketChat(context: () => string | null, session: () => string | null, running: () => boolean, client: MarketHostNativeClient = marketHostNativeClient, nativeRevision?: () => string | undefined) {
  const observation = shallowRef<NativeObservation | null>(null);
  const connected = ref(false), refreshing = ref(false), deciding = ref<string | null>(null), error = ref<string | null>(null);
  const now = ref(Date.now());
  const uncertain = shallowRef<ReadonlySet<string>>(new Set());
  const uncertainBySession = new Map<string, ReadonlySet<string>>();
  const selectedTurnId = ref<string | null>(null);
  const historyObservation = shallowRef<NativeObservation | null>(null);
  const historyRefreshing = ref(false), historyError = ref<string | null>(null);
  const toolObservation = computed(() => selectedTurnId.value ? historyObservation.value : observation.value);
  let historyRevision = 0;
  let epoch = 0, mutation = 0, disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let read: Promise<void> | null = null;
  let queuedRead: ToolsReadMode | null = null;
  const readPriority = { none: 0, events: 1, history: 2 };
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  const managed = computed(() => observation.value?.managed === true);
  const ready = computed(() => session() === null || connected.value);
  const approvals = computed(() => observation.value?.approvals?.requests ?? []);
  const tools = computed(() => observation.value?.tools?.items ?? []);
  const pending = computed(() => approvals.value.some(item => item.state === "pending"));
  function scheduleExpiry(): void {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
    now.value = Date.now();
    const next = Math.min(...approvals.value.filter(a => a.state === "pending").map(a => a.decisionExpiresAtUnixMs ?? a.expiresAtUnixMs).filter(t => t > now.value));
    if (Number.isFinite(next)) expiryTimer = setTimeout(scheduleExpiry, Math.min(2147483647, next - now.value));
  }
  watch(approvals, scheduleExpiry);
  function actionable(item: MarketApproval): boolean {
    return connected.value && !deciding.value && !uncertain.value.has(item.approvalId) && item.state === "pending" && (item.decisionExpiresAtUnixMs ?? item.expiresAtUnixMs) > now.value;
  }
  function clearTimer(): void { if (timer !== null) clearTimeout(timer); timer = null; }
  function schedulePoll(generation: number): void {
    clearTimer();
    if (disposed || generation !== epoch || !context() || !session()) return;
    if (!running() && !pending.value && (connected.value || observation.value?.managed === false)) return;
    timer = setTimeout(() => { void refresh("none"); }, connected.value && (running() || pending.value) ? 1000 : 3000);
  }
  function refresh(mode: ToolsReadMode = "history"): Promise<void> {
    if (!context() || !session() || disposed) return Promise.resolve();
    if (queuedRead === null || readPriority[mode] > readPriority[queuedRead]) queuedRead = mode;
    if (read) return read;
    const generation = epoch;
    const request = (async () => {
      while (!disposed && generation === epoch && queuedRead !== null) {
        const requestedMode: ToolsReadMode = queuedRead; queuedRead = null;
        const contextId = context(), sessionId = session(), revision = mutation;
        if (!contextId || !sessionId) return;
        const current = () => !disposed && generation === epoch && revision === mutation && context() === contextId && session() === sessionId;
        const recovering = !connected.value;
        refreshing.value = true;
        try {
          const next = await client.observe(contextId, sessionId, undefined, requestedMode);
          if (!current()) continue;
          const previousTools = observation.value?.tools;
          const sameKnownTurn = next.availableTurns === undefined
            || next.availableTurns[0]?.nativeTurnId === previousTools?.nativeTurnId;
          const tools = requestedMode === "none" && next.tools === undefined && next.managed && sameKnownTurn ? previousTools : next.tools;
          observation.value = { ...next, ...(tools ? { tools } : {}) };
          connected.value = !next.remoteIssue && (!next.managed || next.approvals !== undefined);
          error.value = next.remoteIssue ? marketChatErrorMessage(new MarketChatError(next.remoteIssue)) : null;
          // Read-only proof can resolve an uncertain display, never resend a decision.
          const alreadyRequested = new Set(uncertain.value);
          for (const approval of next.approvals?.requests ?? []) {
            if (approval.state === "pending" && next.decisionFacts?.some(fact => fact.approvalId === approval.approvalId
              && fact.callRef === approval.identity.callRef && fact.nativeThreadId === approval.identity.nativeThreadId
              && fact.nativeTurnId === approval.identity.nativeTurnId && fact.argsDigest === approval.identity.argsDigest)) alreadyRequested.add(approval.approvalId);
          }
          uncertain.value = new Set([...alreadyRequested].filter(id => {
            const item = next.approvals?.requests.find(a => a.approvalId === id);
            if (item) return item.state === "pending";
            return !next.decisionFacts?.some(f => f.approvalId === id && f.kind === "acknowledged")
              && !tools?.items.some(t => t.correlation?.decisionReceipt?.approvalId === id);
          }));
          rememberUncertain(sessionId);
          if (uncertain.value.size) error.value = "批准结果待确认。已保留原决定，请刷新核对；当前不会再次发送决定。";
          if (recovering && connected.value && next.managed && requestedMode === "none" && next.tools === undefined) queuedRead = "history";
          if (requestedMode === "events") await refreshSelectedEvents(current);
        } catch (failure) {
          if (!current()) continue;
          connected.value = false; error.value = marketChatErrorMessage(failure);
        } finally { if (current()) { refreshing.value = false; now.value = Date.now(); } }
      }
    })();
    read = request;
    void request.finally(() => {
      if (read !== request) return;
      read = null;
      // A notification can queue another read after the loop settles but before
      // this cleanup runs. Drain it even when the idle timer is stopped.
      if (queuedRead !== null && generation === epoch && !disposed) void refresh(queuedRead);
      else schedulePoll(generation);
    });
    return request;
  }
  function rememberUncertain(sessionId: string): void {
    if (uncertain.value.size) uncertainBySession.set(sessionId, uncertain.value);
    else uncertainBySession.delete(sessionId);
  }
  async function refreshSelectedEvents(stillCurrent: () => boolean): Promise<void> {
    const contextId = context(), sessionId = session(), turnId = selectedTurnId.value;
    if (!stillCurrent() || !contextId || !sessionId || !turnId) return;
    const generation = epoch;
    const revision = ++historyRevision;
    const current = () => !disposed && generation === epoch && context() === contextId && session() === sessionId
      && historyRevision === revision && selectedTurnId.value === turnId;
    historyRefreshing.value = true;
    try {
      // Share the existing coalesced read queue. Historical tools never supply
      // the live approval list, and a later selection invalidates this response.
      const next = await client.observe(contextId, sessionId, turnId, "events");
      if (!current()) return;
      historyObservation.value = next;
      historyError.value = next.tools ? null : "当前无法读取此轮的工具结果，已保留历史选择；可稍后刷新。";
    } catch (failure) { if (current()) historyError.value = marketChatErrorMessage(failure); }
    finally { if (current()) historyRefreshing.value = false; }
  }
  async function selectTurn(turnId: string | null): Promise<void> {
    const contextId = context(), sessionId = session(), generation = epoch;
    if (turnId !== null && !observation.value?.availableTurns?.some(t => t.nativeTurnId === turnId)) return;
    const revision = ++historyRevision;
    selectedTurnId.value = turnId; historyObservation.value = null; historyError.value = null;
    historyRefreshing.value = false;
    if (!turnId || !contextId || !sessionId || disposed) return;
    const current = () => !disposed && epoch === generation && revision === historyRevision && context() === contextId && session() === sessionId;
    historyRefreshing.value = true;
    try {
      const next = await client.observe(contextId, sessionId, turnId, "history");
      if (!current()) return;
      historyObservation.value = next;
      if (!next.tools) historyError.value = "当前无法读取此轮的工具结果，已保留历史选择；可稍后刷新。";
    } catch (failure) { if (current()) historyError.value = marketChatErrorMessage(failure); }
    finally { if (current()) historyRefreshing.value = false; }
  }
  async function decide(approvalId: string, decision: Decision): Promise<void> {
    now.value = Date.now();
    const contextId = context(), sessionId = session();
    const item = approvals.value.find(a => a.approvalId === approvalId);
    if (!contextId || !sessionId || !item || !actionable(item)) return;
    if ([...uncertainBySession.values()].reduce((count, ids) => count + ids.size, 0) >= 128) {
      error.value = "待确认的审批较多，请先刷新核对已有决定。"; return;
    }
    const generation = epoch, decisionId = crypto.randomUUID();
    mutation++; deciding.value = approvalId; error.value = null;
    // Keep the id before crossing IPC. Neither timeouts nor a refreshed pending
    // projection grant a second submission with a new decision identity.
    uncertain.value = new Set([...uncertain.value, approvalId]);
    rememberUncertain(sessionId);
    try {
      const result = await client.decide(contextId, { sessionId, approvalId, expectedRevision: item.revision, decisionId, decision });
      if (disposed || generation !== epoch) return;
      if (observation.value?.approvals) observation.value = { ...observation.value, approvals: { ...observation.value.approvals, requests: observation.value.approvals.requests.map(a => a.approvalId === approvalId ? result : a) } };
      uncertain.value = new Set([...uncertain.value].filter(id => id !== approvalId));
      rememberUncertain(sessionId);
    } catch (failure) { if (!disposed && generation === epoch) { connected.value = false; error.value = marketChatErrorMessage(failure); } }
    finally { if (!disposed && generation === epoch) { deciding.value = null; await refresh("none"); } }
  }
  watch([context, session], (values) => {
    epoch++; clearTimer(); read = null; queuedRead = null;
    observation.value = null; connected.value = false; refreshing.value = false; deciding.value = null; error.value = null;
    uncertain.value = values[1] ? uncertainBySession.get(values[1]) ?? new Set() : new Set();
    historyRevision++; selectedTurnId.value = null; historyObservation.value = null;
    historyRefreshing.value = false; historyError.value = null;
    void refresh("history");
  }, { immediate: true, flush: "sync" });
  watch(running, (active, previous) => {
    if (active && !previous) void refresh("none");
    else if (!active && previous) {
      const generation = epoch;
      void refresh(nativeRevision ? "events" : "history").then(() => {
        // Cancellation can end the stream before its last MCP event reaches
        // the cache. Reconcile unfinished items once from native history;
        // never turn this into idle polling or infer a terminal result.
        if (nativeRevision && !disposed && generation === epoch && !running()
          && tools.value.some(item => item.state === "in_progress")) void refresh("history");
      });
    }
  });
  if (nativeRevision) watch(nativeRevision, (value, previous) => {
    if (value !== undefined && value !== previous) void refresh("events");
  });
  onBeforeUnmount(() => { disposed = true; epoch++; clearTimer(); if (expiryTimer !== null) clearTimeout(expiryTimer); });
  return { observation, managed, ready, connected, refreshing, deciding, error, approvals, tools, pending, uncertain, actionable, refresh, decide, selectedTurnId, toolObservation, historyRefreshing, historyError, selectTurn };
}
