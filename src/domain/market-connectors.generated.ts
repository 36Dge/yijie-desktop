// Generated from market-connectors source; DO NOT EDIT.
export const CONNECTOR_CAPABILITIES = ["connector.read","connector.manage","connector.credentials.manage","connector.use"] as const;
export type CanonicalId = string;
export type ServiceId = string;
export type Revision = number;
export type InitialRevision = 0;
export type SchemaVersion = 1;
export type CredentialReference = string;
export type Permission = "connector.read" | "connector.manage" | "connector.credentials.manage" | "connector.use";
export type CategoryId = "knowledge_docs" | "ecommerce_retail" | "data_analytics" | "productivity" | "industry_data" | "marketing";
export type Transport = "http" | "stdio";
export type AuthMode = "oauth" | "api_key" | "provider_credentials" | "local_oauth" | "stdio_api_key" | "provider_gateway" | "unknown";
export type Availability = "available" | "needs_setup" | "blocked" | "unverified";
export type InstallationStatus = "installed" | "removing" | "removed";
export type ConfigurationStatus = "unconfigured" | "configured" | "invalid" | "unknown";
export type AuthorizationStatus = "not_required" | "required" | "authorizing" | "authorized" | "expired" | "failed" | "unknown";
export type ConnectionStatus = "disconnected" | "connecting" | "ready" | "failed" | "unknown";
export type OperationAction = "install" | "configure" | "authorize" | "enable" | "disable" | "uninstall";
export type OperationStatus = "pending" | "succeeded" | "failed" | "cancelled" | "unknown";
export type ErrorCode = "invalid_request" | "context_invalid" | "not_found" | "request_conflict" | "not_configured" | "authorization_required" | "authorization_cancelled" | "dependency_missing" | "provider_onboarding_required" | "permission_denied" | "revision_conflict" | "unsupported_capability" | "rate_limited" | "temporarily_unavailable" | "operation_pending" | "outcome_unknown" | "cleanup_pending" | "execution_unavailable" | "selection_stale";
export interface CatalogEntry{
serviceId:ServiceId;
serverName:ServiceId;
displayName:string;
categoryId:CategoryId;
categoryLabel:string;
description:string;
iconAssetId:ServiceId;
transport:Transport;
authMode:AuthMode;
authorizationAvailable?:boolean;
availability:Availability;
blockerCodes:Array<ErrorCode>;
}
export interface Operation{
operationId:CanonicalId;
installationId:CanonicalId;
serviceId:ServiceId;
action:OperationAction;
status:OperationStatus;
revision:Revision;
cancellable:boolean;
errorCode?:ErrorCode;
}
export interface Installation{
installationId:CanonicalId;
serviceId:ServiceId;
revision:Revision;
generation:Revision;
status:InstallationStatus;
desiredEnabled:boolean;
effectiveEnabled:boolean;
configurationStatus:ConfigurationStatus;
authorizationStatus:AuthorizationStatus;
connectionStatus:ConnectionStatus;
credentialRef?:CredentialReference;
activeOperation?:Operation;
errorCode?:ErrorCode;
}
export interface Snapshot{
catalogRevision:Revision;
catalog:Array<CatalogEntry>;
installations:Array<Installation>;
capabilities:Array<Permission>;
executionAvailable:boolean;
}
export interface MutationResult{
installation:Installation;
operation:Operation;
}
export interface SelectionRef{
installationId:CanonicalId;
revision:Revision;
generation:Revision;
}
export interface SelectionDisplay{
reference:SelectionRef;
serviceId:ServiceId;
displayName:string;
}
export interface SelectionValidation{
selection:Array<SelectionDisplay>;
executionAvailable:boolean;
}
export type EmptyPayload=Record<string,never>;
export interface InstallPayload{
serviceId:ServiceId;
operationId:CanonicalId;
expectedRevision:InitialRevision;
}
export interface InstallationOperationPayload{
installationId:CanonicalId;
operationId:CanonicalId;
expectedRevision:Revision;
}
export interface CredentialOperationPayload{
installationId:CanonicalId;
operationId:CanonicalId;
expectedRevision:Revision;
expectedGeneration:Revision;
}
export interface SetEnabledPayload{
installationId:CanonicalId;
operationId:CanonicalId;
expectedRevision:Revision;
desiredEnabled:boolean;
}
export interface UninstallPayload{
installationId:CanonicalId;
operationId:CanonicalId;
expectedRevision:Revision;
confirmed:true;
}
export interface OperationReadPayload{
operationId:CanonicalId;
}
export interface OperationCancelPayload{
operationId:CanonicalId;
expectedRevision:Revision;
}
export interface SelectionValidatePayload{
selection:Array<SelectionRef>;
}
export interface SnapshotRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:EmptyPayload;
}
export interface SnapshotResponse{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
data:Snapshot;
}
export interface InstallRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:InstallPayload;
}
export interface MutationResponse{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
data:MutationResult;
}
export interface SetEnabledRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:SetEnabledPayload;
}
export interface UninstallRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:UninstallPayload;
}
export interface ConfigureRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:CredentialOperationPayload;
}
export interface AuthorizeRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:CredentialOperationPayload;
}
export interface OperationReadRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:OperationReadPayload;
}
export interface OperationResponse{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
data:Operation;
}
export interface OperationCancelRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:OperationCancelPayload;
}
export interface SelectionValidateRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:SelectionValidatePayload;
}
export interface SelectionValidateResponse{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
data:SelectionValidation;
}
export interface Error{
schemaVersion:SchemaVersion;
requestId?:CanonicalId;
code:ErrorCode;
retryable:boolean;
}
export type WorkerErrorCode = "invalid_request" | "not_qualified" | "unknown_service" | "temporarily_unavailable";
export interface WorkerLibraryPolicy{
mcpLibrary:"codex-rmcp-client";
oauthStore:"keyring_only";
credentialBoundary:"connectors_only";
stdioShutdown:"eof_only";
externalCallsEnabled:false;
}
export interface WorkerAuthStatusRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
method:"auth_status";
serviceId:ServiceId;
}
export interface WorkerAuthStatus{
serviceId:ServiceId;
qualification:"not_qualified";
authorizationStatus:"unknown";
connectionStatus:"disconnected";
executionAvailable:false;
libraryPolicy:WorkerLibraryPolicy;
}
export interface WorkerAuthStatusResponse{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
data:WorkerAuthStatus;
}
export interface WorkerError{
schemaVersion:SchemaVersion;
requestId?:CanonicalId;
code:WorkerErrorCode;
retryable:boolean;
}
export interface OperationReopenRequest{
schemaVersion:SchemaVersion;
requestId:CanonicalId;
contextId:CanonicalId;
payload:OperationCancelPayload;
}
export const MARKET_CONNECTOR_IPC = [{"command":"market_connectors_snapshot_v1","request":"SnapshotRequest","response":"SnapshotResponse","requiredPermission":"connector.read"},{"command":"market_connectors_install_v1","request":"InstallRequest","response":"MutationResponse","requiredPermission":"connector.manage"},{"command":"market_connectors_set_enabled_v1","request":"SetEnabledRequest","response":"MutationResponse","requiredPermission":"connector.manage"},{"command":"market_connectors_uninstall_v1","request":"UninstallRequest","response":"MutationResponse","requiredPermission":"connector.manage"},{"command":"market_connectors_configure_v1","request":"ConfigureRequest","response":"MutationResponse","requiredPermission":"connector.credentials.manage"},{"command":"market_connectors_authorize_v1","request":"AuthorizeRequest","response":"MutationResponse","requiredPermission":"connector.credentials.manage"},{"command":"market_connectors_operation_read_v1","request":"OperationReadRequest","response":"OperationResponse","requiredPermission":"connector.read"},{"command":"market_connectors_operation_cancel_v1","request":"OperationCancelRequest","response":"OperationResponse","requiredPermission":"action_owner_permission"},{"command":"market_connectors_operation_reopen_v1","request":"OperationReopenRequest","response":"OperationResponse","requiredPermission":"connector.credentials.manage"},{"command":"market_connectors_selection_validate_v1","request":"SelectionValidateRequest","response":"SelectionValidateResponse","requiredPermission":"connector.use"}] as const;
export interface IpcRequestMap{
"market_connectors_snapshot_v1":SnapshotRequest;
"market_connectors_install_v1":InstallRequest;
"market_connectors_set_enabled_v1":SetEnabledRequest;
"market_connectors_uninstall_v1":UninstallRequest;
"market_connectors_configure_v1":ConfigureRequest;
"market_connectors_authorize_v1":AuthorizeRequest;
"market_connectors_operation_read_v1":OperationReadRequest;
"market_connectors_operation_cancel_v1":OperationCancelRequest;
"market_connectors_operation_reopen_v1":OperationReopenRequest;
"market_connectors_selection_validate_v1":SelectionValidateRequest;
}
export interface IpcResponseMap{
"market_connectors_snapshot_v1":SnapshotResponse;
"market_connectors_install_v1":MutationResponse;
"market_connectors_set_enabled_v1":MutationResponse;
"market_connectors_uninstall_v1":MutationResponse;
"market_connectors_configure_v1":MutationResponse;
"market_connectors_authorize_v1":MutationResponse;
"market_connectors_operation_read_v1":OperationResponse;
"market_connectors_operation_cancel_v1":OperationResponse;
"market_connectors_operation_reopen_v1":OperationResponse;
"market_connectors_selection_validate_v1":SelectionValidateResponse;
}
