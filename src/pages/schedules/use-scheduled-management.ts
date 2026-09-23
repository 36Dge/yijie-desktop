import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { createScheduledTaskNativeClient, ScheduledTaskNativeError } from "../../api/scheduled-task-native-client";
import type { Requests, Responses, PlanCard, RecordRow, PlanCardOrder, FilterState, OperationCapabilities, IpcErrorCode, PlanMutation, PlanDetail } from "../../api/generated/scheduled-task-ipc.gen";
import type { SavePlanRequest } from "../../domain/scheduled-plan.generated";
import { useChatStore } from "../../stores/chat.store";
import { usePermissionStore } from "../../stores/permission.store";

type Command = keyof Requests;
type Pending = Readonly<{ id: string; scope: string; kind: "save"; payload: SavePlanRequest } | { id: string; scope: string; kind: "pause" | "delete"; payload: PlanMutation }>;
export function useScheduledManagement(client = createScheduledTaskNativeClient()) {
  const chat = useChatStore(); const permissions = usePermissionStore();
  const tab = ref("plans"); const search = ref(""); const state = ref<FilterState>("all"); const order = ref<PlanCardOrder>("created_desc"); const planFilter = ref<string | null>(null);
  const cards = shallowRef<PlanCard[]>([]); const records = shallowRef<RecordRow[]>([]); const capabilities = shallowRef<OperationCapabilities | null>(null);
  const cursor = ref<string>(); const loading = ref(false); const writing = ref(false); const error = ref<IpcErrorCode | null>(null); const notice = ref("");
  const pending = shallowRef<Pending | null>(null); const receipt = shallowRef<PlanDetail | null>(null);
  let epoch = 0; let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
  const context = computed(() => chat.context?.contextId ?? null);
  const scope = computed(() => permissions.selectedTenantId);
  const canManage = computed(() => permissions.isReady && permissions.hasCapability("schedule.read") && capabilities.value?.save.available === true && context.value !== null && !pending.value);
  function errorCode(e: unknown): IpcErrorCode { return e instanceof ScheduledTaskNativeError ? e.code : "protocol_mismatch"; }
  async function call<C extends Command>(command: C, payload: Requests[C]["payload"], id: string = crypto.randomUUID()): Promise<Responses[C]["data"]> {
    const bound = context.value;
    if (!bound) throw new ScheduledTaskNativeError("context_invalid", id);
    const response = await client.call(command, { schemaVersion: 1, contextId: bound, requestId: id, payload } as Requests[C]);
    if (disposed || context.value !== bound) throw new ScheduledTaskNativeError("context_invalid", id);
    return response.data;
  }
  async function refresh(more = false) {
    const current = ++epoch; error.value = null;
    if (!context.value) { loading.value = false; return; }
    loading.value = true;
    try {
      const caps = await call("schedule_operation_capabilities_v1", {});
      if (current !== epoch) return;
      capabilities.value = caps;
      if (!caps.save.available && caps.save.reason === "authority_missing") pending.value = null;
      if (!caps.read.available) { cards.value = []; records.value = []; cursor.value = undefined; return; }
      const common = { limit: 20, search: search.value.trim(), state: state.value, ...(more && cursor.value ? { cursor: cursor.value } : {}) };
      if (tab.value === "plans") {
        const page = await call("schedule_list_plan_cards_v1", { ...common, order: order.value });
        if (current !== epoch) return;
        cards.value = more ? [...cards.value, ...page.items] : page.items; cursor.value = page.next_cursor;
      } else {
        const page = await call("schedule_list_record_rows_v1", { ...common, ...(planFilter.value ? { plan_id: planFilter.value } : {}) });
        if (current !== epoch) return;
        records.value = more ? [...records.value, ...page.items] : page.items; cursor.value = page.next_cursor;
      }
    } catch (e) { if (current === epoch) error.value = errorCode(e); }
    finally { if (current === epoch) loading.value = false; }
  }
  async function runPending(): Promise<boolean> {
    const action = pending.value;
    if (!action || action.scope !== scope.value || writing.value || !context.value) return false;
    writing.value = true; error.value = null; notice.value = "";
    try {
      const result = action.kind === "save" ? await call("schedule_save_plan_v1", action.payload, action.id)
        : action.kind === "pause" ? await call("schedule_pause_plan_v1", action.payload, action.id)
          : await call("schedule_delete_plan_v1", action.payload, action.id);
      if (pending.value !== action) return false;
      pending.value = null;
      notice.value = action.kind === "delete" ? "计划已删除，历史记录已保留。" : "计划已保存为暂停状态，不会自动执行。";
      receipt.value = await call("schedule_get_plan_v1", { plan_id: result.plan_id }).catch(() => null);
      await refresh(); return true;
    } catch (e) {
      if (pending.value !== action) return false;
      const code = errorCode(e);
      error.value = code;
      if (!["operation_unknown", "context_invalid"].includes(code)) pending.value = null;
      return false;
    } finally { writing.value = false; }
  }
  async function save(payload: Omit<SavePlanRequest, "request_id">) {
    if (!canManage.value || !scope.value) return false;
    receipt.value = null;
    const id = crypto.randomUUID();
    pending.value = Object.freeze({ kind: "save", id, scope: scope.value, payload: structuredClone({ ...payload, request_id: id }) });
    return runPending();
  }
  async function mutate(kind: "pause" | "delete", payload: PlanMutation) {
    if (!canManage.value || !scope.value) return false;
    receipt.value = null;
    pending.value = Object.freeze({ kind, id: crypto.randomUUID(), scope: scope.value, payload: structuredClone(payload) });
    return runPending();
  }
  async function queryReceipt() {
    const action = pending.value;
    if (!action || action.scope !== scope.value || writing.value) return;
    writing.value = true; error.value = null;
    try {
      const result = await call("schedule_read_plan_mutation_receipt_v1", { original_request_id: action.id });
      if (pending.value !== action) return;
      if (result.observation === "observed") {
        receipt.value = result.current_plan ?? null; pending.value = null;
        notice.value = "已查到原请求回执。下方显示计划当前状态；它可能已被后续操作更新。";
        await refresh();
      } else notice.value = "尚未查到回执，结果仍不确定。可再次查证，或明确重试同一请求。";
    } catch (e) { if (pending.value === action) error.value = errorCode(e); }
    finally { writing.value = false; }
  }
  watch(scope, () => { pending.value = null; receipt.value = null; cards.value = []; records.value = []; notice.value = ""; }, { flush: "sync" });
  watch(() => permissions.isReady && !permissions.hasCapability("schedule.read"), revoked => { if (revoked) pending.value = null; }, { flush: "sync" });
  watch(context, () => { epoch++; cards.value = []; records.value = []; cursor.value = undefined; capabilities.value = null; void refresh(); }, { immediate: true });
  watch([tab, search, state, order, planFilter], () => {
    epoch++; cursor.value = undefined; clearTimeout(timer);
    timer = setTimeout(() => { void refresh(); }, 220);
  });
  onScopeDispose(() => { disposed = true; epoch++; clearTimeout(timer); pending.value = null; });
  return { tab, search, state, order, planFilter, cards, records, capabilities, cursor, loading, writing, error, notice, pending, receipt, context, canManage, call, refresh, save, mutate, queryReceipt, retryMutation: runPending };
}
