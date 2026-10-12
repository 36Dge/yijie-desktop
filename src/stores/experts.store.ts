import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { expertNativeClient, ExpertClientError, type ExpertNativeClient } from "../api/expert-native-client";
import type { CatalogSnapshot, ExpertSelection, ResourceOperation } from "../domain/experts.generated";
import { expertErrorMessage, expertResourceOperationMessage, expertSelection } from "../domain/expert-ui";

const key = (expert: ExpertSelection) => `${expert.expertId}@${expert.version}`;
const unsettled = (operation: ResourceOperation) => operation.state === "pending" || operation.state === "unknown";

/** Resource preparation only. Binding and turn execution are not activated here. */
export function createExpertsStoreDefinition(client: ExpertNativeClient, id = "experts") {
  return defineStore(id, () => {
    const contextId = ref<string | null>(null), scope = ref<string | null>(null);
    const snapshot = shallowRef<CatalogSnapshot | null>(null);
    const error = ref<string | null>(null), refreshing = ref(false);
    const operations = shallowRef<Readonly<Record<string, ResourceOperation>>>({});
    const busy = shallowRef<ReadonlySet<string>>(new Set());
    const operationErrors = shallowRef<Readonly<Record<string, string>>>({});
    let epoch = 0, readEpoch = 0;
    const entries = computed(() => snapshot.value?.experts ?? []);
    const canManage = computed(() => contextId.value !== null && !error.value && snapshot.value?.canManage === true);
    function invalidateCatalogReads(): void { readEpoch++; refreshing.value = false; }
    function preserveTerminal(previous: ResourceOperation | undefined, incoming: ResourceOperation): ResourceOperation {
      return previous?.operationId === incoming.operationId && !unsettled(previous) ? previous : incoming;
    }
    function rememberOperation(id: string, incoming: ResourceOperation): ResourceOperation {
      const operation = preserveTerminal(operations.value[id], incoming);
      operations.value = { ...operations.value, [id]: operation };
      const errors = { ...operationErrors.value }, message = expertResourceOperationMessage(operation);
      if (message) errors[id] = message; else delete errors[id];
      operationErrors.value = errors;
      return operation;
    }
    function clear(): void {
      epoch++; readEpoch++; contextId.value = null; scope.value = null; snapshot.value = null;
      error.value = null; refreshing.value = false; operations.value = {}; busy.value = new Set(); operationErrors.value = {};
    }
    async function refresh(): Promise<void> {
      const context = contextId.value, generation = epoch, read = ++readEpoch;
      if (!context) { error.value = "本机身份尚未就绪，请重新读取。"; return; }
      refreshing.value = true;
      try {
        const next = await client.snapshot(context);
        if (generation !== epoch || read !== readEpoch) return;
        snapshot.value = next; error.value = null;
        const durable = { ...operations.value };
        const errors = { ...operationErrors.value };
        for (const entry of next.experts) if (entry.operation) {
          const id = key(entry.display), previous = durable[id], operation = preserveTerminal(previous, entry.operation);
          if (!previous || !unsettled(previous) || previous.operationId === operation.operationId) {
            durable[id] = operation;
            const message = expertResourceOperationMessage(operation);
            if (message) errors[id] = message;
            else delete errors[id];
          }
        }
        operations.value = durable;
        operationErrors.value = errors;
      } catch (failure) {
        if (generation !== epoch || read !== readEpoch) return;
        error.value = expertErrorMessage(failure instanceof ExpertClientError ? failure.code : "unsupported_capability");
        snapshot.value = null;
      } finally { if (generation === epoch && read === readEpoch) refreshing.value = false; }
    }
    async function bind(context: string | null, authorityScope: string | null): Promise<void> {
      if (!authorityScope) { clear(); return; }
      if (scope.value !== authorityScope) { clear(); scope.value = authorityScope; }
      if (contextId.value === context) return;
      epoch++; readEpoch++; contextId.value = context; snapshot.value = null; busy.value = new Set(); refreshing.value = false;
      // Preserve original operations through same-scope context renewal.
      if (context) await refresh();
    }
    function setBusy(id: string, value: boolean) { const next = new Set(busy.value); if (value) next.add(id); else next.delete(id); busy.value = next; }
    async function execute(expert: ExpertSelection, action: "prepare" | "remove" | "query"): Promise<boolean> {
      const id = key(expert), context = contextId.value, generation = epoch;
      if (!context || busy.value.has(id)) return false;
      const previous = operations.value[id];
      const query = action === "query" || (previous && unsettled(previous));
      if (query && !previous) return false;
      if (!query && !canManage.value) return false;
      invalidateCatalogReads();
      const operation: ResourceOperation = query ? previous! : { operationId: crypto.randomUUID(), expert: expertSelection(expert), action: action as "prepare" | "remove", state: "pending" };
      operations.value = { ...operations.value, [id]: operation };
      const errors = { ...operationErrors.value }; delete errors[id]; operationErrors.value = errors;
      setBusy(id, true);
      try {
        const result = query ? await client.operation(context, operation.operationId) : await client[operation.action](context, operation.expert, operation.operationId);
        if (generation !== epoch) return false;
        invalidateCatalogReads();
        if (result.action !== operation.action || key(result.expert) !== id) throw new ExpertClientError("outcome_unknown");
        const confirmed = rememberOperation(id, result);
        await refresh();
        return generation === epoch && confirmed.state === "succeeded";
      } catch (failure) {
        if (generation !== epoch) return false;
        invalidateCatalogReads();
        const code = failure instanceof ExpertClientError ? failure.code : "outcome_unknown";
        // A failed status read cannot turn an uncertain operation into rejection.
        const confirmed = rememberOperation(id, { ...operation, state: query || ["outcome_unknown", "operation_pending", "temporarily_unavailable"].includes(code) ? "unknown" : "rejected", errorCode: code });
        return confirmed.state === "succeeded";
      } finally { if (generation === epoch) setBusy(id, false); }
    }
    async function recover(expert: ExpertSelection, operationId: string): Promise<boolean> {
      const id = key(expert), context = contextId.value, generation = epoch, original = operations.value[id];
      if (!context || !canManage.value || busy.value.has(id) || !original || !unsettled(original) || original.operationId !== operationId) return false;
      invalidateCatalogReads();
      setBusy(id, true);
      try {
        const result = await client.recoverOperation(context, operationId);
        if (generation !== epoch) return false;
        invalidateCatalogReads();
        if (result.action !== original.action || key(result.expert) !== id) throw new ExpertClientError("outcome_unknown");
        const confirmed = rememberOperation(id, result);
        await refresh();
        return generation === epoch && !unsettled(confirmed);
      } catch (failure) {
        // Keep the exact original state. Failed recovery cannot reject or retry it.
        if (generation === epoch) {
          invalidateCatalogReads();
          const current = operations.value[id];
          if (current?.operationId === operationId && !unsettled(current)) return true;
          operationErrors.value = { ...operationErrors.value, [id]: expertErrorMessage(failure instanceof ExpertClientError ? failure.code : "outcome_unknown") };
        }
        return false;
      } finally { if (generation === epoch) setBusy(id, false); }
    }
    return { contextId, scope, snapshot, entries, error, refreshing, canManage, operations, operationErrors, busy, clear, bind, refresh, execute, recover };
  });
}
export const useExpertsStore = createExpertsStoreDefinition(expertNativeClient);
