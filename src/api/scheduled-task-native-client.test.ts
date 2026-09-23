import { describe, expect, it, vi } from "vitest";
import { createScheduledTaskNativeClient } from "./scheduled-task-native-client";
import * as validators from "./generated/scheduled-task-ipc-validator.gen.js";
const requestId="11111111-1111-4111-8111-111111111111";
const contextId="22222222-2222-4222-8222-222222222222";
const request={schemaVersion:1 as const,requestId,contextId,payload:{}};
describe("FEAT155 private typed client",()=>{
 it("validates both directions and preserves exact request identity",async()=>{
  const response={schemaVersion:1,requestId,data:{items:[]}};
  const invoke=vi.fn().mockResolvedValue(response);
  expect(await createScheduledTaskNativeClient(invoke).call("schedule_list_plans_v1",request)).toEqual(response);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("schedule_list_plans_v1",{request});
 });
 it("rejects unknown versions, bounds, explicit null and unknown fields before I/O",async()=>{
  const invoke=vi.fn();const client=createScheduledTaskNativeClient(invoke);
  for(const payload of [{limit:0},{limit:101},{limit:1.5},{cursor:null},{authority:"renderer"}]){
   expect(validators.validateListPlansRequest({...request,payload})).toBe(false);
  }
  expect(validators.validateListPlansRequest({...request,schemaVersion:2})).toBe(false);
  await expect(client.call("schedule_list_plans_v1",{...request,payload:{limit:101}})).rejects.toMatchObject({code:"invalid_input"});expect(invoke).not.toHaveBeenCalled();
 });
 it("does not retry writes after transport failure or mismatched response",async()=>{
  for(const native of [vi.fn().mockRejectedValue("private detail"),vi.fn().mockResolvedValue({schemaVersion:1,requestId:contextId,data:{}})]){
   const client=createScheduledTaskNativeClient(native);
   await expect(client.call("schedule_pause_plan_v1",{...request,payload:{plan_id:contextId,expected_revision:1}})).rejects.toMatchObject({code:"operation_unknown",requestId});expect(native).toHaveBeenCalledTimes(1);
  }
 });
 it("preserves typed business rejection only for this logical request",async()=>{
  const invoke=vi.fn().mockRejectedValue({schemaVersion:1,requestId,code:"reservation_busy"});
  await expect(createScheduledTaskNativeClient(invoke).call("schedule_delete_plan_v1",{...request,payload:{plan_id:contextId,expected_revision:1}})).rejects.toMatchObject({code:"reservation_busy"});
  invoke.mockRejectedValue({schemaVersion:1,requestId:contextId,code:"reservation_busy"});
  await expect(createScheduledTaskNativeClient(invoke).call("schedule_delete_plan_v1",{...request,payload:{plan_id:contextId,expected_revision:1}})).rejects.toMatchObject({code:"operation_unknown"});
 });
 it("keeps unknown native failures closed without exposing exception details",async()=>{
  const invoke=vi.fn().mockRejectedValue({token:"not-a-real-secret",code:"future_error"});
  await expect(createScheduledTaskNativeClient(invoke).call("schedule_list_plans_v1",request)).rejects.toMatchObject({message:"protocol_mismatch"});
 });
});

describe("FEAT155 fixed-purpose draft IPC",()=>{
 it("accepts text handoff only and never retries an uncertain submission",async()=>{
  const invoke=vi.fn().mockRejectedValue(new Error("unavailable"));
  const client=createScheduledTaskNativeClient(invoke);
  await expect(client.call("schedule_submit_draft_v1",{...request,payload:{text:"每天九点总结"}})).rejects.toMatchObject({code:"operation_unknown",requestId});expect(invoke).toHaveBeenCalledTimes(1);
  for(const extra of [{cwd:"/synthetic"},{scope:contextId},{outputSchema:{}},{conversation_id:null}])expect(validators.validateSubmitDraftRequest({...request,payload:{text:"draft",...extra}})).toBe(false);
 });
 it("requires a native source digest and selected definition to confirm",()=>{
  expect(validators.validateConfirmDraftRequest({...request,payload:{source_id:contextId,source_digest:"a".repeat(64)}})).toBe(false);
  expect(validators.validatePreviewDraftResponse({schemaVersion:1,requestId,data:{source_id:contextId,status:"candidate"}})).toBe(false);
  expect(validators.validatePreviewDraftResponse({schemaVersion:1,requestId,data:{source_id:contextId,status:"candidate",source_digest:"a".repeat(64),output:{schema_version:1,kind:"needs_clarification",missing_fields:["time"],question:"何时？"}}})).toBe(false);
 });
});


describe("FEAT155 recovery commands",()=>{
 it("rediscovers only an exact local pair and separates per-operation readiness",async()=>{
  const invoke=vi.fn().mockResolvedValue({schemaVersion:1,requestId,data:{found:false}});
  await createScheduledTaskNativeClient(invoke).call("schedule_find_draft_source_v1",{...request,payload:{conversation_id:requestId,local_turn_id:contextId}});
  const capability={available:false,reason:"candidate_disabled"};
  invoke.mockResolvedValue({schemaVersion:1,requestId,data:{read:{available:true,reason:"ready"},save:{available:true,reason:"ready"},manual:capability,automatic:capability,draft:capability,single_run:capability}});
  await createScheduledTaskNativeClient(invoke).call("schedule_operation_capabilities_v1",request);
 });
 it("never retries explicit continuation or accepts a replacement body",async()=>{
  const invoke=vi.fn().mockRejectedValue(new Error("closed"));
  await expect(createScheduledTaskNativeClient(invoke).call("schedule_continue_draft_source_v1",{...request,payload:{source_id:contextId}})).rejects.toMatchObject({code:"operation_unknown"});
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(validators.validateContinueDraftSourceRequest({...request,payload:{source_id:contextId,text:"replacement"}})).toBe(false);
 });
});
