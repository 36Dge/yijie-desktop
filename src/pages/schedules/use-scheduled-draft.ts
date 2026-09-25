import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { createScheduledTaskNativeClient, ScheduledTaskNativeError } from "../../api/scheduled-task-native-client";
import type { DraftConfirmation, DraftPreview, DraftReceipt, DraftSubmit, IpcErrorCode, OperationCapabilities, Requests, Responses } from "../../api/generated/scheduled-task-ipc.gen";
import type { PlanDefinition, PlanView, TimeRule } from "../../domain/scheduled-plan.generated";
import { useChatStore } from "../../stores/chat.store";
import { usePermissionStore } from "../../stores/permission.store";

type Pending = Readonly<{ id: string; scope: string } & (
  { kind: "submit"; payload: DraftSubmit } |
  { kind: "continue"; payload: { source_id: string } } |
  { kind: "confirm"; payload: DraftConfirmation }
)>;

/** Source/confirmation UI state only. Native chat remains the execution authority. */
export function useScheduledDraft(
  active: () => boolean,
  session: () => string | null,
  latestTurn: () => string | null,
  executionPending: () => boolean,
  client = createScheduledTaskNativeClient(),
) {
  const chat = useChatStore(); const permissions = usePermissionStore();
  const context = computed(() => chat.context?.contextId ?? null);
  const scope = computed(() => permissions.selectedTenantId);
  const capabilities = shallowRef<OperationCapabilities | null>(null);
  const source = shallowRef<DraftReceipt | null>(null);
  const preview = shallowRef<DraftPreview | null>(null);
  const saved = shallowRef<PlanView | null>(null);
  const pending = shallowRef<Pending | null>(null);
  const writing = ref(false); const loading = ref(false);
  const error = ref<IpcErrorCode | null>(null); const notice = ref("");
  let generation = 0; let sourceRead = 0; let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollUntil = 0;
  const readable = computed(() => active() && permissions.isReady && permissions.hasCapability("schedule.read") && context.value !== null);
  const canSubmit = computed(() => readable.value && capabilities.value?.draft.available === true && !pending.value && !writing.value && !executionPending() && chat.isReady &&
    (session() === null || (chat.selectedSessionId === session() && chat.selectedSessionPurpose === "scheduled_plan_draft" && chat.selectedAccessMode === "live")));
  const canConfirm = computed(() => readable.value && capabilities.value?.save.available === true && preview.value?.status === "candidate" && !error.value && !pending.value && !writing.value);
  const candidate = computed(() => preview.value?.status === "candidate" && preview.value.output?.kind === "candidate" ? preview.value.output : null);
  const initialDefinition = computed<PlanDefinition | null>(() => candidate.value ? ({
    name: candidate.value.name, content: candidate.value.content, rule: candidate.value.schedule,
    target: { mode: candidate.value.target.mode },
  }) : null);
  function code(e: unknown): IpcErrorCode { return e instanceof ScheduledTaskNativeError ? e.code : "protocol_mismatch"; }
  async function call<C extends keyof Requests>(command: C, payload: Requests[C]["payload"], id: string = crypto.randomUUID()): Promise<Responses[C]["data"]> {
    const bound = context.value; const owner = scope.value;
    if (!bound || !readable.value) throw new ScheduledTaskNativeError("context_invalid", id);
    const response = await client.call(command, { schemaVersion: 1, contextId: bound, requestId: id, payload } as Requests[C]);
    if (disposed || context.value !== bound || scope.value !== owner || !readable.value) throw new ScheduledTaskNativeError("context_invalid", id);
    return response.data;
  }
  async function refreshPreview() {
    const current = source.value; const epoch = generation; const read = ++sourceRead;
    if (!current || !readable.value) return;
    loading.value = true;
    try {
      const next = await call("schedule_preview_draft_v1", { source_id: current.source_id });
      if (epoch !== generation || read !== sourceRead || source.value?.source_id !== current.source_id) return;
      preview.value = next; error.value = null;
      if (next.status === "confirmed" && next.plan_id) {
        const detail = await call("schedule_get_plan_v1", { plan_id: next.plan_id });
        if (epoch === generation && read === sourceRead) saved.value = detail.plan;
      }
      if (next.status === "unavailable" && Date.now() < pollUntil) {
        clearTimeout(timer); timer = setTimeout(() => { void refreshPreview(); }, 1500);
      }
    } catch (e) { if (epoch === generation && read === sourceRead) error.value = code(e); }
    finally { if (epoch === generation && read === sourceRead) loading.value = false; }
  }
  function acceptReceipt(receipt: DraftReceipt) {
    source.value = receipt; preview.value = null; saved.value = null; error.value = null;
    pollUntil = Date.now() + 120_000;
    void refreshPreview();
  }
  async function selectTurn(turn: string) {
    const conversation = session(); const epoch = generation;
    if (!conversation || !readable.value || pending.value || writing.value) return;
    clearTimeout(timer); const read = ++sourceRead; preview.value = null; saved.value = null;
    source.value = null; loading.value = true;
    try {
      const found = await call("schedule_find_draft_source_v1", { conversation_id: conversation, local_turn_id: turn });
      if (epoch !== generation || read !== sourceRead || conversation !== session()) return;
      if (found.found && found.source) acceptReceipt(found.source);
      else notice.value = "未找到该轮可用的草案来源，未重新发送。";
    } catch (e) { if (epoch === generation) error.value = code(e); }
    finally { if (epoch === generation) loading.value = false; }
  }
  async function refresh() {
    const epoch = generation;
    if (!readable.value) return;
    try {
      const next = await call("schedule_operation_capabilities_v1", {});
      if (epoch !== generation) return;
      capabilities.value = next;
      if (source.value) await refreshPreview();
      else if (latestTurn()) await selectTurn(latestTurn()!);
    } catch (e) { if (epoch === generation) error.value = code(e); }
  }
  async function runPending(): Promise<DraftReceipt | PlanView | null> {
    const action = pending.value;
    if (!action || writing.value || action.scope !== scope.value || !readable.value) return null;
    writing.value = true; error.value = null; notice.value = "";
    try {
      if (action.kind === "confirm") {
        const result = await call("schedule_confirm_active_draft_v1", action.payload, action.id);
        if (pending.value !== action) return null;
        pending.value = null; saved.value = result;
        notice.value = result.state === "enabled" ? "定时任务已创建并开启，将按设定时间执行。" : "已查回保存的定时任务，当前状态以下方记录为准。";
        await refreshPreview();
        return result;
      }
      const result = action.kind === "submit"
        ? await call("schedule_submit_draft_v1", action.payload, action.id)
        : await call("schedule_continue_draft_source_v1", action.payload, action.id);
      if (pending.value !== action) return null;
      pending.value = null; acceptReceipt(result);
      return result;
    } catch (e) {
      if (pending.value !== action) return null;
      error.value = code(e);
      if (!["operation_unknown", "context_invalid"].includes(error.value)) pending.value = null;
      return null;
    } finally { writing.value = false; }
  }
  async function submit(text: string) {
    if (!canSubmit.value || !scope.value || !text.trim()) return null;
    const conversation = session();
    pending.value = Object.freeze({ kind: "submit", id: crypto.randomUUID(), scope: scope.value, payload: { text: text.trim(), ...(conversation ? { conversation_id: conversation } : {}) } });
    return runPending();
  }
  async function confirm(definition: PlanDefinition, expected: { source: string; digest: string }) {
    const current = preview.value;
    if (!canConfirm.value || !current?.source_digest || !scope.value) return null;
    if (expected.source !== current.source_id || expected.digest !== current.source_digest) { error.value = "draft_source_invalid"; return null; }
    pending.value = Object.freeze({ kind: "confirm", id: crypto.randomUUID(), scope: scope.value, payload: structuredClone({ source_id: current.source_id, source_digest: current.source_digest, definition }) });
    return runPending();
  }
  async function continueSource() {
    if (!readable.value || !scope.value || !source.value || writing.value || pending.value || !capabilities.value?.draft.available) return null;
    pending.value = Object.freeze({ kind: "continue", id: crypto.randomUUID(), scope: scope.value, payload: { source_id: source.value.source_id } });
    return runPending();
  }
  async function checkPending(): Promise<DraftReceipt | PlanView | null> {
    const action = pending.value;
    if (!action || writing.value || !readable.value || action.scope !== scope.value) return null;
    writing.value = true; error.value = null;
    try {
      if (action.kind === "submit") {
        const result = await call("schedule_read_draft_submission_receipt_v1", { original_request_id: action.id });
        if (pending.value !== action) return null;
        if (result.observation === "observed") { pending.value = null; acceptReceipt(result.receipt); return result.receipt; }
        if (result.observation === "source_deleted") {
          if (result.plan_id) {
            const detail = await call("schedule_get_plan_v1", { plan_id: result.plan_id });
            if (pending.value !== action) return null;
            pending.value = null; saved.value = detail.plan;
            notice.value = "原草案来源已删除，已查回之前确认的计划。";
            return detail.plan;
          }
          pending.value = null; notice.value = "原草案来源已删除，未重新创建。"; return null;
        }
        notice.value = "尚未观察到原请求提交。可以继续查证，或明确重试同一请求。";
        return null;
      }
      const result = await call("schedule_preview_draft_v1", { source_id: action.payload.source_id });
      if (pending.value !== action) return null;
      preview.value = result;
      if (result.status === "confirmed" && result.plan_id) {
        const plan = await call("schedule_get_plan_v1", { plan_id: result.plan_id });
        if (pending.value !== action) return null;
        pending.value = null; saved.value = plan.plan; return plan.plan;
      }
      if (action.kind === "continue" && result.status !== "unavailable") pending.value = null;
      notice.value = "已读取原草案状态，未重新发送。";
      return null;
    } catch (e) { if (pending.value === action) error.value = code(e); return null; }
    finally { writing.value = false; }
  }
  watch([context, scope, () => permissions.authorizationRevision, readable, session], () => {
    generation++; sourceRead++; clearTimeout(timer); loading.value = false;
    capabilities.value = null; preview.value = null; saved.value = null; error.value = null;
    if (source.value?.conversation_id !== session()) source.value = null;
    if (pending.value && (pending.value.scope !== scope.value || (permissions.isReady && !permissions.hasCapability("schedule.read")))) pending.value = null;
    if (readable.value) void refresh();
  }, { immediate: true });
  watch(latestTurn, turn => { if (turn && source.value?.local_turn_id !== turn) void selectTurn(turn); });
  onScopeDispose(() => { disposed = true; generation++; sourceRead++; clearTimeout(timer); });
  return { source, preview, saved, pending, writing, loading, error, notice, capabilities, readable, canSubmit, canConfirm, candidate, initialDefinition,
    submit, confirm, continueSource, checkPending, retry: runPending, selectTurn, refresh,
    previewTime: (rule: TimeRule) => call("schedule_preview_time_v1", { rule }),
    targets: (search: string, cursor?: string) => call("schedule_list_targets_v1", { search, ...(cursor ? { cursor } : {}) }),
  };
}
