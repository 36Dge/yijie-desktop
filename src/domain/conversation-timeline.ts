import type {
  ConversationContentBlock,
  ConversationItem,
  ConversationItemKind,
  ConversationItemStatus,
  ConversationNotice,
  ConversationState,
  ConversationTerminalStatus,
  ConversationThread,
  ConversationThreadStatus,
  ConversationTurn,
  ConversationTurnStatus,
  ReconciliationStatus,
} from "./conversation-state";

export type ConversationTimelineRole = "user" | "assistant" | "process" | "system";
export type ConversationTimelineThreadPhase =
  | "loading"
  | "ready"
  | "active"
  | "archived"
  | "unavailable";
export type ConversationTimelineTurnPhase =
  | "pending"
  | "active"
  | "waiting"
  | "complete"
  | "interrupted"
  | "failed"
  | "recovery_required";
export type ConversationTimelineItemPhase = "pending" | "active" | "complete";
export type ConversationTimelineItemKind =
  | "user_message"
  | "assistant_message"
  | "reasoning"
  | "artifact"
  | "unknown";

type TimelineContentBlockBase = Readonly<{
  identity: string;
  blockIndex: number;
}>;

export type ConversationTimelineTextContentBlock = TimelineContentBlockBase & Readonly<{
  type: "text";
  text: string;
}>;

export type ConversationTimelineCodeContentBlock = TimelineContentBlockBase & Readonly<{
  type: "code";
  language: string | null;
  text: string;
}>;

export type ConversationTimelineArtifactReferenceContentBlock = TimelineContentBlockBase & Readonly<{
  type: "artifact_reference";
  artifactId: string;
  label: string | null;
}>;

export type ConversationTimelineAttachmentReferenceContentBlock = TimelineContentBlockBase & Readonly<{
  type: "attachment_reference";
  attachmentId: string;
  kind: "file" | "image";
  name: string;
  mediaType: string;
  sizeBytes: number;
  status: string;
  expiresAt: number;
}>;

export type ConversationTimelineUnknownContentBlock = TimelineContentBlockBase & Readonly<{
  type: "unknown";
  code: "unsupported_content";
}>;

export type ConversationTimelineContentBlock =
  | ConversationTimelineTextContentBlock
  | ConversationTimelineCodeContentBlock
  | ConversationTimelineArtifactReferenceContentBlock
  | ConversationTimelineAttachmentReferenceContentBlock
  | ConversationTimelineUnknownContentBlock;

type ActiveConversationTurnStatus = Extract<
  ConversationTurnStatus,
  "queued" | "in_progress" | "waiting_approval"
>;

export type ConversationTimelineProgressViewModel = Readonly<{
  identity: string;
  source: "turn_status";
  role: "process";
  domainStatus: ActiveConversationTurnStatus;
  phase: Extract<ConversationTimelineTurnPhase, "pending" | "active" | "waiting">;
}>;

export type ConversationTimelineNoticeViewModel = Readonly<{
  identity: string;
  source: "turn_notice";
  role: "system";
  severity: ConversationNotice["severity"];
  code: ConversationNotice["code"];
  count: number;
}>;

export type ConversationTimelineItemViewModel = Readonly<{
  identity: string;
  threadId: string;
  turnId: string;
  itemId: string;
  ordinal: number;
  kind: ConversationTimelineItemKind;
  role: ConversationTimelineRole;
  domainStatus: ConversationItemStatus;
  phase: ConversationTimelineItemPhase;
  reconciliation: ReconciliationStatus;
  contentBlocks: readonly ConversationTimelineContentBlock[];
}>;

export type ConversationTimelineTurnViewModel = Readonly<{
  identity: string;
  threadId: string;
  turnId: string;
  ordinal: number;
  domainStatus: ConversationTurnStatus;
  phase: ConversationTimelineTurnPhase;
  terminalStatus: ConversationTerminalStatus | null;
  progress: ConversationTimelineProgressViewModel | null;
  notices: readonly ConversationTimelineNoticeViewModel[];
  items: readonly ConversationTimelineItemViewModel[];
}>;

export type ConversationTimelineViewModel = Readonly<{
  identity: string;
  threadId: string;
  domainStatus: ConversationThreadStatus;
  phase: ConversationTimelineThreadPhase;
  syncStatus: ConversationState["syncStatus"];
  turns: readonly ConversationTimelineTurnViewModel[];
  isReadyEmpty: boolean;
}>;

const THREAD_PHASES: Readonly<Record<
  ConversationThreadStatus,
  ConversationTimelineThreadPhase
>> = Object.freeze({
  not_loaded: "loading",
  ready: "ready",
  active: "active",
  archived: "archived",
  unavailable: "unavailable",
});

const TURN_PHASES: Readonly<Record<
  ConversationTurnStatus,
  ConversationTimelineTurnPhase
>> = Object.freeze({
  queued: "pending",
  in_progress: "active",
  waiting_approval: "waiting",
  completed: "complete",
  interrupted: "interrupted",
  failed: "failed",
  recovery_required: "recovery_required",
});

const ITEM_PHASES: Readonly<Record<ConversationItemStatus, ConversationTimelineItemPhase>> =
  Object.freeze({
    started: "pending",
    streaming: "active",
    completed: "complete",
  });

const ITEM_KINDS: Readonly<Record<ConversationItemKind, ConversationTimelineItemKind>> =
  Object.freeze({
    user_message: "user_message",
    assistant_message: "assistant_message",
    reasoning: "reasoning",
    command: "unknown",
    tool: "unknown",
    approval: "unknown",
    artifact: "artifact",
    unknown: "unknown",
  });

const ITEM_ROLES: Readonly<Record<ConversationItemKind, ConversationTimelineRole>> =
  Object.freeze({
    user_message: "user",
    assistant_message: "assistant",
    reasoning: "process",
    command: "system",
    tool: "system",
    approval: "system",
    artifact: "assistant",
    unknown: "system",
  });

function stableIdentity(...parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

function safeBlockIndex(blockIndex: number): number {
  return Number.isSafeInteger(blockIndex) && blockIndex >= 0 ? blockIndex : 0;
}

function blockIdentity(
  itemIdentity: string,
  blockIndex: number,
  type: string,
): string {
  return stableIdentity("timeline-block", itemIdentity, String(blockIndex), type);
}

function unknownContentBlock(
  itemIdentity: string,
  blockIndex: number,
): ConversationTimelineUnknownContentBlock {
  return Object.freeze({
    identity: blockIdentity(itemIdentity, blockIndex, "unknown"),
    blockIndex,
    type: "unknown" as const,
    code: "unsupported_content" as const,
  });
}

function projectContentBlock(
  itemIdentity: string,
  block: ConversationContentBlock,
): ConversationTimelineContentBlock {
  const blockIndex = safeBlockIndex(block.blockIndex);
  switch (block.type) {
    case "text":
      return Object.freeze({
        identity: blockIdentity(itemIdentity, blockIndex, block.type),
        blockIndex,
        type: block.type,
        text: block.text,
      });
    case "code":
      return Object.freeze({
        identity: blockIdentity(itemIdentity, blockIndex, block.type),
        blockIndex,
        type: block.type,
        language: block.language,
        text: block.text,
      });
    case "artifact_reference":
      return Object.freeze({
        identity: blockIdentity(itemIdentity, blockIndex, block.type),
        blockIndex,
        type: block.type,
        artifactId: block.artifactId,
        label: block.label,
      });
    case "attachment_reference":
      return Object.freeze({
        identity: blockIdentity(itemIdentity, blockIndex, block.type),
        blockIndex,
        type: block.type,
        attachmentId: block.attachmentId,
        kind: block.kind,
        name: block.name,
        mediaType: block.mediaType,
        sizeBytes: block.sizeBytes,
        status: block.status,
        expiresAt: block.expiresAt,
      });
    case "unknown":
    default:
      return unknownContentBlock(itemIdentity, blockIndex);
  }
}

function relatedTurns(
  state: ConversationState,
  thread: ConversationThread,
): readonly ConversationTurn[] {
  const seen = new Set<string>();
  const turns: ConversationTurn[] = [];
  for (const key of thread.turnKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const turn = state.turns[key];
    if (turn !== undefined && turn.threadId === thread.threadId) turns.push(turn);
  }
  return turns.sort((left, right) =>
    left.ordinal - right.ordinal || left.turnId.localeCompare(right.turnId));
}

function relatedItems(
  state: ConversationState,
  turn: ConversationTurn,
): readonly ConversationItem[] {
  const seen = new Set<string>();
  const items: ConversationItem[] = [];
  for (const key of turn.itemKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const item = state.items[key];
    if (
      item !== undefined &&
      item.threadId === turn.threadId &&
      item.turnId === turn.turnId
    ) {
      items.push(item);
    }
  }
  return items.sort((left, right) =>
    left.ordinal - right.ordinal || left.itemId.localeCompare(right.itemId));
}

function projectItem(item: ConversationItem): ConversationTimelineItemViewModel {
  const identity = stableIdentity("timeline-item", item.threadId, item.turnId, item.itemId);
  const kind = ITEM_KINDS[item.kind] ?? "unknown";
  const role = ITEM_ROLES[item.kind] ?? "system";
  const contentBlocks: readonly ConversationTimelineContentBlock[] = kind === "unknown"
    ? Object.freeze([unknownContentBlock(identity, 0)])
    : Object.freeze([...item.contentBlocks]
      .sort((left, right) =>
        safeBlockIndex(left.blockIndex) - safeBlockIndex(right.blockIndex) ||
        left.type.localeCompare(right.type))
      .map((block) => projectContentBlock(identity, block)));

  return Object.freeze({
    identity,
    threadId: item.threadId,
    turnId: item.turnId,
    itemId: item.itemId,
    ordinal: item.ordinal,
    kind,
    role,
    domainStatus: item.status,
    phase: ITEM_PHASES[item.status],
    reconciliation: item.reconciliation,
    contentBlocks,
  });
}

function projectProgress(
  turn: ConversationTurn,
): ConversationTimelineProgressViewModel | null {
  const identity = stableIdentity("timeline-progress", turn.threadId, turn.turnId);
  switch (turn.status) {
    case "queued":
      return Object.freeze({
        identity,
        source: "turn_status" as const,
        role: "process" as const,
        domainStatus: turn.status,
        phase: "pending" as const,
      });
    case "in_progress":
      return Object.freeze({
        identity,
        source: "turn_status" as const,
        role: "process" as const,
        domainStatus: turn.status,
        phase: "active" as const,
      });
    case "waiting_approval":
      return Object.freeze({
        identity,
        source: "turn_status" as const,
        role: "process" as const,
        domainStatus: turn.status,
        phase: "waiting" as const,
      });
    default:
      return null;
  }
}

function projectNotices(turn: ConversationTurn): readonly ConversationTimelineNoticeViewModel[] {
  const grouped = new Map<string, {
    severity: ConversationNotice["severity"];
    code: ConversationNotice["code"];
    count: number;
  }>();
  for (const notice of turn.notices) {
    const severity = notice.severity === "error" ? "error" : "warning";
    const code = severity === "error" ? "conversation_error" : "conversation_warning";
    const key = stableIdentity(severity, code);
    const existing = grouped.get(key);
    grouped.set(key, { severity, code, count: (existing?.count ?? 0) + 1 });
  }
  return Object.freeze([...grouped.values()]
    .sort((left, right) =>
      left.severity.localeCompare(right.severity) || left.code.localeCompare(right.code))
    .map((notice) => Object.freeze({
      identity: stableIdentity(
        "timeline-notice",
        turn.threadId,
        turn.turnId,
        notice.severity,
        notice.code,
      ),
      source: "turn_notice" as const,
      role: "system" as const,
      severity: notice.severity,
      code: notice.code,
      count: notice.count,
    })));
}

function projectTurn(
  state: ConversationState,
  turn: ConversationTurn,
): ConversationTimelineTurnViewModel {
  return Object.freeze({
    identity: stableIdentity("timeline-turn", turn.threadId, turn.turnId),
    threadId: turn.threadId,
    turnId: turn.turnId,
    ordinal: turn.ordinal,
    domainStatus: turn.status,
    phase: TURN_PHASES[turn.status],
    terminalStatus: turn.terminalStatus,
    progress: projectProgress(turn),
    notices: projectNotices(turn),
    items: Object.freeze(relatedItems(state, turn).map(projectItem)),
  });
}

export function selectConversationTimeline(
  state: ConversationState,
  threadId: string,
): ConversationTimelineViewModel | null {
  const thread = state.threads[threadId];
  if (thread === undefined || thread.threadId !== threadId) return null;
  const turns = Object.freeze(relatedTurns(state, thread)
    .map((turn) => projectTurn(state, turn)));
  return Object.freeze({
    identity: stableIdentity("conversation-timeline", thread.threadId),
    threadId: thread.threadId,
    domainStatus: thread.status,
    phase: THREAD_PHASES[thread.status],
    syncStatus: state.syncStatus,
    turns,
    isReadyEmpty:
      state.syncStatus === "synchronized" && thread.status === "ready" && turns.length === 0,
  });
}
