export const CONVERSATION_STATE_SCHEMA_VERSION = 1 as const;
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
export type ConversationItemStatus = "started" | "streaming" | "completed";
export type ReconciliationStatus = "not_applicable" | "matched" | "mismatch";

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
}

export interface ConversationTurnSnapshot {
  readonly threadId: string;
  readonly turnId: string;
  readonly ordinal: number;
  readonly status: ConversationTurnStatus;
  readonly terminalStatus: ConversationTerminalStatus | null;
  readonly notices?: readonly ConversationNotice[];
}

export interface ConversationItemSnapshot {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly ordinal: number;
  readonly kind: ConversationItemKind;
  readonly status: ConversationItemStatus;
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
    })
  | (ItemEventCursor & {
      readonly kind: "item.delta";
      readonly ordinal: number;
      readonly itemKind: ConversationItemKind;
      readonly blockIndex: number;
      readonly blockType: "text" | "code";
      readonly language?: string | null;
      readonly delta: string;
    })
  | (ItemEventCursor & {
      readonly kind: "item.completed";
      readonly finalBlocks?: readonly ConversationContentBlock[];
    })
  | (TurnEventCursor & {
      readonly kind: "turn.completed";
      readonly terminalStatus: ConversationTerminalStatus;
    })
  | (TurnEventCursor & {
      readonly kind: "notice";
      readonly severity: "error" | "warning";
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
      [threadId]: { threadId, status, turnKeys: [] },
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
): ConversationState {
  const turn = selectConversationTurn(state, threadId, turnId);
  if (turn === null) return state;
  let nextItems: Record<string, ConversationItem> | null = null;
  for (const key of turn.itemKeys) {
    const item = state.items[key];
    if (item === undefined || item.status === "completed") continue;
    if (nextItems === null) nextItems = { ...state.items };
    nextItems[key] = { ...item, status: "completed" };
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
  const existingItem = selectConversationItem(state, event.threadId, event.turnId, event.itemId);
  if (existingItem !== null &&
      (existingItem.kind !== sanitizedKind || existingItem.ordinal !== integer(event.ordinal))) {
    return markRecovery(state, event, "invalid_transition");
  }
  if (existingItem?.status === "completed") {
    return markRecovery(state, event, "invalid_transition");
  }

  let next = existingItem === null
    ? ensureItem(state, event, sanitizedKind, event.ordinal)
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
      const existing = selectConversationItem(state, event.threadId, event.turnId, event.itemId);
      if (existing !== null &&
          (existing.kind !== kind || existing.ordinal !== integer(event.ordinal) ||
           existing.status === "completed")) {
        return markRecovery(state, event, "invalid_transition");
      }
      const next = existing === null
        ? ensureItem(state, event, kind, event.ordinal)
        : state;
      return activateTurn(next, event.threadId, event.turnId, event);
    }
    case "item.delta":
      return applyDelta(state, event);
    case "item.completed": {
      const item = selectConversationItem(state, event.threadId, event.turnId, event.itemId);
      if (item === null || item.status === "completed") {
        return markRecovery(state, event, "invalid_transition");
      }
      if (item.kind === "unknown") {
        return replaceItem(state, { ...item, status: "completed" });
      }
      const reconciled = reconcileBlocks(item.contentBlocks, event.finalBlocks);
      const next = replaceItem(state, {
        ...item,
        status: "completed",
        contentBlocks: reconciled.blocks,
        reconciliation: reconciled.status,
      });
      return reconciled.status === "mismatch"
        ? markRecovery(next, event, "reconciliation_mismatch")
        : next;
    }
    case "turn.completed": {
      const existing = selectConversationTurn(state, event.threadId, event.turnId);
      if (existing?.terminalStatus === event.terminalStatus) return state;
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
      });
      const sealed = completeTurnItems(completed, event.threadId, event.turnId);
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
  }
  for (const input of orderedTurns) {
    state = ensureTurn(state, input.threadId, input.turnId, input.ordinal);
    const current = selectConversationTurn(state, input.threadId, input.turnId)!;
    state = replaceTurn(state, {
      ...current,
      ordinal: integer(input.ordinal),
      status: input.status,
      terminalStatus: input.terminalStatus,
      notices: Object.freeze((input.notices ?? [])
        .slice(-MAX_CONVERSATION_NOTICES)
        .map<ConversationNotice>((notice) => notice.severity === "error"
          ? { severity: "error", code: "conversation_error" }
          : { severity: "warning", code: "conversation_warning" })),
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
          [input.threadId]: { ...thread, status: input.status },
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

export function reconcileConversationSnapshot(
  current: ConversationState,
  snapshot: ConversationSnapshot,
): ConversationState {
  if (current.recovery?.code === "sequence_gap") {
    return hydrateConversationState(snapshot);
  }
  let next = hydrateConversationState(snapshot);
  if (next.syncStatus === "recovery_required") return next;
  const lifecycleMismatches = new Map<string, ConversationTurn>();
  for (const liveTurn of Object.values(current.turns)) {
    if (liveTurn.terminalStatus === null) continue;
    const authoritativeTurn = selectConversationTurn(
      next,
      liveTurn.threadId,
      liveTurn.turnId,
    );
    if (authoritativeTurn === null ||
        authoritativeTurn.terminalStatus !== liveTurn.terminalStatus) {
      lifecycleMismatches.set(turnKey(liveTurn.threadId, liveTurn.turnId), liveTurn);
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
    if (liveTurn === null || liveItem.contentBlocks.length === 0) continue;

    const authoritativeTurn = selectConversationTurn(
      next,
      liveItem.threadId,
      liveItem.turnId,
    );
    const authoritativeItem = selectConversationItem(
      next,
      liveItem.threadId,
      liveItem.turnId,
      liveItem.itemId,
    );
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
      continue;
    }

    if (authoritativeItem.status !== "completed") {
      next = replaceItem(next, liveItem);
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
    }
  }
  for (const liveTurn of lifecycleMismatches.values()) {
    next = ensureTurn(next, liveTurn.threadId, liveTurn.turnId, liveTurn.ordinal);
    next = replaceTurn(next, liveTurn);
    next = markSnapshotRecovery(next, liveTurn.threadId, liveTurn.turnId);
  }
  return next;
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
    reconciliation: item.reconciliation,
    contentBlocks: [...item.contentBlocks].sort((left, right) => left.blockIndex - right.blockIndex),
  };
}

export function serializeConversationState(state: ConversationState): string {
  const threads = Object.values(state.threads)
    .sort((left, right) => left.threadId.localeCompare(right.threadId))
    .map((thread) => ({ threadId: thread.threadId, status: thread.status }));
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
