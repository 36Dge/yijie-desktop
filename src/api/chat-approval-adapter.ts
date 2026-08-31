import {
  createApprovalDecisionRequestV6,
  type ChatApprovalDecisionResultV6,
  type ChatApprovalDecisionV6,
  type ChatHistoryPageV5,
  type ChatHistoryPageV6,
  type ChatProjectionEventV5,
  type ChatProjectionEventV6,
} from "../domain/chat-ipc";
import {
  applyConversationApprovalDecisionResult,
  requireConversationApprovalReconciliation,
  selectConversationApproval,
  type ConversationApproval,
  type ConversationApprovalEvent,
  type ConversationApprovalState,
} from "../domain/conversation-approval";
import type { ConversationSnapshot } from "../domain/conversation-state";
import {
  historyPageV5ToConversationSnapshot,
  projectionEventToConversation,
  type ConversationProjectionAdaptation,
} from "./chat-conversation-adapter";

export type ChatProjectionV6Adaptation =
  | ConversationProjectionAdaptation
  | Readonly<{
      kind: "approval_event";
      event: ConversationApprovalEvent;
    }>;

export interface ChatApprovalDecisionIntentV6 {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly approvalRequestId: string;
  readonly decision: ChatApprovalDecisionV6;
}

export interface ChatApprovalDecisionAdaptationV6 {
  readonly state: ConversationApprovalState;
  readonly correlated: boolean;
}

export function createApprovalDecisionIntentV6(
  approval: ConversationApproval | null,
  input: ChatApprovalDecisionIntentV6,
): ChatApprovalDecisionIntentV6 | null {
  if (
    approval === null || approval.status !== "pending" || approval.revision !== 1 ||
    approval.authority !== "actionable" || approval.decisions === null ||
    approval.threadId !== input.threadId || approval.turnId !== input.turnId ||
    approval.itemId !== input.itemId ||
    approval.approvalRequestId !== input.approvalRequestId ||
    (input.decision !== approval.decisions.primary &&
      input.decision !== approval.decisions.secondary)
  ) return null;
  return Object.freeze({
    threadId: approval.threadId,
    turnId: approval.turnId,
    itemId: approval.itemId,
    approvalRequestId: approval.approvalRequestId,
    decision: input.decision,
  });
}

function matchesAlreadyAppliedDecision(
  approval: ConversationApproval | null,
  intent: ChatApprovalDecisionIntentV6,
  result: ChatApprovalDecisionResultV6,
): boolean {
  return approval !== null && approval.status === "resolved" &&
    approval.approvalRequestId === intent.approvalRequestId &&
    approval.threadId === intent.threadId && approval.turnId === intent.turnId &&
    approval.itemId === intent.itemId && approval.decisionId === result.decisionId &&
    approval.decision === result.decision && approval.outcome === result.outcome &&
    approval.resolvedAt === result.resolvedAt && result.decision === intent.decision;
}

export function approvalDecisionResultV6ToDomain(
  state: ConversationApprovalState,
  intent: ChatApprovalDecisionIntentV6,
  result: ChatApprovalDecisionResultV6,
): ChatApprovalDecisionAdaptationV6 {
  const current = selectConversationApproval(state, intent.approvalRequestId);
  if (matchesAlreadyAppliedDecision(current, intent, result)) {
    return Object.freeze({ state, correlated: true });
  }
  if (result.approvalRequestId !== intent.approvalRequestId ||
      result.decision !== intent.decision) {
    return Object.freeze({
      state: requireConversationApprovalReconciliation(state),
      correlated: false,
    });
  }
  let request;
  try {
    request = createApprovalDecisionRequestV6(
      result.decisionId,
      result.streamId,
      result.decision,
    );
  } catch {
    return Object.freeze({
      state: requireConversationApprovalReconciliation(state),
      correlated: false,
    });
  }
  const next = applyConversationApprovalDecisionResult(
    state,
    intent.approvalRequestId,
    request,
    result,
  );
  const resolved = selectConversationApproval(next, intent.approvalRequestId);
  const correlated = next.reconciliation === "synchronized" &&
    matchesAlreadyAppliedDecision(resolved, intent, result);
  return Object.freeze({
    state: correlated ? next : requireConversationApprovalReconciliation(next),
    correlated,
  });
}

function inheritedV6AsV5(event: ChatProjectionEventV6): ChatProjectionEventV5 {
  const sourceSchemaVersion = "sourceSchemaVersion" in event
    ? event.sourceSchemaVersion
    : undefined;
  const inherited = Object.fromEntries(Object.entries(event)
    .filter(([key]) => key !== "sourceSchemaVersion"));
  return Object.freeze({
    ...inherited,
    schemaVersion: 5 as const,
    ...(sourceSchemaVersion === 4 ? { sourceSchemaVersion: 4 as const } : {}),
  }) as ChatProjectionEventV5;
}

export function projectionEventV6ToDomain(
  event: ChatProjectionEventV6,
): ChatProjectionV6Adaptation {
  if (event.kind !== "approval_changed") {
    return projectionEventToConversation(inheritedV6AsV5(event));
  }
  return Object.freeze({
    kind: "approval_event" as const,
    event: Object.freeze({
      eventId: event.eventId,
      streamId: event.subscriptionId,
      sequence: event.projectionSequence,
      threadId: event.sessionId,
      turnId: event.turnId,
      projection: event.payload,
    }),
  });
}

export function historyPageV6ToConversationSnapshot(
  threadId: string,
  page: ChatHistoryPageV6,
): ConversationSnapshot {
  const pageV5: ChatHistoryPageV5 = Object.freeze({
    schemaVersion: 5,
    turns: page.turns,
    nextCursor: page.nextCursor,
    sessionNotices: page.sessionNotices,
    durableSequenceCut: page.durableSequenceCut,
  });
  return historyPageV5ToConversationSnapshot(threadId, pageV5);
}

export function historyPageV6ToApprovalEvents(
  threadId: string,
  streamId: string,
  page: ChatHistoryPageV6,
): readonly ConversationApprovalEvent[] {
  return Object.freeze([...page.approvals]
    .sort((left, right) => {
      const sequenceOrder = BigInt(left.sourceSequence) < BigInt(right.sourceSequence)
        ? -1
        : BigInt(left.sourceSequence) > BigInt(right.sourceSequence) ? 1 : 0;
      return sequenceOrder || left.sourceEventId.localeCompare(right.sourceEventId);
    })
    .map((projection) => Object.freeze({
      eventId: projection.sourceEventId,
      streamId,
      sequence: projection.sourceSequence,
      threadId,
      turnId: projection.turnId,
      projection,
    })));
}
