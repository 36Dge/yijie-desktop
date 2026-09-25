// Generated from the private IPC source and shared references. DO NOT EDIT.
import type * as Plan from "../../domain/scheduled-plan.generated";
import type * as Execution from "../../domain/scheduled-execution.generated";
import type * as Draft from "../../domain/scheduled-draft.generated";
export type Empty = Record<string, never>;
export type FilterState = "all" | "enabled" | "paused" | "completed";
export type PlanOrder = "name_asc" | "name_desc" | "next_asc";
export type PauseReason = "unknown" | "budget" | "authorization" | "target" | "permission" | "resource" | "confirmation";
export type PrivateErrorCode = "context_invalid" | "cursor_invalid" | "protocol_mismatch" | "operation_unknown" | "storage_read_only" | "draft_unavailable" | "draft_source_invalid" | "draft_source_deleted" | "draft_not_candidate";
export type IpcErrorCode = Execution.ExecutionErrorCode | PrivateErrorCode;
export interface ErrorResponse{
schemaVersion:1;
requestId?:Plan.Identity;
code:IpcErrorCode;
}
export interface Availability{
schema_version:number;
readable:boolean;
writable:boolean;
preparation_enabled:boolean;
dispatch:AvailabilityDispatch;
platform_qualified:false;
}
export interface PlanQuery{
limit?:number;
cursor?:Plan.Identity;
search?:string;
state?:FilterState;
include_deleted?:boolean;
order?:PlanOrder;
}
export interface TargetQuery{
limit?:number;
cursor?:Plan.Identity;
search?:string;
}
export interface RecordQuery{
limit?:number;
cursor?:Plan.Identity;
plan_id?:Plan.Identity;
state?:FilterState;
}
export interface PlanKey{
plan_id:Plan.Identity;
}
export interface PlanMutation{
plan_id:Plan.Identity;
expected_revision:number;
}
export interface TimeQuery{
rule:Plan.TimeRule;
}
export interface RunKey{
kind:"run";
run_id:Plan.Identity;
}
export interface OccurrenceKey{
kind:"occurrence";
plan_id:Plan.Identity;
schedule_epoch:number;
logical_slot:string;
}
export type RecordKey = RunKey | OccurrenceKey;
export interface RerunInput{
original_run_id:Plan.Identity;
}
export interface RerunConfirmation{
original_run_id:Plan.Identity;
original_snapshot_digest:string;
plan_id:Plan.Identity;
revision:number;
definition_digest:string;
grant_id:Plan.Identity;
}
export interface ManualInput{
grant_id:Plan.Identity;
revision:number;
}
export interface PlanSummary{
plan_id:Plan.Identity;
name:string;
revision:number;
raw_state:Plan.PlanState;
effective_state:Plan.PlanState;
pause_reason?:PauseReason;
target_mode:Plan.TargetMode;
target_state:Plan.TargetState;
next_at?:number;
}
export interface PlanDetail{
plan:Plan.PlanView;
summary:PlanSummary;
grant?:Execution.GrantView;
}
export interface EnableResult{
plan:Plan.PlanView;
grant:Execution.GrantView;
future_hold?:PauseReason;
automatic_consent:boolean;
}
export interface RerunPreview{
confirmation:RerunReview;
original:Plan.PlanDefinition;
current:Plan.PlanDefinition;
}
export interface TargetSummary{
conversation_id:Plan.Identity;
title:string;
updated_at:number;
workspace_source:Execution.WorkspaceSource;
can_save:boolean;
execution:TargetSummaryExecution;
reason?:TargetSummaryReason;
}
export type Disposition = "consumed" | "skipped_paused" | "missed_offline" | "clock_discontinuity" | "cancelled" | "missed_late" | "busy" | "target_unavailable" | "permission_denied" | "resource_unavailable" | "unauthorized";
export interface Occurrence{
key:OccurrenceKey;
scheduled_at:number;
disposition:Disposition;
missed_through?:number;
}
export interface ConversationLink{
status:ConversationLinkStatus;
conversation_id?:Plan.Identity;
local_turn_id?:Plan.Identity;
}
export interface Timing{
execution_time:TimingExecutionTime;
duration:TimingDuration;
source:TimingSource;
started_at?:number;
completed_at?:number;
duration_ms?:number;
time_zone?:string;
diagnostic?:TimingDiagnostic;
}
export interface RunRecord{
kind:"run";
key:RunKey;
plan:PlanSummary;
run:Execution.RunView;
occurrence?:Occurrence;
conversation:ConversationLink;
timing:Timing;
attention:RunRecordAttention;
business_result:"not_evaluated";
}
export interface OccurrenceRecord{
kind:"occurrence";
key:OccurrenceKey;
plan:PlanSummary;
occurrence:Occurrence;
timing:Timing;
}
export type RecordView = RunRecord | OccurrenceRecord;
export interface SavedConfiguration{
name:string;
content:string;
rule:Plan.TimeRule;
target_mode:Plan.TargetMode;
}
export interface RecordDetail{
record:RecordView;
configuration?:SavedConfiguration;
}
export interface PlanPage{
items:Array<PlanSummary>;
next_cursor?:Plan.Identity;
}
export interface TargetPage{
items:Array<TargetSummary>;
next_cursor?:Plan.Identity;
}
export interface RecordPage{
items:Array<RecordView>;
next_cursor?:Plan.Identity;
}
export interface AvailabilityRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:Empty;
}
export interface AvailabilityResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:Availability;
}
export interface ListPlansRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:PlanQuery;
}
export interface ListPlansResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:PlanPage;
}
export interface GetPlanRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:PlanKey;
}
export interface GetPlanResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:PlanDetail;
}
export interface PreviewTimeRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:TimeQuery;
}
export interface PreviewTimeResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:Plan.TimePreview;
}
export interface ListTargetsRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:TargetQuery;
}
export interface ListTargetsResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:TargetPage;
}
export interface ListRecordsRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:RecordQuery;
}
export interface ListRecordsResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:RecordPage;
}
export interface GetRecordRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:RecordKey;
}
export interface GetRecordResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:RecordDetail;
}
export interface SavePlanRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:Plan.SavePlanRequest;
}
export interface SavePlanResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:Plan.PlanView;
}
export interface PausePlanRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:PlanMutation;
}
export interface PausePlanResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:Plan.PlanView;
}
export interface DeletePlanRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:PlanMutation;
}
export interface DeletePlanResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:Plan.PlanView;
}
export interface ConfirmGrantRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:Execution.GrantConfirmation;
}
export interface ConfirmGrantResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:Execution.GrantView;
}
export interface ConfirmEnableRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:EnableConfirmation;
}
export interface ConfirmEnableResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:EnableResult;
}
export interface ManualRunRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:ManualInput;
}
export interface ManualRunResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:Execution.RunView;
}
export interface PreviewRerunRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:RerunInput;
}
export interface PreviewRerunResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:RerunPreview;
}
export interface ConfirmRerunRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:RerunConfirmation;
}
export interface ConfirmRerunResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:Execution.RunView;
}
export interface DraftSubmit{
text:Draft.Text;
conversation_id?:Plan.Identity;
}
export interface DraftKey{
source_id:Plan.Identity;
}
export interface DraftReceipt{
source_id:Plan.Identity;
conversation_id:Plan.Identity;
local_turn_id:Plan.Identity;
operation_id:Plan.Identity;
status:"accepted";
}
export interface DraftPreview{
source_id:Plan.Identity;
status:DraftPreviewStatus;
source_digest?:string;
output?:Draft.Output;
plan_id?:Plan.Identity;
}
export interface DraftConfirmation{
source_id:Plan.Identity;
source_digest:string;
definition:Plan.PlanDefinition;
}
export interface SubmitDraftRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:DraftSubmit;
}
export interface SubmitDraftResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:DraftReceipt;
}
export interface PreviewDraftRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:DraftKey;
}
export interface PreviewDraftResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:DraftPreview;
}
export interface ConfirmDraftRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:DraftConfirmation;
}
export interface ConfirmDraftResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:Plan.PlanView;
}
export interface DraftSourceQuery{
conversation_id:Plan.Identity;
local_turn_id:Plan.Identity;
}
export interface DraftSourceLookup{
found:boolean;
source?:DraftReceipt;
}
export interface OperationCapability{
available:boolean;
reason:OperationCapabilityReason;
}
export interface OperationCapabilities{
read:OperationCapability;
save:OperationCapability;
manual:OperationCapability;
automatic:OperationCapability;
draft:OperationCapability;
single_run:OperationCapability;
}
export interface FindDraftSourceRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:DraftSourceQuery;
}
export interface FindDraftSourceResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:DraftSourceLookup;
}
export interface OperationCapabilitiesRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:Empty;
}
export interface OperationCapabilitiesResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:OperationCapabilities;
}
export interface ContinueDraftSourceRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:DraftKey;
}
export interface ContinueDraftSourceResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:DraftReceipt;
}
export type PlanCardOrder = "created_desc" | "created_asc";
export interface PlanCardQuery{
limit?:number;
cursor?:Plan.Identity;
search?:string;
state?:FilterState;
include_deleted?:boolean;
order?:PlanCardOrder;
}
export interface PlanCard{
summary:PlanSummary;
content_preview:string;
rule:Plan.TimeRule;
created_at?:number;
target_title?:string;
}
export interface RecordRowQuery{
limit?:number;
cursor?:Plan.Identity;
plan_id?:Plan.Identity;
state?:FilterState;
search?:string;
}
export type RecordRowSource = "run_snapshot" | "current_plan_reference";
export interface RecordRow{
record:RecordView;
name:string;
content_preview:string;
source:RecordRowSource;
}
export interface PlanMutationReceiptQuery{
original_request_id:Plan.Identity;
}
export type ReceiptObservation = "observed" | "not_observed";
export type PlanMutationReceipt = ObservedPlanMutationReceipt | UnobservedPlanMutationReceipt;
export interface PlanCardPage{
items:Array<PlanCard>;
next_cursor?:Plan.Identity;
}
export interface RecordRowPage{
items:Array<RecordRow>;
next_cursor?:Plan.Identity;
}
export interface ListPlanCardsRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:PlanCardQuery;
}
export interface ListPlanCardsResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:PlanCardPage;
}
export interface ListRecordRowsRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:RecordRowQuery;
}
export interface ListRecordRowsResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:RecordRowPage;
}
export interface ReadPlanMutationReceiptRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:PlanMutationReceiptQuery;
}
export interface ReadPlanMutationReceiptResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:PlanMutationReceipt;
}
export interface ObservedPlanMutationReceipt{
observation:"observed";
plan_id:Plan.Identity;
current_plan:PlanDetail;
}
export interface UnobservedPlanMutationReceipt{
observation:"not_observed";
}
export interface DraftSubmissionKey{
original_request_id:Plan.Identity;
}
export interface DraftSubmissionNotObserved{
observation:"not_observed";
}
export interface DraftSubmissionObserved{
observation:"observed";
receipt:DraftReceipt;
}
export interface DraftSubmissionDeleted{
observation:"source_deleted";
source_id:Plan.Identity;
plan_id?:Plan.Identity;
}
export type DraftSubmissionReceipt = DraftSubmissionNotObserved | DraftSubmissionObserved | DraftSubmissionDeleted;
export interface ReadDraftSubmissionReceiptRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:DraftSubmissionKey;
}
export interface ReadDraftSubmissionReceiptResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:DraftSubmissionReceipt;
}
export interface ExecutionReceiptKey{
operation:ExecutionReceiptKeyOperation;
original_request_id:Plan.Identity;
}
export interface ExecutionNotObserved{
observation:"not_observed";
}
export interface GrantObserved{
observation:"grant_observed";
grant:Execution.GrantView;
}
export interface ManualObserved{
observation:"manual_observed";
run:Execution.RunView;
}
export type ExecutionReceipt = ExecutionNotObserved | GrantObserved | ManualObserved | EnableObserved | SingleGrantObserved | RerunObserved;
export interface ReadExecutionReceiptRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:ExecutionReceiptKey;
}
export interface ReadExecutionReceiptResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:ExecutionReceipt;
}
export interface EnableConfirmation{
confirmation:Execution.GrantConfirmation;
expected_next_at:number;
}
export interface EnableObserved{
observation:"enable_observed";
result:EnableResult;
}
export interface RerunReview{
original_run_id:Plan.Identity;
original_snapshot_digest:string;
plan_id:Plan.Identity;
revision:number;
definition_digest:string;
}
export type SingleRunKind = "manual" | "rerun";
export interface SingleRunGrantConfirmation{
confirmation:Execution.GrantConfirmation;
kind:SingleRunKind;
review?:RerunReview;
}
export interface SingleRunGrantResult{
grant:Execution.GrantView;
kind:SingleRunKind;
original_run_id?:Plan.Identity;
}
export interface ConfirmSingleRunRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:SingleRunGrantConfirmation;
}
export interface ConfirmSingleRunResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:SingleRunGrantResult;
}
export interface SingleGrantObserved{
observation:"single_grant_observed";
result:SingleRunGrantResult;
}
export interface RerunObserved{
observation:"rerun_observed";
run:Execution.RunView;
}
export type ImportantUpdateState = "pending" | "needs_attention" | "completed" | "failed" | "interrupted";
export interface ImportantUpdate{
run_id:Plan.Identity;
plan_id:Plan.Identity;
name:string;
state:ImportantUpdateState;
}
export interface ImportantUpdates{
items:Array<ImportantUpdate>;
truncated:boolean;
}
export interface ImportantUpdatesRequest{
schemaVersion:1;
requestId:Plan.Identity;
contextId:Plan.Identity;
payload:Empty;
}
export interface ImportantUpdatesResponse{
schemaVersion:1;
requestId:Plan.Identity;
data:ImportantUpdates;
}
export type AvailabilityDispatch = "disabled" | "native_candidate";
export type TargetSummaryExecution = "requires_recheck" | "blocked";
export type TargetSummaryReason = "target_unavailable" | "permission_denied" | "busy" | "native_identity_unavailable";
export type ConversationLinkStatus = "available" | "deleted" | "unavailable";
export type TimingExecutionTime = "not_started" | "unknown" | "known";
export type TimingDuration = "not_started" | "unknown" | "known" | "in_progress";
export type TimingSource = "no_execution_clock" | "runtime_read";
export type TimingDiagnostic = "format_unsupported" | "field_invalid" | "source_conflict" | "history_unavailable" | "identity_mismatch";
export type RunRecordAttention = "none" | "needs_attention";
export type DraftPreviewStatus = "candidate" | "needs_clarification" | "unavailable" | "confirmed";
export type OperationCapabilityReason = "ready" | "storage_disabled" | "storage_read_only" | "authority_missing" | "candidate_disabled" | "runtime_unqualified";
export type ExecutionReceiptKeyOperation = "grant" | "manual" | "enable" | "single_grant" | "rerun";
export interface Requests {
"schedule_availability_v1":AvailabilityRequest;
"schedule_list_plans_v1":ListPlansRequest;
"schedule_get_plan_v1":GetPlanRequest;
"schedule_preview_time_v1":PreviewTimeRequest;
"schedule_list_targets_v1":ListTargetsRequest;
"schedule_list_records_v1":ListRecordsRequest;
"schedule_get_record_v1":GetRecordRequest;
"schedule_save_plan_v1":SavePlanRequest;
"schedule_pause_plan_v1":PausePlanRequest;
"schedule_delete_plan_v1":DeletePlanRequest;
"schedule_confirm_grant_v1":ConfirmGrantRequest;
"schedule_confirm_enable_v1":ConfirmEnableRequest;
"schedule_manual_run_v1":ManualRunRequest;
"schedule_preview_rerun_v1":PreviewRerunRequest;
"schedule_confirm_rerun_v1":ConfirmRerunRequest;
"schedule_submit_draft_v1":SubmitDraftRequest;
"schedule_preview_draft_v1":PreviewDraftRequest;
"schedule_confirm_draft_v1":ConfirmDraftRequest;
"schedule_find_draft_source_v1":FindDraftSourceRequest;
"schedule_operation_capabilities_v1":OperationCapabilitiesRequest;
"schedule_continue_draft_source_v1":ContinueDraftSourceRequest;
"schedule_list_plan_cards_v1":ListPlanCardsRequest;
"schedule_list_record_rows_v1":ListRecordRowsRequest;
"schedule_read_plan_mutation_receipt_v1":ReadPlanMutationReceiptRequest;
"schedule_read_draft_submission_receipt_v1":ReadDraftSubmissionReceiptRequest;
"schedule_read_execution_receipt_v1":ReadExecutionReceiptRequest;
"schedule_confirm_single_run_v1":ConfirmSingleRunRequest;
"schedule_list_important_updates_v1":ImportantUpdatesRequest;
"schedule_save_active_plan_v1":SavePlanRequest;
"schedule_confirm_active_draft_v1":ConfirmDraftRequest;
"schedule_enable_plan_v1":PausePlanRequest;
}
export interface Responses {
"schedule_availability_v1":AvailabilityResponse;
"schedule_list_plans_v1":ListPlansResponse;
"schedule_get_plan_v1":GetPlanResponse;
"schedule_preview_time_v1":PreviewTimeResponse;
"schedule_list_targets_v1":ListTargetsResponse;
"schedule_list_records_v1":ListRecordsResponse;
"schedule_get_record_v1":GetRecordResponse;
"schedule_save_plan_v1":SavePlanResponse;
"schedule_pause_plan_v1":PausePlanResponse;
"schedule_delete_plan_v1":DeletePlanResponse;
"schedule_confirm_grant_v1":ConfirmGrantResponse;
"schedule_confirm_enable_v1":ConfirmEnableResponse;
"schedule_manual_run_v1":ManualRunResponse;
"schedule_preview_rerun_v1":PreviewRerunResponse;
"schedule_confirm_rerun_v1":ConfirmRerunResponse;
"schedule_submit_draft_v1":SubmitDraftResponse;
"schedule_preview_draft_v1":PreviewDraftResponse;
"schedule_confirm_draft_v1":ConfirmDraftResponse;
"schedule_find_draft_source_v1":FindDraftSourceResponse;
"schedule_operation_capabilities_v1":OperationCapabilitiesResponse;
"schedule_continue_draft_source_v1":ContinueDraftSourceResponse;
"schedule_list_plan_cards_v1":ListPlanCardsResponse;
"schedule_list_record_rows_v1":ListRecordRowsResponse;
"schedule_read_plan_mutation_receipt_v1":ReadPlanMutationReceiptResponse;
"schedule_read_draft_submission_receipt_v1":ReadDraftSubmissionReceiptResponse;
"schedule_read_execution_receipt_v1":ReadExecutionReceiptResponse;
"schedule_confirm_single_run_v1":ConfirmSingleRunResponse;
"schedule_list_important_updates_v1":ImportantUpdatesResponse;
"schedule_save_active_plan_v1":SavePlanResponse;
"schedule_confirm_active_draft_v1":ConfirmDraftResponse;
"schedule_enable_plan_v1":PausePlanResponse;
}
export const commands = {
  "schedule_availability_v1": {
    "request": "AvailabilityRequest",
    "response": "AvailabilityResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_list_plans_v1": {
    "request": "ListPlansRequest",
    "response": "ListPlansResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_get_plan_v1": {
    "request": "GetPlanRequest",
    "response": "GetPlanResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_preview_time_v1": {
    "request": "PreviewTimeRequest",
    "response": "PreviewTimeResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_list_targets_v1": {
    "request": "ListTargetsRequest",
    "response": "ListTargetsResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_list_records_v1": {
    "request": "ListRecordsRequest",
    "response": "ListRecordsResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_get_record_v1": {
    "request": "GetRecordRequest",
    "response": "GetRecordResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_save_plan_v1": {
    "request": "SavePlanRequest",
    "response": "SavePlanResponse",
    "write": true,
    "permission": "manage"
  },
  "schedule_pause_plan_v1": {
    "request": "PausePlanRequest",
    "response": "PausePlanResponse",
    "write": true,
    "permission": "manage"
  },
  "schedule_delete_plan_v1": {
    "request": "DeletePlanRequest",
    "response": "DeletePlanResponse",
    "write": true,
    "permission": "manage"
  },
  "schedule_confirm_grant_v1": {
    "request": "ConfirmGrantRequest",
    "response": "ConfirmGrantResponse",
    "write": true,
    "permission": "manage"
  },
  "schedule_confirm_enable_v1": {
    "request": "ConfirmEnableRequest",
    "response": "ConfirmEnableResponse",
    "write": true,
    "permission": "run"
  },
  "schedule_manual_run_v1": {
    "request": "ManualRunRequest",
    "response": "ManualRunResponse",
    "write": true,
    "permission": "run"
  },
  "schedule_preview_rerun_v1": {
    "request": "PreviewRerunRequest",
    "response": "PreviewRerunResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_confirm_rerun_v1": {
    "request": "ConfirmRerunRequest",
    "response": "ConfirmRerunResponse",
    "write": true,
    "permission": "run"
  },
  "schedule_submit_draft_v1": {
    "request": "SubmitDraftRequest",
    "response": "SubmitDraftResponse",
    "write": true,
    "permission": "run"
  },
  "schedule_preview_draft_v1": {
    "request": "PreviewDraftRequest",
    "response": "PreviewDraftResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_confirm_draft_v1": {
    "request": "ConfirmDraftRequest",
    "response": "ConfirmDraftResponse",
    "write": true,
    "permission": "manage"
  },
  "schedule_find_draft_source_v1": {
    "request": "FindDraftSourceRequest",
    "response": "FindDraftSourceResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_operation_capabilities_v1": {
    "request": "OperationCapabilitiesRequest",
    "response": "OperationCapabilitiesResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_continue_draft_source_v1": {
    "request": "ContinueDraftSourceRequest",
    "response": "ContinueDraftSourceResponse",
    "write": true,
    "permission": "run"
  },
  "schedule_list_plan_cards_v1": {
    "request": "ListPlanCardsRequest",
    "response": "ListPlanCardsResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_list_record_rows_v1": {
    "request": "ListRecordRowsRequest",
    "response": "ListRecordRowsResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_read_plan_mutation_receipt_v1": {
    "request": "ReadPlanMutationReceiptRequest",
    "response": "ReadPlanMutationReceiptResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_read_draft_submission_receipt_v1": {
    "request": "ReadDraftSubmissionReceiptRequest",
    "response": "ReadDraftSubmissionReceiptResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_read_execution_receipt_v1": {
    "request": "ReadExecutionReceiptRequest",
    "response": "ReadExecutionReceiptResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_confirm_single_run_v1": {
    "request": "ConfirmSingleRunRequest",
    "response": "ConfirmSingleRunResponse",
    "write": true,
    "permission": "run"
  },
  "schedule_list_important_updates_v1": {
    "request": "ImportantUpdatesRequest",
    "response": "ImportantUpdatesResponse",
    "write": false,
    "permission": "read"
  },
  "schedule_save_active_plan_v1": {
    "request": "SavePlanRequest",
    "response": "SavePlanResponse",
    "write": true,
    "permission": "run"
  },
  "schedule_confirm_active_draft_v1": {
    "request": "ConfirmDraftRequest",
    "response": "ConfirmDraftResponse",
    "write": true,
    "permission": "run"
  },
  "schedule_enable_plan_v1": {
    "request": "PausePlanRequest",
    "response": "PausePlanResponse",
    "write": true,
    "permission": "run"
  }
} as const;
