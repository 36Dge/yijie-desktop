import type {
  ChatArtifact,
  ChatAttachment,
  ChatHistoryPage,
  ChatHistoryTurn,
  ChatMessage,
  ChatMessageContentBlock,
  ChatProjectionEvent,
} from "../domain/chat-ipc";
import type {
  ConversationContentBlock,
  ConversationEvent,
  ConversationItemSnapshot,
  ConversationSnapshot,
  ConversationTerminalStatus,
  ConversationTurnSnapshot,
  ConversationTurnStatus,
} from "../domain/conversation-state";

const USER_ITEM_ORDINAL = 0;
const REASONING_ITEM_ORDINAL_BASE = 100;
const ASSISTANT_ITEM_ORDINAL = 200;
const ARTIFACT_ITEM_ORDINAL_BASE = 300;

export type ConversationProjectionAdaptation =
  | Readonly<{ kind: "domain_event"; event: ConversationEvent }>
  | Readonly<{ kind: "cleanup_state"; event: ConversationEvent }>
  | Readonly<{ kind: "resync_required"; reason: "projection_gap" | "invalid_projection" }>
  | Readonly<{ kind: "context_invalidated" }>;

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

function messageItems(turn: ChatHistoryTurn): readonly ConversationItemSnapshot[] {
  const roleCounts: Record<ChatMessage["role"], number> = { user: 0, assistant: 0 };
  return [...turn.messages]
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

export function historyPageToConversationSnapshot(
  threadId: string,
  page: ChatHistoryPage,
): ConversationSnapshot {
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
    threads: Object.freeze([Object.freeze({
      threadId,
      status: hasActiveTurn ? "active" : "ready",
    })]),
    turns: Object.freeze(turns),
    items: Object.freeze(orderedTurns.flatMap((turn) => historyItems(threadId, turn))),
  });
}

function eventCursor(event: ChatProjectionEvent) {
  return {
    eventId: event.eventId,
    streamId: event.subscriptionId,
    sequence: event.projectionSequence,
    threadId: event.sessionId,
  } as const;
}

function domainCursor(event: ChatProjectionEvent, turnId: string) {
  return {
    ...eventCursor(event),
    turnId,
  } as const;
}

export function projectionEventToConversation(
  event: ChatProjectionEvent,
): ConversationProjectionAdaptation {
  if (event.kind === "context_invalidated") return Object.freeze({ kind: "context_invalidated" });
  if (event.kind === "cleanup_state") {
    return Object.freeze({
      kind: "cleanup_state",
      event: Object.freeze({ ...eventCursor(event), kind: "auxiliary" }),
    });
  }
  if (event.kind === "resync_required") {
    return Object.freeze({ kind: "resync_required", reason: "projection_gap" });
  }
  if (event.turnId === undefined) {
    return Object.freeze({ kind: "resync_required", reason: "invalid_projection" });
  }
  const cursor = domainCursor(event, event.turnId);
  switch (event.kind) {
    case "assistant_append":
      return Object.freeze({
        kind: "domain_event",
        event: Object.freeze({
          ...cursor,
          kind: "item.delta",
          itemId: conversationMessageItemId(event.turnId, "assistant"),
          ordinal: ASSISTANT_ITEM_ORDINAL,
          itemKind: "assistant_message",
          blockIndex: 0,
          blockType: "text",
          delta: event.payload.text,
        }),
      });
    case "reasoning_append":
      return Object.freeze({
        kind: "domain_event",
        event: Object.freeze({
          ...cursor,
          kind: "item.delta",
          itemId: conversationReasoningItemId(event.turnId, event.payload.itemOrdinal),
          ordinal: REASONING_ITEM_ORDINAL_BASE + event.payload.itemOrdinal,
          itemKind: "reasoning",
          blockIndex: event.payload.contentIndex,
          blockType: "text",
          delta: event.payload.text,
        }),
      });
    case "turn_state":
      return Object.freeze({
        kind: "domain_event",
        event: Object.freeze({ ...cursor, kind: "turn.started", ordinal: null }),
      });
    case "turn_terminal": {
      const projectedTerminal = terminalStatus(event.payload.status);
      if (projectedTerminal === null) {
        return Object.freeze({ kind: "resync_required", reason: "invalid_projection" });
      }
      return Object.freeze({
        kind: "domain_event",
        event: Object.freeze({
          ...cursor,
          kind: "turn.completed",
          terminalStatus: projectedTerminal,
        }),
      });
    }
  }
}
