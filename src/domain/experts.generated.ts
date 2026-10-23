// Generated from FEAT-158 experts source and referenced authorities; DO NOT EDIT.

export type HttpsSchemasYijieAiExpertsV1Native =
  | SnapshotRequest
  | SnapshotResponse
  | PrepareRequest
  | PrepareResponse
  | RemoveRequest
  | RemoveResponse
  | ResourceOperationReadRequest
  | ResourceOperationReadResponse
  | BindingReadRequest
  | BindingReadResponse
  | BindingSetRequest
  | BindingSetResponse
  | BindingOperationReadRequest
  | BindingOperationReadResponse
  | NativeSubmitRequest
  | NativeSubmitResponse
  | BindingRecoverRequest
  | BindingRecoverResponse
  | ResourceOperationRecoverRequest
  | ResourceOperationRecoverResponse
  | DeveloperReadRequest
  | DeveloperReadResponse
  | Error;
export type CanonicalId = string;
export type ExpertId = string;
export type Version = string;
export type ResourceState = "available" | "preparing" | "ready" | "unavailable" | "incompatible";
export type ErrorCode =
  | "invalid_request"
  | "context_invalid"
  | "permission_denied"
  | "unsupported_capability"
  | "not_found"
  | "resource_unavailable"
  | "resource_in_use"
  | "version_unavailable"
  | "revision_conflict"
  | "request_conflict"
  | "busy"
  | "approval_pending"
  | "operation_pending"
  | "outcome_unknown"
  | "binding_unavailable"
  | "thread_unavailable"
  | "qualification_required"
  | "model_unavailable"
  | "permission_mode_unavailable"
  | "selection_stale"
  | "capacity_exceeded"
  | "temporarily_unavailable";
export type OperationState = "pending" | "succeeded" | "rejected" | "unknown";
export type Revision = number;
export type BindingState = "none" | "ready" | "applying" | "unknown" | "unavailable";
export type ContentBlock = TextContentBlock | FileInput | ImageInput;
export type ProfileId = "kimi-k3-max-v1" | "minimax-m3-high-v1";
export type ReferencedReferencedRevision = number;
export type ReferencedRevision = number;
/**
 * Unique installationId required even when revisions differ. Native freezes canonical ASCII installationId order; requests may use any order.
 *
 * @maxItems 58
 */
export type Selection = SelectionRef[];
export type SelectionDigest = string;

export interface SnapshotRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: EmptyPayload;
}
export interface EmptyPayload {}
export interface SnapshotResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: CatalogSnapshot;
}
export interface CatalogSnapshot {
  /**
   * @minItems 0
   * @maxItems 64
   */
  experts: CatalogEntry[];
  canManage: boolean;
  executionAvailable: boolean;
}
export interface CatalogEntry {
  display: ExpertDisplay;
  description: string;
  platform: string;
  /**
   * @minItems 0
   * @maxItems 8
   */
  tags: string[];
  /**
   * @minItems 0
   * @maxItems 3
   */
  quickPrompts: string[];
  knowledgeSummary: string;
  state: ResourceState;
  errorCode?: ErrorCode;
  operation?: ResourceOperation;
}
/**
 * Historical safe identity. No raw resource path, digest, role/knowledge text or credential.
 */
export interface ExpertDisplay {
  expertId: ExpertId;
  version: Version;
  displayName: string;
  subtitle: string;
  iconKey: string;
}
/**
 * Closing or abandoning a selection does not undo completed installation. Query the original operation after unknown outcomes. No implicit retry with a new operation.
 */
export interface ResourceOperation {
  operationId: CanonicalId;
  expert: ExpertSelection;
  action: "prepare" | "remove";
  state: OperationState;
  errorCode?: ErrorCode;
}
/**
 * Safe catalog reference only. Native resolves current verified receipt; the renderer cannot choose paths, hashes, role text or trust.
 */
export interface ExpertSelection {
  expertId: ExpertId;
  version: Version;
}
export interface PrepareRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: ResourcePayload;
}
export interface ResourcePayload {
  operationId: CanonicalId;
  expert: ExpertSelection;
}
export interface PrepareResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: ResourceOperation;
}
export interface RemoveRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: ResourcePayload;
}
export interface RemoveResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: ResourceOperation;
}
export interface ResourceOperationReadRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: OperationReadPayload;
}
export interface OperationReadPayload {
  operationId: CanonicalId;
}
export interface ResourceOperationReadResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: ResourceOperation;
}
export interface BindingReadRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: BindingReadPayload;
}
export interface BindingReadPayload {
  sessionId: CanonicalId;
}
export interface BindingReadResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: BindingView;
}
export interface BindingView {
  sessionId: CanonicalId;
  bindingRevision: Revision;
  expert: ExpertDisplay | null;
  state: BindingState;
  operationId?: CanonicalId;
  errorCode?: ErrorCode;
  /**
   * True once this conversation enters the expert submission family, including explicit ordinary snapshots or a rejected initial binding attempt. Native owns this routing marker; none/revision0 cannot imply a legacy conversation.
   */
  managed: boolean;
}
export interface BindingSetRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: BindingSetPayload;
}
/**
 * Existing local conversation only. Native owns scope and maps Host/thread IDs. Null explicitly selects ordinary mode. Active/pending approval/unknown outbox rejects before changing any binding. Draft with no native rollout saves intent only and never invokes SwitchThread.
 */
export interface BindingSetPayload {
  operationId: CanonicalId;
  sessionId: CanonicalId;
  expectedBindingRevision: Revision;
  expert: ExpertSelection | null;
}
export interface BindingSetResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: BindingResult;
}
export interface BindingResult {
  binding: BindingView;
  operation: BindingOperation;
}
/**
 * Same scope/operation/full intent replays original receipt. Succeeded means the binding application protocol completed under qualified native lifecycle, not a model quality assertion. Unknown blocks sends and further changes. bindingRevision is the effective confirmed revision: succeeded expected+1; pending/unknown/rejected expected. requestedExpert preserves the original request and is not the effective current binding.
 */
export interface BindingOperation {
  operationId: CanonicalId;
  sessionId: CanonicalId;
  state: OperationState;
  expectedBindingRevision: Revision;
  bindingRevision: Revision;
  requestedExpert: ExpertDisplay | null;
  errorCode?: ErrorCode;
}
export interface BindingOperationReadRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: BindingOperationReadPayload;
}
export interface BindingOperationReadPayload {
  sessionId: CanonicalId;
  operationId: CanonicalId;
}
export interface BindingOperationReadResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: BindingResult;
}
export interface NativeSubmitRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: NativeSubmitPayload;
}
/**
 * Versioned wrapper: never attach expert fields to the old closed submit. New chat explicit expert/null with revision zero. Existing chat must exactly match the current binding. Native resolves private hashes and freezes with messages/outbox. Full wrapper participates in idempotency.
 */
export interface NativeSubmitPayload {
  submission: MarketSubmitPayload;
  expectedBindingRevision: Revision;
  expert: ExpertSelection | null;
}
/**
 * Ordinary chat only. New chat omits sessionId and uses nullable projectId; an existing session requires projectId=null. Input attachment references use existing Native scoped attachment validation, never arbitrary paths. At most 10 attachment blocks and nonblank text require Native conformance. operationId is renderer submission identity, not necessarily the first actual turn operation. Nonempty selections must be rejected before any durable outbox or Runtime work when execution qualification is unavailable; no implicit fallback to empty. Before a versioned Host provider is qualified, all selections including empty must return execution_unavailable before persistence; do not dispatch via a legacy fallback. Idempotency compares full original content, target, model intent and connector references, not only selectionDigest.
 */
export interface MarketSubmitPayload {
  operationId: CanonicalId;
  projectId: CanonicalId | null;
  sessionId?: CanonicalId;
  /**
   * @minItems 1
   * @maxItems 16
   */
  contentBlocks: ContentBlock[];
  intent: ModelIntent;
  selection: Selection;
}
export interface TextContentBlock {
  type: "text";
  text: string;
}
export interface FileInput {
  type: "file";
  attachmentId: CanonicalId;
}
export interface ImageInput {
  type: "image";
  attachmentId: CanonicalId;
}
export interface ModelIntent {
  profileId: ProfileId;
  expectedRevision: ReferencedReferencedRevision;
}
/**
 * No service label or secret is accepted as authority. Native and Host revalidate exact scope, generation, ready state and connector.use before a versioned turn is admitted.
 */
export interface SelectionRef {
  installationId: CanonicalId;
  revision: ReferencedRevision;
  generation: ReferencedRevision;
}
export interface NativeSubmitResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: NativeSubmissionResult;
}
export interface NativeSubmissionResult {
  receipt: NativeReceipt;
  expert: ExpertDisplay | null;
  bindingRevision: Revision;
}
/**
 * Durable Native receipt only, not proof of Runtime acceptance. Coordinator wake-up failure after commit must not change this accepted result; original receipt remains queryable/replayable.
 */
export interface NativeReceipt {
  outcome: "local_durable_accepted";
  sessionId: CanonicalId;
  localTurnId: CanonicalId;
  submissionOperationId: CanonicalId;
  turnOperationId: CanonicalId;
  selectionDigest: SelectionDigest;
  [k: string]: unknown;
}
export interface BindingRecoverRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: BindingOperationReadPayload;
}
export interface BindingRecoverResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: BindingResult;
}
export interface ResourceOperationRecoverRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: OperationReadPayload;
}
export interface ResourceOperationRecoverResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: ResourceOperation;
}
export interface DeveloperReadRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: ExpertSelection;
}
export interface DeveloperReadResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: DeveloperInfo;
}
/**
 * Read-only developer metadata for an exact catalog identity. No usage metrics, external URL, installation, binding, or persistence side effects.
 */
export interface DeveloperInfo {
  expert: ExpertSelection;
  /**
   * Developer display name. Defaults to 易界 AI for the current native catalog; not a verification badge or third-party source attribution.
   */
  name: string;
}
/**
 * Only temporarily_unavailable may be retryable, after reading original operation. Outcome unknown never grants automatic retry or replacement identity.
 */
export interface Error {
  schemaVersion: 1;
  requestId?: CanonicalId;
  code: ErrorCode;
  retryable: boolean;
}

export const EXPERT_COMMANDS=[{"command":"experts_snapshot_v1","request":"SnapshotRequest","response":"SnapshotResponse","requiredPermission":"plugin.read"},{"command":"experts_prepare_v1","request":"PrepareRequest","response":"PrepareResponse","requiredPermission":"plugin.manage"},{"command":"experts_remove_v1","request":"RemoveRequest","response":"RemoveResponse","requiredPermission":"plugin.manage"},{"command":"experts_operation_read_v1","request":"ResourceOperationReadRequest","response":"ResourceOperationReadResponse","requiredPermission":"plugin.read"},{"command":"chat_expert_binding_read_v1","request":"BindingReadRequest","response":"BindingReadResponse","requiredPermission":"task.read"},{"command":"chat_expert_binding_set_v1","request":"BindingSetRequest","response":"BindingSetResponse","requiredPermission":"task.read and task.create; plugin.read for nonnull expert"},{"command":"chat_expert_binding_operation_read_v1","request":"BindingOperationReadRequest","response":"BindingOperationReadResponse","requiredPermission":"task.read"},{"command":"chat_expert_submit_v1","request":"NativeSubmitRequest","response":"NativeSubmitResponse","requiredPermission":"existing chat permissions and connector.use for nonempty market selection; plugin.read for nonnull expert"},{"command":"chat_expert_binding_recover_v1","request":"BindingRecoverRequest","response":"BindingRecoverResponse","requiredPermission":"task.read and task.create; plugin.read for nonnull original expert"},{"command":"experts_operation_recover_v1","request":"ResourceOperationRecoverRequest","response":"ResourceOperationRecoverResponse","requiredPermission":"plugin.manage"},{"command":"experts_developer_read_v1","request":"DeveloperReadRequest","response":"DeveloperReadResponse","requiredPermission":"plugin.read"}] as const;
