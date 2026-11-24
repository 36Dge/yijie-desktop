// Generated from builtin-web-retrieval/1. DO NOT EDIT.

export type BuiltinWebRetrievalV1 =
  | PublicUrl
  | SearchArguments
  | FetchArguments
  | SearchResult
  | SearchSuccess
  | FetchSuccess
  | ErrorCode
  | ToolError
  | ErrorOutput
  | SearchOutput
  | FetchOutput
  | ContentStatus
  | ChunkScore
  | SearchChunk
  | DateBound
  | TimeWindow
  | ProArguments
  | ContentResult
  | ProResult
  | ContentSuccess
  | ProSuccess
  | ProOutput
  | OperationId
  | BindingId
  | NativeId
  | Revision
  | AppErrorCode
  | AppError
  | AppErrorOutput
  | DelegationRequest
  | Delegation
  | BindingRevocation
  | OperationState
  | DispatchFact
  | OperationStatus
  | CancelResult
  | ClaimRequest
  | ClaimReceipt
  | ClaimFinish
  | WebCapabilityInstall
  | WebCapabilityClear
  | WebTurnRevoke
  | WebCallCancel
  | ControlAck
  | ExpertWebPolicy
  | BasicOperation
  | ProOperation
  | FetchOperation
  | OperationRequest
  | InternalExecute
  | APIError
  | ExecutionResult
  | ToolOutput
  | ExecutorWorkerRequest
  | WebControlRequest
  | WebControlResponse
  | WebAdmissionRequest
  | WebAdmissionReceipt
  | WebWorkerInstall
  | LocalNativeCredential
  | DeepSearchReceipt
  | WebAdmissionReceiptV2
  | DeepSearchRequest
  | DeepSearchResponse
  | WebWorkerFacts
  | ClaimFinishV2
  | WebWorkerEnvelopeV2
  | ScopedFetchRequest
  | ScopedFetchResponse;
/**
 * Public HTTP(S) URL. Connector additionally parses authority, rejects userinfo/control characters and local/private literal destinations; no local request to this target is made.
 */
export type PublicUrl = string;
export type ErrorCode =
  | "invalid_arguments"
  | "authentication_failed"
  | "permission_denied"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "no_content"
  | "response_too_large"
  | "invalid_response"
  | "cancelled";
export type SearchOutput = SearchSuccess | ContentSuccess | ErrorOutput;
export type ContentStatus = "available" | "unavailable" | "truncated";
export type FetchOutput = FetchSuccess | ErrorOutput;
/**
 * Finite query-relative score. No cross-query trust threshold.
 */
export type ChunkScore = number;
export type DateBound = string;
export type ProOutput = ProSuccess | ErrorOutput;
export type OperationId = string;
export type BindingId = string;
export type NativeId = string;
export type Revision = number;
export type AppErrorCode =
  | "invalid_arguments"
  | "session_expired"
  | "not_entitled"
  | "quota_exceeded"
  | "busy"
  | "upstream_unavailable"
  | "timeout"
  | "url_blocked"
  | "no_content"
  | "response_too_large"
  | "invalid_response"
  | "cancelled"
  | "outcome_unknown"
  | "operation_conflict"
  | "operation_expired"
  | "result_unavailable";
export type OperationState = "ready" | "dispatch_committed" | "completed" | "unknown" | "cancelled" | "rejected";
export type DispatchFact = "not_dispatched" | "may_have_dispatched" | "completed";
export type OperationRequest = BasicOperation | ProOperation | FetchOperation;
export type ToolOutput = SearchSuccess | ContentSuccess | ProSuccess | FetchSuccess | AppErrorOutput;

export interface SearchArguments {
  query: string;
  limit?: number;
  include_content?: boolean;
}
export interface FetchArguments {
  url: PublicUrl;
}
export interface SearchResult {
  title: string;
  url: PublicUrl;
  snippet: string;
}
export interface SearchSuccess {
  /**
   * @maxItems 20
   */
  results: SearchResult[];
  truncated: boolean;
}
export interface FetchSuccess {
  url: PublicUrl;
  title: string;
  markdown: string;
  truncated: boolean;
}
export interface ToolError {
  code: ErrorCode;
  message: string;
}
export interface ErrorOutput {
  error: ToolError;
}
export interface ContentSuccess {
  /**
   * @maxItems 20
   */
  results: ContentResult[];
  truncated: boolean;
  dropped_results: number;
}
export interface ContentResult {
  title: string;
  url: PublicUrl;
  snippet: string;
  text: string;
  content_status: ContentStatus;
}
export interface SearchChunk {
  text: string;
  score: ChunkScore;
}
export interface TimeWindow {
  start?: DateBound;
  end?: DateBound;
}
export interface ProArguments {
  query: string;
  limit?: number;
  /**
   * @maxItems 5
   */
  sites?: string[];
  time_window?: TimeWindow;
}
export interface ProResult {
  title: string;
  url: PublicUrl;
  snippet: string;
  site_name: string;
  date: string;
  authority: string;
  chunks: SearchChunk[];
  content_status: ContentStatus;
}
export interface ProSuccess {
  /**
   * @maxItems 20
   */
  results: ProResult[];
  truncated: boolean;
  dropped_results: number;
}
export interface AppError {
  code: AppErrorCode;
  message: string;
}
export interface AppErrorOutput {
  error: AppError;
}
export interface DelegationRequest {
  native_binding_reference: string;
}
export interface Delegation {
  binding_id: BindingId;
  grant_id: string;
  bearer: string;
  expires_at_unix_ms: number;
  authorization_revision: Revision;
  credential_revision: Revision;
  audience: "builtin-web-retrieval/1";
}
export interface BindingRevocation {
  binding_id: BindingId;
  state: "revoked";
}
export interface OperationStatus {
  operation_id: OperationId;
  state: OperationState;
  dispatch: DispatchFact;
  result_availability: "none" | "available" | "result_unavailable";
}
export interface CancelResult {
  operation_id: OperationId;
  dispatch: DispatchFact;
  state: "cancelled_before_dispatch" | "may_have_dispatched" | "already_completed";
}
export interface ClaimRequest {
  operation_id: OperationId;
  parameter_digest: string;
  executor_instance: string;
}
export interface ClaimReceipt {
  operation_id: OperationId;
  claim_id: string;
  parameter_digest: string;
  executor_instance: string;
  deadline_unix_ms: number;
}
export interface ClaimFinish {
  receipt: ClaimReceipt;
  state: "completed" | "unknown";
  dispatch: DispatchFact;
}
export interface WebCapabilityInstall {
  method: "web_capability_install";
  process_epoch: string;
  binding_epoch: string;
  delegation: Delegation;
}
export interface WebCapabilityClear {
  method: "web_capability_clear";
  process_epoch: string;
  binding_epoch: string;
}
export interface WebTurnRevoke {
  method: "web_turn_revoke";
  process_epoch: string;
  thread_id: NativeId;
  turn_id: NativeId;
}
export interface WebCallCancel {
  method: "web_call_cancel";
  process_epoch: string;
  operation_id: OperationId;
}
export interface ControlAck {
  state: "applied" | "already_applied" | "unavailable";
  process_epoch: string;
}
export interface ExpertWebPolicy {
  expert_id: string;
  version: string;
  role_sha256: string;
  policy: "inherit" | "disabled";
}
export interface BasicOperation {
  operation_id: OperationId;
  tool: "kimi_web_search";
  arguments: SearchArguments;
}
export interface ProOperation {
  operation_id: OperationId;
  tool: "kimi_web_search_pro";
  arguments: ProArguments;
}
export interface FetchOperation {
  operation_id: OperationId;
  tool: "kimi_web_fetch";
  arguments: FetchArguments;
}
export interface InternalExecute {
  binding_id: BindingId;
  request: OperationRequest;
  parameter_digest: string;
  deadline_unix_ms: number;
}
export interface APIError {
  error: AppError;
  attempt_dispatched: boolean;
}
export interface ExecutionResult {
  operation: OperationStatus;
  result?: ToolOutput;
}
/**
 * Server-owned private stdin only, after managed mTLS admission and claim. EOF cancels. Supplier credential enters the existing owned startup descriptor, never this payload. One process consumes at most one request.
 */
export interface ExecutorWorkerRequest {
  execute: InternalExecute;
  receipt: ClaimReceipt;
}
export interface WebControlRequest {
  schemaVersion: 1;
  requestId: string;
  method: "web_capability_install" | "web_capability_clear" | "web_turn_revoke" | "web_call_cancel";
  payload: WebCapabilityInstall | WebCapabilityClear | WebTurnRevoke | WebCallCancel;
}
export interface WebControlResponse {
  schemaVersion: 1;
  requestId: string;
  data: ControlAck;
}
export interface WebAdmissionRequest {
  process_epoch: string;
  binding_epoch: string;
  operation_id: OperationId;
  thread_id: NativeId;
  turn_id: NativeId;
}
export interface WebAdmissionReceipt {
  operation_id: OperationId;
  root_thread_id: NativeId;
  root_turn_id: NativeId;
  deadline_unix_ms: number;
}
export interface WebWorkerInstall {
  method: "web_worker_install";
  control: WebCapabilityInstall;
  api_origin: string;
  admission_url: string;
  admission_bearer: string;
  profile?: "product" | "local_demo";
}
export interface LocalNativeCredential {
  schema_version: 1;
  run_epoch: string;
  token: string;
}
export interface DeepSearchReceipt {
  version: number;
  operation_id?: string;
  relation: "first" | "joined" | "reused";
  dispatch: "not_dispatched" | "uncertain" | "attempted" | "responded";
  outcome: "pending" | "results" | "empty" | "partial" | "failed" | "unknown";
  availability: "pending" | "available" | "unavailable";
  error_code?:
    | "invalid_arguments"
    | "session_expired"
    | "not_entitled"
    | "quota_exceeded"
    | "busy"
    | "upstream_unavailable"
    | "timeout"
    | "no_content"
    | "response_too_large"
    | "invalid_response"
    | "cancelled"
    | "outcome_unknown"
    | "operation_conflict"
    | "operation_expired"
    | "result_unavailable";
}
export interface WebAdmissionReceiptV2 {
  operation_id: OperationId;
  root_thread_id: NativeId;
  root_turn_id: NativeId;
  deadline_unix_ms: number;
  scope_id: string;
}
export interface DeepSearchRequest {
  scope_id: string;
  deadline_unix_ms: number;
  request: ProOperation;
}
export interface DeepSearchResponse {
  call_id: OperationId;
  receipt: DeepSearchReceipt;
  result?: ToolOutput;
}
export interface WebWorkerFacts {
  transport: "uncertain" | "attempted" | "responded";
  outcome: "results" | "empty" | "partial" | "failed" | "unknown";
  error_code?: AppErrorCode;
}
export interface ClaimFinishV2 {
  finish: ClaimFinish;
  facts: WebWorkerFacts;
}
export interface WebWorkerEnvelopeV2 {
  result: ToolOutput;
  facts: WebWorkerFacts;
}
export interface ScopedFetchRequest {
  scope_id: string;
  deadline_unix_ms: number;
  request: FetchOperation;
}
export interface ScopedFetchResponse {
  call_id: OperationId;
  receipt: DeepSearchReceipt;
  result?: FetchSuccess | AppErrorOutput;
}

export const RETIRED_SERVICE_ID = "kimi-web" as const;
