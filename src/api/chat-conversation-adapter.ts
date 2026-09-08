// Readonly legacy archive adapter. Never used for native streaming or native identity.
import type {
ChatArtifact,
ChatAttachment,
ChatHistoryPage,
ChatHistoryPageV4,
ChatHistoryPageV5,
ChatHistoryTurn,
ChatHistoryTurnV4,
ChatHistoryTurnV5,
ChatMessage,
ChatMessageContentBlock,
ChatTimelineItemV4,
ChatTimelineItemV5,
} from "../domain/chat-ipc";
import type {
ConversationAgentMessagePhase,
ConversationContentBlock,
ConversationExecution,
ConversationItemSnapshot,
ConversationSnapshot,
ConversationTerminalStatus,
ConversationTurnSnapshot,
ConversationTurnStatus,
} from "../domain/conversation-view";
import {
conversationAgentMessagePhase,
conversationReasoningReasonCode,
} from "../domain/conversation-view";

const USER_ITEM_ORDINAL = 0;
const REASONING_ITEM_ORDINAL_BASE = 100;
const ASSISTANT_ITEM_ORDINAL = 200;
// v4 Runtime Items occupy 1..512. Keep synthetic FEAT-128 Artifact shells in
// their own deterministic range without colliding with source ordinals.
const ARTIFACT_ITEM_ORDINAL_BASE = 1000;

export function conversationMessageItemId(
  turnId: string,
  role: ChatMessage["role"],
  roleIndex = 0,
): string {
  return `${turnId}:${role}:${roleIndex}`;
}

export function conversationReasoningItemId(turnId: string, itemOrdinal: number): string {
  return `${turnId}:reasoning:${itemOrdinal}`;
}

export function conversationReasoningItemOrdinal(
  turnId: string,
  itemId: string,
): number | null {
  const prefix = `${turnId}:reasoning:`;
  if (!itemId.startsWith(prefix)) return null;
  const value = itemId.slice(prefix.length);
  return /^(?:0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;
}

export function conversationArtifactItemId(turnId: string, artifactId: string): string {
  return `${turnId}:artifact:${artifactId}`;
}

function messageBlock(
  block: ChatMessageContentBlock,
  blockIndex: number,
): ConversationContentBlock {
  if (block.type === "text") {
    return Object.freeze({ blockIndex, type: "text", text: block.text });
  }
  return attachmentBlock(block, blockIndex);
}

function attachmentBlock(
  attachment: ChatAttachment,
  blockIndex: number,
): ConversationContentBlock {
  return Object.freeze({
    blockIndex,
    type: "attachment_reference",
    attachmentId: attachment.attachmentId,
    kind: attachment.type,
    name: attachment.name,
    mediaType: attachment.mediaType,
    sizeBytes: attachment.sizeBytes,
    status: attachment.status,
    expiresAt: attachment.expiresAt,
  });
}

function messageBlocks(message: ChatMessage): readonly ConversationContentBlock[] {
  if (message.contentBlocks !== undefined) {
    return Object.freeze(message.contentBlocks.map(messageBlock));
  }
  return message.content.length === 0
    ? Object.freeze([])
    : Object.freeze([{ blockIndex: 0, type: "text", text: message.content }]);
}

function isNativePendingAssistantScaffold(message: ChatMessage): boolean {
  if (
    message.role !== "assistant" ||
    message.status !== "pending" ||
    message.content.length !== 0
  ) {
    return false;
  }
  const blocks = message.contentBlocks;
  return blocks === undefined || blocks.length === 0 || (
    blocks.length === 1 && blocks[0]?.type === "text" && blocks[0].text === " "
  );
}

function turnStatus(status: string): ConversationTurnStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "streaming":
    case "stopping":
      return "in_progress";
    case "completed":
    case "interrupted":
    case "failed":
      return status;
    default:
      return "recovery_required";
  }
}

function terminalStatus(status: string): ConversationTerminalStatus | null {
  return status === "completed" || status === "interrupted" || status === "failed"
    ? status
    : null;
}

function messageItems(
  turn: ChatHistoryTurn,
  includedRole: ChatMessage["role"] | null = null,
): readonly ConversationItemSnapshot[] {
  const roleCounts: Record<ChatMessage["role"], number> = { user: 0, assistant: 0 };
  return [...turn.messages]
    .filter((message) => includedRole === null || message.role === includedRole)
    .sort((left, right) => left.ordinal - right.ordinal || left.messageId.localeCompare(right.messageId))
    .map((message) => {
      const roleIndex = roleCounts[message.role];
      roleCounts[message.role] += 1;
      return Object.freeze({
        threadId: "",
        turnId: turn.turnId,
        itemId: conversationMessageItemId(turn.turnId, message.role, roleIndex),
        ordinal: message.role === "user"
          ? USER_ITEM_ORDINAL + roleIndex
          : ASSISTANT_ITEM_ORDINAL + roleIndex,
        kind: message.role === "user" ? "user_message" : "assistant_message",
        status: message.status === "pending" ? "streaming" : "completed",
        agentMessagePhase: message.role === "assistant" ? "final_answer" : null,
        contentBlocks: messageBlocks(message),
      } satisfies ConversationItemSnapshot);
    });
}

function reasoningItems(turn: ChatHistoryTurn): readonly ConversationItemSnapshot[] {
  return [...turn.reasoning]
    .sort((left, right) => left.itemOrdinal - right.itemOrdinal)
    .map((item) => Object.freeze({
      threadId: "",
      turnId: turn.turnId,
      itemId: conversationReasoningItemId(turn.turnId, item.itemOrdinal),
      ordinal: REASONING_ITEM_ORDINAL_BASE + item.itemOrdinal,
      kind: "reasoning",
      status: "completed",
      contentBlocks: Object.freeze([]),
    } satisfies ConversationItemSnapshot));
}

function artifactItem(turn: ChatHistoryTurn, artifact: ChatArtifact): ConversationItemSnapshot {
  return Object.freeze({
    threadId: "",
    turnId: turn.turnId,
    itemId: conversationArtifactItemId(turn.turnId, artifact.artifactId),
    ordinal: ARTIFACT_ITEM_ORDINAL_BASE + artifact.ordinal,
    kind: "artifact",
    status: artifact.status === "ready" || artifact.status === "failed" ||
      artifact.status === "cancelled" || artifact.status === "expired"
      ? "completed"
      : "streaming",
    contentBlocks: Object.freeze([Object.freeze({
      blockIndex: 0,
      type: "artifact_reference",
      artifactId: artifact.artifactId,
      label: artifact.displayName,
    })]),
  });
}

function historyItems(threadId: string, turn: ChatHistoryTurn): readonly ConversationItemSnapshot[] {
  const items = [
    ...messageItems(turn),
    ...reasoningItems(turn),
    ...(turn.artifacts ?? []).map((artifact) => artifactItem(turn, artifact)),
  ];
  return Object.freeze(items.map((item) => Object.freeze({ ...item, threadId })));
}

function itemKindV4(itemType: string): ConversationItemSnapshot["kind"] {
  if (itemType === "agentMessage") return "assistant_message";
  if (itemType === "reasoning") return "reasoning";
  return "unknown";
}

function itemStatusV4(status: ChatTimelineItemV4["status"]): ConversationItemSnapshot["status"] {
  if (status === "in_progress") return "streaming";
  return status === "incomplete" ? "incomplete" : "completed";
}

function assistantPhaseV4(
  itemType: string,
  phase: "commentary" | "final_answer" | null,
): ConversationAgentMessagePhase | null {
  return itemType === "agentMessage" ? conversationAgentMessagePhase(phase) : null;
}

function timelineItemBlocksV4(
  item: ChatTimelineItemV4,
): readonly ConversationContentBlock[] {
  if (item.itemType === "agentMessage") {
    return item.text.length === 0
      ? Object.freeze([])
      : Object.freeze([{ blockIndex: 0, type: "text", text: item.text }]);
  }
  if (item.itemType === "reasoning") {
    return Object.freeze([...item.reasoningParts]
      .sort((left, right) => left.contentIndex - right.contentIndex)
      .map((part) => Object.freeze({
        blockIndex: part.contentIndex,
        type: "text" as const,
        text: part.text,
      })));
  }
  return Object.freeze([{ blockIndex: 0, type: "unknown", code: "unsupported_content" }]);
}

function timelineItemV4(
  threadId: string,
  turnId: string,
  item: ChatTimelineItemV4,
): ConversationItemSnapshot {
  const kind = itemKindV4(item.itemType);
  return Object.freeze({
    threadId,
    turnId,
    itemId: item.itemId,
    ordinal: item.itemOrdinal,
    kind,
    status: itemStatusV4(item.status),
    agentMessagePhase: assistantPhaseV4(item.itemType, item.phase),
    reasoning: kind === "reasoning"
      ? Object.freeze({
          status: item.reasoningStatus ?? (
            item.status === "in_progress" ? "in_progress" : "unknown"
          ),
          reasonCode: conversationReasoningReasonCode(item.reasoningReasonCode),
        })
      : null,
    contentBlocks: timelineItemBlocksV4(item),
    reconciliation: kind === "assistant_message" && item.status === "completed"
      ? "matched"
      : kind === "reasoning" && item.reasoningStatus !== null
        ? "matched"
        : "not_applicable",
  });
}

function historyItemsV4(
  threadId: string,
  turn: ChatHistoryTurnV4,
): readonly ConversationItemSnapshot[] {
  if (turn.projectionAuthority === "legacy") {
    const active = turn.status === "queued" || turn.status === "streaming" ||
      turn.status === "stopping";
    const legacyTurn = active
      ? {
          ...turn,
          // The native schema creates a pending empty assistant row before the
          // first durable v4 fact. It is storage scaffolding, not a real final
          // answer. Preserve any non-empty legacy partial and all terminal
          // legacy history.
          messages: turn.messages.filter((message) => !isNativePendingAssistantScaffold(message)),
        }
      : turn;
    return historyItems(threadId, legacyTurn);
  }
  const items = [
    ...messageItems(turn, "user"),
    ...turn.timelineItems.map((item) => timelineItemV4(threadId, turn.turnId, item)),
    ...turn.artifacts.map((artifact) => artifactItem(turn, artifact)),
  ];
  return Object.freeze(items.map((item) => Object.freeze({ ...item, threadId })));
}

export function historyPageV4ToConversationSnapshot(
  threadId: string,
  page: ChatHistoryPageV4,
): ConversationSnapshot {
  const orderedTurns = [...page.turns]
    .sort((left, right) => left.turnId.localeCompare(right.turnId));
  const turns: ConversationTurnSnapshot[] = orderedTurns.map((turn, ordinal) => Object.freeze({
    threadId,
    turnId: turn.turnId,
    ordinal,
    status: turnStatus(turn.status),
    terminalStatus: terminalStatus(turn.status),
    terminalCode: turn.terminalCode,
    plan: turn.plan === null || turn.plan.steps.length === 0
      ? null
      : Object.freeze({
          explanation: turn.plan.explanation,
          steps: Object.freeze(turn.plan.steps.map((step) => Object.freeze({
            ordinal: step.ordinal,
            text: step.step,
            status: step.status,
          }))),
        }),
    notices: Object.freeze(turn.notices.map((notice) => Object.freeze({
      severity: notice.severity,
      code: notice.severity === "error" ? "conversation_error" : "conversation_warning",
    }))),
  }));
  const hasActiveTurn = turns.some((turn) =>
    turn.status === "queued" || turn.status === "in_progress" || turn.status === "waiting_approval"
  );
  return Object.freeze({
    schemaVersion: 3,
    threads: Object.freeze([Object.freeze({
      threadId,
      status: hasActiveTurn ? "active" : "ready",
      notices: Object.freeze(page.sessionNotices.map(() => Object.freeze({
        severity: "warning" as const,
        code: "conversation_warning" as const,
      }))),
    })]),
    turns: Object.freeze(turns),
    items: Object.freeze(orderedTurns.flatMap((turn) => historyItemsV4(threadId, turn))),
  });
}

function itemKindV5(itemType: ChatTimelineItemV5["itemType"]): ConversationItemSnapshot["kind"] {
  if (itemType === "agentMessage") return "assistant_message";
  if (itemType === "reasoning") return "reasoning";
  if (itemType === "command") return "command";
  if (itemType === "tool") return "tool";
  return "unknown";
}

function executionV5(item: ChatTimelineItemV5): ConversationExecution | null {
  const execution = item.execution;
  if (execution === null) return null;
  if (execution.kind === "command") {
    return Object.freeze({
      ...execution,
      startedSource: Object.freeze({ ...execution.startedSource }),
      lastSource: Object.freeze({ ...execution.lastSource }),
      commandSummary: Object.freeze({ ...execution.commandSummary }),
      cwd: Object.freeze({
        ...execution.cwd,
        segments: Object.freeze([...execution.cwd.segments]),
      }),
      liveOutput: execution.liveOutput === null
        ? null
        : Object.freeze({ ...execution.liveOutput }),
      output: execution.output === null ? null : Object.freeze({ ...execution.output }),
      error: execution.error === null ? null : Object.freeze({ ...execution.error }),
    });
  }
  return Object.freeze({
    ...execution,
    startedSource: Object.freeze({ ...execution.startedSource }),
    lastSource: Object.freeze({ ...execution.lastSource }),
    identity: Object.freeze({ ...execution.identity }),
    argumentsSummary: Object.freeze({ ...execution.argumentsSummary }),
    progress: Object.freeze(execution.progress.map((progress) => Object.freeze({
      ...progress,
      summary: Object.freeze({ ...progress.summary }),
    }))),
    resultSummary: execution.resultSummary === null
      ? null
      : Object.freeze({ ...execution.resultSummary }),
    error: execution.error === null ? null : Object.freeze({ ...execution.error }),
  });
}

function timelineItemV5(
  threadId: string,
  turnId: string,
  item: ChatTimelineItemV5,
): ConversationItemSnapshot {
  const kind = itemKindV5(item.itemType);
  const contentBlocks = item.itemType === "agentMessage" || item.itemType === "reasoning"
    ? timelineItemBlocksV4(item)
    : kind === "unknown"
      ? Object.freeze([{ blockIndex: 0, type: "unknown" as const, code: "unsupported_content" as const }])
      : Object.freeze([]);
  return Object.freeze({
    threadId,
    turnId,
    itemId: item.itemId,
    ordinal: item.itemOrdinal,
    kind,
    status: itemStatusV4(item.status),
    agentMessagePhase: assistantPhaseV4(item.itemType, item.phase),
    reasoning: kind === "reasoning"
      ? Object.freeze({
          status: item.reasoningStatus ?? (
            item.status === "in_progress" ? "in_progress" : "unknown"
          ),
          reasonCode: conversationReasoningReasonCode(item.reasoningReasonCode),
        })
      : null,
    execution: executionV5(item),
    contentBlocks,
    reconciliation: item.status === "completed" || item.status === "incomplete"
      ? "matched"
      : "not_applicable",
  });
}

function historyItemsV5(
  threadId: string,
  turn: ChatHistoryTurnV4 | ChatHistoryTurnV5,
): readonly ConversationItemSnapshot[] {
  if (turn.projectionAuthority !== "v5") return historyItemsV4(threadId, turn);
  const items = [
    ...messageItems(turn, "user"),
    ...turn.timelineItems.map((item) => timelineItemV5(threadId, turn.turnId, item)),
    ...turn.artifacts.map((artifact) => artifactItem(turn, artifact)),
  ];
  return Object.freeze(items.map((item) => Object.freeze({ ...item, threadId })));
}

export function historyPageV5ToConversationSnapshot(
  threadId: string,
  page: ChatHistoryPageV5,
): ConversationSnapshot {
  const orderedTurns = [...page.turns]
    .sort((left, right) => left.turnId.localeCompare(right.turnId));
  const turns: ConversationTurnSnapshot[] = orderedTurns.map((turn, ordinal) => Object.freeze({
    threadId,
    turnId: turn.turnId,
    ordinal,
    status: turnStatus(turn.status),
    terminalStatus: terminalStatus(turn.status),
    terminalCode: turn.terminalCode,
    plan: turn.plan === null || turn.plan.steps.length === 0
      ? null
      : Object.freeze({
          explanation: turn.plan.explanation,
          steps: Object.freeze(turn.plan.steps.map((step) => Object.freeze({
            ordinal: step.ordinal,
            text: step.step,
            status: step.status,
          }))),
        }),
    notices: Object.freeze(turn.notices.map((notice) => Object.freeze({
      severity: notice.severity,
      code: notice.severity === "error" ? "conversation_error" : "conversation_warning",
    }))),
  }));
  const hasActiveTurn = turns.some((turn) =>
    turn.status === "queued" || turn.status === "in_progress" || turn.status === "waiting_approval"
  );
  return Object.freeze({
    schemaVersion: 3,
    threads: Object.freeze([Object.freeze({
      threadId,
      status: hasActiveTurn ? "active" : "ready",
      notices: Object.freeze(page.sessionNotices.map(() => Object.freeze({
        severity: "warning" as const,
        code: "conversation_warning" as const,
      }))),
    })]),
    turns: Object.freeze(turns),
    items: Object.freeze(orderedTurns.flatMap((turn) => historyItemsV5(threadId, turn))),
  });
}

export function historyPageToConversationSnapshot(
  threadId: string,
  page: ChatHistoryPage | ChatHistoryPageV4 | ChatHistoryPageV5,
): ConversationSnapshot {
  if ("sessionNotices" in page) {
    if ("schemaVersion" in page && page.schemaVersion === 5) {
      return historyPageV5ToConversationSnapshot(threadId, page as ChatHistoryPageV5);
    }
    return historyPageV4ToConversationSnapshot(threadId, page as ChatHistoryPageV4);
  }
  const orderedTurns = [...page.turns].sort((left, right) => left.turnId.localeCompare(right.turnId));
  const turns: ConversationTurnSnapshot[] = orderedTurns.map((turn, ordinal) => Object.freeze({
    threadId,
    turnId: turn.turnId,
    ordinal,
    status: turnStatus(turn.status),
    terminalStatus: terminalStatus(turn.status),
  }));
  const hasActiveTurn = turns.some((turn) =>
    turn.status === "queued" || turn.status === "in_progress" || turn.status === "waiting_approval"
  );
  return Object.freeze({
    schemaVersion: 3,
    threads: Object.freeze([Object.freeze({
      threadId,
      status: hasActiveTurn ? "active" : "ready",
    })]),
    turns: Object.freeze(turns),
    items: Object.freeze(orderedTurns.flatMap((turn) => historyItems(threadId, turn))),
  });
}
