export const CHAT_IPC_SCHEMA_VERSION = 1 as const;
export const CHAT_IPC_V2_SCHEMA_VERSION = 2 as const;
export const CHAT_EVENT_CHANNEL = "yijie:chat:event:v1" as const;
export const CHAT_CONTROL_PLANE_EVENT_CHANNEL = "yijie:chat:control-plane:event:v1" as const;
export const CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL = "yijie:chat:attachment-import:event:v2" as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
const SEQUENCE_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_SAFE_EVENT_SEQUENCE = (1n << 64n) - 1n;

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
  readonly schemaVersion: 1 | 2;
  readonly requestId?: string;
  readonly code: ChatErrorCode;
  readonly retryable: boolean;
  readonly recovery: ChatRecovery;
  readonly attachmentIssue?: ChatAttachmentIssue;
  readonly attachmentItemCount?: number;
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
}

export interface ChatHistoryPage {
  readonly turns: readonly ChatHistoryTurn[];
  readonly nextCursor: string | null;
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

export function parseChatIpcError(value: unknown): ChatIpcErrorShape {
  const error = exactObject(
    value,
    ["schemaVersion", "code", "retryable", "recovery"],
    ["requestId", "attachmentIssue", "attachmentItemCount", "retryAfterMs"],
  );
  if (
    (error.schemaVersion !== CHAT_IPC_SCHEMA_VERSION && error.schemaVersion !== CHAT_IPC_V2_SCHEMA_VERSION) ||
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
  return Object.freeze({
    schemaVersion: error.schemaVersion,
    ...(error.requestId === undefined ? {} : { requestId: uuid(error.requestId) }),
    code,
    retryable: error.retryable,
    recovery: oneOf(error.recovery, CHAT_RECOVERIES),
    ...(attachmentIssue === undefined ? {} : { attachmentIssue }),
    ...(attachmentItemCount === undefined ? {} : { attachmentItemCount }),
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

function attachmentName(value: unknown): string {
  const name = stringValue(value, 255);
  if (name.trim() !== name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new ChatContractError();
  }
  return name;
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
