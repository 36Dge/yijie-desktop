// Generated from market-host source and referenced authorities; DO NOT EDIT.

export type HttpsSchemasYijieAiMarketHostV1Native =
  | NativeObserveRequest
  | NativeObserveResponse
  | NativeApprovalDecideRequest
  | NativeApprovalDecideResponse
  | NativeError;
export type CanonicalId = string;
export type NativeId = string;
export type Revision = number;
/**
 * Original case-sensitive catalog serverName. Syntactic acceptance does not replace exact registry lookup.
 */
export type ServiceId = string;
export type ApprovalState = "pending" | "approved" | "rejected" | "cancelled" | "expired" | "unavailable";
export type UnixMilliseconds = number;
export type SelectionDigest = string;
export type ToolName = string;
export type ArgsDigest = string;
export type Decision = "approve_once" | "reject" | "cancel";
/**
 * Safe Host-specific errors plus the exact referenced provider error set. Provider error codes are not copied or independently widened.
 */
export type ErrorCode =
  | (
      | "invalid_request"
      | "not_ready"
      | "authority_mismatch"
      | "scope_expired"
      | "permission_denied"
      | "grant_not_found"
      | "grant_expired"
      | "capacity_exceeded"
      | "request_conflict"
      | "revision_conflict"
      | "selection_stale"
      | "execution_unavailable"
      | "model_unavailable"
      | "permission_mode_unavailable"
      | "session_not_found"
      | "busy"
      | "operation_uncertain"
      | "approval_not_found"
      | "approval_stale"
      | "approval_expired"
      | "approval_resolved"
      | "cleanup_pending"
      | "temporarily_unavailable"
      | "context_invalid"
    )
  | ReferencedErrorCode;
export type ReferencedErrorCode =
  | "invalid_request"
  | "authority_mismatch"
  | "scope_expired"
  | "binding_mismatch"
  | "not_found"
  | "request_conflict"
  | "capacity_exceeded"
  | "unknown_service"
  | "unsupported_auth"
  | "keyring_unavailable"
  | "metadata_unavailable"
  | "authorization_rejected"
  | "authorization_timeout"
  | "not_qualified"
  | "cleanup_pending"
  | "temporarily_unavailable";

export interface NativeObserveRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: NativeObservePayload;
}
export interface NativeObservePayload {
  sessionId: CanonicalId;
  nativeTurnId?: NativeId;
}
export interface NativeObserveResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: NativeObservation;
  [k: string]: unknown;
}
/**
 * Safe scoped Native observation. Optional availableTurns is the latest 128 known native bindings in descending submission order, each with its original selectionDisplay; turnsTruncated reports older bindings omitted from the index. A known requested nativeTurnId is read with its own display snapshot, never the latest selection. Without a current Host, omit remote facts without starting/probing/reconstructing authority. With a current owned Host, historical tool reads validate scope/agent/thread/turn, not the original Host nonce. Approvals always require the current Host nonce. Current remote read failures stay typed errors. Recheck task.read and local view after awaits. Unmanaged sessions need no Host access. Old producers may omit the new index, and old readers may ignore it. No history read restores execution or approval.
 */
export interface NativeObservation {
  managed: boolean;
  /**
   * @maxItems 58
   */
  selectionDisplay: SelectionDisplay[];
  approvals?: ApprovalSnapshot;
  tools?: ToolSnapshot;
  /**
   * @maxItems 128
   */
  availableTurns?: ObservedTurn[];
  turnsTruncated?: boolean;
  [k: string]: unknown;
}
/**
 * Safe display snapshot only, not a turn grant; old history cannot restore authority.
 */
export interface SelectionDisplay {
  reference: SelectionRef;
  serviceId: ServiceId;
  displayName: string;
  [k: string]: unknown;
}
/**
 * No service label or secret is accepted as authority. Native and Host revalidate exact scope, generation, ready state and connector.use before a versioned turn is admitted.
 */
export interface SelectionRef {
  installationId: CanonicalId;
  revision: Revision;
  generation: Revision;
}
export interface ApprovalSnapshot {
  agentSessionId: CanonicalId;
  /**
   * @maxItems 128
   */
  requests: MarketApproval[];
  [k: string]: unknown;
}
/**
 * Independent market approval projection. identity is obtained by trusted Broker query for the real tools/call; never synthesized from metadata/tool title/last Item. Approval state is not provider execution success.
 */
export interface MarketApproval {
  approvalId: CanonicalId;
  agentSessionId: CanonicalId;
  kind: "mcp_market";
  revision: Revision;
  state: ApprovalState;
  identity: CallIdentity;
  review: ReviewProjection;
  expiresAtUnixMs: number;
  decisionId?: CanonicalId;
  decision?: Decision;
  [k: string]: unknown;
}
/**
 * Created only by the Broker from a real admitted tools/call and frozen parsed argument snapshot. Native MCP request IDs and Tool Item IDs are not this identity. Query/decision do not create records; metadata merely locates an existing record.
 */
export interface CallIdentity {
  binding: CapabilityBinding;
  nativeTurnId: NativeId;
  callRef: CanonicalId;
  serviceId: ServiceId;
  reference: SelectionRef;
  toolName: ToolName;
  argsDigest: ArgsDigest;
  argsEncoding: "worker-json-v1";
  nativeThreadId: NativeId;
}
/**
 * Non-secret immutable association. capabilityRef cannot authenticate any request or create a grant. Bind to one original actual turn operation, context and selection digest for the whole lifetime.
 */
export interface CapabilityBinding {
  context: ContextBinding;
  capabilityRef: CanonicalId;
  turnOperationId: CanonicalId;
  selectionDigest: SelectionDigest;
}
/**
 * Immutable prepare intent: nativeThreadId is required. Null explicitly means a new not-yet-created thread; non-null is an existing actual thread. Never use a fabricated thread identifier or a model bootstrap Turn. bind_turn later freezes the actual thread and Turn together without rewriting this context.
 */
export interface ContextBinding {
  process: ProcessBinding;
  scope: ScopeBinding;
  agentSessionId: CanonicalId;
  nativeThreadId: NativeId | null;
}
/**
 * Set once by the Host-owned process assembly. Never accept these values from Runtime, renderer or MCP metadata as proof of ownership.
 */
export interface ProcessBinding {
  hostInstanceId: CanonicalId;
  runtimeGeneration: CanonicalId;
}
/**
 * Trusted Native authorization projection after Host verification; process epoch/revision are fences, not bearer credentials. Native adapter is not yet exposed to the versioned Host provider. A structurally valid JSON object alone does not authorize a product request.
 */
export interface ScopeBinding {
  ownerUserId: CanonicalId;
  tenantId: CanonicalId;
  nativeProcessEpoch: CanonicalId;
  authorizationRevision: Revision;
  authorizationExpiresAtUnixMs: UnixMilliseconds;
}
/**
 * Exact call review. Legacy reviewed tools use title/summary/risk. generic-mcp-v1 additionally requires complete credential-free argumentsJson and the frozen input schema digest, shown as inert text; unreviewable, oversized or credential-bearing inputs are denied. Undeclared read semantics uses risk=write and explicit high-risk warning. Never infer approval from tool annotations, names or OAuth consent.
 */
export interface ReviewProjection {
  title: string;
  summary: string;
  risk: "read" | "write";
  /**
   * Complete frozen generic-tool arguments encoded as JSON, never truncated or changed. No credentials. Render as inert text; display is not execution authority.
   */
  argumentsJson?: string;
  schemaDigest?: string;
}
export interface ToolSnapshot {
  agentSessionId: CanonicalId;
  nativeTurnId: NativeId;
  /**
   * @maxItems 128
   */
  items: ToolObservation[];
  truncated: boolean;
  [k: string]: unknown;
}
/**
 * Minimal observation from actual native MCP Tool Item facts. Optional service/callRef require explicit trusted correlation; never guess matching Item by latest item, same tool or args. resultText is safe bounded text from actual native output, never raw platform credentials/transport/config. Approval acceptance is not result completion. failed is an unsuccessful native tool observation, not proof that a provider request was sent, not sent or executed. Fixed Gateway error text may distinguish known pre-dispatch rejection from unverified outcome; do not infer this distinction from a generic code or guess callRef linkage.
 */
export interface ToolObservation {
  nativeItemId: NativeId;
  nativeThreadId: NativeId;
  nativeTurnId: NativeId;
  serverName: string;
  toolName: string;
  state: "in_progress" | "completed" | "failed";
  service?: ServiceBinding;
  callRef?: CanonicalId;
  resultText?: string;
  errorCode?: "tool_failed" | "cancelled" | "runtime_unavailable" | "unsupported_result";
  truncated: boolean;
  [k: string]: unknown;
}
/**
 * Native-created non-secret credential reference for the exact installation generation and revision. Keyring alias derives stable owner/tenant/service/installation/generation/credentialRef, excludes Native process epoch and display revision. Native authoritative probe may advance only the same generation revision; never treat a ready flag or OAuth completion as tool qualification.
 */
export interface ServiceBinding {
  reference: SelectionRef;
  serviceId: ServiceId;
  credentialRef: CanonicalId;
}
/**
 * Read-only original turn identity and submitted display snapshot. Never an approval or execution grant.
 */
export interface ObservedTurn {
  nativeTurnId: NativeId;
  /**
   * @maxItems 58
   */
  selectionDisplay: SelectionDisplay[];
  [k: string]: unknown;
}
export interface NativeApprovalDecideRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: NativeApprovalDecidePayload;
}
export interface NativeApprovalDecidePayload {
  sessionId: CanonicalId;
  approvalId: CanonicalId;
  decisionId: CanonicalId;
  expectedRevision: Revision;
  decision: Decision;
}
export interface NativeApprovalDecideResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: MarketApproval;
  [k: string]: unknown;
}
export interface NativeError {
  schemaVersion: 1;
  requestId?: CanonicalId;
  code: ErrorCode;
  retryable: false;
  [k: string]: unknown;
}

export const NATIVE_MARKET_COMMANDS=[{"command":"chat_market_observe_v1","request":"NativeObserveRequest","response":"NativeObserveResponse","requiredPermission":"task.read"},{"command":"chat_market_approval_decide_v1","request":"NativeApprovalDecideRequest","response":"NativeApprovalDecideResponse","requiredPermission":"task.read, task.create, connector.use"}] as const;
