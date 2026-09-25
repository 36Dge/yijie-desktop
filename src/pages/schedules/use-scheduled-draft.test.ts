// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
import { createScheduledTaskNativeClient } from "../../api/scheduled-task-native-client";
import type { DraftPreview, Requests } from "../../api/generated/scheduled-task-ipc.gen";
import { useScheduledDraft } from "./use-scheduled-draft";

const stores = vi.hoisted(() => ({ chat: {} as object, permission: {} as object }));
vi.mock("../../stores/chat.store", () => ({ useChatStore: () => stores.chat }));
vi.mock("../../stores/permission.store", () => ({ usePermissionStore: () => stores.permission }));
const definition = { name: "每日摘要", content: "汇总我输入的内容", rule: { frequency: "daily" as const, time_zone: "Asia/Shanghai", local_time: "09:00" }, target: { mode: "dedicated_chat" as const } };
const plan = { plan_id: crypto.randomUUID(), revision: 1, schedule_epoch: 1, definition, state: "enabled" as const, target_state: "unbound" as const, effective_from: 1790000000, rule_version: 1, tzdb_version: "2026b" };
const receipt = { source_id: crypto.randomUUID(), conversation_id: crypto.randomUUID(), local_turn_id: crypto.randomUUID(), operation_id: crypto.randomUUID(), status: "accepted" as const };
const candidate: DraftPreview = { source_id: receipt.source_id, status: "candidate", source_digest: "a".repeat(64), output: { schema_version: 1, kind: "candidate", name: definition.name, content: definition.content, schedule: definition.rule, target: definition.target } };
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(f => f()); });
function harness() {
  const chat = reactive({ context: { contextId: crypto.randomUUID() } as {contextId:string} | null, isReady: true, selectedSessionId: null as string|null, selectedSessionPurpose: "ordinary", selectedAccessMode: "live" });
  const permission = reactive({ selectedTenantId: crypto.randomUUID(), isReady: true, authorizationRevision: 1, allowed: true, hasCapability() { return this.isReady && this.allowed; } });
  const route = reactive({ session: null as string|null, turn: null as string|null, busy: false });
  stores.chat = chat; stores.permission = permission;
  const calls: { command: string; request: Requests[keyof Requests] }[] = [];
  let uncertain = false; let observed = true; let output: DraftPreview = { source_id: receipt.source_id, status: "unavailable" };
  const client = createScheduledTaskNativeClient(async (command, args) => {
    const request = args.request as Requests[keyof Requests]; calls.push({ command, request });
    let data: unknown;
    switch (command) {
      case "schedule_operation_capabilities_v1": data = Object.fromEntries(["read","save","draft","manual","automatic","single_run"].map(k => [k,{available: !["manual","automatic","single_run"].includes(k), reason: ["manual","automatic","single_run"].includes(k) ? "candidate_disabled" : "ready"}])); break;
      case "schedule_submit_draft_v1": if (uncertain) throw {schemaVersion:1,requestId:request.requestId,code:"operation_unknown"}; data=receipt; break;
      case "schedule_preview_draft_v1": data=output; break;
      case "schedule_read_draft_submission_receipt_v1": data=observed ? {observation:"observed",receipt} : {observation:"not_observed"}; break;
      case "schedule_confirm_active_draft_v1": if (uncertain) throw {schemaVersion:1,requestId:request.requestId,code:"operation_unknown"}; data=plan; output={source_id:receipt.source_id,status:"confirmed",plan_id:plan.plan_id}; break;
      case "schedule_get_plan_v1": data={plan,summary:{plan_id:plan.plan_id,name:plan.definition.name,revision:1,raw_state:"paused",effective_state:"paused",target_mode:"dedicated_chat",target_state:"unbound"}}; break;
      case "schedule_find_draft_source_v1": data={found:true,source:receipt}; break;
      default: throw Error(`Unexpected ${command}`);
    }
    return {schemaVersion:1,requestId:request.requestId,data};
  });
  const scope=effectScope();
  const state=scope.run(()=>useScheduledDraft(()=>true,()=>route.session,()=>route.turn,()=>route.busy,client))!;
  cleanup.push(()=>scope.stop());
  return {state,calls,chat,permission,route,uncertain:(v:boolean)=>{uncertain=v;},observed:(v:boolean)=>{observed=v;},output:(v:DraftPreview)=>{output=v;}};
}
it("does not send on entry and resolves lost first receipt after normal context expiry without a second write",async()=>{
  const h=harness();await vi.waitFor(()=>expect(h.state.canSubmit.value).toBe(true));
  expect(h.calls.every(c=>c.command==="schedule_operation_capabilities_v1")).toBe(true);
  h.uncertain(true);await h.state.submit("每个工作日生成摘要");const original=h.state.pending.value!;
  h.permission.isReady=false;h.chat.context=null;await nextTick();expect(h.state.pending.value).toBe(original);
  h.permission.isReady=true;h.chat.context={contextId:crypto.randomUUID()};await nextTick();
  expect(await h.state.checkPending()).toEqual(receipt);
  expect(h.calls.filter(c=>c.command==="schedule_submit_draft_v1")).toHaveLength(1);
  expect(h.calls.find(c=>c.command==="schedule_read_draft_submission_receipt_v1")?.request.payload).toEqual({original_request_id:original.id});
});
it("treats absent receipt as unknown and explicitly retries with the exact original request",async()=>{
  const h=harness();await vi.waitFor(()=>expect(h.state.canSubmit.value).toBe(true));h.uncertain(true);h.observed(false);
  await h.state.submit("原始请求");await h.state.checkPending();expect(h.state.pending.value).not.toBeNull();
  await h.state.retry();const writes=h.calls.filter(c=>c.command==="schedule_submit_draft_v1");expect(writes).toHaveLength(2);expect(writes[1]!.request).toEqual(writes[0]!.request);
});
it("uses a new turn request for clarification and confirms only the reviewed source without grants or regular save",async()=>{
  const h=harness();await vi.waitFor(()=>expect(h.state.canSubmit.value).toBe(true));await h.state.submit("开始草案");
  h.route.session=receipt.conversation_id;h.chat.selectedSessionId=receipt.conversation_id;h.chat.selectedSessionPurpose="scheduled_plan_draft";await nextTick();
  await vi.waitFor(()=>expect(h.state.canSubmit.value).toBe(true));h.output(candidate);await h.state.submit("每天九点，上海时区，专属聊天");await h.state.refresh();
  const writes=h.calls.filter(c=>c.command==="schedule_submit_draft_v1");expect(writes[0]!.request.requestId).not.toBe(writes[1]!.request.requestId);expect(writes[1]!.request.payload).toMatchObject({conversation_id:receipt.conversation_id});
  expect(await h.state.confirm(definition,{source:receipt.source_id,digest:"b".repeat(64)})).toBeNull();
  await h.state.refresh();expect(await h.state.confirm(definition,{source:receipt.source_id,digest:candidate.source_digest!})).toEqual(plan);
  expect(h.state.saved.value?.state).toBe("enabled");expect(h.calls.some(c=>/save_plan|confirm_grant|confirm_enable|manual_run|confirm_rerun/.test(c.command))).toBe(false);
});
it("blocks a new generation while execution is unconfirmed and clears pending input after a scope change or actual revocation",async()=>{
  const h=harness();await vi.waitFor(()=>expect(h.state.canSubmit.value).toBe(true));h.route.busy=true;expect(await h.state.submit("不能发送")).toBeNull();
  h.route.busy=false;h.uncertain(true);await h.state.submit("不确定请求");h.permission.allowed=false;await nextTick();expect(h.state.pending.value).toBeNull();
  h.permission.allowed=true;await nextTick();await vi.waitFor(()=>expect(h.state.canSubmit.value).toBe(true));await h.state.submit("另一请求");h.permission.selectedTenantId=crypto.randomUUID();await nextTick();expect(h.state.pending.value).toBeNull();
});
it("queries the confirmed source after an uncertain save and never uses management receipts",async()=>{
  const h=harness();await vi.waitFor(()=>expect(h.state.canSubmit.value).toBe(true));h.output(candidate);await h.state.submit("草案");await h.state.refresh();h.uncertain(true);
  await h.state.confirm(definition,{source:receipt.source_id,digest:candidate.source_digest!});
  h.output({source_id:receipt.source_id,status:"confirmed",plan_id:plan.plan_id});expect(await h.state.checkPending()).toEqual(plan);
  expect(h.calls.filter(c=>c.command==="schedule_confirm_active_draft_v1")).toHaveLength(1);
  expect(h.calls.some(c=>c.command==="schedule_read_plan_mutation_receipt_v1")).toBe(false);
});
