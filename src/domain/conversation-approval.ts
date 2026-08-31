import type {
  ChatApprovalDecisionResultV6,
  ChatApprovalDecisionRequestV6,
  ChatApprovalDecisionSetV6,
  ChatApprovalDecisionV6,
  ChatApprovalOutcomeV6,
  ChatApprovalProjectionV6,
  ChatPendingApprovalSnapshotV6,
} from "./chat-ipc";
import {
  isStrictRfc3339,
  parseStrictRfc3339EpochNanoseconds,
} from "./rfc3339";

export const CONVERSATION_APPROVAL_STATE_SCHEMA_VERSION = 1 as const;
export const MAX_CONVERSATION_APPROVAL_RECORDS = 128;
export const MAX_CONVERSATION_APPROVAL_EVENT_IDS = 256;
export const MAX_CONVERSATION_APPROVAL_DIAGNOSTICS = 64;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

export type ConversationApprovalAuthority = "historical" | "actionable";

export interface ConversationApprovalSource {
  readonly sourceEventId: string;
  readonly sourceSequence: string;
  readonly sourceOccurredAt: string;
}

export interface ConversationApproval {
  readonly approvalRequestId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly revision: 1 | 2;
  readonly status: "pending" | "resolved";
  readonly actionId: "git_repository_check";
  readonly workspaceScope: "current_workspace";
  readonly decisions: ChatApprovalDecisionSetV6 | null;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly resolvedAt: string | null;
  readonly decisionId: string | null;
  readonly decision: ChatApprovalDecisionV6 | null;
  readonly outcome: ChatApprovalOutcomeV6 | null;
  readonly authority: ConversationApprovalAuthority;
  readonly authorityStreamId: string | null;
  readonly source: ConversationApprovalSource | null;
}

export interface ConversationApprovalEvent {
  readonly eventId: string;
  readonly streamId: string;
  readonly sequence: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly projection: ChatApprovalProjectionV6;
}

export interface ConversationApprovalDiagnostic {
  readonly code:
    | "event_id_conflict"
    | "projection_conflict"
    | "pending_snapshot_invalid"
    | "decision_result_invalid";
}

export interface ConversationApprovalState {
  readonly schemaVersion: typeof CONVERSATION_APPROVAL_STATE_SCHEMA_VERSION;
  readonly reconciliation: "synchronized" | "required";
  readonly approvals: Readonly<Record<string, ConversationApproval>>;
  readonly activeByThread: Readonly<Record<string, string>>;
  readonly processedEventIds: Readonly<Record<string, true>>;
  readonly processedEventFingerprints: Readonly<Record<string, string>>;
  readonly diagnostics: readonly ConversationApprovalDiagnostic[];
}

export interface ConversationApprovalSnapshot {
  readonly schemaVersion: typeof CONVERSATION_APPROVAL_STATE_SCHEMA_VERSION;
  readonly approvals: readonly Omit<
    ConversationApproval,
    "authority" | "authorityStreamId"
  >[];
}

export interface ConversationApprovalSnapshotContext {
  readonly nowEpochMs: number;
  readonly expectedThreadId: string;
  readonly expectedStreamId: string;
  readonly hasCommandItem: (
    threadId: string,
    turnId: string,
    itemId: string,
  ) => boolean;
}

export function createConversationApprovalState(): ConversationApprovalState {
  return Object.freeze({
    schemaVersion: CONVERSATION_APPROVAL_STATE_SCHEMA_VERSION,
    reconciliation: "synchronized" as const,
    approvals: Object.freeze({}),
    activeByThread: Object.freeze({}),
    processedEventIds: Object.freeze({}),
    processedEventFingerprints: Object.freeze({}),
    diagnostics: Object.freeze([]),
  });
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalValue(entry)]));
}

function fingerprint(event: ConversationApprovalEvent): string {
  const semantic = {
    threadId: event.threadId,
    turnId: event.turnId,
    projection: event.projection,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue(semantic)));
  const mask = (1n << 64n) - 1n;
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & mask;
  return `${bytes.length}:${hash.toString(16).padStart(16, "0")}`;
}

function appendDiagnostic(
  state: ConversationApprovalState,
  code: ConversationApprovalDiagnostic["code"],
): ConversationApprovalState {
  return Object.freeze({
    ...disconnectConversationApprovals(state),
    reconciliation: "required" as const,
    diagnostics: Object.freeze([
      ...state.diagnostics,
      Object.freeze({ code }),
    ].slice(-MAX_CONVERSATION_APPROVAL_DIAGNOSTICS)),
  });
}

function trackEvent(
  state: ConversationApprovalState,
  event: ConversationApprovalEvent,
  eventFingerprint: string,
): ConversationApprovalState {
  const retainedIds = [...Object.keys(state.processedEventIds), event.eventId]
    .slice(-MAX_CONVERSATION_APPROVAL_EVENT_IDS);
  const retained = new Set(retainedIds);
  return Object.freeze({
    ...state,
    processedEventIds: Object.freeze(Object.fromEntries(
      retainedIds.map((id) => [id, true as const]),
    )),
    processedEventFingerprints: Object.freeze(Object.fromEntries([
      ...Object.entries(state.processedEventFingerprints)
        .filter(([id]) => retained.has(id)),
      [event.eventId, eventFingerprint],
    ].filter(([id]) => retained.has(id)))),
  });
}

function sameIdentity(
  approval: ConversationApproval,
  threadId: string,
  turnId: string,
  projection: ChatApprovalProjectionV6,
): boolean {
  return approval.approvalRequestId === projection.approvalRequestId &&
    approval.threadId === threadId && approval.turnId === turnId &&
    approval.itemId === projection.itemId &&
    approval.actionId === projection.actionId &&
    approval.workspaceScope === projection.workspaceScope &&
    approval.requestedAt === projection.requestedAt &&
    approval.expiresAt === projection.expiresAt;
}

function sameResolution(
  approval: ConversationApproval,
  projection: Extract<ChatApprovalProjectionV6, { status: "resolved" }>,
): boolean {
  return approval.revision === 2 && approval.status === "resolved" &&
    approval.resolvedAt === projection.resolvedAt &&
    approval.outcome === projection.outcome &&
    approval.decisionId === ("decisionId" in projection ? projection.decisionId : null) &&
    approval.decision === ("decision" in projection ? projection.decision : null);
}

function projectionSource(
  projection: ChatApprovalProjectionV6,
): ConversationApprovalSource {
  return Object.freeze({
    sourceEventId: projection.sourceEventId,
    sourceSequence: projection.sourceSequence,
    sourceOccurredAt: projection.sourceOccurredAt,
  });
}

function requestedApproval(
  threadId: string,
  turnId: string,
  projection: Extract<ChatApprovalProjectionV6, { status: "pending" }>,
): ConversationApproval {
  return Object.freeze({
    approvalRequestId: projection.approvalRequestId,
    threadId,
    turnId,
    itemId: projection.itemId,
    revision: 1,
    status: "pending",
    actionId: projection.actionId,
    workspaceScope: projection.workspaceScope,
    decisions: Object.freeze({ ...projection.decisions }),
    requestedAt: projection.requestedAt,
    expiresAt: projection.expiresAt,
    resolvedAt: null,
    decisionId: null,
    decision: null,
    outcome: null,
    authority: "historical",
    authorityStreamId: null,
    source: projectionSource(projection),
  });
}

function resolvedApproval(
  threadId: string,
  turnId: string,
  projection: Extract<ChatApprovalProjectionV6, { status: "resolved" }>,
  previous: ConversationApproval | null,
): ConversationApproval {
  return Object.freeze({
    approvalRequestId: projection.approvalRequestId,
    threadId,
    turnId,
    itemId: projection.itemId,
    revision: 2,
    status: "resolved",
    actionId: projection.actionId,
    workspaceScope: projection.workspaceScope,
    decisions: previous?.decisions ?? null,
    requestedAt: projection.requestedAt,
    expiresAt: projection.expiresAt,
    resolvedAt: projection.resolvedAt,
    decisionId: "decisionId" in projection ? projection.decisionId : null,
    decision: "decision" in projection ? projection.decision : null,
    outcome: projection.outcome,
    authority: "historical",
    authorityStreamId: null,
    source: projectionSource(projection),
  });
}

export function reduceConversationApprovalEvent(
  state: ConversationApprovalState,
  event: ConversationApprovalEvent,
): ConversationApprovalState {
  const eventFingerprint = fingerprint(event);
  if (state.processedEventIds[event.eventId]) {
    return state.processedEventFingerprints[event.eventId] === eventFingerprint
      ? state
      : appendDiagnostic(state, "event_id_conflict");
  }
  let next = trackEvent(state, event, eventFingerprint);
  const projection = event.projection;
  if (projection.turnId !== event.turnId) {
    return appendDiagnostic(next, "projection_conflict");
  }
  const existing = state.approvals[projection.approvalRequestId] ?? null;
  if (existing !== null && !sameIdentity(existing, event.threadId, event.turnId, projection)) {
    return appendDiagnostic(next, "projection_conflict");
  }

  if (projection.status === "pending") {
    // A replayed or late requested projection can never roll a resolved record
    // back to pending, and cannot recreate action authority by itself.
    if (existing?.revision === 2) return next;
    const competingPending = Object.values(state.approvals).some((approval) =>
      approval.approvalRequestId !== projection.approvalRequestId &&
      approval.threadId === event.threadId && approval.status === "pending");
    if (competingPending) return appendDiagnostic(next, "projection_conflict");
    const requested = requestedApproval(event.threadId, event.turnId, projection);
    // A durable replay is lifecycle evidence, not a new authority source. It
    // must neither create authority nor revoke authority already established
    // by the current realtime pending snapshot.
    const preserveAuthority = existing?.authority === "actionable";
    next = Object.freeze({
      ...next,
      approvals: Object.freeze({
        ...next.approvals,
        [projection.approvalRequestId]: Object.freeze({
          ...requested,
          authority: preserveAuthority ? "actionable" as const : "historical" as const,
          authorityStreamId: preserveAuthority ? existing.authorityStreamId : null,
        }),
      }),
      activeByThread: Object.freeze({
        ...next.activeByThread,
        [event.threadId]: projection.approvalRequestId,
      }),
    });
    return next;
  }

  if (existing?.revision === 2) {
    return sameResolution(existing, projection)
      ? next
      : appendDiagnostic(next, "projection_conflict");
  }
  const resolved = resolvedApproval(event.threadId, event.turnId, projection, existing);
  const activeByThread = { ...next.activeByThread };
  if (activeByThread[event.threadId] === projection.approvalRequestId) {
    delete activeByThread[event.threadId];
  }
  return Object.freeze({
    ...next,
    approvals: Object.freeze({
      ...next.approvals,
      [projection.approvalRequestId]: resolved,
    }),
    activeByThread: Object.freeze(activeByThread),
  });
}

export function disconnectConversationApprovals(
  state: ConversationApprovalState,
): ConversationApprovalState {
  const approvals = Object.freeze(Object.fromEntries(
    Object.entries(state.approvals).map(([id, approval]) => [
      id,
      approval.authority === "historical"
        ? approval
        : Object.freeze({
            ...approval,
            authority: "historical" as const,
            authorityStreamId: null,
          }),
    ]),
  ));
  return Object.freeze({
    ...state,
    approvals,
    activeByThread: Object.freeze({}),
  });
}

function pendingMatchesApproval(
  approval: ConversationApproval,
  pending: ChatPendingApprovalSnapshotV6["pending"][number],
  expectedThreadId: string,
): boolean {
  return approval.approvalRequestId === pending.approvalRequestId &&
    approval.threadId === expectedThreadId && approval.turnId === pending.turnId &&
    approval.itemId === pending.itemId && approval.revision === 1 &&
    approval.status === "pending" && approval.actionId === pending.actionId &&
    approval.workspaceScope === pending.workspaceScope &&
    approval.requestedAt === pending.requestedAt && approval.expiresAt === pending.expiresAt;
}

export function reconcileConversationApprovalSnapshot(
  state: ConversationApprovalState,
  snapshot: ChatPendingApprovalSnapshotV6,
  context: ConversationApprovalSnapshotContext,
): ConversationApprovalState {
  const next = disconnectConversationApprovals(state);
  if (!Number.isFinite(context.nowEpochMs) ||
      snapshot.streamId !== context.expectedStreamId) {
    return appendDiagnostic(next, "pending_snapshot_invalid");
  }
  if (snapshot.pending.length === 0) {
    return Object.freeze({ ...next, reconciliation: "synchronized" as const });
  }
  const pending = snapshot.pending[0]!;
  const now = epochMillisecondsNanoseconds(context.nowEpochMs);
  const requestedAt = parseStrictRfc3339EpochNanoseconds(pending.requestedAt);
  const expiresAt = parseStrictRfc3339EpochNanoseconds(pending.expiresAt);
  if (now === null || requestedAt === null || expiresAt === null ||
      now < requestedAt || now >= expiresAt ||
      !context.hasCommandItem(context.expectedThreadId, pending.turnId, pending.itemId)) {
    return appendDiagnostic(next, "pending_snapshot_invalid");
  }
  const existing = next.approvals[pending.approvalRequestId] ?? null;
  if (existing !== null &&
      !pendingMatchesApproval(existing, pending, context.expectedThreadId)) {
    return appendDiagnostic(next, "pending_snapshot_invalid");
  }
  const approval: ConversationApproval = existing ?? Object.freeze({
    approvalRequestId: pending.approvalRequestId,
    threadId: context.expectedThreadId,
    turnId: pending.turnId,
    itemId: pending.itemId,
    revision: 1,
    status: "pending",
    actionId: pending.actionId,
    workspaceScope: pending.workspaceScope,
    decisions: Object.freeze({ ...pending.decisions }),
    requestedAt: pending.requestedAt,
    expiresAt: pending.expiresAt,
    resolvedAt: null,
    decisionId: null,
    decision: null,
    outcome: null,
    authority: "historical",
    authorityStreamId: null,
    source: null,
  });
  const actionable = Object.freeze({
    ...approval,
    decisions: Object.freeze({ ...pending.decisions }),
    authority: "actionable" as const,
    authorityStreamId: snapshot.streamId,
  });
  return Object.freeze({
    ...next,
    reconciliation: "synchronized" as const,
    approvals: Object.freeze({
      ...next.approvals,
      [pending.approvalRequestId]: actionable,
    }),
    activeByThread: Object.freeze({
      ...next.activeByThread,
      [context.expectedThreadId]: pending.approvalRequestId,
    }),
  });
}

export function applyConversationApprovalDecisionResult(
  state: ConversationApprovalState,
  approvalRequestId: string,
  request: ChatApprovalDecisionRequestV6,
  result: ChatApprovalDecisionResultV6,
): ConversationApprovalState {
  const approval = state.approvals[approvalRequestId];
  const resolvedAt = parseStrictRfc3339EpochNanoseconds(result.resolvedAt);
  const requestedAt = approval === undefined
    ? null
    : parseStrictRfc3339EpochNanoseconds(approval.requestedAt);
  const expiresAt = approval === undefined
    ? null
    : parseStrictRfc3339EpochNanoseconds(approval.expiresAt);
  if (approval === undefined || approval.status !== "pending" ||
      approval.revision !== 1 || approval.authority !== "actionable" ||
      result.approvalRequestId !== approvalRequestId ||
      request.decisionId !== result.decisionId || request.decision !== result.decision ||
      request.expectedStreamId !== result.streamId ||
      request.expectedRevision !== 1 ||
      approval.authorityStreamId !== request.expectedStreamId ||
      resolvedAt === null || requestedAt === null || expiresAt === null ||
      resolvedAt < requestedAt || resolvedAt >= expiresAt ||
      (result.decision === "accept_once") !== (result.outcome === "accepted_once")) {
    return appendDiagnostic(state, "decision_result_invalid");
  }
  const activeByThread = { ...state.activeByThread };
  if (activeByThread[approval.threadId] === approval.approvalRequestId) {
    delete activeByThread[approval.threadId];
  }
  return Object.freeze({
    ...state,
    approvals: Object.freeze({
      ...state.approvals,
      [approval.approvalRequestId]: Object.freeze({
        ...approval,
        revision: 2 as const,
        status: "resolved" as const,
        resolvedAt: result.resolvedAt,
        decisionId: result.decisionId,
        decision: result.decision,
        outcome: result.outcome,
        authority: "historical" as const,
        authorityStreamId: null,
      }),
    }),
    activeByThread: Object.freeze(activeByThread),
  });
}

export function requireConversationApprovalReconciliation(
  state: ConversationApprovalState,
): ConversationApprovalState {
  return Object.freeze({
    ...disconnectConversationApprovals(state),
    reconciliation: "required" as const,
  });
}

function epochMillisecondsNanoseconds(value: number): bigint | null {
  return Number.isFinite(value)
    ? BigInt(Math.trunc(value)) * NANOSECONDS_PER_MILLISECOND
    : null;
}

export function revokeExpiredConversationApprovalAuthority(
  state: ConversationApprovalState,
  nowEpochMs: number,
): ConversationApprovalState {
  const now = epochMillisecondsNanoseconds(nowEpochMs);
  const expired = Object.values(state.approvals).some((approval) => {
    if (approval.authority !== "actionable") return false;
    const expiresAt = parseStrictRfc3339EpochNanoseconds(approval.expiresAt);
    return now === null || expiresAt === null || now >= expiresAt;
  });
  return expired ? requireConversationApprovalReconciliation(state) : state;
}

export function selectConversationApproval(
  state: ConversationApprovalState,
  approvalRequestId: string,
): ConversationApproval | null {
  return state.approvals[approvalRequestId] ?? null;
}

export function selectConversationApprovalForCommand(
  state: ConversationApprovalState,
  threadId: string,
  turnId: string,
  itemId: string,
): ConversationApproval | null {
  const activeId = state.activeByThread[threadId];
  const active = activeId === undefined ? undefined : state.approvals[activeId];
  if (active?.turnId === turnId && active.itemId === itemId) return active;
  return Object.values(state.approvals)
    .filter((approval) => approval.threadId === threadId &&
      approval.turnId === turnId && approval.itemId === itemId)
    .sort((left, right) =>
      right.revision - left.revision ||
      (right.resolvedAt ?? right.requestedAt).localeCompare(
        left.resolvedAt ?? left.requestedAt,
      ) || right.approvalRequestId.localeCompare(left.approvalRequestId))[0] ?? null;
}

function persistedApproval(approval: ConversationApproval): Omit<
  ConversationApproval,
  "authority" | "authorityStreamId"
> {
  return Object.freeze({
    approvalRequestId: approval.approvalRequestId,
    threadId: approval.threadId,
    turnId: approval.turnId,
    itemId: approval.itemId,
    revision: approval.revision,
    status: approval.status,
    actionId: approval.actionId,
    workspaceScope: approval.workspaceScope,
    decisions: approval.decisions === null
      ? null
      : Object.freeze({ ...approval.decisions }),
    requestedAt: approval.requestedAt,
    expiresAt: approval.expiresAt,
    resolvedAt: approval.resolvedAt,
    decisionId: approval.decisionId,
    decision: approval.decision,
    outcome: approval.outcome,
    source: approval.source === null ? null : Object.freeze({ ...approval.source }),
  });
}

export function conversationApprovalSnapshot(
  state: ConversationApprovalState,
): ConversationApprovalSnapshot {
  return Object.freeze({
    schemaVersion: CONVERSATION_APPROVAL_STATE_SCHEMA_VERSION,
    approvals: Object.freeze(Object.values(state.approvals)
      // A record synthesized only from the realtime pending snapshot has no
      // durable source and must never cross the SQLCipher persistence boundary.
      .filter((approval) => approval.source !== null)
      .sort((left, right) => left.approvalRequestId.localeCompare(right.approvalRequestId))
      .map(persistedApproval)),
  });
}

export function serializeConversationApprovalState(
  state: ConversationApprovalState,
): string {
  return JSON.stringify(conversationApprovalSnapshot(state));
}

const APPROVAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const APPROVAL_SEQUENCE_PATTERN = /^(?:0|[1-9][0-9]*)$/;

function approvalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function approvalExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return approvalRecord(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function approvalUuid(value: unknown): value is string {
  return typeof value === "string" && APPROVAL_UUID_PATTERN.test(value) &&
    value !== "00000000-0000-0000-0000-000000000000";
}

function approvalTimestamp(value: unknown): value is string {
  return isStrictRfc3339(value);
}

function approvalItemId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0") &&
    [...value].length <= 256 && new TextEncoder().encode(value).length <= 1024;
}

function approvalDecisions(value: unknown): value is ChatApprovalDecisionSetV6 {
  return approvalExactKeys(value, ["primary", "secondary"]) &&
    value.primary === "accept_once" && value.secondary === "cancel_current_turn";
}

function approvalSource(value: unknown): value is ConversationApprovalSource {
  if (!approvalExactKeys(value, [
    "sourceEventId", "sourceSequence", "sourceOccurredAt",
  ]) || !approvalUuid(value.sourceEventId) ||
      typeof value.sourceSequence !== "string" ||
      !APPROVAL_SEQUENCE_PATTERN.test(value.sourceSequence) ||
      BigInt(value.sourceSequence) < 1n || BigInt(value.sourceSequence) > (1n << 64n) - 1n ||
      !approvalTimestamp(value.sourceOccurredAt)) {
    return false;
  }
  return true;
}

const PERSISTED_APPROVAL_KEYS = Object.freeze([
  "approvalRequestId", "threadId", "turnId", "itemId", "revision", "status",
  "actionId", "workspaceScope", "decisions", "requestedAt", "expiresAt",
  "resolvedAt", "decisionId", "decision", "outcome", "source",
] as const);

function parsePersistedApproval(value: unknown): ConversationApproval | null {
  const requestedAt = approvalRecord(value)
    ? parseStrictRfc3339EpochNanoseconds(value.requestedAt)
    : null;
  const expiresAt = approvalRecord(value)
    ? parseStrictRfc3339EpochNanoseconds(value.expiresAt)
    : null;
  if (!approvalExactKeys(value, PERSISTED_APPROVAL_KEYS) ||
      !approvalUuid(value.approvalRequestId) || !approvalUuid(value.threadId) ||
      !approvalUuid(value.turnId) || !approvalItemId(value.itemId) ||
      value.actionId !== "git_repository_check" ||
      value.workspaceScope !== "current_workspace" ||
      !approvalTimestamp(value.requestedAt) || !approvalTimestamp(value.expiresAt) ||
      requestedAt === null || expiresAt === null ||
      expiresAt - requestedAt !== 120_000_000_000n ||
      !approvalSource(value.source)) {
    return null;
  }
  const pending = value.status === "pending" && value.revision === 1 &&
    approvalDecisions(value.decisions) && value.resolvedAt === null &&
    value.decisionId === null && value.decision === null && value.outcome === null;
  const outcome = value.outcome;
  const closedOutcome = outcome === "accepted_once" ||
    outcome === "cancelled_current_turn" || outcome === "expired" ||
    outcome === "resolved_elsewhere";
  const resolvedAt = approvalTimestamp(value.resolvedAt)
    ? parseStrictRfc3339EpochNanoseconds(value.resolvedAt)
    : null;
  const resolvedAtValid = resolvedAt !== null && requestedAt !== null && expiresAt !== null &&
    resolvedAt >= requestedAt &&
    (outcome === "expired"
      ? resolvedAt >= expiresAt
      : resolvedAt < expiresAt);
  const decided = outcome === "accepted_once" || outcome === "cancelled_current_turn";
  const decisionFieldsValid = decided
    ? approvalUuid(value.decisionId) &&
      (value.decision === "accept_once" || value.decision === "cancel_current_turn") &&
      ((value.decision === "accept_once") === (outcome === "accepted_once"))
    : value.decisionId === null && value.decision === null;
  const resolved = value.status === "resolved" && value.revision === 2 && closedOutcome &&
    (value.decisions === null || approvalDecisions(value.decisions)) &&
    resolvedAtValid && decisionFieldsValid;
  if (!pending && !resolved) return null;
  return Object.freeze({
    approvalRequestId: value.approvalRequestId,
    threadId: value.threadId,
    turnId: value.turnId,
    itemId: value.itemId,
    revision: value.revision,
    status: value.status,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    decisions: value.decisions === null
      ? null
      : Object.freeze({ primary: "accept_once", secondary: "cancel_current_turn" }),
    requestedAt: value.requestedAt,
    expiresAt: value.expiresAt,
    resolvedAt: value.resolvedAt,
    decisionId: value.decisionId,
    decision: value.decision,
    outcome,
    authority: "historical",
    authorityStreamId: null,
    source: Object.freeze({
      sourceEventId: value.source.sourceEventId,
      sourceSequence: value.source.sourceSequence,
      sourceOccurredAt: value.source.sourceOccurredAt,
    }),
  }) as ConversationApproval;
}

function invalidHydratedApprovalState(): ConversationApprovalState {
  return Object.freeze({
    ...createConversationApprovalState(),
    reconciliation: "required" as const,
    diagnostics: Object.freeze([{ code: "pending_snapshot_invalid" as const }]),
  });
}

export function hydrateConversationApprovalState(
  snapshot: unknown,
): ConversationApprovalState {
  if (!approvalExactKeys(snapshot, ["schemaVersion", "approvals"]) ||
      snapshot.schemaVersion !== CONVERSATION_APPROVAL_STATE_SCHEMA_VERSION ||
      !Array.isArray(snapshot.approvals) ||
      snapshot.approvals.length > MAX_CONVERSATION_APPROVAL_RECORDS) {
    return invalidHydratedApprovalState();
  }
  const approvals: Record<string, ConversationApproval> = {};
  const pendingByThread = new Set<string>();
  for (const input of snapshot.approvals) {
    const parsed = parsePersistedApproval(input);
    if (parsed === null || approvals[parsed.approvalRequestId] !== undefined) {
      return invalidHydratedApprovalState();
    }
    if (parsed.status === "pending") {
      if (pendingByThread.has(parsed.threadId)) return invalidHydratedApprovalState();
      pendingByThread.add(parsed.threadId);
    }
    approvals[parsed.approvalRequestId] = parsed;
  }
  return Object.freeze({
    ...createConversationApprovalState(),
    approvals: Object.freeze(approvals),
  });
}
