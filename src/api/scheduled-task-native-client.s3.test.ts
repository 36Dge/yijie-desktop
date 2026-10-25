import {expect,it,vi} from "vitest";
vi.mock("./chat-model-client",()=>({kimiK31Candidate:true}));
import {createScheduledTaskNativeClient} from "./scheduled-task-native-client";
import * as legacy from "./generated/scheduled-task-ipc-validator.gen.js";
import * as current from "./generated/scheduled-task-ipc-v2-validator.gen.js";
const id="16400000-0000-4000-8000-000000000001";
const definition={name:"合成任务",content:"公开信息",rule:{frequency:"daily" as const,time_zone:"Asia/Shanghai",local_time:"09:00"},target:{mode:"dedicated_chat" as const},model_profile:"kimi-k3-1-pro-max-v1" as const};
const request={schemaVersion:1 as const,contextId:id,requestId:id,payload:{request_id:id,definition}};
it("candidate selects the versioned validator before IPC and validates the new-profile response",async()=>{
 expect(legacy.validateSavePlanRequest(request)).toBe(false);expect(current.validateSavePlanRequest(request)).toBe(true);
 const plan={plan_id:id,revision:1,schedule_epoch:1,definition,state:"paused",target_state:"unbound",effective_from:0,rule_version:1,tzdb_version:"test"};
 const response={schemaVersion:1,requestId:id,data:plan};const invoke=vi.fn().mockResolvedValue(response);
 expect(await createScheduledTaskNativeClient(invoke).call("schedule_save_plan_v1",request)).toEqual(response);expect(invoke).toHaveBeenCalledTimes(1);
});
it("candidate rejects malformed plan values without I/O",async()=>{
 const invoke=vi.fn();
 const malformed={...request,payload:{...request.payload,definition:{...definition,model_profile:"unknown"}}};
 expect(current.validateSavePlanRequest(malformed)).toBe(false);
 await expect(createScheduledTaskNativeClient(invoke).call("schedule_save_plan_v1",malformed as typeof request)).rejects.toMatchObject({code:"invalid_input"});expect(invoke).not.toHaveBeenCalled();
});
