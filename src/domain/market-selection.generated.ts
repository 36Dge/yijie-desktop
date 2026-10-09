// Generated from market-selection source; DO NOT EDIT.

export type HttpsSchemasYijieAiChatMarketSelectionV1 =
  | CanonicalId
  | SelectionRef
  | ProfileId
  | ModelRevision
  | SelectionDigest
  | Selection
  | ModelIntent
  | TextInput
  | FileInput
  | ImageInput
  | ContentBlock
  | SubmitPayload
  | SelectionSnapshot
  | SubmissionReceipt
  | SubmitRequest
  | SubmitResponse
  | ErrorCode
  | Error;
export type CanonicalId = string;
export type Revision = number;
export type ProfileId = "kimi-k3-max-v1" | "minimax-m3-high-v1";
export type ModelRevision = number;
export type SelectionDigest = string;
/**
 * Unique installationId required even when revisions differ. Native freezes canonical ASCII installationId order; requests may use any order.
 *
 * @maxItems 58
 */
export type Selection = SelectionRef[];
export type ContentBlock = TextInput | FileInput | ImageInput;
export type ErrorCode =
  | "invalid_request"
  | "context_invalid"
  | "permission_denied"
  | "not_found"
  | "request_conflict"
  | "selection_stale"
  | "execution_unavailable"
  | "temporarily_unavailable";

/**
 * No service label or secret is accepted as authority. Native and Host revalidate exact scope, generation, ready state and connector.use before a versioned turn is admitted.
 */
export interface SelectionRef {
  installationId: CanonicalId;
  revision: Revision;
  generation: Revision;
}
export interface ModelIntent {
  profileId: ProfileId;
  expectedRevision: ModelRevision;
}
export interface TextInput {
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
/**
 * Ordinary chat only. New chat omits sessionId and uses nullable projectId; an existing session requires projectId=null. Input attachment references use existing Native scoped attachment validation, never arbitrary paths. At most 10 attachment blocks and nonblank text require Native conformance. operationId is renderer submission identity, not necessarily the first actual turn operation. Nonempty selections must be rejected before any durable outbox or Runtime work when execution qualification is unavailable; no implicit fallback to empty. Before a versioned Host provider is qualified, all selections including empty must return execution_unavailable before persistence; do not dispatch via a legacy fallback. Idempotency compares full original content, target, model intent and connector references, not only selectionDigest.
 */
export interface SubmitPayload {
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
/**
 * Native-only durable immutable snapshot. Freeze inside the same transaction as the outbox using its actual turnOperationId. selection must be sorted by installationId ASCII, contain unique installation identities and match selectionDigest. Receipt replay reads this original snapshot, never current UI/catalog. No credentials or execution capability.
 */
export interface SelectionSnapshot {
  schemaVersion: 1;
  turnOperationId: CanonicalId;
  selection: Selection;
  selectionDigest: SelectionDigest;
}
/**
 * Durable Native receipt only, not proof of Runtime acceptance. Coordinator wake-up failure after commit must not change this accepted result; original receipt remains queryable/replayable.
 */
export interface SubmissionReceipt {
  outcome: "local_durable_accepted";
  sessionId: CanonicalId;
  localTurnId: CanonicalId;
  submissionOperationId: CanonicalId;
  turnOperationId: CanonicalId;
  selectionDigest: SelectionDigest;
  [k: string]: unknown;
}
export interface SubmitRequest {
  schemaVersion: 1;
  requestId: CanonicalId;
  contextId: CanonicalId;
  payload: SubmitPayload;
}
export interface SubmitResponse {
  schemaVersion: 1;
  requestId: CanonicalId;
  data: SubmissionReceipt;
  [k: string]: unknown;
}
/**
 * requestId is echoed only when a real canonical non-nil request UUID can be decoded; malformed input errors omit it, never fabricate identity. Optional fields reject explicit null.
 */
export interface Error {
  schemaVersion: 1;
  requestId?: CanonicalId;
  code: ErrorCode;
  retryable: boolean;
  [k: string]: unknown;
}
