import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import { workflowNativeClient, workflowFailure, WorkflowNativeError, type WorkflowNativeClient, type WorkflowSummary } from "../../api/workflow-native-client";

export function useWorkflowDeletion(onDeleted: (id: string) => void, native: WorkflowNativeClient = workflowNativeClient) {
  const target = shallowRef<WorkflowSummary | null>(null);
  const busy = ref(false);
  const uncertain = ref(false);
  const error = shallowRef<WorkflowNativeError | null>(null);
  const notice = ref("");
  const blocked = computed(() => busy.value || uncertain.value);
  let disposed = false;
  function select(workflow: WorkflowSummary) {
    if (blocked.value) return;
    target.value = { ...workflow }; error.value = null; uncertain.value = false;
  }
  function cancel() { if (!blocked.value) { target.value = null; error.value = null; } }
  async function confirm() {
    if (!target.value || busy.value) return;
    const selected = target.value;
    const wasUncertain = uncertain.value;
    busy.value = true; error.value = null;
    try {
      const result = await native.delete({ workflow_id: selected.workflow_id, expected_revision: selected.revision });
      if (!result.deleted || result.workflow_id !== selected.workflow_id) throw new WorkflowNativeError("operation_unknown");
      if (disposed) return;
      onDeleted(selected.workflow_id);
      notice.value = `已删除“${selected.name}”`;
      uncertain.value = false; target.value = null;
    } catch (failure) {
      if (!disposed) {
        error.value = workflowFailure(failure);
        const definiteRejection = ["revision_conflict", "run_busy", "resource_not_found"].includes(error.value.code);
        uncertain.value = error.value.code === "operation_unknown" || (wasUncertain && !definiteRejection);
      }
    } finally { busy.value = false; }
  }
  onBeforeUnmount(() => { disposed = true; });
  return { target, busy, uncertain, error, notice, blocked, select, cancel, confirm };
}
