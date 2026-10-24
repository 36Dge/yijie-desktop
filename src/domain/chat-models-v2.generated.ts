// Generated from model-selection-v2.schema.json; DO NOT EDIT.
export type ProfileId="kimi-k3-max-v1"|"kimi-k3-1-pro-max-v1"|"minimax-m3-high-v1";
export type CanonicalId=string;
export type Revision=number;
export type SelectionState="ready"|"switching"|"unknown";
export interface ModelDefinition{
profile_id:ActiveProfileId;
label:string;
provider:string;
model:string;
effort:string;
context_window:number;
}
export interface ModelAvailability{
profile:ModelDefinition;
available:boolean;
reason:ModelAvailabilityReason;
}
export interface Catalog{
schema_version:2;
default_profile:ActiveProfileId;
models:Array<ModelAvailability>;
}
export interface Selection{
schema_version:2;
agent_session_id:CanonicalId;
state:SelectionState;
revision:Revision;
profile_id?:ProfileId;
operation_id?:CanonicalId;
availability:SelectionAvailability;
}
export interface SelectRequest{
schema_version:2;
operation_id:CanonicalId;
expected_revision:Revision;
profile_id:ActiveProfileId;
}
export interface Error{
schema_version:2;
code:ErrorCode;
}
export type ActiveProfileId="kimi-k3-1-pro-max-v1"|"minimax-m3-high-v1";
export type SelectionAvailability="ready"|"retired"|"not_configured"|"runtime_unavailable"|"activation_required"|"selection_unknown";
export interface OperationRequestSnapshot{
schema_version:number;
operation_id:CanonicalId;
expected_revision:Revision;
profile_id:ProfileId;
}
export type ModelOperationState="prepared"|"applying"|"unknown"|"committed"|"cancelled";
export interface ModelOperationReceipt{
schema_version:2;
agent_session_id:CanonicalId;
operation_id:CanonicalId;
state:ModelOperationState;
request:OperationRequestSnapshot;
result?:SelectionResultSnapshot;
}
export interface RecoverRequest{
schema_version:2;
operation_id:CanonicalId;
expected_revision:Revision;
profile_id:ActiveProfileId;
}
export interface SelectionResultSnapshot{
schema_version:number;
agent_session_id:CanonicalId;
state:SelectionState;
revision:Revision;
profile_id?:ProfileId;
operation_id?:CanonicalId;
availability?:SelectionAvailability;
}
export type ModelAvailabilityReason="ready"|"not_configured"|"runtime_unavailable"|"activation_required";
export type ErrorCode="invalid_request"|"unauthorized"|"not_found"|"busy"|"revision_conflict"|"request_conflict"|"model_unavailable"|"selection_unknown"|"runtime_unavailable"|"model_retired"|"activation_required";
export const modelDefinitions: ReadonlyArray<ModelDefinition> = [{"profile_id":"kimi-k3-1-pro-max-v1","label":"Kimi K3.1 Pro","provider":"kimi","model":"kimi-k3.1-pro","effort":"max","context_window":1048576},{"profile_id":"minimax-m3-high-v1","label":"MiniMax M3","provider":"minimax","model":"MiniMax-M3","effort":"high","context_window":1000000}];
