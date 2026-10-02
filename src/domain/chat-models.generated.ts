// Generated from model-selection-v1.schema.json; DO NOT EDIT.
export type ProfileId="kimi-k3-max-v1"|"minimax-m3-high-v1";
export type CanonicalId=string;
export type Revision=number;
export type SelectionState="ready"|"switching"|"unknown";
export interface ModelDefinition{
profile_id:ProfileId;
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
schema_version:1;
default_profile:ProfileId;
models:Array<ModelAvailability>;
}
export interface Selection{
schema_version:1;
agent_session_id:CanonicalId;
state:SelectionState;
revision:Revision;
profile_id?:ProfileId;
operation_id?:CanonicalId;
}
export interface SelectRequest{
schema_version:1;
operation_id:CanonicalId;
expected_revision:Revision;
profile_id:ProfileId;
}
export interface Error{
schema_version:1;
code:ErrorCode;
}
export type ModelAvailabilityReason="ready"|"not_configured"|"runtime_unavailable";
export type ErrorCode="invalid_request"|"unauthorized"|"not_found"|"busy"|"revision_conflict"|"request_conflict"|"model_unavailable"|"selection_unknown"|"runtime_unavailable";
export const modelDefinitions: ReadonlyArray<ModelDefinition> = [{"profile_id":"kimi-k3-max-v1","label":"Kimi K3","provider":"kimi","model":"kimi-k3","effort":"max","context_window":1048576},{"profile_id":"minimax-m3-high-v1","label":"MiniMax M3","provider":"minimax","model":"MiniMax-M3","effort":"high","context_window":1000000}];
