export const CHAT_IPC_SCHEMA_VERSION = 1 as const;
export const CHAT_EVENT_CHANNEL = "yijie.chat.event.v1" as const;

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
  "chat_get_local_readiness_v1",
  "chat_request_local_recovery_v1",
  "chat_subscribe_session_v1",
  "chat_resync_session_v1",
  "chat_cancel_request_v1",
  "chat_unsubscribe_session_v1",
] as const);

export type ChatCommandName = (typeof CHAT_COMMAND_NAMES)[number];

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
  readonly schemaVersion: 1;
  readonly requestId?: string;
  readonly code: ChatErrorCode;
  readonly retryable: boolean;
  readonly recovery: ChatRecovery;
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

export interface ChatMessage {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
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

export function parseChatIpcError(value: unknown): ChatIpcErrorShape {
  const error = exactObject(
    value,
    ["schemaVersion", "code", "retryable", "recovery"],
    ["requestId", "retryAfterMs"],
  );
  if (error.schemaVersion !== CHAT_IPC_SCHEMA_VERSION || typeof error.retryable !== "boolean") {
    throw new ChatContractError();
  }
  return Object.freeze({
    schemaVersion: 1,
    ...(error.requestId === undefined ? {} : { requestId: uuid(error.requestId) }),
    code: oneOf(error.code, CHAT_ERROR_CODES),
    retryable: error.retryable,
    recovery: oneOf(error.recovery, CHAT_RECOVERIES),
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

export function parseCreatedTurnResponse(value: unknown): ChatCreatedTurn {
  return responseData(value, (data) => {
    const created = exactObject(data, ["sessionId", "turnId", "operationId"]);
    return Object.freeze({
      sessionId: uuid(created.sessionId),
      turnId: uuid(created.turnId),
      operationId: uuid(created.operationId),
    });
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
