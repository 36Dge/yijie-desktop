// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
import { createScheduledTaskNativeClient } from "../../api/scheduled-task-native-client";
import type { Requests } from "../../api/generated/scheduled-task-ipc.gen";
import { useScheduledManagement } from "./use-scheduled-management";

const stores = vi.hoisted(() => ({ chat: {} as object, permission: {} as object }));
vi.mock("../../stores/chat.store", () => ({ useChatStore: () => stores.chat }));
vi.mock("../../stores/permission.store", () => ({ usePermissionStore: () => stores.permission }));
const scopeId = "019c1a00-0000-7000-8000-000000000002";
const definition = { name: "管理验证", content: "仅保存，不执行", rule: { frequency: "daily" as const, time_zone: "Asia/Shanghai", local_time: "09:00" }, target: { mode: "dedicated_chat" as const } };
const plan = { plan_id: crypto.randomUUID(), revision: 1, schedule_epoch: 1, definition, state: "paused" as const, target_state: "unbound" as const, effective_from: 1790000000, next_at: 1790038800, rule_version: 1, tzdb_version: "2026b" };
const summary = { plan_id: plan.plan_id, name: definition.name, revision: 1, raw_state: "paused" as const, effective_state: "paused" as const, target_mode: "dedicated_chat" as const, target_state: "unbound" as const };
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(f => f()); });
function harness() {
  const chat = reactive({ context: { contextId: crypto.randomUUID() } as {contextId:string} | null });
  const permission = reactive({ selectedTenantId: scopeId as string | null, isReady: true, hasCapability: () => true });
  stores.chat = chat; stores.permission = permission;
  const calls: { command: string; request: Requests[keyof Requests] }[] = [];
  let uncertain = false; let observed = true;
  const native = createScheduledTaskNativeClient(async (command, args) => {
    const request = args.request as Requests[keyof Requests]; calls.push({ command, request });
    let data: unknown;
    switch (command) {
      case "schedule_operation_capabilities_v1": data = Object.fromEntries(["read","save","manual","automatic","draft","single_run"].map(k => [k, { available: k === "read" || k === "save", reason: k === "read" || k === "save" ? "ready" : "candidate_disabled" }])); break;
      case "schedule_list_plan_cards_v1": data = {items: []}; break;
      case "schedule_get_plan_v1": data = { plan, summary }; break;
      case "schedule_save_plan_v1": if (uncertain) throw { schemaVersion: 1, requestId: request.requestId, code: "operation_unknown" }; data = plan; break;
      case "schedule_read_plan_mutation_receipt_v1": data = observed ? {observation:"observed", plan_id:plan.plan_id, current_plan:{plan,summary}} : {observation:"not_observed"}; break;
      default: throw new Error(`Unexpected command ${command}`);
    }
    return {schemaVersion:1,requestId:request.requestId,data};
  });
  const scope = effectScope(); const state = scope.run(() => useScheduledManagement(native))!; cleanup.push(() => scope.stop());
  return { state, calls, chat, permission, uncertainty: (value: boolean) => { uncertain = value; }, observation: (value: boolean) => { observed = value; } };
}
it("saves paused and never calls draft, run, grant or activation commands", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.state.canManage.value).toBe(true));
  expect(await h.state.save({definition})).toBe(true);
  expect(h.state.pending.value).toBeNull();
  expect(h.calls.some(c => /submit_draft|manual_run|confirm_grant|confirm_enable|rerun/.test(c.command))).toBe(false);
});
it("preserves an uncertain action across same-scope expiry and queries the original ID without rewriting", async () => {
  const h=harness(); await vi.waitFor(() => expect(h.state.canManage.value).toBe(true)); h.uncertainty(true);
  await h.state.save({definition}); const original=h.state.pending.value!;
  h.chat.context=null; await nextTick(); expect(h.state.pending.value).toBe(original);
  h.chat.context={contextId:crypto.randomUUID()}; await nextTick();
  await h.state.queryReceipt(); expect(h.state.pending.value).toBeNull();
  const writes=h.calls.filter(c=>c.command==="schedule_save_plan_v1"); expect(writes).toHaveLength(1);
  const read=h.calls.find(c=>c.command==="schedule_read_plan_mutation_receipt_v1")!;
  expect(read.request.payload).toEqual({original_request_id:original.id});
});
it("absence is unknown; only explicit retry resends the exact original management request", async () => {
  const h=harness(); await vi.waitFor(() => expect(h.state.canManage.value).toBe(true));h.uncertainty(true);h.observation(false);
  await h.state.save({definition}); await h.state.queryReceipt(); expect(h.state.pending.value).not.toBeNull();
  expect(h.calls.filter(c=>c.command==="schedule_save_plan_v1")).toHaveLength(1);
  h.uncertainty(false); await h.state.retryMutation();
  const writes=h.calls.filter(c=>c.command==="schedule_save_plan_v1"); expect(writes).toHaveLength(2);
  expect(writes[1]!.request).toEqual(writes[0]!.request);
});
it("scope changes clear pending input and prevent cross-scope replay", async () => {
  const h=harness(); await vi.waitFor(() => expect(h.state.canManage.value).toBe(true));h.uncertainty(true);await h.state.save({definition});
  h.permission.selectedTenantId=crypto.randomUUID();await nextTick();
  expect(h.state.pending.value).toBeNull();expect(await h.state.retryMutation()).toBe(false);
});
