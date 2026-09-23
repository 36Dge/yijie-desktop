// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
import { createScheduledTaskNativeClient } from "../../api/scheduled-task-native-client";
import type { Requests, EnableConfirmation, IpcErrorCode } from "../../api/generated/scheduled-task-ipc.gen";
import { useScheduledManagement } from "./use-scheduled-management";
import { useScheduledAutomatic } from "./use-scheduled-automatic";

const stores = vi.hoisted(() => ({ chat: {} as object, permission: {} as object }));
vi.mock("../../stores/chat.store", () => ({ useChatStore: () => stores.chat }));
vi.mock("../../stores/permission.store", () => ({ usePermissionStore: () => stores.permission }));
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(f => f()));
function harness() {
  const chat = reactive({ context: { contextId: crypto.randomUUID() } as { contextId: string } | null });
  const permission = reactive({ selectedTenantId: crypto.randomUUID(), isReady: true, hasCapability: () => true });
  stores.chat = chat; stores.permission = permission;
  const at = Math.floor(Date.now() / 1000) + 86400;
  const plan = { plan_id: crypto.randomUUID(), revision: 1, schedule_epoch: 1, definition: { name: "未来自动合成", content: "仅文本", rule: { frequency: "daily", time_zone: "Asia/Shanghai", local_time: "09:00" }, target: { mode: "dedicated_chat" } }, state: "paused", target_state: "unbound", effective_from: at - 86400, next_at: at, rule_version: 1, tzdb_version: "2026b" };
  const summary = { plan_id: plan.plan_id, name: plan.definition.name, revision: 1, raw_state: "paused", effective_state: "paused", target_mode: "dedicated_chat", target_state: "unbound" };
  const grant = { grant_id: crypto.randomUUID(), plan_id: plan.plan_id, plan_revision: 2, authorization_revision: 1, definition_digest: "a".repeat(64), workspace: { source: "managed_schedule", resource_id: plan.plan_id }, max_runs: 1, occupied_runs: 0, expires_at: at + 600, state: "active" };
  let prepared = false; let failure: IpcErrorCode | null = null; let observed = true;
  const result = { plan: { ...plan, revision: 2, state: "enabled" }, grant, automatic_consent: true };
  const calls: { command: string; request: Requests[keyof Requests] }[] = [];
  const prepare = vi.fn(async () => { prepared = true; return true; });
  const native = createScheduledTaskNativeClient(async (command, args) => {
    const request = args.request as Requests[keyof Requests]; calls.push({ command, request }); let data: unknown;
    switch (command) {
      case "schedule_operation_capabilities_v1": data = Object.fromEntries(["read", "save", "manual", "automatic", "draft", "single_run"].map(k => [k, { available: k === "read" || k === "save" || (k === "automatic" && prepared), reason: k === "read" || k === "save" || (k === "automatic" && prepared) ? "ready" : k === "automatic" ? "runtime_unqualified" : "candidate_disabled" }])); break;
      case "schedule_list_plan_cards_v1": data = { items: [] }; break;
      case "schedule_get_plan_v1": data = { plan, summary }; break;
      case "schedule_preview_time_v1": data = { next_at: at, logical_slot: "2026-09-24T09:00", skipped_slots: [], candidates_examined: 1, rule_version: 1, tzdb_version: "2026b" }; break;
      case "schedule_confirm_enable_v1": if (failure) throw { schemaVersion: 1, requestId: request.requestId, code: failure }; data = result; break;
      case "schedule_read_execution_receipt_v1": data = observed ? { observation: "enable_observed", result } : { observation: "not_observed" }; break;
      default: throw Error(`Unexpected ${command}`);
    }
    return { schemaVersion: 1, requestId: request.requestId, data };
  });
  const scope = effectScope(); const state = scope.run(() => { const m = useScheduledManagement(native); return { m, s: useScheduledAutomatic(m, prepare) }; })!;
  cleanups.push(() => scope.stop());
  return { ...state, chat, permission, plan, at, calls, result, prepare, fail: (v: IpcErrorCode | null) => { failure = v; }, observe: (v: boolean) => { observed = v; } };
}
it("prepares only on click and confirms one finite authorization using the reviewed native time", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true)); expect(h.prepare).not.toHaveBeenCalled();
  await h.s.open(h.plan.plan_id); expect(h.prepare).toHaveBeenCalledOnce();
  expect(h.s.expiresMs.value).toBe((h.at + 600) * 1000); expect(h.s.maxRuns.value).toBe(1);
  expect(h.calls.some(c => c.command === "schedule_confirm_enable_v1")).toBe(false);
  await Promise.all([h.s.confirm(), h.s.confirm()]);
  expect(h.s.error.value).toBeNull();
  const writes = h.calls.filter(c => c.command === "schedule_confirm_enable_v1"); expect(writes).toHaveLength(1);
  expect(writes[0]!.request.payload).toMatchObject({ expected_next_at: h.at, confirmation: { max_runs: 1, expires_at: h.at + 600 } });
  expect(writes[0]!.request.requestId).toBe((writes[0]!.request.payload as EnableConfirmation).confirmation.request_id);
  expect(h.calls.some(c => /manual_run|confirm_grant|rerun/.test(c.command))).toBe(false);
});
it("uncertain enable survives context refresh and receipt observation cannot re-enable a paused plan", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true)); await h.s.open(h.plan.plan_id);
  h.fail("operation_unknown"); await h.s.confirm(); const i = h.s.intent.value;
  h.chat.context = null; await nextTick(); h.chat.context = { contextId: crypto.randomUUID() }; await nextTick();
  expect(h.s.intent.value).toBe(i); h.observe(false); await h.s.query(); expect(h.s.pending.value).toBe(true);
  h.result.plan.state = "paused"; h.observe(true); await h.s.query();
  expect(h.s.result.value?.plan.state).toBe("paused"); expect(h.s.pending.value).toBe(false);
  expect(h.calls.filter(c => c.command === "schedule_confirm_enable_v1")).toHaveLength(1);
});
it("explicit retry preserves both original identity and reviewed parameters", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true)); await h.s.open(h.plan.plan_id);
  h.fail("operation_unknown"); await h.s.confirm(); h.s.maxRuns.value = 12; h.fail(null); await h.s.retry();
  const writes = h.calls.filter(c => c.command === "schedule_confirm_enable_v1"); expect(writes).toHaveLength(2);
  expect(writes[0]!.request).toEqual(writes[1]!.request);
});
it("rejects invalid bounds locally and returns native next-time conflicts to a new review", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true)); await h.s.open(h.plan.plan_id);
  h.s.expiresMs.value = h.at * 1000; await h.s.confirm(); expect(h.calls.some(c => c.command === "schedule_confirm_enable_v1")).toBe(false);
  h.s.expiresMs.value = (h.at + 600) * 1000; h.fail("revision_conflict"); await h.s.confirm();
  expect(h.s.pending.value).toBe(false); expect(h.s.review.value).toBeNull(); expect(h.s.error.value).toBe("revision_conflict");
});
it("scope changes clear pending intent and cancellation never writes", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true)); await h.s.open(h.plan.plan_id);
  h.s.close(); await h.s.confirm(); expect(h.calls.some(c => c.command === "schedule_confirm_enable_v1")).toBe(false);
  await h.s.open(h.plan.plan_id); h.fail("operation_unknown"); await h.s.confirm();
  h.permission.selectedTenantId = crypto.randomUUID(); await nextTick(); await h.s.retry();
  expect(h.s.pending.value).toBe(false); expect(h.calls.filter(c => c.command === "schedule_confirm_enable_v1")).toHaveLength(1);
});
