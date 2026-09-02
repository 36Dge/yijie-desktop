import type {
  ConversationAgentMessagePhase,
  ConversationContentBlock,
  ConversationExecution,
  ConversationItem,
  ConversationItemKind,
  ConversationItemStatus,
  ConversationNotice,
  ConversationPlanSnapshot,
  ConversationReasoningState,
  ConversationState,
  ConversationTerminalStatus,
  ConversationThread,
  ConversationThreadStatus,
  ConversationTurn,
  ConversationTurnStatus,
  ReconciliationStatus,
} from "./conversation-state";
import {
  selectConversationApprovalForCommand,
  type ConversationApproval,
  type ConversationApprovalState,
} from "./conversation-approval";

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
export type ConversationTimelineItemPhase = "pending" | "active" | "complete" | "incomplete";
export type ConversationTimelineItemKind =
  | "user_message"
  | "assistant_message"
  | "reasoning"
  | "command"
  | "tool"
  | "artifact"
  | "unknown";
export type ConversationTimelineItemPresentation =
  | "user_message"
  | "commentary"
  | "final_answer"
  | "assistant_unclassified"
  | "reasoning"
  | "command"
  | "tool"
  | "artifact"
  | "unknown";
export type ConversationTimelineContentMode = "rich" | "plain";
export type ConversationTimelineCopyPolicy = "text_and_code" | "none";

export type ConversationTimelineProjectionPolicy = Readonly<{
  protectApprovalProcessContent: boolean;
}>;

export const APPROVAL_PROCESS_CONTENT_PROTECTED_MESSAGE =
  "为保护命令、路径与审批上下文，模型过程内容已隐藏。";

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
  source: "thread_notice" | "turn_notice";
  role: "system";
  severity: ConversationNotice["severity"];
  code: ConversationNotice["code"];
  count: number;
}>;

export type ConversationTimelinePlanStepViewModel = Readonly<{
  identity: string;
  ordinal: number;
  text: string;
  status: ConversationPlanSnapshot["steps"][number]["status"];
}>;

export type ConversationTimelinePlanViewModel = Readonly<{
  identity: string;
  explanation: string | null;
  steps: readonly ConversationTimelinePlanStepViewModel[];
  collapsible: true;
  defaultExpanded: boolean;
}>;

export type ConversationTimelineItemViewModel = Readonly<{
  identity: string;
  threadId: string;
  turnId: string;
  itemId: string;
  ordinal: number;
  kind: ConversationTimelineItemKind;
  presentation: ConversationTimelineItemPresentation;
  role: ConversationTimelineRole;
  domainStatus: ConversationItemStatus;
  phase: ConversationTimelineItemPhase;
  assistantPhase: ConversationAgentMessagePhase | null;
  reasoning: ConversationReasoningState | null;
  execution: ConversationExecution | null;
  readonly approval?: ConversationApproval | null;
  contentMode: ConversationTimelineContentMode;
  collapsible: boolean;
  defaultExpanded: boolean;
  copyPolicy: ConversationTimelineCopyPolicy;
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
  terminalCode: string | null;
  plan: ConversationTimelinePlanViewModel | null;
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
  notices: readonly ConversationTimelineNoticeViewModel[];
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
    incomplete: "incomplete",
  });

const ITEM_KINDS: Readonly<Record<ConversationItemKind, ConversationTimelineItemKind>> =
  Object.freeze({
    user_message: "user_message",
    assistant_message: "assistant_message",
    reasoning: "reasoning",
    command: "command",
    tool: "tool",
    approval: "unknown",
    artifact: "artifact",
    unknown: "unknown",
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

function projectReasoningContentBlock(
  itemIdentity: string,
  block: ConversationContentBlock,
): ConversationTimelineContentBlock {
  const blockIndex = safeBlockIndex(block.blockIndex);
  if (block.type === "text" || block.type === "code") {
    return Object.freeze({
      identity: blockIdentity(itemIdentity, blockIndex, "reasoning-text"),
      blockIndex,
      type: "text" as const,
      text: block.text,
    });
  }
  return unknownContentBlock(itemIdentity, blockIndex);
}

function isModelProcessPresentation(
  presentation: ConversationTimelineItemPresentation,
): boolean {
  return presentation === "commentary" ||
    presentation === "assistant_unclassified" ||
    presentation === "reasoning";
}

function protectedProcessContentBlock(
  itemIdentity: string,
): ConversationTimelineTextContentBlock {
  return Object.freeze({
    identity: blockIdentity(itemIdentity, 0, "protected-process-text"),
    blockIndex: 0,
    type: "text" as const,
    text: APPROVAL_PROCESS_CONTENT_PROTECTED_MESSAGE,
  });
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

function itemPresentation(item: ConversationItem): ConversationTimelineItemPresentation {
  switch (item.kind) {
    case "user_message":
      return "user_message";
    case "assistant_message":
      if (item.agentMessagePhase === "commentary") return "commentary";
      if (item.agentMessagePhase === "final_answer") return "final_answer";
      return "assistant_unclassified";
    case "reasoning":
      return "reasoning";
    case "command":
      return "command";
    case "tool":
      return "tool";
    case "artifact":
      return "artifact";
    default:
      return "unknown";
  }
}

function presentationRole(
  presentation: ConversationTimelineItemPresentation,
): ConversationTimelineRole {
  switch (presentation) {
    case "user_message":
      return "user";
    case "final_answer":
    case "artifact":
      return "assistant";
    case "commentary":
    case "assistant_unclassified":
    case "reasoning":
    case "command":
    case "tool":
      return "process";
    case "unknown":
    default:
      return "system";
  }
}

function activeTurn(turn: ConversationTurn): boolean {
  return turn.status === "queued" ||
    turn.status === "in_progress" ||
    turn.status === "waiting_approval";
}

function projectItem(
  item: ConversationItem,
  turn: ConversationTurn,
  approvalState?: ConversationApprovalState,
  policy?: ConversationTimelineProjectionPolicy,
): ConversationTimelineItemViewModel {
  const identity = stableIdentity("timeline-item", item.threadId, item.turnId, item.itemId);
  const kind = ITEM_KINDS[item.kind] ?? "unknown";
  const presentation = itemPresentation(item);
  const protectProcessContent = policy?.protectApprovalProcessContent === true &&
    isModelProcessPresentation(presentation);
  const contentBlocks: readonly ConversationTimelineContentBlock[] = protectProcessContent
    ? Object.freeze([protectedProcessContentBlock(identity)])
    : kind === "unknown"
      ? Object.freeze([unknownContentBlock(identity, 0)])
      : Object.freeze([...item.contentBlocks]
        .sort((left, right) =>
          safeBlockIndex(left.blockIndex) - safeBlockIndex(right.blockIndex) ||
          left.type.localeCompare(right.type))
        .map((block) => presentation === "reasoning"
          ? projectReasoningContentBlock(identity, block)
          : projectContentBlock(identity, block)));
  const collapsible = presentation === "commentary" ||
    presentation === "assistant_unclassified" ||
    (presentation === "reasoning" && contentBlocks.length > 0);

  return Object.freeze({
    identity,
    threadId: item.threadId,
    turnId: item.turnId,
    itemId: item.itemId,
    ordinal: item.ordinal,
    kind,
    presentation,
    role: presentationRole(presentation),
    domainStatus: item.status,
    phase: ITEM_PHASES[item.status],
    assistantPhase: item.agentMessagePhase,
    reasoning: item.reasoning === null ? null : Object.freeze({ ...item.reasoning }),
    execution: item.execution,
    ...(kind === "command" ? {
      approval: approvalState === undefined
        ? null
        : selectConversationApprovalForCommand(
            approvalState,
            item.threadId,
            item.turnId,
            item.itemId,
          ),
    } : {}),
    contentMode: presentation === "reasoning" || presentation === "command" || presentation === "tool"
      ? "plain" as const
      : "rich" as const,
    collapsible,
    defaultExpanded: collapsible ? activeTurn(turn) : true,
    copyPolicy: protectProcessContent || presentation === "reasoning" || presentation === "command" ||
        presentation === "tool" || presentation === "unknown"
      ? "none" as const
      : "text_and_code" as const,
    reconciliation: item.reconciliation,
    contentBlocks,
  });
}

function projectPlan(
  turn: ConversationTurn,
  policy?: ConversationTimelineProjectionPolicy,
): ConversationTimelinePlanViewModel | null {
  if (turn.plan === null) return null;
  const identity = stableIdentity("timeline-plan", turn.threadId, turn.turnId);
  const protectProcessContent = policy?.protectApprovalProcessContent === true;
  return Object.freeze({
    identity,
    explanation: protectProcessContent && turn.plan.explanation !== null
      ? APPROVAL_PROCESS_CONTENT_PROTECTED_MESSAGE
      : turn.plan.explanation,
    steps: Object.freeze([...turn.plan.steps]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((step) => Object.freeze({
        identity: stableIdentity(identity, "step", String(step.ordinal)),
        ordinal: step.ordinal,
        text: protectProcessContent ? APPROVAL_PROCESS_CONTENT_PROTECTED_MESSAGE : step.text,
        status: step.status,
      }))),
    collapsible: true as const,
    defaultExpanded: activeTurn(turn),
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

function projectThreadNotices(
  thread: ConversationThread,
): readonly ConversationTimelineNoticeViewModel[] {
  const grouped = new Map<string, {
    severity: ConversationNotice["severity"];
    code: ConversationNotice["code"];
    count: number;
  }>();
  for (const notice of thread.notices) {
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
        "timeline-thread-notice",
        thread.threadId,
        notice.severity,
        notice.code,
      ),
      source: "thread_notice" as const,
      role: "system" as const,
      severity: notice.severity,
      code: notice.code,
      count: notice.count,
    })));
}

function projectTurn(
  state: ConversationState,
  turn: ConversationTurn,
  approvalState?: ConversationApprovalState,
  policy?: ConversationTimelineProjectionPolicy,
): ConversationTimelineTurnViewModel {
  return Object.freeze({
    identity: stableIdentity("timeline-turn", turn.threadId, turn.turnId),
    threadId: turn.threadId,
    turnId: turn.turnId,
    ordinal: turn.ordinal,
    domainStatus: turn.status,
    phase: TURN_PHASES[turn.status],
    terminalStatus: turn.terminalStatus,
    terminalCode: turn.terminalCode,
    plan: projectPlan(turn, policy),
    progress: projectProgress(turn),
    notices: projectNotices(turn),
    items: Object.freeze(relatedItems(state, turn)
      .map((item) => projectItem(item, turn, approvalState, policy))),
  });
}

export function selectConversationTimeline(
  state: ConversationState,
  threadId: string,
  approvalState?: ConversationApprovalState,
  policy?: ConversationTimelineProjectionPolicy,
): ConversationTimelineViewModel | null {
  const thread = state.threads[threadId];
  if (thread === undefined || thread.threadId !== threadId) return null;
  const turns = Object.freeze(relatedTurns(state, thread)
    .map((turn) => projectTurn(state, turn, approvalState, policy)));
  return Object.freeze({
    identity: stableIdentity("conversation-timeline", thread.threadId),
    threadId: thread.threadId,
    domainStatus: thread.status,
    phase: THREAD_PHASES[thread.status],
    syncStatus: state.syncStatus,
    notices: projectThreadNotices(thread),
    turns,
    isReadyEmpty:
      state.syncStatus === "synchronized" && thread.status === "ready" && turns.length === 0,
  });
}
