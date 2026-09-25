import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ScheduledTaskNativeError } from "../../api/scheduled-task-native-client";
import type { GrantConfirmation, GrantView, RunView } from "../../domain/scheduled-execution.generated";
import type { IpcErrorCode, PlanDetail, RecordDetail, RerunPreview, RerunReview, SingleRunKind, SingleRunGrantResult } from "../../api/generated/scheduled-task-ipc.gen";
import { usePermissionStore } from "../../stores/permission.store";
import type { useScheduledManagement } from "./use-scheduled-management";

type Intent = {
  scope: string; confirmation: GrantConfirmation; manualId: string; kind: SingleRunKind; rerunReview?: RerunReview;
  grant: GrantView | null; grantAttempted: boolean; manualAttempted: boolean;
};
/** UI intent only. Native receipts, permission and execution remain authoritative. */
export function useScheduledManual(m: ReturnType<typeof useScheduledManagement>, prepare: () => Promise<boolean>) {
  const permissions = usePermissionStore();
  const review = shallowRef<PlanDetail | null>(null);
  const targetTitle = ref("");
  const rerun = shallowRef<RerunPreview | null>(null);
  const intent = shallowRef<Intent | null>(null);
  const result = shallowRef<RecordDetail | null>(null);
  const direct = ref(false); const startedRunId = ref<string | null>(null);
  const busy = ref(false); const error = ref<IpcErrorCode | null>(null); const notice = ref("");
  let epoch = 0; let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = computed(() => intent.value !== null);
  const canPrepare = computed(() => !!m.context.value && permissions.hasCapability("schedule.read") && permissions.hasCapability("task.create") && permissions.hasCapability("task.read") && permissions.hasCapability("workspace.use") &&
    (m.capabilities.value?.single_run.available === true || m.capabilities.value?.single_run.reason === "runtime_unqualified"));
  const code = (e: unknown): IpcErrorCode => e instanceof ScheduledTaskNativeError ? e.code : "operation_unknown";
  function reset() { epoch++; review.value = null; rerun.value = null; intent.value = null; result.value = null; direct.value = false; startedRunId.value = null; notice.value = ""; error.value = null; clearTimeout(timer); }
  function same(i: Intent) { return !disposed && intent.value === i && i.scope === permissions.selectedTenantId; }
  function observeGrant(i: Intent, value: SingleRunGrantResult) {
    const grant = value.grant;
    if (value.kind !== i.kind || value.original_run_id !== i.rerunReview?.original_run_id) throw new ScheduledTaskNativeError("protocol_mismatch", "");
    if (!same(i)) return;
    if (grant.state !== "active") {
      intent.value = null; review.value = null;
      error.value = grant.state === "expired" ? "grant_expired" : grant.state === "stale" ? "grant_stale" : "grant_exhausted";
      notice.value = "原授权已查证，但已不能提交新的运行。";
      return;
    }
    intent.value = { ...i, grant };
    notice.value = "授权已保存，尚未提交运行。可在许可仍有效时明确继续本次运行；查证本身不会发送。";
  }
  async function open(planId: string, runImmediately = false) {
    if (busy.value || pending.value || !canPrepare.value) return;
    rerun.value = null; review.value = null; direct.value = runImmediately; startedRunId.value = null;
    busy.value = true; error.value = null; notice.value = runImmediately ? "" : "正在准备本地执行服务…";
    const current = ++epoch; const scope = permissions.selectedTenantId;
    try {
      // Only this explicit click upgrades a cold management bind.
      if (!await prepare()) throw new ScheduledTaskNativeError("execution_not_ready", "");
      if (current !== epoch || scope !== permissions.selectedTenantId) return;
      await m.refresh();
      if (!m.capabilities.value?.single_run.available) throw new ScheduledTaskNativeError("execution_not_ready", "");
      const detail = await m.call("schedule_get_plan_v1", { plan_id: planId });
      if (current !== epoch || disposed || scope !== permissions.selectedTenantId || !scope) return;
      if (detail.plan.state === "deleted" || detail.summary.target_state === "missing") throw new ScheduledTaskNativeError("target_unavailable", "");
      targetTitle.value = m.cards.value.find(card => card.summary.plan_id === planId)?.target_title ?? "";
      notice.value = "";
      if (runImmediately) await submit(detail, scope, true);
      else review.value = detail;
    } catch (e) { if (current === epoch) { error.value = code(e); notice.value = ""; } }
    finally { busy.value = false; }
  }
  async function runNow(planId: string) { await open(planId, true); }
  async function openRerun(originalRunId: string) {
    if (busy.value || pending.value || !canPrepare.value) return;
    const current = ++epoch; const scope = permissions.selectedTenantId;
    busy.value = true; error.value = null; notice.value = ""; rerun.value = null; direct.value = false; startedRunId.value = null;
    try {
      // Review is read-only even when execution has not been prepared.
      const preview = await m.call("schedule_preview_rerun_v1", { original_run_id: originalRunId });
      const detail = await m.call("schedule_get_plan_v1", { plan_id: preview.confirmation.plan_id });
      if (current !== epoch || scope !== permissions.selectedTenantId) return;
      if (detail.plan.revision !== preview.confirmation.revision) throw new ScheduledTaskNativeError("revision_conflict", "");
      if (detail.plan.state === "deleted" || detail.summary.target_state === "missing") throw new ScheduledTaskNativeError("target_unavailable", "");
      targetTitle.value = m.cards.value.find(card => card.summary.plan_id === detail.plan.plan_id)?.target_title ?? "";
      rerun.value = preview; review.value = detail;
    } catch (e) { if (current === epoch) error.value = code(e); }
    finally { busy.value = false; }
  }
  async function refreshResult(runId?: string, remaining = 0) {
    const id = runId ?? (result.value?.record.kind === "run" ? result.value.record.run.run_id : undefined);
    if (!id) return;
    const current = epoch;
    try {
      const detail = await m.call("schedule_get_record_v1", { kind: "run", run_id: id });
      if (disposed || current !== epoch) return;
      result.value = detail;
      clearTimeout(timer);
      if (remaining > 0 && detail.record.kind === "run" && detail.record.run.native_outcome === "unobserved" && !["cancelled", "terminal"].includes(detail.record.run.delivery_state)) {
        timer = setTimeout(() => { void refreshResult(id, remaining - 1); }, 2000);
      }
    } catch (e) { if (current === epoch && !disposed) error.value = code(e); }
  }
  async function accepted(i: Intent, run: RunView, announce = false) {
    if (!same(i)) return;
    intent.value = null; review.value = null;
    m.receipt.value = null; m.notice.value = "";
    const started = announce && !["uncertain", "cancelled"].includes(run.delivery_state) && !["failed", "interrupted"].includes(run.native_outcome);
    notice.value = direct.value ? (started ? "" : "已查到原运行记录，可在执行记录中查看当前状态。") : "已查到本次运行回执。任务是否结束以下方原生记录为准；本次单次授权未更改原计划和自动额度。";
    if (direct.value && started) startedRunId.value = run.run_id;
    await refreshResult(run.run_id, 60);
    await m.refresh();
  }
  async function submitManual(i: Intent) {
    if (!i.grant || !same(i)) return;
    i.manualAttempted = true;
    const run = i.kind === "rerun" && i.rerunReview
      ? await m.call("schedule_confirm_rerun_v1", { ...i.rerunReview, grant_id: i.grant.grant_id }, i.manualId)
      : await m.call("schedule_manual_run_v1", { grant_id: i.grant.grant_id, revision: i.confirmation.expected_revision }, i.manualId);
    await accepted(i, run, true);
  }
  function failed(i: Intent, e: unknown) {
    if (!same(i)) return;
    error.value = code(e);
    if (!["operation_unknown", "context_invalid", "storage_unavailable", "protocol_mismatch"].includes(error.value)) {
      intent.value = null; review.value = null;
      notice.value = direct.value ? "本次执行未获受理，请按错误说明处理后重试。" : "本次提交未获受理，请按错误说明处理后重新审阅。";
    } else notice.value = "回执尚不明确。请只读查证原请求，页面不会自动续发。";
  }
  async function confirm() {
    const detail = review.value; const scope = permissions.selectedTenantId;
    if (!detail || !scope || busy.value || pending.value) return;
    busy.value = true;
    try { await submit(detail, scope); } finally { busy.value = false; }
  }
  async function submit(detail: PlanDetail, scope: string, prepared = false) {
    const id = crypto.randomUUID();
    const i: Intent = { scope, kind: rerun.value ? "rerun" : "manual", ...(rerun.value ? { rerunReview: rerun.value.confirmation } : {}), confirmation: { request_id: id, plan_id: detail.plan.plan_id, expected_revision: detail.plan.revision, max_runs: 1, expires_at: Math.floor(Date.now() / 1000) + 600 }, manualId: crypto.randomUUID(), grant: null, grantAttempted: true, manualAttempted: false };
    intent.value = i; error.value = null;
    try {
      if (!prepared) {
        if (!await prepare()) throw new ScheduledTaskNativeError("execution_not_ready", "");
        if (!same(i)) return;
        await m.refresh();
      }
      if (!same(i)) return;
      const grant = await m.call("schedule_confirm_single_run_v1", { confirmation: i.confirmation, kind: i.kind, ...(i.rerunReview ? { review: i.rerunReview } : {}) }, id);
      if (!same(i)) return;
      if (grant.kind !== i.kind || grant.original_run_id !== i.rerunReview?.original_run_id) throw new ScheduledTaskNativeError("protocol_mismatch", "");
      i.grant = grant.grant;
      await submitManual(i);
    } catch (e) { failed(i, e); }
  }
  async function query() {
    const i = intent.value; if (!i || busy.value || !same(i)) return;
    busy.value = true; error.value = null;
    try {
      const operation = i.manualAttempted ? i.kind : "single_grant";
      const receipt = await m.call("schedule_read_execution_receipt_v1", { operation, original_request_id: i.manualAttempted ? i.manualId : i.confirmation.request_id });
      if (!same(i)) return;
      if (receipt.observation === "manual_observed" || receipt.observation === "rerun_observed") await accepted(i, receipt.run);
      else if (receipt.observation === "single_grant_observed") {
        observeGrant(i, receipt.result);
      } else notice.value = "尚未查到原请求回执，不能据此判断未执行。可再次查证或明确重试同一请求。";
    } catch (e) { if (same(i)) error.value = code(e); }
    finally { busy.value = false; }
  }
  async function retry() {
    const i = intent.value; if (!i || busy.value || !same(i)) return;
    busy.value = true; error.value = null;
    try {
      if (i.grant) await submitManual(i);
      else {
        // A grant replay observes a fact only. Even after this explicit retry,
        // do not submit an unattempted manual command without another click.
        const grant = await m.call("schedule_confirm_single_run_v1", { confirmation: i.confirmation, kind: i.kind, ...(i.rerunReview ? { review: i.rerunReview } : {}) }, i.confirmation.request_id);
        observeGrant(i, grant);
      }
    } catch (e) { failed(i, e); }
    finally { busy.value = false; }
  }
  function closeReview() { if (!busy.value && !pending.value) review.value = null; }
  watch(() => permissions.selectedTenantId, reset, { flush: "sync" });
  watch(() => permissions.isReady && (!permissions.hasCapability("schedule.read") || !permissions.hasCapability("task.create") || !permissions.hasCapability("task.read") || !permissions.hasCapability("workspace.use")), revoked => { if (revoked) reset(); }, { flush: "sync" });
  watch(m.context, () => { review.value = null; clearTimeout(timer); });
  onScopeDispose(() => { disposed = true; reset(); });
  return { review, rerun, targetTitle, intent, pending, busy, error, notice, result, direct, startedRunId, canPrepare, open, runNow, openRerun, confirm, query, retry, refreshResult, closeReview };
}
