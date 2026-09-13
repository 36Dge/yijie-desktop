import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import { workflowNativeClient, workflowFailure, WorkflowNativeError, type EditorOpenedView, type WorkflowNativeClient, type WorkflowSchemas } from "../../api/workflow-native-client";

type Run = WorkflowSchemas["Run"];
type PendingRun = { workflowId: string; version: string; operationId?: string };

export function useWorkflowRuns(editor: Ref<EditorOpenedView | null>, native: WorkflowNativeClient = workflowNativeClient) {
  const history = shallowRef<WorkflowSchemas["RunSummary"][]>([]);
  const selected = shallowRef<Run | null>(null);
  const error = shallowRef<WorkflowNativeError | null>(null);
  const pending = shallowRef<PendingRun | null>(null);
  const activeRun = shallowRef<Run | null>(null);
  const loading = ref(false);
  const reading = ref(false);
  const submitting = ref(false);
  const version = ref("");
  const input = ref("");
  const nextCursor = ref<string | undefined>();
  let epoch = 0;
  let readTicket = 0;
  let disposed = false;
  let refreshQueued = false;
  const current = (generation: number, id: string) => !disposed && generation === epoch && editor.value?.workflow.workflow_id === id;

  async function refresh(more = false) {
    const id = editor.value?.workflow.workflow_id, generation = epoch;
    if (!id) return;
    if (loading.value) { if (!more) refreshQueued = true; return; }
    loading.value = true;
    error.value = null;
    try {
      const result = await native.query({ kind: "history", workflow_id: id, limit: 20, ...(more && nextCursor.value ? { cursor: nextCursor.value } : {}) });
      if (!current(generation, id)) return;
      if (!result.history || result.history.items.some(run => run.workflow_id !== id)) throw new WorkflowNativeError("protocol_mismatch");
      const rows = more ? [...history.value, ...result.history.items] : result.history.items;
      history.value = [...new Map(rows.map(row => [row.run_id, row])).values()];
      nextCursor.value = result.history.next_cursor;
    } catch (failure) { if (current(generation, id)) error.value = workflowFailure(failure); }
    finally {
      if (current(generation, id)) {
        loading.value = false;
        if (refreshQueued) { refreshQueued = false; void refresh(); }
      }
    }
  }

  async function read(runId: string) {
    const id = editor.value?.workflow.workflow_id, generation = epoch, ticket = ++readTicket;
    if (!id) return;
    reading.value = true;
    error.value = null;
    try {
      const result = await native.query({ kind: "run", workflow_id: id, run_id: runId });
      if (!current(generation, id) || ticket !== readTicket) return;
      if (!result.run || result.run.run_id !== runId || result.run.workflow_id !== id) throw new WorkflowNativeError("protocol_mismatch");
      selected.value = result.run;
      if (activeRun.value?.run_id === runId) activeRun.value = result.run.terminal ? null : result.run;
    } catch (failure) { if (current(generation, id) && ticket === readTicket) error.value = workflowFailure(failure); }
    finally { if (current(generation, id) && ticket === readTicket) reading.value = false; }
  }

  function accept(run: Run) {
    if (run.workflow_id !== editor.value?.workflow.workflow_id) return;
    ++readTicket;
    reading.value = false;
    selected.value = run;
    if (!run.terminal) activeRun.value = run;
    else if (activeRun.value?.run_id === run.run_id) activeRun.value = null;
    void refresh();
  }

  async function start() {
    const id = editor.value?.workflow.workflow_id, generation = epoch;
    if (!id || submitting.value || pending.value || activeRun.value) return;
    submitting.value = true;
    error.value = null;
    const requested = { workflowId: id, version: version.value.trim() };
    let operationId: string | undefined;
    try {
      const run = await native.run({ workflow_id: id, version: requested.version, input: { input: input.value } });
      if (!current(generation, id)) return;
      operationId = run.operation_id;
      if (run.workflow_id !== id || run.mode !== "release" || run.version !== requested.version) throw new WorkflowNativeError("operation_unknown", operationId);
      accept(run);
    } catch (failure) {
      if (!current(generation, id)) return;
      error.value = workflowFailure(failure);
      if (error.value.code === "operation_unknown" || (error.value.code === "service_unavailable" && error.value.operationId)) {
        pending.value = { ...requested, operationId: error.value.operationId ?? operationId };
      }
    } finally { if (current(generation, id)) submitting.value = false; }
  }

  async function reconcile() {
    const original = pending.value, generation = epoch;
    if (!original?.operationId || submitting.value) return;
    submitting.value = true;
    error.value = null;
    try {
      const result = await native.query({ kind: "operation", operation_id: original.operationId });
      if (!current(generation, original.workflowId)) return;
      const receipt = result.receipt;
      if (!receipt || receipt.operation_id !== original.operationId || receipt.kind !== "run"
        || (receipt.workflow_id && receipt.workflow_id !== original.workflowId)
        || (receipt.version && receipt.version !== original.version)) throw new WorkflowNativeError("protocol_mismatch");
      if (receipt.phase === "completed" && receipt.run_id) {
        // Keep the original query entry until the corresponding execution is read.
        const observed = await native.query({ kind: "run", workflow_id: original.workflowId, run_id: receipt.run_id });
        if (!current(generation, original.workflowId)) return;
        if (!observed.run || observed.run.run_id !== receipt.run_id || observed.run.operation_id !== original.operationId
          || observed.run.workflow_id !== original.workflowId || observed.run.mode !== "release" || observed.run.version !== original.version) throw new WorkflowNativeError("protocol_mismatch");
        pending.value = null;
        accept(observed.run);
      } else if (receipt.phase === "rejected") {
        pending.value = null;
        error.value = receipt.error ? workflowFailure(receipt.error) : new WorkflowNativeError("invalid_request");
      }
    } catch (failure) { if (current(generation, original.workflowId)) error.value = workflowFailure(failure); }
    finally { if (current(generation, original.workflowId)) submitting.value = false; }
  }

  watch(() => editor.value?.workflow.workflow_id, () => {
    ++epoch; ++readTicket; refreshQueued = false;
    history.value = []; selected.value = null; pending.value = null; activeRun.value = null; nextCursor.value = undefined;
    error.value = null; loading.value = false; reading.value = false; submitting.value = false;
    version.value = editor.value?.workflow.published_version ?? "";
    input.value = "";
    if (editor.value) void refresh();
  }, { immediate: true });
  watch(() => editor.value?.workflow.published_version, latest => {
    if (latest && !version.value) version.value = latest;
  });
  onBeforeUnmount(() => { disposed = true; ++epoch; ++readTicket; });
  return { history, selected, error, pending, activeRun, loading, reading, submitting, version, input, nextCursor, refresh, read, accept, start, reconcile };
}
