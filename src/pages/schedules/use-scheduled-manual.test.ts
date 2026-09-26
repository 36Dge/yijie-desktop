// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
import { createScheduledTaskNativeClient } from "../../api/scheduled-task-native-client";
import type { Requests } from "../../api/generated/scheduled-task-ipc.gen";
import { useScheduledManagement } from "./use-scheduled-management";
import { useScheduledManual } from "./use-scheduled-manual";

const stores = vi.hoisted(() => ({ chat: {} as object, permission: {} as object }));
vi.mock("../../stores/chat.store", () => ({ useChatStore: () => stores.chat }));
vi.mock("../../stores/permission.store", () => ({ usePermissionStore: () => stores.permission }));
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(f => f()));
function harness() {
  const chat = reactive({ context: { contextId: crypto.randomUUID() } as { contextId: string } | null });
  const permission = reactive({ selectedTenantId: crypto.randomUUID() as string | null, isReady: true, hasCapability: () => true });
  stores.chat = chat; stores.permission = permission;
  const plan = { plan_id: crypto.randomUUID(), revision: 1, schedule_epoch: 1, definition: { name: "手动合成", content: "仅文本", rule: { frequency: "daily", time_zone: "Asia/Shanghai", local_time: "09:00" }, target: { mode: "dedicated_chat" } }, state: "paused", target_state: "unbound", effective_from: 1790000000, next_at: 1790038800, rule_version: 1, tzdb_version: "2026b" };
  const summary = { plan_id: plan.plan_id, name: "手动合成", revision: 1, raw_state: "paused", effective_state: "paused", target_mode: "dedicated_chat", target_state: "unbound" };
  const grant = { grant_id: crypto.randomUUID(), plan_id: plan.plan_id, plan_revision: 1, authorization_revision: 1, definition_digest: "a".repeat(64), workspace: { source: "managed_schedule", resource_id: plan.plan_id }, max_runs: 1, occupied_runs: 0, expires_at: Math.floor(Date.now()/1000)+600, state: "active" };
  const run = { run_id: crypto.randomUUID(), request_id: crypto.randomUUID(), plan_id: plan.plan_id, plan_revision: 1, schedule_epoch: 1, grant_id: grant.grant_id, operation_id: crypto.randomUUID(), trigger: "manual", workspace: grant.workspace, permission_mode: "ask", snapshot_digest: "b".repeat(64), delivery_state: "terminal", native_outcome: "completed", needs_attention: false };
  const originalId=crypto.randomUUID();
  const preview={confirmation:{original_run_id:originalId,original_snapshot_digest:"c".repeat(64),plan_id:plan.plan_id,revision:plan.revision,definition_digest:"d".repeat(64)},original:{...plan.definition,content:"旧内容"},current:plan.definition};
  const calls: { command: string; request: Requests[keyof Requests] }[] = [];
  let prepared=false; let failure: "grant" | "manual" | "busy" | null = null; let observed=true; let listFails=false;
  const prepare=vi.fn(async()=>{prepared=true;return true;});
  const native = createScheduledTaskNativeClient(async(command,args)=>{
    const request=args.request as Requests[keyof Requests];calls.push({command,request});let data:unknown;
    switch(command) {
      case "schedule_operation_capabilities_v1": data=Object.fromEntries(["read","save","manual","automatic","draft","single_run"].map(k=>[k,{available:k==="read"||k==="save"||(k==="single_run"&&prepared),reason:k==="read"||k==="save"||(k==="single_run"&&prepared)?"ready":k==="single_run"?"runtime_unqualified":"candidate_disabled"}]));break;
      case "schedule_list_plan_cards_v1": if(listFails)throw {schemaVersion:1,requestId:request.requestId,code:"storage_unavailable"};data={items:[]};break;
      case "schedule_get_plan_v1":data={plan,summary};break;
      case "schedule_confirm_single_run_v1":if(failure==="grant")throw {schemaVersion:1,requestId:request.requestId,code:"operation_unknown"};data={grant,kind:"kind" in request.payload?request.payload.kind:"manual",...("review" in request.payload ? {original_run_id:originalId}: {})};break;
      case "schedule_preview_rerun_v1":data=preview;break;
      case "schedule_confirm_rerun_v1":
      case "schedule_manual_run_v1":if(failure==="manual"||failure==="busy")throw {schemaVersion:1,requestId:request.requestId,code:failure==="busy"?"reservation_busy":"operation_unknown"};data=command==="schedule_confirm_rerun_v1"?{...run,trigger:"rerun",original_run_id:originalId}:run;break;
      case "schedule_read_execution_receipt_v1":{
        const operation="operation" in request.payload?request.payload.operation:"";
        data=!observed?{observation:"not_observed"}:operation==="single_grant"?{observation:"single_grant_observed",result:{grant,kind:calls.some(c=>c.command==="schedule_preview_rerun_v1")?"rerun":"manual",...(calls.some(c=>c.command==="schedule_preview_rerun_v1")?{original_run_id:originalId}:{})}}:{observation:operation==="rerun"?"rerun_observed":"manual_observed",run:operation==="rerun"?{...run,trigger:"rerun",original_run_id:originalId}:run};break;
      }
      case "schedule_get_record_v1":data={record:{kind:"run",key:{kind:"run",run_id:run.run_id},plan:summary,run,conversation:{status:"available",conversation_id:crypto.randomUUID(),local_turn_id:crypto.randomUUID()},timing:{execution_time:"unknown",duration:"unknown",source:"no_execution_clock"},attention:"none",business_result:"not_evaluated"}};break;
      default:throw Error(`Unexpected ${command}`);
    }
    return {schemaVersion:1,requestId:request.requestId,data};
  });
  const scope=effectScope(); const state=scope.run(()=>{const m=useScheduledManagement(native);return {m,s:useScheduledManual(m,prepare)};})!;cleanup.push(()=>scope.stop());
  return {...state,plan,run,originalId,preview,calls,chat,permission,prepare,fail:(v:typeof failure)=>{failure=v;},failList:(v:boolean)=>{listFails=v;},observe:(v:boolean)=>{observed=v;}};
}
it("reads cold, explicitly prepares, confirms exactly one bounded run and locates its receipt",async()=>{
  const h=harness();await vi.waitFor(()=>expect(h.s.canPrepare.value).toBe(true));expect(h.prepare).not.toHaveBeenCalled();
  await h.s.open(h.plan.plan_id);expect(h.prepare).toHaveBeenCalledOnce();expect(h.s.review.value).not.toBeNull();
  expect(h.calls.filter(c=>c.command==="schedule_manual_run_v1")).toHaveLength(0);
  await Promise.all([h.s.confirm(),h.s.confirm()]);
  expect(h.s.error.value).toBeNull();expect(h.s.result.value?.record.key).toEqual({kind:"run",run_id:h.run.run_id});
  const g=h.calls.filter(c=>c.command==="schedule_confirm_single_run_v1");expect(g).toHaveLength(1);
  expect(g[0]!.request.payload).toMatchObject({kind:"manual",confirmation:{max_runs:1,expected_revision:1}});
  expect(h.calls.filter(c=>c.command==="schedule_manual_run_v1")).toHaveLength(1);
  expect(h.calls.some(c=>/enable|rerun/.test(c.command))).toBe(false);
});
it("queries uncertain grant without submitting manual; explicit continue uses its reserved ID",async()=>{
  const h=harness();await vi.waitFor(()=>expect(h.s.canPrepare.value).toBe(true));await h.s.open(h.plan.plan_id);h.fail("grant");await h.s.confirm();
  const id=h.s.intent.value!.manualId;await h.s.query();expect(h.s.intent.value?.grant).not.toBeNull();
  expect(h.calls.filter(c=>c.command==="schedule_manual_run_v1")).toHaveLength(0);
  h.fail(null);await h.s.retry();expect(h.calls.find(c=>c.command==="schedule_manual_run_v1")?.request.requestId).toBe(id);
});
it("manual receipt observation never retries or renews and preserves same-scope uncertainty",async()=>{
  const h=harness();await vi.waitFor(()=>expect(h.s.canPrepare.value).toBe(true));await h.s.open(h.plan.plan_id);h.fail("manual");await h.s.confirm();
  const i=h.s.intent.value;h.chat.context=null;await nextTick();expect(h.s.intent.value).toBe(i);h.chat.context={contextId:crypto.randomUUID()};await nextTick();
  h.observe(false);await h.s.query();expect(h.s.pending.value).toBe(true);
  h.observe(true);await h.s.query();expect(h.s.pending.value).toBe(false);expect(h.calls.filter(c=>c.command==="schedule_manual_run_v1")).toHaveLength(1);
});
it("scope changes clear all pending execution input",async()=>{
  const h=harness();await vi.waitFor(()=>expect(h.s.canPrepare.value).toBe(true));await h.s.open(h.plan.plan_id);h.fail("grant");await h.s.confirm();h.permission.selectedTenantId=crypto.randomUUID();await nextTick();
  expect(h.s.pending.value).toBe(false);await h.s.retry();expect(h.calls.filter(c=>c.command==="schedule_confirm_single_run_v1")).toHaveLength(1);
});

it("reviews rerun without preparing Host, uses current differences and distinct source",async()=>{
 const h=harness();h.plan.state="enabled";await vi.waitFor(()=>expect(h.s.canPrepare.value).toBe(true));
 await h.s.openRerun(h.originalId);expect(h.prepare).not.toHaveBeenCalled();expect(h.s.rerun.value?.original.content).toBe("旧内容");
 await h.s.confirm();expect(h.s.error.value).toBeNull();expect(h.calls.filter(c=>c.command==="schedule_confirm_rerun_v1")).toHaveLength(1);
 expect(h.calls.filter(c=>c.command==="schedule_manual_run_v1")).toHaveLength(0);
 const grant=h.calls.find(c=>c.command==="schedule_confirm_single_run_v1")!;expect(grant.request.payload).toMatchObject({kind:"rerun",review:h.preview.confirmation,confirmation:{max_runs:1}});
 expect(h.calls.some(c=>/pause|enable/.test(c.command))).toBe(false);expect(h.s.notice.value).not.toContain("仍保持暂停");
});
it("queries uncertain rerun and retries only its original immutable request",async()=>{
 const h=harness();await vi.waitFor(()=>expect(h.s.canPrepare.value).toBe(true));await h.s.openRerun(h.originalId);h.fail("manual");await h.s.confirm();
 const request=h.calls.find(c=>c.command==="schedule_confirm_rerun_v1")!.request;h.observe(false);await h.s.query();expect(h.s.pending.value).toBe(true);
 expect(h.calls[h.calls.length-1]!.request.payload).toMatchObject({operation:"rerun",original_request_id:request.requestId});
 h.fail(null);await h.s.retry();const reruns=h.calls.filter(c=>c.command==="schedule_confirm_rerun_v1");expect(reruns).toHaveLength(2);expect(reruns[1]!.request).toEqual(request);
 expect(h.calls.filter(c=>c.command==="schedule_confirm_single_run_v1")).toHaveLength(1);
});
it("completed plans permit one explicit manual run without reopening the plan",async()=>{
 const h=harness();h.plan.state="completed";await vi.waitFor(()=>expect(h.s.canPrepare.value).toBe(true));await h.s.open(h.plan.plan_id);await h.s.confirm();
 expect(h.s.error.value).toBeNull();expect(h.plan.state).toBe("completed");expect(h.calls.some(c=>/pause|enable/.test(c.command))).toBe(false);
});

it("runs directly from a card without exposing a review and announces only an accepted run", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true));
  await Promise.all([h.s.runNow(h.plan.plan_id), h.s.runNow(h.plan.plan_id)]);
  expect(h.prepare).toHaveBeenCalledOnce();
  expect(h.s.review.value).toBeNull(); expect(h.s.direct.value).toBe(true);
  expect(h.s.startedRunId.value).toBe(h.run.run_id);
  expect(h.s.notice.value).toBe("");
  expect(h.calls.filter(c => c.command === "schedule_confirm_single_run_v1")).toHaveLength(1);
  expect(h.calls.filter(c => c.command === "schedule_manual_run_v1")).toHaveLength(1);
  expect(h.plan.state).toBe("paused");
});

it("does not submit or announce a run if local execution preparation fails", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true));
  h.prepare.mockResolvedValue(false);
  await h.s.runNow(h.plan.plan_id);
  expect(h.s.error.value).toBe("execution_not_ready");
  expect(h.s.review.value).toBeNull(); expect(h.s.startedRunId.value).toBeNull();
  expect(h.calls.some(c => /confirm_single_run|manual_run/.test(c.command))).toBe(false);
});

it("retains an uncertain direct run for read-only receipt recovery without another submission", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true));
  h.fail("manual"); await h.s.runNow(h.plan.plan_id);
  expect(h.s.pending.value).toBe(true); expect(h.s.review.value).toBeNull(); expect(h.s.startedRunId.value).toBeNull();
  const request = h.s.intent.value!.manualId;
  await h.s.query();
  expect(h.s.pending.value).toBe(false); expect(h.s.startedRunId.value).toBeNull();
  expect(h.calls.filter(c => c.command === "schedule_manual_run_v1")).toHaveLength(1);
  expect(h.calls.find(c => c.command === "schedule_read_execution_receipt_v1")?.request.payload).toEqual({ operation: "manual", original_request_id: request });
});

it("does not announce a cancelled or failed historical run as newly started", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true));
  h.run.delivery_state = "cancelled"; h.run.native_outcome = "failed";
  await h.s.runNow(h.plan.plan_id);
  expect(h.s.startedRunId.value).toBeNull(); expect(h.s.notice.value).toContain("查看当前状态");
});

it("clears a definite rejection only after a successful refresh, without another submission", async () => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true));
  h.fail("busy"); await h.s.runNow(h.plan.plan_id);
  expect(h.s.error.value).toBe("reservation_busy"); expect(h.s.notice.value).toBe("");
  expect(h.s.pending.value).toBe(false);
  h.failList(true); await h.m.refresh();
  expect(h.s.error.value).toBe("reservation_busy");
  h.failList(false); await h.m.refresh();
  expect(h.s.error.value).toBeNull(); expect(h.s.notice.value).toBe("");
  expect(h.calls.filter(c => c.command === "schedule_manual_run_v1")).toHaveLength(1);
  expect(h.calls.filter(c => c.command === "schedule_confirm_single_run_v1")).toHaveLength(1);
});

it.each(["grant", "manual"] as const)("preserves an uncertain %s and its original request through refresh, dismissal and rebind", async failure => {
  const h = harness(); await vi.waitFor(() => expect(h.s.canPrepare.value).toBe(true));
  h.fail(failure); await h.s.runNow(h.plan.plan_id);
  const intent = h.s.intent.value!; const error = h.s.error.value; const notice = h.s.notice.value;
  await h.m.refresh(); h.s.dismissFeedback();
  h.chat.context = null; await nextTick(); h.chat.context = { contextId: crypto.randomUUID() }; await nextTick();
  await h.m.refresh();
  expect(h.s.pending.value).toBe(true); expect(h.s.intent.value).toBe(intent);
  expect(h.s.error.value).toBe(error); expect(h.s.notice.value).toBe(notice);
  h.observe(false); await h.s.query();
  expect(h.calls.find(c => c.command === "schedule_read_execution_receipt_v1")?.request.payload).toEqual({ operation: failure === "grant" ? "single_grant" : "manual", original_request_id: failure === "grant" ? intent.confirmation.request_id : intent.manualId });
  expect(h.calls.filter(c => c.command === "schedule_confirm_single_run_v1")).toHaveLength(1);
  expect(h.calls.filter(c => c.command === "schedule_manual_run_v1")).toHaveLength(failure === "grant" ? 0 : 1);
});
