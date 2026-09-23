import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ScheduledTaskNativeError } from "../../api/scheduled-task-native-client";
import type { EnableConfirmation, EnableResult, IpcErrorCode, PlanDetail } from "../../api/generated/scheduled-task-ipc.gen";
import { usePermissionStore } from "../../stores/permission.store";
import type { useScheduledManagement } from "./use-scheduled-management";

type Intent = Readonly<{ scope: string; payload: EnableConfirmation }>;
/** Only an explicit confirmation writes; reads and context refresh never renew consent. */
export function useScheduledAutomatic(m: ReturnType<typeof useScheduledManagement>, prepare: () => Promise<boolean>) {
  const permissions = usePermissionStore();
  const review = shallowRef<PlanDetail | null>(null); const nextAt = ref<number>();
  const maxRuns = ref<number | null>(1); const expiresMs = ref<number | null>(null);
  const targetTitle = ref(""); const intent = shallowRef<Intent | null>(null);
  const result = shallowRef<EnableResult | null>(null); const busy = ref(false);
  const error = ref<IpcErrorCode | null>(null); const notice = ref("");
  let epoch = 0; let disposed = false;
  const pending = computed(() => intent.value !== null);
  const canPrepare = computed(() => !!m.context.value && m.canManage.value && permissions.hasCapability("workspace.use") &&
    (m.capabilities.value?.automatic.available === true || m.capabilities.value?.automatic.reason === "runtime_unqualified"));
  const valid = computed(() => Number.isInteger(maxRuns.value) && maxRuns.value !== null && maxRuns.value >= 1 && maxRuns.value <= 2147483647 &&
    nextAt.value !== undefined && expiresMs.value !== null && Number.isFinite(expiresMs.value) && Math.floor(expiresMs.value / 1000) > nextAt.value && expiresMs.value <= 253402300799000);
  const code = (e: unknown): IpcErrorCode => e instanceof ScheduledTaskNativeError ? e.code : "operation_unknown";
  function reset() { epoch++; review.value = null; intent.value = null; result.value = null; error.value = null; notice.value = ""; }
  function same(i: Intent) { return !disposed && intent.value === i && permissions.selectedTenantId === i.scope; }
  async function prepareService() {
    if (busy.value || pending.value || !canPrepare.value) return;
    busy.value = true; error.value = null;
    try {
      if (!await prepare()) throw new ScheduledTaskNativeError("execution_not_ready", "");
      await m.refresh();
      if (!m.capabilities.value?.automatic.available) throw new ScheduledTaskNativeError("execution_not_ready", "");
      notice.value = "本地执行服务已准备。仅已有有效自动授权的未来计划可运行，没有新增授权。";
    } catch (e) { error.value = code(e); } finally { busy.value = false; }
  }
  async function open(planId: string) {
    if (busy.value || pending.value || !canPrepare.value) return;
    const current = ++epoch; const scope = permissions.selectedTenantId;
    busy.value = true; error.value = null; notice.value = "正在准备本地自动执行…";
    try {
      if (!await prepare()) throw new ScheduledTaskNativeError("execution_not_ready", "");
      if (current !== epoch || scope !== permissions.selectedTenantId) return;
      await m.refresh();
      if (!m.capabilities.value?.automatic.available) throw new ScheduledTaskNativeError("execution_not_ready", "");
      const detail = await m.call("schedule_get_plan_v1", { plan_id: planId });
      if (detail.plan.state === "deleted" || detail.summary.target_state === "missing") throw new ScheduledTaskNativeError("target_unavailable", "");
      const preview = await m.call("schedule_preview_time_v1", { rule: detail.plan.definition.rule });
      if (current !== epoch) return;
      if (preview.next_at === undefined || preview.next_at > 253402300199) throw new ScheduledTaskNativeError("invalid_input", "");
      nextAt.value = preview.next_at; maxRuns.value = 1; expiresMs.value = (preview.next_at + 600) * 1000;
      targetTitle.value = m.cards.value.find(c => c.summary.plan_id === planId)?.target_title ?? "";
      review.value = detail; notice.value = "";
    } catch (e) { if (current === epoch) { error.value = code(e); notice.value = ""; } }
    finally { busy.value = false; }
  }
  async function observed(i: Intent, value: EnableResult) {
    if (!same(i)) return;
    result.value = value; intent.value = null; review.value = null;
    m.receipt.value = null; m.notice.value = "";
    notice.value = value.automatic_consent ? "原自动授权已记录。计划当前状态以下方卡片为准；刷新可查看执行结果。" : "已查到旧确认，它尚未获得实际自动执行资格，请重新审阅。";
    await m.refresh();
  }
  function failed(i: Intent, e: unknown) {
    if (!same(i)) return;
    error.value = code(e);
    if (!["operation_unknown", "context_invalid", "storage_unavailable", "protocol_mismatch"].includes(error.value)) {
      intent.value = null; review.value = null;
      notice.value = "本次确认未受理。请重新审阅最新配置和下一次时间。";
    } else notice.value = "启用结果待查证。页面不会自动重试、续额或重复启用。";
  }
  async function submit(i: Intent) {
    await observed(i, await m.call("schedule_confirm_enable_v1", i.payload, i.payload.confirmation.request_id));
  }
  async function confirm() {
    const detail = review.value; const scope = permissions.selectedTenantId;
    if (!detail || !scope || busy.value || pending.value || !valid.value || nextAt.value === undefined || expiresMs.value === null || maxRuns.value === null) return;
    const i: Intent = { scope, payload: { confirmation: { request_id: crypto.randomUUID(), plan_id: detail.plan.plan_id, expected_revision: detail.plan.revision, max_runs: maxRuns.value, expires_at: Math.floor(expiresMs.value / 1000) }, expected_next_at: nextAt.value } };
    intent.value = i; busy.value = true; error.value = null;
    try { await submit(i); } catch (e) { failed(i, e); } finally { busy.value = false; }
  }
  async function query() {
    const i = intent.value; if (!i || !same(i) || busy.value) return;
    busy.value = true; error.value = null;
    try {
      const r = await m.call("schedule_read_execution_receipt_v1", { operation: "enable", original_request_id: i.payload.confirmation.request_id });
      if (!same(i)) return;
      if (r.observation === "enable_observed") await observed(i, r.result);
      else notice.value = "尚未查到原启用回执，不能据此认定未提交。可继续查证或明确重试同一请求。";
    } catch (e) { if (same(i)) error.value = code(e); } finally { busy.value = false; }
  }
  async function retry() {
    const i = intent.value; if (!i || !same(i) || busy.value) return;
    busy.value = true; error.value = null;
    try { await submit(i); } catch (e) { failed(i, e); } finally { busy.value = false; }
  }
  function close() { if (!busy.value && !pending.value) review.value = null; }
  watch(() => permissions.selectedTenantId, reset, { flush: "sync" });
  watch(() => permissions.isReady && (!permissions.hasCapability("schedule.read") || !permissions.hasCapability("task.create") || !permissions.hasCapability("workspace.use")), revoked => { if (revoked) reset(); }, { flush: "sync" });
  watch(m.context, () => { review.value = null; });
  onScopeDispose(() => { disposed = true; reset(); });
  return { review, nextAt, maxRuns, expiresMs, targetTitle, result, intent, pending, busy, error, notice, canPrepare, valid, prepareService, open, confirm, query, retry, close };
}
