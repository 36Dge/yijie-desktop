import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { runtimePermissionClient, type ChatPermissionState, type PermissionMode, type RuntimeApproval, type RuntimeApprovalDecision } from "../api/runtime-permission-client";

export function useRuntimePermissions(context: () => string | null, session: () => string | null, running: () => boolean) {
  const state = shallowRef<ChatPermissionState | null>(null);
  const approvals = shallowRef<readonly RuntimeApproval[]>([]);
  const saving = ref(false);
  const deciding = ref<string | null>(null);
  const error = ref<string | null>(null);
  const approvalsConnected = ref(false);
  let generation = 0;
  let mutation = 0;
  let disposed = false;
  let decisionFailure: { id: string; message: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const busy = computed(() => running() || saving.value || deciding.value !== null || state.value?.busy === true || approvals.value.some((r) => r.status === "pending"));
  const ready = computed(() => state.value !== null && error.value === null && (session() === null || approvalsConnected.value));

  async function refresh(epoch = generation): Promise<void> {
    const contextId = context(); const sessionId = session();
    if (!contextId || disposed || epoch !== generation) return;
    const revision = mutation;
    const results = await Promise.allSettled([
      runtimePermissionClient.get(contextId, sessionId),
      sessionId ? runtimePermissionClient.approvals(contextId, sessionId) : Promise.resolve([]),
    ]);
    if (disposed || epoch !== generation || revision !== mutation) return;
    if (results[0].status === "fulfilled" && !saving.value) state.value = results[0].value;
    approvalsConnected.value = results[1].status === "fulfilled";
    if (results[1].status === "fulfilled" && !deciding.value) approvals.value = results[1].value;
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") error.value = "暂时无法同步权限或审批，请重试。";
    else if (!saving.value && !deciding.value) {
      const failedDecision = decisionFailure;
      if (failedDecision && approvals.value.some((r) => r.id === failedDecision.id && r.status === "pending")) error.value = failedDecision.message;
      else { decisionFailure = null; error.value = null; }
    }
  }

  async function poll(epoch: number): Promise<void> {
    await refresh(epoch);
    if (disposed || epoch !== generation || !context()) return;
    timer = setTimeout(() => { void poll(epoch); }, running() ? 1000 : 2500);
  }

  watch([context, session], () => {
    generation += 1;
    decisionFailure = null;
    if (timer !== null) clearTimeout(timer);
    state.value = null; approvals.value = []; saving.value = false; deciding.value = null; error.value = null; approvalsConnected.value = false;
    void poll(generation);
  }, { immediate: true, flush: "sync" });

  async function setMode(mode: PermissionMode, confirmFullAccess = false): Promise<void> {
    const id = context(); if (!id || !ready.value || busy.value) return;
    const epoch = generation; const sessionId = session();
    mutation += 1;
    saving.value = true; error.value = null;
    try {
      const result = await runtimePermissionClient.set(id, sessionId, mode, confirmFullAccess);
      if (generation === epoch) state.value = result;
    } catch { if (generation === epoch) { state.value = null; error.value = "权限保存结果尚未确认，正在重新读取。"; } }
    finally { if (generation === epoch) { mutation += 1; saving.value = false; void refresh(epoch); } }
  }

  async function decide(approvalId: string, decision: RuntimeApprovalDecision): Promise<void> {
    const id = context(); const sessionId = session();
    if (!id || !sessionId || deciding.value || !approvalsConnected.value || !approvals.value.some((r) => r.id === approvalId && r.status === "pending")) return;
    mutation += 1;
    const epoch = generation; deciding.value = approvalId; error.value = null; decisionFailure = null;
    try {
      const result = await runtimePermissionClient.decide(id, sessionId, approvalId, decision);
      if (generation === epoch) approvals.value = approvals.value.map((r) => r.id === approvalId ? result : r);
    } catch { if (generation === epoch) { decisionFailure = { id: approvalId, message: "审批提交失败，请重试；操作是否执行以最新状态为准。" }; error.value = decisionFailure.message; approvalsConnected.value = false; } }
    finally { if (generation === epoch) { mutation += 1; deciding.value = null; void refresh(epoch); } }
  }

  onBeforeUnmount(() => { disposed = true; generation += 1; if (timer !== null) clearTimeout(timer); });
  return { state, approvals, saving, deciding, error, ready, busy, approvalsConnected, setMode, decide, refresh: () => refresh() };
}
