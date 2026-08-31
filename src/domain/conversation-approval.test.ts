import { describe, expect, it } from "vitest";
import {
  createApprovalDecisionRequestV6,
  parseChatProjectionEventV6,
  parsePendingApprovalSnapshotResponseV6,
  type ChatApprovalDecisionResultV6,
  type ChatApprovalProjectionV6,
  type ChatPendingApprovalSnapshotV6,
} from "./chat-ipc";
import {
  applyConversationApprovalDecisionResult,
  conversationApprovalSnapshot,
  createConversationApprovalState,
  disconnectConversationApprovals,
  hydrateConversationApprovalState,
  reconcileConversationApprovalSnapshot,
  reduceConversationApprovalEvent,
  requireConversationApprovalReconciliation,
  revokeExpiredConversationApprovalAuthority,
  selectConversationApproval,
  serializeConversationApprovalState,
  type ConversationApprovalEvent,
  type ConversationApprovalState,
} from "./conversation-approval";

const CONTEXT_ID = "20000000-0000-4000-8000-000000000001";
const THREAD_ID = "20000000-0000-4000-8000-000000000002";
const TURN_ID = "20000000-0000-4000-8000-000000000003";
const STREAM_ID = "20000000-0000-4000-8000-000000000004";
const HOST_STREAM_ID = "20000000-0000-4000-8000-000000000005";
const APPROVAL_ID = "20000000-0000-4000-8000-000000000006";
const DECISION_ID = "20000000-0000-4000-8000-000000000007";
const REQUEST_ID = "20000000-0000-4000-8000-000000000008";
const ITEM_ID = "cmd-feat-137-1";
const REQUESTED_AT = "2026-08-30T12:00:00Z";
const EXPIRES_AT = "2026-08-30T12:02:00Z";

function wireProjection(
  status: "pending" | "resolved",
  overrides: Record<string, unknown> = {},
): ChatApprovalProjectionV6 {
  const payload = status === "pending" ? {
    sourceEventId: "20000000-0000-4000-8000-000000000011",
    sourceSequence: "41",
    sourceOccurredAt: REQUESTED_AT,
    turnId: TURN_ID,
    itemId: ITEM_ID,
    approvalRequestId: APPROVAL_ID,
    status: "pending",
    revision: 1,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    decisions: { primary: "accept_once", secondary: "cancel_current_turn" },
    requestedAt: REQUESTED_AT,
    expiresAt: EXPIRES_AT,
    ttlSeconds: 120,
    ...overrides,
  } : {
    sourceEventId: "20000000-0000-4000-8000-000000000012",
    sourceSequence: "42",
    sourceOccurredAt: "2026-08-30T12:00:30Z",
    turnId: TURN_ID,
    itemId: ITEM_ID,
    approvalRequestId: APPROVAL_ID,
    status: "resolved",
    revision: 2,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    outcome: "accepted_once",
    decisionId: DECISION_ID,
    decision: "accept_once",
    requestedAt: REQUESTED_AT,
    expiresAt: EXPIRES_AT,
    resolvedAt: "2026-08-30T12:00:30Z",
    ...overrides,
  };
  const parsed = parseChatProjectionEventV6({
    schemaVersion: 6,
    subscriptionId: STREAM_ID,
    contextId: CONTEXT_ID,
    sessionId: THREAD_ID,
    turnId: TURN_ID,
    projectionSequence: status === "pending" ? "1" : "2",
    eventId: status === "pending"
      ? "20000000-0000-4000-8000-000000000011"
      : "20000000-0000-4000-8000-000000000012",
    durableSequence: status === "pending" ? "41" : "42",
    kind: "approval_changed",
    payload,
  });
  if (parsed.kind !== "approval_changed") throw new Error("unexpected fixture");
  return parsed.payload;
}

function domainEvent(
  projection: ChatApprovalProjectionV6,
  eventId = projection.sourceEventId,
  sequence = projection.sourceSequence,
): ConversationApprovalEvent {
  return Object.freeze({
    eventId,
    streamId: STREAM_ID,
    sequence,
    threadId: THREAD_ID,
    turnId: TURN_ID,
    projection,
  });
}

function expiredProjection(): ChatApprovalProjectionV6 {
  return Object.freeze({
    sourceEventId: "20000000-0000-4000-8000-000000000014",
    sourceSequence: "42",
    sourceOccurredAt: EXPIRES_AT,
    turnId: TURN_ID,
    itemId: ITEM_ID,
    approvalRequestId: APPROVAL_ID,
    status: "resolved",
    revision: 2,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    outcome: "expired",
    requestedAt: REQUESTED_AT,
    expiresAt: EXPIRES_AT,
    resolvedAt: EXPIRES_AT,
  });
}

function snapshot(
  overrides: Partial<ChatPendingApprovalSnapshotV6> = {},
): ChatPendingApprovalSnapshotV6 {
  return parsePendingApprovalSnapshotResponseV6({
    schemaVersion: 6,
    requestId: REQUEST_ID,
    data: {
      schemaVersion: 6,
      streamId: HOST_STREAM_ID,
      snapshotAt: "2026-08-30T12:00:10Z",
      pending: [{
        approvalRequestId: APPROVAL_ID,
        revision: 1,
        turnId: TURN_ID,
        itemId: ITEM_ID,
        actionId: "git_repository_check",
        workspaceScope: "current_workspace",
        decisions: { primary: "accept_once", secondary: "cancel_current_turn" },
        requestedAt: REQUESTED_AT,
        expiresAt: EXPIRES_AT,
        ttlSeconds: 120,
      }],
      ...overrides,
    },
  });
}

function reconcile(
  state: ConversationApprovalState,
  input = snapshot(),
  overrides: Partial<Parameters<typeof reconcileConversationApprovalSnapshot>[2]> = {},
) {
  return reconcileConversationApprovalSnapshot(state, input, {
    nowEpochMs: Date.parse("2026-08-30T12:00:11Z"),
    expectedThreadId: THREAD_ID,
    expectedStreamId: HOST_STREAM_ID,
    hasCommandItem: (threadId, turnId, itemId) =>
      threadId === THREAD_ID && turnId === TURN_ID && itemId === ITEM_ID,
    ...overrides,
  });
}

describe("FEAT-137 approval reducer", () => {
  it("keeps SSE requested historical until the current pending snapshot matches", () => {
    const requested = reduceConversationApprovalEvent(
      createConversationApprovalState(),
      domainEvent(wireProjection("pending")),
    );
    expect(selectConversationApproval(requested, APPROVAL_ID)).toMatchObject({
      status: "pending",
      authority: "historical",
      authorityStreamId: null,
    });

    const actionable = reconcile(requested);
    expect(actionable.reconciliation).toBe("synchronized");
    expect(selectConversationApproval(actionable, APPROVAL_ID)).toMatchObject({
      status: "pending",
      authority: "actionable",
      authorityStreamId: HOST_STREAM_ID,
    });
  });

  it("deduplicates by event id and fails closed on conflicting reuse", () => {
    const input = domainEvent(wireProjection("pending"));
    const first = reduceConversationApprovalEvent(createConversationApprovalState(), input);
    expect(reduceConversationApprovalEvent(first, input)).toBe(first);

    const conflict = reduceConversationApprovalEvent(first, {
      ...input,
      projection: wireProjection("pending", { itemId: "different-item" }),
    });
    expect(conflict.reconciliation).toBe("required");
    expect(conflict.diagnostics[conflict.diagnostics.length - 1]?.code)
      .toBe("event_id_conflict");
    expect(selectConversationApproval(conflict, APPROVAL_ID)?.authority).toBe("historical");
  });

  it("never rolls a resolved record back on a late requested replay", () => {
    const requested = reduceConversationApprovalEvent(
      createConversationApprovalState(),
      domainEvent(wireProjection("pending")),
    );
    const resolved = reduceConversationApprovalEvent(
      requested,
      domainEvent(wireProjection("resolved")),
    );
    const late = reduceConversationApprovalEvent(
      resolved,
      domainEvent(
        wireProjection("pending"),
        "20000000-0000-4000-8000-000000000013",
        "43",
      ),
    );
    expect(selectConversationApproval(late, APPROVAL_ID)).toMatchObject({
      revision: 2,
      status: "resolved",
      outcome: "accepted_once",
      authority: "historical",
    });
    expect(late.reconciliation).toBe("synchronized");
  });

  it("does not revoke snapshot authority when the same durable request is replayed", () => {
    const requested = reduceConversationApprovalEvent(
      createConversationApprovalState(),
      domainEvent(wireProjection("pending")),
    );
    const actionable = reconcile(requested);
    const replay = reduceConversationApprovalEvent(actionable, {
      ...domainEvent(
        wireProjection("pending"),
        "20000000-0000-4000-8000-000000000015",
        "42",
      ),
      streamId: "20000000-0000-4000-8000-000000000016",
    });
    expect(selectConversationApproval(replay, APPROVAL_ID)).toMatchObject({
      authority: "actionable",
      authorityStreamId: HOST_STREAM_ID,
    });
  });

  it("fails closed on a second simultaneous pending request in one thread", () => {
    const first = reduceConversationApprovalEvent(
      createConversationApprovalState(),
      domainEvent(wireProjection("pending")),
    );
    const secondProjection = wireProjection("pending", {
      approvalRequestId: "20000000-0000-4000-8000-000000000099",
      sourceEventId: "20000000-0000-4000-8000-000000000098",
      sourceSequence: "42",
      itemId: "cmd-feat-137-2",
    });
    const second = reduceConversationApprovalEvent(first, domainEvent(
      secondProjection,
      secondProjection.sourceEventId,
      secondProjection.sourceSequence,
    ));
    expect(second.reconciliation).toBe("required");
    expect(second.diagnostics[second.diagnostics.length - 1]?.code)
      .toBe("projection_conflict");
    expect(selectConversationApproval(
      second,
      "20000000-0000-4000-8000-000000000099",
    )).toBeNull();
  });

  it("revokes authority and rejects stale stream/thread/item reconciliation context", () => {
    const requested = reduceConversationApprovalEvent(
      createConversationApprovalState(),
      domainEvent(wireProjection("pending")),
    );
    const actionable = reconcile(requested);
    expect(selectConversationApproval(
      disconnectConversationApprovals(actionable),
      APPROVAL_ID,
    )?.authority).toBe("historical");
    expect(reconcile(requested, snapshot(), {
      expectedStreamId: "20000000-0000-4000-8000-000000000099",
    }).reconciliation).toBe("required");
    expect(reconcile(requested, snapshot(), {
      expectedThreadId: "20000000-0000-4000-8000-000000000099",
    }).reconciliation).toBe("required");
    expect(reconcile(requested, snapshot(), {
      hasCommandItem: () => false,
    }).reconciliation).toBe("required");
    expect(reconcile(requested, snapshot(), {
      nowEpochMs: Date.parse(EXPIRES_AT),
    }).reconciliation).toBe("required");
  });

  it("revokes actionable authority at expiresAt but waits for Host to resolve lifecycle", () => {
    const actionable = reconcile(reduceConversationApprovalEvent(
      createConversationApprovalState(),
      domainEvent(wireProjection("pending")),
    ));
    const boundary = Date.parse(EXPIRES_AT);

    expect(revokeExpiredConversationApprovalAuthority(actionable, boundary - 1)).toBe(actionable);
    const revoked = revokeExpiredConversationApprovalAuthority(actionable, boundary);
    expect(revoked.reconciliation).toBe("required");
    expect(selectConversationApproval(revoked, APPROVAL_ID)).toMatchObject({
      status: "pending",
      outcome: null,
      authority: "historical",
      authorityStreamId: null,
    });

    const delayedHostTerminal = reduceConversationApprovalEvent(
      revoked,
      domainEvent(expiredProjection()),
    );
    expect(selectConversationApproval(delayedHostTerminal, APPROVAL_ID)).toMatchObject({
      status: "resolved",
      outcome: "expired",
      authority: "historical",
    });
  });

  it("correlates a decision result to the exact submitted id, stream, and decision", () => {
    const requested = reduceConversationApprovalEvent(
      createConversationApprovalState(),
      domainEvent(wireProjection("pending")),
    );
    const actionable = reconcile(requested);
    const request = createApprovalDecisionRequestV6(
      DECISION_ID,
      HOST_STREAM_ID,
      "accept_once",
    );
    const result: ChatApprovalDecisionResultV6 = Object.freeze({
      schemaVersion: 6,
      approvalRequestId: APPROVAL_ID,
      decisionId: DECISION_ID,
      streamId: HOST_STREAM_ID,
      revision: 2,
      decision: "accept_once",
      outcome: "accepted_once",
      resolvedAt: "2026-08-30T12:00:30Z",
    });
    expect(selectConversationApproval(
      applyConversationApprovalDecisionResult(
        actionable,
        APPROVAL_ID,
        request,
        result,
      ),
      APPROVAL_ID,
    )).toMatchObject({ revision: 2, outcome: "accepted_once", authority: "historical" });

    const wrong = applyConversationApprovalDecisionResult(
      actionable,
      APPROVAL_ID,
      { ...request, decisionId: "20000000-0000-4000-8000-000000000099" },
      result,
    );
    expect(wrong.reconciliation).toBe("required");
    expect(wrong.diagnostics[wrong.diagnostics.length - 1]?.code)
      .toBe("decision_result_invalid");
  });

  it("persists only safe lifecycle and hydration never restores action authority", () => {
    const actionable = reconcile(reduceConversationApprovalEvent(
      createConversationApprovalState(),
      domainEvent(wireProjection("pending")),
    ));
    const serialized = serializeConversationApprovalState(actionable);
    expect(serialized).not.toContain("authorityStreamId");
    expect(serialized).not.toContain("actionable");
    expect(serialized).not.toContain("rawCommand");

    const hydrated = hydrateConversationApprovalState(JSON.parse(serialized));
    expect(selectConversationApproval(hydrated, APPROVAL_ID)).toMatchObject({
      status: "pending",
      authority: "historical",
      authorityStreamId: null,
    });
    expect(hydrated.activeByThread).toEqual({});

    const safeSnapshot = conversationApprovalSnapshot(actionable);
    const withRawField = {
      ...safeSnapshot,
      approvals: [{ ...safeSnapshot.approvals[0], rawCommand: "forbidden" }],
    };
    expect(hydrateConversationApprovalState(withRawField).reconciliation).toBe("required");
    expect(hydrateConversationApprovalState({
      ...safeSnapshot,
      approvals: [{
        ...safeSnapshot.approvals[0],
        approvalRequestId: "not-a-uuid",
      }],
    }).reconciliation).toBe("required");
    expect(hydrateConversationApprovalState({
      ...safeSnapshot,
      approvals: [{
        ...safeSnapshot.approvals[0],
        expiresAt: "2026-08-30T12:02:01Z",
      }],
    }).reconciliation).toBe("required");
    expect(hydrateConversationApprovalState({
      ...safeSnapshot,
      approvals: [{
        ...safeSnapshot.approvals[0],
        actionId: "future_action",
      }],
    }).reconciliation).toBe("required");
    expect(hydrateConversationApprovalState({
      ...safeSnapshot,
      approvals: [{
        ...safeSnapshot.approvals[0],
        source: null,
      }],
    }).reconciliation).toBe("required");

    const offsetRequestedAt = "2026-08-30T20:00:00.123456789+08:00";
    const validOffsetNanoseconds = hydrateConversationApprovalState({
      ...safeSnapshot,
      approvals: [{
        ...safeSnapshot.approvals[0],
        requestedAt: offsetRequestedAt,
        expiresAt: "2026-08-30T20:02:00.123456789+08:00",
        source: {
          ...safeSnapshot.approvals[0]!.source!,
          sourceOccurredAt: offsetRequestedAt,
        },
      }],
    });
    expect(validOffsetNanoseconds.reconciliation).toBe("synchronized");
    expect(selectConversationApproval(validOffsetNanoseconds, APPROVAL_ID)?.requestedAt)
      .toBe(offsetRequestedAt);
    for (const invalidWindow of [
      {
        requestedAt: "2026-02-31T12:00:00Z",
        expiresAt: "2026-03-03T12:02:00Z",
      },
      {
        requestedAt: "2026-08-30T12:00:00.1234567890Z",
        expiresAt: "2026-08-30T12:02:00.1234567890Z",
      },
      {
        requestedAt: "2026-08-30T12:00:00.123456789Z",
        expiresAt: "2026-08-30T12:02:00.123456788Z",
      },
    ]) {
      expect(hydrateConversationApprovalState({
        ...safeSnapshot,
        approvals: [{
          ...safeSnapshot.approvals[0],
          ...invalidWindow,
        }],
      }).reconciliation).toBe("required");
    }

    const duplicatePending = {
      ...safeSnapshot.approvals[0]!,
      approvalRequestId: "20000000-0000-4000-8000-000000000017",
      source: {
        ...safeSnapshot.approvals[0]!.source!,
        sourceEventId: "20000000-0000-4000-8000-000000000018",
      },
    };
    expect(hydrateConversationApprovalState({
      ...safeSnapshot,
      approvals: [...safeSnapshot.approvals, duplicatePending],
    }).reconciliation).toBe("required");
    expect(hydrateConversationApprovalState({
      ...safeSnapshot,
      approvals: Array.from({ length: 129 }, () => safeSnapshot.approvals[0]),
    }).reconciliation).toBe("required");
  });

  it("never persists a record synthesized only from a realtime snapshot", () => {
    const snapshotOnly = reconcile(createConversationApprovalState());
    expect(selectConversationApproval(snapshotOnly, APPROVAL_ID)).toMatchObject({
      authority: "actionable",
      source: null,
      threadId: THREAD_ID,
    });
    expect(conversationApprovalSnapshot(snapshotOnly).approvals).toEqual([]);
  });

  it("keeps unknown transport outcomes non-actionable until snapshot reconciliation", () => {
    const actionable = reconcile(reduceConversationApprovalEvent(
      createConversationApprovalState(),
      domainEvent(wireProjection("pending")),
    ));
    const uncertain = requireConversationApprovalReconciliation(actionable);
    expect(uncertain.reconciliation).toBe("required");
    expect(selectConversationApproval(uncertain, APPROVAL_ID)?.authority).toBe("historical");
  });
});
