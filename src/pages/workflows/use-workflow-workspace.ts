import { onBeforeUnmount, ref, shallowRef } from "vue";
import {
  workflowNativeClient,
  workflowFailure,
  type EditorOpenedView,
  type WorkflowNativeClient,
  type WorkflowNativeError,
  type WorkflowSchemas,
  type WorkflowSummary,
} from "../../api/workflow-native-client";

export function useWorkflowWorkspace(native: WorkflowNativeClient = workflowNativeClient) {
  const workflows = shallowRef<WorkflowSummary[]>([]);
  const status = shallowRef<WorkflowSchemas["ServiceStatus"] | null>(null);
  const error = shallowRef<WorkflowNativeError | null>(null);
  const loading = ref(false);
  const creating = ref(false);
  const opening = ref(false);
  const openPending = ref(false);
  const reconnecting = ref(false);
  const closing = ref(false);
  const editor = shallowRef<EditorOpenedView | null>(null);
  const dirty = ref(false);
  const pendingWrites = ref(0);
  const pendingCreate = ref<string | null>(null);
  const createUncertain = ref(false);
  const nextCursor = ref<string | undefined>();
  let navigation = 0;
  let listGeneration = 0;
  let disposed = false;
  let openingSettled = Promise.resolve();

  async function refresh(more = false) {
    if (loading.value) return;
    const ticket = ++listGeneration;
    loading.value = true;
    error.value = null;
    try {
      const observed = await native.status();
      if (disposed || ticket !== listGeneration) return;
      status.value = observed;
      const result = await native.list({ limit: 20, ...(more && nextCursor.value ? { cursor: nextCursor.value } : {}) });
      if (disposed || ticket !== listGeneration) return;
      const rows = more ? [...workflows.value, ...result.items] : result.items;
      workflows.value = [...new Map(rows.map(row => [row.workflow_id, row])).values()];
      nextCursor.value = result.next_cursor;
    } catch (failure) {
      if (disposed || ticket !== listGeneration) return;
      error.value = workflowFailure(failure);
      status.value = null;
    } finally {
      if (ticket === listGeneration) loading.value = false;
    }
  }

  async function openWorkflow(workflowId: string, reconnect = false) {
    if (openPending.value || reconnecting.value || closing.value || (reconnect && pendingWrites.value > 0)) return;
    const ticket = ++navigation;
    openPending.value = true;
    let settle: () => void = () => undefined;
    openingSettled = new Promise<void>(resolve => { settle = resolve; });
    if (reconnect) reconnecting.value = true;
    else opening.value = true;
    error.value = null;
    try {
      const opened = await native.open({ workflow_id: workflowId });
      if (disposed || ticket !== navigation) {
        await native.close({ bridge_id: opened.bridge_id });
        return;
      }
      if (!reconnect) dirty.value = false;
      editor.value = opened;
    } catch (failure) {
      if (!disposed && ticket === navigation) error.value = workflowFailure(failure);
    } finally {
      openPending.value = false;
      settle();
      if (ticket === navigation) {
        opening.value = false;
        reconnecting.value = false;
      }
    }
  }

  async function cancelOpening() {
    if (!openPending.value) return;
    ++navigation;
    opening.value = false;
    // The late native open result is normally revoked by openWorkflow.
    await openingSettled;
  }

  async function create(name: string) {
    if (creating.value || createUncertain.value) return false;
    creating.value = true;
    error.value = null;
    try {
      const workflow = await native.create({ name: name.trim() });
      if (disposed) return false;
      await refresh();
      await openWorkflow(workflow.workflow_id);
      return true;
    } catch (failure) {
      if (!disposed) {
        error.value = workflowFailure(failure);
        if (error.value.code === "operation_unknown") {
          createUncertain.value = true;
          pendingCreate.value = error.value.operationId ?? null;
        }
      }
      return false;
    } finally {
      creating.value = false;
    }
  }

  async function queryPendingCreate() {
    if (!pendingCreate.value || creating.value) return;
    creating.value = true;
    try {
      const result = await native.query({ kind: "operation", operation_id: pendingCreate.value });
      const receipt = result.receipt;
      if (!receipt || disposed) return;
      if (receipt.phase === "completed" && receipt.workflow_id) {
        pendingCreate.value = null;
        createUncertain.value = false;
        error.value = null;
        await refresh();
        await openWorkflow(receipt.workflow_id);
      } else if (receipt.phase === "rejected") {
        pendingCreate.value = null;
        createUncertain.value = false;
        error.value = receipt.error ? workflowFailure(receipt.error) : null;
      }
    } catch (failure) {
      if (!disposed) error.value = workflowFailure(failure);
    } finally {
      creating.value = false;
    }
  }

  async function closeEditor() {
    if (closing.value || pendingWrites.value || reconnecting.value) return;
    ++navigation;
    const current = editor.value;
    if (!current) return;
    closing.value = true;
    try {
      await native.close({ bridge_id: current.bridge_id });
      if (disposed) return;
      editor.value = null;
      dirty.value = false;
      error.value = null;
      await refresh();
    } catch (failure) {
      if (!disposed) error.value = workflowFailure(failure);
    } finally {
      closing.value = false;
    }
  }

  function acceptEditorResult(result: WorkflowSchemas["EditorExchangeResult"]) {
    const workflow = result.workflow ?? result.bootstrap?.workflow;
    if (workflow && editor.value?.workflow.workflow_id === workflow.workflow_id) {
      editor.value = { ...editor.value, workflow };
    }
    error.value = null;
  }

  function acceptEditorFailure(failure: WorkflowNativeError) {
    error.value = failure;
  }

  onBeforeUnmount(() => {
    disposed = true;
    ++navigation;
    ++listGeneration;
    const current = editor.value;
    if (current) void native.close({ bridge_id: current.bridge_id }).catch(() => undefined);
  });

  return {
    workflows, status, error, loading, creating, opening, openPending, reconnecting, closing,
    editor, dirty, pendingWrites, pendingCreate, createUncertain, nextCursor,
    refresh, create, openWorkflow, cancelOpening, queryPendingCreate, closeEditor,
    acceptEditorResult, acceptEditorFailure,
  };
}
