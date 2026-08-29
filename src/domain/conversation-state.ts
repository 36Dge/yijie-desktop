export const CONVERSATION_STATE_SCHEMA_VERSION = 2 as const;
export const MAX_CONVERSATION_EVENT_IDS = 256;
export const MAX_CONVERSATION_NOTICES = 64;
export const MAX_CONVERSATION_DIAGNOSTICS = 64;

export const CONVERSATION_ITEM_KINDS = Object.freeze([
  "user_message",
  "assistant_message",
  "reasoning",
  // Reserved for later projections; FEAT-132 adapters normalize them to unknown.
  "command",
  "tool",
  "approval",
  "artifact",
  "unknown",
] as const);

export type ConversationItemKind = typeof CONVERSATION_ITEM_KINDS[number];
export type ConversationThreadStatus = "not_loaded" | "ready" | "active" | "archived" | "unavailable";
export type ConversationTurnStatus =
  | "queued"
  | "in_progress"
  | "waiting_approval"
  | "completed"
  | "interrupted"
  | "failed"
  | "recovery_required";
export type ConversationTerminalStatus = Extract<
  ConversationTurnStatus,
  "completed" | "failed" | "interrupted"
>;
export type ConversationItemStatus = "started" | "streaming" | "completed" | "incomplete";
export type ReconciliationStatus = "not_applicable" | "matched" | "mismatch";
export type ConversationAgentMessagePhase = "commentary" | "final_answer" | "unknown";
export type ConversationPlanStepStatus = "pending" | "in_progress" | "completed" | "unknown";
export type ConversationReasoningStatus =
  | "in_progress"
  | "complete"
  | "incomplete"
  | "unavailable"
  | "unknown";
export type ConversationReasoningReasonCode =
  | "reasoning_not_emitted"
  | "turn_interrupted"
  | "stream_gap"
  | "runtime_error"
  | "limit_exceeded"
  | "protocol_error"
  | "host_shutdown"
  | "unknown";

export interface ConversationPlanStep {
  readonly ordinal: number;
  readonly text: string;
  readonly status: ConversationPlanStepStatus;
}

export interface ConversationPlanSnapshot {
  readonly explanation: string | null;
  readonly steps: readonly ConversationPlanStep[];
}

export interface ConversationReasoningState {
  readonly status: ConversationReasoningStatus;
  readonly reasonCode: ConversationReasoningReasonCode | null;
}

export interface TextContentBlock {
  readonly blockIndex: number;
  readonly type: "text";
  readonly text: string;
}

export interface CodeContentBlock {
  readonly blockIndex: number;
  readonly type: "code";
  readonly language: string | null;
  readonly text: string;
}

export interface ArtifactReferenceContentBlock {
  readonly blockIndex: number;
  readonly type: "artifact_reference";
  readonly artifactId: string;
  readonly label: string | null;
}

export interface AttachmentReferenceContentBlock {
  readonly blockIndex: number;
  readonly type: "attachment_reference";
  readonly attachmentId: string;
  readonly kind: "file" | "image";
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly expiresAt: number;
}

export interface UnknownContentBlock {
  readonly blockIndex: number;
  readonly type: "unknown";
  readonly code: "unsupported_content";
}

export type ConversationContentBlock =
  | TextContentBlock
  | CodeContentBlock
  | ArtifactReferenceContentBlock
  | AttachmentReferenceContentBlock
  | UnknownContentBlock;

export interface ConversationThread {
  readonly threadId: string;
  readonly status: ConversationThreadStatus;
  readonly turnKeys: readonly string[];
  readonly notices: readonly ConversationNotice[];
}

export interface ConversationNotice {
  readonly severity: "error" | "warning";
  readonly code: "conversation_error" | "conversation_warning";
}

export interface ConversationTurn {
  readonly threadId: string;
  readonly turnId: string;
  readonly ordinal: number;
  readonly status: ConversationTurnStatus;
  readonly terminalStatus: ConversationTerminalStatus | null;
  readonly terminalCode: string | null;
  readonly plan: ConversationPlanSnapshot | null;
  readonly itemKeys: readonly string[];
  readonly notices: readonly ConversationNotice[];
}

export interface ConversationItem {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly ordinal: number;
  readonly kind: ConversationItemKind;
  readonly status: ConversationItemStatus;
  readonly agentMessagePhase: ConversationAgentMessagePhase | null;
  readonly reasoning: ConversationReasoningState | null;
  readonly contentBlocks: readonly ConversationContentBlock[];
  readonly reconciliation: ReconciliationStatus;
}

export interface ConversationRecovery {
  readonly code: "sequence_gap" | "invalid_transition" | "reconciliation_mismatch";
  readonly streamId: string;
  readonly expectedSequence: string | null;
  readonly receivedSequence: string;
}

export interface ConversationDiagnostic {
  readonly code: "unsupported_event";
}

export interface ConversationState {
  readonly schemaVersion: typeof CONVERSATION_STATE_SCHEMA_VERSION;
  readonly syncStatus: "synchronized" | "recovery_required";
  readonly threads: Readonly<Record<string, ConversationThread>>;
  readonly turns: Readonly<Record<string, ConversationTurn>>;
  readonly items: Readonly<Record<string, ConversationItem>>;
  readonly streamPositions: Readonly<Record<string, string>>;
  readonly processedEventIds: Readonly<Record<string, true>>;
  readonly recovery: ConversationRecovery | null;
  readonly diagnostics: readonly ConversationDiagnostic[];
}

export interface ConversationThreadSnapshot {
  readonly threadId: string;
  readonly status: ConversationThreadStatus;
  readonly notices?: readonly ConversationNotice[];
}

export interface ConversationTurnSnapshot {
  readonly threadId: string;
  readonly turnId: string;
  readonly ordinal: number;
  readonly status: ConversationTurnStatus;
  readonly terminalStatus: ConversationTerminalStatus | null;
  readonly terminalCode?: string | null;
  readonly plan?: ConversationPlanSnapshot | null;
  readonly notices?: readonly ConversationNotice[];
}

export interface ConversationItemSnapshot {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly ordinal: number;
  readonly kind: ConversationItemKind;
  readonly status: ConversationItemStatus;
  readonly agentMessagePhase?: ConversationAgentMessagePhase | null;
  readonly reasoning?: ConversationReasoningState | null;
  readonly contentBlocks: readonly ConversationContentBlock[];
  readonly reconciliation?: ReconciliationStatus;
}

export interface ConversationSnapshot {
  readonly threads: readonly ConversationThreadSnapshot[];
  readonly turns: readonly ConversationTurnSnapshot[];
  readonly items: readonly ConversationItemSnapshot[];
  readonly streamPositions?: readonly {
    readonly streamId: string;
    readonly lastSequence: string;
  }[];
}

interface EventCursor {
  readonly eventId: string;
  readonly streamId: string;
  readonly sequence: string;
  readonly threadId: string;
}

interface TurnEventCursor extends EventCursor {
  readonly turnId: string;
}

interface ItemEventCursor extends TurnEventCursor {
  readonly itemId: string;
}

export type ConversationEvent =
  | (EventCursor & { readonly kind: "auxiliary" })
  | (EventCursor & { readonly kind: "thread.started" })
  | (TurnEventCursor & { readonly kind: "turn.started"; readonly ordinal: number | null })
  | (ItemEventCursor & {
      readonly kind: "item.started";
      readonly ordinal: number;
      readonly itemKind: ConversationItemKind;
      readonly agentMessagePhase?: ConversationAgentMessagePhase | null;
      readonly initialBlocks?: readonly ConversationContentBlock[];
    })
  | (ItemEventCursor & {
      readonly kind: "item.delta";
      readonly ordinal: number;
      readonly itemKind: ConversationItemKind;
      readonly agentMessagePhase?: ConversationAgentMessagePhase | null;
      readonly blockIndex: number;
      readonly blockType: "text" | "code";
      readonly language?: string | null;
      readonly delta: string;
    })
  | (ItemEventCursor & {
      readonly kind: "item.completed";
      readonly ordinal?: number;
      readonly itemKind?: ConversationItemKind;
      readonly agentMessagePhase?: ConversationAgentMessagePhase | null;
      readonly finalBlocks?: readonly ConversationContentBlock[];
    })
  | (ItemEventCursor & {
      readonly kind: "reasoning.finalized";
      readonly ordinal: number;
      readonly status: Exclude<ConversationReasoningStatus, "in_progress">;
      readonly reasonCode: ConversationReasoningReasonCode | null;
      readonly finalBlocks: readonly ConversationContentBlock[];
    })
  | (TurnEventCursor & {
      readonly kind: "turn.plan.updated";
      readonly explanation: string | null;
      readonly steps: readonly Omit<ConversationPlanStep, "ordinal">[];
    })
  | (TurnEventCursor & {
      readonly kind: "turn.completed";
      readonly terminalStatus: ConversationTerminalStatus;
      readonly terminalCode?: string | null;
      readonly unfinishedItemStatus?: Extract<ConversationItemStatus, "completed" | "incomplete">;
      readonly unfinishedReasoningReasonCode?: ConversationReasoningReasonCode | null;
    })
  | (TurnEventCursor & {
      readonly kind: "notice";
      readonly severity: "error" | "warning";
    })
  | (EventCursor & {
      readonly kind: "thread.notice";
      readonly severity: "warning";
    })
  | (TurnEventCursor & { readonly kind: "unknown" });

const ITEM_KIND_SET: ReadonlySet<string> = new Set(CONVERSATION_ITEM_KINDS);
const PROJECTED_ITEM_KIND_SET: ReadonlySet<string> = new Set([
  "user_message",
  "assistant_message",
  "reasoning",
  "artifact",
  "unknown",
]);
const ACTIVE_TURN_STATUS_SET: ReadonlySet<ConversationTurnStatus> = new Set([
  "queued",
  "in_progress",
  "waiting_approval",
]);
const AGENT_MESSAGE_PHASE_SET: ReadonlySet<string> = new Set([
  "commentary",
  "final_answer",
  "unknown",
]);
const PLAN_STEP_STATUS_SET: ReadonlySet<string> = new Set([
  "pending",
  "in_progress",
  "completed",
  "unknown",
]);
const REASONING_STATUS_SET: ReadonlySet<string> = new Set([
  "in_progress",
  "complete",
  "incomplete",
  "unavailable",
  "unknown",
]);
const REASONING_REASON_CODE_SET: ReadonlySet<string> = new Set([
  "reasoning_not_emitted",
  "turn_interrupted",
  "stream_gap",
  "runtime_error",
  "limit_exceeded",
  "protocol_error",
  "host_shutdown",
  "unknown",
]);

export function createConversationState(): ConversationState {
  return {
    schemaVersion: CONVERSATION_STATE_SCHEMA_VERSION,
    syncStatus: "synchronized",
    threads: {},
    turns: {},
    items: {},
    streamPositions: {},
    processedEventIds: {},
    recovery: null,
    diagnostics: [],
  };
}

function compositeKey(...parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

function turnKey(threadId: string, turnId: string): string {
  return compositeKey(threadId, turnId);
}

function itemKey(threadId: string, turnId: string, itemId: string): string {
  return compositeKey(threadId, turnId, itemId);
}

function integer(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function canonicalSequence(value: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return "0";
  return BigInt(value).toString(10);
}

function expectedSequence(previous: string | undefined): string {
  return (BigInt(previous ?? "0") + 1n).toString(10);
}

function rememberEventId(
  processed: Readonly<Record<string, true>>,
  eventId: string,
): Readonly<Record<string, true>> {
  const retained = [...Object.keys(processed), eventId]
    .slice(-MAX_CONVERSATION_EVENT_IDS);
  return Object.freeze(Object.fromEntries(retained.map((id) => [id, true as const])));
}

function appendBounded<T>(values: readonly T[], value: T, limit: number): readonly T[] {
  return Object.freeze([...values, value].slice(-limit));
}

function isActiveTurn(turn: ConversationTurn): boolean {
  return turn.terminalStatus === null && ACTIVE_TURN_STATUS_SET.has(turn.status);
}

function hasActiveTurnConflict(
  state: ConversationState,
  threadId: string,
  turnId: string,
): boolean {
  return Object.values(state.turns).some((candidate) =>
    candidate.threadId === threadId &&
    candidate.turnId !== turnId &&
    isActiveTurn(candidate)
  );
}

function sanitizeKind(kind: ConversationItemKind): ConversationItemKind {
  return ITEM_KIND_SET.has(kind) && PROJECTED_ITEM_KIND_SET.has(kind) ? kind : "unknown";
}

function sanitizeAgentMessagePhase(
  kind: ConversationItemKind,
  phase: ConversationAgentMessagePhase | null | undefined,
): ConversationAgentMessagePhase | null {
  if (kind !== "assistant_message") return null;
  return typeof phase === "string" && AGENT_MESSAGE_PHASE_SET.has(phase)
    ? phase
    : "unknown";
}

export function conversationAgentMessagePhase(
  phase: "commentary" | "final_answer" | null | undefined,
): ConversationAgentMessagePhase {
  return phase === "commentary" || phase === "final_answer" ? phase : "unknown";
}

export function conversationReasoningReasonCode(
  reasonCode: string | null | undefined,
): ConversationReasoningReasonCode | null {
  if (reasonCode === null || reasonCode === undefined) return null;
  return REASONING_REASON_CODE_SET.has(reasonCode)
    ? reasonCode as ConversationReasoningReasonCode
    : "unknown";
}

function sanitizePlan(
  explanation: string | null,
  steps: readonly Omit<ConversationPlanStep, "ordinal">[],
): ConversationPlanSnapshot {
  return Object.freeze({
    explanation: typeof explanation === "string" ? explanation : null,
    steps: Object.freeze(steps.map((step, ordinal) => Object.freeze({
      ordinal,
      text: String(step.text),
      status: PLAN_STEP_STATUS_SET.has(step.status) ? step.status : "unknown",
    }))),
  });
}

function sanitizePlanOrNull(
  explanation: string | null,
  steps: readonly Omit<ConversationPlanStep, "ordinal">[],
): ConversationPlanSnapshot | null {
  return steps.length === 0 ? null : sanitizePlan(explanation, steps);
}

function sanitizePlanSnapshot(
  plan: ConversationPlanSnapshot | null | undefined,
): ConversationPlanSnapshot | null {
  if (plan === null || plan === undefined) return null;
  return sanitizePlanOrNull(plan.explanation, [...plan.steps]
    .sort((left, right) => integer(left.ordinal) - integer(right.ordinal))
    .map((step) => ({ text: step.text, status: step.status })));
}

function sanitizeReasoning(
  kind: ConversationItemKind,
  reasoning: ConversationReasoningState | null | undefined,
): ConversationReasoningState | null {
  if (kind !== "reasoning" || reasoning === null || reasoning === undefined) return null;
  const status = REASONING_STATUS_SET.has(reasoning.status)
    ? reasoning.status
    : "unknown";
  const reasonCode = conversationReasoningReasonCode(reasoning.reasonCode);
  return Object.freeze({ status, reasonCode });
}

function sanitizeTerminalCode(code: string | null | undefined): string | null {
  return typeof code === "string" && code.length > 0 ? code : null;
}

function sanitizeNotice(notice: ConversationNotice): ConversationNotice {
  return notice.severity === "error"
    ? { severity: "error", code: "conversation_error" }
    : { severity: "warning", code: "conversation_warning" };
}

function sanitizeBlock(block: ConversationContentBlock): ConversationContentBlock {
  const blockIndex = integer(block.blockIndex);
  switch (block.type) {
    case "text":
      return { blockIndex, type: "text", text: String(block.text) };
    case "code":
      return {
        blockIndex,
        type: "code",
        language: typeof block.language === "string" ? block.language : null,
        text: String(block.text),
      };
    case "artifact_reference":
      return {
        blockIndex,
        type: "artifact_reference",
        artifactId: String(block.artifactId),
        label: typeof block.label === "string" ? block.label : null,
      };
    case "attachment_reference":
      return {
        blockIndex,
        type: "attachment_reference",
        attachmentId: String(block.attachmentId),
        kind: block.kind === "image" ? "image" : "file",
        name: String(block.name),
        mediaType: String(block.mediaType),
        sizeBytes: integer(block.sizeBytes),
        status: String(block.status),
        expiresAt: integer(block.expiresAt),
      };
    case "unknown":
    default:
      return { blockIndex, type: "unknown", code: "unsupported_content" };
  }
}

function sanitizeBlocks(blocks: readonly ConversationContentBlock[]): readonly ConversationContentBlock[] {
  const byIndex = new Map<number, ConversationContentBlock>();
  for (const block of blocks) byIndex.set(integer(block.blockIndex), sanitizeBlock(block));
  return [...byIndex.values()].sort((left, right) => left.blockIndex - right.blockIndex);
}

function ensureThread(
  state: ConversationState,
  threadId: string,
  status: ConversationThreadStatus = "ready",
): ConversationState {
  if (state.threads[threadId]) return state;
  return {
    ...state,
    threads: {
      ...state.threads,
      [threadId]: { threadId, status, turnKeys: [], notices: [] },
    },
  };
}

function ensureTurn(
  state: ConversationState,
  threadId: string,
  turnId: string,
  ordinal: number | null = null,
): ConversationState {
  let next = ensureThread(state, threadId);
  const key = turnKey(threadId, turnId);
  if (next.turns[key]) return next;
  const thread = next.threads[threadId]!;
  const inferredOrdinal = Math.min(
    Number.MAX_SAFE_INTEGER,
    Object.values(next.turns)
      .filter((turn) => turn.threadId === threadId)
      .reduce((maximum, turn) => Math.max(maximum, integer(turn.ordinal)), -1) + 1,
  );
  const turn: ConversationTurn = {
    threadId,
    turnId,
    ordinal: ordinal === null ? inferredOrdinal : integer(ordinal),
    status: "queued",
    terminalStatus: null,
    terminalCode: null,
    plan: null,
    itemKeys: [],
    notices: [],
  };
  next = {
    ...next,
    threads: {
      ...next.threads,
      [threadId]: { ...thread, status: "active", turnKeys: [...thread.turnKeys, key] },
    },
    turns: { ...next.turns, [key]: turn },
  };
  return next;
}

function ensureItem(
  state: ConversationState,
  event: Pick<ItemEventCursor, "threadId" | "turnId" | "itemId">,
  itemKind: ConversationItemKind = "unknown",
  ordinal = 0,
  agentMessagePhase?: ConversationAgentMessagePhase | null,
): ConversationState {
  let next = ensureTurn(state, event.threadId, event.turnId);
  const key = itemKey(event.threadId, event.turnId, event.itemId);
  if (next.items[key]) return next;
  const parentKey = turnKey(event.threadId, event.turnId);
  const turn = next.turns[parentKey]!;
  const kind = sanitizeKind(itemKind);
  const item: ConversationItem = {
    threadId: event.threadId,
    turnId: event.turnId,
    itemId: event.itemId,
    ordinal: integer(ordinal),
    kind,
    status: "started",
    agentMessagePhase: sanitizeAgentMessagePhase(kind, agentMessagePhase),
    reasoning: kind === "reasoning"
      ? Object.freeze({ status: "in_progress", reasonCode: null })
      : null,
    contentBlocks: kind === "unknown"
      ? [{ blockIndex: 0, type: "unknown", code: "unsupported_content" }]
      : [],
    reconciliation: "not_applicable",
  };
  next = {
    ...next,
    turns: {
      ...next.turns,
      [parentKey]: { ...turn, itemKeys: [...turn.itemKeys, key] },
    },
    items: { ...next.items, [key]: item },
  };
  return next;
}

function replaceTurn(state: ConversationState, turn: ConversationTurn): ConversationState {
  return {
    ...state,
    turns: { ...state.turns, [turnKey(turn.threadId, turn.turnId)]: turn },
  };
}

function replaceItem(state: ConversationState, item: ConversationItem): ConversationState {
  return {
    ...state,
    items: { ...state.items, [itemKey(item.threadId, item.turnId, item.itemId)]: item },
  };
}

function completeTurnItems(
  state: ConversationState,
  threadId: string,
  turnId: string,
  unfinishedItemStatus: Extract<ConversationItemStatus, "completed" | "incomplete"> = "completed",
  unfinishedReasoningReasonCode: ConversationReasoningReasonCode | null = null,
): ConversationState {
  const turn = selectConversationTurn(state, threadId, turnId);
  if (turn === null) return state;
  let nextItems: Record<string, ConversationItem> | null = null;
  for (const key of turn.itemKeys) {
    const item = state.items[key];
    if (item === undefined) continue;
    const sealsItem = item.status !== "completed" && item.status !== "incomplete";
    const sealsReasoningPrefix = item.kind === "reasoning" &&
      (item.reasoning?.status === "in_progress" || item.reasoning?.status === "unknown") &&
      item.contentBlocks.length > 0 &&
      unfinishedReasoningReasonCode !== null;
    if (!sealsItem && !sealsReasoningPrefix) continue;
    if (nextItems === null) nextItems = { ...state.items };
    nextItems[key] = {
      ...item,
      status: sealsItem ? unfinishedItemStatus : item.status,
      reasoning: item.kind === "reasoning" &&
        (item.reasoning?.status === "in_progress" || item.reasoning?.status === "unknown")
        ? sealsReasoningPrefix
          ? Object.freeze({
              status: "incomplete" as const,
              reasonCode: unfinishedReasoningReasonCode,
            })
          : sealsItem
            ? Object.freeze({ status: "unknown" as const, reasonCode: null })
            : item.reasoning
        : item.reasoning,
      reconciliation: sealsReasoningPrefix ? "matched" : item.reconciliation,
    };
  }
  return nextItems === null ? state : { ...state, items: nextItems };
}

function sameBlock(left: ConversationContentBlock, right: ConversationContentBlock): boolean {
  if (left.type !== right.type || left.blockIndex !== right.blockIndex) return false;
  if (left.type === "text" && right.type === "text") return left.text === right.text;
  if (left.type === "code" && right.type === "code") {
    return left.language === right.language && left.text === right.text;
  }
  if (left.type === "artifact_reference" && right.type === "artifact_reference") {
    return left.artifactId === right.artifactId && left.label === right.label;
  }
  if (left.type === "attachment_reference" && right.type === "attachment_reference") {
    return left.attachmentId === right.attachmentId && left.kind === right.kind &&
      left.name === right.name && left.mediaType === right.mediaType &&
      left.sizeBytes === right.sizeBytes && left.status === right.status &&
      left.expiresAt === right.expiresAt;
  }
  return left.type === "unknown" && right.type === "unknown" && left.code === right.code;
}

function sameBlocks(
  left: readonly ConversationContentBlock[],
  right: readonly ConversationContentBlock[],
): boolean {
  return left.length === right.length && left.every((block, index) => {
    const candidate = right[index];
    return candidate !== undefined && sameBlock(block, candidate);
  });
}

function extendableBlock(
  current: ConversationContentBlock,
  finalBlock: ConversationContentBlock,
): ConversationContentBlock | null {
  if (current.type === "text" && finalBlock.type === "text" &&
      finalBlock.text.startsWith(current.text)) {
    return finalBlock;
  }
  if (current.type === "code" && finalBlock.type === "code" &&
      current.language === finalBlock.language && finalBlock.text.startsWith(current.text)) {
    return finalBlock;
  }
  return null;
}

function reconcileBlocks(
  current: readonly ConversationContentBlock[],
  finalBlocks: readonly ConversationContentBlock[] | undefined,
): { readonly blocks: readonly ConversationContentBlock[]; readonly status: ReconciliationStatus } {
  if (finalBlocks === undefined) return { blocks: current, status: "not_applicable" };
  const sanitizedFinal = sanitizeBlocks(finalBlocks);
  if (current.length === 0) return { blocks: sanitizedFinal, status: "matched" };

  const finalByIndex = new Map(sanitizedFinal.map((block) => [block.blockIndex, block]));
  const merged = new Map(current.map((block) => [block.blockIndex, block]));
  let mismatch = false;
  for (const finalBlock of sanitizedFinal) {
    const existing = merged.get(finalBlock.blockIndex);
    if (!existing) {
      merged.set(finalBlock.blockIndex, finalBlock);
      continue;
    }
    if (sameBlock(existing, finalBlock)) continue;
    const extended = extendableBlock(existing, finalBlock);
    if (extended) merged.set(finalBlock.blockIndex, extended);
    else mismatch = true;
  }
  for (const existing of current) {
    if (!finalByIndex.has(existing.blockIndex)) mismatch = true;
  }
  return {
    blocks: [...merged.values()].sort((left, right) => left.blockIndex - right.blockIndex),
    status: mismatch ? "mismatch" : "matched",
  };
}

function markRecovery(
  state: ConversationState,
  event: ConversationEvent,
  code: ConversationRecovery["code"],
  expected: string | null = null,
): ConversationState {
  let turns = state.turns;
  if ("turnId" in event) {
    const key = turnKey(event.threadId, event.turnId);
    const turn = turns[key];
    if (turn) turns = { ...turns, [key]: { ...turn, status: "recovery_required" } };
  }
  return {
    ...state,
    syncStatus: "recovery_required",
    turns,
    recovery: {
      code,
      streamId: event.streamId,
      expectedSequence: expected,
      receivedSequence: canonicalSequence(event.sequence),
    },
  };
}

function activateTurn(
  state: ConversationState,
  threadId: string,
  turnId: string,
  event: ConversationEvent,
): ConversationState {
  const turn = selectConversationTurn(state, threadId, turnId);
  if (turn === null) return state;
  if (hasActiveTurnConflict(state, threadId, turnId)) {
    return markRecovery(state, event, "invalid_transition");
  }
  if (turn.status === "in_progress") return state;
  const thread = state.threads[threadId]!;
  const next = replaceTurn(state, { ...turn, status: "in_progress" });
  return {
    ...next,
    threads: { ...next.threads, [threadId]: { ...thread, status: "active" } },
  };
}

function applyDelta(
  state: ConversationState,
  event: Extract<ConversationEvent, { kind: "item.delta" }>,
): ConversationState {
  const existingTurn = selectConversationTurn(state, event.threadId, event.turnId);
  if (existingTurn !== null && existingTurn.terminalStatus !== null) {
    return markRecovery(state, event, "invalid_transition");
  }
  if (hasActiveTurnConflict(state, event.threadId, event.turnId)) {
    return markRecovery(state, event, "invalid_transition");
  }
  const sanitizedKind = sanitizeKind(event.itemKind);
  const sanitizedPhase = sanitizeAgentMessagePhase(
    sanitizedKind,
    event.agentMessagePhase,
  );
  const existingItem = selectConversationItem(state, event.threadId, event.turnId, event.itemId);
  if (existingItem !== null &&
      (existingItem.kind !== sanitizedKind || existingItem.ordinal !== integer(event.ordinal) ||
       existingItem.agentMessagePhase !== sanitizedPhase)) {
    return markRecovery(state, event, "invalid_transition");
  }
  if (existingItem?.status === "completed" || existingItem?.status === "incomplete") {
    return markRecovery(state, event, "invalid_transition");
  }

  let next = existingItem === null
    ? ensureItem(state, event, sanitizedKind, event.ordinal, sanitizedPhase)
    : state;
  const key = itemKey(event.threadId, event.turnId, event.itemId);
  const item = next.items[key]!;
  if (item.kind === "unknown") {
    return {
      ...activateTurn(next, event.threadId, event.turnId, event),
      diagnostics: appendBounded(
        next.diagnostics,
        { code: "unsupported_event" },
        MAX_CONVERSATION_DIAGNOSTICS,
      ),
    };
  }
  const index = integer(event.blockIndex);
  const existing = item.contentBlocks.find((block) => block.blockIndex === index);
  let block: ConversationContentBlock;
  if (event.blockType === "code") {
    if (existing && existing.type !== "code") {
      return markRecovery(state, event, "invalid_transition");
    }
    block = {
      blockIndex: index,
      type: "code",
      language: existing?.type === "code"
        ? existing.language
        : typeof event.language === "string" ? event.language : null,
      text: `${existing?.type === "code" ? existing.text : ""}${event.delta}`,
    };
  } else {
    if (existing && existing.type !== "text") {
      return markRecovery(state, event, "invalid_transition");
    }
    block = {
      blockIndex: index,
      type: "text",
      text: `${existing?.type === "text" ? existing.text : ""}${event.delta}`,
    };
  }
  const contentBlocks = [
    ...item.contentBlocks.filter((candidate) => candidate.blockIndex !== index),
    block,
  ].sort((left, right) => left.blockIndex - right.blockIndex);
  next = replaceItem(next, { ...item, status: "streaming", contentBlocks });
  return activateTurn(next, event.threadId, event.turnId, event);
}

function applyDomainEvent(state: ConversationState, event: ConversationEvent): ConversationState {
  if ("turnId" in event && event.kind !== "unknown") {
    const existingTurn = selectConversationTurn(state, event.threadId, event.turnId);
    if (existingTurn !== null && existingTurn.terminalStatus !== null &&
        event.kind !== "turn.completed") {
      return markRecovery(state, event, "invalid_transition");
    }
  }
  switch (event.kind) {
    case "auxiliary":
      return state;
    case "thread.started": {
      const thread = state.threads[event.threadId];
      if (thread?.status === "archived" || thread?.status === "unavailable") {
        return markRecovery(state, event, "invalid_transition");
      }
      if (!thread) return ensureThread(state, event.threadId);
      if (Object.values(state.turns).some((turn) =>
        turn.threadId === event.threadId && isActiveTurn(turn)
      )) return state;
      return {
        ...state,
        threads: { ...state.threads, [event.threadId]: { ...thread, status: "ready" } },
      };
    }
    case "turn.started": {
      if (hasActiveTurnConflict(state, event.threadId, event.turnId)) {
        return markRecovery(state, event, "invalid_transition");
      }
      const existing = selectConversationTurn(state, event.threadId, event.turnId);
      const projectedOrdinal = event.ordinal === null ? null : integer(event.ordinal);
      if (existing !== null &&
          ((projectedOrdinal !== null && existing.ordinal !== projectedOrdinal) ||
           existing.status === "recovery_required")) {
        return markRecovery(state, event, "invalid_transition");
      }
      const ordinal = existing?.ordinal ?? projectedOrdinal;
      const next = ensureTurn(state, event.threadId, event.turnId, ordinal);
      return activateTurn(next, event.threadId, event.turnId, event);
    }
    case "item.started": {
      if (hasActiveTurnConflict(state, event.threadId, event.turnId)) {
        return markRecovery(state, event, "invalid_transition");
      }
      const kind = sanitizeKind(event.itemKind);
      const agentMessagePhase = sanitizeAgentMessagePhase(kind, event.agentMessagePhase);
      const existing = selectConversationItem(state, event.threadId, event.turnId, event.itemId);
      if (existing !== null &&
          (existing.kind !== kind || existing.ordinal !== integer(event.ordinal) ||
           existing.agentMessagePhase !== agentMessagePhase ||
           (existing.status !== "started" && existing.status !== "streaming"))) {
        return markRecovery(state, event, "invalid_transition");
      }
      let next = existing === null
        ? ensureItem(state, event, kind, event.ordinal, agentMessagePhase)
        : state;
      const initialBlocks = kind === "unknown"
        ? [{ blockIndex: 0, type: "unknown", code: "unsupported_content" } as const]
        : sanitizeBlocks(event.initialBlocks ?? []);
      const item = selectConversationItem(next, event.threadId, event.turnId, event.itemId)!;
      if (item.contentBlocks.length === 0 && initialBlocks.length > 0) {
        next = replaceItem(next, { ...item, contentBlocks: initialBlocks });
      } else if (initialBlocks.length > 0 && !sameBlocks(item.contentBlocks, initialBlocks)) {
        return markRecovery(state, event, "invalid_transition");
      }
      return activateTurn(next, event.threadId, event.turnId, event);
    }
    case "item.delta":
      return applyDelta(state, event);
    case "item.completed": {
      if (hasActiveTurnConflict(state, event.threadId, event.turnId)) {
        return markRecovery(state, event, "invalid_transition");
      }
      let nextState = state;
      let item = selectConversationItem(state, event.threadId, event.turnId, event.itemId);
      if (item === null) {
        if (event.ordinal === undefined || event.itemKind === undefined) {
          return markRecovery(state, event, "invalid_transition");
        }
        const kind = sanitizeKind(event.itemKind);
        nextState = ensureItem(
          state,
          event,
          kind,
          event.ordinal,
          sanitizeAgentMessagePhase(kind, event.agentMessagePhase),
        );
        item = selectConversationItem(
          nextState,
          event.threadId,
          event.turnId,
          event.itemId,
        );
      }
      if (item === null || item.status === "completed" || item.status === "incomplete") {
        return markRecovery(state, event, "invalid_transition");
      }
      const projectedKind = event.itemKind === undefined
        ? item.kind
        : sanitizeKind(event.itemKind);
      const projectedOrdinal = event.ordinal === undefined
        ? item.ordinal
        : integer(event.ordinal);
      const projectedPhase = event.agentMessagePhase === undefined
        ? item.agentMessagePhase
        : sanitizeAgentMessagePhase(projectedKind, event.agentMessagePhase);
      if (item.kind !== projectedKind || item.ordinal !== projectedOrdinal ||
          item.agentMessagePhase !== projectedPhase) {
        return markRecovery(state, event, "invalid_transition");
      }
      if (item.kind === "unknown") {
        return activateTurn(
          replaceItem(nextState, { ...item, status: "completed" }),
          event.threadId,
          event.turnId,
          event,
        );
      }
      const reconciled = event.finalBlocks === undefined
        ? { blocks: item.contentBlocks, status: item.reconciliation }
        : reconcileBlocks(item.contentBlocks, event.finalBlocks);
      const next = replaceItem(nextState, {
        ...item,
        status: "completed",
        reasoning: item.kind === "reasoning" && item.reasoning?.status === "in_progress"
          ? Object.freeze({ status: "unknown", reasonCode: null })
          : item.reasoning,
        contentBlocks: reconciled.blocks,
        reconciliation: reconciled.status,
      });
      return reconciled.status === "mismatch"
        ? markRecovery(next, event, "reconciliation_mismatch")
        : activateTurn(next, event.threadId, event.turnId, event);
    }
    case "reasoning.finalized": {
      const existing = selectConversationItem(state, event.threadId, event.turnId, event.itemId);
      if (existing !== null &&
          (existing.kind !== "reasoning" || existing.ordinal !== integer(event.ordinal))) {
        return markRecovery(state, event, "invalid_transition");
      }
      let next = existing === null
        ? ensureItem(state, event, "reasoning", event.ordinal)
        : state;
      const item = selectConversationItem(next, event.threadId, event.turnId, event.itemId)!;
      const reasoning = sanitizeReasoning("reasoning", {
        status: event.status,
        reasonCode: event.reasonCode,
      })!;
      if (item.reasoning !== null && item.reasoning.status !== "in_progress") {
        if (item.reasoning.status === reasoning.status &&
            item.reasoning.reasonCode === reasoning.reasonCode) return next;
        return markRecovery(state, event, "invalid_transition");
      }
      // The v4 reasoning contract defines finalized contents as an authoritative
      // replacement for the low-latency delta buffer. This deliberately differs
      // from AgentMessage completion prefix reconciliation; `unavailable` may
      // also replace a previously displayed buffer with an empty snapshot.
      const finalizedBlocks = sanitizeBlocks(event.finalBlocks);
      next = replaceItem(next, {
        ...item,
        status: item.status === "started" ? "streaming" : item.status,
        reasoning,
        contentBlocks: finalizedBlocks,
        reconciliation: "matched",
      });
      return activateTurn(next, event.threadId, event.turnId, event);
    }
    case "turn.plan.updated": {
      if (hasActiveTurnConflict(state, event.threadId, event.turnId)) {
        return markRecovery(state, event, "invalid_transition");
      }
      const next = ensureTurn(state, event.threadId, event.turnId);
      const activated = activateTurn(next, event.threadId, event.turnId, event);
      if (activated.syncStatus === "recovery_required") return activated;
      const turn = selectConversationTurn(activated, event.threadId, event.turnId)!;
      return replaceTurn(activated, {
        ...turn,
        plan: sanitizePlanOrNull(event.explanation, event.steps),
      });
    }
    case "turn.completed": {
      const existing = selectConversationTurn(state, event.threadId, event.turnId);
      const projectedTerminalCode = sanitizeTerminalCode(event.terminalCode);
      if (existing?.terminalStatus === event.terminalStatus &&
          existing.terminalCode === projectedTerminalCode) return state;
      if (existing !== null && existing.terminalStatus !== null) {
        return markRecovery(state, event, "invalid_transition");
      }
      if (hasActiveTurnConflict(state, event.threadId, event.turnId)) {
        return markRecovery(state, event, "invalid_transition");
      }
      const next = existing === null
        ? ensureTurn(state, event.threadId, event.turnId)
        : state;
      const turn = selectConversationTurn(next, event.threadId, event.turnId)!;
      const completed = replaceTurn(next, {
        ...turn,
        status: event.terminalStatus,
        terminalStatus: event.terminalStatus,
        terminalCode: projectedTerminalCode,
      });
      const sealed = completeTurnItems(
        completed,
        event.threadId,
        event.turnId,
        event.unfinishedItemStatus,
        event.unfinishedReasoningReasonCode,
      );
      const thread = sealed.threads[event.threadId]!;
      const hasRemainingActiveTurn = Object.values(sealed.turns).some((candidate) =>
        candidate.threadId === event.threadId && isActiveTurn(candidate)
      );
      return {
        ...sealed,
        threads: {
          ...sealed.threads,
          [event.threadId]: { ...thread, status: hasRemainingActiveTurn ? "active" : "ready" },
        },
      };
    }
    case "notice": {
      if (hasActiveTurnConflict(state, event.threadId, event.turnId)) {
        return markRecovery(state, event, "invalid_transition");
      }
      const next = ensureTurn(state, event.threadId, event.turnId);
      const activated = activateTurn(next, event.threadId, event.turnId, event);
      if (activated.syncStatus === "recovery_required") return activated;
      const turn = selectConversationTurn(activated, event.threadId, event.turnId)!;
      const notice: ConversationNotice = event.severity === "error"
        ? { severity: "error", code: "conversation_error" }
        : { severity: "warning", code: "conversation_warning" };
      return replaceTurn(activated, {
        ...turn,
        notices: appendBounded(turn.notices, notice, MAX_CONVERSATION_NOTICES),
      });
    }
    case "thread.notice": {
      const next = ensureThread(state, event.threadId);
      const thread = next.threads[event.threadId]!;
      return {
        ...next,
        threads: {
          ...next.threads,
          [event.threadId]: {
            ...thread,
            notices: appendBounded(
              thread.notices,
              { severity: "warning", code: "conversation_warning" },
              MAX_CONVERSATION_NOTICES,
            ),
          },
        },
      };
    }
    case "unknown":
      return {
        ...state,
        diagnostics: appendBounded(
          state.diagnostics,
          { code: "unsupported_event" },
          MAX_CONVERSATION_DIAGNOSTICS,
        ),
      };
    default:
      return {
        ...state,
        diagnostics: appendBounded(
          state.diagnostics,
          { code: "unsupported_event" },
          MAX_CONVERSATION_DIAGNOSTICS,
        ),
      };
  }
}

export function reduceConversationEvent(
  state: ConversationState,
  event: ConversationEvent,
): ConversationState {
  if (state.processedEventIds[event.eventId]) return state;
  if (state.recovery !== null) return state;

  const received = canonicalSequence(event.sequence);
  const expected = expectedSequence(state.streamPositions[event.streamId]);
  if (received !== expected) {
    return markRecovery(state, event, "sequence_gap", expected);
  }

  const tracked: ConversationState = {
    ...state,
    streamPositions: { ...state.streamPositions, [event.streamId]: received },
    processedEventIds: rememberEventId(state.processedEventIds, event.eventId),
  };
  return applyDomainEvent(tracked, event);
}

export function reduceConversationEvents(
  state: ConversationState,
  events: readonly ConversationEvent[],
): ConversationState {
  return events.reduce(reduceConversationEvent, state);
}

export function hydrateConversationState(snapshot: ConversationSnapshot): ConversationState {
  let state = createConversationState();
  const orderedThreads = [...snapshot.threads]
    .sort((left, right) => left.threadId.localeCompare(right.threadId));
  const orderedTurns = [...snapshot.turns].sort((left, right) =>
    left.ordinal - right.ordinal || left.turnId.localeCompare(right.turnId));
  for (const thread of orderedThreads) {
    state = ensureThread(state, thread.threadId, thread.status);
    const current = state.threads[thread.threadId]!;
    state = {
      ...state,
      threads: {
        ...state.threads,
        [thread.threadId]: {
          ...current,
          notices: Object.freeze((thread.notices ?? [])
            .slice(-MAX_CONVERSATION_NOTICES)
            .map(sanitizeNotice)),
        },
      },
    };
  }
  for (const input of orderedTurns) {
    state = ensureTurn(state, input.threadId, input.turnId, input.ordinal);
    const current = selectConversationTurn(state, input.threadId, input.turnId)!;
    state = replaceTurn(state, {
      ...current,
      ordinal: integer(input.ordinal),
      status: input.status,
      terminalStatus: input.terminalStatus,
      terminalCode: sanitizeTerminalCode(input.terminalCode),
      plan: sanitizePlanSnapshot(input.plan),
      notices: Object.freeze((input.notices ?? [])
        .slice(-MAX_CONVERSATION_NOTICES)
        .map(sanitizeNotice)),
    });
  }
  for (const input of [...snapshot.items].sort((left, right) =>
    left.ordinal - right.ordinal || left.itemId.localeCompare(right.itemId))) {
    state = ensureItem(state, input, input.kind, input.ordinal);
    const current = selectConversationItem(state, input.threadId, input.turnId, input.itemId)!;
    const kind = sanitizeKind(input.kind);
    state = replaceItem(state, {
      ...current,
      ordinal: integer(input.ordinal),
      kind,
      status: input.status,
      agentMessagePhase: sanitizeAgentMessagePhase(kind, input.agentMessagePhase),
      reasoning: sanitizeReasoning(kind, input.reasoning),
      contentBlocks: kind === "unknown"
        ? [{ blockIndex: 0, type: "unknown", code: "unsupported_content" }]
        : sanitizeBlocks(input.contentBlocks),
      reconciliation: input.reconciliation ?? "not_applicable",
    });
  }
  const streamPositions: Record<string, string> = {};
  for (const position of snapshot.streamPositions ?? []) {
    streamPositions[position.streamId] = canonicalSequence(position.lastSequence);
  }
  // Relationship construction activates parent threads. Restore the
  // authoritative lifecycle only after all children have been materialized.
  for (const input of orderedThreads) {
    const thread = state.threads[input.threadId];
    if (thread !== undefined) {
      state = {
        ...state,
        threads: {
          ...state.threads,
          [input.threadId]: {
            ...thread,
            status: input.status,
            notices: Object.freeze((input.notices ?? [])
              .slice(-MAX_CONVERSATION_NOTICES)
              .map(sanitizeNotice)),
          },
        },
      };
    }
  }

  const hydrated = { ...state, streamPositions };
  const invalidSnapshotKeys = new Set(orderedTurns
    .filter((turn) => {
      const terminal = turn.status === "completed" ||
        turn.status === "interrupted" || turn.status === "failed";
      return turn.status === "recovery_required" ||
        (terminal ? turn.terminalStatus !== turn.status : turn.terminalStatus !== null);
    })
    .map((turn) => turnKey(turn.threadId, turn.turnId)));
  const activeTurnsByThread = new Map<string, ConversationTurn[]>();
  for (const turn of Object.values(hydrated.turns)) {
    if (!isActiveTurn(turn)) continue;
    const active = activeTurnsByThread.get(turn.threadId) ?? [];
    active.push(turn);
    activeTurnsByThread.set(turn.threadId, active);
  }
  const conflictingThreadIds = new Set([...activeTurnsByThread]
    .filter(([, turns]) => turns.length > 1)
    .map(([threadId]) => threadId));
  if (invalidSnapshotKeys.size === 0 && conflictingThreadIds.size === 0) return hydrated;
  const turns = Object.fromEntries(Object.entries(hydrated.turns).map(([key, turn]) => [
    key,
    invalidSnapshotKeys.has(key) || (conflictingThreadIds.has(turn.threadId) && isActiveTurn(turn))
      ? { ...turn, status: "recovery_required" as const }
      : turn,
  ]));
  return {
    ...hydrated,
    syncStatus: "recovery_required",
    turns,
    recovery: {
      code: "invalid_transition",
      streamId: "snapshot",
      expectedSequence: null,
      receivedSequence: "0",
    },
  };
}

function markSnapshotRecovery(
  state: ConversationState,
  threadId: string,
  turnId: string,
): ConversationState {
  const turns: Record<string, ConversationTurn> = { ...state.turns };
  for (const [key, turn] of Object.entries(turns)) {
    if (turn.threadId === threadId && turn.turnId === turnId) {
      turns[key] = { ...turn, status: "recovery_required" };
    }
  }
  return {
    ...state,
    syncStatus: "recovery_required",
    turns,
    recovery: {
      code: "reconciliation_mismatch",
      streamId: "snapshot",
      expectedSequence: null,
      receivedSequence: "0",
    },
  };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function reconcileConversationSnapshot(
  current: ConversationState,
  snapshot: ConversationSnapshot,
): ConversationState {
  if (current.recovery?.code === "sequence_gap") {
    return hydrateConversationState(snapshot);
  }
  let next = hydrateConversationState(snapshot);
  if (next.syncStatus === "recovery_required") return next;
  const threadInputs = new Map(snapshot.threads.map((thread) => [thread.threadId, thread]));
  const turnInputs = new Map(snapshot.turns.map((turn) => [
    turnKey(turn.threadId, turn.turnId),
    turn,
  ]));
  const itemInputs = new Map(snapshot.items.map((item) => [
    itemKey(item.threadId, item.turnId, item.itemId),
    item,
  ]));
  for (const liveThread of Object.values(current.threads)) {
    const authoritativeThread = next.threads[liveThread.threadId];
    const input = threadInputs.get(liveThread.threadId);
    if (authoritativeThread !== undefined && input !== undefined && !hasOwn(input, "notices")) {
      next = {
        ...next,
        threads: {
          ...next.threads,
          [liveThread.threadId]: { ...authoritativeThread, notices: liveThread.notices },
        },
      };
    }
  }
  const lifecycleMismatches = new Map<string, ConversationTurn>();
  for (const liveTurn of Object.values(current.turns)) {
    const authoritativeTurn = selectConversationTurn(
      next,
      liveTurn.threadId,
      liveTurn.turnId,
    );
    const input = turnInputs.get(turnKey(liveTurn.threadId, liveTurn.turnId));
    if (liveTurn.terminalStatus !== null &&
        (authoritativeTurn === null ||
         authoritativeTurn.terminalStatus !== liveTurn.terminalStatus ||
         (input !== undefined && hasOwn(input, "terminalCode") &&
          authoritativeTurn.terminalCode !== liveTurn.terminalCode))) {
      lifecycleMismatches.set(turnKey(liveTurn.threadId, liveTurn.turnId), liveTurn);
      continue;
    }
    if (authoritativeTurn !== null && input !== undefined) {
      next = replaceTurn(next, {
        ...authoritativeTurn,
        terminalCode: hasOwn(input, "terminalCode")
          ? authoritativeTurn.terminalCode
          : liveTurn.terminalCode,
        plan: hasOwn(input, "plan") ? authoritativeTurn.plan : liveTurn.plan,
      });
    }
  }
  const liveItems = Object.values(current.items).sort((left, right) =>
    left.threadId.localeCompare(right.threadId) ||
    left.turnId.localeCompare(right.turnId) ||
    left.ordinal - right.ordinal ||
    left.itemId.localeCompare(right.itemId));
  for (const liveItem of liveItems) {
    const liveTurn = selectConversationTurn(
      current,
      liveItem.threadId,
      liveItem.turnId,
    );
    if (liveTurn === null) continue;

    const authoritativeTurn = selectConversationTurn(
      next,
      liveItem.threadId,
      liveItem.turnId,
    );
    let authoritativeItem = selectConversationItem(
      next,
      liveItem.threadId,
      liveItem.turnId,
      liveItem.itemId,
    );
    const itemInput = itemInputs.get(itemKey(
      liveItem.threadId,
      liveItem.turnId,
      liveItem.itemId,
    ));
    let metadataMismatch = false;
    if (authoritativeItem !== null && itemInput !== undefined) {
      let agentMessagePhase = authoritativeItem.agentMessagePhase;
      if (!hasOwn(itemInput, "agentMessagePhase")) {
        agentMessagePhase = liveItem.agentMessagePhase;
      } else if (liveItem.agentMessagePhase !== null &&
          liveItem.agentMessagePhase !== authoritativeItem.agentMessagePhase) {
        if (liveItem.agentMessagePhase === "unknown" &&
            authoritativeItem.agentMessagePhase !== "unknown") {
          agentMessagePhase = authoritativeItem.agentMessagePhase;
        } else {
          agentMessagePhase = liveItem.agentMessagePhase;
          metadataMismatch = true;
        }
      }

      let reasoning = authoritativeItem.reasoning;
      if (!hasOwn(itemInput, "reasoning")) {
        reasoning = liveItem.reasoning;
      } else if (liveItem.reasoning !== null && authoritativeItem.reasoning !== null &&
          (liveItem.reasoning.status !== authoritativeItem.reasoning.status ||
           liveItem.reasoning.reasonCode !== authoritativeItem.reasoning.reasonCode)) {
        if (liveItem.reasoning.status !== "in_progress") {
          reasoning = liveItem.reasoning;
          metadataMismatch = true;
        }
      } else if (liveItem.reasoning !== null && authoritativeItem.reasoning === null) {
        reasoning = liveItem.reasoning;
        metadataMismatch = true;
      }
      authoritativeItem = {
        ...authoritativeItem,
        agentMessagePhase,
        reasoning,
      };
      next = replaceItem(next, authoritativeItem);
    }
    if (lifecycleMismatches.has(turnKey(liveItem.threadId, liveItem.turnId))) {
      next = ensureTurn(next, liveItem.threadId, liveItem.turnId, liveTurn.ordinal);
      next = ensureItem(next, liveItem, liveItem.kind, liveItem.ordinal);
      next = replaceItem(next, liveItem);
      continue;
    }
    if (authoritativeTurn === null && liveTurn.terminalStatus === null) continue;
    if (liveItem.kind === "reasoning" && authoritativeTurn !== null && authoritativeItem === null) {
      continue;
    }
    if (authoritativeItem === null && authoritativeTurn?.terminalStatus === null) continue;
    if (authoritativeTurn === null || authoritativeItem === null ||
        authoritativeItem.kind !== liveItem.kind ||
        authoritativeItem.ordinal !== liveItem.ordinal) {
      next = ensureTurn(next, liveItem.threadId, liveItem.turnId, liveTurn.ordinal);
      next = ensureItem(next, liveItem, liveItem.kind, liveItem.ordinal);
      next = replaceItem(next, { ...liveItem, reconciliation: "mismatch" });
      next = markSnapshotRecovery(next, liveItem.threadId, liveItem.turnId);
      continue;
    }

    if (authoritativeItem.kind === "reasoning" && authoritativeItem.contentBlocks.length === 0) {
      next = replaceItem(next, {
        ...authoritativeItem,
        contentBlocks: liveItem.contentBlocks,
        reconciliation: "not_applicable",
      });
      if (metadataMismatch) {
        next = markSnapshotRecovery(next, liveItem.threadId, liveItem.turnId);
      }
      continue;
    }

    if (authoritativeItem.status !== "completed" && authoritativeItem.status !== "incomplete") {
      next = replaceItem(next, {
        ...liveItem,
        agentMessagePhase: authoritativeItem.agentMessagePhase,
        reasoning: authoritativeItem.reasoning,
      });
      const nextTurn = selectConversationTurn(next, liveItem.threadId, liveItem.turnId);
      if (nextTurn !== null && liveTurn.status === "in_progress") {
        next = replaceTurn(next, { ...nextTurn, status: "in_progress", terminalStatus: null });
        const thread = next.threads[liveItem.threadId]!;
        next = {
          ...next,
          threads: {
            ...next.threads,
            [liveItem.threadId]: { ...thread, status: "active" },
          },
        };
      }
      if (metadataMismatch) {
        next = markSnapshotRecovery(next, liveItem.threadId, liveItem.turnId);
      }
      continue;
    }

    const reconciled = reconcileBlocks(liveItem.contentBlocks, authoritativeItem.contentBlocks);
    next = replaceItem(next, {
      ...authoritativeItem,
      contentBlocks: reconciled.blocks,
      reconciliation: reconciled.status,
    });
    if (reconciled.status === "mismatch") {
      next = markSnapshotRecovery(next, liveItem.threadId, liveItem.turnId);
    } else if (metadataMismatch) {
      next = markSnapshotRecovery(next, liveItem.threadId, liveItem.turnId);
    }
  }
  for (const liveTurn of lifecycleMismatches.values()) {
    next = ensureTurn(next, liveTurn.threadId, liveTurn.turnId, liveTurn.ordinal);
    next = replaceTurn(next, liveTurn);
    next = markSnapshotRecovery(next, liveTurn.threadId, liveTurn.turnId);
  }
  return next;
}

function invalidOlderSnapshot(current: ConversationState): ConversationState {
  if (current.syncStatus === "recovery_required") return current;
  return {
    ...current,
    syncStatus: "recovery_required",
    recovery: {
      code: "invalid_transition",
      streamId: "snapshot",
      expectedSequence: null,
      receivedSequence: "0",
    },
  };
}

/**
 * Adds an immutable, cursor-paginated history page without treating that older
 * page as a fresh snapshot of the live thread. Existing state is preserved;
 * only disjoint terminal Turns and their Items may be prepended.
 */
export function appendOlderConversationSnapshot(
  current: ConversationState,
  olderSnapshot: ConversationSnapshot,
): ConversationState {
  if (current.syncStatus === "recovery_required") return current;
  const older = hydrateConversationState(olderSnapshot);
  if (older.syncStatus === "recovery_required") return invalidOlderSnapshot(current);

  const olderTurns = Object.values(older.turns);
  if (olderTurns.length === 0) return current;
  const olderThreadIds = new Set(olderTurns.map((turn) => turn.threadId));
  if (
    [...olderThreadIds].some((threadId) => current.threads[threadId] === undefined) ||
    olderTurns.some((turn) =>
      turn.terminalStatus === null ||
      turn.status !== turn.terminalStatus ||
      current.turns[turnKey(turn.threadId, turn.turnId)] !== undefined
    ) ||
    Object.values(older.items).some((item) =>
      current.items[itemKey(item.threadId, item.turnId, item.itemId)] !== undefined
    )
  ) {
    return invalidOlderSnapshot(current);
  }

  const addedTurnCount = new Map<string, number>();
  for (const turn of olderTurns) {
    addedTurnCount.set(turn.threadId, (addedTurnCount.get(turn.threadId) ?? 0) + 1);
  }
  if (Object.values(current.turns).some((turn) =>
    turn.ordinal > Number.MAX_SAFE_INTEGER - (addedTurnCount.get(turn.threadId) ?? 0)
  )) {
    return invalidOlderSnapshot(current);
  }

  const turns: Record<string, ConversationTurn> = {};
  for (const [key, turn] of Object.entries(current.turns)) {
    turns[key] = {
      ...turn,
      ordinal: turn.ordinal + (addedTurnCount.get(turn.threadId) ?? 0),
    };
  }
  for (const threadId of olderThreadIds) {
    const ordered = olderTurns
      .filter((turn) => turn.threadId === threadId)
      .sort((left, right) => left.ordinal - right.ordinal || left.turnId.localeCompare(right.turnId));
    ordered.forEach((turn, ordinal) => {
      turns[turnKey(threadId, turn.turnId)] = { ...turn, ordinal };
    });
  }

  const items: Record<string, ConversationItem> = { ...current.items };
  for (const [key, item] of Object.entries(older.items)) items[key] = item;

  const threads: Record<string, ConversationThread> = { ...current.threads };
  for (const threadId of olderThreadIds) {
    const currentThread = current.threads[threadId]!;
    threads[threadId] = {
      ...currentThread,
      turnKeys: Object.entries(turns)
        .filter(([, turn]) => turn.threadId === threadId)
        .sort(([, left], [, right]) =>
          left.ordinal - right.ordinal || left.turnId.localeCompare(right.turnId)
        )
        .map(([key]) => key),
    };
  }

  return {
    ...current,
    threads,
    turns,
    items,
  };
}

export function selectConversationTurn(
  state: ConversationState,
  threadId: string,
  turnId: string,
): ConversationTurn | null {
  return state.turns[turnKey(threadId, turnId)] ?? null;
}

export function selectConversationItem(
  state: ConversationState,
  threadId: string,
  turnId: string,
  itemId: string,
): ConversationItem | null {
  return state.items[itemKey(threadId, turnId, itemId)] ?? null;
}

function canonicalTurn(turn: ConversationTurn) {
  return {
    threadId: turn.threadId,
    turnId: turn.turnId,
    ordinal: turn.ordinal,
    status: turn.status,
    terminalStatus: turn.terminalStatus,
    terminalCode: turn.terminalCode,
    plan: turn.plan === null
      ? null
      : {
          explanation: turn.plan.explanation,
          steps: [...turn.plan.steps]
            .sort((left, right) => left.ordinal - right.ordinal)
            .map((step) => ({
              ordinal: step.ordinal,
              text: step.text,
              status: step.status,
            })),
        },
    notices: [...turn.notices].sort((left, right) =>
      left.severity.localeCompare(right.severity) || left.code.localeCompare(right.code)),
  };
}

function canonicalItem(item: ConversationItem) {
  return {
    threadId: item.threadId,
    turnId: item.turnId,
    itemId: item.itemId,
    ordinal: item.ordinal,
    kind: item.kind,
    status: item.status,
    agentMessagePhase: item.agentMessagePhase,
    reasoning: item.reasoning,
    reconciliation: item.reconciliation,
    contentBlocks: [...item.contentBlocks].sort((left, right) => left.blockIndex - right.blockIndex),
  };
}

export function serializeConversationState(state: ConversationState): string {
  const threads = Object.values(state.threads)
    .sort((left, right) => left.threadId.localeCompare(right.threadId))
    .map((thread) => ({
      threadId: thread.threadId,
      status: thread.status,
      notices: [...thread.notices].sort((left, right) =>
        left.severity.localeCompare(right.severity) || left.code.localeCompare(right.code)),
    }));
  const turns = Object.values(state.turns)
    .sort((left, right) =>
      left.threadId.localeCompare(right.threadId) ||
      left.ordinal - right.ordinal ||
      left.turnId.localeCompare(right.turnId))
    .map(canonicalTurn);
  const items = Object.values(state.items)
    .sort((left, right) =>
      left.threadId.localeCompare(right.threadId) ||
      left.turnId.localeCompare(right.turnId) ||
      left.ordinal - right.ordinal ||
      left.itemId.localeCompare(right.itemId))
    .map(canonicalItem);
  const streamPositions = Object.entries(state.streamPositions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([streamId, lastSequence]) => ({ streamId, lastSequence }));

  return JSON.stringify({
    schemaVersion: state.schemaVersion,
    syncStatus: state.syncStatus,
    recovery: state.recovery,
    streamPositions,
    processedEventIds: Object.keys(state.processedEventIds).sort(),
    diagnostics: [...state.diagnostics].sort((left, right) => left.code.localeCompare(right.code)),
    threads,
    turns,
    items,
  });
}
