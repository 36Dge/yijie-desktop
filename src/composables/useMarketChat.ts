import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { marketHostNativeClient, marketChatErrorMessage, type MarketHostNativeClient } from "../api/market-host-native-client";
import type { Decision, MarketApproval, NativeObservation } from "../domain/market-host-native.generated";

/** A scoped, bounded read loop. Unknown decisions only reconcile; never resend. */
export function useMarketChat(context: () => string | null, session: () => string | null, running: () => boolean, client: MarketHostNativeClient = marketHostNativeClient) {
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
  const managed = computed(() => observation.value?.managed === true);
  const ready = computed(() => session() === null || connected.value);
  const approvals = computed(() => observation.value?.approvals?.requests ?? []);
  const tools = computed(() => observation.value?.tools?.items ?? []);
  const pending = computed(() => approvals.value.some(item => item.state === "pending"));
  function actionable(item: MarketApproval): boolean {
    return connected.value && !deciding.value && !uncertain.value.has(item.approvalId) && item.state === "pending" && item.expiresAtUnixMs > now.value;
  }
  function clearTimer(): void { if (timer !== null) clearTimeout(timer); timer = null; }
  function refresh(): Promise<void> {
    if (read) return read;
    const contextId = context(), sessionId = session(), generation = epoch, revision = mutation;
    if (!contextId || !sessionId || disposed) return Promise.resolve();
    const current = () => !disposed && generation === epoch && revision === mutation && context() === contextId && session() === sessionId;
    refreshing.value = true;
    const request = (async () => {
      try {
        const next = await client.observe(contextId, sessionId);
        if (!current()) return;
        observation.value = next; connected.value = true; error.value = null;
        // Missing observations do not prove a decision failed or completed.
        uncertain.value = new Set([...uncertain.value].filter(id => {
          const item = next.approvals?.requests.find(a => a.approvalId === id);
          return !item || item.state === "pending";
        }));
        rememberUncertain(sessionId);
        if (uncertain.value.size) error.value = "批准结果待确认。已保留原决定，请刷新核对；当前不会再次发送决定。";
      } catch (failure) {
        if (!current()) return;
        connected.value = false; error.value = marketChatErrorMessage(failure);
      } finally { if (current()) { refreshing.value = false; now.value = Date.now(); } }
    })();
    read = request;
    void request.finally(() => { if (read === request) read = null; });
    return request;
  }
  function rememberUncertain(sessionId: string): void {
    if (uncertain.value.size) uncertainBySession.set(sessionId, uncertain.value);
    else uncertainBySession.delete(sessionId);
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
      const next = await client.observe(contextId, sessionId, turnId);
      if (!current()) return;
      historyObservation.value = next;
      if (!next.tools) historyError.value = "当前无法读取此轮的工具结果，已保留历史选择；可稍后刷新。";
    } catch (failure) { if (current()) historyError.value = marketChatErrorMessage(failure); }
    finally { if (current()) historyRefreshing.value = false; }
  }
  async function poll(generation: number): Promise<void> {
    await refresh();
    if (disposed || generation !== epoch || !context() || !session()) return;
    timer = setTimeout(() => { void poll(generation); }, connected.value && (running() || pending.value) ? 1000 : 3000);
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
    finally { if (!disposed && generation === epoch) { deciding.value = null; await refresh(); } }
  }
  watch([context, session], (values) => {
    epoch++; clearTimer(); read = null;
    observation.value = null; connected.value = false; refreshing.value = false; deciding.value = null; error.value = null;
    uncertain.value = values[1] ? uncertainBySession.get(values[1]) ?? new Set() : new Set();
    historyRevision++; selectedTurnId.value = null; historyObservation.value = null;
    historyRefreshing.value = false; historyError.value = null;
    void poll(epoch);
  }, { immediate: true, flush: "sync" });
  onBeforeUnmount(() => { disposed = true; epoch++; clearTimer(); });
  return { observation, managed, ready, connected, refreshing, deciding, error, approvals, tools, pending, uncertain, actionable, refresh, decide, selectedTurnId, toolObservation, historyRefreshing, historyError, selectTurn };
}
