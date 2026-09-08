import { describe,expect,it } from "vitest";
import {
parseChatProjectionEventV6,
parseHistoryPageResponseV6,
parsePendingApprovalSnapshotResponseV6,
} from "../domain/chat-ipc";
import {
createConversationApprovalState,
reconcileConversationApprovalSnapshot,
reduceConversationApprovalEvent,
} from "../domain/conversation-approval";
import { selectConversationTimeline } from "../domain/conversation-timeline";
import { viewFromLegacySnapshot } from "../domain/conversation-view";
import {
approvalDecisionResultV6ToDomain,
createApprovalDecisionIntentV6,
historyPageV6ToApprovalEvents,
historyPageV6ToConversationSnapshot,
projectionEventV6ToDomain,
} from "./chat-approval-adapter";

const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const CONTEXT_ID = "30000000-0000-4000-8000-000000000002";
const THREAD_ID = "30000000-0000-4000-8000-000000000003";
const TURN_ID = "30000000-0000-4000-8000-000000000004";
const STREAM_ID = "30000000-0000-4000-8000-000000000005";
const APPROVAL_ID = "30000000-0000-4000-8000-000000000006";
const ITEM_ID = "cmd-feat-137-adapter";
const REQUESTED_AT = "2026-08-30T12:00:00Z";
const EXPIRES_AT = "2026-08-30T12:02:00Z";

const source = Object.freeze({
  sourceEventId: "30000000-0000-4000-8000-000000000010",
  sourceSequence: "41",
  sourceOccurredAt: REQUESTED_AT,
});
const decisions = Object.freeze({
  primary: "accept_once",
  secondary: "cancel_current_turn",
});
const commandSummary = Object.freeze({
  text: "Check whether the workspace is a Git repository",
  truncated: false,
  truncationReason: null,
});
const cwd = Object.freeze({ kind: "workspace_root", segments: Object.freeze([]) });

function requestedPayload() {
  return {
    ...source,
    turnId: TURN_ID,
    itemId: ITEM_ID,
    approvalRequestId: APPROVAL_ID,
    status: "pending",
    revision: 1,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    decisions,
    requestedAt: REQUESTED_AT,
    expiresAt: EXPIRES_AT,
    ttlSeconds: 120,
  };
}

function approvalEvent() {
  return parseChatProjectionEventV6({
    schemaVersion: 6,
    subscriptionId: STREAM_ID,
    contextId: CONTEXT_ID,
    sessionId: THREAD_ID,
    turnId: TURN_ID,
    projectionSequence: "1",
    eventId: source.sourceEventId,
    durableSequence: source.sourceSequence,
    kind: "approval_changed",
    payload: requestedPayload(),
  });
}

function commandTurn() {
  return {
    turnId: TURN_ID,
    status: "streaming",
    terminalAt: null,
    reasoningStatus: "pending",
    reasoningReasonCode: null,
    messages: [],
    reasoning: [],
    projectionAuthority: "v5",
    artifacts: [],
    terminalCode: null,
    timelineItems: [{
      ...source,
      itemId: ITEM_ID,
      itemOrdinal: 1,
      itemType: "command",
      phase: null,
      status: "in_progress",
      text: "",
      reasoningStatus: null,
      reasoningReasonCode: null,
      reasoningParts: [],
      startedAtMs: 1,
      completedAtMs: null,
      execution: {
        kind: "command",
        status: "running",
        startedSource: source,
        lastSource: source,
        commandSummary,
        cwd,
        liveOutput: null,
        output: null,
        durationMs: null,
        exitCode: null,
        error: null,
      },
    }],
    plan: null,
    notices: [],
  };
}

function historyPage() {
  return parseHistoryPageResponseV6({
    schemaVersion: 6,
    requestId: REQUEST_ID,
    data: {
      turns: [commandTurn()],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: source.sourceSequence,
      approvals: [requestedPayload()],
    },
  });
}

function pendingSnapshot() {
  return parsePendingApprovalSnapshotResponseV6({
    schemaVersion: 6,
    requestId: REQUEST_ID,
    data: {
      schemaVersion: 6,
      streamId: STREAM_ID,
      snapshotAt: "2026-08-30T12:00:10Z",
      pending: [{
        approvalRequestId: APPROVAL_ID,
        revision: 1,
        turnId: TURN_ID,
        itemId: ITEM_ID,
        actionId: "git_repository_check",
        workspaceScope: "current_workspace",
        decisions,
        requestedAt: REQUESTED_AT,
        expiresAt: EXPIRES_AT,
        ttlSeconds: 120,
      }],
    },
  });
}

describe("FEAT-137 v6 conversation approval adapter", () => {
  it("maps archived approval events separately and ignores retired content notifications", () => {
    expect(projectionEventV6ToDomain(approvalEvent())).toMatchObject({
      kind: "approval_event",
      event: {
        eventId: source.sourceEventId,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        projection: { approvalRequestId: APPROVAL_ID, status: "pending" },
      },
    });

    const inherited = parseChatProjectionEventV6({
      schemaVersion: 6,
      subscriptionId: STREAM_ID,
      contextId: CONTEXT_ID,
      sessionId: THREAD_ID,
      turnId: TURN_ID,
      projectionSequence: "2",
      eventId: "30000000-0000-4000-8000-000000000011",
      durableSequence: "40",
      kind: "command_started",
      payload: {
        ...source,
        itemId: ITEM_ID,
        itemOrdinal: 1,
        status: "running",
        commandSummary,
        cwd,
      },
    });
    expect(projectionEventV6ToDomain(inherited)).toEqual({kind: "ignored"});
  });

  it("hydrates durable lifecycle, then attaches realtime authority only to its command", () => {
    const page = historyPage();
    const conversation = viewFromLegacySnapshot(
      historyPageV6ToConversationSnapshot(THREAD_ID, page),
    );
    const approvalEvents = historyPageV6ToApprovalEvents(THREAD_ID, STREAM_ID, page);
    const historical = approvalEvents.reduce(
      reduceConversationApprovalEvent,
      createConversationApprovalState(),
    );
    const actionable = reconcileConversationApprovalSnapshot(
      historical,
      pendingSnapshot(),
      {
        nowEpochMs: Date.parse("2026-08-30T12:00:11Z"),
        expectedThreadId: THREAD_ID,
        expectedStreamId: STREAM_ID,
        hasCommandItem: (threadId, turnId, itemId) =>
          threadId === THREAD_ID && turnId === TURN_ID && itemId === ITEM_ID,
      },
    );

    const timeline = selectConversationTimeline(conversation, THREAD_ID, actionable);
    expect(timeline?.turns[0]?.items[0]).toMatchObject({
      kind: "command",
      approval: {
        approvalRequestId: APPROVAL_ID,
        threadId: THREAD_ID,
        authority: "actionable",
        authorityStreamId: STREAM_ID,
      },
    });
  });

  it("adapts one safe decision and accepts an identical SSE-first terminal idempotently", () => {
    const page = historyPage();
    const historical = historyPageV6ToApprovalEvents(THREAD_ID, STREAM_ID, page)
      .reduce(reduceConversationApprovalEvent, createConversationApprovalState());
    const actionable = reconcileConversationApprovalSnapshot(
      historical,
      pendingSnapshot(),
      {
        nowEpochMs: Date.parse("2026-08-30T12:00:11Z"),
        expectedThreadId: THREAD_ID,
        expectedStreamId: STREAM_ID,
        hasCommandItem: () => true,
      },
    );
    const intent = createApprovalDecisionIntentV6(
      actionable.approvals[APPROVAL_ID] ?? null,
      {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: ITEM_ID,
        approvalRequestId: APPROVAL_ID,
        decision: "accept_once",
      },
    );
    if (intent === null) throw new Error("fixture_missing_intent");
    const result = Object.freeze({
      schemaVersion: 6 as const,
      approvalRequestId: APPROVAL_ID,
      decisionId: "30000000-0000-4000-8000-000000000020",
      streamId: STREAM_ID,
      revision: 2 as const,
      decision: "accept_once" as const,
      outcome: "accepted_once" as const,
      resolvedAt: "2026-08-30T12:00:30Z",
    });

    const direct = approvalDecisionResultV6ToDomain(actionable, intent, result);
    expect(direct.correlated).toBe(true);
    expect(direct.state.approvals[APPROVAL_ID]).toMatchObject({
      status: "resolved",
      decision: "accept_once",
      outcome: "accepted_once",
    });

    const sseFirst = reduceConversationApprovalEvent(actionable, {
      eventId: "30000000-0000-4000-8000-000000000021",
      streamId: STREAM_ID,
      sequence: "2",
      threadId: THREAD_ID,
      turnId: TURN_ID,
      projection: Object.freeze({
        sourceEventId: "30000000-0000-4000-8000-000000000021",
        sourceSequence: "42",
        sourceOccurredAt: result.resolvedAt,
        turnId: TURN_ID,
        itemId: ITEM_ID,
        approvalRequestId: APPROVAL_ID,
        status: "resolved" as const,
        revision: 2 as const,
        actionId: "git_repository_check" as const,
        workspaceScope: "current_workspace" as const,
        requestedAt: REQUESTED_AT,
        expiresAt: EXPIRES_AT,
        decisionId: result.decisionId,
        decision: result.decision,
        outcome: result.outcome,
        resolvedAt: result.resolvedAt,
      }),
    });
    const replayed = approvalDecisionResultV6ToDomain(sseFirst, intent, result);
    expect(replayed.correlated).toBe(true);
    expect(replayed.state.diagnostics).toEqual(sseFirst.diagnostics);

    const mismatched = approvalDecisionResultV6ToDomain(actionable, intent, {
      ...result,
      approvalRequestId: "30000000-0000-4000-8000-000000000099",
    });
    expect(mismatched.correlated).toBe(false);
    expect(mismatched.state.reconciliation).toBe("required");
  });
});
