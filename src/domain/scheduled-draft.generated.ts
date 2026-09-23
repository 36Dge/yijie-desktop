// Generated from draft-execution source. DO NOT EDIT.
export type Identity=string;
export type Version=1;
export type Text=string;
export interface CreateRequest{
schema_version:1;
policy_version:1;
task_id:Identity;
workspace_id:Identity;
}
export interface ResumeRequest{
schema_version:1;
policy_version:1;
}
export interface TurnRequest{
schema_version:1;
policy_version:1;
operation_id:Identity;
text:Text;
}
export interface SessionReceipt{
schema_version:1;
policy_version:1;
purpose:"scheduled_plan_draft";
task_id:Identity;
agent_session_id:Identity;
workspace_id:Identity;
}
export interface TurnReceipt{
schema_version:1;
policy_version:1;
agent_session_id:Identity;
operation_id:Identity;
turn_id:Identity;
}
export interface Capability{
schema_version:1;
available:boolean;
reason:CapabilityReason;
}
export type ErrorCode="invalid_request"|"not_found"|"request_conflict"|"purpose_conflict"|"storage_disabled"|"policy_unqualified"|"operation_unknown"|"busy"|"storage_unavailable"|"unauthorized";
export interface Error{
schema_version:1;
code:ErrorCode;
}
export interface Clarification{
schema_version:1;
kind:"needs_clarification";
missing_fields:Array<ClarificationMissingFieldsItem>;
question:string;
}
export interface Candidate{
schema_version:1;
kind:"candidate";
name:string;
content:string;
schedule:CandidateSchedule;
target:CandidateTarget;
}
export type Output=Clarification|Candidate;
export interface RecoveryMapping{
schema_version:1;
policy_version:1;
purpose:"scheduled_plan_draft";
task_id:Identity;
agent_session_id:Identity;
workspace_id:Identity;
mapping_state:RecoveryMappingMappingState;
codex_thread_id?:Identity;
responding_host_instance_id?:Identity;
}
export type CapabilityReason="ready"|"storage_disabled"|"policy_unqualified";
export type ClarificationMissingFieldsItem="name"|"content"|"frequency"|"time"|"time_zone"|"target";
export interface CandidateSchedule{
frequency:CandidateScheduleFrequency;
time_zone:string;
local_time:string;
local_date?:string;
weekdays?:Array<number>;
}
export interface CandidateTarget{
mode:CandidateTargetMode;
existing_chat_label?:string;
}
export type RecoveryMappingMappingState="reserved"|"bound";
export type CandidateScheduleFrequency="once"|"daily"|"weekdays"|"weekly";
export type CandidateTargetMode="dedicated_chat"|"new_chat_each_run"|"existing_chat";
