import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { ConnectorClientError, marketConnectorClient, type MarketConnectorClient } from "../api/market-connectors-client";
import type { Installation, MutationResult, Operation, Snapshot } from "../domain/market-connectors.generated";
import { connectorCanReopen, connectorErrorMessage, connectorOperationStatus, connectorViews } from "../domain/market-connectors-ui";
import type { ConnectorAction, ConnectorPageView } from "../domain/connector-ui";

type MutationAction = Exclude<ConnectorAction, "retry" | "cancel" | "reopen">;
interface UnconfirmedOperation {
  readonly operationId: string;
  readonly action: MutationAction;
  readonly installation: Installation | null;
  readonly receipt?: Operation;
  readonly resubmitAllowed?: boolean;
}

export function createMarketConnectorStoreDefinition(client: MarketConnectorClient, storeId = "market-connectors") {
  return defineStore(storeId, () => {
    const contextId = ref<string | null>(null);
    const authorityScope = ref<string | null>(null);
    const snapshot = shallowRef<Snapshot | null>(null);
    const phase = ref<ConnectorPageView["phase"]>("loading");
    const refreshing = ref(false), error = ref<string | null>(null);
    const pending = shallowRef<ReadonlySet<string>>(new Set());
    const unconfirmed = shallowRef<Readonly<Record<string, UnconfirmedOperation>>>({});
    const operationErrors = shallowRef<Readonly<Record<string, string>>>({});
    let scopeEpoch = 0, readEpoch = 0, mutationEpoch = 0;
    let operationObservation = false, operationPollBusy = false;
    let operationTimer: ReturnType<typeof setTimeout> | null = null;
    const operationBudgets = new Map<string, { startedAt: number; attempts: number; failures: number; lastRead: number }>();
    const canManage = computed(() => snapshot.value?.capabilities.includes("connector.manage") === true);
    const selectionAvailable = computed(() => contextId.value !== null && snapshot.value?.executionAvailable === true && snapshot.value.capabilities.includes("connector.use") && !error.value && phase.value === "ready");
    const entries = computed(() => {
      if (!snapshot.value) return [];
      return connectorViews(snapshot.value, pending.value).map(entry => {
        if (error.value || !contextId.value || phase.value !== "ready") return { ...entry, selectable: false, actions: [] };
        const attempt = unconfirmed.value[entry.id];
        if (attempt && !pending.value.has(entry.id)) {
          const permission = ["configure", "authorize"].includes(attempt.action) ? "connector.credentials.manage" : "connector.manage";
          const canMutate = snapshot.value?.capabilities.includes(permission) === true;
          const actions: ConnectorAction[] = !attempt.resubmitAllowed || canMutate ? ["retry"] : [];
          if (attempt.receipt?.cancellable && canMutate) actions.push("cancel");
          if (connectorCanReopen(attempt.receipt, snapshot.value?.capabilities.includes("connector.credentials.manage") === true)) actions.push("reopen");
          return { ...entry, selectable: false, busy: attempt.receipt?.status === "pending", status: connectorOperationStatus(attempt.receipt, attempt.resubmitAllowed), actions };
        }
        return entry;
      });
    });
    const model = computed<ConnectorPageView>(() => ({ phase: phase.value, entries: entries.value, refreshing: refreshing.value, canManage: canManage.value, error: error.value }));

    function setError(id: string, message: string | null): void {
      const next = { ...operationErrors.value };
      if (message) next[id] = message; else delete next[id];
      operationErrors.value = next;
    }
    function setPending(id: string, active: boolean): void {
      const next = new Set(pending.value);
      if (active) next.add(id); else next.delete(id);
      pending.value = next;
    }
    function forgetAttempt(id: string): void { const next = { ...unconfirmed.value }; delete next[id]; unconfirmed.value = next; }
    function installation(id: string): Installation | undefined { return snapshot.value?.installations.find(item => item.serviceId === id && item.status !== "removed"); }
    function clear(): void {
      stopOperationTimer(); operationBudgets.clear(); mutationEpoch++;
      scopeEpoch++; readEpoch++; contextId.value = null; authorityScope.value = null; snapshot.value = null; phase.value = "loading";
      refreshing.value = false; error.value = null; pending.value = new Set(); unconfirmed.value = {}; operationErrors.value = {};
    }
    async function bind(context: string | null, scope: string | null = context): Promise<void> {
      if (scope === null) { clear(); return; }
      if (scope !== authorityScope.value) { clear(); authorityScope.value = scope; }
      else if (context === contextId.value) return;
      // Contexts are short-lived authority leases. A renewal invalidates every
      // in-flight response, but the same local tenant keeps its immutable intent
      // so an interrupted mutation can be queried with the renewed context.
      scopeEpoch++; readEpoch++; contextId.value = context;
      pending.value = new Set(); refreshing.value = false; error.value = null; phase.value = "loading";
      if (context) await refresh();
    }
    async function refresh(): Promise<void> {
      const context = contextId.value;
      if (!context) return;
      const scope = scopeEpoch, read = ++readEpoch;
      refreshing.value = true;
      if (!snapshot.value) phase.value = "loading";
      try {
        const result = await client.snapshot(context);
        if (scope !== scopeEpoch || read !== readEpoch || context !== contextId.value) return;
        snapshot.value = result;
        phase.value = result.capabilities.includes("connector.read") ? "ready" : "permission-denied";
        if (phase.value === "permission-denied") { snapshot.value = null; unconfirmed.value = {}; operationErrors.value = {}; }
        error.value = phase.value === "permission-denied" ? connectorErrorMessage("permission_denied") : null;
      } catch (failure) {
        if (scope !== scopeEpoch || read !== readEpoch) return;
        const code = failure instanceof ConnectorClientError ? failure.code : "temporarily_unavailable";
        error.value = connectorErrorMessage(code);
        if (code === "permission_denied" || code === "context_invalid") {
          snapshot.value = null; phase.value = "permission-denied";
          if (code === "permission_denied") { unconfirmed.value = {}; operationErrors.value = {}; }
        }
        else if (code === "unsupported_capability") { snapshot.value = null; phase.value = "incompatible"; }
        else phase.value = snapshot.value ? "ready" : "unavailable";
      } finally { if (scope === scopeEpoch && read === readEpoch) refreshing.value = false; scheduleOperationPoll(); }
    }
    function acceptMutation(result: MutationResult): void {
      const current = snapshot.value;
      if (!current) return;
      const previous = current.installations.find(item => item.serviceId === result.installation.serviceId);
      if (previous && previous.revision > result.installation.revision) return;
      snapshot.value = { ...current, installations: [...current.installations.filter(item => item.serviceId !== result.installation.serviceId), ...(result.installation.status === "removed" ? [] : [result.installation])] };
    }
    function receiptError(receipt: Operation): string | null {
      return receipt.status === "failed" ? connectorErrorMessage(receipt.errorCode) : receipt.status === "unknown" ? connectorErrorMessage("outcome_unknown") : null;
    }
    async function dispatch(context: string, serviceId: string, attempt: UnconfirmedOperation): Promise<MutationResult> {
      const { action, operationId, installation: item } = attempt;
      if (action === "install") return client.install(context, serviceId, operationId);
      if (!item) throw new ConnectorClientError("not_found");
      if (action === "configure") return client.configure(context, item, operationId);
      if (action === "authorize") return client.authorize(context, item, operationId);
      if (action === "uninstall") return client.uninstall(context, item, operationId);
      return client.setEnabled(context, item, action === "enable", operationId);
    }
    function retainReceipt(serviceId: string, receipt: Operation): void {
      const attempt = unconfirmed.value[serviceId];
      if (["succeeded", "failed", "cancelled"].includes(receipt.status)) forgetAttempt(serviceId);
      else if (attempt) unconfirmed.value = { ...unconfirmed.value, [serviceId]: { ...attempt, receipt, resubmitAllowed: false } };
      setError(serviceId, receiptError(receipt));
    }
    async function execute(action: ConnectorAction, serviceId: string): Promise<boolean> {
      const context = contextId.value, entry = entries.value.find(item => item.id === serviceId);
      if (!context || !entry || pending.value.has(serviceId) || !entry.actions.includes(action)) return false;
      const scope = scopeEpoch, item = installation(serviceId);
      setPending(serviceId, true); setError(serviceId, null); readEpoch++; mutationEpoch++; refreshing.value = false;
      const stillCurrent = () => scope === scopeEpoch && context === contextId.value;
      try {
        if (action === "retry" || action === "cancel" || action === "reopen") {
          const attempt = unconfirmed.value[serviceId];
          const previous = attempt?.receipt ?? item?.activeOperation;
          const id = attempt?.operationId ?? previous?.operationId;
          if (!id) { await refresh(); return false; }
          if (action === "retry" && attempt?.resubmitAllowed) {
            const result = await dispatch(context, serviceId, attempt);
            if (!stillCurrent()) return false;
            acceptMutation(result); retainReceipt(serviceId, result.operation); await refresh();
            return result.operation.status === "succeeded";
          }
          let receipt: Operation;
          try {
            receipt = action === "reopen" && previous
              ? await client.reopen(context, id, previous.revision)
              : action === "cancel" && previous?.cancellable
              ? await client.cancel(context, id, previous.revision)
              : await client.operation(context, id);
          } catch (failure) {
            if (stillCurrent() && action === "retry" && attempt && failure instanceof ConnectorClientError && failure.code === "not_found") {
              unconfirmed.value = { ...unconfirmed.value, [serviceId]: { ...attempt, receipt: undefined, resubmitAllowed: true } };
              setError(serviceId, "当前作用域未找到操作回执。再次点击重试会按原操作编号和原参数重新提交；你也可以先返回。");
              return false;
            }
            throw failure;
          }
          if (!stillCurrent()) return false;
          retainReceipt(serviceId, receipt);
          await refresh();
          return receipt.status === "succeeded" || receipt.status === "cancelled";
        }
        if (unconfirmed.value[serviceId]) { setError(serviceId, connectorErrorMessage("outcome_unknown")); return false; }
        const operationId = crypto.randomUUID();
        const attempt: UnconfirmedOperation = Object.freeze({ operationId, action, installation: item ? Object.freeze({ ...item }) : null });
        unconfirmed.value = { ...unconfirmed.value, [serviceId]: attempt };
        const result = await dispatch(context, serviceId, attempt);
        if (!stillCurrent()) return false;
        acceptMutation(result);
        // A returned receipt is authoritative. Unknown receipts remain queryable;
        // success is never inferred from an IPC promise merely resolving.
        retainReceipt(serviceId, result.operation);
        await refresh();
        return result.operation.status === "succeeded";
      } catch (failure) {
        if (!stillCurrent()) return false;
        const code = failure instanceof ConnectorClientError ? failure.code : "temporarily_unavailable";
        if (!["temporarily_unavailable", "outcome_unknown", "operation_pending", "context_invalid"].includes(code)) forgetAttempt(serviceId);
        setError(serviceId, connectorErrorMessage(code));
        if (code === "revision_conflict" || code === "permission_denied" || code === "context_invalid") await refresh();
        return false;
      } finally { if (stillCurrent()) setPending(serviceId, false); scheduleOperationPoll(); }
    }
    function stopOperationTimer(): void { if (operationTimer !== null) clearTimeout(operationTimer); operationTimer = null; }
    function observedOperations() {
      const candidates = new Map<string, { serviceId: string; operationId: string; installationId?: string; revision?: number }>();
      for (const item of snapshot.value?.installations ?? []) {
        const active = item.activeOperation;
        if (active && ["pending", "unknown"].includes(active.status) && !pending.value.has(item.serviceId)) {
          candidates.set(active.operationId, { serviceId: item.serviceId, operationId: active.operationId, installationId: item.installationId, revision: active.revision });
        }
      }
      for (const [serviceId, attempt] of Object.entries(unconfirmed.value)) {
        if (!pending.value.has(serviceId) && !attempt.resubmitAllowed && (!attempt.receipt || ["pending", "unknown"].includes(attempt.receipt.status))) {
          candidates.set(attempt.operationId, { serviceId, operationId: attempt.operationId, installationId: attempt.installation?.installationId, revision: attempt.receipt?.revision });
        }
      }
      // Bound bookkeeping to currently unresolved operations in this scope.
      for (const id of operationBudgets.keys()) if (!candidates.has(id)) operationBudgets.delete(id);
      return [...candidates.values()].filter(candidate => {
        let budget = operationBudgets.get(candidate.operationId);
        if (!budget) { budget = { startedAt: Date.now(), attempts: 0, failures: 0, lastRead: 0 }; operationBudgets.set(candidate.operationId, budget); }
        if (budget.attempts < 120 && Date.now() - budget.startedAt < 300_000) return true;
        setError(candidate.serviceId, "自动核对已暂停，请点击“重新确认状态”继续读取原操作。不会重新发起授权。");
        return false;
      }).sort((a, b) => operationBudgets.get(a.operationId)!.lastRead - operationBudgets.get(b.operationId)!.lastRead);
    }
    function scheduleOperationPoll(delay = 1000): void {
      stopOperationTimer();
      if (!operationObservation || operationPollBusy || !contextId.value || phase.value !== "ready" || !snapshot.value?.capabilities.includes("connector.read")) return;
      if (!observedOperations().length) return;
      operationTimer = setTimeout(() => { operationTimer = null; void pollOperation(); }, delay);
    }
    async function pollOperation(): Promise<void> {
      if (!operationObservation || operationPollBusy || !contextId.value || phase.value !== "ready") return;
      const candidate = observedOperations()[0];
      if (!candidate) return;
      const context = contextId.value, scope = scopeEpoch, mutation = mutationEpoch;
      const current = () => operationObservation && context === contextId.value && scope === scopeEpoch && mutation === mutationEpoch;
      const budget = operationBudgets.get(candidate.operationId)!;
      budget.attempts++; budget.lastRead = Date.now(); operationPollBusy = true;
      let delay = 2000;
      try {
        // Only query the original operation. Polling never calls dispatch(),
        // creates an operation ID, retries a mutation or reads credentials.
        const receipt = await client.operation(context, candidate.operationId);
        if (!current()) return;
        if (receipt.operationId !== candidate.operationId || receipt.serviceId !== candidate.serviceId ||
            (candidate.installationId && receipt.installationId !== candidate.installationId) ||
            (candidate.revision !== undefined && receipt.revision < candidate.revision)) throw new ConnectorClientError("outcome_unknown");
        budget.failures = 0;
        retainReceipt(candidate.serviceId, receipt);
        if (["succeeded", "failed", "cancelled"].includes(receipt.status)) operationBudgets.delete(candidate.operationId);
        await refresh();
      } catch (failure) {
        if (!current()) return;
        budget.failures++;
        delay = Math.min(15_000, 2000 * 2 ** Math.min(budget.failures, 3));
        const code = failure instanceof ConnectorClientError ? failure.code : "temporarily_unavailable";
        setError(candidate.serviceId, connectorErrorMessage(code));
        if (code === "context_invalid" || code === "permission_denied") {
          phase.value = "permission-denied"; error.value = connectorErrorMessage(code);
        }
      } finally { operationPollBusy = false; scheduleOperationPoll(delay); }
    }
    function setOperationObservation(active: boolean): void {
      operationObservation = active;
      if (active) scheduleOperationPoll(); else stopOperationTimer();
    }
    return { contextId, authorityScope, snapshot, model, entries, phase, refreshing, error, pending, operationErrors, canManage, selectionAvailable, bind, refresh, execute, clear, installation, setOperationObservation };
  });
}

export const useMarketConnectorStore = createMarketConnectorStoreDefinition(marketConnectorClient);
