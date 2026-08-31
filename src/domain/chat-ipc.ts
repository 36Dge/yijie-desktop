import { parseStrictRfc3339EpochNanoseconds } from "./rfc3339";

export const CHAT_IPC_SCHEMA_VERSION = 1 as const;
export const CHAT_IPC_V2_SCHEMA_VERSION = 2 as const;
export const CHAT_IPC_V3_SCHEMA_VERSION = 3 as const;
export const CHAT_IPC_V4_SCHEMA_VERSION = 4 as const;
export const CHAT_IPC_V5_SCHEMA_VERSION = 5 as const;
export const CHAT_IPC_V6_SCHEMA_VERSION = 6 as const;
export const CHAT_EVENT_CHANNEL = "yijie:chat:event:v1" as const;
export const CHAT_CONTROL_PLANE_EVENT_CHANNEL = "yijie:chat:control-plane:event:v1" as const;
export const CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL = "yijie:chat:attachment-import:event:v2" as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
const SEQUENCE_PATTERN = /^(0|[1-9][0-9]*)$/;
const SAFE_CODE_PATTERN = /^[a-z0-9_]{1,128}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const RFC3339_MIN_LENGTH = 20;
const RFC3339_MAX_LENGTH = 64;
const MAX_SAFE_EVENT_SEQUENCE = (1n << 64n) - 1n;
const SAFE_CWD_SEGMENT_PATTERN = /^(?!\.{1,2}$)(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$)(?!.*[ .]$)[^/\\:]+$/i;

export const CHAT_COMMAND_NAMES = Object.freeze([
  "chat_bind_context_v1",
  "chat_list_projects_v1",
  "chat_pick_project_v1",
  "chat_revalidate_project_v1",
  "chat_set_project_pinned_v1",
  "chat_remove_project_v1",
  "chat_create_session_v1",
  "chat_submit_turn_v1",
  "chat_list_sessions_v1",
  "chat_load_history_v1",
  "chat_load_reasoning_v1",
  "chat_rename_session_v1",
  "chat_set_session_pinned_v1",
  "chat_interrupt_turn_v1",
  "chat_delete_session_v1",
  "chat_get_cleanup_status_v1",
  "chat_get_session_control_plane_v1",
  "chat_get_local_readiness_v1",
  "chat_request_local_recovery_v1",
  "chat_subscribe_session_v1",
  "chat_resync_session_v1",
  "chat_cancel_request_v1",
  "chat_unsubscribe_session_v1",
] as const);

export type ChatCommandName = (typeof CHAT_COMMAND_NAMES)[number];

export const CHAT_V2_COMMAND_NAMES = Object.freeze([
  "chat_pick_attachments_v2",
  "chat_import_attachments_v2",
  "chat_list_draft_attachments_v2",
  "chat_remove_attachment_v2",
  "chat_create_session_v2",
  "chat_submit_turn_v2",
  "chat_load_history_v2",
  "chat_resync_session_v2",
] as const);

export type ChatV2CommandName = (typeof CHAT_V2_COMMAND_NAMES)[number];

export const CHAT_V3_COMMAND_NAMES = Object.freeze(["chat_load_history_v3"] as const);

export type ChatV3CommandName = (typeof CHAT_V3_COMMAND_NAMES)[number];

export const CHAT_ERROR_CODES = Object.freeze([
  "chat_unauthenticated",
  "chat_context_invalid",
  "chat_capability_denied",
  "chat_resource_not_found",
  "chat_project_invalid",
  "chat_cursor_invalid",
  "chat_request_invalid",
  "chat_request_cancelled",
  "chat_conflict",
  "chat_turn_active",
  "chat_host_not_ready",
  "chat_storage_unavailable",
  "chat_protocol_error",
  "chat_limit_exceeded",
  "chat_cleanup_incomplete",
  "chat_temporarily_unavailable",
] as const);

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

export const CHAT_RECOVERIES = Object.freeze([
  "none",
  "sign_in",
  "rebind_context",
  "request_permission",
  "fix_request",
  "reload",
  "resync",
  "retry",
  "start_host",
  "wait_cleanup",
  "reduce_input",
  "reselect_project",
] as const);

export type ChatRecovery = (typeof CHAT_RECOVERIES)[number];

export const CHAT_ATTACHMENT_ISSUES = Object.freeze([
  "too_many",
  "too_large",
  "archive_unsupported",
  "unsupported",
  "invalid_content",
  "parse_failed",
] as const);

export type ChatAttachmentIssue = (typeof CHAT_ATTACHMENT_ISSUES)[number];

export const CHAT_ALLOWED_ACTIONS = Object.freeze([
  "read_sessions",
  "create_session",
  "submit_turn",
  "rename_session",
  "pin_session",
  "interrupt_turn",
  "delete_session",
  "read_projects",
  "use_project",
  "pin_project",
  "remove_project",
  "read_cleanup",
] as const);

export type ChatAllowedAction = (typeof CHAT_ALLOWED_ACTIONS)[number];

export interface ChatIpcErrorShape {
  readonly schemaVersion: 1 | 2 | 3 | 4 | 5 | 6;
  readonly requestId?: string;
  readonly code: ChatErrorCode;
  readonly retryable: boolean;
  readonly recovery: ChatRecovery;
  readonly attachmentIssue?: ChatAttachmentIssue;
  readonly attachmentItemCount?: number;
  readonly approvalIssue?: ChatApprovalErrorCodeV6;
  readonly retryAfterMs?: number;
}

export class ChatContractError extends Error {
  constructor() {
    super("chat-contract-invalid");
    this.name = "ChatContractError";
  }
}

export class ChatClientError extends Error {
  constructor(readonly shape: ChatIpcErrorShape) {
    super(shape.code);
    this.name = "ChatClientError";
  }
}

export interface BoundChatContext {
  readonly contextId: string;
  readonly expiresAtEpochSeconds: number;
  readonly allowedActions: readonly ChatAllowedAction[];
}

export interface ChatProject {
  readonly projectId: string;
  readonly safeName: string;
  readonly pinnedAt: number | null;
  readonly lastUsedAt: number;
  readonly available: boolean;
}

export interface ChatSession {
  readonly sessionId: string;
  readonly projectId: string;
  readonly title: string;
  readonly titleSource: "fallback" | "model" | "user";
  readonly pinnedAt: number | null;
  readonly lastActivityAt: number;
  readonly latestTurnStatus: string | null;
  readonly projectAvailable: boolean;
}

export interface ChatSessionPage {
  readonly sessions: readonly ChatSession[];
  readonly nextCursor: string | null;
}

export const CHAT_ATTACHMENT_STATUSES = Object.freeze([
  "queued",
  "importing",
  "parsing",
  "indexing",
  "ready",
  "bound",
  "error_terminal",
  "expired",
] as const);

export type ChatAttachmentStatus = (typeof CHAT_ATTACHMENT_STATUSES)[number];

export type ChatDraftTarget =
  | Readonly<{ type: "new" }>
  | Readonly<{ type: "session"; sessionId: string }>;

export const CHAT_NEW_DRAFT_TARGET: ChatDraftTarget = Object.freeze({ type: "new" });

export function chatSessionDraftTarget(sessionId: string): ChatDraftTarget {
  return Object.freeze({ type: "session", sessionId: uuid(sessionId) });
}

const CHAT_IMAGE_MEDIA_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const);

const CHAT_FILE_MEDIA_TYPES = Object.freeze([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/yaml",
  "application/xml",
  "text/html",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const);

export interface ChatAttachment {
  readonly attachmentId: string;
  readonly type: "file" | "image";
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly status: ChatAttachmentStatus;
  readonly expiresAt: number;
}

export const CHAT_ATTACHMENT_IMPORT_STAGES = Object.freeze([
  "queued",
  "importing",
  "parsing",
  "indexing",
  "ready",
  "error_terminal",
] as const);

export type ChatAttachmentImportStage = (typeof CHAT_ATTACHMENT_IMPORT_STAGES)[number];

export const CHAT_ATTACHMENT_IMPORT_EVENT_ISSUES = Object.freeze([
  ...CHAT_ATTACHMENT_ISSUES,
  "unavailable",
] as const);

export type ChatAttachmentImportEventIssue = (typeof CHAT_ATTACHMENT_IMPORT_EVENT_ISSUES)[number];

export interface ChatAttachmentImportEvent {
  readonly schemaVersion: 2;
  readonly contextId: string;
  readonly operationId: string;
  readonly sequence: string;
  readonly stage: ChatAttachmentImportStage;
  readonly itemCount: number;
  readonly issue: ChatAttachmentImportEventIssue | null;
}

export interface ChatTextContentBlock {
  readonly type: "text";
  readonly text: string;
}

export type ChatMessageContentBlock = ChatTextContentBlock | ChatAttachment;

export type ChatTurnContentBlock =
  | ChatTextContentBlock
  | Readonly<{ type: "file" | "image"; attachmentId: string }>;

export interface ChatMessage {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly contentBlocks?: readonly ChatMessageContentBlock[];
  readonly status: string;
  readonly ordinal: number;
  readonly createdAt: number;
}

export interface ChatReasoningMetadata {
  readonly itemOrdinal: number;
  readonly status: ChatReasoningStatus;
  readonly reasonCode: string | null;
  readonly totalBytes: number;
  readonly partCount: number;
  readonly finalizedAtMs: number;
}

export type ChatReasoningStatus = "complete" | "incomplete" | "unavailable";

export interface ChatHistoryTurn {
  readonly turnId: string;
  readonly status: string;
  readonly terminalAt: number | null;
  readonly reasoningStatus: string;
  readonly reasoningReasonCode: string | null;
  readonly messages: readonly ChatMessage[];
  readonly reasoning: readonly ChatReasoningMetadata[];
  readonly artifacts?: readonly ChatArtifact[];
}

export const CHAT_ARTIFACT_KINDS = Object.freeze(["image", "video", "file", "report"] as const);
export const CHAT_ARTIFACT_PROVENANCES = Object.freeze(["synthetic", "provider", "tool"] as const);
export const CHAT_ARTIFACT_STATUSES = Object.freeze([
  "announced", "generating", "processing", "transferring",
  "ready", "failed", "cancelled", "expired",
] as const);

export interface ChatArtifact {
  readonly artifactId: string;
  readonly kind: (typeof CHAT_ARTIFACT_KINDS)[number];
  readonly provenance: (typeof CHAT_ARTIFACT_PROVENANCES)[number];
  readonly status: (typeof CHAT_ARTIFACT_STATUSES)[number];
  readonly ordinal: number;
  readonly progressStage: "generating" | "processing" | "finalizing" | null;
  readonly progressPercent: number | null;
  readonly displayName: string | null;
  readonly mediaType: string | null;
  readonly sizeBytes: number | null;
  readonly localCommittedAt: number | null;
  readonly expiresAt: number | null;
  readonly hasPoster: boolean;
  readonly errorCode: string | null;
  readonly retryable: boolean | null;
}

export interface ChatHistoryPage {
  readonly turns: readonly ChatHistoryTurn[];
  readonly nextCursor: string | null;
}

export const CHAT_AGENT_MESSAGE_PHASES_V4 = Object.freeze([
  "commentary",
  "final_answer",
] as const);

export type ChatAgentMessagePhaseV4 =
  | (typeof CHAT_AGENT_MESSAGE_PHASES_V4)[number]
  | null;

export const CHAT_PLAN_STEP_STATUSES_V4 = Object.freeze([
  "pending",
  "in_progress",
  "completed",
] as const);

export interface ChatPlanStepV4 {
  readonly ordinal: number;
  readonly step: string;
  readonly status: (typeof CHAT_PLAN_STEP_STATUSES_V4)[number];
}

interface ChatSourceFactV4 {
  readonly sourceEventId: string;
  readonly sourceSequence: string;
  readonly sourceOccurredAt: string;
}

export interface ChatPlanSnapshotV4 extends ChatSourceFactV4 {
  readonly explanation: string | null;
  readonly steps: readonly ChatPlanStepV4[];
}

export const CHAT_REASONING_STATUSES_V4 = Object.freeze([
  "complete",
  "incomplete",
  "unavailable",
] as const);

export const CHAT_REASONING_REASON_CODES_V4 = Object.freeze([
  "reasoning_not_emitted",
  "turn_interrupted",
  "stream_gap",
  "runtime_error",
  "limit_exceeded",
  "protocol_error",
  "host_shutdown",
] as const);

export type ChatReasoningReasonCodeV4 =
  (typeof CHAT_REASONING_REASON_CODES_V4)[number];

export interface ChatReasoningPartV4 {
  readonly contentIndex: number;
  readonly text: string;
}

export const CHAT_TIMELINE_ITEM_STATUSES_V4 = Object.freeze([
  "in_progress",
  "completed",
  "incomplete",
] as const);

export interface ChatTimelineItemV4 extends ChatSourceFactV4 {
  readonly itemId: string;
  readonly itemOrdinal: number;
  readonly itemType: string;
  readonly phase: ChatAgentMessagePhaseV4;
  readonly status: (typeof CHAT_TIMELINE_ITEM_STATUSES_V4)[number];
  readonly text: string;
  readonly reasoningStatus: (typeof CHAT_REASONING_STATUSES_V4)[number] | null;
  readonly reasoningReasonCode: ChatReasoningReasonCodeV4 | null;
  readonly reasoningParts: readonly ChatReasoningPartV4[];
  readonly startedAtMs: number;
  readonly completedAtMs: number | null;
}

export interface ChatTimelineNoticeV4 extends ChatSourceFactV4 {
  readonly scope: "session" | "turn";
  readonly severity: "warning" | "error";
  readonly code: string | null;
  readonly willRetry: boolean;
  readonly observedAtMs: number;
}

export interface ChatHistoryTurnV4 extends ChatHistoryTurn {
  readonly projectionAuthority: "legacy" | "v4";
  readonly artifacts: readonly ChatArtifact[];
  readonly terminalCode: string | null;
  readonly timelineItems: readonly ChatTimelineItemV4[];
  readonly plan: ChatPlanSnapshotV4 | null;
  readonly notices: readonly ChatTimelineNoticeV4[];
}

export interface ChatHistoryPageV4 {
  readonly turns: readonly ChatHistoryTurnV4[];
  readonly nextCursor: string | null;
  readonly sessionNotices: readonly ChatTimelineNoticeV4[];
  readonly durableSequenceCut: string;
}

export const CHAT_TRUNCATION_REASONS_V5 = Object.freeze([
  "utf8_byte_limit",
  "upstream_truncated",
] as const);

export type ChatTruncationReasonV5 =
  (typeof CHAT_TRUNCATION_REASONS_V5)[number];

export interface ChatSafeTextV5 {
  readonly text: string;
  readonly truncated: boolean;
  readonly truncationReason: ChatTruncationReasonV5 | null;
}

export interface ChatSourceFactV5 {
  readonly sourceEventId: string;
  readonly sourceSequence: string;
  readonly sourceOccurredAt: string;
}

export type ChatCommandCwdV5 = Readonly<{
  kind: "workspace_root" | "workspace_relative" | "redacted";
  segments: readonly string[];
}>;

export const CHAT_COMMAND_ERROR_CODES_V5 = Object.freeze([
  "command_failed",
  "command_declined",
  "projection_limit_exceeded",
  "projection_redaction_failed",
  "protocol_error",
] as const);

export const CHAT_TOOL_ERROR_CODES_V5 = Object.freeze([
  "tool_failed",
  "tool_declined",
  "unknown_tool",
  "projection_limit_exceeded",
  "projection_redaction_failed",
  "protocol_error",
] as const);

export interface ChatExecutionErrorV5 {
  readonly code:
    | (typeof CHAT_COMMAND_ERROR_CODES_V5)[number]
    | (typeof CHAT_TOOL_ERROR_CODES_V5)[number];
  readonly summary: string;
}

export interface ChatCommandOutputV5 {
  readonly retention: "complete" | "head_tail" | "unavailable";
  readonly text: string | null;
  readonly head: string | null;
  readonly tail: string | null;
  readonly reason: "not_available" | null;
  readonly truncated: boolean;
  readonly truncationReason: ChatTruncationReasonV5 | null;
}

export interface ChatToolIdentityV5 {
  readonly resolution: "known" | "unknown";
  readonly serverName: string;
  readonly toolName: string;
}

export interface ChatCommandExecutionV5 {
  readonly kind: "command";
  readonly status: "running" | "completed" | "failed" | "declined" | "incomplete";
  readonly startedSource: ChatSourceFactV5;
  readonly lastSource: ChatSourceFactV5;
  readonly commandSummary: ChatSafeTextV5;
  readonly cwd: ChatCommandCwdV5;
  readonly liveOutput: ChatSafeTextV5 | null;
  readonly output: ChatCommandOutputV5 | null;
  readonly durationMs: number | null;
  readonly exitCode: number | null;
  readonly error: ChatExecutionErrorV5 | null;
}

export interface ChatToolProgressV5 extends ChatSourceFactV5 {
  readonly progressIndex: number;
  readonly summary: ChatSafeTextV5;
}

export interface ChatToolExecutionV5 {
  readonly kind: "tool";
  readonly status: "in_progress" | "completed" | "failed" | "declined" | "incomplete";
  readonly startedSource: ChatSourceFactV5;
  readonly lastSource: ChatSourceFactV5;
  readonly identity: ChatToolIdentityV5;
  readonly argumentsSummary: ChatSafeTextV5;
  readonly progress: readonly ChatToolProgressV5[];
  readonly durationMs: number | null;
  readonly resultSummary: ChatSafeTextV5 | null;
  readonly error: ChatExecutionErrorV5 | null;
}

export type ChatExecutionV5 = ChatCommandExecutionV5 | ChatToolExecutionV5;

export interface ChatTimelineItemV5 extends ChatSourceFactV5 {
  readonly itemId: string;
  readonly itemOrdinal: number;
  readonly itemType:
    | "agentMessage"
    | "reasoning"
    | "command"
    | "tool"
    | "userMessage"
    | "hookPrompt"
    | "collabAgentToolCall"
    | "subAgentActivity"
    | "webSearch"
    | "imageView"
    | "sleep"
    | "imageGeneration"
    | "enteredReviewMode"
    | "exitedReviewMode"
    | "contextCompaction";
  readonly phase: ChatAgentMessagePhaseV4;
  readonly status: (typeof CHAT_TIMELINE_ITEM_STATUSES_V4)[number];
  readonly text: string;
  readonly reasoningStatus: (typeof CHAT_REASONING_STATUSES_V4)[number] | null;
  readonly reasoningReasonCode: ChatReasoningReasonCodeV4 | null;
  readonly reasoningParts: readonly ChatReasoningPartV4[];
  readonly startedAtMs: number;
  readonly completedAtMs: number | null;
  readonly execution: ChatExecutionV5 | null;
}

export interface ChatHistoryTurnV5 extends Omit<
  ChatHistoryTurnV4,
  "projectionAuthority" | "timelineItems"
> {
  readonly projectionAuthority: "v5";
  readonly timelineItems: readonly ChatTimelineItemV5[];
}

export interface ChatHistoryPageV5 {
  /** Decoder-added authority marker; it is not accepted as a nested wire field. */
  readonly schemaVersion: typeof CHAT_IPC_V5_SCHEMA_VERSION;
  readonly turns: readonly (ChatHistoryTurnV4 | ChatHistoryTurnV5)[];
  readonly nextCursor: string | null;
  readonly sessionNotices: readonly ChatTimelineNoticeV4[];
  readonly durableSequenceCut: string;
}

export interface ChatReasoningPart {
  readonly contentIndex: number;
  readonly text: string;
}

export interface ChatReasoningItem {
  readonly itemOrdinal: number;
  readonly status: ChatReasoningStatus;
  readonly reasonCode: string | null;
  readonly finalizedAtMs: number;
  readonly parts: readonly ChatReasoningPart[];
}

export type ChatCleanupSurfaceState = "pending" | "complete" | "incomplete" | "not_attempted";

export interface ChatCleanupStatus {
  readonly operationId: string;
  readonly desktopState: ChatCleanupSurfaceState;
  readonly hostState: ChatCleanupSurfaceState;
  readonly runtimeState: ChatCleanupSurfaceState;
  readonly outcomeCode: string;
  readonly lastErrorCode: string | null;
  readonly requestedAt: number;
  readonly completedAt: number | null;
  readonly expiresAt: number | null;
}

export interface ChatCreatedTurn {
  readonly sessionId: string;
  readonly turnId: string;
  readonly operationId: string;
}

export const CHAT_CONTROL_PLANE_STATES = Object.freeze([
  "pending",
  "bound",
  "blocked_auth",
  "retry_wait",
  "denied",
  "failed",
] as const);

export const CHAT_CONTROL_PLANE_ISSUES = Object.freeze([
  "chat_unauthenticated",
  "chat_capability_denied",
  "chat_temporarily_unavailable",
  "chat_conflict",
  "chat_protocol_error",
] as const);

export const CHAT_CONTROL_PLANE_RECOVERIES = Object.freeze([
  "none",
  "sign_in",
  "retry",
  "resync",
] as const);

export interface ChatSessionControlPlane {
  readonly sessionId: string;
  readonly state: (typeof CHAT_CONTROL_PLANE_STATES)[number];
  readonly issueCode: (typeof CHAT_CONTROL_PLANE_ISSUES)[number] | null;
  readonly retryable: boolean;
  readonly recovery: (typeof CHAT_CONTROL_PLANE_RECOVERIES)[number];
}

export interface ChatControlPlaneEvent extends ChatSessionControlPlane {
  readonly schemaVersion: 1;
  readonly sequence: string;
}

export const CHAT_READINESS_ISSUE_CODES = Object.freeze([
  "chat_host_starting",
  "chat_host_unavailable",
  "chat_runtime_starting",
  "chat_runtime_unavailable",
  "chat_runtime_version_mismatch",
  "chat_storage_read_only",
  "chat_storage_full",
  "chat_storage_corrupt",
  "chat_storage_migration_failed",
  "chat_storage_unavailable",
] as const);

export const CHAT_READINESS_RECOVERIES = Object.freeze([
  "none",
  "retry",
  "start_or_retry",
  "free_space",
  "repair_or_restore",
  "restart_app",
  "rebind_context",
] as const);

export interface ChatLocalReadiness {
  readonly lifecycle: "starting" | "ready" | "blocked" | "recovering";
  readonly host: "starting" | "ready" | "unavailable";
  readonly runtime: "starting" | "ready" | "unavailable" | "version_mismatch";
  readonly storage: "ready" | "read_only" | "full" | "corrupt" | "migration_failed" | "unavailable";
  readonly canSend: boolean;
  readonly issueCode: (typeof CHAT_READINESS_ISSUE_CODES)[number] | null;
  readonly retryable: boolean;
  readonly recovery: (typeof CHAT_READINESS_RECOVERIES)[number];
  readonly retryAfterMs?: number;
}

export interface ChatResyncProjection {
  readonly session: ChatSession;
  readonly history: ChatHistoryPage;
  readonly cleanup: ChatCleanupStatus | null;
}

export interface ChatResyncProjectionV4 {
  readonly session: ChatSession;
  readonly history: ChatHistoryPageV4;
  readonly cleanup: ChatCleanupStatus | null;
}

export interface ChatResyncProjectionV5 {
  readonly session: ChatSession;
  readonly history: ChatHistoryPageV5;
  readonly cleanup: ChatCleanupStatus | null;
}

export type ChatEventKind =
  | "assistant_append"
  | "reasoning_append"
  | "turn_state"
  | "turn_terminal"
  | "cleanup_state"
  | "resync_required"
  | "context_invalidated";

interface ChatEventBase {
  readonly schemaVersion: 1;
  readonly subscriptionId: string;
  readonly contextId: string;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly projectionSequence: string;
  readonly eventId: string;
}

export type ChatProjectionEvent = ChatEventBase &
  (
    | { readonly kind: "assistant_append"; readonly payload: { readonly text: string } }
    | {
        readonly kind: "reasoning_append";
        readonly payload: {
          readonly itemOrdinal: number;
          readonly contentIndex: number;
          readonly text: string;
        };
      }
    | {
        readonly kind: "turn_state" | "turn_terminal";
        readonly payload: { readonly status: string };
      }
    | {
        readonly kind: "cleanup_state";
        readonly payload: Readonly<Record<string, string | number | null>>;
      }
    | {
        readonly kind: "resync_required" | "context_invalidated";
        readonly payload: { readonly reason: string };
      }
  );

export type ChatEventKindV4 =
  | "turn_started"
  | "plan_updated"
  | "item_started"
  | "item_completed"
  | "agent_message_append"
  | "reasoning_append"
  | "reasoning_finalized"
  | "notice"
  | "turn_terminal"
  | "resync_required"
  | "context_invalidated";

interface ChatEventBaseV4 {
  readonly schemaVersion: 4;
  readonly subscriptionId: string;
  readonly contextId: string;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly projectionSequence: string;
  readonly eventId: string;
}

interface ChatSemanticEventBaseV4 extends ChatEventBaseV4 {
  readonly durableSequence: string;
}

type ChatItemLifecyclePayloadV4 = ChatSourceFactV4 & Readonly<{
  itemId: string;
  itemOrdinal: number;
  itemType: string;
  phase: ChatAgentMessagePhaseV4;
  text: string | null;
}>;

type ChatSemanticProjectionEventV4 = ChatSemanticEventBaseV4 &
  (
    | { readonly kind: "turn_started"; readonly payload: ChatSourceFactV4 }
    | { readonly kind: "plan_updated"; readonly payload: ChatPlanSnapshotV4 }
    | {
        readonly kind: "item_started" | "item_completed";
        readonly payload: ChatItemLifecyclePayloadV4;
      }
    | {
        readonly kind: "agent_message_append";
        readonly payload: ChatSourceFactV4 & Readonly<{
          itemId: string;
          itemOrdinal: number;
          phase: ChatAgentMessagePhaseV4;
          text: string;
        }>;
      }
    | {
        readonly kind: "reasoning_append";
        readonly payload: ChatSourceFactV4 & Readonly<{
          itemId: string;
          itemOrdinal: number;
          contentIndex: number;
          text: string;
        }>;
      }
    | {
        readonly kind: "reasoning_finalized";
        readonly payload: ChatSourceFactV4 & Readonly<{
          itemId: string;
          itemOrdinal: number;
          status: (typeof CHAT_REASONING_STATUSES_V4)[number];
          reasonCode: ChatReasoningReasonCodeV4 | null;
          parts: readonly ChatReasoningPartV4[];
        }>;
      }
    | {
        readonly kind: "notice";
        readonly payload: Omit<ChatTimelineNoticeV4, "observedAtMs">;
      }
    | {
        readonly kind: "turn_terminal";
        readonly payload: ChatSourceFactV4 & Readonly<{
          status: "completed" | "interrupted" | "failed";
          code: string | null;
          unfinishedReasoningReasonCode: ChatReasoningReasonCodeV4 | null;
        }>;
      }
  );

type ChatControlProjectionEventV4 = ChatEventBaseV4 &
  {
    readonly kind: "resync_required" | "context_invalidated";
    readonly payload: { readonly reason: string };
  };

export type ChatProjectionEventV4 =
  | ChatSemanticProjectionEventV4
  | ChatControlProjectionEventV4;

export type ChatEventKindV5 =
  | ChatEventKindV4
  | "command_started"
  | "command_output_append"
  | "command_completed"
  | "tool_started"
  | "tool_progress"
  | "tool_completed";

type ChatExecutionItemPayloadV5 = ChatSourceFactV5 & Readonly<{
  itemId: string;
  itemOrdinal: number;
}>;

export type ChatCommandStartedPayloadV5 = ChatExecutionItemPayloadV5 & Readonly<{
  status: "running";
  commandSummary: ChatSafeTextV5;
  cwd: ChatCommandCwdV5;
}>;

export type ChatCommandOutputAppendPayloadV5 = ChatExecutionItemPayloadV5 & Readonly<{
  text: string;
  truncated: boolean;
  truncationReason: ChatTruncationReasonV5 | null;
}>;

export type ChatCommandCompletedPayloadV5 = ChatExecutionItemPayloadV5 & Readonly<{
  status: "completed" | "failed" | "declined";
  commandSummary: ChatSafeTextV5;
  cwd: ChatCommandCwdV5;
  durationMs: number | null;
  exitCode: number | null;
  output: ChatCommandOutputV5;
  error: ChatExecutionErrorV5 | null;
}>;

export type ChatToolStartedPayloadV5 = ChatExecutionItemPayloadV5 & Readonly<{
  status: "in_progress";
  identity: ChatToolIdentityV5;
  argumentsSummary: ChatSafeTextV5;
}>;

export type ChatToolProgressPayloadV5 = ChatExecutionItemPayloadV5 & Readonly<{
  status: "in_progress";
  identity: ChatToolIdentityV5;
  progressIndex: number;
  summary: ChatSafeTextV5;
}>;

export type ChatToolCompletedPayloadV5 = ChatExecutionItemPayloadV5 & Readonly<{
  status: "completed" | "failed" | "declined";
  identity: ChatToolIdentityV5;
  argumentsSummary: ChatSafeTextV5;
  durationMs: number | null;
  resultSummary: ChatSafeTextV5 | null;
  error: ChatExecutionErrorV5 | null;
}>;

interface ChatSemanticEventBaseV5 {
  readonly schemaVersion: 5;
  readonly subscriptionId: string;
  readonly contextId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly projectionSequence: string;
  readonly eventId: string;
  readonly durableSequence: string;
}

type ChatExecutionProjectionEventV5 = ChatSemanticEventBaseV5 &
  (
    | { readonly kind: "command_started"; readonly payload: ChatCommandStartedPayloadV5 }
    | { readonly kind: "command_output_append"; readonly payload: ChatCommandOutputAppendPayloadV5 }
    | { readonly kind: "command_completed"; readonly payload: ChatCommandCompletedPayloadV5 }
    | { readonly kind: "tool_started"; readonly payload: ChatToolStartedPayloadV5 }
    | { readonly kind: "tool_progress"; readonly payload: ChatToolProgressPayloadV5 }
    | { readonly kind: "tool_completed"; readonly payload: ChatToolCompletedPayloadV5 }
  );

type WithV5Schema<T> = T extends unknown
  ? Omit<T, "schemaVersion"> & Readonly<{ schemaVersion: 5 }>
  : never;

type ChatNativeInheritedProjectionEventV5 =
  WithV5Schema<ChatProjectionEventV4> &
  Readonly<{ sourceSchemaVersion?: never }>;

type ChatStickyV4ProjectionEventV5 =
  WithV5Schema<ChatSemanticProjectionEventV4> &
  Readonly<{ sourceSchemaVersion: 4 }>;

export type ChatProjectionEventV5 =
  | ChatNativeInheritedProjectionEventV5
  | ChatStickyV4ProjectionEventV5
  | ChatExecutionProjectionEventV5;

export const CHAT_APPROVAL_DECISIONS_V6 = Object.freeze([
  "accept_once",
  "cancel_current_turn",
] as const);

export type ChatApprovalDecisionV6 =
  (typeof CHAT_APPROVAL_DECISIONS_V6)[number];

export const CHAT_APPROVAL_OUTCOMES_V6 = Object.freeze([
  "accepted_once",
  "cancelled_current_turn",
  "expired",
  "resolved_elsewhere",
] as const);

export type ChatApprovalOutcomeV6 =
  (typeof CHAT_APPROVAL_OUTCOMES_V6)[number];

export interface ChatApprovalDecisionSetV6 {
  readonly primary: "accept_once";
  readonly secondary: "cancel_current_turn";
}

interface ChatApprovalProjectionBaseV6 extends ChatSourceFactV5 {
  readonly turnId: string;
  readonly itemId: string;
  readonly approvalRequestId: string;
  readonly actionId: "git_repository_check";
  readonly workspaceScope: "current_workspace";
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export interface ChatApprovalRequestedPayloadV6
  extends ChatApprovalProjectionBaseV6 {
  readonly status: "pending";
  readonly revision: 1;
  readonly decisions: ChatApprovalDecisionSetV6;
  readonly ttlSeconds: 120;
}

type ChatApprovalResolvedWithoutDecisionV6 =
  ChatApprovalProjectionBaseV6 & Readonly<{
    status: "resolved";
    revision: 2;
    outcome: "expired" | "resolved_elsewhere";
    resolvedAt: string;
  }>;

type ChatApprovalResolvedWithDecisionV6 =
  ChatApprovalProjectionBaseV6 & Readonly<{
    status: "resolved";
    revision: 2;
    outcome: "accepted_once" | "cancelled_current_turn";
    decisionId: string;
    decision: ChatApprovalDecisionV6;
    resolvedAt: string;
  }>;

export type ChatApprovalResolvedPayloadV6 =
  | ChatApprovalResolvedWithoutDecisionV6
  | ChatApprovalResolvedWithDecisionV6;

export type ChatApprovalProjectionV6 =
  | ChatApprovalRequestedPayloadV6
  | ChatApprovalResolvedPayloadV6;

interface ChatApprovalProjectionEventV6 {
  readonly schemaVersion: typeof CHAT_IPC_V6_SCHEMA_VERSION;
  readonly sourceSchemaVersion?: never;
  readonly subscriptionId: string;
  readonly contextId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly projectionSequence: string;
  readonly eventId: string;
  readonly durableSequence: string;
  readonly kind: "approval_changed";
  readonly payload: ChatApprovalProjectionV6;
}

type WithV6Schema<T> = T extends unknown
  ? Omit<T, "schemaVersion" | "sourceSchemaVersion"> & Readonly<{
      schemaVersion: typeof CHAT_IPC_V6_SCHEMA_VERSION;
      sourceSchemaVersion?: 4 | 5;
    }>
  : never;

export type ChatProjectionEventV6 =
  | WithV6Schema<ChatProjectionEventV5>
  | ChatApprovalProjectionEventV6;

export interface ChatPendingApprovalV6 {
  readonly approvalRequestId: string;
  readonly revision: 1;
  readonly turnId: string;
  readonly itemId: string;
  readonly actionId: "git_repository_check";
  readonly workspaceScope: "current_workspace";
  readonly decisions: ChatApprovalDecisionSetV6;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly ttlSeconds: 120;
}

export interface ChatPendingApprovalSnapshotV6 {
  readonly schemaVersion: typeof CHAT_IPC_V6_SCHEMA_VERSION;
  readonly streamId: string;
  readonly snapshotAt: string;
  readonly pending: readonly ChatPendingApprovalV6[];
}

export interface ChatHistoryPageV6 extends Omit<ChatHistoryPageV5, "schemaVersion"> {
  readonly schemaVersion: typeof CHAT_IPC_V6_SCHEMA_VERSION;
  readonly approvals: readonly ChatApprovalProjectionV6[];
}

export interface ChatSubscriptionV6 {
  readonly subscriptionId: string;
  readonly pendingApprovalSnapshot: ChatPendingApprovalSnapshotV6;
}

export interface ChatResyncProjectionV6 {
  readonly session: ChatSession;
  readonly history: ChatHistoryPageV6;
  readonly cleanup: ChatCleanupStatus | null;
  readonly pendingApprovalSnapshot: ChatPendingApprovalSnapshotV6;
}

export interface ChatApprovalDecisionRequestV6 {
  readonly schemaVersion: typeof CHAT_IPC_V6_SCHEMA_VERSION;
  readonly decisionId: string;
  readonly expectedStreamId: string;
  readonly expectedRevision: 1;
  readonly decision: ChatApprovalDecisionV6;
}

export type ChatApprovalDecisionResultV6 = Readonly<{
  schemaVersion: typeof CHAT_IPC_V6_SCHEMA_VERSION;
  approvalRequestId: string;
  decisionId: string;
  streamId: string;
  revision: 2;
  resolvedAt: string;
}> & (
  | Readonly<{ decision: "accept_once"; outcome: "accepted_once" }>
  | Readonly<{
      decision: "cancel_current_turn";
      outcome: "cancelled_current_turn";
    }>
);

export const CHAT_APPROVAL_ERROR_CODES_V6 = Object.freeze([
  "unauthorized",
  "invalid_approval_request",
  "approval_version_mismatch",
  "session_not_found",
  "approval_not_found",
  "approval_stale",
  "approval_expired",
  "approval_already_resolved",
  "approval_decision_conflict",
  "approval_unavailable",
  "internal_error",
] as const);

export type ChatApprovalErrorCodeV6 =
  (typeof CHAT_APPROVAL_ERROR_CODES_V6)[number];

export interface ChatApprovalErrorV6 {
  readonly code: ChatApprovalErrorCodeV6;
  readonly message:
    | "valid Agent Host bearer token required"
    | "approval request is invalid"
    | "approval schema version does not match"
    | "agent session was not found"
    | "approval request was not found"
    | "approval request is stale"
    | "approval request expired"
    | "approval request was already resolved"
    | "approval decision conflicts with the existing decision"
    | "approval authority is unavailable"
    | "approval processing failed";
}

type Parser<T> = (value: unknown) => T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isRecord(value)) throw new ChatContractError();
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !(key in value)) || keys.some((key) => !allowed.has(key))) {
    throw new ChatContractError();
  }
  return value;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new ChatContractError();
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value) || value === "00000000-0000-0000-0000-000000000000") {
    throw new ChatContractError();
  }
  return value;
}

function stringValue(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.includes("\0") || value.length > maximum || (!allowEmpty && value.length === 0)) {
    throw new ChatContractError();
  }
  return value;
}

function codePointStringValue(
  value: unknown,
  maximumCodePoints: number,
  maximumBytes: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" || value.includes("\0") ||
    [...value].length > maximumCodePoints ||
    new TextEncoder().encode(value).length > maximumBytes ||
    (!allowEmpty && value.length === 0)
  ) {
    throw new ChatContractError();
  }
  return value;
}

function itemIdV5(value: unknown): string {
  return codePointStringValue(value, 256, 1024);
}

function plainText(value: unknown, maximumBytes: number, allowEmpty = false): string {
  const text = stringValue(value, maximumBytes, allowEmpty);
  if (new TextEncoder().encode(text).length > maximumBytes) throw new ChatContractError();
  return text;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ChatContractError();
  }
  return value as number;
}

function nullable<T>(value: unknown, parser: Parser<T>): T | null {
  return value === null ? null : parser(value);
}

function cursor(value: unknown): string {
  if (typeof value !== "string" || !CURSOR_PATTERN.test(value)) throw new ChatContractError();
  return value;
}

function sourceSequence(value: unknown): string {
  if (typeof value !== "string" || !SEQUENCE_PATTERN.test(value)) throw new ChatContractError();
  const sequence = BigInt(value);
  if (sequence === 0n || sequence > MAX_SAFE_EVENT_SEQUENCE) throw new ChatContractError();
  return value;
}

function durableSequence(value: unknown, allowZero: boolean): string {
  if (typeof value !== "string" || !SEQUENCE_PATTERN.test(value)) throw new ChatContractError();
  const sequence = BigInt(value);
  if ((!allowZero && sequence === 0n) || sequence > MAX_SAFE_EVENT_SEQUENCE) {
    throw new ChatContractError();
  }
  return value;
}

function sourceOccurredAt(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < RFC3339_MIN_LENGTH ||
    value.length > RFC3339_MAX_LENGTH ||
    !RFC3339_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new ChatContractError();
  }
  return value;
}

function safeCode(value: unknown): string {
  if (typeof value !== "string" || !SAFE_CODE_PATTERN.test(value)) throw new ChatContractError();
  return value;
}

function responseData<T>(value: unknown, parser: Parser<T>): T {
  const envelope = exactObject(value, ["schemaVersion", "requestId", "data"]);
  if (envelope.schemaVersion !== CHAT_IPC_SCHEMA_VERSION) throw new ChatContractError();
  uuid(envelope.requestId);
  return parser(envelope.data);
}

function responseDataV2<T>(value: unknown, parser: Parser<T>): T {
  const envelope = exactObject(value, ["schemaVersion", "requestId", "data"]);
  if (envelope.schemaVersion !== CHAT_IPC_V2_SCHEMA_VERSION) throw new ChatContractError();
  uuid(envelope.requestId);
  return parser(envelope.data);
}

function responseDataV3<T>(value: unknown, parser: Parser<T>): T {
  const envelope = exactObject(value, ["schemaVersion", "requestId", "data"]);
  if (envelope.schemaVersion !== CHAT_IPC_V3_SCHEMA_VERSION) throw new ChatContractError();
  uuid(envelope.requestId);
  return parser(envelope.data);
}

function responseDataV4<T>(value: unknown, parser: Parser<T>): T {
  const envelope = exactObject(value, ["schemaVersion", "requestId", "data"]);
  if (envelope.schemaVersion !== CHAT_IPC_V4_SCHEMA_VERSION) throw new ChatContractError();
  uuid(envelope.requestId);
  return parser(envelope.data);
}

function responseDataV5<T>(value: unknown, parser: Parser<T>): T {
  const envelope = exactObject(value, ["schemaVersion", "requestId", "data"]);
  if (envelope.schemaVersion !== CHAT_IPC_V5_SCHEMA_VERSION) throw new ChatContractError();
  uuid(envelope.requestId);
  return parser(envelope.data);
}

function responseDataV6<T>(value: unknown, parser: Parser<T>): T {
  const envelope = exactObject(value, ["schemaVersion", "requestId", "data"]);
  if (envelope.schemaVersion !== CHAT_IPC_V6_SCHEMA_VERSION) throw new ChatContractError();
  uuid(envelope.requestId);
  return parser(envelope.data);
}

export function parseChatIpcError(value: unknown): ChatIpcErrorShape {
  const error = exactObject(
    value,
    ["schemaVersion", "code", "retryable", "recovery"],
    [
      "requestId", "attachmentIssue", "attachmentItemCount", "approvalIssue",
      "retryAfterMs",
    ],
  );
  if (
    (error.schemaVersion !== CHAT_IPC_SCHEMA_VERSION &&
      error.schemaVersion !== CHAT_IPC_V2_SCHEMA_VERSION &&
      error.schemaVersion !== CHAT_IPC_V3_SCHEMA_VERSION &&
      error.schemaVersion !== CHAT_IPC_V4_SCHEMA_VERSION &&
      error.schemaVersion !== CHAT_IPC_V5_SCHEMA_VERSION &&
      error.schemaVersion !== CHAT_IPC_V6_SCHEMA_VERSION) ||
    typeof error.retryable !== "boolean"
  ) {
    throw new ChatContractError();
  }
  const code = oneOf(error.code, CHAT_ERROR_CODES);
  const attachmentIssue = error.attachmentIssue === undefined
    ? undefined
    : oneOf(error.attachmentIssue, CHAT_ATTACHMENT_ISSUES);
  if (attachmentIssue !== undefined) {
    if (error.schemaVersion !== CHAT_IPC_V2_SCHEMA_VERSION) throw new ChatContractError();
    const isLimitIssue = attachmentIssue === "too_many" || attachmentIssue === "too_large";
    if (code !== (isLimitIssue ? "chat_limit_exceeded" : "chat_request_invalid")) {
      throw new ChatContractError();
    }
  }
  const attachmentItemCount = error.attachmentItemCount === undefined
    ? undefined
    : integer(error.attachmentItemCount, 1, 10);
  if (attachmentItemCount !== undefined && error.schemaVersion !== CHAT_IPC_V2_SCHEMA_VERSION) {
    throw new ChatContractError();
  }
  const recovery = oneOf(error.recovery, CHAT_RECOVERIES);
  const approvalIssue = error.approvalIssue === undefined
    ? undefined
    : oneOf(error.approvalIssue, CHAT_APPROVAL_ERROR_CODES_V6);
  if (approvalIssue !== undefined && (
    error.schemaVersion !== CHAT_IPC_V6_SCHEMA_VERSION ||
    code !== "chat_conflict" || error.retryable || recovery !== "resync"
  )) {
    throw new ChatContractError();
  }
  return Object.freeze({
    schemaVersion: error.schemaVersion,
    ...(error.requestId === undefined ? {} : { requestId: uuid(error.requestId) }),
    code,
    retryable: error.retryable,
    recovery,
    ...(attachmentIssue === undefined ? {} : { attachmentIssue }),
    ...(attachmentItemCount === undefined ? {} : { attachmentItemCount }),
    ...(approvalIssue === undefined ? {} : { approvalIssue }),
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: integer(error.retryAfterMs, 0, 60_000) }),
  });
}

export function parseBoundContextResponse(value: unknown): BoundChatContext {
  return responseData(value, (data) => {
    const body = exactObject(data, ["contextId", "expiresAtEpochSeconds", "allowedActions"]);
    if (!Array.isArray(body.allowedActions) || body.allowedActions.length > CHAT_ALLOWED_ACTIONS.length) {
      throw new ChatContractError();
    }
    const actions = body.allowedActions.map((action) => oneOf(action, CHAT_ALLOWED_ACTIONS));
    if (new Set(actions).size !== actions.length) throw new ChatContractError();
    return Object.freeze({
      contextId: uuid(body.contextId),
      expiresAtEpochSeconds: integer(body.expiresAtEpochSeconds, 1),
      allowedActions: Object.freeze(actions),
    });
  });
}

function parseProject(value: unknown): ChatProject {
  const project = exactObject(value, ["projectId", "safeName", "pinnedAt", "lastUsedAt", "available"]);
  if (typeof project.available !== "boolean") throw new ChatContractError();
  return Object.freeze({
    projectId: uuid(project.projectId),
    safeName: stringValue(project.safeName, 255),
    pinnedAt: nullable(project.pinnedAt, (entry) => integer(entry)),
    lastUsedAt: integer(project.lastUsedAt),
    available: project.available,
  });
}

export function parseProjectListResponse(value: unknown): readonly ChatProject[] {
  return responseData(value, (data) => {
    if (!Array.isArray(data) || data.length > 256) throw new ChatContractError();
    return Object.freeze(data.map(parseProject));
  });
}

export function parseOptionalProjectResponse(value: unknown): ChatProject | null {
  return responseData(value, (data) => nullable(data, parseProject));
}

export function parseProjectResponse(value: unknown): ChatProject {
  return responseData(value, parseProject);
}

function parseSession(value: unknown): ChatSession {
  const session = exactObject(value, [
    "sessionId", "projectId", "title", "titleSource", "pinnedAt", "lastActivityAt",
    "latestTurnStatus", "projectAvailable",
  ]);
  if (typeof session.projectAvailable !== "boolean") throw new ChatContractError();
  return Object.freeze({
    sessionId: uuid(session.sessionId),
    projectId: uuid(session.projectId),
    title: stringValue(session.title, 1024),
    titleSource: oneOf(session.titleSource, ["fallback", "model", "user"] as const),
    pinnedAt: nullable(session.pinnedAt, (entry) => integer(entry)),
    lastActivityAt: integer(session.lastActivityAt),
    latestTurnStatus: nullable(session.latestTurnStatus, (entry) => stringValue(entry, 64)),
    projectAvailable: session.projectAvailable,
  });
}

function validateAttachmentName(name: string): string {
  if (name.trim() !== name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new ChatContractError();
  }
  return name;
}

function attachmentName(value: unknown): string {
  return validateAttachmentName(stringValue(value, 255));
}

function artifactDisplayNameV5(value: unknown): string {
  return validateAttachmentName(codePointStringValue(value, 255, 1020));
}

function parseAttachment(value: unknown, history = false): ChatAttachment {
  const attachment = exactObject(value, [
    "attachmentId", "type", "name", "mediaType", "sizeBytes", "status", "expiresAt",
  ]);
  const name = attachmentName(attachment.name);
  const type = oneOf(attachment.type, ["file", "image"] as const);
  const mediaType = type === "image"
    ? oneOf(attachment.mediaType, CHAT_IMAGE_MEDIA_TYPES)
    : oneOf(attachment.mediaType, CHAT_FILE_MEDIA_TYPES);
  const status = oneOf(attachment.status, CHAT_ATTACHMENT_STATUSES);
  if (history && status !== "bound" && status !== "expired") throw new ChatContractError();
  return Object.freeze({
    attachmentId: uuid(attachment.attachmentId),
    type,
    name,
    mediaType,
    sizeBytes: integer(attachment.sizeBytes, 1, 10 * 1024 * 1024),
    status,
    expiresAt: integer(attachment.expiresAt, 1),
  });
}

function parseContentBlock(value: unknown): ChatMessageContentBlock {
  if (!isRecord(value)) throw new ChatContractError();
  if (value.type === "text") {
    const block = exactObject(value, ["type", "text"]);
    return Object.freeze({ type: "text", text: plainText(block.text, 1024 * 1024) });
  }
  return parseAttachment(value, true);
}

export function parseAttachmentListResponse(value: unknown): readonly ChatAttachment[] {
  return responseDataV2(value, (data) => {
    if (!Array.isArray(data) || data.length > 10) throw new ChatContractError();
    const attachments = data.map((entry) => parseAttachment(entry));
    if (new Set(attachments.map((attachment) => attachment.attachmentId)).size !== attachments.length) {
      throw new ChatContractError();
    }
    return Object.freeze(attachments);
  });
}

export function parseAttachmentImportEvent(value: unknown): ChatAttachmentImportEvent {
  const event = exactObject(value, [
    "schemaVersion", "contextId", "operationId", "sequence", "stage", "itemCount", "issue",
  ]);
  if (
    event.schemaVersion !== CHAT_IPC_V2_SCHEMA_VERSION ||
    typeof event.sequence !== "string" ||
    !SEQUENCE_PATTERN.test(event.sequence)
  ) {
    throw new ChatContractError();
  }
  const sequence = BigInt(event.sequence);
  if (sequence === 0n || sequence > MAX_SAFE_EVENT_SEQUENCE) throw new ChatContractError();
  const stage = oneOf(event.stage, CHAT_ATTACHMENT_IMPORT_STAGES);
  const itemCount = integer(event.itemCount, 1, 10);
  const issue = nullable(event.issue, (entry) => oneOf(entry, CHAT_ATTACHMENT_IMPORT_EVENT_ISSUES));

  if ((stage === "error_terminal") !== (issue !== null)) {
    throw new ChatContractError();
  }

  return Object.freeze({
    schemaVersion: 2,
    contextId: uuid(event.contextId),
    operationId: uuid(event.operationId),
    sequence: event.sequence,
    stage,
    itemCount,
    issue,
  });
}

export function parseSessionPageResponse(value: unknown): ChatSessionPage {
  return responseData(value, (data) => {
    const page = exactObject(data, ["sessions", "nextCursor"]);
    if (!Array.isArray(page.sessions) || page.sessions.length > 50) throw new ChatContractError();
    return Object.freeze({
      sessions: Object.freeze(page.sessions.map(parseSession)),
      nextCursor: nullable(page.nextCursor, cursor),
    });
  });
}

function parseMessage(value: unknown): ChatMessage {
  const message = exactObject(value, ["messageId", "role", "content", "status", "ordinal", "createdAt"]);
  return Object.freeze({
    messageId: uuid(message.messageId),
    role: oneOf(message.role, ["user", "assistant"] as const),
    content: plainText(message.content, 1024 * 1024, true),
    status: stringValue(message.status, 64),
    ordinal: integer(message.ordinal),
    createdAt: integer(message.createdAt),
  });
}

function parseReasoningMetadata(value: unknown): ChatReasoningMetadata {
  const item = exactObject(value, [
    "itemOrdinal", "status", "reasonCode", "totalBytes", "partCount", "finalizedAtMs",
  ]);
  return Object.freeze({
    itemOrdinal: integer(item.itemOrdinal, 0, 7),
    status: oneOf(item.status, ["complete", "incomplete", "unavailable"] as const),
    reasonCode: nullable(item.reasonCode, (entry) => stringValue(entry, 128)),
    totalBytes: integer(item.totalBytes, 0, 128 * 1024),
    partCount: integer(item.partCount, 0, 8),
    finalizedAtMs: integer(item.finalizedAtMs),
  });
}

function parseHistoryPage(value: unknown): ChatHistoryPage {
  const page = exactObject(value, ["turns", "nextCursor"]);
  if (!Array.isArray(page.turns) || page.turns.length > 50) throw new ChatContractError();
  const turns = page.turns.map((value): ChatHistoryTurn => {
    const turn = exactObject(value, [
      "turnId", "status", "terminalAt", "reasoningStatus", "reasoningReasonCode", "messages", "reasoning",
    ]);
    if (!Array.isArray(turn.messages) || !Array.isArray(turn.reasoning) || turn.reasoning.length > 8) {
      throw new ChatContractError();
    }
    return Object.freeze({
      turnId: uuid(turn.turnId),
      status: stringValue(turn.status, 64),
      terminalAt: nullable(turn.terminalAt, (entry) => integer(entry)),
      reasoningStatus: stringValue(turn.reasoningStatus, 64),
      reasoningReasonCode: nullable(turn.reasoningReasonCode, (entry) => stringValue(entry, 128)),
      messages: Object.freeze(turn.messages.map(parseMessage)),
      reasoning: Object.freeze(turn.reasoning.map(parseReasoningMetadata)),
    });
  });
  return Object.freeze({ turns: Object.freeze(turns), nextCursor: nullable(page.nextCursor, cursor) });
}

export function parseHistoryPageResponse(value: unknown): ChatHistoryPage {
  return responseData(value, parseHistoryPage);
}

function parseMessageV2(value: unknown): ChatMessage {
  const message = exactObject(value, [
    "messageId", "role", "content", "contentBlocks", "status", "ordinal", "createdAt",
  ]);
  if (!Array.isArray(message.contentBlocks) || message.contentBlocks.length === 0 || message.contentBlocks.length > 16) {
    throw new ChatContractError();
  }
  const contentBlocks = Object.freeze(message.contentBlocks.map(parseContentBlock));
  const content = plainText(message.content, 1024 * 1024, true);
  const projectedText = contentBlocks
    .filter((block): block is ChatTextContentBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (content !== projectedText) throw new ChatContractError();
  return Object.freeze({
    messageId: uuid(message.messageId),
    role: oneOf(message.role, ["user", "assistant"] as const),
    content,
    contentBlocks,
    status: stringValue(message.status, 64),
    ordinal: integer(message.ordinal),
    createdAt: integer(message.createdAt),
  });
}

function parseHistoryPageV2(value: unknown): ChatHistoryPage {
  const page = exactObject(value, ["turns", "nextCursor"]);
  if (!Array.isArray(page.turns) || page.turns.length > 50) throw new ChatContractError();
  const turns = page.turns.map((value): ChatHistoryTurn => {
    const turn = exactObject(value, [
      "turnId", "status", "terminalAt", "reasoningStatus", "reasoningReasonCode", "messages", "reasoning",
    ]);
    if (!Array.isArray(turn.messages) || !Array.isArray(turn.reasoning) || turn.reasoning.length > 8) {
      throw new ChatContractError();
    }
    return Object.freeze({
      turnId: uuid(turn.turnId),
      status: stringValue(turn.status, 64),
      terminalAt: nullable(turn.terminalAt, (entry) => integer(entry)),
      reasoningStatus: stringValue(turn.reasoningStatus, 64),
      reasoningReasonCode: nullable(turn.reasoningReasonCode, (entry) => stringValue(entry, 128)),
      messages: Object.freeze(turn.messages.map(parseMessageV2)),
      reasoning: Object.freeze(turn.reasoning.map(parseReasoningMetadata)),
    });
  });
  return Object.freeze({ turns: Object.freeze(turns), nextCursor: nullable(page.nextCursor, cursor) });
}

export function parseHistoryPageResponseV2(value: unknown): ChatHistoryPage {
  return responseDataV2(value, parseHistoryPageV2);
}

const CHAT_ARTIFACT_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const CHAT_ARTIFACT_FILE_MEDIA_TYPES = [
  "text/plain",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

function parseArtifact(value: unknown): ChatArtifact {
  return parseArtifactWithLengths(value, false);
}

function parseArtifactV5(value: unknown): ChatArtifact {
  return parseArtifactWithLengths(value, true);
}

function parseArtifactWithLengths(value: unknown, v5Lengths: boolean): ChatArtifact {
  const artifact = exactObject(value, [
    "artifactId", "kind", "provenance", "status", "ordinal", "progressStage", "progressPercent",
    "displayName", "mediaType",
    "sizeBytes", "localCommittedAt", "expiresAt", "hasPoster", "errorCode", "retryable",
  ]);
  if (typeof artifact.hasPoster !== "boolean") throw new ChatContractError();
  const kind = oneOf(artifact.kind, CHAT_ARTIFACT_KINDS);
  const status = oneOf(artifact.status, CHAT_ARTIFACT_STATUSES);
  const displayName = nullable(
    artifact.displayName,
    v5Lengths ? artifactDisplayNameV5 : attachmentName,
  );
  const progressStage = nullable(artifact.progressStage, (entry) => oneOf(
    entry,
    ["generating", "processing", "finalizing"] as const,
  ));
  const progressPercent = nullable(artifact.progressPercent, (entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 100) {
      throw new ChatContractError();
    }
    return entry;
  });
  const mediaType = nullable(artifact.mediaType, (entry) => {
    switch (kind) {
      case "image": return oneOf(entry, CHAT_ARTIFACT_IMAGE_MEDIA_TYPES);
      case "video": return oneOf(entry, ["video/mp4"] as const);
      case "file": return oneOf(entry, CHAT_ARTIFACT_FILE_MEDIA_TYPES);
      case "report": return oneOf(entry, ["application/vnd.yijie.report+json;version=1"] as const);
    }
  });
  const sizeBytes = nullable(artifact.sizeBytes, (entry) => integer(
    entry,
    1,
    kind === "image" ? 20 * 1024 * 1024 : 64 * 1024 * 1024,
  ));
  const localCommittedAt = nullable(artifact.localCommittedAt, (entry) => integer(entry));
  const expiresAt = nullable(artifact.expiresAt, (entry) => integer(entry));
  const errorCode = nullable(artifact.errorCode, (entry) => stringValue(entry, 128));
  const retryable = nullable(artifact.retryable, (entry) => {
    if (typeof entry !== "boolean") throw new ChatContractError();
    return entry;
  });
  if ((kind !== "video" && artifact.hasPoster) || (artifact.hasPoster && status !== "ready" && status !== "expired")) {
    throw new ChatContractError();
  }
  const hasManifest = mediaType !== null && sizeBytes !== null;
  const isDurable = status === "ready" || status === "expired";
  const isFailed = status === "failed" || status === "cancelled";
  const consistent =
    (isDurable && hasManifest && progressStage === null && progressPercent === null && localCommittedAt !== null &&
      expiresAt === localCommittedAt + 7 * 24 * 60 * 60 && errorCode === null && retryable === null) ||
    (status === "transferring" && hasManifest && localCommittedAt === null && expiresAt === null &&
      errorCode === null && retryable === null && !artifact.hasPoster) ||
    (isFailed && progressStage === null && progressPercent === null && localCommittedAt === null && expiresAt === null && errorCode !== null && retryable !== null &&
      !artifact.hasPoster) ||
    ((status === "announced" || status === "generating" || status === "processing") && !hasManifest &&
      localCommittedAt === null && expiresAt === null && errorCode === null && retryable === null &&
      !artifact.hasPoster &&
      (status !== "announced" || (progressStage === null && progressPercent === null)) &&
      (progressStage === null ||
        (status === "generating" && progressStage === "generating") ||
        (status === "processing" && (progressStage === "processing" || progressStage === "finalizing"))));
  if (!consistent || ((mediaType === null) !== (sizeBytes === null))) throw new ChatContractError();
  return Object.freeze({
    artifactId: uuid(artifact.artifactId),
    kind,
    provenance: oneOf(artifact.provenance, CHAT_ARTIFACT_PROVENANCES),
    status,
    ordinal: integer(artifact.ordinal, 0, 11),
    progressStage,
    progressPercent,
    displayName,
    mediaType,
    sizeBytes,
    localCommittedAt,
    expiresAt,
    hasPoster: artifact.hasPoster,
    errorCode,
    retryable,
  });
}

function parseHistoryPageV3(value: unknown): ChatHistoryPage {
  const page = exactObject(value, ["turns", "nextCursor"]);
  if (!Array.isArray(page.turns) || page.turns.length > 50) throw new ChatContractError();
  const turns = page.turns.map((value): ChatHistoryTurn => {
    const turn = exactObject(value, [
      "turnId", "status", "terminalAt", "reasoningStatus", "reasoningReasonCode",
      "messages", "reasoning", "artifacts",
    ]);
    if (!Array.isArray(turn.messages) || !Array.isArray(turn.reasoning) || !Array.isArray(turn.artifacts) ||
        turn.reasoning.length > 8 || turn.artifacts.length > 12) {
      throw new ChatContractError();
    }
    const artifacts = turn.artifacts.map(parseArtifact);
    if (artifacts.some((artifact, index) => index > 0 && artifacts[index - 1]!.ordinal >= artifact.ordinal)) {
      throw new ChatContractError();
    }
    return Object.freeze({
      turnId: uuid(turn.turnId),
      status: stringValue(turn.status, 64),
      terminalAt: nullable(turn.terminalAt, (entry) => integer(entry)),
      reasoningStatus: stringValue(turn.reasoningStatus, 64),
      reasoningReasonCode: nullable(turn.reasoningReasonCode, (entry) => stringValue(entry, 128)),
      messages: Object.freeze(turn.messages.map(parseMessageV2)),
      reasoning: Object.freeze(turn.reasoning.map(parseReasoningMetadata)),
      artifacts: Object.freeze(artifacts),
    });
  });
  return Object.freeze({ turns: Object.freeze(turns), nextCursor: nullable(page.nextCursor, cursor) });
}

export function parseHistoryPageResponseV3(value: unknown): ChatHistoryPage {
  return responseDataV3(value, parseHistoryPageV3);
}

function sourceFactV4(value: Record<string, unknown>): ChatSourceFactV4 {
  return Object.freeze({
    sourceEventId: uuid(value.sourceEventId),
    sourceSequence: sourceSequence(value.sourceSequence),
    sourceOccurredAt: sourceOccurredAt(value.sourceOccurredAt),
  });
}

function parseAgentMessagePhaseV4(value: unknown): ChatAgentMessagePhaseV4 {
  return nullable(value, (entry) => oneOf(entry, CHAT_AGENT_MESSAGE_PHASES_V4));
}

function parseReasoningPartV4(value: unknown): ChatReasoningPartV4 {
  const part = exactObject(value, ["contentIndex", "text"]);
  return Object.freeze({
    contentIndex: integer(part.contentIndex, 0, 7),
    text: plainText(part.text, 64 * 1024),
  });
}

function parseReasoningPartsV4(value: unknown): readonly ChatReasoningPartV4[] {
  if (!Array.isArray(value) || value.length > 8) throw new ChatContractError();
  let totalBytes = 0;
  const parts = value.map((entry, index) => {
    const part = parseReasoningPartV4(entry);
    if (part.contentIndex !== index) throw new ChatContractError();
    totalBytes += new TextEncoder().encode(part.text).length;
    return part;
  });
  if (totalBytes > 128 * 1024) throw new ChatContractError();
  return Object.freeze(parts);
}

function parsePlanStepsV4(value: unknown, allowEmpty: boolean): readonly ChatPlanStepV4[] {
  if (!Array.isArray(value) || value.length > 128 || (!allowEmpty && value.length === 0)) {
    throw new ChatContractError();
  }
  return Object.freeze(value.map((entry, index) => {
    const step = exactObject(entry, ["ordinal", "step", "status"]);
    const ordinal = integer(step.ordinal, 0, 127);
    if (ordinal !== index) throw new ChatContractError();
    return Object.freeze({
      ordinal,
      step: plainText(step.step, 64 * 1024, true),
      status: oneOf(step.status, CHAT_PLAN_STEP_STATUSES_V4),
    });
  }));
}

function parsePlanSnapshotV4(value: unknown, allowEmpty: boolean): ChatPlanSnapshotV4 {
  const plan = exactObject(value, [
    "sourceEventId", "sourceSequence", "sourceOccurredAt", "explanation", "steps",
  ]);
  return Object.freeze({
    ...sourceFactV4(plan),
    explanation: nullable(plan.explanation, (entry) => plainText(entry, 64 * 1024, true)),
    steps: parsePlanStepsV4(plan.steps, allowEmpty),
  });
}

function parseTimelineNoticeV4(value: unknown): ChatTimelineNoticeV4 {
  const notice = exactObject(value, [
    "sourceEventId", "sourceSequence", "sourceOccurredAt", "scope", "severity",
    "code", "willRetry", "observedAtMs",
  ]);
  if (typeof notice.willRetry !== "boolean") throw new ChatContractError();
  const scope = oneOf(notice.scope, ["session", "turn"] as const);
  const severity = oneOf(notice.severity, ["warning", "error"] as const);
  if ((scope === "session") !== (severity === "warning")) throw new ChatContractError();
  return Object.freeze({
    ...sourceFactV4(notice),
    scope,
    severity,
    code: nullable(notice.code, safeCode),
    willRetry: notice.willRetry,
    observedAtMs: integer(notice.observedAtMs),
  });
}

function parseTimelineItemV4(value: unknown): ChatTimelineItemV4 {
  const item = exactObject(value, [
    "itemId", "itemOrdinal", "itemType", "phase", "status", "text",
    "reasoningStatus", "reasoningReasonCode", "reasoningParts", "startedAtMs",
    "completedAtMs", "sourceEventId", "sourceSequence", "sourceOccurredAt",
  ]);
  const itemType = plainText(item.itemType, 256);
  const phase = parseAgentMessagePhaseV4(item.phase);
  const status = oneOf(item.status, CHAT_TIMELINE_ITEM_STATUSES_V4);
  const reasoningStatus = nullable(
    item.reasoningStatus,
    (entry) => oneOf(entry, CHAT_REASONING_STATUSES_V4),
  );
  const reasoningReasonCode = nullable(
    item.reasoningReasonCode,
    (entry) => oneOf(entry, CHAT_REASONING_REASON_CODES_V4),
  );
  const reasoningParts = parseReasoningPartsV4(item.reasoningParts);
  const completedAtMs = nullable(item.completedAtMs, (entry) => integer(entry));
  const isAgentMessage = itemType === "agentMessage";
  const isReasoning = itemType === "reasoning";
  const lifecycleConsistent = status === "in_progress"
    ? completedAtMs === null
    : completedAtMs !== null;
  const reasoningConsistent = reasoningStatus === null
    ? reasoningReasonCode === null
    : reasoningStatus === "complete"
      ? reasoningReasonCode === null && reasoningParts.length > 0
      : reasoningStatus === "incomplete"
        ? reasoningReasonCode !== null && reasoningParts.length > 0
        : reasoningReasonCode !== null && reasoningParts.length === 0;
  const semanticFieldsConsistent = isAgentMessage
    ? reasoningStatus === null && reasoningReasonCode === null && reasoningParts.length === 0
    : isReasoning
      ? phase === null && reasoningConsistent
      : phase === null && reasoningStatus === null && reasoningReasonCode === null && reasoningParts.length === 0;
  if (!lifecycleConsistent || !semanticFieldsConsistent) throw new ChatContractError();
  return Object.freeze({
    ...sourceFactV4(item),
    itemId: stringValue(item.itemId, 256),
    itemOrdinal: integer(item.itemOrdinal, 1, 512),
    itemType,
    phase,
    status,
    text: plainText(item.text, 1024 * 1024, true),
    reasoningStatus,
    reasoningReasonCode,
    reasoningParts,
    startedAtMs: integer(item.startedAtMs),
    completedAtMs,
  });
}

function parseHistoryPageV4(value: unknown): ChatHistoryPageV4 {
  const page = exactObject(value, [
    "turns", "nextCursor", "sessionNotices", "durableSequenceCut",
  ]);
  if (!Array.isArray(page.turns) || page.turns.length > 50 ||
      !Array.isArray(page.sessionNotices) || page.sessionNotices.length > 64) {
    throw new ChatContractError();
  }
  const turns = page.turns.map((value): ChatHistoryTurnV4 => {
    const turn = exactObject(value, [
      "turnId", "status", "terminalAt", "reasoningStatus", "reasoningReasonCode",
      "messages", "reasoning", "projectionAuthority", "artifacts", "terminalCode",
      "timelineItems", "plan", "notices",
    ]);
    if (!Array.isArray(turn.messages) || !Array.isArray(turn.reasoning) ||
        !Array.isArray(turn.artifacts) || !Array.isArray(turn.timelineItems) ||
        !Array.isArray(turn.notices) || turn.reasoning.length > 8 ||
        turn.artifacts.length > 12 || turn.timelineItems.length > 512 ||
        turn.notices.length > 64) {
      throw new ChatContractError();
    }
    const artifacts = turn.artifacts.map(parseArtifact);
    if (artifacts.some((artifact, index) => index > 0 && artifacts[index - 1]!.ordinal >= artifact.ordinal)) {
      throw new ChatContractError();
    }
    const timelineItems = turn.timelineItems.map(parseTimelineItemV4);
    if (timelineItems.some((item, index) => index > 0 && timelineItems[index - 1]!.itemOrdinal >= item.itemOrdinal)) {
      throw new ChatContractError();
    }
    const notices = turn.notices.map(parseTimelineNoticeV4);
    if (notices.some((notice) => notice.scope !== "turn" || notice.severity !== "error")) {
      throw new ChatContractError();
    }
    const messages = turn.messages.map(parseMessageV2);
    const projectionAuthority = oneOf(turn.projectionAuthority, ["legacy", "v4"] as const);
    const terminalCode = nullable(turn.terminalCode, safeCode);
    const plan = nullable(turn.plan, (entry) => parsePlanSnapshotV4(entry, false));
    const invalidLegacyFacts = projectionAuthority === "legacy" && (
      timelineItems.length > 0 || plan !== null || notices.length > 0 || terminalCode !== null
    );
    if (invalidLegacyFacts || (
      projectionAuthority === "v4" && (
        messages.some((message) => message.role !== "user") || turn.reasoning.length > 0
      )
    )) {
      throw new ChatContractError();
    }
    return Object.freeze({
      turnId: uuid(turn.turnId),
      status: stringValue(turn.status, 64),
      terminalAt: nullable(turn.terminalAt, (entry) => integer(entry)),
      reasoningStatus: stringValue(turn.reasoningStatus, 64),
      reasoningReasonCode: nullable(turn.reasoningReasonCode, (entry) => stringValue(entry, 128)),
      messages: Object.freeze(messages),
      reasoning: Object.freeze(turn.reasoning.map(parseReasoningMetadata)),
      projectionAuthority,
      artifacts: Object.freeze(artifacts),
      terminalCode,
      timelineItems: Object.freeze(timelineItems),
      plan,
      notices: Object.freeze(notices),
    });
  });
  if (new Set(turns.map((turn) => turn.turnId)).size !== turns.length) throw new ChatContractError();
  const sessionNotices = page.sessionNotices.map(parseTimelineNoticeV4);
  if (sessionNotices.some((notice) => notice.scope !== "session" || notice.severity !== "warning")) {
    throw new ChatContractError();
  }
  return Object.freeze({
    turns: Object.freeze(turns),
    nextCursor: nullable(page.nextCursor, cursor),
    sessionNotices: Object.freeze(sessionNotices),
    durableSequenceCut: durableSequence(page.durableSequenceCut, true),
  });
}

export function parseHistoryPageResponseV4(value: unknown): ChatHistoryPageV4 {
  return responseDataV4(value, parseHistoryPageV4);
}

function parseSafeTextV5(value: unknown, maximumBytes: number): ChatSafeTextV5 {
  const summary = exactObject(value, ["text", "truncated", "truncationReason"]);
  if (typeof summary.truncated !== "boolean") throw new ChatContractError();
  const truncationReason = nullable(
    summary.truncationReason,
    (entry) => oneOf(entry, CHAT_TRUNCATION_REASONS_V5),
  );
  if (summary.truncated !== (truncationReason !== null)) throw new ChatContractError();
  return Object.freeze({
    text: plainText(summary.text, maximumBytes, true),
    truncated: summary.truncated,
    truncationReason,
  });
}

function parseSourceFactObjectV5(value: unknown): ChatSourceFactV5 {
  const source = exactObject(value, ["sourceEventId", "sourceSequence", "sourceOccurredAt"]);
  return sourceFactV4(source);
}

function parseCommandCwdV5(value: unknown): ChatCommandCwdV5 {
  const cwd = exactObject(value, ["kind", "segments"]);
  const kind = oneOf(cwd.kind, ["workspace_root", "workspace_relative", "redacted"] as const);
  if (!Array.isArray(cwd.segments) || cwd.segments.length > 128) {
    throw new ChatContractError();
  }
  const segments = cwd.segments.map((entry) => {
    const segment = plainText(entry, 255);
    const hasUnsafeControl = [...segment].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x061c || codePoint === 0x200e || codePoint === 0x200f ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069);
    });
    if (hasUnsafeControl || !SAFE_CWD_SEGMENT_PATTERN.test(segment)) {
      throw new ChatContractError();
    }
    return segment;
  });
  const totalBytes = segments.reduce(
    (total, segment, index) => total + new TextEncoder().encode(segment).length + (index === 0 ? 0 : 1),
    0,
  );
  if (
    totalBytes > 1024 ||
    (kind === "workspace_relative" ? segments.length === 0 : segments.length !== 0)
  ) {
    throw new ChatContractError();
  }
  return Object.freeze({ kind, segments: Object.freeze(segments) });
}

function parseExecutionErrorV5(
  value: unknown,
  allowedCodes: readonly string[],
): ChatExecutionErrorV5 {
  const error = exactObject(value, ["code", "summary"]);
  if (typeof error.code !== "string" || !allowedCodes.includes(error.code)) {
    throw new ChatContractError();
  }
  return Object.freeze({
    code: error.code as ChatExecutionErrorV5["code"],
    summary: plainText(error.summary, 4 * 1024, true),
  });
}

function parseCommandOutputV5(value: unknown): ChatCommandOutputV5 {
  const output = exactObject(value, [
    "retention", "text", "head", "tail", "reason", "truncated", "truncationReason",
  ]);
  const retention = oneOf(output.retention, ["complete", "head_tail", "unavailable"] as const);
  if (typeof output.truncated !== "boolean") throw new ChatContractError();
  const text = nullable(output.text, (entry) => plainText(entry, 256 * 1024, true));
  const head = nullable(output.head, (entry) => plainText(entry, 128 * 1024, true));
  const tail = nullable(output.tail, (entry) => plainText(entry, 128 * 1024, true));
  const reason = nullable(output.reason, (entry) => oneOf(entry, ["not_available"] as const));
  const truncationReason = nullable(
    output.truncationReason,
    (entry) => oneOf(entry, CHAT_TRUNCATION_REASONS_V5),
  );
  const headTailBytes = head === null || tail === null
    ? 0
    : new TextEncoder().encode(head).length + new TextEncoder().encode(tail).length;
  const consistent =
    (retention === "complete" && text !== null && head === null && tail === null &&
      reason === null && output.truncated === false && truncationReason === null) ||
    (retention === "head_tail" && text === null && head !== null && tail !== null &&
      reason === null && output.truncated === true && truncationReason !== null &&
      headTailBytes <= 256 * 1024) ||
    (retention === "unavailable" && text === null && head === null && tail === null &&
      reason === "not_available" && output.truncated === false && truncationReason === null);
  if (!consistent) throw new ChatContractError();
  return Object.freeze({
    retention,
    text,
    head,
    tail,
    reason,
    truncated: output.truncated,
    truncationReason,
  });
}

function parseToolIdentityV5(value: unknown): ChatToolIdentityV5 {
  const identity = exactObject(value, ["resolution", "serverName", "toolName"]);
  const resolution = oneOf(identity.resolution, ["known", "unknown"] as const);
  const serverName = plainText(identity.serverName, 256);
  const toolName = plainText(identity.toolName, 256);
  if (resolution === "unknown" && (serverName !== "unknown" || toolName !== "unknown")) {
    throw new ChatContractError();
  }
  return Object.freeze({ resolution, serverName, toolName });
}

function parseCommandExecutionV5(value: unknown): ChatCommandExecutionV5 {
  const execution = exactObject(value, [
    "kind", "status", "startedSource", "lastSource", "commandSummary", "cwd",
    "liveOutput", "output", "durationMs", "exitCode", "error",
  ]);
  if (execution.kind !== "command") throw new ChatContractError();
  const status = oneOf(
    execution.status,
    ["running", "completed", "failed", "declined", "incomplete"] as const,
  );
  const liveOutput = nullable(
    execution.liveOutput,
    (entry) => parseSafeTextV5(entry, 256 * 1024),
  );
  const output = nullable(execution.output, parseCommandOutputV5);
  const durationMs = nullable(execution.durationMs, (entry) => integer(entry));
  const exitCode = nullable(
    execution.exitCode,
    (entry) => integer(entry, -2_147_483_648, 2_147_483_647),
  );
  const error = nullable(
    execution.error,
    (entry) => parseExecutionErrorV5(entry, CHAT_COMMAND_ERROR_CODES_V5),
  );
  const terminalConsistent = status === "completed"
    ? output !== null && error === null
    : status === "failed"
      ? output !== null && error !== null && error.code !== "command_declined"
      : status === "declined"
        ? output !== null && error?.code === "command_declined"
        : output === null && durationMs === null && exitCode === null && error === null;
  if (!terminalConsistent) throw new ChatContractError();
  return Object.freeze({
    kind: "command",
    status,
    startedSource: parseSourceFactObjectV5(execution.startedSource),
    lastSource: parseSourceFactObjectV5(execution.lastSource),
    commandSummary: parseSafeTextV5(execution.commandSummary, 4 * 1024),
    cwd: parseCommandCwdV5(execution.cwd),
    liveOutput,
    output,
    durationMs,
    exitCode,
    error,
  });
}

function parseToolProgressHistoryV5(value: unknown): ChatToolProgressV5 {
  const progress = exactObject(value, [
    "sourceEventId", "sourceSequence", "sourceOccurredAt", "progressIndex", "summary",
  ]);
  return Object.freeze({
    ...sourceFactV4(progress),
    progressIndex: integer(progress.progressIndex, 0, 31),
    summary: parseSafeTextV5(progress.summary, 4 * 1024),
  });
}

function parseToolExecutionV5(value: unknown): ChatToolExecutionV5 {
  const execution = exactObject(value, [
    "kind", "status", "startedSource", "lastSource", "identity", "argumentsSummary",
    "progress", "durationMs", "resultSummary", "error",
  ]);
  if (execution.kind !== "tool" || !Array.isArray(execution.progress) || execution.progress.length > 32) {
    throw new ChatContractError();
  }
  const status = oneOf(
    execution.status,
    ["in_progress", "completed", "failed", "declined", "incomplete"] as const,
  );
  let progressBytes = 0;
  const progress = execution.progress.map((entry, index) => {
    const parsed = parseToolProgressHistoryV5(entry);
    if (parsed.progressIndex !== index) throw new ChatContractError();
    progressBytes += new TextEncoder().encode(parsed.summary.text).length;
    return parsed;
  });
  if (progressBytes > 64 * 1024) throw new ChatContractError();
  const durationMs = nullable(execution.durationMs, (entry) => integer(entry));
  const resultSummary = nullable(
    execution.resultSummary,
    (entry) => parseSafeTextV5(entry, 64 * 1024),
  );
  const error = nullable(
    execution.error,
    (entry) => parseExecutionErrorV5(entry, CHAT_TOOL_ERROR_CODES_V5),
  );
  const terminalConsistent = status === "completed"
    ? resultSummary !== null && error === null
    : status === "failed"
      ? error !== null && error.code !== "tool_declined"
      : status === "declined"
        ? resultSummary === null && error?.code === "tool_declined"
        : durationMs === null && resultSummary === null && error === null;
  if (!terminalConsistent) throw new ChatContractError();
  return Object.freeze({
    kind: "tool",
    status,
    startedSource: parseSourceFactObjectV5(execution.startedSource),
    lastSource: parseSourceFactObjectV5(execution.lastSource),
    identity: parseToolIdentityV5(execution.identity),
    argumentsSummary: parseSafeTextV5(execution.argumentsSummary, 8 * 1024),
    progress: Object.freeze(progress),
    durationMs,
    resultSummary,
    error,
  });
}

function parseExecutionV5(value: unknown): ChatExecutionV5 | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new ChatContractError();
  return value.kind === "command"
    ? parseCommandExecutionV5(value)
    : value.kind === "tool"
      ? parseToolExecutionV5(value)
      : (() => { throw new ChatContractError(); })();
}

const CHAT_TIMELINE_ITEM_TYPES_V5 = Object.freeze([
  "agentMessage", "reasoning", "command", "tool", "userMessage", "hookPrompt",
  "collabAgentToolCall", "subAgentActivity", "webSearch", "imageView", "sleep",
  "imageGeneration", "enteredReviewMode", "exitedReviewMode", "contextCompaction",
] as const);

const CHAT_GENERIC_LIFECYCLE_ITEM_TYPES_V5: ReadonlySet<string> = new Set([
  "agentMessage", "reasoning", "userMessage", "hookPrompt", "collabAgentToolCall",
  "subAgentActivity", "webSearch", "imageView", "sleep", "imageGeneration",
  "enteredReviewMode", "exitedReviewMode", "contextCompaction",
]);

function parseTimelineItemV5(value: unknown): ChatTimelineItemV5 {
  const item = exactObject(value, [
    "itemId", "itemOrdinal", "itemType", "phase", "status", "text",
    "reasoningStatus", "reasoningReasonCode", "reasoningParts", "startedAtMs",
    "completedAtMs", "sourceEventId", "sourceSequence", "sourceOccurredAt", "execution",
  ]);
  const itemType = oneOf(item.itemType, CHAT_TIMELINE_ITEM_TYPES_V5);
  const phase = parseAgentMessagePhaseV4(item.phase);
  const status = oneOf(item.status, CHAT_TIMELINE_ITEM_STATUSES_V4);
  const reasoningStatus = nullable(
    item.reasoningStatus,
    (entry) => oneOf(entry, CHAT_REASONING_STATUSES_V4),
  );
  const reasoningReasonCode = nullable(
    item.reasoningReasonCode,
    (entry) => oneOf(entry, CHAT_REASONING_REASON_CODES_V4),
  );
  const reasoningParts = parseReasoningPartsV4(item.reasoningParts);
  const completedAtMs = nullable(item.completedAtMs, (entry) => integer(entry));
  const execution = parseExecutionV5(item.execution);
  const lifecycleConsistent = status === "in_progress"
    ? completedAtMs === null
    : completedAtMs !== null;
  const reasoningConsistent = reasoningStatus === null
    ? reasoningReasonCode === null
    : reasoningStatus === "complete"
      ? reasoningReasonCode === null && reasoningParts.length > 0
      : reasoningStatus === "incomplete"
        ? reasoningReasonCode !== null && reasoningParts.length > 0
        : reasoningReasonCode !== null && reasoningParts.length === 0;
  const executionLifecycleConsistent = execution === null || (
    execution.status === "running" || execution.status === "in_progress"
      ? status === "in_progress"
      : execution.status === "incomplete"
        ? status === "incomplete"
        : status === "completed"
  );
  const semanticFieldsConsistent = itemType === "agentMessage"
    ? phase !== undefined && reasoningStatus === null && reasoningReasonCode === null &&
      reasoningParts.length === 0 && execution === null
    : itemType === "reasoning"
      ? phase === null && reasoningConsistent && execution === null
      : itemType === "command"
        ? phase === null && reasoningStatus === null && reasoningReasonCode === null &&
          reasoningParts.length === 0 && execution?.kind === "command" && item.text === ""
        : itemType === "tool"
          ? phase === null && reasoningStatus === null && reasoningReasonCode === null &&
            reasoningParts.length === 0 && execution?.kind === "tool" && item.text === ""
          : phase === null && reasoningStatus === null && reasoningReasonCode === null &&
            reasoningParts.length === 0 && execution === null && item.text === "";
  if (!lifecycleConsistent || !executionLifecycleConsistent || !semanticFieldsConsistent) {
    throw new ChatContractError();
  }
  return Object.freeze({
    ...sourceFactV4(item),
    itemId: itemIdV5(item.itemId),
    itemOrdinal: integer(item.itemOrdinal, 1, 512),
    itemType,
    phase,
    status,
    text: plainText(item.text, 1024 * 1024, true),
    reasoningStatus,
    reasoningReasonCode,
    reasoningParts,
    startedAtMs: integer(item.startedAtMs),
    completedAtMs,
    execution,
  });
}

function parseHistoryPageV5(value: unknown): ChatHistoryPageV5 {
  const page = exactObject(value, [
    "turns", "nextCursor", "sessionNotices", "durableSequenceCut",
  ]);
  if (!Array.isArray(page.turns) || page.turns.length > 50 ||
      !Array.isArray(page.sessionNotices) || page.sessionNotices.length > 64) {
    throw new ChatContractError();
  }
  const turns = page.turns.map((value): ChatHistoryTurnV4 | ChatHistoryTurnV5 => {
    if (isRecord(value) &&
        (value.projectionAuthority === "legacy" || value.projectionAuthority === "v4")) {
      // A v5 response can page across pre-v5 Turns. Keep those Turns on the
      // existing closed v4 decoder; in particular, execution remains forbidden.
      return parseHistoryPageV4({
        turns: [value],
        nextCursor: null,
        sessionNotices: [],
        durableSequenceCut: "0",
      }).turns[0]!;
    }
    const turn = exactObject(value, [
      "turnId", "status", "terminalAt", "reasoningStatus", "reasoningReasonCode",
      "messages", "reasoning", "projectionAuthority", "artifacts", "terminalCode",
      "timelineItems", "plan", "notices",
    ]);
    if (!Array.isArray(turn.messages) || !Array.isArray(turn.reasoning) ||
        !Array.isArray(turn.artifacts) || !Array.isArray(turn.timelineItems) ||
        !Array.isArray(turn.notices) || turn.reasoning.length > 8 ||
        turn.artifacts.length > 12 || turn.timelineItems.length > 512 ||
        turn.notices.length > 64) {
      throw new ChatContractError();
    }
    const artifacts = turn.artifacts.map(parseArtifactV5);
    if (artifacts.some((artifact, index) => index > 0 && artifacts[index - 1]!.ordinal >= artifact.ordinal)) {
      throw new ChatContractError();
    }
    const timelineItems = turn.timelineItems.map(parseTimelineItemV5);
    if (timelineItems.some((item, index) => index > 0 && timelineItems[index - 1]!.itemOrdinal >= item.itemOrdinal)) {
      throw new ChatContractError();
    }
    const notices = turn.notices.map(parseTimelineNoticeV4);
    if (notices.some((notice) => notice.scope !== "turn" || notice.severity !== "error")) {
      throw new ChatContractError();
    }
    const messages = turn.messages.map(parseMessageV2);
    if (turn.projectionAuthority !== "v5" || messages.some((message) => message.role !== "user") ||
        turn.reasoning.length !== 0) {
      throw new ChatContractError();
    }
    return Object.freeze({
      turnId: uuid(turn.turnId),
      status: stringValue(turn.status, 64),
      terminalAt: nullable(turn.terminalAt, (entry) => integer(entry)),
      reasoningStatus: stringValue(turn.reasoningStatus, 64),
      reasoningReasonCode: nullable(turn.reasoningReasonCode, (entry) => stringValue(entry, 128)),
      messages: Object.freeze(messages),
      reasoning: Object.freeze([]),
      projectionAuthority: "v5",
      artifacts: Object.freeze(artifacts),
      terminalCode: nullable(turn.terminalCode, safeCode),
      timelineItems: Object.freeze(timelineItems),
      plan: nullable(turn.plan, (entry) => parsePlanSnapshotV4(entry, false)),
      notices: Object.freeze(notices),
    });
  });
  if (new Set(turns.map((turn) => turn.turnId)).size !== turns.length) throw new ChatContractError();
  const sessionNotices = page.sessionNotices.map(parseTimelineNoticeV4);
  if (sessionNotices.some((notice) => notice.scope !== "session" || notice.severity !== "warning")) {
    throw new ChatContractError();
  }
  return Object.freeze({
    schemaVersion: CHAT_IPC_V5_SCHEMA_VERSION,
    turns: Object.freeze(turns),
    nextCursor: nullable(page.nextCursor, cursor),
    sessionNotices: Object.freeze(sessionNotices),
    durableSequenceCut: durableSequence(page.durableSequenceCut, true),
  });
}

export function parseHistoryPageResponseV5(value: unknown): ChatHistoryPageV5 {
  return responseDataV5(value, parseHistoryPageV5);
}

export function parseReasoningResponse(value: unknown): readonly ChatReasoningItem[] {
  return responseData(value, (data) => {
    if (!Array.isArray(data) || data.length > 8) throw new ChatContractError();
    let totalBytes = 0;
    const items = data.map((value): ChatReasoningItem => {
      const item = exactObject(value, ["itemOrdinal", "status", "reasonCode", "finalizedAtMs", "parts"]);
      if (!Array.isArray(item.parts) || item.parts.length > 8) throw new ChatContractError();
      const parts = item.parts.map((value): ChatReasoningPart => {
        const part = exactObject(value, ["contentIndex", "text"]);
        const text = plainText(part.text, 64 * 1024, true);
        totalBytes += new TextEncoder().encode(text).length;
        return Object.freeze({ contentIndex: integer(part.contentIndex, 0, 7), text });
      });
      return Object.freeze({
        itemOrdinal: integer(item.itemOrdinal, 0, 7),
        status: oneOf(item.status, ["complete", "incomplete", "unavailable"] as const),
        reasonCode: nullable(item.reasonCode, (entry) => stringValue(entry, 128)),
        finalizedAtMs: integer(item.finalizedAtMs),
        parts: Object.freeze(parts),
      });
    });
    if (totalBytes > 256 * 1024) throw new ChatContractError();
    return Object.freeze(items);
  });
}

function parseCleanup(value: unknown): ChatCleanupStatus {
  const status = exactObject(value, [
    "operationId", "desktopState", "hostState", "runtimeState", "outcomeCode", "lastErrorCode",
    "requestedAt", "completedAt", "expiresAt",
  ]);
  const state = (entry: unknown) => oneOf(entry, ["pending", "complete", "incomplete", "not_attempted"] as const);
  return Object.freeze({
    operationId: uuid(status.operationId),
    desktopState: state(status.desktopState),
    hostState: state(status.hostState),
    runtimeState: state(status.runtimeState),
    outcomeCode: stringValue(status.outcomeCode, 128),
    lastErrorCode: nullable(status.lastErrorCode, (entry) => stringValue(entry, 128)),
    requestedAt: integer(status.requestedAt),
    completedAt: nullable(status.completedAt, (entry) => integer(entry)),
    expiresAt: nullable(status.expiresAt, (entry) => integer(entry)),
  });
}

export function parseCleanupResponse(value: unknown): ChatCleanupStatus {
  return responseData(value, parseCleanup);
}

export function parseOptionalCleanupResponse(value: unknown): ChatCleanupStatus | null {
  return responseData(value, (data) => nullable(data, parseCleanup));
}

export function parseOperationResponse(value: unknown): string {
  return responseData(value, (data) => uuid(exactObject(data, ["operationId"]).operationId));
}

export function parseOperationResponseV2(value: unknown): string {
  return responseDataV2(value, (data) => uuid(exactObject(data, ["operationId"]).operationId));
}

function parseCreatedTurn(value: unknown): ChatCreatedTurn {
  const created = exactObject(value, ["sessionId", "turnId", "operationId"]);
  return Object.freeze({
    sessionId: uuid(created.sessionId),
    turnId: uuid(created.turnId),
    operationId: uuid(created.operationId),
  });
}

export function parseCreatedTurnResponse(value: unknown): ChatCreatedTurn {
  return responseData(value, parseCreatedTurn);
}

export function parseCreatedTurnResponseV2(value: unknown): ChatCreatedTurn {
  return responseDataV2(value, parseCreatedTurn);
}

function parseSessionControlPlane(value: unknown): ChatSessionControlPlane {
  const body = exactObject(value, ["sessionId", "state", "issueCode", "retryable", "recovery"]);
  if (typeof body.retryable !== "boolean") throw new ChatContractError();
  const result: ChatSessionControlPlane = Object.freeze({
    sessionId: uuid(body.sessionId),
    state: oneOf(body.state, CHAT_CONTROL_PLANE_STATES),
    issueCode: nullable(body.issueCode, (entry) => oneOf(entry, CHAT_CONTROL_PLANE_ISSUES)),
    retryable: body.retryable,
    recovery: oneOf(body.recovery, CHAT_CONTROL_PLANE_RECOVERIES),
  });
  const consistent =
    ((result.state === "pending" || result.state === "bound") &&
      result.issueCode === null && !result.retryable && result.recovery === "none") ||
    (result.state === "blocked_auth" && result.issueCode === "chat_unauthenticated" &&
      !result.retryable && result.recovery === "sign_in") ||
    (result.state === "retry_wait" && result.issueCode === "chat_temporarily_unavailable" &&
      result.retryable && result.recovery === "retry") ||
    (result.state === "denied" && result.issueCode === "chat_capability_denied" &&
      !result.retryable && result.recovery === "none") ||
    (result.state === "failed" &&
      (result.issueCode === "chat_conflict" || result.issueCode === "chat_protocol_error") &&
      !result.retryable && result.recovery === "resync");
  if (!consistent) throw new ChatContractError();
  return result;
}

export function parseSessionControlPlaneResponse(value: unknown): ChatSessionControlPlane {
  return responseData(value, parseSessionControlPlane);
}

export function parseControlPlaneEvent(value: unknown): ChatControlPlaneEvent {
  const event = exactObject(value, [
    "schemaVersion", "sequence", "sessionId", "state", "issueCode", "retryable", "recovery",
  ]);
  if (event.schemaVersion !== CHAT_IPC_SCHEMA_VERSION ||
      typeof event.sequence !== "string" || !SEQUENCE_PATTERN.test(event.sequence)) {
    throw new ChatContractError();
  }
  const sequence = BigInt(event.sequence);
  if (sequence === 0n || sequence > MAX_SAFE_EVENT_SEQUENCE) throw new ChatContractError();
  return Object.freeze({
    schemaVersion: 1,
    sequence: event.sequence,
    ...parseSessionControlPlane({
      sessionId: event.sessionId,
      state: event.state,
      issueCode: event.issueCode,
      retryable: event.retryable,
      recovery: event.recovery,
    }),
  });
}

export function parseLocalReadinessResponse(value: unknown): ChatLocalReadiness {
  return responseData(value, (data) => {
    const body = exactObject(
      data,
      ["lifecycle", "host", "runtime", "storage", "canSend", "issueCode", "retryable", "recovery"],
      ["retryAfterMs"],
    );
    if (typeof body.canSend !== "boolean" || typeof body.retryable !== "boolean") {
      throw new ChatContractError();
    }
    const result: ChatLocalReadiness = Object.freeze({
      lifecycle: oneOf(body.lifecycle, ["starting", "ready", "blocked", "recovering"] as const),
      host: oneOf(body.host, ["starting", "ready", "unavailable"] as const),
      runtime: oneOf(body.runtime, ["starting", "ready", "unavailable", "version_mismatch"] as const),
      storage: oneOf(body.storage, ["ready", "read_only", "full", "corrupt", "migration_failed", "unavailable"] as const),
      canSend: body.canSend,
      issueCode: nullable(body.issueCode, (entry) => oneOf(entry, CHAT_READINESS_ISSUE_CODES)),
      retryable: body.retryable,
      recovery: oneOf(body.recovery, CHAT_READINESS_RECOVERIES),
      ...(body.retryAfterMs === undefined ? {} : { retryAfterMs: integer(body.retryAfterMs, 0, 60_000) }),
    });
    const allReady = result.host === "ready" && result.runtime === "ready" && result.storage === "ready";
    if (
      result.canSend !== allReady ||
      (result.canSend && (result.lifecycle !== "ready" || result.issueCode !== null || result.recovery !== "none")) ||
      (!result.canSend && result.issueCode === null)
    ) {
      throw new ChatContractError();
    }
    return result;
  });
}

export function parseSubscriptionResponse(value: unknown): string {
  return responseData(value, (data) => uuid(exactObject(data, ["subscriptionId"]).subscriptionId));
}

export function parseSubscriptionResponseV4(value: unknown): string {
  return responseDataV4(value, (data) => uuid(exactObject(data, ["subscriptionId"]).subscriptionId));
}

export function parseSubscriptionResponseV5(value: unknown): string {
  return responseDataV5(value, (data) => uuid(exactObject(data, ["subscriptionId"]).subscriptionId));
}

export function parseCancelledResponse(value: unknown): boolean {
  return responseData(value, (data) => {
    const body = exactObject(data, ["cancelled"]);
    if (typeof body.cancelled !== "boolean") throw new ChatContractError();
    return body.cancelled;
  });
}

export function parseResyncResponse(value: unknown): ChatResyncProjection {
  return responseData(value, (data) => {
    const projection = exactObject(data, ["session", "history", "cleanup"]);
    return Object.freeze({
      session: parseSession(projection.session),
      history: parseHistoryPage(projection.history),
      cleanup: nullable(projection.cleanup, parseCleanup),
    });
  });
}

export function parseResyncResponseV2(value: unknown): ChatResyncProjection {
  return responseDataV2(value, (data) => {
    const projection = exactObject(data, ["session", "history", "cleanup"]);
    return Object.freeze({
      session: parseSession(projection.session),
      history: parseHistoryPageV2(projection.history),
      cleanup: nullable(projection.cleanup, parseCleanup),
    });
  });
}

export function parseResyncResponseV4(value: unknown): ChatResyncProjectionV4 {
  return responseDataV4(value, (data) => {
    const projection = exactObject(data, ["session", "history", "cleanup"]);
    return Object.freeze({
      session: parseSession(projection.session),
      history: parseHistoryPageV4(projection.history),
      cleanup: nullable(projection.cleanup, parseCleanup),
    });
  });
}

export function parseResyncResponseV5(value: unknown): ChatResyncProjectionV5 {
  return responseDataV5(value, (data) => {
    const projection = exactObject(data, ["session", "history", "cleanup"]);
    return Object.freeze({
      session: parseSession(projection.session),
      history: parseHistoryPageV5(projection.history),
      cleanup: nullable(projection.cleanup, parseCleanup),
    });
  });
}

function parseEventPayload(kind: ChatEventKind, value: unknown): ChatProjectionEvent["payload"] {
  switch (kind) {
    case "assistant_append": {
      const payload = exactObject(value, ["text"]);
      return Object.freeze({ text: plainText(payload.text, 64 * 1024) });
    }
    case "reasoning_append": {
      const payload = exactObject(value, ["itemOrdinal", "contentIndex", "text"]);
      return Object.freeze({
        itemOrdinal: integer(payload.itemOrdinal, 0, 7),
        contentIndex: integer(payload.contentIndex, 0, 7),
        text: plainText(payload.text, 16 * 1024),
      });
    }
    case "turn_state":
    case "turn_terminal": {
      const payload = exactObject(value, ["status"]);
      const allowed = kind === "turn_state"
        ? ["streaming", "stopping"] as const
        : ["completed", "interrupted", "failed"] as const;
      return Object.freeze({ status: oneOf(payload.status, allowed) });
    }
    case "resync_required":
    case "context_invalidated": {
      const payload = exactObject(value, ["reason"]);
      const allowed = kind === "context_invalidated"
        ? ["authority_changed"] as const
        : ["backpressure", "sequence_gap", "protocol_error"] as const;
      return Object.freeze({ reason: oneOf(payload.reason, allowed) });
    }
    case "cleanup_state": {
      const payload = exactObject(value, ["operationId", "state"]);
      return Object.freeze({
        operationId: uuid(payload.operationId),
        state: oneOf(payload.state, ["pending", "retry_scheduled", "complete"] as const),
      });
    }
  }
}

export function parseChatProjectionEvent(value: unknown): ChatProjectionEvent {
  const event = exactObject(
    value,
    ["schemaVersion", "subscriptionId", "contextId", "sessionId", "projectionSequence", "eventId", "kind", "payload"],
    ["turnId"],
  );
  if (event.schemaVersion !== CHAT_IPC_SCHEMA_VERSION || typeof event.projectionSequence !== "string" || !SEQUENCE_PATTERN.test(event.projectionSequence)) {
    throw new ChatContractError();
  }
  const sequence = BigInt(event.projectionSequence);
  if (sequence > MAX_SAFE_EVENT_SEQUENCE) throw new ChatContractError();
  const kind = oneOf(event.kind, [
    "assistant_append", "reasoning_append", "turn_state", "turn_terminal", "cleanup_state", "resync_required", "context_invalidated",
  ] as const);
  return Object.freeze({
    schemaVersion: 1,
    subscriptionId: uuid(event.subscriptionId),
    contextId: uuid(event.contextId),
    sessionId: uuid(event.sessionId),
    ...(event.turnId === undefined ? {} : { turnId: uuid(event.turnId) }),
    projectionSequence: event.projectionSequence,
    eventId: uuid(event.eventId),
    kind,
    payload: parseEventPayload(kind, event.payload),
  }) as ChatProjectionEvent;
}

function itemIdForEvent(value: unknown, v5Lengths: boolean): string {
  return v5Lengths ? itemIdV5(value) : stringValue(value, 256);
}

function parseItemLifecyclePayloadV4(
  value: unknown,
  v5Lengths = false,
): ChatItemLifecyclePayloadV4 {
  const payload = exactObject(value, [
    "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
    "itemType", "phase", "text",
  ]);
  const itemType = plainText(payload.itemType, 256);
  const phase = parseAgentMessagePhaseV4(payload.phase);
  const text = nullable(payload.text, (entry) => plainText(entry, 1024 * 1024, true));
  if (itemType === "agentMessage" ? text === null : phase !== null || text !== null) {
    throw new ChatContractError();
  }
  return Object.freeze({
    ...sourceFactV4(payload),
    itemId: itemIdForEvent(payload.itemId, v5Lengths),
    itemOrdinal: integer(payload.itemOrdinal, 1, 512),
    itemType,
    phase,
    text,
  });
}

function parseEventPayloadV4(
  kind: ChatEventKindV4,
  value: unknown,
  v5Lengths = false,
): ChatProjectionEventV4["payload"] {
  switch (kind) {
    case "turn_started": {
      const payload = exactObject(value, ["sourceEventId", "sourceSequence", "sourceOccurredAt"]);
      return sourceFactV4(payload);
    }
    case "plan_updated":
      return parsePlanSnapshotV4(value, true);
    case "item_started":
    case "item_completed":
      return parseItemLifecyclePayloadV4(value, v5Lengths);
    case "agent_message_append": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
        "phase", "text",
      ]);
      return Object.freeze({
        ...sourceFactV4(payload),
        itemId: itemIdForEvent(payload.itemId, v5Lengths),
        itemOrdinal: integer(payload.itemOrdinal, 1, 512),
        phase: parseAgentMessagePhaseV4(payload.phase),
        text: plainText(payload.text, 1024 * 1024),
      });
    }
    case "reasoning_append": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
        "contentIndex", "text",
      ]);
      return Object.freeze({
        ...sourceFactV4(payload),
        itemId: itemIdForEvent(payload.itemId, v5Lengths),
        itemOrdinal: integer(payload.itemOrdinal, 1, 512),
        contentIndex: integer(payload.contentIndex, 0, 7),
        text: plainText(payload.text, 16 * 1024),
      });
    }
    case "reasoning_finalized": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
        "status", "reasonCode", "parts",
      ]);
      const status = oneOf(payload.status, CHAT_REASONING_STATUSES_V4);
      const reasonCode = nullable(
        payload.reasonCode,
        (entry) => oneOf(entry, CHAT_REASONING_REASON_CODES_V4),
      );
      const parts = parseReasoningPartsV4(payload.parts);
      const consistent =
        (status === "complete" && reasonCode === null && parts.length > 0) ||
        (status === "incomplete" && reasonCode !== null && parts.length > 0) ||
        (status === "unavailable" && reasonCode !== null && parts.length === 0);
      if (!consistent) throw new ChatContractError();
      return Object.freeze({
        ...sourceFactV4(payload),
        itemId: itemIdForEvent(payload.itemId, v5Lengths),
        itemOrdinal: integer(payload.itemOrdinal, 1, 512),
        status,
        reasonCode,
        parts,
      });
    }
    case "notice": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "scope", "severity",
        "code", "willRetry",
      ]);
      if (typeof payload.willRetry !== "boolean") throw new ChatContractError();
      const scope = oneOf(payload.scope, ["session", "turn"] as const);
      const severity = oneOf(payload.severity, ["warning", "error"] as const);
      if ((scope === "session") !== (severity === "warning")) throw new ChatContractError();
      return Object.freeze({
        ...sourceFactV4(payload),
        scope,
        severity,
        code: nullable(payload.code, safeCode),
        willRetry: payload.willRetry,
      });
    }
    case "turn_terminal": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "status", "code",
        "unfinishedReasoningReasonCode",
      ]);
      return Object.freeze({
        ...sourceFactV4(payload),
        status: oneOf(payload.status, ["completed", "interrupted", "failed"] as const),
        code: nullable(payload.code, safeCode),
        unfinishedReasoningReasonCode: nullable(
          payload.unfinishedReasoningReasonCode,
          (entry) => oneOf(entry, CHAT_REASONING_REASON_CODES_V4),
        ),
      });
    }
    case "resync_required":
    case "context_invalidated": {
      const payload = exactObject(value, ["reason"]);
      const allowed = kind === "context_invalidated"
        ? ["authority_changed"] as const
        : ["backpressure", "sequence_gap", "protocol_error"] as const;
      return Object.freeze({ reason: oneOf(payload.reason, allowed) });
    }
  }
}

function parseChatProjectionEventV4Internal(
  value: unknown,
  v5Lengths: boolean,
): ChatProjectionEventV4 {
  const event = exactObject(
    value,
    ["schemaVersion", "subscriptionId", "contextId", "sessionId", "projectionSequence", "eventId", "kind", "payload"],
    ["turnId", "durableSequence"],
  );
  if (event.schemaVersion !== CHAT_IPC_V4_SCHEMA_VERSION ||
      typeof event.projectionSequence !== "string" ||
      !SEQUENCE_PATTERN.test(event.projectionSequence)) {
    throw new ChatContractError();
  }
  const projectionSequence = BigInt(event.projectionSequence);
  if (projectionSequence > MAX_SAFE_EVENT_SEQUENCE) throw new ChatContractError();
  const kind = oneOf(event.kind, [
    "turn_started", "plan_updated", "item_started", "item_completed",
    "agent_message_append", "reasoning_append", "reasoning_finalized", "notice",
    "turn_terminal", "resync_required", "context_invalidated",
  ] as const);
  const turnId = event.turnId === undefined ? undefined : uuid(event.turnId);
  const payload = parseEventPayloadV4(kind, event.payload, v5Lengths);
  const noticeScope = kind === "notice"
    ? (payload as Omit<ChatTimelineNoticeV4, "observedAtMs">).scope
    : null;
  const requiresTurn = [
    "turn_started", "plan_updated", "item_started", "item_completed",
    "agent_message_append", "reasoning_append", "reasoning_finalized", "turn_terminal",
  ].includes(kind) || noticeScope === "turn";
  const forbidsTurn = noticeScope === "session" ||
    kind === "context_invalidated";
  const semantic = kind !== "resync_required" && kind !== "context_invalidated";
  if ((requiresTurn && turnId === undefined) || (forbidsTurn && turnId !== undefined)) {
    throw new ChatContractError();
  }
  if ((semantic && event.durableSequence === undefined) ||
      (!semantic && event.durableSequence !== undefined)) {
    throw new ChatContractError();
  }
  return Object.freeze({
    schemaVersion: 4,
    subscriptionId: uuid(event.subscriptionId),
    contextId: uuid(event.contextId),
    sessionId: uuid(event.sessionId),
    ...(turnId === undefined ? {} : { turnId }),
    projectionSequence: event.projectionSequence,
    eventId: uuid(event.eventId),
    ...(semantic ? { durableSequence: durableSequence(event.durableSequence, false) } : {}),
    kind,
    payload,
  }) as ChatProjectionEventV4;
}

export function parseChatProjectionEventV4(value: unknown): ChatProjectionEventV4 {
  return parseChatProjectionEventV4Internal(value, false);
}

function executionItemFieldsV5(value: Record<string, unknown>) {
  return {
    ...sourceFactV4(value),
    itemId: itemIdV5(value.itemId),
    itemOrdinal: integer(value.itemOrdinal, 1, 512),
  } as const;
}

function parseExecutionEventPayloadV5(
  kind: Exclude<ChatEventKindV5, ChatEventKindV4>,
  value: unknown,
): ChatExecutionProjectionEventV5["payload"] {
  switch (kind) {
    case "command_started": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
        "status", "commandSummary", "cwd",
      ]);
      if (payload.status !== "running") throw new ChatContractError();
      return Object.freeze({
        ...executionItemFieldsV5(payload),
        status: "running",
        commandSummary: parseSafeTextV5(payload.commandSummary, 4 * 1024),
        cwd: parseCommandCwdV5(payload.cwd),
      });
    }
    case "command_output_append": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
        "text", "truncated", "truncationReason",
      ]);
      if (typeof payload.truncated !== "boolean") throw new ChatContractError();
      const truncationReason = nullable(
        payload.truncationReason,
        (entry) => oneOf(entry, CHAT_TRUNCATION_REASONS_V5),
      );
      if (payload.truncated !== (truncationReason !== null)) throw new ChatContractError();
      return Object.freeze({
        ...executionItemFieldsV5(payload),
        text: plainText(payload.text, 16 * 1024),
        truncated: payload.truncated,
        truncationReason,
      });
    }
    case "command_completed": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
        "status", "commandSummary", "cwd", "durationMs", "exitCode", "output", "error",
      ]);
      const status = oneOf(payload.status, ["completed", "failed", "declined"] as const);
      const error = nullable(
        payload.error,
        (entry) => parseExecutionErrorV5(entry, CHAT_COMMAND_ERROR_CODES_V5),
      );
      if (
        (status === "completed" && error !== null) ||
        (status === "failed" && (error === null || error.code === "command_declined")) ||
        (status === "declined" && error?.code !== "command_declined")
      ) {
        throw new ChatContractError();
      }
      return Object.freeze({
        ...executionItemFieldsV5(payload),
        status,
        commandSummary: parseSafeTextV5(payload.commandSummary, 4 * 1024),
        cwd: parseCommandCwdV5(payload.cwd),
        durationMs: nullable(payload.durationMs, (entry) => integer(entry)),
        exitCode: nullable(
          payload.exitCode,
          (entry) => integer(entry, -2_147_483_648, 2_147_483_647),
        ),
        output: parseCommandOutputV5(payload.output),
        error,
      });
    }
    case "tool_started": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
        "status", "identity", "argumentsSummary",
      ]);
      if (payload.status !== "in_progress") throw new ChatContractError();
      return Object.freeze({
        ...executionItemFieldsV5(payload),
        status: "in_progress",
        identity: parseToolIdentityV5(payload.identity),
        argumentsSummary: parseSafeTextV5(payload.argumentsSummary, 8 * 1024),
      });
    }
    case "tool_progress": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
        "status", "identity", "progressIndex", "summary",
      ]);
      if (payload.status !== "in_progress") throw new ChatContractError();
      return Object.freeze({
        ...executionItemFieldsV5(payload),
        status: "in_progress",
        identity: parseToolIdentityV5(payload.identity),
        progressIndex: integer(payload.progressIndex, 0, 31),
        summary: parseSafeTextV5(payload.summary, 4 * 1024),
      });
    }
    case "tool_completed": {
      const payload = exactObject(value, [
        "sourceEventId", "sourceSequence", "sourceOccurredAt", "itemId", "itemOrdinal",
        "status", "identity", "argumentsSummary", "durationMs", "resultSummary", "error",
      ]);
      const status = oneOf(payload.status, ["completed", "failed", "declined"] as const);
      const resultSummary = nullable(
        payload.resultSummary,
        (entry) => parseSafeTextV5(entry, 64 * 1024),
      );
      const error = nullable(
        payload.error,
        (entry) => parseExecutionErrorV5(entry, CHAT_TOOL_ERROR_CODES_V5),
      );
      if (
        (status === "completed" && (resultSummary === null || error !== null)) ||
        (status === "failed" && (error === null || error.code === "tool_declined")) ||
        (status === "declined" && (resultSummary !== null || error?.code !== "tool_declined"))
      ) {
        throw new ChatContractError();
      }
      return Object.freeze({
        ...executionItemFieldsV5(payload),
        status,
        identity: parseToolIdentityV5(payload.identity),
        argumentsSummary: parseSafeTextV5(payload.argumentsSummary, 8 * 1024),
        durationMs: nullable(payload.durationMs, (entry) => integer(entry)),
        resultSummary,
        error,
      });
    }
  }
}

export function parseChatProjectionEventV5(value: unknown): ChatProjectionEventV5 {
  if (!isRecord(value) || value.schemaVersion !== CHAT_IPC_V5_SCHEMA_VERSION) {
    throw new ChatContractError();
  }
  const hasSourceSchemaVersion = Object.prototype.hasOwnProperty.call(
    value,
    "sourceSchemaVersion",
  );
  if (hasSourceSchemaVersion && value.sourceSchemaVersion !== 4) {
    throw new ChatContractError();
  }
  const kind = value.kind;
  const executionKinds = [
    "command_started", "command_output_append", "command_completed",
    "tool_started", "tool_progress", "tool_completed",
  ] as const;
  if (typeof kind !== "string" || !executionKinds.includes(kind as typeof executionKinds[number])) {
    const inheritedWire = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "sourceSchemaVersion"),
    );
    const inherited = parseChatProjectionEventV4Internal(
      { ...inheritedWire, schemaVersion: 4 },
      !hasSourceSchemaVersion,
    );
    const controlEvent = inherited.kind === "resync_required" ||
      inherited.kind === "context_invalidated";
    if (hasSourceSchemaVersion && controlEvent) {
      throw new ChatContractError();
    }
    if (!hasSourceSchemaVersion &&
        (inherited.kind === "item_started" || inherited.kind === "item_completed") &&
        !CHAT_GENERIC_LIFECYCLE_ITEM_TYPES_V5.has(inherited.payload.itemType)) {
      throw new ChatContractError();
    }
    return Object.freeze({
      ...inherited,
      schemaVersion: 5,
      ...(hasSourceSchemaVersion ? { sourceSchemaVersion: 4 as const } : {}),
    }) as ChatProjectionEventV5;
  }

  if (hasSourceSchemaVersion) throw new ChatContractError();

  const event = exactObject(
    value,
    [
      "schemaVersion", "subscriptionId", "contextId", "sessionId", "turnId",
      "projectionSequence", "eventId", "durableSequence", "kind", "payload",
    ],
  );
  if (typeof event.projectionSequence !== "string" ||
      !SEQUENCE_PATTERN.test(event.projectionSequence) ||
      BigInt(event.projectionSequence) > MAX_SAFE_EVENT_SEQUENCE) {
    throw new ChatContractError();
  }
  const executionKind = oneOf(event.kind, executionKinds);
  return Object.freeze({
    schemaVersion: 5,
    subscriptionId: uuid(event.subscriptionId),
    contextId: uuid(event.contextId),
    sessionId: uuid(event.sessionId),
    turnId: uuid(event.turnId),
    projectionSequence: event.projectionSequence,
    eventId: uuid(event.eventId),
    durableSequence: durableSequence(event.durableSequence, false),
    kind: executionKind,
    payload: parseExecutionEventPayloadV5(executionKind, event.payload),
  }) as ChatProjectionEventV5;
}

function approvalTimestampV6(value: unknown): string {
  if (typeof value !== "string" || parseStrictRfc3339EpochNanoseconds(value) === null) {
    throw new ChatContractError();
  }
  return value;
}

function approvalSourceFactV6(value: Record<string, unknown>) {
  const source = sourceFactV4(value);
  approvalTimestampV6(source.sourceOccurredAt);
  return source;
}

function approvalWindowV6(requestedAt: unknown, expiresAt: unknown) {
  const requested = approvalTimestampV6(requestedAt);
  const expires = approvalTimestampV6(expiresAt);
  const requestedNanoseconds = parseStrictRfc3339EpochNanoseconds(requested)!;
  const expiresNanoseconds = parseStrictRfc3339EpochNanoseconds(expires)!;
  if (expiresNanoseconds - requestedNanoseconds !== 120_000_000_000n) {
    throw new ChatContractError();
  }
  return { requestedAt: requested, expiresAt: expires } as const;
}

function parseApprovalDecisionSetV6(value: unknown): ChatApprovalDecisionSetV6 {
  const decisions = exactObject(value, ["primary", "secondary"]);
  if (decisions.primary !== "accept_once" ||
      decisions.secondary !== "cancel_current_turn") {
    throw new ChatContractError();
  }
  return Object.freeze({
    primary: "accept_once" as const,
    secondary: "cancel_current_turn" as const,
  });
}

function parseApprovalProjectionV6(value: unknown): ChatApprovalProjectionV6 {
  if (!isRecord(value)) throw new ChatContractError();
  const commonRequired = [
    "sourceEventId", "sourceSequence", "sourceOccurredAt", "turnId", "itemId",
    "approvalRequestId", "status", "revision", "actionId", "workspaceScope",
    "requestedAt", "expiresAt",
  ] as const;
  const status = value.status;
  if (status === "pending") {
    const pending = exactObject(value, [
      ...commonRequired,
      "decisions",
      "ttlSeconds",
    ]);
    if (pending.revision !== 1 || pending.actionId !== "git_repository_check" ||
        pending.workspaceScope !== "current_workspace" || pending.ttlSeconds !== 120) {
      throw new ChatContractError();
    }
    const window = approvalWindowV6(pending.requestedAt, pending.expiresAt);
    return Object.freeze({
      ...approvalSourceFactV6(pending),
      turnId: uuid(pending.turnId),
      itemId: itemIdV5(pending.itemId),
      approvalRequestId: uuid(pending.approvalRequestId),
      status: "pending",
      revision: 1,
      actionId: "git_repository_check",
      workspaceScope: "current_workspace",
      decisions: parseApprovalDecisionSetV6(pending.decisions),
      ...window,
      ttlSeconds: 120,
    });
  }
  if (status !== "resolved") throw new ChatContractError();
  const outcome = value.outcome;
  const withDecision = outcome === "accepted_once" ||
    outcome === "cancelled_current_turn";
  const resolved = exactObject(value, [
    ...commonRequired,
    "outcome",
    ...(withDecision ? ["decisionId", "decision"] : []),
    "resolvedAt",
  ]);
  if (resolved.revision !== 2 || resolved.actionId !== "git_repository_check" ||
      resolved.workspaceScope !== "current_workspace") {
    throw new ChatContractError();
  }
  const parsedOutcome = oneOf(resolved.outcome, CHAT_APPROVAL_OUTCOMES_V6);
  const window = approvalWindowV6(resolved.requestedAt, resolved.expiresAt);
  const resolvedAt = approvalTimestampV6(resolved.resolvedAt);
  const resolvedAtNanoseconds = parseStrictRfc3339EpochNanoseconds(resolvedAt)!;
  const requestedAtNanoseconds = parseStrictRfc3339EpochNanoseconds(window.requestedAt)!;
  const expiresAtNanoseconds = parseStrictRfc3339EpochNanoseconds(window.expiresAt)!;
  if (resolvedAtNanoseconds < requestedAtNanoseconds ||
      (parsedOutcome === "expired"
        ? resolvedAtNanoseconds < expiresAtNanoseconds
        : resolvedAtNanoseconds >= expiresAtNanoseconds)) {
    throw new ChatContractError();
  }
  const base = {
    ...approvalSourceFactV6(resolved),
    turnId: uuid(resolved.turnId),
    itemId: itemIdV5(resolved.itemId),
    approvalRequestId: uuid(resolved.approvalRequestId),
    status: "resolved" as const,
    revision: 2 as const,
    actionId: "git_repository_check" as const,
    workspaceScope: "current_workspace" as const,
    ...window,
    resolvedAt,
  };
  if (parsedOutcome === "accepted_once" || parsedOutcome === "cancelled_current_turn") {
    const decision = oneOf(resolved.decision, CHAT_APPROVAL_DECISIONS_V6);
    if ((decision === "accept_once") !== (parsedOutcome === "accepted_once")) {
      throw new ChatContractError();
    }
    return Object.freeze({
      ...base,
      outcome: parsedOutcome,
      decisionId: uuid(resolved.decisionId),
      decision,
    });
  }
  return Object.freeze({ ...base, outcome: parsedOutcome });
}

function parsePendingApprovalV6(value: unknown): ChatPendingApprovalV6 {
  const pending = exactObject(value, [
    "approvalRequestId", "revision", "turnId", "itemId", "actionId",
    "workspaceScope", "decisions",
    "requestedAt", "expiresAt", "ttlSeconds",
  ]);
  if (pending.revision !== 1 || pending.actionId !== "git_repository_check" ||
      pending.workspaceScope !== "current_workspace" || pending.ttlSeconds !== 120) {
    throw new ChatContractError();
  }
  const window = approvalWindowV6(pending.requestedAt, pending.expiresAt);
  return Object.freeze({
    approvalRequestId: uuid(pending.approvalRequestId),
    revision: 1,
    turnId: uuid(pending.turnId),
    itemId: itemIdV5(pending.itemId),
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    decisions: parseApprovalDecisionSetV6(pending.decisions),
    ...window,
    ttlSeconds: 120,
  });
}

export function parsePendingApprovalSnapshotV6(
  value: unknown,
): ChatPendingApprovalSnapshotV6 {
  const snapshot = exactObject(value, [
    "schemaVersion", "streamId", "snapshotAt", "pending",
  ]);
  if (snapshot.schemaVersion !== CHAT_IPC_V6_SCHEMA_VERSION ||
      !Array.isArray(snapshot.pending) || snapshot.pending.length > 1) {
    throw new ChatContractError();
  }
  const snapshotAt = approvalTimestampV6(snapshot.snapshotAt);
  const pending = Object.freeze(snapshot.pending.map(parsePendingApprovalV6));
  if (pending.some((approval) => {
    const observed = parseStrictRfc3339EpochNanoseconds(snapshotAt)!;
    return observed < parseStrictRfc3339EpochNanoseconds(approval.requestedAt)! ||
      observed >= parseStrictRfc3339EpochNanoseconds(approval.expiresAt)!;
  })) {
    throw new ChatContractError();
  }
  return Object.freeze({
    schemaVersion: CHAT_IPC_V6_SCHEMA_VERSION,
    streamId: uuid(snapshot.streamId),
    snapshotAt,
    pending,
  });
}

export function parsePendingApprovalSnapshotResponseV6(
  value: unknown,
): ChatPendingApprovalSnapshotV6 {
  return responseDataV6(value, parsePendingApprovalSnapshotV6);
}

function historyHasCommandV6(
  history: Pick<ChatHistoryPageV6, "turns">,
  turnId: string,
  itemId: string,
): boolean {
  const turn = history.turns.find((candidate) => candidate.turnId === turnId);
  return turn?.projectionAuthority === "v5" && turn.timelineItems.some((item) =>
    item.itemId === itemId && item.itemType === "command" &&
    item.execution?.kind === "command");
}

function parseHistoryPageV6(value: unknown): ChatHistoryPageV6 {
  const page = exactObject(value, [
    "turns", "nextCursor", "sessionNotices", "durableSequenceCut", "approvals",
  ]);
  if (!Array.isArray(page.approvals) || page.approvals.length > 128) {
    throw new ChatContractError();
  }
  const historyV5 = parseHistoryPageV5({
    turns: page.turns,
    nextCursor: page.nextCursor,
    sessionNotices: page.sessionNotices,
    durableSequenceCut: page.durableSequenceCut,
  });
  const approvals = Object.freeze(page.approvals.map(parseApprovalProjectionV6));
  if (new Set(approvals.map((approval) => approval.sourceEventId)).size !== approvals.length ||
      approvals.some((approval) =>
        !historyHasCommandV6(historyV5, approval.turnId, approval.itemId))) {
    throw new ChatContractError();
  }
  return Object.freeze({
    schemaVersion: CHAT_IPC_V6_SCHEMA_VERSION,
    turns: historyV5.turns,
    nextCursor: historyV5.nextCursor,
    sessionNotices: historyV5.sessionNotices,
    durableSequenceCut: historyV5.durableSequenceCut,
    approvals,
  });
}

export function parseHistoryPageResponseV6(value: unknown): ChatHistoryPageV6 {
  return responseDataV6(value, parseHistoryPageV6);
}

export function parseSubscriptionResponseV6(value: unknown): ChatSubscriptionV6 {
  return responseDataV6(value, (data) => {
    const subscription = exactObject(data, [
      "subscriptionId", "pendingApprovalSnapshot",
    ]);
    const subscriptionId = uuid(subscription.subscriptionId);
    const pendingApprovalSnapshot = parsePendingApprovalSnapshotV6(
      subscription.pendingApprovalSnapshot,
    );
    return Object.freeze({
      subscriptionId,
      pendingApprovalSnapshot,
    });
  });
}

export function parseResyncResponseV6(value: unknown): ChatResyncProjectionV6 {
  return responseDataV6(value, (data) => {
    const projection = exactObject(data, [
      "session", "history", "cleanup", "pendingApprovalSnapshot",
    ]);
    const session = parseSession(projection.session);
    const history = parseHistoryPageV6(projection.history);
    const pendingApprovalSnapshot = parsePendingApprovalSnapshotV6(
      projection.pendingApprovalSnapshot,
    );
    if (pendingApprovalSnapshot.pending.some((approval) =>
      !historyHasCommandV6(history, approval.turnId, approval.itemId))) {
      throw new ChatContractError();
    }
    return Object.freeze({
      session,
      history,
      cleanup: nullable(projection.cleanup, parseCleanup),
      pendingApprovalSnapshot,
    });
  });
}

export function parseApprovalDecisionRequestV6(
  value: unknown,
): ChatApprovalDecisionRequestV6 {
  const request = exactObject(value, [
    "schemaVersion", "decisionId", "expectedStreamId", "expectedRevision", "decision",
  ]);
  if (request.schemaVersion !== CHAT_IPC_V6_SCHEMA_VERSION ||
      request.expectedRevision !== 1) {
    throw new ChatContractError();
  }
  return Object.freeze({
    schemaVersion: CHAT_IPC_V6_SCHEMA_VERSION,
    decisionId: uuid(request.decisionId),
    expectedStreamId: uuid(request.expectedStreamId),
    expectedRevision: 1,
    decision: oneOf(request.decision, CHAT_APPROVAL_DECISIONS_V6),
  });
}

export function createApprovalDecisionRequestV6(
  decisionId: string,
  expectedStreamId: string,
  decision: ChatApprovalDecisionV6,
): ChatApprovalDecisionRequestV6 {
  return parseApprovalDecisionRequestV6({
    schemaVersion: CHAT_IPC_V6_SCHEMA_VERSION,
    decisionId,
    expectedStreamId,
    expectedRevision: 1,
    decision,
  });
}

export function parseApprovalDecisionResponseV6(
  value: unknown,
): ChatApprovalDecisionResultV6 {
  return responseDataV6(value, (data) => {
    const result = exactObject(data, [
      "schemaVersion", "approvalRequestId", "decisionId", "streamId", "revision",
      "decision", "outcome", "resolvedAt",
    ]);
    if (result.schemaVersion !== CHAT_IPC_V6_SCHEMA_VERSION || result.revision !== 2) {
      throw new ChatContractError();
    }
    const decision = oneOf(result.decision, CHAT_APPROVAL_DECISIONS_V6);
    const outcome = oneOf(
      result.outcome,
      ["accepted_once", "cancelled_current_turn"] as const,
    );
    if ((decision === "accept_once") !== (outcome === "accepted_once")) {
      throw new ChatContractError();
    }
    return Object.freeze({
      schemaVersion: CHAT_IPC_V6_SCHEMA_VERSION,
      approvalRequestId: uuid(result.approvalRequestId),
      decisionId: uuid(result.decisionId),
      streamId: uuid(result.streamId),
      revision: 2,
      decision,
      outcome,
      resolvedAt: approvalTimestampV6(result.resolvedAt),
    }) as ChatApprovalDecisionResultV6;
  });
}

const CHAT_APPROVAL_ERROR_MESSAGES_V6 = Object.freeze({
  unauthorized: "valid Agent Host bearer token required",
  invalid_approval_request: "approval request is invalid",
  approval_version_mismatch: "approval schema version does not match",
  session_not_found: "agent session was not found",
  approval_not_found: "approval request was not found",
  approval_stale: "approval request is stale",
  approval_expired: "approval request expired",
  approval_already_resolved: "approval request was already resolved",
  approval_decision_conflict: "approval decision conflicts with the existing decision",
  approval_unavailable: "approval authority is unavailable",
  internal_error: "approval processing failed",
} satisfies Readonly<Record<ChatApprovalErrorCodeV6, ChatApprovalErrorV6["message"]>>);

export function parseApprovalErrorV6(value: unknown): ChatApprovalErrorV6 {
  const envelope = exactObject(value, ["error"]);
  const error = exactObject(envelope.error, ["code", "message"]);
  const code = oneOf(error.code, CHAT_APPROVAL_ERROR_CODES_V6);
  if (error.message !== CHAT_APPROVAL_ERROR_MESSAGES_V6[code]) {
    throw new ChatContractError();
  }
  return Object.freeze({ code, message: CHAT_APPROVAL_ERROR_MESSAGES_V6[code] });
}

export function parseChatProjectionEventV6(value: unknown): ChatProjectionEventV6 {
  if (!isRecord(value) || value.schemaVersion !== CHAT_IPC_V6_SCHEMA_VERSION) {
    throw new ChatContractError();
  }
  if (value.kind === "approval_changed") {
    const event = exactObject(value, [
      "schemaVersion", "subscriptionId", "contextId", "sessionId", "turnId",
      "projectionSequence", "eventId", "durableSequence", "kind", "payload",
    ]);
    if (typeof event.projectionSequence !== "string" ||
        !SEQUENCE_PATTERN.test(event.projectionSequence) ||
        BigInt(event.projectionSequence) > MAX_SAFE_EVENT_SEQUENCE) {
      throw new ChatContractError();
    }
    const payload = parseApprovalProjectionV6(event.payload);
    const turnId = uuid(event.turnId);
    if (payload.turnId !== turnId) throw new ChatContractError();
    return Object.freeze({
      schemaVersion: CHAT_IPC_V6_SCHEMA_VERSION,
      subscriptionId: uuid(event.subscriptionId),
      contextId: uuid(event.contextId),
      sessionId: uuid(event.sessionId),
      turnId,
      projectionSequence: event.projectionSequence,
      eventId: uuid(event.eventId),
      durableSequence: durableSequence(event.durableSequence, false),
      kind: "approval_changed",
      payload,
    });
  }

  const marker = value.sourceSchemaVersion;
  if (marker !== undefined && marker !== 4 && marker !== 5) {
    throw new ChatContractError();
  }
  const inheritedWire = Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "sourceSchemaVersion"));
  const inherited = parseChatProjectionEventV5({
    ...inheritedWire,
    schemaVersion: CHAT_IPC_V5_SCHEMA_VERSION,
    ...(marker === 4 ? { sourceSchemaVersion: 4 } : {}),
  });
  if (marker !== undefined && (
    inherited.kind === "resync_required" || inherited.kind === "context_invalidated"
  )) {
    throw new ChatContractError();
  }
  return Object.freeze({
    ...inherited,
    schemaVersion: CHAT_IPC_V6_SCHEMA_VERSION,
    ...(marker === undefined ? {} : { sourceSchemaVersion: marker }),
  }) as ChatProjectionEventV6;
}
