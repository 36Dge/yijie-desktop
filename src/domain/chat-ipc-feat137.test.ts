import { describe, expect, it } from "vitest";
import {
  ChatContractError,
  createApprovalDecisionRequestV6,
  parseApprovalDecisionRequestV6,
  parseApprovalDecisionResponseV6,
  parseApprovalErrorV6,
  parseChatProjectionEventV6,
  parseHistoryPageResponseV6,
  parsePendingApprovalSnapshotResponseV6,
  parseResyncResponseV6,
  parseSubscriptionResponseV6,
} from "./chat-ipc";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const CONTEXT_ID = "10000000-0000-4000-8000-000000000002";
const SESSION_ID = "10000000-0000-4000-8000-000000000003";
const TURN_ID = "10000000-0000-4000-8000-000000000004";
const SUBSCRIPTION_ID = "10000000-0000-4000-8000-000000000005";
const HOST_STREAM_ID = "10000000-0000-4000-8000-000000000006";
const APPROVAL_ID = "10000000-0000-4000-8000-000000000007";
const DECISION_ID = "10000000-0000-4000-8000-000000000008";
const SOURCE_EVENT_ID = "10000000-0000-4000-8000-000000000011";

const REQUESTED_AT = "2026-08-30T12:00:00Z";
const EXPIRES_AT = "2026-08-30T12:02:00Z";

const decisions = Object.freeze({
  primary: "accept_once",
  secondary: "cancel_current_turn",
});

function requestedPayload(overrides: Record<string, unknown> = {}) {
  return {
    sourceEventId: SOURCE_EVENT_ID,
    sourceSequence: "41",
    sourceOccurredAt: REQUESTED_AT,
    turnId: TURN_ID,
    itemId: "cmd-feat-137-1",
    approvalRequestId: APPROVAL_ID,
    status: "pending",
    revision: 1,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    decisions,
    requestedAt: REQUESTED_AT,
    expiresAt: EXPIRES_AT,
    ttlSeconds: 120,
    ...overrides,
  };
}

function resolvedPayload(
  outcome: "accepted_once" | "cancelled_current_turn" | "expired" | "resolved_elsewhere",
  resolvedAt: string,
) {
  const decided = outcome === "accepted_once" || outcome === "cancelled_current_turn";
  return {
    sourceEventId: "10000000-0000-4000-8000-000000000012",
    sourceSequence: "42",
    sourceOccurredAt: resolvedAt,
    turnId: TURN_ID,
    itemId: "cmd-feat-137-1",
    approvalRequestId: APPROVAL_ID,
    status: "resolved",
    revision: 2,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    outcome,
    ...(decided ? {
      decisionId: DECISION_ID,
      decision: outcome === "accepted_once" ? "accept_once" : "cancel_current_turn",
    } : {}),
    requestedAt: REQUESTED_AT,
    expiresAt: EXPIRES_AT,
    resolvedAt,
  };
}

function event(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 6,
    subscriptionId: SUBSCRIPTION_ID,
    contextId: CONTEXT_ID,
    sessionId: SESSION_ID,
    turnId: TURN_ID,
    projectionSequence: "1",
    eventId: SOURCE_EVENT_ID,
    durableSequence: "41",
    kind: "approval_changed",
    payload,
    ...overrides,
  };
}

function pendingSnapshot(snapshotAt = "2026-08-30T12:00:10Z") {
  return {
    schemaVersion: 6,
    streamId: HOST_STREAM_ID,
    snapshotAt,
    pending: [{
      approvalRequestId: APPROVAL_ID,
      revision: 1,
      turnId: TURN_ID,
      itemId: "cmd-feat-137-1",
      actionId: "git_repository_check",
      workspaceScope: "current_workspace",
      decisions,
      requestedAt: REQUESTED_AT,
      expiresAt: EXPIRES_AT,
      ttlSeconds: 120,
    }],
  };
}

function commandTurn() {
  const source = {
    sourceEventId: "10000000-0000-4000-8000-000000000020",
    sourceSequence: "40",
    sourceOccurredAt: "2026-08-30T11:59:59Z",
  };
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
      itemId: "cmd-feat-137-1",
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
        commandSummary: {
          text: "Check whether the workspace is a Git repository",
          truncated: false,
          truncationReason: null,
        },
        cwd: { kind: "workspace_root", segments: [] },
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

function historyData(approvals: readonly unknown[] = [requestedPayload()]) {
  return {
    turns: [commandTurn()],
    nextCursor: null,
    sessionNotices: [],
    durableSequenceCut: "41",
    approvals,
  };
}

function response(data: unknown) {
  return { schemaVersion: 6, requestId: REQUEST_ID, data };
}

describe("FEAT-137 private IPC v6 closed consumer", () => {
  it("decodes only the safe requested/resolved lifecycle", () => {
    expect(parseChatProjectionEventV6(event(requestedPayload()))).toMatchObject({
      schemaVersion: 6,
      kind: "approval_changed",
      payload: {
        status: "pending",
        approvalRequestId: APPROVAL_ID,
        actionId: "git_repository_check",
      },
    });
    expect(parseChatProjectionEventV6(event(
      resolvedPayload("accepted_once", "2026-08-30T12:00:30Z"),
      { eventId: "10000000-0000-4000-8000-000000000012" },
    ))).toMatchObject({
      payload: {
        status: "resolved",
        decision: "accept_once",
        outcome: "accepted_once",
      },
    });

    expect(() => parseChatProjectionEventV6(event(requestedPayload({
      rawCommand: "forbidden raw command",
    })))).toThrow(ChatContractError);
    expect(() => parseChatProjectionEventV6(event(requestedPayload({
      turnId: "10000000-0000-4000-8000-000000000099",
    })))).toThrow(ChatContractError);
    expect(() => parseChatProjectionEventV6({
      ...event(requestedPayload()),
      sourceSchemaVersion: 6,
    })).toThrow(ChatContractError);
  });

  it("enforces outcome-aware resolved_at boundaries", () => {
    for (const outcome of [
      "accepted_once", "cancelled_current_turn", "resolved_elsewhere",
    ] as const) {
      expect(parseChatProjectionEventV6(event(
        resolvedPayload(outcome, "2026-08-30T12:01:59.999Z"),
      ))).toMatchObject({ payload: { outcome } });
      expect(() => parseChatProjectionEventV6(event(
        resolvedPayload(outcome, EXPIRES_AT),
      ))).toThrow(ChatContractError);
      expect(() => parseChatProjectionEventV6(event(
        resolvedPayload(outcome, "2026-08-30T11:59:59.999Z"),
      ))).toThrow(ChatContractError);
    }
    expect(parseChatProjectionEventV6(event(
      resolvedPayload("expired", EXPIRES_AT),
    ))).toMatchObject({ payload: { outcome: "expired" } });
    expect(() => parseChatProjectionEventV6(event(
      resolvedPayload("expired", "2026-08-30T12:01:59.999Z"),
    ))).toThrow(ChatContractError);
  });

  it("uses strict Gregorian RFC3339 and exact nanosecond approval windows", () => {
    const offsetRequestedAt = "2026-08-30T20:00:00.123456789+08:00";
    const offsetExpiresAt = "2026-08-30T20:02:00.123456789+08:00";
    expect(parseChatProjectionEventV6(event(requestedPayload({
      sourceOccurredAt: offsetRequestedAt,
      requestedAt: offsetRequestedAt,
      expiresAt: offsetExpiresAt,
    })))).toMatchObject({
      payload: { requestedAt: offsetRequestedAt, expiresAt: offsetExpiresAt },
    });

    for (const invalid of [
      {
        sourceOccurredAt: "2026-02-31T12:00:00Z",
        requestedAt: "2026-02-31T12:00:00Z",
        expiresAt: "2026-03-03T12:02:00Z",
      },
      {
        sourceOccurredAt: "2026-08-30T12:00:00.1234567890Z",
        requestedAt: "2026-08-30T12:00:00.1234567890Z",
        expiresAt: "2026-08-30T12:02:00.1234567890Z",
      },
      {
        sourceOccurredAt: "2026-08-30T12:00:00.123456789Z",
        requestedAt: "2026-08-30T12:00:00.123456789Z",
        expiresAt: "2026-08-30T12:02:00.123456788Z",
      },
    ]) {
      expect(() => parseChatProjectionEventV6(event(requestedPayload(invalid))))
        .toThrow(ChatContractError);
    }
  });

  it("keeps v5/v4 inheritance explicit and rejects unknown v6 variants", () => {
    const inheritedCommand = {
      schemaVersion: 6,
      subscriptionId: SUBSCRIPTION_ID,
      contextId: CONTEXT_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      projectionSequence: "2",
      eventId: "10000000-0000-4000-8000-000000000021",
      durableSequence: "40",
      kind: "command_started",
      payload: {
        sourceEventId: "10000000-0000-4000-8000-000000000020",
        sourceSequence: "40",
        sourceOccurredAt: "2026-08-30T11:59:59Z",
        itemId: "cmd-feat-137-1",
        itemOrdinal: 1,
        status: "running",
        commandSummary: { text: "Safe summary", truncated: false, truncationReason: null },
        cwd: { kind: "workspace_root", segments: [] },
      },
    };
    expect(parseChatProjectionEventV6(inheritedCommand)).toMatchObject({
      schemaVersion: 6,
      kind: "command_started",
    });
    expect(parseChatProjectionEventV6({
      ...inheritedCommand,
      sourceSchemaVersion: 5,
    })).toMatchObject({ sourceSchemaVersion: 5 });
    expect(() => parseChatProjectionEventV6({
      ...inheritedCommand,
      kind: "future_approval",
      payload: {},
    })).toThrow(ChatContractError);
  });

  it("closes pending snapshots and excludes the expiry instant", () => {
    expect(parsePendingApprovalSnapshotResponseV6(response(pendingSnapshot())))
      .toMatchObject({ streamId: HOST_STREAM_ID, pending: [{ revision: 1 }] });
    expect(() => parsePendingApprovalSnapshotResponseV6(response(
      pendingSnapshot(EXPIRES_AT),
    ))).toThrow(ChatContractError);
    expect(() => parsePendingApprovalSnapshotResponseV6(response({
      ...pendingSnapshot(),
      pending: [{ ...pendingSnapshot().pending[0], command: "forbidden" }],
    }))).toThrow(ChatContractError);
  });

  it("decodes v6 history, subscribe, and resync without persisting action authority", () => {
    const history = parseHistoryPageResponseV6(response(historyData()));
    expect(history).toMatchObject({
      schemaVersion: 6,
      approvals: [{ status: "pending", turnId: TURN_ID }],
    });
    expect(history.approvals[0]).not.toHaveProperty("actionable");

    const subscription = parseSubscriptionResponseV6(response({
      subscriptionId: SUBSCRIPTION_ID,
      pendingApprovalSnapshot: pendingSnapshot(),
    }));
    expect(subscription.subscriptionId).toBe(SUBSCRIPTION_ID);
    expect(subscription.pendingApprovalSnapshot.streamId).toBe(HOST_STREAM_ID);

    const session = {
      sessionId: SESSION_ID,
      projectId: "10000000-0000-4000-8000-000000000030",
      title: "Safe session",
      titleSource: "fallback",
      pinnedAt: null,
      lastActivityAt: 1,
      latestTurnStatus: "streaming",
      projectAvailable: true,
    };
    expect(parseResyncResponseV6(response({
      session,
      history: historyData(),
      cleanup: null,
      pendingApprovalSnapshot: pendingSnapshot(),
    }))).toMatchObject({
      session: { sessionId: SESSION_ID },
      pendingApprovalSnapshot: {
        pending: [{ turnId: TURN_ID }],
      },
    });
    expect(() => parseResyncResponseV6(response({
      session,
      history: historyData(),
      cleanup: null,
      pendingApprovalSnapshot: {
        ...pendingSnapshot(),
        pending: [{
          ...pendingSnapshot().pending[0],
          itemId: "missing-command",
        }],
      },
    }))).toThrow(ChatContractError);
    expect(() => parseHistoryPageResponseV6(response(historyData([
      requestedPayload({ itemId: "missing-command" }),
    ])))).toThrow(ChatContractError);
  });

  it("closes decision request/result correlation fields and stable errors", () => {
    expect(createApprovalDecisionRequestV6(
      DECISION_ID,
      HOST_STREAM_ID,
      "accept_once",
    )).toEqual({
      schemaVersion: 6,
      decisionId: DECISION_ID,
      expectedStreamId: HOST_STREAM_ID,
      expectedRevision: 1,
      decision: "accept_once",
    });
    expect(() => parseApprovalDecisionRequestV6({
      schemaVersion: 6,
      decisionId: DECISION_ID,
      expectedStreamId: HOST_STREAM_ID,
      expectedRevision: 1,
      decision: "accept_once",
      retry: true,
    })).toThrow(ChatContractError);
    expect(parseApprovalDecisionResponseV6(response({
      schemaVersion: 6,
      approvalRequestId: APPROVAL_ID,
      decisionId: DECISION_ID,
      streamId: HOST_STREAM_ID,
      revision: 2,
      decision: "accept_once",
      outcome: "accepted_once",
      resolvedAt: "2026-08-30T12:00:30Z",
    }))).toMatchObject({ outcome: "accepted_once" });
    expect(() => parseApprovalDecisionResponseV6(response({
      schemaVersion: 6,
      approvalRequestId: APPROVAL_ID,
      decisionId: DECISION_ID,
      streamId: HOST_STREAM_ID,
      revision: 2,
      decision: "accept_once",
      outcome: "cancelled_current_turn",
      resolvedAt: "2026-08-30T12:00:30Z",
    }))).toThrow(ChatContractError);
    expect(parseApprovalErrorV6({
      error: { code: "approval_stale", message: "approval request is stale" },
    })).toEqual({ code: "approval_stale", message: "approval request is stale" });
    expect(() => parseApprovalErrorV6({
      error: { code: "approval_stale", message: "arbitrary host detail" },
    })).toThrow(ChatContractError);
  });
});
