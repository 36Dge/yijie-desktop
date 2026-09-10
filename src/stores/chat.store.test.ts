import type {NativeConversationViewEvent} from "../api/generated/native-conversation-private.gen";
import { createPinia,setActivePinia } from "pinia";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { watch } from "vue";
import type { ChatClient,ChatInvalidEventScope } from "../api/chat-client";
import {
conversationMessageItemId
} from "../api/chat-conversation-adapter";
import type { ChatArtifactLiveEvent } from "../domain/chat-artifact-live";
import type {
ChatAllowedAction,
ChatApprovalDecisionResultV6,
ChatApprovalProjectionV6,
ChatAttachment,
ChatAttachmentImportEvent,
ChatControlPlaneEvent,
ChatHistoryPage,
ChatHistoryPageV4,
ChatHistoryPageV5,
ChatHistoryPageV6,
ChatLocalReadiness,
ChatPendingApprovalSnapshotV6,
ChatProjectionEvent,
ChatProjectionEventV4,
ChatProjectionEventV5,
ChatProjectionEventV6,
ChatResyncProjection,
ChatResyncProjectionV4,
ChatResyncProjectionV5,
ChatResyncProjectionV6,
ChatSession,
ChatSessionControlPlane,
} from "../domain/chat-ipc";
import {
CHAT_NEW_DRAFT_TARGET,
ChatClientError,
chatSessionDraftTarget,
} from "../domain/chat-ipc";
import { CHAT_INPUT_MAX_BYTES } from "../domain/chat-ui";
import { selectConversationTimeline } from "../domain/conversation-timeline";
import {
selectConversationItem,
selectConversationTurn,
} from "../domain/conversation-view";
import { createArtifactStoreDefinition } from "./artifact.store";
import {
CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS,
CHAT_DRAFT_ATTACHMENT_LIMIT,
createChatStoreDefinition,
type ChatSubmissionResult,
} from "./chat.store";

const NOW = Date.parse("2026-08-03T12:00:00Z");
const TENANT = "019c1a00-0000-7000-8000-000000000002";
const CONTEXT = "019c1a00-0000-7000-8000-000000000003";
const CONTEXT_B = "019c1a00-0000-7000-8000-000000000004";
const SESSION_A = "019c1a00-0000-7000-8000-000000000005";
const SESSION_B = "019c1a00-0000-7000-8000-000000000006";
const TURN_A = "019c1a00-0000-7000-8000-000000000007";
const SESSION_CREATED = "019c1a00-0000-7000-8000-000000000008";
const ARTIFACT_A = "019c1a00-0000-7000-8000-000000000019";
const LOCAL_SUBSCRIPTION_A = "019c1a00-0000-7000-8000-00000000000a";
const LOCAL_SUBSCRIPTION_B = "019c1a00-0000-7000-8000-00000000000b";
const HOST_GENERATION_A = "019c1a00-0000-7000-8000-00000000000d";
const HOST_GENERATION_B = "019c1a00-0000-7000-8000-00000000000e";
const APPROVAL_A = "13700000-0000-4000-8000-000000000001";
const APPROVAL_B = "13700000-0000-4000-8000-000000000002";
const COMMAND_A = "command-feat-137-current";
const COMMAND_B = "command-feat-137-older";
const REQUESTED_AT = "2026-08-03T11:59:00Z";
const EXPIRES_AT = "2026-08-03T12:01:00Z";
const ALL_ALLOWED_ACTIONS = Object.freeze([
  "read_sessions", "create_session", "submit_turn", "rename_session", "pin_session",
  "interrupt_turn", "delete_session", "read_projects", "use_project", "pin_project",
  "remove_project", "read_cleanup",
] as const satisfies readonly ChatAllowedAction[]);

let storeSequence = 0;

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T) => void;
  private rejectPromise!: (reason: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(value: T): void {
    this.resolvePromise(value);
  }

  reject(reason: unknown): void {
    this.rejectPromise(reason);
  }
}

function session(sessionId: string, title = sessionId === SESSION_A ? "A" : "B"): ChatSession {
  return Object.freeze({
    sessionId,
    projectId: "019c1a00-0000-7000-8000-000000000009",
    title,
    titleSource: "fallback",
    pinnedAt: null,
    lastActivityAt: 1,
    latestTurnStatus: null,
    projectAvailable: true,
  });
}

function attachment(status: ChatAttachment["status"] = "ready"): ChatAttachment {
  return Object.freeze({
    attachmentId: "019c1a00-0000-7000-8000-000000000020",
    type: "file",
    name: "synthetic.pdf",
    mediaType: "application/pdf",
    sizeBytes: 2048,
    status,
    expiresAt: Math.floor(NOW / 1000) + 604_800,
  });
}

function projection(sessionId: string, title?: string): ChatResyncProjection {
  return Object.freeze({
    session: session(sessionId, title),
    history: Object.freeze({ turns: Object.freeze([]), nextCursor: null }),
    cleanup: null,
  });
}

function projectionV4(
  sessionId: string,
  history: ChatHistoryPageV4 = Object.freeze({
    turns: Object.freeze([]),
    nextCursor: null,
    sessionNotices: Object.freeze([]),
    durableSequenceCut: "0",
  }),
): ChatResyncProjectionV4 {
  return Object.freeze({ session: session(sessionId), history, cleanup: null });
}

function emptyPendingApprovalSnapshot(
  streamId = "019c1a00-0000-7000-8000-00000000000d",
): ChatPendingApprovalSnapshotV6 {
  return Object.freeze({
    schemaVersion: 6,
    streamId,
    snapshotAt: "2026-08-03T12:00:00Z",
    pending: Object.freeze([]),
  });
}

function artifactHistory(nextCursor: string | null = null): ChatHistoryPage {
  return Object.freeze({
    turns: Object.freeze([Object.freeze({
      turnId: TURN_A,
      status: "completed" as const,
      terminalAt: 1,
      reasoningStatus: "complete" as const,
      reasoningReasonCode: null,
      messages: Object.freeze([]),
      reasoning: Object.freeze([]),
      artifacts: Object.freeze([Object.freeze({
        artifactId: ARTIFACT_A,
        kind: "file" as const,
        provenance: "synthetic" as const,
        status: "ready" as const,
        ordinal: 0,
        progressStage: null,
        progressPercent: null,
        displayName: "safe.txt",
        mediaType: "text/plain",
        sizeBytes: 4,
        localCommittedAt: 1,
        expiresAt: 605_801,
        hasPoster: false,
        errorCode: null,
        retryable: null,
      })]),
    })]),
    nextCursor,
  });
}

function event(
  sequence: string,
  eventId: string,
  kind: ChatProjectionEvent["kind"],
  payload: ChatProjectionEvent["payload"],
  subscriptionId = "019c1a00-0000-7000-8000-00000000000a",
): ChatProjectionEvent {
  return {
    schemaVersion: 1,
    subscriptionId,
    contextId: CONTEXT,
    sessionId: SESSION_A,
    turnId: TURN_A,
    projectionSequence: sequence,
    eventId,
    kind,
    payload,
  } as ChatProjectionEvent;
}

function eventV4(
  sequence: number,
  kind: ChatProjectionEventV4["kind"],
  payload: ChatProjectionEventV4["payload"],
  turnId: string | null = TURN_A,
): ChatProjectionEventV4 {
  const suffix = String(100 + sequence).padStart(12, "0");
  return {
    schemaVersion: 4,
    subscriptionId: "019c1a00-0000-7000-8000-00000000000a",
    contextId: CONTEXT,
    sessionId: SESSION_A,
    ...(turnId === null ? {} : { turnId }),
    projectionSequence: String(sequence),
    eventId: `13420000-0000-4000-8000-${suffix}`,
    ...(kind === "resync_required" || kind === "context_invalidated"
      ? {}
      : { durableSequence: String(sequence) }),
    kind,
    payload,
  } as ChatProjectionEventV4;
}

function sourceV4(sequence: number) {
  const suffix = String(200 + sequence).padStart(12, "0");
  return {
    sourceEventId: `13420000-0000-4000-8000-${suffix}`,
    sourceSequence: String(sequence),
    sourceOccurredAt: "2026-08-28T06:00:00Z",
  } as const;
}

function commandTurnV6(
  turnId = TURN_A,
  itemId = COMMAND_A,
  completed = false,
): ChatHistoryPageV6["turns"][number] {
  const source = Object.freeze({
    sourceEventId: itemId === COMMAND_A
      ? "13700000-0000-4000-8000-000000000011"
      : "13700000-0000-4000-8000-000000000012",
    sourceSequence: itemId === COMMAND_A ? "40" : "20",
    sourceOccurredAt: REQUESTED_AT,
  });
  return Object.freeze({
    turnId,
    projectionAuthority: "v5",
    status: completed ? "completed" : "streaming",
    terminalAt: completed ? NOW - 30_000 : null,
    reasoningStatus: "unavailable",
    reasoningReasonCode: "reasoning_not_emitted",
    messages: Object.freeze([]),
    reasoning: Object.freeze([]),
    artifacts: Object.freeze([]),
    terminalCode: null,
    timelineItems: Object.freeze([Object.freeze({
      ...source,
      itemId,
      itemOrdinal: 1,
      itemType: "command",
      phase: null,
      status: completed ? "completed" : "in_progress",
      text: "",
      reasoningStatus: null,
      reasoningReasonCode: null,
      reasoningParts: Object.freeze([]),
      startedAtMs: NOW - 60_000,
      completedAtMs: completed ? NOW - 30_000 : null,
      execution: Object.freeze({
        kind: "command",
        status: completed ? "completed" : "running",
        startedSource: source,
        lastSource: source,
        commandSummary: Object.freeze({
          text: "Inspect repository status",
          truncated: false,
          truncationReason: null,
        }),
        cwd: Object.freeze({ kind: "workspace_root", segments: Object.freeze([]) }),
        liveOutput: null,
        output: completed
          ? Object.freeze({
              retention: "complete" as const,
              text: "",
              head: null,
              tail: null,
              reason: null,
              truncated: false,
              truncationReason: null,
            })
          : null,
        durationMs: completed ? 30_000 : null,
        exitCode: completed ? 0 : null,
        error: null,
      }),
    })]),
    plan: null,
    notices: Object.freeze([]),
  });
}

function approvalProjectionV6(
  approvalRequestId = APPROVAL_A,
  turnId = TURN_A,
  itemId = COMMAND_A,
  overrides: Partial<ChatApprovalProjectionV6> = {},
): ChatApprovalProjectionV6 {
  return Object.freeze({
    sourceEventId: approvalRequestId === APPROVAL_A
      ? "13700000-0000-4000-8000-000000000021"
      : "13700000-0000-4000-8000-000000000022",
    sourceSequence: approvalRequestId === APPROVAL_A ? "41" : "21",
    sourceOccurredAt: REQUESTED_AT,
    turnId,
    itemId,
    approvalRequestId,
    status: "pending",
    revision: 1,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    decisions: Object.freeze({ primary: "accept_once", secondary: "cancel_current_turn" }),
    requestedAt: REQUESTED_AT,
    expiresAt: EXPIRES_AT,
    ttlSeconds: 120,
    ...overrides,
  } as ChatApprovalProjectionV6);
}

function resolvedApprovalProjectionV6(
  approvalRequestId = APPROVAL_B,
  turnId = "13700000-0000-4000-8000-000000000030",
  itemId = COMMAND_B,
): ChatApprovalProjectionV6 {
  return Object.freeze({
    sourceEventId: "13700000-0000-4000-8000-000000000023",
    sourceSequence: "22",
    sourceOccurredAt: "2026-08-03T11:59:30Z",
    turnId,
    itemId,
    approvalRequestId,
    status: "resolved",
    revision: 2,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    outcome: "resolved_elsewhere",
    requestedAt: REQUESTED_AT,
    expiresAt: EXPIRES_AT,
    resolvedAt: "2026-08-03T11:59:30Z",
  });
}

function expiredApprovalProjectionV6(): ChatApprovalProjectionV6 {
  return Object.freeze({
    sourceEventId: "13700000-0000-4000-8000-000000000024",
    sourceSequence: "42",
    sourceOccurredAt: EXPIRES_AT,
    turnId: TURN_A,
    itemId: COMMAND_A,
    approvalRequestId: APPROVAL_A,
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

function approvalDecisionResultV6(
  decision: "accept_once" | "cancel_current_turn" = "accept_once",
  overrides: Partial<ChatApprovalDecisionResultV6> = {},
): ChatApprovalDecisionResultV6 {
  const common = {
    schemaVersion: 6 as const,
    approvalRequestId: APPROVAL_A,
    decisionId: "13700000-0000-4000-8000-000000000090",
    streamId: HOST_GENERATION_A,
    revision: 2 as const,
    resolvedAt: "2026-08-03T12:00:30Z",
  };
  return Object.freeze(decision === "accept_once"
    ? { ...common, decision, outcome: "accepted_once" as const, ...overrides }
    : { ...common, decision, outcome: "cancelled_current_turn" as const, ...overrides }) as
      ChatApprovalDecisionResultV6;
}

function acceptedApprovalProjectionV6(): ChatApprovalProjectionV6 {
  const result = approvalDecisionResultV6();
  return Object.freeze({
    sourceEventId: "13700000-0000-4000-8000-000000000025",
    sourceSequence: "42",
    sourceOccurredAt: result.resolvedAt,
    turnId: TURN_A,
    itemId: COMMAND_A,
    approvalRequestId: APPROVAL_A,
    status: "resolved",
    revision: 2,
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    requestedAt: REQUESTED_AT,
    expiresAt: EXPIRES_AT,
    outcome: "accepted_once",
    decisionId: result.decisionId,
    decision: "accept_once",
    resolvedAt: result.resolvedAt,
  });
}

function pendingApprovalSnapshotV6(
  streamId = HOST_GENERATION_A,
  approval: ChatApprovalProjectionV6 | null = approvalProjectionV6(),
): ChatPendingApprovalSnapshotV6 {
  return Object.freeze({
    schemaVersion: 6,
    streamId,
    snapshotAt: "2026-08-03T12:00:00Z",
    pending: approval?.status === "pending"
      ? Object.freeze([Object.freeze({
          approvalRequestId: approval.approvalRequestId,
          revision: 1 as const,
          turnId: approval.turnId,
          itemId: approval.itemId,
          actionId: approval.actionId,
          workspaceScope: approval.workspaceScope,
          decisions: approval.decisions,
          requestedAt: approval.requestedAt,
          expiresAt: approval.expiresAt,
          ttlSeconds: 120 as const,
        })])
      : Object.freeze([]),
  });
}

function historyV6(
  turns: ChatHistoryPageV6["turns"] = Object.freeze([commandTurnV6()]),
  approvals: ChatHistoryPageV6["approvals"] = Object.freeze([approvalProjectionV6()]),
  nextCursor: string | null = null,
  durableSequenceCut = "41",
): ChatHistoryPageV6 {
  return Object.freeze({
    schemaVersion: 6,
    turns,
    nextCursor,
    sessionNotices: Object.freeze([]),
    durableSequenceCut,
    approvals,
  });
}

function projectionV6(
  sessionId: string,
  history: ChatHistoryPageV6 = historyV6(),
  pendingApprovalSnapshot: ChatPendingApprovalSnapshotV6 = pendingApprovalSnapshotV6(),
): ChatResyncProjectionV6 {
  return Object.freeze({
    session: session(sessionId),
    history,
    cleanup: null,
    pendingApprovalSnapshot,
  });
}

function approvalEventV6(
  projection: ChatApprovalProjectionV6 = approvalProjectionV6(),
  subscriptionId = LOCAL_SUBSCRIPTION_A,
  projectionSequence = "1",
): ChatProjectionEventV6 {
  return Object.freeze({
    schemaVersion: 6,
    subscriptionId,
    contextId: CONTEXT,
    sessionId: SESSION_A,
    turnId: projection.turnId,
    projectionSequence,
    eventId: projection.sourceEventId,
    durableSequence: projection.sourceSequence,
    kind: "approval_changed",
    payload: projection,
  });
}

function attachmentImportEvent(
  stage: ChatAttachmentImportEvent["stage"],
  sequence: string,
  overrides: Partial<ChatAttachmentImportEvent> = {},
): ChatAttachmentImportEvent {
  return Object.freeze({
    schemaVersion: 2,
    contextId: CONTEXT,
    operationId: "019c1a00-0000-7000-8000-00000000000c",
    sequence,
    stage,
    itemCount: 2,
    issue: stage === "error_terminal" ? "parse_failed" : null,
    ...overrides,
  });
}

function fakeClient(overrides: Partial<ChatClient> = {}): {
  client: ChatClient;
  emitNative: (event: NativeConversationViewEvent) => void;
  emit: (event: ChatProjectionEvent) => void;
  emitV4: (event: ChatProjectionEventV4) => void;
  emitV5: (event: ChatProjectionEventV5) => void;
  emitV6: (event: ChatProjectionEventV6) => void;
  emitControlPlane: (event: ChatControlPlaneEvent) => void;
  emitAttachmentImport: (event: ChatAttachmentImportEvent) => void;
  invalidate: (scope?: ChatInvalidEventScope | null) => void;
} {
  let nativeHandler: (event: NativeConversationViewEvent) => void = () => undefined;
  let eventHandler: (event: ChatProjectionEvent) => void = () => undefined;
  let eventHandlerV4: (event: ChatProjectionEventV4) => void = () => undefined;
  let eventHandlerV5: (event: ChatProjectionEventV5) => void = () => undefined;
  let eventHandlerV6: (event: ChatProjectionEventV6) => void = () => undefined;
  let invalidHandler: (scope?: ChatInvalidEventScope | null) => void = () => undefined;
  let controlPlaneHandler: (event: ChatControlPlaneEvent) => void = () => undefined;
  let attachmentImportHandler: (event: ChatAttachmentImportEvent) => void = () => undefined;
  const client: ChatClient = {
    loadNativeHistory: async () => ({views: [], submissions: [], remainingTurnIds: [], historyAvailability: "unavailable"}),
    onNativeView: async handler => {nativeHandler = handler; return () => undefined;},
    bindContext: async () => ({
      contextId: CONTEXT,
      expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
      allowedActions: ALL_ALLOWED_ACTIONS,
    }),
    listProjects: async () => [],
    pickProject: async () => null,
    revalidateProject: async (_context, projectId) => ({
      projectId,
      safeName: "Synthetic Workspace",
      pinnedAt: null,
      lastUsedAt: 1,
      available: true,
    }),
    setProjectPinned: async (_context, _project, _pinned, operation) => operation,
    removeProject: async (_context, _project, operation) => operation,
    createSession: async (_context, _project, _input, operation) => ({ sessionId: SESSION_A, turnId: TURN_A, operationId: operation }),
    submitTurn: async (_context, sessionId, _input, operation) => ({ sessionId, turnId: TURN_A, operationId: operation }),
    pickAttachments: async () => [],
    importAttachments: async () => [],
    listDraftAttachments: async () => [],
    removeAttachment: async (_context, _target, _attachment, operation) => operation,
    createSessionV2: async (_context, _project, _blocks, operation) => ({ sessionId: SESSION_A, turnId: TURN_A, operationId: operation }),
    submitTurnV2: async (_context, sessionId, _blocks, operation) => ({ sessionId, turnId: TURN_A, operationId: operation }),
    listSessions: async () => ({ sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null }),
    loadHistory: async () => ({ turns: [], nextCursor: null }),
    loadHistoryV2: (...arguments_) => client.loadHistory(...arguments_),
    loadHistoryV3: (...arguments_) => client.loadHistory(...arguments_),
    loadHistoryV4: async () => Object.freeze({
      turns: Object.freeze([]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "0",
    }),
    loadHistoryV5: async () => Object.freeze({
      schemaVersion: 5 as const,
      turns: Object.freeze([]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "0",
    }),
    loadHistoryV6: async () => Object.freeze({
      schemaVersion: 6 as const,
      turns: Object.freeze([]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "0",
      approvals: Object.freeze([]),
    }),
    loadReasoning: async () => [],
    renameSession: async (_context, _session, _title, operation) => operation,
    setSessionPinned: async (_context, _session, _pinned, operation) => operation,
    interruptTurn: async (_context, sessionId, operation) => ({ sessionId, turnId: TURN_A, operationId: operation }),
    deleteSession: async (_context, _session, operation) => ({
      operationId: operation,
      desktopState: "pending",
      hostState: "pending",
      runtimeState: "pending",
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    }),
    getCleanupStatus: async () => null,
    getSessionControlPlane: async (_context, sessionId) => ({
      sessionId,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    }),
    getLocalReadiness: async () => ({
      lifecycle: "ready",
      host: "ready",
      runtime: "ready",
      storage: "ready",
      canSend: true,
      issueCode: null,
      retryable: false,
      recovery: "none",
    }),
    requestLocalRecovery: async () => ({
      lifecycle: "ready",
      host: "ready",
      runtime: "ready",
      storage: "ready",
      canSend: true,
      issueCode: null,
      retryable: false,
      recovery: "none",
    }),
    subscribeSession: async (_context, sessionId) => sessionId === SESSION_A
      ? "019c1a00-0000-7000-8000-00000000000a"
      : "019c1a00-0000-7000-8000-00000000000b",
    subscribeSessionV4: async (_context, sessionId) => sessionId === SESSION_A
      ? "019c1a00-0000-7000-8000-00000000000a"
      : "019c1a00-0000-7000-8000-00000000000b",
    subscribeSessionV5: async (_context, sessionId) => sessionId === SESSION_A
      ? "019c1a00-0000-7000-8000-00000000000a"
      : "019c1a00-0000-7000-8000-00000000000b",
    subscribeSessionV6: async (_context, sessionId) => {
      const nextSubscriptionId = sessionId === SESSION_A
        ? "019c1a00-0000-7000-8000-00000000000a"
        : "019c1a00-0000-7000-8000-00000000000b";
      return Object.freeze({
        subscriptionId: nextSubscriptionId,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(sessionId === SESSION_A
          ? "019c1a00-0000-7000-8000-00000000000d"
          : "019c1a00-0000-7000-8000-00000000000e"),
      });
    },
    decideApprovalV6: async (
      _context,
      _session,
      _turn,
      _item,
      approvalRequestId,
      decision,
    ) => decision === "accept_once"
      ? Object.freeze({
          schemaVersion: 6 as const,
          approvalRequestId,
          decisionId: "13700000-0000-4000-8000-000000000090",
          streamId: HOST_GENERATION_A,
          revision: 2 as const,
          decision,
          outcome: "accepted_once" as const,
          resolvedAt: "2026-08-03T12:00:30Z",
        })
      : Object.freeze({
          schemaVersion: 6 as const,
          approvalRequestId,
          decisionId: "13700000-0000-4000-8000-000000000090",
          streamId: HOST_GENERATION_A,
          revision: 2 as const,
          decision,
          outcome: "cancelled_current_turn" as const,
          resolvedAt: "2026-08-03T12:00:30Z",
        }),
    resyncSession: async (_context, sessionId) => projection(sessionId),
    resyncSessionV2: (...arguments_) => client.resyncSession(...arguments_),
    resyncSessionV4: async (_context, sessionId) => projectionV4(sessionId),
    resyncSessionV5: async (_context, sessionId) => Object.freeze({
      ...projectionV4(sessionId),
      history: Object.freeze({
        schemaVersion: 5 as const,
        turns: Object.freeze([]),
        nextCursor: null,
        sessionNotices: Object.freeze([]),
        durableSequenceCut: "0",
      }),
    }),
    resyncSessionV6: async (_context, sessionId) => {
      const streamId = sessionId === SESSION_A
        ? "019c1a00-0000-7000-8000-00000000000d"
        : "019c1a00-0000-7000-8000-00000000000e";
      return Object.freeze({
        ...projectionV4(sessionId),
        history: Object.freeze({
          schemaVersion: 6 as const,
          turns: Object.freeze([]),
          nextCursor: null,
          sessionNotices: Object.freeze([]),
          durableSequenceCut: "0",
          approvals: Object.freeze([]),
        }),
        pendingApprovalSnapshot: emptyPendingApprovalSnapshot(streamId),
      });
    },
    unsubscribeSession: async () => true,
    cancelRequest: async () => true,
    onEvent: async (handler, onInvalid) => {
      eventHandler = handler;
      invalidHandler = onInvalid ?? (() => undefined);
      return () => undefined;
    },
    onEventV4: async (handler, onInvalid) => {
      eventHandlerV4 = handler;
      invalidHandler = onInvalid ?? (() => undefined);
      return () => undefined;
    },
    onEventV5: async (handler, onInvalid) => {
      eventHandlerV5 = handler;
      invalidHandler = onInvalid ?? (() => undefined);
      return () => undefined;
    },
    onEventV6: async (handler, onInvalid) => {
      eventHandlerV6 = handler;
      invalidHandler = onInvalid ?? (() => undefined);
      return () => undefined;
    },
    onControlPlaneEvent: async (handler) => {
      controlPlaneHandler = handler;
      return () => undefined;
    },
    onAttachmentImportEvent: async (handler) => {
      attachmentImportHandler = handler;
      return () => undefined;
    },
    ...overrides,
  };
  return {
    client,
    emitNative: value => nativeHandler(value),
    emit: (value) => eventHandler(value),
    emitV4: (value) => eventHandlerV4(value),
    emitV5: (value) => eventHandlerV5(value),
    emitV6: (value) => eventHandlerV6(value),
    emitControlPlane: (value) => controlPlaneHandler(value),
    emitAttachmentImport: (value) => attachmentImportHandler(value),
    invalidate: (scope) => invalidHandler(scope),
  };
}

function createStore(client: ChatClient) {
  return createChatStoreDefinition(client, `chat-test-${storeSequence++}`)();
}

function createV6Store(client: ChatClient) {
  return createChatStoreDefinition(
    client,
    `chat-feat137-v6-${storeSequence++}`,
    undefined,
    true,
    true,
    true,
  )();
}

async function finishAttachmentImportPresentation(): Promise<void> {
  await vi.advanceTimersByTimeAsync(CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS * 5);
}

describe("chat view-model store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("crypto", { randomUUID: () => "019c1a00-0000-7000-8000-00000000000c" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("binds one opaque context and never stores owner, token, key, or project path", async () => {
    const { client } = fakeClient();
    const store = createStore(client);
    await store.bind(TENANT);

    expect(store.phase).toBe("ready");
    expect(store.context?.contextId).toBe(CONTEXT);
    expect(store.sessions).toHaveLength(2);
    const serialized = JSON.stringify(store.$state).toLowerCase();
    for (const forbidden of ["owneruserid", "bearer", "sqlcipher", "/private/", "runtimeid", "hostid"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("keeps task.read-only history usable without invoking create-only draft commands", async () => {
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(async () => {
      throw new Error("read-only history must not prepare a writable draft");
    });
    const listProjects = vi.fn<ChatClient["listProjects"]>(async () => [{
      projectId: "019c1a00-0000-7000-8000-000000000009",
      safeName: "Read-only Workspace",
      pinnedAt: null,
      lastUsedAt: 1,
      available: true,
    }]);
    const listSessions = vi.fn<ChatClient["listSessions"]>(async () => ({
      sessions: [session(SESSION_A), session(SESSION_B)],
      nextCursor: null,
    }));
    const resyncSessionV2 = vi.fn<ChatClient["resyncSessionV2"]>(async (_context, sessionId) =>
      projection(sessionId)
    );
    const { client } = fakeClient({
      bindContext: async () => ({
        contextId: CONTEXT,
        expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
        allowedActions: ["read_sessions", "read_projects", "read_cleanup"],
      }),
      listProjects,
      listSessions,
      listDraftAttachments,
      resyncSessionV2,
    });
    const store = createStore(client);

    await store.bind(TENANT);

    expect(store.phase).toBe("ready");
    expect(store.projects).toHaveLength(1);
    expect(store.sessions).toHaveLength(2);
    expect(store.draftTarget).toBeNull();
    expect(store.draftTargetReady).toBe(false);
    expect(store.canSend).toBe(false);

    await store.selectSession(SESSION_A);

    expect(store.phase).toBe("ready");
    expect(store.selectedSessionId).toBe(SESSION_A);
    expect(store.history?.turns).toEqual([]);
    expect(store.draftTarget).toBeNull();
    expect(listDraftAttachments).not.toHaveBeenCalled();
    expect(listProjects).toHaveBeenCalledWith(CONTEXT);
    expect(listSessions).toHaveBeenCalledWith(CONTEXT);
    expect(resyncSessionV2).toHaveBeenCalledWith(CONTEXT, SESSION_A, 20, expect.any(AbortSignal));

    await store.clearSelectedSession();

    expect(store.phase).toBe("ready");
    expect(store.selectedSessionId).toBeNull();
    expect(store.draftTarget).toBeNull();
    await expect(store.retryDraftRecovery()).resolves.toBe(false);
    expect(store.phase).toBe("ready");
    expect(listDraftAttachments).not.toHaveBeenCalled();
  });

  it("keeps the new-task enabled rule closed without use_project authority", async () => {
    const revalidateProject = vi.fn<ChatClient["revalidateProject"]>();
    const createSession = vi.fn<ChatClient["createSession"]>();
    const store = createStore(fakeClient({
      bindContext: async () => ({
        contextId: CONTEXT,
        expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
        allowedActions: [
          "read_sessions",
          "read_projects",
          "create_session",
        ],
      }),
      revalidateProject,
      createSession,
    }).client);
    await store.bind(TENANT);

    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftTargetReady).toBe(true);
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);
    await expect(store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "must stay local",
    )).resolves.toEqual({ status: "not_accepted" });
    expect(revalidateProject).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("subscribes both channels before v3 history, coalesces initial invalidation, and isolates the v3 cursor", async () => {
    const order: string[] = [];
    let artifactHandler: (event: ChatArtifactLiveEvent) => void = () => undefined;
    const ordinaryUnlisten = vi.fn();
    const artifactUnlisten = vi.fn();
    const historyCursor = "abcdefghijklmnop";
    let historyCalls = 0;
    const loadHistoryV2 = vi.fn<ChatClient["loadHistoryV2"]>(async () => {
      throw new Error("v2 history must stay isolated");
    });
    const loadHistoryV3 = vi.fn<ChatClient["loadHistoryV3"]>(async () => {
      historyCalls += 1;
      order.push("history-v3");
      if (historyCalls === 1) {
        artifactHandler({
          schemaVersion: 1,
          subscriptionId: "019c1a00-0000-7000-8000-00000000000a",
          contextId: CONTEXT,
          sessionId: SESSION_A,
          turnId: TURN_A,
          eventId: "019c1a00-0000-7000-8000-000000000031",
          notificationSequence: "1",
          kind: "artifact_changed",
          payload: {},
        });
      }
      return artifactHistory(historyCursor);
    });
    const { client } = fakeClient({
      onEvent: async () => {
        order.push("ordinary-listen");
        return ordinaryUnlisten;
      },
      subscribeSession: async () => {
        order.push("session-subscribe");
        return "019c1a00-0000-7000-8000-00000000000a";
      },
      resyncSessionV2: async (_context, sessionId) => {
        order.push("control-resync");
        return projection(sessionId);
      },
      loadHistoryV2,
      loadHistoryV3,
    });
    const artifacts = createArtifactStoreDefinition(`artifact-s10c-${storeSequence++}`)();
    const store = createChatStoreDefinition(client, `chat-s10c-${storeSequence++}`, () => ({
      liveClient: {
        listen: async (handler) => {
          order.push("artifact-listen");
          artifactHandler = handler;
          return artifactUnlisten;
        },
      },
      store: artifacts,
      authority: () => ({ authorizationRevision: 9, tenantId: TENANT }),
    }))();

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(order.indexOf("ordinary-listen")).toBeLessThan(order.indexOf("session-subscribe"));
    expect(order.indexOf("artifact-listen")).toBeLessThan(order.indexOf("session-subscribe"));
    expect(order.indexOf("control-resync")).toBeLessThan(order.indexOf("history-v3"));
    expect(loadHistoryV3).toHaveBeenCalledTimes(2);
    expect(loadHistoryV2).not.toHaveBeenCalled();
    expect(artifacts.artifactsForTurn(SESSION_A, TURN_A)).toHaveLength(1);
    expect(store.history?.turns[0]?.turnId).toBe(TURN_A);

    await store.loadOlderHistory();
    expect(loadHistoryV3).toHaveBeenLastCalledWith(
      CONTEXT,
      SESSION_A,
      historyCursor,
      20,
      expect.any(AbortSignal),
    );
    expect(loadHistoryV2).not.toHaveBeenCalled();

    await store.deactivatePageSession();
    expect(ordinaryUnlisten).toHaveBeenCalledOnce();
    expect(artifactUnlisten).toHaveBeenCalledOnce();
    expect(artifacts.authority).toBeNull();
  });

  it("trails exactly one Artifact metadata refresh without resyncing the chat session", async () => {
    let artifactHandler: (event: ChatArtifactLiveEvent) => void = () => undefined;
    const controlPlaneStarted = new Deferred<void>();
    const delayedControlPlane = new Deferred<Awaited<ReturnType<ChatClient["getSessionControlPlane"]>>>();
    const historyWithoutArtifacts = Object.freeze({
      ...artifactHistory(),
      turns: Object.freeze(artifactHistory().turns.map((turn) => Object.freeze({
        ...turn,
        artifacts: Object.freeze([]),
      }))),
    });
    let historyCalls = 0;
    const loadHistoryV3 = vi.fn<ChatClient["loadHistoryV3"]>(async () => {
      historyCalls += 1;
      return historyCalls <= 2 ? historyWithoutArtifacts : artifactHistory();
    });
    const resyncSessionV2 = vi.fn<ChatClient["resyncSessionV2"]>(
      async (_context, sessionId) => projection(sessionId),
    );
    const { client } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneStarted.resolve();
        return delayedControlPlane.promise.then((status) => ({ ...status, sessionId }));
      },
      loadHistoryV3,
      resyncSessionV2,
    });
    const artifacts = createArtifactStoreDefinition(`artifact-s10c-${storeSequence++}`)();
    const store = createChatStoreDefinition(client, `chat-s10c-${storeSequence++}`, () => ({
      liveClient: {
        listen: async (handler) => {
          artifactHandler = handler;
          return () => undefined;
        },
      },
      store: artifacts,
      authority: () => ({ authorizationRevision: 9, tenantId: TENANT }),
    }))();

    await store.bind(TENANT);
    const selection = store.selectSession(SESSION_A);
    await controlPlaneStarted.promise;
    expect(loadHistoryV3).toHaveBeenCalledTimes(2);

    const changed: ChatArtifactLiveEvent = {
      schemaVersion: 1,
      subscriptionId: "019c1a00-0000-7000-8000-00000000000a",
      contextId: CONTEXT,
      sessionId: SESSION_A,
      turnId: TURN_A,
      eventId: "019c1a00-0000-7000-8000-000000000046",
      notificationSequence: "1",
      kind: "artifact_changed",
      payload: {},
    };
    artifactHandler(changed);
    artifactHandler(changed);
    delayedControlPlane.resolve({
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await selection;
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(resyncSessionV2).toHaveBeenCalledTimes(1);
    expect(loadHistoryV3).toHaveBeenCalledTimes(3);
    expect(artifacts.artifactsForTurn(SESSION_A, TURN_A)).toMatchObject([
      { artifactId: ARTIFACT_A, status: "ready" },
    ]);
  });

  it("bounds Artifact refresh to one in-flight plus one trailing and resets sequence per subscription", async () => {
    let artifactHandler: (event: ChatArtifactLiveEvent) => void = () => undefined;
    const delayedRefresh = new Deferred<ReturnType<typeof artifactHistory>>();
    const subscriptionOrder: string[] = [];
    const subscriptionIds = [
      "019c1a00-0000-7000-8000-00000000000a",
      "019c1a00-0000-7000-8000-00000000000b",
      "019c1a00-0000-7000-8000-00000000000c",
    ];
    let subscribeCalls = 0;
    let historyCalls = 0;
    const loadHistoryV3 = vi.fn<ChatClient["loadHistoryV3"]>(async () => {
      historyCalls += 1;
      if (historyCalls === 3) return delayedRefresh.promise;
      return artifactHistory();
    });
    const resyncSessionV2 = vi.fn<ChatClient["resyncSessionV2"]>(
      async (_context, sessionId) => projection(sessionId),
    );
    const { client } = fakeClient({
      subscribeSession: async () => {
        const subscriptionId = subscriptionIds[subscribeCalls++] ?? subscriptionIds[2];
        subscriptionOrder.push(`subscribe:${subscriptionId}`);
        return subscriptionId;
      },
      unsubscribeSession: async (_contextId, subscriptionId) => {
        subscriptionOrder.push(`unsubscribe:${subscriptionId}`);
        return true;
      },
      resyncSessionV2,
      loadHistoryV3,
    });
    const artifacts = createArtifactStoreDefinition(`artifact-s10c-${storeSequence++}`)();
    const store = createChatStoreDefinition(client, `chat-s10c-${storeSequence++}`, () => ({
      liveClient: {
        listen: async (handler) => {
          artifactHandler = handler;
          return () => undefined;
        },
      },
      store: artifacts,
      authority: () => ({ authorizationRevision: 9, tenantId: TENANT }),
    }))();
    const changed = (
      subscriptionId: string,
      sequence: string,
      eventId: string,
    ): ChatArtifactLiveEvent => ({
      schemaVersion: 1,
      subscriptionId,
      contextId: CONTEXT,
      sessionId: SESSION_A,
      turnId: TURN_A,
      eventId,
      notificationSequence: sequence,
      kind: "artifact_changed",
      payload: {},
    });

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(resyncSessionV2).toHaveBeenCalledTimes(1);

    const first = changed(subscriptionIds[0], "1", "019c1a00-0000-7000-8000-000000000041");
    artifactHandler(first);
    artifactHandler(first);
    for (let index = 0; index < 12 && historyCalls < 3; index += 1) await Promise.resolve();
    expect(historyCalls).toBe(3);

    artifactHandler(changed(subscriptionIds[0], "2", "019c1a00-0000-7000-8000-000000000042"));
    delayedRefresh.resolve(artifactHistory());
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(resyncSessionV2).toHaveBeenCalledTimes(1);
    expect(loadHistoryV3).toHaveBeenCalledTimes(4);

    artifactHandler({
      ...changed(subscriptionIds[0], "4", "019c1a00-0000-7000-8000-000000000043"),
      kind: "resync_required",
      payload: { reason: "sequence_gap" },
    });
    for (let index = 0; index < 30; index += 1) await Promise.resolve();

    expect(resyncSessionV2).toHaveBeenCalledTimes(2);
    expect(loadHistoryV3).toHaveBeenCalledTimes(5);
    expect(subscriptionOrder.indexOf(`subscribe:${subscriptionIds[1]}`)).toBeLessThan(
      subscriptionOrder.indexOf(`unsubscribe:${subscriptionIds[0]}`),
    );

    artifactHandler(changed(subscriptionIds[0], "5", "019c1a00-0000-7000-8000-000000000045"));
    for (let index = 0; index < 32; index += 1) await Promise.resolve();
    expect(resyncSessionV2).toHaveBeenCalledTimes(2);

    artifactHandler({
      schemaVersion: 1,
      subscriptionId: subscriptionIds[1],
      contextId: CONTEXT,
      sessionId: SESSION_A,
      turnId: TURN_A,
      eventId: "019c1a00-0000-7000-8000-000000000044",
      notificationSequence: "1",
      kind: "context_invalidated",
      payload: { reason: "authority_changed" },
    });
    expect(store.context).toBeNull();
    expect(store.selectedSessionId).toBeNull();
    expect(artifacts.authority).toBeNull();
  });

  it("cleans an established ordinary listener when the Artifact listener fails", async () => {
    const ordinaryUnlisten = vi.fn();
    const store = createChatStoreDefinition(
      fakeClient({ onEvent: async () => ordinaryUnlisten }).client,
      `chat-s10c-${storeSequence++}`,
      () => ({
        liveClient: { listen: async () => { throw new Error("closed listener failure"); } },
        store: createArtifactStoreDefinition(`artifact-s10c-${storeSequence++}`)(),
        authority: () => ({ authorizationRevision: 9, tenantId: TENANT }),
      }),
    )();

    await store.bind(TENANT);

    expect(store.phase).toBe("unavailable");
    expect(ordinaryUnlisten).toHaveBeenCalledOnce();
  });

  it("does not change phase when the new-task draft is already selected", async () => {
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(async () => []);
    const store = createStore(fakeClient({ listDraftAttachments }).client);
    await store.bind(TENANT);
    const observedPhases: string[] = [];
    const stopWatching = watch(
      () => store.phase,
      (nextPhase) => observedPhases.push(nextPhase),
      { flush: "sync" },
    );

    await store.clearSelectedSession();
    await store.clearSelectedSession();
    stopWatching();

    expect(observedPhases).toEqual([]);
    expect(store.phase).toBe("ready");
    expect(store.selectedSessionId).toBeNull();
    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftTargetReady).toBe(true);
    expect(listDraftAttachments).toHaveBeenCalledOnce();
  });

  it("retains only the closed bind failure stage and error code", async () => {
    const unavailable = () => new ChatClientError({
      schemaVersion: 1,
      code: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
      retryAfterMs: 1000,
    });
    const cases: ReadonlyArray<readonly [string, Partial<ChatClient>]> = [
      ["event_listener", { onEvent: async () => { throw unavailable(); } }],
      ["context", { bindContext: async () => { throw unavailable(); } }],
      ["projects", { listProjects: async () => { throw unavailable(); } }],
      ["sessions", { listSessions: async () => { throw unavailable(); } }],
      ["readiness", { getLocalReadiness: async () => { throw unavailable(); } }],
    ];
    for (const [stage, overrides] of cases) {
      const store = createStore(fakeClient(overrides).client);
      await store.bind(TENANT);
      expect(store.lastBindFailureStage).toBe(stage);
      expect(store.lastErrorCode).toBe("chat_temporarily_unavailable");
      expect(store.context).toBeNull();
      expect(store.isAuthorityBound()).toBe(false);
      await store.dispose();
    }
  });

  it("fails closed when the initial draft cannot be restored and re-enables actions only after retry", async () => {
    let newDraftAttempts = 0;
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(async (_context, target) => {
      if (target.type !== "new") return [];
      newDraftAttempts += 1;
      if (newDraftAttempts === 1) {
        throw new ChatClientError({
          schemaVersion: 2,
          code: "chat_temporarily_unavailable",
          retryable: true,
          recovery: "retry",
        });
      }
      return [attachment()];
    });
    const createSession = vi.fn<ChatClient["createSession"]>(
      async (_context, _project, _input, operation) => ({
        sessionId: SESSION_A,
        turnId: TURN_A,
        operationId: operation,
      }),
    );
    const createSessionV2 = vi.fn<ChatClient["createSessionV2"]>(
      async (_context, _project, _blocks, operation) => ({
        sessionId: SESSION_A,
        turnId: TURN_A,
        operationId: operation,
      }),
    );
    const importAttachments = vi.fn<ChatClient["importAttachments"]>(async () => []);
    const store = createStore(fakeClient({
      listDraftAttachments,
      createSession,
      createSessionV2,
      importAttachments,
    }).client);

    await store.bind(TENANT);

    expect(store.context?.contextId).toBe(CONTEXT);
    expect(store.isAuthorityBound()).toBe(true);
    expect(store.phase).toBe("unavailable");
    expect(store.lastBindFailureStage).toBe("draft_attachments");
    expect(store.lastErrorCode).toBe("chat_temporarily_unavailable");
    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftTargetReady).toBe(false);
    expect(store.draftAttachments).toEqual([]);
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);

    await expect(store.createSession("019c1a00-0000-7000-8000-000000000009", "blocked"))
      .resolves.toBeNull();
    await expect(store.importAttachmentPaths(["/private/blocked.pdf"])).resolves.toEqual([]);
    expect(createSession).not.toHaveBeenCalled();
    expect(createSessionV2).not.toHaveBeenCalled();
    expect(importAttachments).not.toHaveBeenCalled();

    await expect(store.retryDraftRecovery()).resolves.toBe(true);

    expect(listDraftAttachments).toHaveBeenCalledTimes(2);
    expect(listDraftAttachments).toHaveBeenLastCalledWith(CONTEXT, CHAT_NEW_DRAFT_TARGET);
    expect(store.phase).toBe("ready");
    expect(store.lastBindFailureStage).toBeNull();
    expect(store.lastErrorCode).toBeNull();
    expect(store.draftTargetReady).toBe(true);
    expect(store.draftAttachments).toEqual([attachment()]);
    expect(store.canSend).toBe(true);
    expect(store.canAttach).toBe(true);

    await store.importAttachmentPaths(["/private/recovered.pdf"]);
    expect(importAttachments).toHaveBeenCalledOnce();
  });

  it("keeps a failed session draft target closed and reloads the full session on retry", async () => {
    const sessionAttachment = Object.freeze({
      ...attachment(),
      attachmentId: "019c1a00-0000-7000-8000-000000000021",
      name: "session-recovered.pdf",
    }) satisfies ChatAttachment;
    let sessionDraftAttempts = 0;
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(async (_context, target) => {
      if (target.type === "new") return [];
      sessionDraftAttempts += 1;
      if (sessionDraftAttempts === 1) {
        throw new ChatClientError({
          schemaVersion: 2,
          code: "chat_temporarily_unavailable",
          retryable: true,
          recovery: "retry",
        });
      }
      return [sessionAttachment];
    });
    const subscribeSession = vi.fn<ChatClient["subscribeSession"]>(
      async () => "019c1a00-0000-7000-8000-00000000000a",
    );
    const resyncSession = vi.fn<ChatClient["resyncSession"]>(
      async (_context, sessionId) => projection(sessionId, "Recovered A"),
    );
    const submitTurn = vi.fn<ChatClient["submitTurn"]>(
      async (_context, sessionId, _input, operation) => ({ sessionId, turnId: TURN_A, operationId: operation }),
    );
    const submitTurnV2 = vi.fn<ChatClient["submitTurnV2"]>(
      async (_context, sessionId, _blocks, operation) => ({ sessionId, turnId: TURN_A, operationId: operation }),
    );
    const importAttachments = vi.fn<ChatClient["importAttachments"]>(async () => []);
    const store = createStore(fakeClient({
      listDraftAttachments,
      subscribeSession,
      resyncSession,
      submitTurn,
      submitTurnV2,
      importAttachments,
    }).client);
    await store.bind(TENANT);

    await store.selectSession(SESSION_A);

    expect(store.selectedSessionId).toBe(SESSION_A);
    expect(store.draftTarget).toEqual(chatSessionDraftTarget(SESSION_A));
    expect(store.draftTargetReady).toBe(false);
    expect(store.draftAttachments).toEqual([]);
    expect(store.history).toBeNull();
    expect(store.phase).toBe("unavailable");
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);
    expect(subscribeSession).not.toHaveBeenCalled();
    expect(resyncSession).not.toHaveBeenCalled();

    await store.submitTurn("blocked");
    await store.importAttachmentPaths(["/private/blocked.pdf"]);
    expect(submitTurn).not.toHaveBeenCalled();
    expect(submitTurnV2).not.toHaveBeenCalled();
    expect(importAttachments).not.toHaveBeenCalled();

    await expect(store.retryDraftRecovery()).resolves.toBe(true);

    const sessionDraftCalls = listDraftAttachments.mock.calls.filter(([, target]) =>
      target.type === "session" && target.sessionId === SESSION_A,
    );
    expect(sessionDraftCalls).toHaveLength(2);
    expect(store.selectedSessionId).toBe(SESSION_A);
    expect(store.draftTargetReady).toBe(true);
    expect(store.draftAttachments).toEqual([sessionAttachment]);
    expect(store.history).toEqual({ turns: [], nextCursor: null });
    expect(store.sessions.find((value) => value.sessionId === SESSION_A)?.title).toBe("Recovered A");
    expect(store.phase).toBe("ready");
    expect(store.lastErrorCode).toBeNull();
    expect(store.canSend).toBe(true);
    expect(store.canAttach).toBe(true);
    expect(subscribeSession).toHaveBeenCalledOnce();
    expect(resyncSession).toHaveBeenCalledOnce();

    await store.importAttachmentPaths(["/private/recovered.pdf"]);
    expect(importAttachments).toHaveBeenCalledOnce();
  });

  it("returns from an unavailable deleted-session draft to a clean sendable new-task draft", async () => {
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(async (_context, target) => {
      if (target.type === "new") return [];
      throw new ChatClientError({
        schemaVersion: 2,
        code: "chat_resource_not_found",
        retryable: false,
        recovery: "none",
      });
    });
    const store = createStore(fakeClient({ listDraftAttachments }).client);
    await store.bind(TENANT);

    await store.selectSession(SESSION_A);
    expect(store.phase).toBe("unavailable");
    expect(store.selectedSessionId).toBe(SESSION_A);
    expect(store.draftTarget).toEqual(chatSessionDraftTarget(SESSION_A));
    expect(store.draftTargetReady).toBe(false);
    expect(store.attachmentErrorCode).toBe("chat_resource_not_found");
    expect(store.canSend).toBe(false);

    await store.clearSelectedSession();

    expect(store.phase).toBe("ready");
    expect(store.selectedSessionId).toBeNull();
    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftTargetReady).toBe(true);
    expect(store.attachmentErrorCode).toBeNull();
    expect(store.lastErrorCode).toBeNull();
    expect(store.canSend).toBe(true);
    expect(store.canAttach).toBe(true);
    expect(listDraftAttachments).toHaveBeenLastCalledWith(CONTEXT, CHAT_NEW_DRAFT_TARGET);
  });

  it("reports whether an interrupt request crossed the authority boundary", async () => {
    const interruptTurn = vi.fn(async (_context: string, sessionId: string, operationId: string) => ({
      sessionId,
      turnId: TURN_A,
      operationId,
    }));
    const { client } = fakeClient({ interruptTurn });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await expect(store.interruptSelected()).resolves.toBe(true);
    expect(interruptTurn).toHaveBeenCalledOnce();

    const denied = fakeClient({
      bindContext: async () => ({
        contextId: CONTEXT,
        expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
        allowedActions: ["read_sessions", "read_projects"],
      }),
      interruptTurn,
    });
    const deniedStore = createStore(denied.client);
    await deniedStore.bind(TENANT);
    await deniedStore.selectSession(SESSION_A);
    await expect(deniedStore.interruptSelected()).resolves.toBe(false);
    expect(interruptTurn).toHaveBeenCalledOnce();
  });

  it("drops a late A resync after selecting B", async () => {
    const delayedA = new Deferred<ChatResyncProjection>();
    const { client } = fakeClient({
      resyncSession: async (_context, sessionId) => sessionId === SESSION_A
        ? delayedA.promise
        : projection(SESSION_B, "B-current"),
    });
    const store = createStore(client);
    await store.bind(TENANT);

    const selectA = store.selectSession(SESSION_A);
    await Promise.resolve();
    const selectB = store.selectSession(SESSION_B);
    await selectB;
    delayedA.resolve(projection(SESSION_A, "A-late"));
    await selectA;

    expect(store.selectedSessionId).toBe(SESSION_B);
    expect(store.sessions.find((value) => value.sessionId === SESSION_B)?.title).toBe("B-current");
    expect(store.sessions.some((value) => value.title === "A-late")).toBe(false);
  });

  it("drops a late cleanup refresh after switching sessions", async () => {
    const cleanupOperationId = "019c1a00-0000-7000-8000-000000000098";
    const delayedCleanup = new Deferred<Awaited<ReturnType<ChatClient["getCleanupStatus"]>>>();
    const getCleanupStatus = vi.fn<ChatClient["getCleanupStatus"]>(
      async () => delayedCleanup.promise,
    );
    const { client, emit } = fakeClient({ getCleanupStatus });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    emit(event(
      "1",
      "019c1a00-0000-7000-8000-000000000044",
      "cleanup_state",
      { operationId: cleanupOperationId, state: "pending" },
    ));
    for (let index = 0; index < 32 && getCleanupStatus.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(getCleanupStatus).toHaveBeenCalledWith(CONTEXT, cleanupOperationId);

    await store.selectSession(SESSION_B);
    delayedCleanup.resolve(Object.freeze({
      operationId: cleanupOperationId,
      desktopState: "complete",
      hostState: "complete",
      runtimeState: "complete",
      outcomeCode: "cleanup_complete",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: 2,
      expiresAt: 3,
    }));
    for (let index = 0; index < 32; index += 1) await Promise.resolve();

    expect(store.selectedSessionId).toBe(SESSION_B);
    expect(store.cleanupStatus).toBeNull();
    expect(store.deleteDisposition).toBeNull();
    expect(getCleanupStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps control-plane projection authoritative across duplicate, gap, and stale events", async () => {
    let projectedState: "pending" | "bound" | "retry_wait" = "pending";
    const getSessionControlPlane = vi.fn(async (_context: string, sessionId: string) => ({
      sessionId,
      state: projectedState,
      issueCode: projectedState === "retry_wait" ? "chat_temporarily_unavailable" as const : null,
      retryable: projectedState === "retry_wait",
      recovery: projectedState === "retry_wait" ? "retry" as const : "none" as const,
    }));
    const { client, emitControlPlane } = fakeClient({ getSessionControlPlane });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(store.controlPlane?.state).toBe("pending");
    expect(store.canSend).toBe(false);

    projectedState = "bound";
    const bound: ChatControlPlaneEvent = {
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    };
    emitControlPlane(bound);
    emitControlPlane(bound);
    expect(store.controlPlane?.state).toBe("bound");
    expect(store.canSend).toBe(true);

    emitControlPlane({ ...bound, sequence: "2", sessionId: SESSION_B });
    expect(store.selectedSessionId).toBe(SESSION_A);
    expect(store.controlPlane?.state).toBe("bound");

    projectedState = "retry_wait";
    emitControlPlane({
      ...bound,
      sequence: "3",
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
    });
    for (let index = 0; index < 32; index += 1) await Promise.resolve();
    expect(getSessionControlPlane).toHaveBeenCalledTimes(2);
    expect(store.controlPlane?.state).toBe("retry_wait");
    expect(store.lastErrorCode).toBe("chat_temporarily_unavailable");
    expect(store.canSend).toBe(false);
  });

  it("keeps the v6 global control-plane cursor monotonic across session selection changes", async () => {
    const { client, emitControlPlane } = fakeClient();
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
    });
    emitControlPlane({
      schemaVersion: 1,
      sequence: "2",
      sessionId: SESSION_B,
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
    });
    await store.selectSession(SESSION_B);
    expect(store.controlPlane?.state).toBe("bound");

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_B,
      state: "failed",
      issueCode: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    });
    emitControlPlane({
      schemaVersion: 1,
      sequence: "2",
      sessionId: SESSION_B,
      state: "failed",
      issueCode: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    });
    expect(store.controlPlane?.state).toBe("bound");

    emitControlPlane({
      schemaVersion: 1,
      sequence: "3",
      sessionId: SESSION_B,
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
    });
    expect(store.controlPlane?.state).toBe("retry_wait");
  });

  it("resubscribes and reloads the authoritative snapshot on backpressure", async () => {
    const resync = vi.fn(async (_context: string, sessionId: string) => projection(sessionId));
    const { client, emit } = fakeClient({ resyncSession: resync });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    emit(event(
      "1",
      "019c1a00-0000-7000-8000-00000000000d",
      "resync_required",
      { reason: "backpressure" },
    ));
    for (let index = 0; index < 32; index += 1) await Promise.resolve();

    expect(resync).toHaveBeenCalledTimes(2);
    expect(store.phase).toBe("ready");
    expect(store.liveAssistantText).toBe("");
  });

  it("keeps the newest tenant bind authoritative when an older bind finishes late", async () => {
    const delayed = new Deferred<Awaited<ReturnType<ChatClient["bindContext"]>>>();
    let calls = 0;
    const { client } = fakeClient({
      bindContext: async () => {
        calls += 1;
        if (calls === 1) return delayed.promise;
        return {
          contextId: CONTEXT_B,
          expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
          allowedActions: ["read_sessions", "read_projects"],
        };
      },
    });
    const store = createStore(client);
    const oldBind = store.bind(TENANT);
    for (let index = 0; index < 32 && calls === 0; index += 1) await Promise.resolve();
    expect(calls).toBe(1);
    const newBind = store.bind("019c1a00-0000-7000-8000-000000000010");
    await newBind;
    delayed.resolve({
      contextId: CONTEXT,
      expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
      allowedActions: ["read_sessions", "read_projects"],
    });
    await oldBind;

    expect(store.context?.contextId).toBe(CONTEXT_B);
    store.clearForLogout();
    expect(store.context).toBeNull();
    expect(store.selectedSessionId).toBeNull();
    expect(store.phase).toBe("signed-out");
  });

  it("reads retained cleanup history when Native refuses its draft target", async () => {
    const cleanup = {
      operationId: "019c1a00-0000-7000-8000-000000000011",
      desktopState: "incomplete" as const,
      hostState: "incomplete" as const,
      runtimeState: "incomplete" as const,
      outcomeCode: "retry_limit_exceeded",
      lastErrorCode: "cleanup_protocol_failure",
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    };
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(async (_context, target) => {
      if (target.type === "session" && target.sessionId === SESSION_A) {
        throw new ChatClientError({schemaVersion: 2, code: "chat_resource_not_found", retryable: false, recovery: "none"});
      }
      return [];
    });
    const deleteSession = vi.fn<ChatClient["deleteSession"]>();
    const store = createStore(fakeClient({
      listDraftAttachments,
      deleteSession,
      resyncSession: async (_context, sessionId) => Object.freeze({
        ...projection(sessionId, "Retained archive"),
        history: sessionId === SESSION_A ? artifactHistory() : projection(sessionId).history,
        cleanup: sessionId === SESSION_A ? cleanup : null,
      }),
    }).client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(store.lastErrorCode).toBeNull();
    expect(store.history).toEqual(artifactHistory());
    expect(store.cleanupStatus).toEqual(cleanup);
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);
    expect(listDraftAttachments.mock.calls.filter(([, target]) => target.type === "session" && target.sessionId === SESSION_A)).toHaveLength(1);
    expect(deleteSession).not.toHaveBeenCalled();

    await store.selectSession(SESSION_B);
    expect(store.cleanupStatus).toBeNull();
    expect(store.draftTarget).toEqual(chatSessionDraftTarget(SESSION_B));
    expect(store.draftTargetReady).toBe(true);
  });

  it("keeps a missing draft target denied when resync does not prove cleanup", async () => {
    const store = createStore(fakeClient({
      listDraftAttachments: async (_context, target) => {
        if (target.type === "session") {
          throw new ChatClientError({schemaVersion: 2, code: "chat_resource_not_found", retryable: false, recovery: "none"});
        }
        return [];
      },
    }).client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(store.lastErrorCode).toBe("chat_resource_not_found");
    expect(store.history).toBeNull();
    expect(store.cleanupStatus).toBeNull();
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);
  });

  it("restores persisted cleanup state through a new store resync after restart", async () => {
    const cleanup = {
      operationId: "019c1a00-0000-7000-8000-000000000011",
      desktopState: "complete" as const,
      hostState: "complete" as const,
      runtimeState: "complete" as const,
      outcomeCode: "cleanup_complete",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: 2,
      expiresAt: 3,
    };
    const { client } = fakeClient({
      resyncSession: async (_context, sessionId) => Object.freeze({
        ...projection(sessionId),
        cleanup,
      }),
    });
    const firstProcess = createStore(client);
    await firstProcess.bind(TENANT);
    await firstProcess.selectSession(SESSION_A);
    await firstProcess.dispose();

    const restartedProcess = createStore(client);
    await restartedProcess.bind(TENANT);
    await restartedProcess.selectSession(SESSION_A);
    expect(restartedProcess.cleanupStatus).toEqual(cleanup);
  });

  it("blocks sends until the Rust readiness projection becomes sendable", async () => {
    const submitTurn = vi.fn(async (_context: string, sessionId: string, _input: string, operation: string) => ({
      sessionId, turnId: TURN_A, operationId: operation,
    }));
    const blocked = {
      lifecycle: "blocked" as const,
      host: "unavailable" as const,
      runtime: "unavailable" as const,
      storage: "ready" as const,
      canSend: false,
      issueCode: "chat_host_unavailable" as const,
      retryable: true,
      recovery: "start_or_retry" as const,
    };
    const ready = {
      lifecycle: "ready" as const,
      host: "ready" as const,
      runtime: "ready" as const,
      storage: "ready" as const,
      canSend: true,
      issueCode: null,
      retryable: false,
      recovery: "none" as const,
    };
    const { client } = fakeClient({
      getLocalReadiness: async () => blocked,
      requestLocalRecovery: async () => ready,
      submitTurn,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    await store.submitTurn("not yet");
    expect(submitTurn).not.toHaveBeenCalled();
    await store.requestLocalRecovery();
    await store.submitTurn("now ready");
    expect(submitTurn).toHaveBeenCalledOnce();
  });

  it("disables attachment import for every unavailable composer state", async () => {
    const delayedImport = new Deferred<readonly ChatAttachment[]>();
    const { client } = fakeClient({ pickAttachments: async () => delayedImport.promise });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(store.canSend).toBe(true);
    expect(store.canAttach).toBe(true);

    store.phase = "streaming";
    expect(store.canAttach).toBe(false);
    store.phase = "ready";

    const pendingImport = store.pickAttachments();
    expect(store.attachmentImporting).toBe(true);
    expect(store.canAttach).toBe(false);
    delayedImport.resolve(Object.freeze([]));
    await pendingImport;

    store.draftAttachments = Object.freeze(Array.from(
      { length: CHAT_DRAFT_ATTACHMENT_LIMIT },
      (_, index): ChatAttachment => Object.freeze({
        ...attachment(),
        attachmentId: `019c1a00-0000-7000-8000-${String(20 + index).padStart(12, "0")}`,
      }),
    ));
    expect(store.canAttach).toBe(false);
    store.draftAttachments = Object.freeze([]);

    const ready = store.localReadiness;
    store.localReadiness = Object.freeze({
      lifecycle: "blocked",
      host: "unavailable",
      runtime: "unavailable",
      storage: "ready",
      canSend: false,
      issueCode: "chat_host_unavailable",
      retryable: true,
      recovery: "start_or_retry",
    });
    expect(store.canAttach).toBe(false);
    store.localReadiness = ready;

    const bound = store.context;
    expect(bound).not.toBeNull();
    store.context = Object.freeze({
      ...bound!,
      allowedActions: Object.freeze(["read_sessions", "submit_turn"] as const),
    });
    expect(store.canSend).toBe(true);
    expect(store.canAttach).toBe(true);

    store.context = Object.freeze({
      ...bound!,
      allowedActions: Object.freeze(["read_sessions", "create_session"] as const),
    });
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);
  });

  it("rejects an eleventh dropped attachment without mutating the full draft", async () => {
    const importAttachments = vi.fn<ChatClient["importAttachments"]>(async () => []);
    const store = createStore(fakeClient({ importAttachments }).client);
    await store.bind(TENANT);

    const fullDraft = Object.freeze(Array.from(
      { length: CHAT_DRAFT_ATTACHMENT_LIMIT },
      (_, index): ChatAttachment => Object.freeze({
        ...attachment(),
        attachmentId: `019c1a00-0000-7000-8000-${String(20 + index).padStart(12, "0")}`,
      }),
    ));
    store.draftAttachments = fullDraft;
    expect(store.canAttach).toBe(false);

    await expect(store.importAttachmentPaths(["/transient/eleventh.pdf"]))
      .resolves.toEqual([]);

    expect(store.attachmentErrorCode).toBe("too_many");
    expect(importAttachments).not.toHaveBeenCalled();
    expect(store.draftAttachments).toEqual(fullDraft);
  });

  it("accepts only ordered aggregate import events and requires terminal dismissal before recovery", async () => {
    const delayedImport = new Deferred<readonly ChatAttachment[]>();
    const pickAttachments = vi.fn(async () => delayedImport.promise);
    const createSession = vi.fn<ChatClient["createSession"]>(
      async (_context, _project, _input, operation) => ({
        sessionId: SESSION_A,
        turnId: TURN_A,
        operationId: operation,
      }),
    );
    const harness = fakeClient({ pickAttachments, createSession });
    const store = createStore(harness.client);
    await store.bind(TENANT);

    const pending = store.pickAttachments();
    await Promise.resolve();
    await Promise.resolve();
    expect(pickAttachments).toHaveBeenCalledOnce();

    harness.emitAttachmentImport(attachmentImportEvent("queued", "1", { contextId: CONTEXT_B }));
    harness.emitAttachmentImport(attachmentImportEvent("queued", "1", { operationId: SESSION_CREATED }));
    harness.emitAttachmentImport(attachmentImportEvent("importing", "2"));
    expect(store.attachmentImportAttempt).toBeNull();

    harness.emitAttachmentImport(attachmentImportEvent("queued", "1"));
    expect(store.attachmentImportAttempt?.stage).toBe("queued");
    harness.emitAttachmentImport(attachmentImportEvent("queued", "1"));
    harness.emitAttachmentImport(attachmentImportEvent("importing", "2"));
    harness.emitAttachmentImport(attachmentImportEvent("indexing", "3"));
    await vi.advanceTimersByTimeAsync(CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS);
    expect(store.attachmentImportAttempt?.stage).toBe("importing");

    harness.emitAttachmentImport(attachmentImportEvent("parsing", "3"));
    harness.emitAttachmentImport(attachmentImportEvent("indexing", "4", { itemCount: 3 }));
    await vi.advanceTimersByTimeAsync(CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS);
    expect(store.attachmentImportAttempt).toMatchObject({ stage: "parsing", itemCount: 2 });
    harness.emitAttachmentImport(attachmentImportEvent("indexing", "4"));
    harness.emitAttachmentImport(attachmentImportEvent("error_terminal", "5"));
    harness.emitAttachmentImport(attachmentImportEvent("ready", "6"));
    await vi.advanceTimersByTimeAsync(CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS * 2);
    expect(store.attachmentImportAttempt).toMatchObject({
      stage: "error_terminal",
      issue: "parse_failed",
    });
    store.dismissAttachmentImportAttempt("019c1a00-0000-7000-8000-00000000000c");
    expect(store.attachmentImportAttempt?.stage).toBe("error_terminal");

    delayedImport.reject(new ChatClientError({
      schemaVersion: 2,
      code: "chat_request_invalid",
      retryable: false,
      recovery: "fix_request",
      attachmentIssue: "parse_failed",
    }));
    await expect(pending).rejects.toMatchObject({ shape: { attachmentIssue: "parse_failed" } });
    expect(store.canAttach).toBe(false);
    await expect(store.createSession("019c1a00-0000-7000-8000-000000000009", "blocked")).resolves.toBeNull();
    expect(createSession).not.toHaveBeenCalled();
    await expect(store.pickAttachments()).resolves.toEqual([]);
    expect(pickAttachments).toHaveBeenCalledOnce();

    store.dismissAttachmentImportAttempt(SESSION_CREATED);
    expect(store.attachmentImportAttempt?.stage).toBe("error_terminal");
    store.dismissAttachmentImportAttempt("019c1a00-0000-7000-8000-00000000000c");
    expect(store.attachmentImportAttempt).toBeNull();
    expect(store.attachmentErrorCode).toBeNull();
    expect(store.canAttach).toBe(true);
    await expect(store.createSession("019c1a00-0000-7000-8000-000000000009", "recovered"))
      .resolves.toBe(SESSION_A);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("synthesizes a terminal failure when the command rejects before its event arrives", async () => {
    const pickAttachments = vi.fn<ChatClient["pickAttachments"]>(async () => {
      throw new ChatClientError({
        schemaVersion: 2,
        code: "chat_request_invalid",
        retryable: false,
        recovery: "fix_request",
        attachmentIssue: "parse_failed",
        attachmentItemCount: 2,
      });
    });
    const harness = fakeClient({ pickAttachments });
    const store = createStore(harness.client);
    await store.bind(TENANT);

    await expect(store.pickAttachments()).rejects.toMatchObject({
      shape: { attachmentIssue: "parse_failed", attachmentItemCount: 2 },
    });

    expect(store.attachmentImportAttempt).toMatchObject({ stage: "queued", itemCount: 2 });
    expect(store.canAttach).toBe(false);
    await vi.advanceTimersByTimeAsync(CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS);
    expect(store.attachmentImportAttempt?.stage).toBe("importing");
    await vi.advanceTimersByTimeAsync(CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS);
    expect(store.attachmentImportAttempt?.stage).toBe("parsing");
    await vi.advanceTimersByTimeAsync(CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS);
    expect(store.attachmentImportAttempt).toMatchObject({
      stage: "error_terminal",
      issue: "parse_failed",
    });

    harness.emitAttachmentImport(attachmentImportEvent("queued", "1"));
    expect(store.attachmentImportAttempt?.stage).toBe("error_terminal");
    store.dismissAttachmentImportAttempt("019c1a00-0000-7000-8000-00000000000c");
    expect(store.attachmentImportAttempt).toBeNull();
    expect(store.canAttach).toBe(true);
  });

  it("keeps every successful native import stage observable for a minimum interval", async () => {
    const store = createStore(fakeClient({
      pickAttachments: async () => [attachment()],
    }).client);
    await store.bind(TENANT);

    await store.pickAttachments();

    expect(store.attachmentImportAttempt?.stage).toBe("queued");
    for (const stage of ["importing", "parsing", "indexing", "ready"] as const) {
      await vi.advanceTimersByTimeAsync(CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS);
      expect(store.attachmentImportAttempt?.stage).toBe(stage);
    }
    await vi.advanceTimersByTimeAsync(CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS - 1);
    expect(store.attachmentImportAttempt?.stage).toBe("ready");
    await vi.advanceTimersByTimeAsync(1);
    expect(store.attachmentImportAttempt).toBeNull();
    expect(store.draftAttachments).toEqual([attachment()]);
    expect(store.canAttach).toBe(true);
  });

  it("restores the scoped native draft in a new Pinia process without deleting it on dispose", async () => {
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(
      async (_context, target) => target.type === "new" ? [attachment()] : [],
    );
    const removeAttachment = vi.fn<ChatClient["removeAttachment"]>(
      async (_context, _target, _attachment, operation) => operation,
    );
    const { client } = fakeClient({ listDraftAttachments, removeAttachment });

    const firstProcess = createStore(client);
    await firstProcess.bind(TENANT);
    expect(firstProcess.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(firstProcess.draftAttachments).toEqual([attachment()]);
    await firstProcess.clearSelectedSession();
    expect(listDraftAttachments).toHaveBeenCalledTimes(1);

    await firstProcess.dispose();
    expect(removeAttachment).not.toHaveBeenCalled();

    setActivePinia(createPinia());
    const restartedProcess = createStore(client);
    await restartedProcess.bind(TENANT);
    expect(restartedProcess.draftAttachments).toEqual([attachment()]);
    expect(listDraftAttachments).toHaveBeenNthCalledWith(2, CONTEXT, CHAT_NEW_DRAFT_TARGET);
    expect(removeAttachment).not.toHaveBeenCalled();
  });

  it("does not restore a successfully removed native draft after restart", async () => {
    let persistedDrafts: readonly ChatAttachment[] = Object.freeze([attachment()]);
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(
      async (_context, target) => target.type === "new" ? persistedDrafts : [],
    );
    const removeAttachment = vi.fn<ChatClient["removeAttachment"]>(
      async (_context, _target, attachmentId, operation) => {
        persistedDrafts = Object.freeze(
          persistedDrafts.filter((candidate) => candidate.attachmentId !== attachmentId),
        );
        return operation;
      },
    );
    const { client } = fakeClient({ listDraftAttachments, removeAttachment });

    const firstProcess = createStore(client);
    await firstProcess.bind(TENANT);
    expect(firstProcess.draftAttachments).toEqual([attachment()]);

    await firstProcess.removeDraftAttachment(attachment().attachmentId);

    expect(firstProcess.draftAttachments).toEqual([]);
    expect(removeAttachment).toHaveBeenCalledWith(
      CONTEXT,
      CHAT_NEW_DRAFT_TARGET,
      attachment().attachmentId,
      "019c1a00-0000-7000-8000-00000000000c",
    );

    await firstProcess.dispose();
    setActivePinia(createPinia());
    const restartedProcess = createStore(client);
    await restartedProcess.bind(TENANT);

    expect(restartedProcess.draftAttachments).toEqual([]);
    expect(listDraftAttachments).toHaveBeenNthCalledWith(2, CONTEXT, CHAT_NEW_DRAFT_TARGET);
    expect(removeAttachment).toHaveBeenCalledOnce();
  });

  it("loads only the selected target while preserving drafts owned by the previous route", async () => {
    const sessionAttachment = Object.freeze({
      ...attachment(),
      attachmentId: "019c1a00-0000-7000-8000-000000000021",
      name: "session-a.txt",
      mediaType: "text/plain",
    }) satisfies ChatAttachment;
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(
      async (_context, target) => target.type === "new" ? [attachment()] : [sessionAttachment],
    );
    const removeAttachment = vi.fn<ChatClient["removeAttachment"]>(
      async (_context, _target, _attachment, operation) => operation,
    );
    const store = createStore(fakeClient({ listDraftAttachments, removeAttachment }).client);
    await store.bind(TENANT);
    await store.clearSelectedSession();

    await store.selectSession(SESSION_A);

    expect(store.draftTarget).toEqual(chatSessionDraftTarget(SESSION_A));
    expect(store.draftAttachments).toEqual([sessionAttachment]);
    expect(removeAttachment).not.toHaveBeenCalled();
    expect(listDraftAttachments).toHaveBeenLastCalledWith(
      CONTEXT,
      chatSessionDraftTarget(SESSION_A),
    );

    await store.clearSelectedSession();
    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftAttachments).toEqual([attachment()]);
    expect(removeAttachment).not.toHaveBeenCalled();
  });

  it("revalidates a project before every create attempt while reusing the create operation id", async () => {
    const generatedIds = [
      "019c1a00-0000-7000-8000-00000000000c",
      "019c1a00-0000-7000-8000-00000000000d",
      "019c1a00-0000-7000-8000-00000000000e",
    ];
    vi.stubGlobal("crypto", { randomUUID: () => generatedIds.shift() ?? "019c1a00-0000-7000-8000-00000000000f" });
    const calls: string[] = [];
    const createOperationIds: string[] = [];
    const revalidateProject = vi.fn<ChatClient["revalidateProject"]>(async (_context, projectId) => {
      calls.push("revalidate");
      return {
        projectId,
        safeName: "Synthetic Workspace",
        pinnedAt: null,
        lastUsedAt: 1,
        available: true,
      };
    });
    const createSession = vi.fn<ChatClient["createSession"]>(async (_context, _project, _input, operation) => {
      calls.push("create");
      createOperationIds.push(operation);
      throw new ChatClientError({
        schemaVersion: 1,
        code: "chat_temporarily_unavailable",
        retryable: true,
        recovery: "retry",
      });
    });
    const store = createStore(fakeClient({ revalidateProject, createSession }).client);
    await store.bind(TENANT);

    await expect(store.createSession("019c1a00-0000-7000-8000-000000000009", "same task"))
      .rejects.toMatchObject({ shape: { code: "chat_temporarily_unavailable" } });
    expect(store.submissionState).toBe("idle");
    await expect(store.createSession("019c1a00-0000-7000-8000-000000000009", "same task"))
      .rejects.toMatchObject({ shape: { code: "chat_temporarily_unavailable" } });
    expect(store.submissionState).toBe("idle");

    expect(calls).toEqual(["revalidate", "create", "revalidate", "create"]);
    expect(revalidateProject).toHaveBeenCalledTimes(2);
    expect(createOperationIds).toEqual([
      "019c1a00-0000-7000-8000-00000000000d",
      "019c1a00-0000-7000-8000-00000000000d",
    ]);
  });

  it("rejects an invalid project before v2 create and preserves the attachment draft", async () => {
    const invalidProjectId = "019c1a00-0000-7000-8000-000000000009";
    const createSessionV2 = vi.fn<ChatClient["createSessionV2"]>();
    const store = createStore(fakeClient({
      pickAttachments: async () => [attachment()],
      revalidateProject: async () => ({
        projectId: invalidProjectId,
        safeName: "Unavailable Workspace",
        pinnedAt: null,
        lastUsedAt: 1,
        available: false,
      }),
      createSessionV2,
    }).client);
    await store.bind(TENANT);
    await store.pickAttachments();
    await finishAttachmentImportPresentation();
    const retainedDraft = store.draftAttachments;

    await expect(store.createSession(invalidProjectId, "keep this input"))
      .rejects.toMatchObject({
        shape: {
          schemaVersion: 1,
          code: "chat_project_invalid",
          retryable: false,
          recovery: "reselect_project",
        },
      });

    expect(createSessionV2).not.toHaveBeenCalled();
    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftTargetReady).toBe(true);
    expect(store.draftAttachments).toBe(retainedDraft);
    expect(store.draftAttachments).toEqual([attachment()]);
  });

  it("does not create in context B when context A changes during project revalidation", async () => {
    const nextTenant = "019c1a00-0000-7000-8000-000000000010";
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const delayedProject = new Deferred<Awaited<ReturnType<ChatClient["revalidateProject"]>>>();
    const revalidateProject = vi.fn<ChatClient["revalidateProject"]>(async () => delayedProject.promise);
    const createSession = vi.fn<ChatClient["createSession"]>();
    const store = createStore(fakeClient({
      bindContext: async (tenant) => ({
        contextId: tenant === TENANT ? CONTEXT : CONTEXT_B,
        expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
        allowedActions: ALL_ALLOWED_ACTIONS,
      }),
      revalidateProject,
      createSession,
    }).client);
    await store.bind(TENANT);

    const staleCreate = store.createSession(projectId, "context A task");
    expect(revalidateProject).toHaveBeenCalledWith(CONTEXT, projectId, expect.any(String));
    await store.bind(nextTenant);
    delayedProject.resolve({
      projectId,
      safeName: "Context A Workspace",
      pinnedAt: null,
      lastUsedAt: 1,
      available: true,
    });

    await expect(staleCreate).resolves.toBeNull();
    expect(store.context?.contextId).toBe(CONTEXT_B);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("ignores an accepted create response after rebinding without clearing context B's draft", async () => {
    const nextTenant = "019c1a00-0000-7000-8000-000000000010";
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const delayedCreate = new Deferred<Awaited<ReturnType<ChatClient["createSession"]>>>();
    let createOperationId: string | null = null;
    const createSession = vi.fn<ChatClient["createSession"]>(
      async (_context, _project, _input, operation) => {
        createOperationId = operation;
        return delayedCreate.promise;
      },
    );
    const listSessions = vi.fn<ChatClient["listSessions"]>(async () => ({
      sessions: [session(SESSION_A), session(SESSION_B)],
      nextCursor: null,
    }));
    const subscribeSession = vi.fn<ChatClient["subscribeSession"]>(
      async () => "019c1a00-0000-7000-8000-00000000000a",
    );
    const store = createStore(fakeClient({
      bindContext: async (tenant) => ({
        contextId: tenant === TENANT ? CONTEXT : CONTEXT_B,
        expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
        allowedActions: ALL_ALLOWED_ACTIONS,
      }),
      listDraftAttachments: async (contextId, target) =>
        contextId === CONTEXT_B && target.type === "new" ? [attachment()] : [],
      listSessions,
      createSession,
      subscribeSession,
    }).client);
    await store.bind(TENANT);

    const staleCreate = store.createSession(projectId, "context A task");
    for (let index = 0; index < 32 && createSession.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(createSession).toHaveBeenCalledWith(CONTEXT, projectId, "context A task", expect.any(String));
    await store.bind(nextTenant);
    expect(store.draftAttachments).toEqual([attachment()]);
    delayedCreate.resolve({
      sessionId: SESSION_CREATED,
      turnId: TURN_A,
      operationId: createOperationId ?? "missing-operation-id",
    });

    await expect(staleCreate).resolves.toBeNull();
    expect(store.context?.contextId).toBe(CONTEXT_B);
    expect(store.selectedSessionId).toBeNull();
    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftAttachments).toEqual([attachment()]);
    expect(listSessions).toHaveBeenCalledTimes(2);
    expect(subscribeSession).not.toHaveBeenCalled();
  });

  it("does not leak the created A selection across rebinding during its post-durable refresh", async () => {
    const nextTenant = "019c1a00-0000-7000-8000-000000000010";
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const delayedReload = new Deferred<Awaited<ReturnType<ChatClient["listSessions"]>>>();
    let contextAListCalls = 0;
    const listSessions = vi.fn<ChatClient["listSessions"]>(async (contextId) => {
      if (contextId === CONTEXT) {
        contextAListCalls += 1;
        if (contextAListCalls === 2) return delayedReload.promise;
      }
      return { sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null };
    });
    const subscribeSession = vi.fn<ChatClient["subscribeSession"]>(
      async () => "019c1a00-0000-7000-8000-00000000000a",
    );
    const store = createStore(fakeClient({
      bindContext: async (tenant) => ({
        contextId: tenant === TENANT ? CONTEXT : CONTEXT_B,
        expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
        allowedActions: ALL_ALLOWED_ACTIONS,
      }),
      listDraftAttachments: async (contextId, target) =>
        contextId === CONTEXT_B && target.type === "new" ? [attachment()] : [],
      listSessions,
      subscribeSession,
    }).client);
    await store.bind(TENANT);

    const staleCreate = store.createSession(projectId, "context A task");
    for (let index = 0; index < 64 && contextAListCalls < 2; index += 1) {
      await Promise.resolve();
    }
    expect(contextAListCalls).toBe(2);
    await store.bind(nextTenant);
    expect(store.context?.contextId).toBe(CONTEXT_B);
    expect(store.draftAttachments).toEqual([attachment()]);
    delayedReload.resolve({ sessions: [session(SESSION_CREATED)], nextCursor: null });

    await expect(staleCreate).resolves.toBe(SESSION_A);
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(store.context?.contextId).toBe(CONTEXT_B);
    expect(store.selectedSessionId).toBeNull();
    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftAttachments).toEqual([attachment()]);
    expect(listSessions).toHaveBeenCalledTimes(3);
    expect(subscribeSession).toHaveBeenCalledOnce();
    expect(subscribeSession).toHaveBeenCalledWith(CONTEXT, SESSION_A);
  });

  it("ignores a stale create response before validating its operation id", async () => {
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const delayedCreate = new Deferred<Awaited<ReturnType<ChatClient["createSession"]>>>();
    const createSession = vi.fn<ChatClient["createSession"]>(async () => delayedCreate.promise);
    const store = createStore(fakeClient({ createSession }).client);
    await store.bind(TENANT);

    const staleCreate = store.createSession(projectId, "context A task");
    for (let index = 0; index < 32 && createSession.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(createSession).toHaveBeenCalledOnce();
    store.clearForLogout();
    delayedCreate.resolve({
      sessionId: SESSION_CREATED,
      turnId: TURN_A,
      operationId: "019c1a00-0000-7000-8000-000000000099",
    });

    await expect(staleCreate).resolves.toBeNull();
    expect(store.context).toBeNull();
    expect(store.phase).toBe("signed-out");
  });

  it("accepts the current submit response after a live event makes the session non-sendable", async () => {
    const delayedSubmit = new Deferred<Awaited<ReturnType<ChatClient["submitTurnV2"]>>>();
    let submitOperationId: string | null = null;
    const submitTurnV2 = vi.fn<ChatClient["submitTurnV2"]>(
      async (_context, _session, _blocks, operation) => {
        submitOperationId = operation;
        return delayedSubmit.promise;
      },
    );
    const resyncSession = vi.fn<ChatClient["resyncSession"]>(
      async (_context, sessionId) => projection(sessionId),
    );
    const { client, emitNative } = fakeClient({
      pickAttachments: async () => [attachment()],
      submitTurnV2,
      resyncSession,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.pickAttachments();
    await finishAttachmentImportPresentation();
    expect(store.draftAttachments).toEqual([attachment()]);

    const acceptedSubmit = store.submitTurn("session A task");
    for (let index = 0; index < 32 && submitTurnV2.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(submitTurnV2).toHaveBeenCalledOnce();

    emitNative({schemaVersion:2,contextId:CONTEXT,sessionId:SESSION_A,subscriptionId:"019c1a00-0000-7000-8000-00000000000a",view:{sessionId:SESSION_A,turnId:TURN_A,runtimeThreadId:"runtime-thread",runtimeTurnId:"runtime-turn",source:"native_observed",revision:"1",availability:"available",status:"inProgress",statusSource:"runtime_notification",terminalObserved:false,items:[]}});
    expect(store.phase).toBe("streaming");
    expect(store.canSend).toBe(false);
    delayedSubmit.resolve({
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: submitOperationId ?? "missing-operation-id",
    });

    await expect(acceptedSubmit).resolves.toBeUndefined();
    expect(store.draftAttachments).toEqual([]);
    expect(resyncSession).toHaveBeenCalledTimes(2);
  });

  it("marks live display only from the current native subscription and clears it on selection", async () => {
    const {client, emitNative} = fakeClient();
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(store.nativeLiveTurnId).toBeNull();
    const event: NativeConversationViewEvent = {schemaVersion:2, contextId:CONTEXT, sessionId:SESSION_A,
      subscriptionId:"019c1a00-0000-7000-8000-00000000000a", view:{sessionId:SESSION_A, turnId:TURN_A,
        runtimeThreadId:"runtime-thread", runtimeTurnId:"runtime-turn", source:"native_observed", revision:"1",
        availability:"partial", status:"inProgress", statusSource:"runtime_notification", terminalObserved:false, items:[]}};
    emitNative({...event, subscriptionId:"previous-subscription"});
    expect(store.nativeLiveTurnId).toBeNull();
    emitNative(event);
    expect(store.nativeLiveTurnId).toBe(TURN_A);
    await store.selectSession(SESSION_B);
    expect(store.nativeLiveTurnId).toBeNull();
    emitNative({...event, view:{...event.view, revision:"2"}});
    expect(store.nativeLiveTurnId).toBeNull();
  });

  it("ignores an accepted submit response after selecting B without clearing B's draft", async () => {
    const delayedSubmit = new Deferred<Awaited<ReturnType<ChatClient["submitTurn"]>>>();
    let submitOperationId: string | null = null;
    const submitTurn = vi.fn<ChatClient["submitTurn"]>(
      async (_context, _session, _input, operation) => {
        submitOperationId = operation;
        return delayedSubmit.promise;
      },
    );
    const resyncSession = vi.fn<ChatClient["resyncSession"]>(
      async (_context, sessionId) => projection(sessionId),
    );
    const store = createStore(fakeClient({
      listDraftAttachments: async (_context, target) =>
        target.type === "session" && target.sessionId === SESSION_B ? [attachment()] : [],
      submitTurn,
      resyncSession,
    }).client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    const staleSubmit = store.submitTurn("session A task");
    for (let index = 0; index < 32 && submitTurn.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(submitTurn).toHaveBeenCalledWith(CONTEXT, SESSION_A, "session A task", expect.any(String));
    await store.selectSession(SESSION_B);
    expect(store.draftAttachments).toEqual([attachment()]);
    delayedSubmit.resolve({
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: submitOperationId ?? "missing-operation-id",
    });

    await expect(staleSubmit).resolves.toBeUndefined();
    expect(store.selectedSessionId).toBe(SESSION_B);
    expect(store.draftTarget).toEqual(chatSessionDraftTarget(SESSION_B));
    expect(store.draftAttachments).toEqual([attachment()]);
    expect(resyncSession).toHaveBeenCalledTimes(2);
  });

  it("returns an explicit local durable result only for the current submit authority", async () => {
    const submitTurn = vi.fn<ChatClient["submitTurn"]>(
      async (_context, sessionId, _input, submittedOperationId) => ({
        sessionId,
        turnId: TURN_A,
        operationId: submittedOperationId,
      }),
    );
    const store = createStore(fakeClient({ submitTurn }).client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    await expect(store.submitTurnWithResult("session A task")).resolves.toEqual({
      status: "local_durable_accepted",
      draftTarget: chatSessionDraftTarget(SESSION_A),
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: "019c1a00-0000-7000-8000-00000000000c",
    });

    store.localReadiness = {
      lifecycle: "blocked",
      host: "unavailable",
      runtime: "unavailable",
      storage: "ready",
      canSend: false,
      issueCode: "chat_host_unavailable",
      retryable: true,
      recovery: "start_or_retry",
    };
    await expect(store.submitTurnWithResult("blocked")).resolves.toEqual({
      status: "not_accepted",
    });
    expect(submitTurn).toHaveBeenCalledOnce();
  });

  it("returns an explicit local durable result for a created session", async () => {
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const store = createStore(fakeClient().client);
    await store.bind(TENANT);

    await expect(store.createSessionWithResult(projectId, "new task")).resolves.toEqual({
      status: "local_durable_accepted",
      draftTarget: CHAT_NEW_DRAFT_TARGET,
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: "019c1a00-0000-7000-8000-00000000000c",
    });
  });

  it("rejects over-limit UTF-8 create input before project validation or native dispatch", async () => {
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const overLimit = "界".repeat(Math.floor(CHAT_INPUT_MAX_BYTES / 3) + 1);
    const revalidateProject = vi.fn<ChatClient["revalidateProject"]>(async () => ({
      projectId,
      safeName: "Synthetic Workspace",
      pinnedAt: null,
      lastUsedAt: 1,
      available: true,
    }));
    const createSession = vi.fn<ChatClient["createSession"]>(
      async (_context, _project, _input, operationId) => ({
        sessionId: SESSION_A,
        turnId: TURN_A,
        operationId,
      }),
    );
    const store = createStore(fakeClient({ revalidateProject, createSession }).client);
    await store.bind(TENANT);

    await expect(store.createSessionWithResult(projectId, overLimit))
      .resolves.toEqual({ status: "not_accepted" });
    expect(store.submissionState).toBe("idle");
    expect(revalidateProject).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects over-limit UTF-8 reply input before native dispatch", async () => {
    const overLimit = "界".repeat(Math.floor(CHAT_INPUT_MAX_BYTES / 3) + 1);
    const submitTurn = vi.fn<ChatClient["submitTurn"]>(
      async (_context, sessionId, _input, operationId) => ({
        sessionId,
        turnId: TURN_A,
        operationId,
      }),
    );
    const store = createStore(fakeClient({ submitTurn }).client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    await expect(store.submitTurnWithResult(overLimit))
      .resolves.toEqual({ status: "not_accepted" });
    expect(store.submissionState).toBe("idle");
    expect(submitTurn).not.toHaveBeenCalled();
  });

  it("retains a new-task attachment when the current native response has a wrong operation id", async () => {
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const createSessionV2 = vi.fn<ChatClient["createSessionV2"]>(async () => ({
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: "019c1a00-0000-7000-8000-000000000099",
    }));
    const store = createStore(fakeClient({
      pickAttachments: async () => [attachment()],
      createSessionV2,
    }).client);
    await store.bind(TENANT);
    await store.pickAttachments();
    await finishAttachmentImportPresentation();

    await expect(store.createSessionWithResult(projectId, "new task"))
      .rejects.toMatchObject({ shape: { code: "chat_protocol_error" } });
    expect(createSessionV2).toHaveBeenCalledOnce();
    expect(store.submissionState).toBe("idle");
    expect(store.draftAttachments).toEqual([attachment()]);
  });

  it("retains a reply attachment when the current native response has a wrong operation id", async () => {
    const submitTurnV2 = vi.fn<ChatClient["submitTurnV2"]>(async () => ({
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: "019c1a00-0000-7000-8000-000000000099",
    }));
    const store = createStore(fakeClient({
      pickAttachments: async () => [attachment()],
      submitTurnV2,
    }).client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.pickAttachments();
    await finishAttachmentImportPresentation();

    await expect(store.submitTurnWithResult("reply task"))
      .rejects.toMatchObject({ shape: { code: "chat_protocol_error" } });
    expect(submitTurnV2).toHaveBeenCalledOnce();
    expect(store.submissionState).toBe("idle");
    expect(store.draftAttachments).toEqual([attachment()]);
  });

  it("projects one validating to submitting lifecycle around a create attempt", async () => {
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const projectResult = new Deferred<Awaited<ReturnType<ChatClient["revalidateProject"]>>>();
    const createResult = new Deferred<Awaited<ReturnType<ChatClient["createSession"]>>>();
    const createSession = vi.fn<ChatClient["createSession"]>(async () => createResult.promise);
    const store = createStore(fakeClient({
      revalidateProject: async () => projectResult.promise,
      createSession,
    }).client);
    await store.bind(TENANT);

    const pending = store.createSessionWithResult(projectId, "new task");
    expect(store.submissionState).toBe("validating");

    projectResult.resolve({
      projectId,
      safeName: "Synthetic Workspace",
      pinnedAt: null,
      lastUsedAt: 1,
      available: true,
    });
    for (let index = 0; index < 32 && createSession.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(createSession).toHaveBeenCalledOnce();
    expect(store.submissionState).toBe("submitting");

    createResult.resolve({
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: "019c1a00-0000-7000-8000-00000000000c",
    });
    await expect(pending).resolves.toMatchObject({ status: "local_durable_accepted" });
    expect(store.submissionState).toBe("idle");
  });

  it("rejects concurrent create attempts without revalidating or dispatching twice", async () => {
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const projectResult = new Deferred<Awaited<ReturnType<ChatClient["revalidateProject"]>>>();
    const createResult = new Deferred<Awaited<ReturnType<ChatClient["createSession"]>>>();
    const revalidateProject = vi.fn<ChatClient["revalidateProject"]>(
      async () => projectResult.promise,
    );
    const createSession = vi.fn<ChatClient["createSession"]>(async () => createResult.promise);
    const store = createStore(fakeClient({ revalidateProject, createSession }).client);
    await store.bind(TENANT);

    const pending = store.createSessionWithResult(projectId, "new task");
    expect(store.submissionState).toBe("validating");
    await expect(store.createSessionWithResult(projectId, "duplicate while validating"))
      .resolves.toEqual({ status: "not_accepted" });
    expect(revalidateProject).toHaveBeenCalledOnce();
    expect(createSession).not.toHaveBeenCalled();

    projectResult.resolve({
      projectId,
      safeName: "Synthetic Workspace",
      pinnedAt: null,
      lastUsedAt: 1,
      available: true,
    });
    for (let index = 0; index < 32 && createSession.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(store.submissionState).toBe("submitting");
    await expect(store.createSessionWithResult(projectId, "duplicate while submitting"))
      .resolves.toEqual({ status: "not_accepted" });
    expect(revalidateProject).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledOnce();

    createResult.resolve({
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: "019c1a00-0000-7000-8000-00000000000c",
    });
    await expect(pending).resolves.toMatchObject({ status: "local_durable_accepted" });
    expect(store.submissionState).toBe("idle");
  });

  it("does not let a stale create finally reset a newer submission state", async () => {
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const staleProjectResult = new Deferred<Awaited<ReturnType<ChatClient["revalidateProject"]>>>();
    const currentCreateResult = new Deferred<Awaited<ReturnType<ChatClient["createSession"]>>>();
    let revalidationCalls = 0;
    let currentOperationId: string | null = null;
    const revalidateProject = vi.fn<ChatClient["revalidateProject"]>(async (_context, requestedProjectId) => {
      revalidationCalls += 1;
      if (revalidationCalls === 1) return staleProjectResult.promise;
      return {
        projectId: requestedProjectId,
        safeName: "Synthetic Workspace",
        pinnedAt: null,
        lastUsedAt: 1,
        available: true,
      };
    });
    const createSession = vi.fn<ChatClient["createSession"]>(
      async (_context, _project, _input, operationId) => {
        currentOperationId = operationId;
        return currentCreateResult.promise;
      },
    );
    const store = createStore(fakeClient({ revalidateProject, createSession }).client);
    await store.bind(TENANT);

    const stale = store.createSessionWithResult(projectId, "stale task");
    expect(store.submissionState).toBe("validating");
    store.clearForLogout();
    expect(store.submissionState).toBe("idle");
    await store.bind(TENANT);

    const current = store.createSessionWithResult(projectId, "current task");
    for (let index = 0; index < 32 && createSession.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(createSession).toHaveBeenCalledOnce();
    expect(revalidateProject).toHaveBeenCalledTimes(2);
    expect(store.submissionState).toBe("submitting");

    staleProjectResult.resolve({
      projectId,
      safeName: "Stale Workspace",
      pinnedAt: null,
      lastUsedAt: 1,
      available: true,
    });
    await expect(stale).resolves.toEqual({ status: "not_accepted" });
    expect(createSession).toHaveBeenCalledOnce();
    expect(store.submissionState).toBe("submitting");

    currentCreateResult.resolve({
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: currentOperationId ?? "missing-operation-id",
    });
    await expect(current).resolves.toMatchObject({ status: "local_durable_accepted" });
    expect(store.submissionState).toBe("idle");
  });

  it("returns a sealed create acceptance without waiting for post-durable session reload", async () => {
    const projectId = "019c1a00-0000-7000-8000-000000000009";
    const delayedReload = new Deferred<Awaited<ReturnType<ChatClient["listSessions"]>>>();
    let listCalls = 0;
    const listSessions = vi.fn<ChatClient["listSessions"]>(async () => {
      listCalls += 1;
      return listCalls === 1
        ? { sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null }
        : delayedReload.promise;
    });
    const store = createStore(fakeClient({ listSessions }).client);
    await store.bind(TENANT);

    let settled: ChatSubmissionResult | null = null;
    const pending = store.createSessionWithResult(projectId, "new task");
    void pending.then((result) => { settled = result; });
    for (let index = 0; index < 32 && settled === null; index += 1) await Promise.resolve();

    try {
      expect(settled).toMatchObject({ status: "local_durable_accepted" });
      expect(store.submissionState).toBe("idle");
      expect(store.selectedSessionId).toBe(SESSION_A);
      for (let index = 0; index < 32 && listSessions.mock.calls.length < 2; index += 1) {
        await Promise.resolve();
      }
      expect(listSessions).toHaveBeenCalledTimes(2);
    } finally {
      delayedReload.resolve({ sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null });
      await pending;
    }
  });

  it.each(["failed", "interrupted"] as const)(
    "returns a sealed reply acceptance with one queued identity that survives %s resync",
    async (terminalStatus) => {
    const delayedResync = new Deferred<Awaited<ReturnType<ChatClient["resyncSession"]>>>();
    let resyncCalls = 0;
    const resyncSession = vi.fn<ChatClient["resyncSession"]>(async (_context, sessionId) => {
      resyncCalls += 1;
      return resyncCalls === 1 ? projection(sessionId) : delayedResync.promise;
    });
    const store = createStore(fakeClient({
      pickAttachments: async () => [attachment()],
      resyncSession,
    }).client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.pickAttachments();
    await finishAttachmentImportPresentation();

    let settled: ChatSubmissionResult | null = null;
    const pending = store.submitTurnWithResult("reply task");
    void pending.then((result) => { settled = result; });
    for (let index = 0; index < 32 && settled === null; index += 1) await Promise.resolve();

    const terminalProjection: ChatResyncProjection = Object.freeze({
      session: Object.freeze({
        ...session(SESSION_A),
        latestTurnStatus: terminalStatus,
      }),
      history: Object.freeze({
        turns: Object.freeze([Object.freeze({
          turnId: TURN_A,
          status: terminalStatus,
          terminalAt: 2,
          reasoningStatus: "unavailable",
          reasoningReasonCode: terminalStatus === "interrupted" ? "turn_interrupted" : "runtime_error",
          messages: Object.freeze([Object.freeze({
            messageId: "019c1a00-0000-7000-8000-000000000041",
            role: "user" as const,
            content: "reply task",
            contentBlocks: Object.freeze([
              Object.freeze({ type: "text" as const, text: "reply task" }),
              Object.freeze({ ...attachment(), status: "bound" as const }),
            ]),
            status: "committed",
            ordinal: 0,
            createdAt: 1,
          })]),
          reasoning: Object.freeze([]),
          artifacts: Object.freeze([]),
        })]),
        nextCursor: null,
      }),
      cleanup: null,
    });

    try {
      expect(settled).toMatchObject({ status: "local_durable_accepted" });
      expect(store.submissionState).toBe("idle");
      expect(store.draftAttachments).toEqual([]);
      const queuedTimeline = selectConversationTimeline(store.conversationState, SESSION_A);
      const queuedTurn = queuedTimeline?.turns.find((turn) => turn.turnId === TURN_A);
      const queuedUsers = queuedTurn?.items.filter((item) => item.presentation === "user_message") ?? [];
      expect(queuedTurn?.domainStatus).toBe("queued");
      expect(queuedUsers).toHaveLength(1);
      expect(queuedUsers[0]?.contentBlocks).toHaveLength(2);
      const queuedIdentity = queuedUsers[0]!.identity;
      for (let index = 0; index < 32 && resyncSession.mock.calls.length < 2; index += 1) {
        await Promise.resolve();
      }
      expect(resyncSession).toHaveBeenCalledTimes(2);
      delayedResync.resolve(terminalProjection);
      await vi.waitFor(() => {
        expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A)?.status)
          .toBe(terminalStatus);
      });
      const terminalTimeline = selectConversationTimeline(store.conversationState, SESSION_A);
      const terminalTurn = terminalTimeline?.turns.find((turn) => turn.turnId === TURN_A);
      const terminalUsers = terminalTurn?.items.filter((item) => item.presentation === "user_message") ?? [];
      expect(terminalUsers).toHaveLength(1);
      expect(terminalUsers[0]?.identity).toBe(queuedIdentity);
      expect(store.draftAttachments).toEqual([]);
    } finally {
      delayedResync.resolve(terminalProjection);
      await pending;
    }
    },
  );

  it("creates an attachment-only v2 turn and clears the draft only after success", async () => {
    const pickAttachments = vi.fn(async () => [attachment()]);
    const createSessionV2 = vi.fn(async (_context: string, _project: string, _blocks: unknown, operation: string) => ({
      sessionId: SESSION_A,
      turnId: TURN_A,
      operationId: operation,
    }));
    const { client } = fakeClient({
      pickAttachments,
      createSessionV2,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.clearSelectedSession();
    await store.pickAttachments();
    expect(pickAttachments).toHaveBeenCalledWith(
      CONTEXT,
      CHAT_NEW_DRAFT_TARGET,
      10,
      expect.any(String),
    );
    expect(store.draftAttachmentsReady).toBe(true);
    await finishAttachmentImportPresentation();

    await expect(store.createSession("019c1a00-0000-7000-8000-000000000009", "")).resolves.toBe(SESSION_A);
    expect(createSessionV2).toHaveBeenCalledWith(
      CONTEXT,
      "019c1a00-0000-7000-8000-000000000009",
      [{ type: "file", attachmentId: attachment().attachmentId }],
      expect.any(String),
    );
    expect(store.draftAttachments).toEqual([]);
  });

  it("treats an accepted create as successful when the session-list refresh fails", async () => {
    let listCall = 0;
    const createSessionV2 = vi.fn<ChatClient["createSessionV2"]>(
      async (_context, _project, _blocks, operation) => ({
        sessionId: SESSION_CREATED,
        turnId: TURN_A,
        operationId: operation,
      }),
    );
    const listSessions = vi.fn<ChatClient["listSessions"]>(async () => {
      listCall += 1;
      if (listCall === 1) return { sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null };
      throw new ChatClientError({
        schemaVersion: 2,
        code: "chat_temporarily_unavailable",
        retryable: true,
        recovery: "retry",
      });
    });
    const { client } = fakeClient({
      createSessionV2,
      listSessions,
      pickAttachments: async () => [attachment()],
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.clearSelectedSession();
    await store.pickAttachments();
    await finishAttachmentImportPresentation();

    await expect(store.createSession("019c1a00-0000-7000-8000-000000000009", "new task"))
      .resolves.toBe(SESSION_CREATED);

    expect(createSessionV2).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    expect(store.draftAttachments).toEqual([]);
    expect(store.selectedSessionId).toBe(SESSION_CREATED);
    expect(store.sessions.some((item) => item.sessionId === SESSION_CREATED)).toBe(true);
    expect(store.phase).toBe("ready");
  });

  it("retains attachment drafts after a failed v2 submit", async () => {
    const submitTurnV2 = vi.fn<ChatClient["submitTurnV2"]>(async () => {
      throw new ChatClientError({
        schemaVersion: 2,
        code: "chat_host_not_ready",
        retryable: true,
        recovery: "start_host",
      });
    });
    const { client } = fakeClient({
      pickAttachments: async () => [attachment()],
      submitTurnV2,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.pickAttachments();
    await finishAttachmentImportPresentation();

    await expect(store.submitTurn("")).rejects.toMatchObject({ shape: { code: "chat_host_not_ready" } });
    expect(submitTurnV2).toHaveBeenCalledOnce();
    expect(store.draftAttachments).toEqual([attachment()]);
  });

  it("reuses a failed attachment submission operation only while its content is unchanged", async () => {
    let operationSequence = 0x30;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() =>
        `019c1a00-0000-7000-8000-${(operationSequence++).toString(16).padStart(12, "0")}`,
      ),
    });
    const secondAttachment = Object.freeze({
      ...attachment(),
      attachmentId: "019c1a00-0000-7000-8000-000000000021",
      name: "synthetic-notes.txt",
      mediaType: "text/plain",
    }) satisfies ChatAttachment;
    let pickCount = 0;
    const pickAttachments = vi.fn(async () => [pickCount++ === 0 ? attachment() : secondAttachment]);
    const submitTurnV2 = vi.fn<ChatClient["submitTurnV2"]>(async () => {
      throw new ChatClientError({
        schemaVersion: 2,
        code: "chat_host_not_ready",
        retryable: true,
        recovery: "start_host",
      });
    });
    const { client } = fakeClient({ pickAttachments, submitTurnV2 });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.pickAttachments();
    await finishAttachmentImportPresentation();

    await expect(store.submitTurn("same input")).rejects.toMatchObject({ shape: { code: "chat_host_not_ready" } });
    await expect(store.submitTurn("same input")).rejects.toMatchObject({ shape: { code: "chat_host_not_ready" } });
    const firstOperation = submitTurnV2.mock.calls[0]?.[3];
    expect(submitTurnV2.mock.calls[1]?.[3]).toBe(firstOperation);

    await expect(store.submitTurn("changed input")).rejects.toMatchObject({ shape: { code: "chat_host_not_ready" } });
    const changedInputOperation = submitTurnV2.mock.calls[2]?.[3];
    expect(changedInputOperation).not.toBe(firstOperation);

    await store.pickAttachments();
    await finishAttachmentImportPresentation();
    await expect(store.submitTurn("changed input")).rejects.toMatchObject({ shape: { code: "chat_host_not_ready" } });
    expect(submitTurnV2.mock.calls[3]?.[3]).not.toBe(changedInputOperation);
  });

  it("leaves a late persisted import with its original target for later recovery", async () => {
    const delayedImport = new Deferred<readonly ChatAttachment[]>();
    let persistedNewDrafts: readonly ChatAttachment[] = [];
    const removeAttachment = vi.fn<ChatClient["removeAttachment"]>(
      async (_context, _target, _attachment, operation) => operation,
    );
    const { client } = fakeClient({
      pickAttachments: async () => {
        persistedNewDrafts = await delayedImport.promise;
        return persistedNewDrafts;
      },
      listDraftAttachments: async (_context, target) => target.type === "new"
        ? persistedNewDrafts
        : [],
      removeAttachment,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.clearSelectedSession();

    const pendingImport = store.pickAttachments();
    expect(store.attachmentImporting).toBe(true);
    await Promise.resolve();
    await store.selectSession(SESSION_A);
    delayedImport.resolve(Object.freeze([attachment()]));

    await expect(pendingImport).resolves.toEqual([]);
    expect(removeAttachment).not.toHaveBeenCalled();
    expect(store.draftAttachments).toEqual([]);
    expect(store.attachmentImporting).toBe(false);

    await store.clearSelectedSession();
    expect(store.draftAttachments).toEqual([attachment()]);
  });

  it("preserves per-session drafts while switching composers", async () => {
    let sessionADrafts: readonly ChatAttachment[] = [];
    const removeAttachment = vi.fn<ChatClient["removeAttachment"]>(
      async (_context, _target, _attachment, operation) => operation,
    );
    const { client } = fakeClient({
      pickAttachments: async () => {
        sessionADrafts = [attachment()];
        return sessionADrafts;
      },
      listDraftAttachments: async (_context, target) => target.type === "session" && target.sessionId === SESSION_A
        ? sessionADrafts
        : [],
      removeAttachment,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.pickAttachments();
    expect(store.draftAttachments).toEqual([attachment()]);

    await store.selectSession(SESSION_B);

    expect(store.draftAttachments).toEqual([]);
    expect(removeAttachment).not.toHaveBeenCalled();

    await store.selectSession(SESSION_A);
    expect(store.draftAttachments).toEqual([attachment()]);
    expect(removeAttachment).not.toHaveBeenCalled();
  });

  it("keeps the attachment draft when native removal fails", async () => {
    const removeAttachment = vi.fn(async () => {
      throw new ChatClientError({
        schemaVersion: 2,
        code: "chat_storage_unavailable",
        retryable: true,
        recovery: "retry",
      });
    });
    const { client } = fakeClient({
      pickAttachments: async () => [attachment()],
      removeAttachment,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.clearSelectedSession();
    await store.pickAttachments();

    await expect(store.removeDraftAttachment(attachment().attachmentId)).rejects.toMatchObject({
      shape: { code: "chat_storage_unavailable" },
    });
    expect(store.draftAttachments).toEqual([attachment()]);
    expect(store.attachmentErrorCode).toBe("chat_storage_unavailable");
  });

  it("preserves a specific native attachment rejection reason for the composer", async () => {
    const { client } = fakeClient({
      pickAttachments: async () => {
        throw new ChatClientError({
          schemaVersion: 2,
          code: "chat_request_invalid",
          retryable: false,
          recovery: "fix_request",
          attachmentIssue: "archive_unsupported",
        });
      },
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.clearSelectedSession();

    await expect(store.pickAttachments()).rejects.toMatchObject({
      shape: { attachmentIssue: "archive_unsupported" },
    });
    expect(store.attachmentErrorCode).toBe("archive_unsupported");
  });

  it("appends session pages without duplicating the cursor boundary", async () => {
    const listSessions = vi.fn(async (_context: string, cursor?: string) => cursor === undefined
      ? { sessions: [session(SESSION_A)], nextCursor: "abcdef0123456789" }
      : { sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null });
    const { client } = fakeClient({ listSessions });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.loadMoreSessions();

    expect(store.sessions.map((value) => value.sessionId)).toEqual([SESSION_A, SESSION_B]);
    expect(store.sessionsCursor).toBeNull();
  });

  it("clears a physically deleted selection and returns one closed navigation disposition", async () => {
    let listCount = 0;
    const complete = {
      operationId: "019c1a00-0000-7000-8000-00000000000c",
      desktopState: "complete" as const,
      hostState: "complete" as const,
      runtimeState: "complete" as const,
      outcomeCode: "cleanup_complete",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: 2,
      expiresAt: 3,
    };
    const { client } = fakeClient({
      listSessions: async () => {
        listCount += 1;
        return listCount === 1
          ? { sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null }
          : { sessions: [session(SESSION_B)], nextCursor: null };
      },
      deleteSession: async () => complete,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const disposition = await store.deleteSelected();

    expect(store.selectedSessionId).toBeNull();
    expect(store.sessions.map((value) => value.sessionId)).toEqual([SESSION_B]);
    expect(disposition).toEqual({
      kind: "navigate",
      deletedSessionId: SESSION_A,
      nextSessionId: SESSION_B,
      path: `/chat/${SESSION_B}`,
    });
  });

  it("polls a pending deletion to completion when the unavailable session has no live subscription", async () => {
    let listCount = 0;
    const pending = {
      operationId: "019c1a00-0000-7000-8000-00000000000c",
      desktopState: "pending" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    };
    const complete = {
      ...pending,
      desktopState: "complete" as const,
      hostState: "complete" as const,
      runtimeState: "complete" as const,
      outcomeCode: "cleanup_complete",
      completedAt: 2,
      expiresAt: 3,
    };
    const getCleanupStatus = vi.fn(async () => complete);
    const { client } = fakeClient({
      listSessions: async () => {
        listCount += 1;
        return listCount === 1
          ? { sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null }
          : { sessions: [session(SESSION_B)], nextCursor: null };
      },
      deleteSession: async () => pending,
      getCleanupStatus,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(await store.deleteSelected()).toEqual({
      kind: "cleanup_pending",
      deletedSessionId: SESSION_A,
      nextSessionId: null,
      path: `/chat/${SESSION_A}`,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(getCleanupStatus).toHaveBeenCalledWith(CONTEXT, pending.operationId);
    expect(store.selectedSessionId).toBeNull();
    expect(store.sessions.map((value) => value.sessionId)).toEqual([SESSION_B]);
    expect(store.deleteDisposition).toEqual({
      kind: "navigate",
      deletedSessionId: SESSION_A,
      nextSessionId: SESSION_B,
      path: `/chat/${SESSION_B}`,
    });
  });

  it("resumes the same cleanup operation after the retry limit is reached", async () => {
    const retryLimit = {
      operationId: "019c1a00-0000-7000-8000-000000000073",
      desktopState: "pending" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "retry_limit_exceeded",
      lastErrorCode: "chat_cleanup_incomplete",
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    };
    const resumed = { ...retryLimit, outcomeCode: "pending", lastErrorCode: null };
    let deleteCall = 0;
    const deleteSession = vi.fn<ChatClient["deleteSession"]>(async () => {
      deleteCall += 1;
      return deleteCall === 1 ? retryLimit : resumed;
    });
    const { client } = fakeClient({ deleteSession });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    await expect(store.deleteSelected()).resolves.toMatchObject({ kind: "cleanup_pending" });
    expect(store.cleanupStatus).toEqual(retryLimit);
    await expect(store.deleteSelected()).resolves.toMatchObject({ kind: "cleanup_pending" });

    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(store.cleanupStatus).toEqual(resumed);
  });

  it("does not let an older cleanup poll regress a manual retry-limit result", async () => {
    const pending = {
      operationId: "019c1a00-0000-7000-8000-000000000076",
      desktopState: "pending" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    };
    const retryLimit = {
      ...pending,
      outcomeCode: "retry_limit_exceeded",
      lastErrorCode: "chat_cleanup_incomplete",
    };
    const olderPoll = new Deferred<typeof pending>();
    let cleanupRead = 0;
    const getCleanupStatus = vi.fn<ChatClient["getCleanupStatus"]>(async () => {
      cleanupRead += 1;
      return cleanupRead === 1 ? olderPoll.promise : retryLimit;
    });
    const { client } = fakeClient({
      deleteSession: async () => pending,
      getCleanupStatus,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.deleteSelected();

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(getCleanupStatus).toHaveBeenCalledOnce());
    await store.refreshSelectedCleanup();
    expect(store.cleanupStatus).toEqual(retryLimit);

    olderPoll.resolve(pending);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.cleanupStatus).toEqual(retryLimit);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(getCleanupStatus).toHaveBeenCalledTimes(2);
  });

  it("finishes an already complete cleanup without dispatching another delete", async () => {
    let listCount = 0;
    const complete = {
      operationId: "019c1a00-0000-7000-8000-000000000074",
      desktopState: "complete" as const,
      hostState: "complete" as const,
      runtimeState: "complete" as const,
      outcomeCode: "cleanup_complete",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: 2,
      expiresAt: 3,
    };
    const deleteSession = vi.fn<ChatClient["deleteSession"]>();
    const { client } = fakeClient({
      listSessions: async () => {
        listCount += 1;
        return listCount === 1
          ? { sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null }
          : { sessions: [session(SESSION_B)], nextCursor: null };
      },
      deleteSession,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    store.cleanupStatus = complete;

    await expect(store.deleteSelected()).resolves.toMatchObject({
      kind: "navigate",
      deletedSessionId: SESSION_A,
    });
    expect(deleteSession).not.toHaveBeenCalled();
    expect(store.selectedSessionId).toBeNull();
  });

  it("does not redirect a newer selection when completed-cleanup lists arrive late", async () => {
    const delayedSessions = new Deferred<Awaited<ReturnType<ChatClient["listSessions"]>>>();
    let listCalls = 0;
    const { client } = fakeClient({
      listSessions: async () => {
        listCalls += 1;
        return listCalls === 1
          ? { sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null }
          : delayedSessions.promise;
      },
      deleteSession: async () => ({
        operationId: "019c1a00-0000-7000-8000-000000000015",
        desktopState: "complete",
        hostState: "complete",
        runtimeState: "complete",
        outcomeCode: "cleanup_complete",
        lastErrorCode: null,
        requestedAt: 1,
        completedAt: 2,
        expiresAt: 3,
      }),
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    const staleCleanup = store.deleteSelected();
    for (let index = 0; index < 32 && listCalls < 2; index += 1) await Promise.resolve();
    expect(listCalls).toBe(2);
    await store.selectSession(SESSION_B);
    delayedSessions.resolve({ sessions: [session(SESSION_B)], nextCursor: null });

    await expect(staleCleanup).resolves.toBeNull();
    expect(store.selectedSessionId).toBe(SESSION_B);
    expect(store.deleteDisposition).toBeNull();
    expect(store.cleanupStatus).toBeNull();
  });

  it("drops a stale project mutation result after the authority rebinds", async () => {
    const nextTenant = "019c1a00-0000-7000-8000-000000000010";
    const oldProject = {
      projectId: "019c1a00-0000-7000-8000-000000000011",
      safeName: "Old tenant project",
      pinnedAt: null,
      lastUsedAt: 1,
      available: true,
    };
    const newProject = { ...oldProject, projectId: "019c1a00-0000-7000-8000-000000000012", safeName: "New tenant project" };
    const delayedPin = new Deferred<string>();
    const listProjects = vi.fn<ChatClient["listProjects"]>(async (contextId) =>
      contextId === CONTEXT ? [oldProject] : [newProject]
    );
    const { client } = fakeClient({
      bindContext: async (tenant) => ({
        contextId: tenant === TENANT ? CONTEXT : CONTEXT_B,
        expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
        allowedActions: ALL_ALLOWED_ACTIONS,
      }),
      listProjects,
      setProjectPinned: async () => delayedPin.promise,
    });
    const store = createStore(client);
    await store.bind(TENANT);

    const staleMutation = store.setProjectPinned(oldProject.projectId, true);
    await store.bind(nextTenant);
    delayedPin.resolve("019c1a00-0000-7000-8000-000000000013");
    await staleMutation;

    expect(store.context?.contextId).toBe(CONTEXT_B);
    expect(store.projects.map((project) => project.safeName)).toEqual(["New tenant project"]);
    expect(listProjects.mock.calls.map(([contextId]) => contextId)).toEqual([CONTEXT, CONTEXT_B]);
  });

  it("drops a stale deletion result after the authority rebinds", async () => {
    const nextTenant = "019c1a00-0000-7000-8000-000000000010";
    const delayedDelete = new Deferred<Awaited<ReturnType<ChatClient["deleteSession"]>>>();
    const { client } = fakeClient({
      bindContext: async (tenant) => ({
        contextId: tenant === TENANT ? CONTEXT : CONTEXT_B,
        expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
        allowedActions: ALL_ALLOWED_ACTIONS,
      }),
      deleteSession: async () => delayedDelete.promise,
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    const staleDeletion = store.deleteSelected();
    await store.bind(nextTenant);
    delayedDelete.resolve({
      operationId: "019c1a00-0000-7000-8000-000000000014",
      desktopState: "pending",
      hostState: "pending",
      runtimeState: "pending",
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    });

    await expect(staleDeletion).resolves.toBeNull();
    expect(store.context?.contextId).toBe(CONTEXT_B);
    expect(store.cleanupStatus).toBeNull();
    expect(store.deleteDisposition).toBeNull();
  });
});

describe("FEAT-134 chat store v4 authority", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("crypto", { randomUUID: () => "019c1a00-0000-7000-8000-00000000000c" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a selected v4 session writable without a v6 control plane", async () => {
    const submitTurnV2 = vi.fn<ChatClient["submitTurnV2"]>(
      async (_context, sessionId, _blocks, operationId) => ({
        sessionId,
        turnId: TURN_A,
        operationId,
      }),
    );
    const { client } = fakeClient({
      submitTurnV2,
      getSessionControlPlane: async () => {
        throw new Error("v6 control plane disabled");
      },
    });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-rollback-send-${storeSequence++}`,
      undefined,
      true,
      false,
      false,
    )();

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(store.selectedAccessMode).toBe("live");
    expect(store.controlPlane).toBeNull();
    expect(store.canSend).toBe(true);
    await expect(store.submitTurnWithResult("continue"))
      .resolves.toMatchObject({ status: "local_durable_accepted" });
    expect(submitTurnV2).toHaveBeenCalledOnce();
  });

  it("routes a text-only create through v2 when streaming v4 is enabled", async () => {
    const createSession = vi.fn<ChatClient["createSession"]>();
    const createSessionV2 = vi.fn<ChatClient["createSessionV2"]>(
      async (_context, _project, _blocks, operationId) => ({
        sessionId: SESSION_A,
        turnId: TURN_A,
        operationId,
      }),
    );
    const { client } = fakeClient({ createSession, createSessionV2 });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-text-create-${storeSequence++}`,
      undefined,
      true,
    )();

    await store.bind(TENANT);
    await expect(store.createSession(
      "019c1a00-0000-7000-8000-000000000009",
      "synthetic text only",
    )).resolves.toBe(SESSION_A);

    expect(createSession).not.toHaveBeenCalled();
    expect(createSessionV2).toHaveBeenCalledOnce();
    expect(createSessionV2).toHaveBeenCalledWith(
      CONTEXT,
      "019c1a00-0000-7000-8000-000000000009",
      [{ type: "text", text: "synthetic text only" }],
      "019c1a00-0000-7000-8000-00000000000c",
    );
    expect(await createSessionV2.mock.results[0]!.value).toMatchObject({
      operationId: createSessionV2.mock.calls[0]![3],
    });
  });

  it("routes a text-only submit through v2 when streaming v4 is enabled", async () => {
    const submitTurn = vi.fn<ChatClient["submitTurn"]>();
    const submitTurnV2 = vi.fn<ChatClient["submitTurnV2"]>(
      async (_context, sessionId, _blocks, operationId) => ({
        sessionId,
        turnId: TURN_A,
        operationId,
      }),
    );
    const { client } = fakeClient({ submitTurn, submitTurnV2 });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-text-submit-${storeSequence++}`,
      undefined,
      true,
    )();

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.submitTurn("synthetic text only");

    expect(submitTurn).not.toHaveBeenCalled();
    expect(submitTurnV2).toHaveBeenCalledOnce();
    expect(submitTurnV2).toHaveBeenCalledWith(
      CONTEXT,
      SESSION_A,
      [{ type: "text", text: "synthetic text only" }],
      "019c1a00-0000-7000-8000-00000000000c",
    );
    expect(await submitTurnV2.mock.results[0]!.value).toMatchObject({
      operationId: submitTurnV2.mock.calls[0]![3],
    });
  });

  it("keeps text-only create and submit on v1 when streaming v4 is disabled", async () => {
    const createSession = vi.fn<ChatClient["createSession"]>(
      async (_context, _project, _input, operationId) => ({
        sessionId: SESSION_A,
        turnId: TURN_A,
        operationId,
      }),
    );
    const submitTurn = vi.fn<ChatClient["submitTurn"]>(
      async (_context, sessionId, _input, operationId) => ({
        sessionId,
        turnId: TURN_A,
        operationId,
      }),
    );
    const createSessionV2 = vi.fn<ChatClient["createSessionV2"]>();
    const submitTurnV2 = vi.fn<ChatClient["submitTurnV2"]>();
    const { client } = fakeClient({
      createSession,
      submitTurn,
      createSessionV2,
      submitTurnV2,
    });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-text-legacy-${storeSequence++}`,
      undefined,
      false,
    )();

    await store.bind(TENANT);
    await expect(store.createSession(
      "019c1a00-0000-7000-8000-000000000009",
      "synthetic legacy create",
    )).resolves.toBe(SESSION_A);
    await store.submitTurn("synthetic legacy submit");

    expect(createSession).toHaveBeenCalledWith(
      CONTEXT,
      "019c1a00-0000-7000-8000-000000000009",
      "synthetic legacy create",
      "019c1a00-0000-7000-8000-00000000000c",
    );
    expect(submitTurn).toHaveBeenCalledWith(
      CONTEXT,
      SESSION_A,
      "synthetic legacy submit",
      "019c1a00-0000-7000-8000-00000000000c",
    );
    expect(createSessionV2).not.toHaveBeenCalled();
    expect(submitTurnV2).not.toHaveBeenCalled();
  });

  it("resyncs a locally failed queued turn to the authoritative failed state without dispatching", async () => {
    const turn = (status: "queued" | "failed"): ChatHistoryPageV4 => Object.freeze({
      turns: Object.freeze([Object.freeze({
        turnId: TURN_A,
        projectionAuthority: "legacy" as const,
        status,
        terminalAt: status === "failed" ? 2 : null,
        reasoningStatus: status === "failed" ? "unavailable" as const : "pending" as const,
        reasoningReasonCode: status === "failed" ? "reasoning_not_emitted" : null,
        messages: Object.freeze([Object.freeze({
          messageId: "13430000-0000-4000-8000-000000000021",
          role: "user" as const,
          content: "safe fixture",
          contentBlocks: Object.freeze([{ type: "text" as const, text: "safe fixture" }]),
          status: "committed",
          ordinal: 0,
          createdAt: 1,
        })]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([]),
        plan: null,
        notices: Object.freeze([]),
      })]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "0",
    });
    let resyncCount = 0;
    const resyncV4 = vi.fn<ChatClient["resyncSessionV4"]>(async (_context, sessionId) => {
      resyncCount += 1;
      const history = turn(resyncCount === 1 ? "queued" : "failed");
      return Object.freeze({
        session: Object.freeze({
          ...session(sessionId),
          latestTurnStatus: resyncCount === 1 ? "queued" : "failed",
        }),
        history,
        cleanup: null,
      });
    });
    const createSessionV2 = vi.fn<ChatClient["createSessionV2"]>();
    const submitTurnV2 = vi.fn<ChatClient["submitTurnV2"]>();
    const { client, emitV4 } = fakeClient({ resyncSessionV4: resyncV4, createSessionV2, submitTurnV2 });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-failed-turn-${storeSequence++}`,
      undefined,
      true,
    )();

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A)?.status).toBe("queued");

    emitV4(eventV4(1, "resync_required", { reason: "protocol_error" }));
    await vi.waitFor(() => expect(resyncV4).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));

    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A)).toMatchObject({
      status: "failed",
      terminalStatus: "failed",
    });
    expect(store.liveTurnStatus).toBe("failed");
    expect(store.sessions.find((entry) => entry.sessionId === SESSION_A)?.latestTurnStatus)
      .toBe("failed");
    expect(store.canSend).toBe(true);
    expect(createSessionV2).not.toHaveBeenCalled();
    expect(submitTurnV2).not.toHaveBeenCalled();
  });

  it("hydrates only the negotiated v4 semantic history while preserving user ordering", async () => {
    const page: ChatHistoryPageV4 = Object.freeze({
      turns: Object.freeze([Object.freeze({
        turnId: TURN_A,
        projectionAuthority: "v4" as const,
        status: "completed",
        terminalAt: 30,
        reasoningStatus: "complete",
        reasoningReasonCode: null,
        messages: Object.freeze([
          Object.freeze({
            messageId: "13430000-0000-4000-8000-000000000001",
            role: "user" as const,
            content: "synthetic request",
            contentBlocks: Object.freeze([{ type: "text" as const, text: "synthetic request" }]),
            status: "committed",
            ordinal: 0,
            createdAt: 1,
          }),
          Object.freeze({
            messageId: "13430000-0000-4000-8000-000000000002",
            role: "assistant" as const,
            content: "legacy duplicate",
            contentBlocks: Object.freeze([{ type: "text" as const, text: "legacy duplicate" }]),
            status: "committed",
            ordinal: 1,
            createdAt: 2,
          }),
        ]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([
          Object.freeze({
            ...sourceV4(2),
            itemId: "commentary-real-id",
            itemOrdinal: 1,
            itemType: "agentMessage",
            phase: "commentary" as const,
            status: "completed" as const,
            text: "synthetic process",
            reasoningStatus: null,
            reasoningReasonCode: null,
            reasoningParts: Object.freeze([]),
            startedAtMs: 10,
            completedAtMs: 11,
          }),
          Object.freeze({
            ...sourceV4(3),
            itemId: "final-real-id",
            itemOrdinal: 2,
            itemType: "agentMessage",
            phase: "final_answer" as const,
            status: "completed" as const,
            text: "synthetic final",
            reasoningStatus: null,
            reasoningReasonCode: null,
            reasoningParts: Object.freeze([]),
            startedAtMs: 12,
            completedAtMs: 13,
          }),
        ]),
        plan: Object.freeze({
          ...sourceV4(1),
          explanation: null,
          steps: Object.freeze([{ ordinal: 0, step: "synthetic step", status: "completed" as const }]),
        }),
        notices: Object.freeze([]),
      })]),
      nextCursor: null,
      sessionNotices: Object.freeze([Object.freeze({
        ...sourceV4(4),
        scope: "session" as const,
        severity: "warning" as const,
        code: "synthetic_warning",
        willRetry: false,
        observedAtMs: 31,
      })]),
      durableSequenceCut: "4",
    });
    const subscribeV1 = vi.fn<ChatClient["subscribeSession"]>();
    const resyncV2 = vi.fn<ChatClient["resyncSessionV2"]>();
    const subscribeV4 = vi.fn<ChatClient["subscribeSessionV4"]>(async () =>
      "019c1a00-0000-7000-8000-00000000000a"
    );
    const resyncV4 = vi.fn<ChatClient["resyncSessionV4"]>(async (_context, sessionId) =>
      projectionV4(sessionId, page)
    );
    const { client } = fakeClient({
      subscribeSession: subscribeV1,
      resyncSessionV2: resyncV2,
      subscribeSessionV4: subscribeV4,
      resyncSessionV4: resyncV4,
    });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-hydration-${storeSequence++}`,
      undefined,
      true,
    )();

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(subscribeV4).toHaveBeenCalledOnce();
    expect(resyncV4).toHaveBeenCalledOnce();
    expect(subscribeV1).not.toHaveBeenCalled();
    expect(resyncV2).not.toHaveBeenCalled();
    expect(store.history).toBe(page);
    expect(selectConversationItem(store.conversationState, SESSION_A, TURN_A, "final-real-id"))
      .toMatchObject({ ordinal: 2, agentMessagePhase: "final_answer" });
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      conversationMessageItemId(TURN_A, "assistant"),
    )).toBeNull();
    const itemOrdinals = Object.values(store.conversationState.items)
      .filter((item) => item.turnId === TURN_A)
      .map((item) => item.ordinal)
      .sort((left, right) => left - right);
    expect(itemOrdinals).toEqual([0, 1, 2]);
    expect(store.conversationState.threads[SESSION_A]?.notices).toHaveLength(1);
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A)?.plan?.steps)
      .toEqual([{ ordinal: 0, text: "synthetic step", status: "completed" }]);
  });

  it("keeps the v4 semantic snapshot while FEAT-128 independently ingests Artifact authority", async () => {
    const page: ChatHistoryPageV4 = Object.freeze({
      turns: Object.freeze([Object.freeze({
        ...artifactHistory().turns[0]!,
        projectionAuthority: "v4" as const,
        artifacts: artifactHistory().turns[0]!.artifacts ?? Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([Object.freeze({
          ...sourceV4(1),
          itemId: "final-with-artifact",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer" as const,
          status: "completed" as const,
          text: "synthetic final with artifact",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: Object.freeze([]),
          startedAtMs: 10,
          completedAtMs: 11,
        })]),
        plan: null,
        notices: Object.freeze([]),
      })]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "1",
    });
    const loadHistoryV3 = vi.fn<ChatClient["loadHistoryV3"]>();
    const loadHistoryV4 = vi.fn<ChatClient["loadHistoryV4"]>(async () => page);
    const { client } = fakeClient({
      loadHistoryV3,
      loadHistoryV4,
      resyncSessionV4: async (_context, sessionId) => projectionV4(sessionId, page),
    });
    const artifacts = createArtifactStoreDefinition(`artifact-feat134-${storeSequence++}`)();
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-artifact-${storeSequence++}`,
      () => ({
        liveClient: { listen: async () => () => undefined },
        store: artifacts,
        authority: () => ({ authorizationRevision: 9, tenantId: TENANT }),
      }),
      true,
    )();

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(loadHistoryV4).toHaveBeenCalledTimes(2);
    expect(loadHistoryV3).not.toHaveBeenCalled();
    expect(artifacts.artifactsForTurn(SESSION_A, TURN_A)).toMatchObject([
      { artifactId: ARTIFACT_A, status: "ready" },
    ]);
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      "final-with-artifact",
    )).toMatchObject({ agentMessagePhase: "final_answer" });
  });

  it("resyncs a mixed legacy/v4/v5 page and hydrates typed Command authority", async () => {
    const executionSource = Object.freeze({
      sourceEventId: "019fbf59-4000-7000-8000-000000000001",
      sourceSequence: "1",
      sourceOccurredAt: "2026-08-29T08:00:00Z",
    });
    const page: ChatHistoryPageV5 = Object.freeze({
      schemaVersion: 5,
      turns: Object.freeze([Object.freeze({
        turnId: "019c1a00-0000-7000-8000-000000000021",
        projectionAuthority: "legacy",
        status: "queued",
        terminalAt: null,
        reasoningStatus: "pending",
        reasoningReasonCode: null,
        messages: Object.freeze([]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([]),
        plan: null,
        notices: Object.freeze([]),
      }), Object.freeze({
        turnId: "019c1a00-0000-7000-8000-000000000022",
        projectionAuthority: "v4",
        status: "completed",
        terminalAt: 2,
        reasoningStatus: "unavailable",
        reasoningReasonCode: "reasoning_not_emitted",
        messages: Object.freeze([]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([Object.freeze({
          ...sourceV4(1),
          itemId: "v4-final-in-v5-page",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer",
          status: "completed",
          text: "older v4 final",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: Object.freeze([]),
          startedAtMs: 1,
          completedAtMs: 2,
        })]),
        plan: null,
        notices: Object.freeze([]),
      }), Object.freeze({
        turnId: TURN_A,
        projectionAuthority: "v5",
        status: "completed",
        terminalAt: 3,
        reasoningStatus: "unavailable",
        reasoningReasonCode: "reasoning_not_emitted",
        messages: Object.freeze([]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([Object.freeze({
          ...executionSource,
          itemId: "command-v5-history",
          itemOrdinal: 1,
          itemType: "command",
          phase: null,
          status: "completed",
          text: "",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: Object.freeze([]),
          startedAtMs: 1,
          completedAtMs: 2,
          execution: Object.freeze({
            kind: "command",
            status: "completed",
            startedSource: executionSource,
            lastSource: executionSource,
            commandSummary: Object.freeze({
              text: "Inspect repository status",
              truncated: false,
              truncationReason: null,
            }),
            cwd: Object.freeze({ kind: "workspace_root", segments: Object.freeze([]) }),
            liveOutput: Object.freeze({
              text: "working tree clean\n",
              truncated: false,
              truncationReason: null,
            }),
            output: Object.freeze({
              retention: "complete",
              text: "working tree clean\n",
              head: null,
              tail: null,
              reason: null,
              truncated: false,
              truncationReason: null,
            }),
            durationMs: 7,
            exitCode: 0,
            error: null,
          }),
        })]),
        plan: null,
        notices: Object.freeze([]),
      })]),
      nextCursor: "abcdefghijklmnop",
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "1",
    });
    const olderPage: ChatHistoryPageV5 = Object.freeze({
      schemaVersion: 5,
      turns: Object.freeze([Object.freeze({
        turnId: "019c1a00-0000-7000-8000-000000000023",
        projectionAuthority: "legacy",
        status: "completed",
        terminalAt: 1,
        reasoningStatus: "complete",
        reasoningReasonCode: null,
        messages: Object.freeze([]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([]),
        plan: null,
        notices: Object.freeze([]),
      })]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "99",
    });
    const subscribeV1 = vi.fn<ChatClient["subscribeSession"]>();
    const subscribeV4 = vi.fn<ChatClient["subscribeSessionV4"]>();
    const subscribeV5 = vi.fn<ChatClient["subscribeSessionV5"]>(async () =>
      "019c1a00-0000-7000-8000-00000000000a"
    );
    const resyncV4 = vi.fn<ChatClient["resyncSessionV4"]>();
    const loadHistoryV5 = vi.fn<ChatClient["loadHistoryV5"]>(async () => olderPage);
    const resyncV5 = vi.fn<ChatClient["resyncSessionV5"]>(async (_context, sessionId) =>
      Object.freeze({
        session: session(sessionId),
        history: page,
        cleanup: null,
      }) satisfies ChatResyncProjectionV5
    );
    const { client, emitV5 } = fakeClient({
      subscribeSession: subscribeV1,
      subscribeSessionV4: subscribeV4,
      subscribeSessionV5: subscribeV5,
      resyncSessionV4: resyncV4,
      resyncSessionV5: resyncV5,
      loadHistoryV5,
    });
    const store = createChatStoreDefinition(
      client,
      `chat-feat136-v5-${storeSequence++}`,
      undefined,
      true,
      true,
    )();

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(subscribeV5).toHaveBeenCalledOnce();
    expect(resyncV5).toHaveBeenCalledOnce();
    expect(subscribeV4).not.toHaveBeenCalled();
    expect(subscribeV1).not.toHaveBeenCalled();
    expect(resyncV4).not.toHaveBeenCalled();
    expect(store.conversationState.schemaVersion).toBe(3);
    expect(selectConversationTurn(
      store.conversationState,
      SESSION_A,
      "019c1a00-0000-7000-8000-000000000021",
    )).toMatchObject({ status: "queued" });
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      "019c1a00-0000-7000-8000-000000000022",
      "v4-final-in-v5-page",
    )).toMatchObject({
      kind: "assistant_message",
      execution: null,
      contentBlocks: [{ text: "older v4 final" }],
    });
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      "command-v5-history",
    )).toMatchObject({
      kind: "command",
      execution: {
        kind: "command",
        output: { retention: "complete", text: "working tree clean\n" },
      },
    });

    emitV5(Object.freeze({
      schemaVersion: 5,
      sourceSchemaVersion: 4,
      subscriptionId: "019c1a00-0000-7000-8000-00000000000a",
      contextId: CONTEXT,
      sessionId: SESSION_A,
      turnId: "019c1a00-0000-7000-8000-000000000021",
      projectionSequence: "1",
      eventId: "019fbf59-4000-7000-8000-000000000010",
      durableSequence: "2",
      kind: "item_started",
      payload: Object.freeze({
        ...sourceV4(2),
        itemId: "sticky-command-unknown",
        itemOrdinal: 1,
        itemType: "commandExecution",
        phase: null,
        text: null,
      }),
    }));
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      "019c1a00-0000-7000-8000-000000000021",
      "sticky-command-unknown",
    )).toBeNull();

    await store.loadOlderHistory();
    expect(loadHistoryV5).toHaveBeenCalledWith(
      CONTEXT,
      SESSION_A,
      "abcdefghijklmnop",
      20,
      expect.any(AbortSignal),
    );
    expect(selectConversationTurn(
      store.conversationState,
      SESSION_A,
      "019c1a00-0000-7000-8000-000000000023",
    )).toMatchObject({ status: "completed" });
    expect(store.history).toMatchObject({
      schemaVersion: 5,
      nextCursor: null,
      durableSequenceCut: "1",
    });
  });

  it("uses the gated v6 closed path and derives action authority only from the Host snapshot", async () => {
    const subscribeV5 = vi.fn<ChatClient["subscribeSessionV5"]>();
    const resyncV5 = vi.fn<ChatClient["resyncSessionV5"]>();
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => Object.freeze({
      subscriptionId: LOCAL_SUBSCRIPTION_A,
      pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
    }));
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) =>
      projectionV6(
        sessionId,
        historyV6(),
        pendingApprovalSnapshotV6(HOST_GENERATION_A, null),
      ));
    const { client } = fakeClient({
      subscribeSessionV5: subscribeV5,
      resyncSessionV5: resyncV5,
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(subscribeV6).toHaveBeenCalledWith(CONTEXT, SESSION_A);
    expect(resyncV6).toHaveBeenCalledOnce();
    expect(subscribeV5).not.toHaveBeenCalled();
    expect(resyncV5).not.toHaveBeenCalled();
    expect(LOCAL_SUBSCRIPTION_A).not.toBe(HOST_GENERATION_A);
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      threadId: SESSION_A,
      turnId: TURN_A,
      itemId: COMMAND_A,
      status: "pending",
      authority: "actionable",
      authorityStreamId: HOST_GENERATION_A,
    });
    expect(selectConversationTimeline(
      store.conversationState,
      SESSION_A,
      store.conversationApprovalState,
    )?.turns[0]?.items[0]?.approval).toMatchObject({
      approvalRequestId: APPROVAL_A,
      authority: "actionable",
    });
    expect(JSON.stringify(store.conversationApprovalState)).not.toContain("agentSessionId");
  });

  it("reads terminal local v6 history when a stale bound Host session no longer exists", async () => {
    const currentPage = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([acceptedApprovalProjectionV6()]),
      "abcdefghijklmnop",
      "42",
    );
    const olderTurnId = "13700000-0000-4000-8000-000000000030";
    const olderPage = historyV6(
      Object.freeze([commandTurnV6(olderTurnId, COMMAND_B, true)]),
      Object.freeze([resolvedApprovalProjectionV6(APPROVAL_B, olderTurnId, COMMAND_B)]),
      null,
      "22",
    );
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      throw new ChatClientError({
        schemaVersion: 6,
        code: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      });
    });
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>();
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(
      async (_context, _sessionId, cursor) => cursor === undefined ? currentPage : olderPage,
    );
    const interruptTurn = vi.fn<ChatClient["interruptTurn"]>();
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [
          Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" }),
          session(SESSION_B),
        ],
        nextCursor: null,
      }),
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
      loadHistoryV6,
      interruptTurn,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(subscribeV6).toHaveBeenCalledOnce();
    expect(resyncV6).not.toHaveBeenCalled();
    expect(loadHistoryV6).toHaveBeenCalledWith(
      CONTEXT,
      SESSION_A,
      undefined,
      20,
      expect.any(AbortSignal),
    );
    expect(store.selectedSessionId).toBe(SESSION_A);
    expect(store.phase).toBe("ready");
    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.lastErrorCode).toBeNull();
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);
    expect(store.canDecideApprovals).toBe(false);
    await expect(store.interruptSelected()).resolves.toBe(false);
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A))
      .toMatchObject({ status: "completed" });
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "resolved",
      authority: "historical",
      authorityStreamId: null,
    });

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_B,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    emitControlPlane({
      schemaVersion: 1,
      sequence: "3",
      sessionId: SESSION_B,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    expect(store.conversationApprovalState.reconciliation).toBe("synchronized");
    expect(store.selectedAccessMode).toBe("history-only");

    await store.loadOlderHistory();

    expect(loadHistoryV6).toHaveBeenCalledTimes(2);
    expect(selectConversationTurn(store.conversationState, SESSION_A, olderTurnId))
      .toMatchObject({ status: "completed" });
    expect(store.conversationApprovalState.approvals[APPROVAL_B]).toMatchObject({
      status: "resolved",
      authority: "historical",
      authorityStreamId: null,
    });
  });

  it("uses local v6 history directly for terminal control-plane protocol failures", async () => {
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>();
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>();
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(async () => terminalHistory);
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(async (_context, target) => {
      if (target.type === "new") return [];
      throw new ChatClientError({
        schemaVersion: 2,
        code: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      });
    });
    let liveListenerAvailable = true;
    const onEventV6 = vi.fn<ChatClient["onEventV6"]>(async () => {
      if (!liveListenerAvailable) throw new Error("listener unavailable");
      return () => undefined;
    });
    const { client } = fakeClient({
      listSessions: async () => ({
        sessions: [
          Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" }),
          session(SESSION_B),
        ],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "failed",
        issueCode: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      }),
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
      loadHistoryV6,
      listDraftAttachments,
      onEventV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.deactivatePageSession();
    liveListenerAvailable = false;
    await store.selectSession(SESSION_A);

    expect(store.phase).toBe("ready");
    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.lastErrorCode).toBeNull();
    expect(loadHistoryV6).toHaveBeenCalledOnce();
    expect(listDraftAttachments.mock.calls.some(([, target]) => target.type === "session")).toBe(false);
    expect(onEventV6).toHaveBeenCalledOnce();
    expect(subscribeV6).not.toHaveBeenCalled();
    expect(resyncV6).not.toHaveBeenCalled();
    expect(store.controlPlane).toMatchObject({ state: "failed", issueCode: "chat_protocol_error" });
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A))
      .toMatchObject({ status: "completed" });
  });

  it("retries a transient first local-history read and then enters history-only mode", async () => {
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    let historyAttempt = 0;
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(async () => {
      historyAttempt += 1;
      if (historyAttempt === 1) {
        throw new ChatClientError({
          schemaVersion: 6,
          code: "chat_temporarily_unavailable",
          retryable: true,
          recovery: "retry",
        });
      }
      return terminalHistory;
    });
    const { client } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "failed",
        issueCode: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      }),
      loadHistoryV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(store.selectedAccessMode).toBeNull();
    expect(store.lastErrorCode).toBe("chat_temporarily_unavailable");
    expect(store.phase).toBe("unavailable");

    await store.selectSession(SESSION_A);

    expect(loadHistoryV6).toHaveBeenCalledTimes(2);
    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.lastErrorCode).toBeNull();
    expect(store.phase).toBe("ready");
  });

  it("uses a terminal failed event that arrives while the first control-plane read is pending", async () => {
    const pendingControlPlane = new Deferred<ChatSessionControlPlane>();
    const getSessionControlPlane = vi.fn<ChatClient["getSessionControlPlane"]>(
      () => pendingControlPlane.promise,
    );
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane,
      loadHistoryV6: async () => terminalHistory,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    const selecting = store.selectSession(SESSION_A);
    await vi.waitFor(() => expect(getSessionControlPlane).toHaveBeenCalledOnce());
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "failed",
      issueCode: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    });
    expect(store.selectedAccessMode).toBeNull();
    expect(store.phase).toBe("resyncing");
    pendingControlPlane.resolve({
      sessionId: SESSION_A,
      state: "failed",
      issueCode: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    });
    await selecting;

    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.phase).toBe("ready");
    expect(store.lastErrorCode).toBeNull();
    expect(store.history).toBe(terminalHistory);
  });

  it("does not let an older same-session read steal a newer terminal candidate", async () => {
    const automaticRead = new Deferred<ChatSessionControlPlane>();
    const manualRead = new Deferred<ChatSessionControlPlane>();
    let controlPlaneCall = 0;
    const terminalFailure: ChatSessionControlPlane = {
      sessionId: SESSION_A,
      state: "failed",
      issueCode: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    };
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const getSessionControlPlane = vi.fn<ChatClient["getSessionControlPlane"]>(async () => {
      controlPlaneCall += 1;
      if (controlPlaneCall === 1) return terminalFailure;
      if (controlPlaneCall === 2) return automaticRead.promise;
      return manualRead.promise;
    });
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane,
      loadHistoryV6: async () => terminalHistory,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(controlPlaneCall).toBe(2));

    const manualSelection = store.selectSession(SESSION_A);
    await vi.waitFor(() => expect(controlPlaneCall).toBe(3));
    emitControlPlane({
      schemaVersion: 1,
      sequence: "2",
      ...terminalFailure,
    });
    automaticRead.resolve(terminalFailure);
    await Promise.resolve();
    manualRead.resolve(terminalFailure);
    await manualSelection;

    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.phase).toBe("ready");
    expect(store.lastErrorCode).toBeNull();
    expect(store.history).toBe(terminalHistory);
  });

  it("does not publish a terminal control-plane error while local history is still loading", async () => {
    const delayedHistory = new Deferred<ChatHistoryPageV6>();
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(() => delayedHistory.promise);
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "failed",
        issueCode: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      }),
      loadHistoryV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    const selecting = store.selectSession(SESSION_A);
    await vi.waitFor(() => expect(loadHistoryV6).toHaveBeenCalledOnce());

    expect(store.controlPlane).toBeNull();
    expect(store.lastErrorCode).toBeNull();
    expect(store.selectedAccessMode).toBeNull();

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "failed",
      issueCode: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    });
    expect(store.controlPlane).toBeNull();
    expect(store.phase).toBe("resyncing");

    delayedHistory.resolve(historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    ));
    await selecting;

    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.controlPlane).toMatchObject({ state: "failed", issueCode: "chat_protocol_error" });
  });

  it("keeps artifact authority for older pages in direct history-only mode", async () => {
    const olderTurnId = "13700000-0000-4000-8000-000000000031";
    const currentPage = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
      "abcdefghijklmnop",
      "42",
    );
    const olderPage = historyV6(
      Object.freeze([commandTurnV6(olderTurnId, COMMAND_B, true)]),
      Object.freeze([]),
      null,
      "22",
    );
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(
      async (_context, _sessionId, cursor) => cursor === undefined ? currentPage : olderPage,
    );
    const { client } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "failed",
        issueCode: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      }),
      loadHistoryV6,
    });
    const artifacts = createArtifactStoreDefinition(`artifact-history-only-${storeSequence++}`)();
    const store = createChatStoreDefinition(
      client,
      `chat-history-only-${storeSequence++}`,
      () => ({
        liveClient: { listen: async () => () => undefined },
        store: artifacts,
        authority: () => ({ authorizationRevision: 9, tenantId: TENANT }),
      }),
      true,
      true,
      true,
    )();

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.loadOlderHistory();

    expect(loadHistoryV6).toHaveBeenCalledTimes(2);
    expect(selectConversationTurn(store.conversationState, SESSION_A, olderTurnId))
      .toMatchObject({ status: "completed" });
    expect(store.history?.turns).toHaveLength(2);
  });

  it("can retry an older history page after a transient history-only failure", async () => {
    const olderTurnId = "13700000-0000-4000-8000-000000000032";
    const currentPage = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([acceptedApprovalProjectionV6()]),
      "abcdefghijklmnop",
      "42",
    );
    const olderPage = historyV6(
      Object.freeze([commandTurnV6(olderTurnId, COMMAND_B, true)]),
      Object.freeze([resolvedApprovalProjectionV6(APPROVAL_B, olderTurnId, COMMAND_B)]),
      null,
      "22",
    );
    let olderAttempts = 0;
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(async (_context, _sessionId, cursor) => {
      if (cursor === undefined) return currentPage;
      olderAttempts += 1;
      if (olderAttempts === 1) {
        throw new ChatClientError({
          schemaVersion: 6,
          code: "chat_temporarily_unavailable",
          retryable: true,
          recovery: "retry",
        });
      }
      return olderPage;
    });
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      throw new ChatClientError({
        schemaVersion: 6,
        code: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      });
    });
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      subscribeSessionV6: subscribeV6,
      loadHistoryV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.loadOlderHistory();

    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.conversationApprovalState.reconciliation).toBe("synchronized");
    expect(store.lastErrorCode).toBe("chat_temporarily_unavailable");

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "failed",
      issueCode: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    });
    expect(store.lastErrorCode).toBe("chat_temporarily_unavailable");

    await store.loadOlderHistory();

    expect(store.phase).toBe("ready");
    expect(store.lastErrorCode).toBeNull();
    expect(store.conversationApprovalState.reconciliation).toBe("synchronized");
    expect(selectConversationTurn(store.conversationState, SESSION_A, olderTurnId))
      .toMatchObject({ status: "completed" });
    expect(store.conversationApprovalState.approvals[APPROVAL_B]).toMatchObject({
      status: "resolved",
      authority: "historical",
    });
  });

  it("does not let a stale history-only fallback overwrite a newer live selection", async () => {
    const delayedHistory = new Deferred<ChatHistoryPageV6>();
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async (_context, sessionId) => {
      if (sessionId === SESSION_A) {
        throw new ChatClientError({
          schemaVersion: 6,
          code: "chat_protocol_error",
          retryable: false,
          recovery: "resync",
        });
      }
      return Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_B,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_B, null),
      });
    });
    const { client } = fakeClient({
      listSessions: async () => ({
        sessions: [
          Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" }),
          session(SESSION_B),
        ],
        nextCursor: null,
      }),
      subscribeSessionV6: subscribeV6,
      loadHistoryV6: async (_context, sessionId) => sessionId === SESSION_A
        ? delayedHistory.promise
        : historyV6(),
      resyncSessionV6: async (_context, sessionId) => projectionV6(
        sessionId,
        historyV6(),
        pendingApprovalSnapshotV6(HOST_GENERATION_B, null),
      ),
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    const selectA = store.selectSession(SESSION_A);
    await vi.waitFor(() => expect(subscribeV6).toHaveBeenCalledWith(CONTEXT, SESSION_A));
    const selectB = store.selectSession(SESSION_B);
    await selectB;
    delayedHistory.resolve(historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    ));
    await selectA;

    expect(store.selectedSessionId).toBe(SESSION_B);
    expect(store.selectedAccessMode).toBe("live");
    expect(store.phase).toBe("ready");
    expect(store.lastErrorCode).toBeNull();
  });

  it("does not let a newer control-plane observation get overwritten by a history-only refresh", async () => {
    const delayedRefresh = new Deferred<ChatHistoryPageV6>();
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    let historyCalls = 0;
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(async () => {
      historyCalls += 1;
      return historyCalls === 1 ? terminalHistory : delayedRefresh.promise;
    });
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "failed",
        issueCode: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      }),
      loadHistoryV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const refreshing = store.resyncSelected();
    await vi.waitFor(() => expect(loadHistoryV6).toHaveBeenCalledTimes(2));
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
    });
    delayedRefresh.resolve(terminalHistory);
    await refreshing;

    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.phase).toBe("ready");
    expect(store.controlPlane).toMatchObject({
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
    });
  });

  it("restores live authority when a fresh bound event reaches history-only mode", async () => {
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    let subscribeCalls = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 1) {
        throw new ChatClientError({
          schemaVersion: 6,
          code: "chat_protocol_error",
          retryable: false,
          recovery: "resync",
        });
      }
      return Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_A,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A, null),
      });
    });
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      subscribeSessionV6: subscribeV6,
      loadHistoryV6: async () => terminalHistory,
      resyncSessionV6: async (_context, sessionId) => projectionV6(
        sessionId,
        terminalHistory,
        pendingApprovalSnapshotV6(HOST_GENERATION_A, null),
      ),
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(store.selectedAccessMode).toBe("history-only");

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });

    await vi.waitFor(() => expect(store.selectedAccessMode).toBe("live"));
    expect(store.phase).toBe("ready");
    expect(subscribeV6).toHaveBeenCalledTimes(2);
    expect(store.canSend).toBe(true);
  });

  it("keeps verified history when an automatic live activation fails transiently", async () => {
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    let controlPlaneState: "failed" | "bound" = "failed";
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      throw new ChatClientError({
        schemaVersion: 6,
        code: "chat_temporarily_unavailable",
        retryable: true,
        recovery: "retry",
      });
    });
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => controlPlaneState === "failed"
        ? {
            sessionId,
            state: "failed",
            issueCode: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          }
        : {
            sessionId,
            state: "bound",
            issueCode: null,
            retryable: false,
            recovery: "none",
          },
      loadHistoryV6: async () => terminalHistory,
      subscribeSessionV6: subscribeV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const verifiedHistory = store.history;
    controlPlaneState = "bound";
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });

    await vi.waitFor(() => expect(subscribeV6).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(store.selectedAccessMode).toBe("history-only"));
    expect(store.history).toBe(verifiedHistory);
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A))
      .toMatchObject({ status: "completed" });
    expect(store.lastErrorCode).toBe("chat_temporarily_unavailable");
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);
    expect(store.canDecideApprovals).toBe(false);

    emitControlPlane({
      schemaVersion: 1,
      sequence: "2",
      sessionId: SESSION_A,
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
    });
    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.history).toBe(verifiedHistory);
  });

  it("does not leave history busy when live activation cancels a local history refresh", async () => {
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const delayedRefresh = new Deferred<ChatHistoryPageV6>();
    let historyCall = 0;
    let controlPlaneState: "failed" | "bound" = "failed";
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(async () => {
      historyCall += 1;
      return historyCall === 1 ? terminalHistory : delayedRefresh.promise;
    });
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      throw new ChatClientError({
        schemaVersion: 6,
        code: "chat_temporarily_unavailable",
        retryable: true,
        recovery: "retry",
      });
    });
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => controlPlaneState === "failed"
        ? {
            sessionId,
            state: "failed",
            issueCode: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          }
        : {
            sessionId,
            state: "bound",
            issueCode: null,
            retryable: false,
            recovery: "none",
          },
      loadHistoryV6,
      subscribeSessionV6: subscribeV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const refreshing = store.resyncSelected();
    await vi.waitFor(() => expect(loadHistoryV6).toHaveBeenCalledTimes(2));
    expect(store.phase).toBe("resyncing");
    controlPlaneState = "bound";
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });

    await vi.waitFor(() => expect(store.selectedAccessMode).toBe("history-only"));
    expect(store.phase).not.toBe("resyncing");
    expect(store.history).toBe(terminalHistory);
    delayedRefresh.resolve(terminalHistory);
    await refreshing;
  });

  it("ignores a stale activation GET when a newer bound event queues live activation", async () => {
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const staleActivation = new Deferred<ChatSessionControlPlane>();
    let controlPlaneCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => Object.freeze({
      subscriptionId: LOCAL_SUBSCRIPTION_A,
      pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A, null),
    }));
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneCall += 1;
        if (controlPlaneCall === 1) {
          return {
            sessionId,
            state: "failed",
            issueCode: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          };
        }
        if (controlPlaneCall === 2) return staleActivation.promise;
        return {
          sessionId,
          state: "bound",
          issueCode: null,
          retryable: false,
          recovery: "none",
        };
      },
      loadHistoryV6: async () => terminalHistory,
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: async (_context, sessionId) => projectionV6(
        sessionId,
        terminalHistory,
        pendingApprovalSnapshotV6(HOST_GENERATION_A, null),
      ),
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(controlPlaneCall).toBe(2));
    emitControlPlane({
      schemaVersion: 1,
      sequence: "2",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    staleActivation.resolve({
      sessionId: SESSION_A,
      state: "failed",
      issueCode: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    });

    await vi.waitFor(() => expect(store.selectedAccessMode).toBe("live"));
    expect(store.phase).toBe("ready");
    expect(store.controlPlane).toMatchObject({ state: "bound", issueCode: null });
    expect(subscribeV6).toHaveBeenCalledOnce();
    expect(controlPlaneCall).toBeGreaterThanOrEqual(3);
  });

  it("runs the queued live activation when the first subscribe falls back", async () => {
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const firstSubscription = new Deferred<Awaited<
      ReturnType<ChatClient["subscribeSessionV6"]>
    >>();
    let controlPlaneCall = 0;
    let subscribeCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      if (subscribeCall === 1) return firstSubscription.promise;
      return Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_B,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_B, null),
      });
    });
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneCall += 1;
        return controlPlaneCall === 1
          ? {
              sessionId,
              state: "failed",
              issueCode: "chat_protocol_error",
              retryable: false,
              recovery: "resync",
            }
          : {
              sessionId,
              state: "bound",
              issueCode: null,
              retryable: false,
              recovery: "none",
            };
      },
      loadHistoryV6: async () => terminalHistory,
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: async (_context, sessionId) => projectionV6(
        sessionId,
        terminalHistory,
        pendingApprovalSnapshotV6(HOST_GENERATION_B, null),
      ),
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(subscribeV6).toHaveBeenCalledOnce());
    emitControlPlane({
      schemaVersion: 1,
      sequence: "2",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    firstSubscription.reject(new ChatClientError({
      schemaVersion: 6,
      code: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    }));

    await vi.waitFor(() => expect(store.selectedAccessMode).toBe("live"));
    expect(store.phase).toBe("ready");
    expect(subscribeV6).toHaveBeenCalledTimes(2);
  });

  it("restores the terminal session summary when live activation is revoked after resync", async () => {
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const activeHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, false)]),
      Object.freeze([]),
    );
    let controlPlaneCall = 0;
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneCall += 1;
        if (controlPlaneCall === 1 || controlPlaneCall === 3) {
          return {
            sessionId,
            state: "failed",
            issueCode: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          };
        }
        return {
          sessionId,
          state: "bound",
          issueCode: null,
          retryable: false,
          recovery: "none",
        };
      },
      loadHistoryV6: async () => terminalHistory,
      resyncSessionV6: async (_context, sessionId) => projectionV6(
        sessionId,
        activeHistory,
        pendingApprovalSnapshotV6(HOST_GENERATION_A, null),
      ),
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });

    await vi.waitFor(() => expect(store.selectedAccessMode).toBe("history-only"));
    expect(store.sessions.find((session) => session.sessionId === SESSION_A)?.latestTurnStatus)
      .toBe("completed");
    await store.resyncSelected();
    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.phase).toBe("ready");
  });

  it("preserves pending cleanup authority while refreshing history-only content", async () => {
    const pending = Object.freeze({
      operationId: "019c1a00-0000-7000-8000-000000000070",
      desktopState: "pending" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    });
    const getCleanupStatus = vi.fn<ChatClient["getCleanupStatus"]>(async () => pending);
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "failed",
        issueCode: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      }),
      loadHistoryV6: async () => terminalHistory,
      deleteSession: async () => pending,
      getCleanupStatus,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await expect(store.deleteSelected()).resolves.toMatchObject({ kind: "cleanup_pending" });

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await Promise.resolve();
    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.cleanupStatus).toEqual(pending);

    await store.resyncSelected();

    expect(store.cleanupStatus).toEqual(pending);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getCleanupStatus).toHaveBeenCalledWith(CONTEXT, pending.operationId);
    expect(store.cleanupStatus).toEqual(pending);
  });

  it("keeps history closed to activation and mutations while delete is in flight", async () => {
    const pending = Object.freeze({
      operationId: "019c1a00-0000-7000-8000-000000000071",
      desktopState: "pending" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    });
    const deleteResult = new Deferred<typeof pending>();
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>();
    const renameSession = vi.fn<ChatClient["renameSession"]>();
    const setSessionPinned = vi.fn<ChatClient["setSessionPinned"]>();
    const interruptTurn = vi.fn<ChatClient["interruptTurn"]>();
    const requestLocalRecovery = vi.fn<ChatClient["requestLocalRecovery"]>();
    const deleteSession = vi.fn<ChatClient["deleteSession"]>(() => deleteResult.promise);
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "failed",
        issueCode: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      }),
      loadHistoryV6: async () => terminalHistory,
      subscribeSessionV6: subscribeV6,
      deleteSession,
      renameSession,
      setSessionPinned,
      interruptTurn,
      requestLocalRecovery,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const deleting = store.deleteSelected();
    await vi.waitFor(() => expect(deleteSession).toHaveBeenCalledOnce());
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });

    await store.selectSession(SESSION_A);
    await store.renameSelected("renamed");
    await store.setSelectedPinned(true);
    await expect(store.interruptSelected()).resolves.toBe(false);
    await store.requestLocalRecovery();
    await store.resyncSelected();
    expect(store.selectedAccessMode).toBe("history-only");
    expect(store.history).toBe(terminalHistory);
    expect(subscribeV6).not.toHaveBeenCalled();
    expect(renameSession).not.toHaveBeenCalled();
    expect(setSessionPinned).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(requestLocalRecovery).not.toHaveBeenCalled();

    deleteResult.resolve(pending);
    await expect(deleting).resolves.toMatchObject({ kind: "cleanup_pending" });
    expect(store.cleanupStatus).toEqual(pending);
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);
    expect(store.canDecideApprovals).toBe(false);
  });

  it("cancels an activation that was already in flight when cleanup begins", async () => {
    const pending = Object.freeze({
      operationId: "019c1a00-0000-7000-8000-000000000077",
      desktopState: "pending" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    });
    const terminalHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    );
    const pendingSubscription = new Deferred<Awaited<
      ReturnType<ChatClient["subscribeSessionV6"]>
    >>();
    let controlPlaneCall = 0;
    const subscribeSessionV6 = vi.fn<ChatClient["subscribeSessionV6"]>(
      () => pendingSubscription.promise,
    );
    const resyncSessionV6 = vi.fn<ChatClient["resyncSessionV6"]>();
    const unsubscribeSession = vi.fn<ChatClient["unsubscribeSession"]>(async () => true);
    const { client, emitControlPlane } = fakeClient({
      listSessions: async () => ({
        sessions: [Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" })],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneCall += 1;
        return controlPlaneCall === 1
          ? {
              sessionId,
              state: "failed",
              issueCode: "chat_protocol_error",
              retryable: false,
              recovery: "resync",
            }
          : {
              sessionId,
              state: "bound",
              issueCode: null,
              retryable: false,
              recovery: "none",
            };
      },
      loadHistoryV6: async () => terminalHistory,
      subscribeSessionV6,
      resyncSessionV6,
      unsubscribeSession,
      deleteSession: async () => pending,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(subscribeSessionV6).toHaveBeenCalledOnce());
    await store.deleteSelected();
    pendingSubscription.resolve(Object.freeze({
      subscriptionId: LOCAL_SUBSCRIPTION_A,
      pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A, null),
    }));

    await vi.waitFor(() => expect(store.selectedAccessMode).toBe("history-only"));
    expect(store.phase).toBe("ready");
    expect(store.lastErrorCode).toBeNull();
    expect(store.cleanupStatus).toEqual(pending);
    expect(resyncSessionV6).not.toHaveBeenCalled();
    expect(unsubscribeSession).toHaveBeenCalledWith(CONTEXT, LOCAL_SUBSCRIPTION_A);
  });

  it("does not let an older live resync erase a newer pending cleanup", async () => {
    const pending = Object.freeze({
      operationId: "019c1a00-0000-7000-8000-000000000072",
      desktopState: "pending" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    });
    const delayedResync = new Deferred<ChatResyncProjectionV6>();
    let resyncCall = 0;
    const resyncSessionV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) => {
      resyncCall += 1;
      return resyncCall === 1 ? projectionV6(sessionId) : delayedResync.promise;
    });
    const getCleanupStatus = vi.fn<ChatClient["getCleanupStatus"]>(async () => pending);
    const removeAttachment = vi.fn<ChatClient["removeAttachment"]>();
    const unsubscribeSession = vi.fn<ChatClient["unsubscribeSession"]>(async () => true);
    const releaseEventListener = vi.fn();
    const { client } = fakeClient({
      resyncSessionV6,
      deleteSession: async () => pending,
      getCleanupStatus,
      removeAttachment,
      unsubscribeSession,
      onEventV6: async () => releaseEventListener,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const resyncing = store.resyncSelected();
    await vi.waitFor(() => expect(resyncSessionV6).toHaveBeenCalledTimes(2));
    await expect(store.deleteSelected()).resolves.toMatchObject({ kind: "cleanup_pending" });
    expect(store.cleanupStatus).toEqual(pending);

    delayedResync.resolve(projectionV6(SESSION_A));
    await resyncing;

    expect(store.cleanupStatus).toEqual(pending);
    expect(store.canSend).toBe(false);
    expect(releaseEventListener).toHaveBeenCalledOnce();
    expect(unsubscribeSession).toHaveBeenCalledTimes(2);
    expect(unsubscribeSession).toHaveBeenLastCalledWith(CONTEXT, LOCAL_SUBSCRIPTION_A);
    store.draftAttachments = Object.freeze([attachment()]);
    await store.removeDraftAttachment(attachment().attachmentId);
    await store.resyncSelected();
    expect(removeAttachment).not.toHaveBeenCalled();
    expect(resyncSessionV6).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getCleanupStatus).toHaveBeenCalledWith(CONTEXT, pending.operationId);
  });

  it("does not let stale pending cleanup overwrite a newer retry-limit status", async () => {
    const operationId = "019c1a00-0000-7000-8000-000000000075";
    const stalePending = Object.freeze({
      operationId,
      desktopState: "pending" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    });
    const retryLimit = Object.freeze({
      ...stalePending,
      outcomeCode: "retry_limit_exceeded",
      lastErrorCode: "chat_cleanup_incomplete",
    });
    const delayedResync = new Deferred<ChatResyncProjectionV6>();
    let resyncCall = 0;
    const resyncSessionV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) => {
      resyncCall += 1;
      return resyncCall === 1 ? projectionV6(sessionId) : delayedResync.promise;
    });
    let deleteCall = 0;
    const deleteSession = vi.fn<ChatClient["deleteSession"]>(async () => {
      deleteCall += 1;
      return deleteCall === 1 ? retryLimit : stalePending;
    });
    const { client } = fakeClient({ resyncSessionV6, deleteSession });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const resyncing = store.resyncSelected();
    await vi.waitFor(() => expect(resyncSessionV6).toHaveBeenCalledTimes(2));
    await store.deleteSelected();
    expect(store.cleanupStatus).toEqual(retryLimit);

    delayedResync.resolve(Object.freeze({
      ...projectionV6(SESSION_A),
      cleanup: stalePending,
    }));
    await resyncing;

    expect(store.cleanupStatus).toEqual(retryLimit);
    await store.deleteSelected();
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(store.cleanupStatus).toEqual(stalePending);
  });

  it("rejects a pre-resume cleanup observation after retry starts a new generation", async () => {
    const cleanupOperationId = "019c1a00-0000-7000-8000-000000000078";
    const pending = Object.freeze({
      operationId: cleanupOperationId,
      desktopState: "pending" as const,
      hostState: "pending" as const,
      runtimeState: "pending" as const,
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    });
    const retryLimit = Object.freeze({
      ...pending,
      desktopState: "complete" as const,
      hostState: "incomplete" as const,
      runtimeState: "incomplete" as const,
      outcomeCode: "retry_limit_exceeded",
      lastErrorCode: "chat_cleanup_incomplete",
    });
    const staleObservation = new Deferred<typeof retryLimit | null>();
    let deleteCall = 0;
    const deleteSession = vi.fn<ChatClient["deleteSession"]>(async () => {
      deleteCall += 1;
      return deleteCall === 1 ? retryLimit : pending;
    });
    let cleanupRead = 0;
    const getCleanupStatus = vi.fn<ChatClient["getCleanupStatus"]>(() => {
      cleanupRead += 1;
      return cleanupRead === 1 ? staleObservation.promise : Promise.resolve(pending);
    });
    const store = createV6Store(fakeClient({ deleteSession, getCleanupStatus }).client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await expect(store.deleteSelected()).resolves.toMatchObject({ kind: "cleanup_pending" });
    expect(store.cleanupStatus).toEqual(retryLimit);

    const staleRefresh = store.refreshSelectedCleanup();
    await vi.waitFor(() => expect(getCleanupStatus).toHaveBeenCalledOnce());
    await expect(store.deleteSelected()).resolves.toMatchObject({ kind: "cleanup_pending" });
    expect(store.cleanupStatus).toEqual(pending);

    staleObservation.resolve(retryLimit);
    await staleRefresh;
    expect(store.cleanupStatus).toEqual(pending);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(getCleanupStatus).toHaveBeenCalledTimes(2);
    expect(store.cleanupStatus).toEqual(pending);
  });

  it("clears the previous draft before a non-bound session control plane returns", async () => {
    const listDraftAttachments = vi.fn<ChatClient["listDraftAttachments"]>(
      async (_context, target) => target.type === "new" ? [attachment()] : [],
    );
    const { client } = fakeClient({
      listDraftAttachments,
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "retry_wait",
        issueCode: "chat_temporarily_unavailable",
        retryable: true,
        recovery: "retry",
      }),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    expect(store.draftTarget).toEqual(CHAT_NEW_DRAFT_TARGET);
    expect(store.draftAttachments).toHaveLength(1);

    await store.selectSession(SESSION_B);

    expect(store.selectedSessionId).toBe(SESSION_B);
    expect(store.selectedAccessMode).toBeNull();
    expect(store.draftTarget).toBeNull();
    expect(store.draftAttachments).toEqual([]);
    expect(listDraftAttachments.mock.calls.some(([, target]) =>
      target.type === "session" && target.sessionId === SESSION_B
    )).toBe(false);
  });

  it("does not hide a stale Host failure while local v6 history is still active", async () => {
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      throw new ChatClientError({
        schemaVersion: 6,
        code: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      });
    });
    const { client } = fakeClient({
      listSessions: async () => ({
        sessions: [
          Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" }),
          session(SESSION_B),
        ],
        nextCursor: null,
      }),
      subscribeSessionV6: subscribeV6,
      loadHistoryV6: async () => historyV6(),
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(store.selectedAccessMode).toBeNull();
    expect(store.phase).toBe("resync-required");
    expect(store.lastErrorCode).toBe("chat_protocol_error");
    expect(store.history).toBeNull();
  });

  it("does not treat a local response-decoder failure as a stale Host session", async () => {
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      throw new ChatClientError({
        schemaVersion: 1,
        code: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      });
    });
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(async () => historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    ));
    const { client } = fakeClient({
      listSessions: async () => ({
        sessions: [
          Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" }),
          session(SESSION_B),
        ],
        nextCursor: null,
      }),
      subscribeSessionV6: subscribeV6,
      loadHistoryV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(loadHistoryV6).not.toHaveBeenCalled();
    expect(store.selectedAccessMode).toBeNull();
    expect(store.phase).toBe("resync-required");
    expect(store.lastErrorCode).toBe("chat_protocol_error");
  });

  it.each([
    { label: "retryable failure", retryable: true, recovery: "resync" as const },
    { label: "non-resync recovery", retryable: false, recovery: "retry" as const },
  ])("keeps direct control-plane $label closed", async ({ retryable, recovery }) => {
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(async () => historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    ));
    const { client } = fakeClient({
      listSessions: async () => ({
        sessions: [
          Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" }),
          session(SESSION_B),
        ],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "failed",
        issueCode: "chat_protocol_error",
        retryable,
        recovery,
      }),
      loadHistoryV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(loadHistoryV6).not.toHaveBeenCalled();
    expect(store.selectedAccessMode).toBeNull();
    expect(store.phase).toBe("resync-required");
    expect(store.lastErrorCode).toBe("chat_protocol_error");
  });

  it.each([
    { label: "missing terminal summary", latestTurnStatus: null, emptyHistory: false },
    { label: "active summary", latestTurnStatus: "streaming" as const, emptyHistory: false },
    { label: "mismatched terminal summary", latestTurnStatus: "failed" as const, emptyHistory: false },
    { label: "empty terminal history", latestTurnStatus: "completed" as const, emptyHistory: true },
  ])("keeps direct control-plane failures closed for $label", async ({
    latestTurnStatus,
    emptyHistory,
  }) => {
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(async () => historyV6(
      emptyHistory
        ? Object.freeze([])
        : Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([]),
    ));
    const { client } = fakeClient({
      listSessions: async () => ({
        sessions: [
          Object.freeze({ ...session(SESSION_A), latestTurnStatus }),
          session(SESSION_B),
        ],
        nextCursor: null,
      }),
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "failed",
        issueCode: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      }),
      loadHistoryV6,
    });
    const store = createV6Store(client);

    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(loadHistoryV6).toHaveBeenCalledOnce();
    expect(store.selectedAccessMode).toBeNull();
    expect(store.phase).toBe("resync-required");
    expect(store.lastErrorCode).toBe("chat_protocol_error");
    expect(store.history).toBeNull();
  });

  it("keeps authority revoked and reconciles once when approval is requested after the subscribe snapshot", async () => {
    const firstResync = new Deferred<ChatResyncProjectionV6>();
    const secondResync = new Deferred<ChatResyncProjectionV6>();
    let subscribeCall = 0;
    let resyncCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      return Object.freeze({
        subscriptionId: subscribeCall === 1 ? LOCAL_SUBSCRIPTION_A : LOCAL_SUBSCRIPTION_B,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(
          subscribeCall === 1 ? HOST_GENERATION_A : HOST_GENERATION_B,
          subscribeCall === 1 ? null : approvalProjectionV6(),
        ),
      });
    });
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(() => {
      resyncCall += 1;
      return resyncCall === 1 ? firstResync.promise : secondResync.promise;
    });
    const { client, emitV6 } = fakeClient({
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);

    const selecting = store.selectSession(SESSION_A);
    await vi.waitFor(() => expect(resyncV6).toHaveBeenCalledTimes(1));
    emitV6(approvalEventV6());
    firstResync.resolve(projectionV6(
      SESSION_A,
      historyV6(),
      pendingApprovalSnapshotV6(HOST_GENERATION_A, null),
    ));
    await selecting;
    await vi.waitFor(() => expect(resyncV6).toHaveBeenCalledTimes(2));

    expect(store.conversationApprovalState.reconciliation).toBe("required");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]?.authority)
      .toBe("historical");
    expect(subscribeV6).toHaveBeenCalledTimes(2);

    secondResync.resolve(projectionV6(
      SESSION_A,
      historyV6(),
      pendingApprovalSnapshotV6(HOST_GENERATION_B, null),
    ));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(store.conversationApprovalState.reconciliation).toBe("synchronized");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "pending",
      authority: "actionable",
      authorityStreamId: HOST_GENERATION_B,
    });
    expect(subscribeV6).toHaveBeenCalledTimes(2);
    expect(resyncV6).toHaveBeenCalledTimes(2);
  });

  it("does not apply a stale pending snapshot when resolution races the first history resync", async () => {
    const firstResync = new Deferred<ChatResyncProjectionV6>();
    const secondResync = new Deferred<ChatResyncProjectionV6>();
    let subscribeCall = 0;
    let resyncCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      return Object.freeze({
        subscriptionId: subscribeCall === 1 ? LOCAL_SUBSCRIPTION_A : LOCAL_SUBSCRIPTION_B,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(
          subscribeCall === 1 ? HOST_GENERATION_A : HOST_GENERATION_B,
          subscribeCall === 1 ? approvalProjectionV6() : null,
        ),
      });
    });
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(() => {
      resyncCall += 1;
      return resyncCall === 1 ? firstResync.promise : secondResync.promise;
    });
    const { client, emitV6 } = fakeClient({
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);

    const selecting = store.selectSession(SESSION_A);
    await vi.waitFor(() => expect(resyncV6).toHaveBeenCalledTimes(1));
    const resolved = acceptedApprovalProjectionV6();
    emitV6(approvalEventV6(resolved));
    const resolvedHistory = historyV6(
      Object.freeze([commandTurnV6(TURN_A, COMMAND_A, true)]),
      Object.freeze([approvalProjectionV6(), resolved]),
      null,
      "42",
    );
    firstResync.resolve(projectionV6(
      SESSION_A,
      resolvedHistory,
      pendingApprovalSnapshotV6(HOST_GENERATION_A),
    ));
    await selecting;
    await vi.waitFor(() => expect(resyncV6).toHaveBeenCalledTimes(2));

    expect(store.conversationApprovalState.reconciliation).toBe("required");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "resolved",
      authority: "historical",
      outcome: "accepted_once",
    });
    expect(store.lastErrorCode).not.toBe("chat_protocol_error");

    secondResync.resolve(projectionV6(
      SESSION_A,
      resolvedHistory,
      pendingApprovalSnapshotV6(HOST_GENERATION_B, null),
    ));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(store.conversationApprovalState.reconciliation).toBe("synchronized");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "resolved",
      authority: "historical",
      outcome: "accepted_once",
    });
    expect(subscribeV6).toHaveBeenCalledTimes(2);
    expect(resyncV6).toHaveBeenCalledTimes(2);
  });

  it("keeps a fresh local task binding-pending and activates v6 exactly once after Host identity binds", async () => {
    let bindingState: ChatSessionControlPlane["state"] = "binding_pending";
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => Object.freeze({
      subscriptionId: LOCAL_SUBSCRIPTION_A,
      pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
    }));
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) =>
      projectionV6(sessionId));
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: bindingState,
        issueCode: null,
        retryable: false,
        recovery: "none",
      }),
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);

    const accepted = await store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "Inspect the repository",
    );
    expect(accepted.status).toBe("local_durable_accepted");
    await vi.waitFor(() => expect(store.phase).toBe("binding-pending"));
    expect(store.lastErrorCode).not.toBe("chat_resource_not_found");
    expect(subscribeV6).not.toHaveBeenCalled();
    expect(resyncV6).not.toHaveBeenCalled();

    bindingState = "bound";
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(resyncV6).toHaveBeenCalledTimes(1);

    emitControlPlane({
      schemaVersion: 1,
      sequence: "2",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await Promise.resolve();
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(resyncV6).toHaveBeenCalledTimes(1);
  });

  it("does not lose a live bound edge behind the fresh-create control-plane GET", async () => {
    const staleInitialRead = new Deferred<ChatSessionControlPlane>();
    const initialReadStarted = new Deferred<void>();
    let controlPlaneReads = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => Object.freeze({
      subscriptionId: LOCAL_SUBSCRIPTION_A,
      pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
    }));
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) =>
      projectionV6(sessionId));
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneReads += 1;
        if (controlPlaneReads === 1) {
          initialReadStarted.resolve();
          return staleInitialRead.promise;
        }
        return {
          sessionId,
          state: "bound" as const,
          issueCode: null,
          retryable: false,
          recovery: "none" as const,
        };
      },
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);

    const creating = store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "Inspect the repository",
    );
    await initialReadStarted.promise;
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(controlPlaneReads).toBe(3);
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(resyncV6).toHaveBeenCalledTimes(1);

    staleInitialRead.resolve({
      sessionId: SESSION_A,
      state: "binding_pending",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await creating;
    expect(store.phase).toBe("ready");
    expect(store.controlPlane?.state).toBe("bound");
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(resyncV6).toHaveBeenCalledTimes(1);
  });

  it("does not let an older control-plane GET overwrite a newer live bound observation", async () => {
    const staleRefresh = new Deferred<ChatSessionControlPlane>();
    const refreshStarted = new Deferred<void>();
    let controlPlaneReads = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => Object.freeze({
      subscriptionId: LOCAL_SUBSCRIPTION_A,
      pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
    }));
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) =>
      projectionV6(sessionId));
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneReads += 1;
        if (controlPlaneReads === 2) {
          refreshStarted.resolve();
          return staleRefresh.promise;
        }
        return {
          sessionId,
          state: "bound" as const,
          issueCode: null,
          retryable: false,
          recovery: "none" as const,
        };
      },
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);

    const selecting = store.selectSession(SESSION_A);
    await refreshStarted.promise;
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    staleRefresh.resolve({
      sessionId: SESSION_B,
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
    });
    await selecting;

    expect(store.phase).toBe("ready");
    expect(store.controlPlane?.state).toBe("bound");
    expect(store.lastErrorCode).not.toBe("chat_temporarily_unavailable");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]?.authority).toBe("actionable");
    expect(controlPlaneReads).toBe(2);
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(resyncV6).toHaveBeenCalledTimes(1);
  });

  it("does not let an older failed GET overwrite a newer live bound observation", async () => {
    const staleRefresh = new Deferred<ChatSessionControlPlane>();
    const refreshStarted = new Deferred<void>();
    let controlPlaneReads = 0;
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneReads += 1;
        if (controlPlaneReads === 2) {
          refreshStarted.resolve();
          return staleRefresh.promise;
        }
        return {
          sessionId,
          state: "bound" as const,
          issueCode: null,
          retryable: false,
          recovery: "none" as const,
        };
      },
      subscribeSessionV6: async () => Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_A,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
      }),
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);

    const selecting = store.selectSession(SESSION_A);
    await refreshStarted.promise;
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    staleRefresh.reject(new Error("older read unavailable"));
    await selecting;

    expect(store.phase).toBe("ready");
    expect(store.controlPlane?.state).toBe("bound");
    expect(store.lastErrorCode).toBeNull();
    expect(store.conversationApprovalState.approvals[APPROVAL_A]?.authority).toBe("actionable");
    expect(controlPlaneReads).toBe(2);
  });

  it("rejects a foreign-session control-plane GET before callers can use its state", async () => {
    let controlPlaneReads = 0;
    const unsubscribeSession = vi.fn<ChatClient["unsubscribeSession"]>(async () => true);
    const { client } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneReads += 1;
        return {
          sessionId: controlPlaneReads === 1 ? sessionId : SESSION_B,
          state: "bound" as const,
          issueCode: null,
          retryable: false,
          recovery: "none" as const,
        };
      },
      subscribeSessionV6: async () => Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_A,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
      }),
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
      unsubscribeSession,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(store.phase).toBe("resync-required");
    expect(store.controlPlane?.sessionId).toBe(SESSION_A);
    expect(store.lastErrorCode).toBe("chat_protocol_error");
    expect(controlPlaneReads).toBe(2);
    expect(unsubscribeSession).toHaveBeenCalledWith(CONTEXT, LOCAL_SUBSCRIPTION_A);
  });

  it("uses one live-driven trailing GET when a newer no-subscription gap supersedes the first", async () => {
    const gapRead = new Deferred<ChatSessionControlPlane>();
    const gapReadStarted = new Deferred<void>();
    let controlPlaneReads = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => Object.freeze({
      subscriptionId: LOCAL_SUBSCRIPTION_A,
      pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
    }));
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) =>
      projectionV6(sessionId));
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneReads += 1;
        if (controlPlaneReads === 1) {
          return {
            sessionId,
            state: "binding_pending" as const,
            issueCode: null,
            retryable: false,
            recovery: "none" as const,
          };
        }
        if (controlPlaneReads === 2) {
          gapReadStarted.resolve();
          return gapRead.promise;
        }
        return {
          sessionId,
          state: "bound" as const,
          issueCode: null,
          retryable: false,
          recovery: "none" as const,
        };
      },
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "Inspect the repository",
    );
    await vi.waitFor(() => expect(store.phase).toBe("binding-pending"));

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_B,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    emitControlPlane({
      schemaVersion: 1,
      sequence: "3",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    emitControlPlane({
      schemaVersion: 1,
      sequence: "5",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await gapReadStarted.promise;
    expect(controlPlaneReads).toBe(2);
    expect(subscribeV6).not.toHaveBeenCalled();

    gapRead.resolve({
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    // Initial binding read + first gap read + one live-driven trailing gap
    // read + the normal activation entry/final authority reads.
    expect(controlPlaneReads).toBe(5);
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(resyncV6).toHaveBeenCalledTimes(1);
  });

  it("does not turn a no-subscription gap GET into a trailing activation retry", async () => {
    let bindingState: ChatSessionControlPlane["state"] = "binding_pending";
    const firstSubscription = new Deferred<Awaited<
      ReturnType<ChatClient["subscribeSessionV6"]>
    >>();
    let subscribeCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      if (subscribeCall === 1) return firstSubscription.promise;
      return Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_B,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_B),
      });
    });
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) =>
      projectionV6(sessionId));
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: bindingState,
        issueCode: null,
        retryable: false,
        recovery: "none",
      }),
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "Inspect the repository",
    );
    await vi.waitFor(() => expect(store.phase).toBe("binding-pending"));

    bindingState = "bound";
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(subscribeV6).toHaveBeenCalledTimes(1));

    emitControlPlane({
      schemaVersion: 1,
      sequence: "3",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    for (let index = 0; index < 32; index += 1) await Promise.resolve();
    firstSubscription.reject(new Error("subscription unavailable"));
    await vi.waitFor(() => expect(store.lastErrorCode).toBe("chat_protocol_error"));
    for (let index = 0; index < 32; index += 1) await Promise.resolve();
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(resyncV6).not.toHaveBeenCalled();

    await store.resyncSelected();
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(subscribeV6).toHaveBeenCalledTimes(2);
    expect(resyncV6).toHaveBeenCalledTimes(1);
  });

  it("does not bypass an unresolved no-subscription gap with a cached bound state", async () => {
    const failedGapRead = new Deferred<ChatSessionControlPlane>();
    const gapReadStarted = new Deferred<void>();
    let controlPlaneReads = 0;
    let subscribeCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      if (subscribeCall === 1) throw new Error("first activation unavailable");
      return Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_A,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
      });
    });
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) =>
      projectionV6(sessionId));
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => {
        controlPlaneReads += 1;
        if (controlPlaneReads === 1) {
          return {
            sessionId,
            state: "binding_pending" as const,
            issueCode: null,
            retryable: false,
            recovery: "none" as const,
          };
        }
        if (controlPlaneReads === 3) {
          gapReadStarted.resolve();
          return failedGapRead.promise;
        }
        return {
          sessionId,
          state: "bound" as const,
          issueCode: null,
          retryable: false,
          recovery: "none" as const,
        };
      },
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "Inspect the repository",
    );
    await vi.waitFor(() => expect(store.phase).toBe("binding-pending"));

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(subscribeV6).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.lastErrorCode).toBe("chat_protocol_error"));
    expect(store.controlPlane?.state).toBe("bound");

    emitControlPlane({
      schemaVersion: 1,
      sequence: "3",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await gapReadStarted.promise;
    const duringGap = store.resyncSelected();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(subscribeV6).toHaveBeenCalledTimes(1);

    failedGapRead.reject(new Error("gap read unavailable"));
    await duringGap;
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(controlPlaneReads).toBe(3);

    await store.resyncSelected();
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(controlPlaneReads).toBe(6);
    expect(subscribeV6).toHaveBeenCalledTimes(2);
    expect(resyncV6).toHaveBeenCalledTimes(1);
  });

  it("does not retry or activate stale selection after a no-subscription gap GET", async () => {
    const failedGapRead = new Deferred<ChatSessionControlPlane>();
    let sessionAReads = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async (_context, sessionId) =>
      Object.freeze({
        subscriptionId: sessionId === SESSION_A
          ? LOCAL_SUBSCRIPTION_A
          : LOCAL_SUBSCRIPTION_B,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
      }));
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => {
        if (sessionId === SESSION_A) {
          sessionAReads += 1;
          if (sessionAReads === 1) {
            return {
              sessionId,
              state: "binding_pending" as const,
              issueCode: null,
              retryable: false,
              recovery: "none" as const,
            };
          }
          return failedGapRead.promise;
        }
        return {
          sessionId,
          state: "bound" as const,
          issueCode: null,
          retryable: false,
          recovery: "none" as const,
        };
      },
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "Inspect the repository",
    );
    await vi.waitFor(() => expect(store.phase).toBe("binding-pending"));

    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_B,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    emitControlPlane({
      schemaVersion: 1,
      sequence: "3",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(sessionAReads).toBe(2));
    await store.selectSession(SESSION_B);
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(subscribeV6).toHaveBeenLastCalledWith(CONTEXT, SESSION_B);

    failedGapRead.reject(new Error("control-plane unavailable"));
    for (let index = 0; index < 32; index += 1) await Promise.resolve();
    expect(sessionAReads).toBe(2);
    expect(subscribeV6).toHaveBeenCalledTimes(1);
    expect(store.selectedSessionId).toBe(SESSION_B);
    expect(store.phase).toBe("ready");
  });

  it.each([
    ["failed", "chat_temporarily_unavailable", "resync", "resync-required", false],
    ["denied", "chat_capability_denied", "none", "permission-denied", false],
    ["blocked_auth", "chat_unauthenticated", "sign_in", "signed-out", false],
    ["retry_wait", "chat_temporarily_unavailable", "retry", "unavailable", true],
  ] as const)(
    "maps a live %s binding projection to a safe phase and explicit retry authority",
    async (state, issueCode, recovery, expectedPhase, retainsRetryAuthority) => {
      let bindingState: ChatSessionControlPlane["state"] = "binding_pending";
      const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_A,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
      }));
      const { client, emitControlPlane } = fakeClient({
        getSessionControlPlane: async (_context, sessionId) => ({
          sessionId,
          state: bindingState,
          issueCode: null,
          retryable: false,
          recovery: "none",
        }),
        subscribeSessionV6: subscribeV6,
        resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
      });
      const store = createV6Store(client);
      await store.bind(TENANT);
      await store.createSessionWithResult(
        "019c1a00-0000-7000-8000-000000000009",
        "Inspect the repository",
      );
      await vi.waitFor(() => expect(store.phase).toBe("binding-pending"));

      emitControlPlane({
        schemaVersion: 1,
        sequence: "1",
        sessionId: SESSION_A,
        state,
        issueCode,
        retryable: state === "retry_wait",
        recovery,
      });
      expect(store.phase).toBe(expectedPhase);
      expect(store.lastErrorCode).toBe(issueCode);
      expect(subscribeV6).not.toHaveBeenCalled();

      bindingState = "bound";
      emitControlPlane({
        schemaVersion: 1,
        sequence: "2",
        sessionId: SESSION_A,
        state: "bound",
        issueCode: null,
        retryable: false,
        recovery: "none",
      });
      if (retainsRetryAuthority) {
        await vi.waitFor(() => expect(store.phase).toBe("ready"));
        expect(subscribeV6).toHaveBeenCalledTimes(1);
      } else {
        for (let index = 0; index < 32; index += 1) await Promise.resolve();
        expect(subscribeV6).not.toHaveBeenCalled();
        expect(store.phase).toBe(expectedPhase);
      }
    },
  );

  it("keeps live pending and binding-pending projections non-actionable without polling", async () => {
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>();
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: "binding_pending",
        issueCode: null,
        retryable: false,
        recovery: "none",
      }),
      subscribeSessionV6: subscribeV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "Inspect the repository",
    );
    await vi.waitFor(() => expect(store.phase).toBe("binding-pending"));
    for (const [sequence, state] of [["1", "pending"], ["2", "binding_pending"]] as const) {
      emitControlPlane({
        schemaVersion: 1,
        sequence,
        sessionId: SESSION_A,
        state,
        issueCode: null,
        retryable: false,
        recovery: "none",
      });
      expect(store.phase).toBe("binding-pending");
    }
    expect(subscribeV6).not.toHaveBeenCalled();
  });

  it("retains binding authority after a transient activation failure and retries only on explicit resync", async () => {
    let bindingState: ChatSessionControlPlane["state"] = "binding_pending";
    let subscribeCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      if (subscribeCall === 1) throw new Error("transient activation failure");
      return Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_A,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
      });
    });
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) =>
      projectionV6(sessionId));
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: bindingState,
        issueCode: null,
        retryable: false,
        recovery: "none",
      }),
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "Inspect the repository",
    );
    await vi.waitFor(() => expect(store.phase).toBe("binding-pending"));

    bindingState = "bound";
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(subscribeV6).toHaveBeenCalledTimes(1));
    expect(resyncV6).not.toHaveBeenCalled();
    for (let index = 0; index < 32; index += 1) await Promise.resolve();
    expect(subscribeV6).toHaveBeenCalledTimes(1);

    await store.resyncSelected();
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(subscribeV6).toHaveBeenCalledTimes(2);
    expect(resyncV6).toHaveBeenCalledTimes(1);
  });

  it("runs one trailing activation for a live bound event that supersedes an in-flight activation", async () => {
    let bindingState: ChatSessionControlPlane["state"] = "binding_pending";
    const firstSubscription = new Deferred<Awaited<
      ReturnType<ChatClient["subscribeSessionV6"]>
    >>();
    let subscribeCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      if (subscribeCall === 1) return firstSubscription.promise;
      return Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_B,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_B),
      });
    });
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => ({
        sessionId,
        state: bindingState,
        issueCode: bindingState === "retry_wait"
          ? "chat_temporarily_unavailable" as const
          : null,
        retryable: bindingState === "retry_wait",
        recovery: bindingState === "retry_wait" ? "retry" as const : "none" as const,
      }),
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.createSessionWithResult(
      "019c1a00-0000-7000-8000-000000000009",
      "Inspect the repository",
    );
    await vi.waitFor(() => expect(store.phase).toBe("binding-pending"));

    bindingState = "bound";
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(subscribeV6).toHaveBeenCalledTimes(1));

    bindingState = "retry_wait";
    emitControlPlane({
      schemaVersion: 1,
      sequence: "2",
      sessionId: SESSION_A,
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
    });
    expect(store.phase).toBe("unavailable");
    bindingState = "bound";
    emitControlPlane({
      schemaVersion: 1,
      sequence: "3",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    expect(subscribeV6).toHaveBeenCalledTimes(1);

    firstSubscription.resolve(Object.freeze({
      subscriptionId: LOCAL_SUBSCRIPTION_A,
      pendingApprovalSnapshot: pendingApprovalSnapshotV6(HOST_GENERATION_A),
    }));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(subscribeV6).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 32; index += 1) await Promise.resolve();
    expect(subscribeV6).toHaveBeenCalledTimes(2);
  });

  it("uses a full v6 resubscribe and resync to restore authority after a global control-plane gap", async () => {
    let subscribeCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      return Object.freeze({
        subscriptionId: subscribeCall === 1 ? LOCAL_SUBSCRIPTION_A : LOCAL_SUBSCRIPTION_B,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(
          subscribeCall === 1 ? HOST_GENERATION_A : HOST_GENERATION_B,
        ),
      });
    });
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) =>
      projectionV6(sessionId));
    const { client, emitControlPlane } = fakeClient({
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_B,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    emitControlPlane({
      schemaVersion: 1,
      sequence: "3",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(resyncV6).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(subscribeV6).toHaveBeenCalledTimes(2);
    expect(store.conversationApprovalState.reconciliation).toBe("synchronized");
  });

  it("keeps gap recovery non-actionable until a fresh control-plane GET confirms bound", async () => {
    const delayedControlPlane = new Deferred<ChatSessionControlPlane>();
    const gapReadStarted = new Deferred<void>();
    let delayGapRead = false;
    let gapReadConsumed = false;
    let subscribeCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      return Object.freeze({
        subscriptionId: [
          LOCAL_SUBSCRIPTION_A,
          LOCAL_SUBSCRIPTION_B,
          "019c1a00-0000-7000-8000-00000000000c",
        ][subscribeCall - 1]!,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(
          subscribeCall === 1 ? HOST_GENERATION_A : HOST_GENERATION_B,
        ),
      });
    });
    const { client, emitControlPlane } = fakeClient({
      getSessionControlPlane: async (_context, sessionId) => {
        if (delayGapRead && !gapReadConsumed) {
          gapReadConsumed = true;
          gapReadStarted.resolve();
          return delayedControlPlane.promise;
        }
        return {
          sessionId,
          state: "bound" as const,
          issueCode: null,
          retryable: false,
          recovery: "none" as const,
        };
      },
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(store.canDecideApprovals).toBe(true);

    delayGapRead = true;
    emitControlPlane({
      schemaVersion: 1,
      sequence: "1",
      sessionId: SESSION_B,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    emitControlPlane({
      schemaVersion: 1,
      sequence: "3",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await gapReadStarted.promise;
    expect(store.phase).toBe("resyncing");
    expect(store.canDecideApprovals).toBe(false);

    delayGapRead = false;
    delayedControlPlane.reject(new Error("control-plane unavailable"));
    await vi.waitFor(() => expect(store.phase).toBe("resync-required"));
    expect(store.canDecideApprovals).toBe(false);

    emitControlPlane({
      schemaVersion: 1,
      sequence: "4",
      sessionId: SESSION_A,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(store.canDecideApprovals).toBe(true);
    expect(subscribeV6).toHaveBeenCalledTimes(3);
  });

  it("revokes Host-minted approval authority before normal recovery and reacquires it once", async () => {
    const recovery = new Deferred<ChatLocalReadiness>();
    let subscribeCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscribeCall += 1;
      return Object.freeze({
        subscriptionId: subscribeCall === 1 ? LOCAL_SUBSCRIPTION_A : LOCAL_SUBSCRIPTION_B,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(
          subscribeCall === 1 ? HOST_GENERATION_A : HOST_GENERATION_B,
        ),
      });
    });
    const { client } = fakeClient({
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
      requestLocalRecovery: async () => recovery.promise,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(store.canDecideApprovals).toBe(true);

    const recovering = store.requestLocalRecovery();
    expect(store.canDecideApprovals).toBe(false);
    expect(store.phase).toBe("resync-required");
    expect(store.conversationApprovalState.reconciliation).toBe("required");

    recovery.resolve({
      lifecycle: "ready",
      host: "ready",
      runtime: "ready",
      storage: "ready",
      canSend: true,
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    await recovering;
    expect(store.phase).toBe("ready");
    expect(store.canDecideApprovals).toBe(true);
    expect(subscribeV6).toHaveBeenCalledTimes(2);
  });

  it("revokes current authority on invalid input and restores it from a fresh successful resync", async () => {
    let subscriptionCall = 0;
    let resyncCall = 0;
    const subscribeV6 = vi.fn<ChatClient["subscribeSessionV6"]>(async () => {
      subscriptionCall += 1;
      const local = subscriptionCall === 1 ? LOCAL_SUBSCRIPTION_A : LOCAL_SUBSCRIPTION_B;
      const host = subscriptionCall === 1 ? HOST_GENERATION_A : HOST_GENERATION_B;
      return Object.freeze({
        subscriptionId: local,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(host),
      });
    });
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>(async (_context, sessionId) => {
      resyncCall += 1;
      return projectionV6(
        sessionId,
        historyV6(),
        pendingApprovalSnapshotV6(
          resyncCall === 1 ? HOST_GENERATION_A : HOST_GENERATION_B,
        ),
      );
    });
    const { client, invalidate } = fakeClient({
      subscribeSessionV6: subscribeV6,
      resyncSessionV6: resyncV6,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(store.conversationApprovalState.approvals[APPROVAL_A]?.authorityStreamId)
      .toBe(HOST_GENERATION_A);

    invalidate({
      contextId: CONTEXT,
      sessionId: SESSION_A,
      subscriptionId: LOCAL_SUBSCRIPTION_A,
    });
    expect(store.conversationApprovalState.reconciliation).toBe("required");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      authority: "historical",
      authorityStreamId: null,
    });

    await vi.waitFor(() => expect(resyncV6).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(store.conversationApprovalState.reconciliation).toBe("synchronized");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      authority: "actionable",
      authorityStreamId: HOST_GENERATION_B,
    });
  });

  it("revokes authority at expiresAt and waits for the delayed Host terminal lifecycle", async () => {
    const delayedExpiryResync = new Deferred<ChatResyncProjectionV6>();
    let resyncCall = 0;
    let subscribeCall = 0;
    const resyncV6 = vi.fn<ChatClient["resyncSessionV6"]>((_context, sessionId) => {
      resyncCall += 1;
      return resyncCall === 1
        ? Promise.resolve(projectionV6(sessionId))
        : delayedExpiryResync.promise;
    });
    const { client, emitV6 } = fakeClient({
      resyncSessionV6: resyncV6,
      subscribeSessionV6: async () => {
        subscribeCall += 1;
        return Object.freeze({
          subscriptionId: subscribeCall === 1 ? LOCAL_SUBSCRIPTION_A : LOCAL_SUBSCRIPTION_B,
          pendingApprovalSnapshot: pendingApprovalSnapshotV6(
            subscribeCall === 1 ? HOST_GENERATION_A : HOST_GENERATION_B,
            subscribeCall === 1 ? approvalProjectionV6() : null,
          ),
        });
      },
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(store.conversationApprovalState.reconciliation).toBe("synchronized");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "pending",
      outcome: null,
      authority: "actionable",
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(resyncV6).toHaveBeenCalledTimes(2);
    expect(store.conversationApprovalState.reconciliation).toBe("required");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "pending",
      outcome: null,
      authority: "historical",
      authorityStreamId: null,
    });

    delayedExpiryResync.resolve(projectionV6(
      SESSION_A,
      historyV6(),
      pendingApprovalSnapshotV6(HOST_GENERATION_B, null),
    ));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "pending",
      outcome: null,
      authority: "historical",
    });

    emitV6(approvalEventV6(expiredApprovalProjectionV6(), LOCAL_SUBSCRIPTION_B));
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "resolved",
      outcome: "expired",
      authority: "historical",
    });
  });

  it("fails closed when a current Host snapshot cannot bind to its local Command item", async () => {
    const mismatchedPending = approvalProjectionV6(
      APPROVAL_A,
      TURN_A,
      "missing-command-item",
    );
    const { client } = fakeClient({
      subscribeSessionV6: async () => Object.freeze({
        subscriptionId: LOCAL_SUBSCRIPTION_A,
        pendingApprovalSnapshot: pendingApprovalSnapshotV6(
          HOST_GENERATION_A,
          mismatchedPending,
        ),
      }),
      resyncSessionV6: async (_context, sessionId) => projectionV6(
        sessionId,
        historyV6(),
        pendingApprovalSnapshotV6(HOST_GENERATION_A, mismatchedPending),
      ),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(store.phase).toBe("resync-required");
    expect(store.conversationApprovalState.reconciliation).toBe("required");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      authority: "historical",
      authorityStreamId: null,
    });
    expect(store.conversationApprovalState.diagnostics).toContainEqual({
      code: "pending_snapshot_invalid",
    });
  });

  it("merges older v6 approval lifecycle without revoking the current snapshot authority", async () => {
    const olderTurnId = "13700000-0000-4000-8000-000000000030";
    const currentPage = historyV6(
      Object.freeze([commandTurnV6()]),
      Object.freeze([approvalProjectionV6()]),
      "abcdefghijklmnop",
    );
    const olderPage = historyV6(
      Object.freeze([commandTurnV6(olderTurnId, COMMAND_B, true)]),
      Object.freeze([resolvedApprovalProjectionV6(APPROVAL_B, olderTurnId, COMMAND_B)]),
      null,
      "22",
    );
    const loadHistoryV6 = vi.fn<ChatClient["loadHistoryV6"]>(async () => olderPage);
    const { client } = fakeClient({
      loadHistoryV6,
      resyncSessionV6: async (_context, sessionId) => projectionV6(
        sessionId,
        currentPage,
        pendingApprovalSnapshotV6(),
      ),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.loadOlderHistory();

    expect(loadHistoryV6).toHaveBeenCalledWith(
      CONTEXT,
      SESSION_A,
      "abcdefghijklmnop",
      20,
      expect.any(AbortSignal),
    );
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      authority: "actionable",
      authorityStreamId: HOST_GENERATION_A,
    });
    expect(store.conversationApprovalState.approvals[APPROVAL_B]).toMatchObject({
      status: "resolved",
      outcome: "resolved_elsewhere",
      authority: "historical",
    });
    expect(store.history).toMatchObject({
      schemaVersion: 6,
      nextCursor: null,
      durableSequenceCut: "41",
      approvals: expect.arrayContaining([
        expect.objectContaining({ approvalRequestId: APPROVAL_A }),
        expect.objectContaining({ approvalRequestId: APPROVAL_B }),
      ]),
    });
  });

  it.each([
    ["accept_once" as const, "accepted_once" as const],
    ["cancel_current_turn" as const, "cancelled_current_turn" as const],
  ])("submits one closed %s decision and projects the known %s terminal", async (
    decision,
    outcome,
  ) => {
    const decide = vi.fn<ChatClient["decideApprovalV6"]>(async () =>
      approvalDecisionResultV6(decision));
    const { client } = fakeClient({
      decideApprovalV6: decide,
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    expect(store.canDecideApprovals).toBe(true);
    await expect(store.decideApproval({
      threadId: SESSION_A,
      turnId: TURN_A,
      itemId: COMMAND_A,
      approvalRequestId: APPROVAL_A,
      decision,
    })).resolves.toBe("accepted");

    expect(decide).toHaveBeenCalledOnce();
    expect(decide).toHaveBeenCalledWith(
      CONTEXT,
      SESSION_A,
      TURN_A,
      COMMAND_A,
      APPROVAL_A,
      decision,
    );
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "resolved",
      decision,
      outcome,
      authority: "historical",
      authorityStreamId: null,
    });
    expect(store.approvalTransients[APPROVAL_A]).toBeUndefined();
  });

  it("locks in flight at the store boundary and accepts an identical SSE-first result", async () => {
    const deferred = new Deferred<ChatApprovalDecisionResultV6>();
    const decide = vi.fn<ChatClient["decideApprovalV6"]>(() => deferred.promise);
    const { client, emitV6 } = fakeClient({
      decideApprovalV6: decide,
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const input = {
      threadId: SESSION_A,
      turnId: TURN_A,
      itemId: COMMAND_A,
      approvalRequestId: APPROVAL_A,
      decision: "accept_once" as const,
    };

    const first = store.decideApproval(input);
    expect(store.approvalTransients[APPROVAL_A]).toEqual({
      phase: "submitting",
      errorCode: null,
    });
    await expect(store.decideApproval(input)).resolves.toBe("ignored");
    expect(decide).toHaveBeenCalledOnce();

    emitV6(approvalEventV6(acceptedApprovalProjectionV6()));
    deferred.resolve(approvalDecisionResultV6());
    await expect(first).resolves.toBe("accepted");

    expect(decide).toHaveBeenCalledOnce();
    expect(store.conversationApprovalState.reconciliation).toBe("synchronized");
    expect(store.conversationApprovalState.diagnostics).not.toContainEqual({
      code: "decision_result_invalid",
    });
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      status: "resolved",
      outcome: "accepted_once",
    });
  });

  it("never retries an unknown result and unlocks the same request only after fresh authority", async () => {
    let decisionCall = 0;
    let resyncCall = 0;
    const refresh = new Deferred<ChatResyncProjectionV6>();
    const decide = vi.fn<ChatClient["decideApprovalV6"]>(async () => {
      decisionCall += 1;
      if (decisionCall === 1) {
        throw new ChatClientError({
          schemaVersion: 6,
          code: "chat_conflict",
          retryable: false,
          recovery: "resync",
          approvalIssue: "approval_unavailable",
        });
      }
      return approvalDecisionResultV6();
    });
    const resync = vi.fn<ChatClient["resyncSessionV6"]>((_context, sessionId) => {
      resyncCall += 1;
      return resyncCall === 1
        ? Promise.resolve(projectionV6(sessionId))
        : refresh.promise;
    });
    const { client } = fakeClient({ decideApprovalV6: decide, resyncSessionV6: resync });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const input = {
      threadId: SESSION_A,
      turnId: TURN_A,
      itemId: COMMAND_A,
      approvalRequestId: APPROVAL_A,
      decision: "accept_once" as const,
    };

    await expect(store.decideApproval(input)).resolves.toBe("reconciling");
    expect(decide).toHaveBeenCalledOnce();
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      authority: "historical",
      authorityStreamId: null,
    });
    await vi.waitFor(() => expect(resync).toHaveBeenCalledTimes(2));
    expect(decide).toHaveBeenCalledOnce();
    refresh.resolve(projectionV6(SESSION_A));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(decide).toHaveBeenCalledOnce();
    expect(store.approvalTransients[APPROVAL_A]).toBeUndefined();
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      authority: "actionable",
      authorityStreamId: HOST_GENERATION_A,
    });

    await expect(store.decideApproval(input)).resolves.toBe("accepted");
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("keeps capability-revoked approval actions disabled and never invokes", async () => {
    const decide = vi.fn<ChatClient["decideApprovalV6"]>();
    const { client } = fakeClient({
      decideApprovalV6: decide,
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    const input = {
      threadId: SESSION_A,
      turnId: TURN_A,
      itemId: COMMAND_A,
      approvalRequestId: APPROVAL_A,
      decision: "accept_once" as const,
    };

    store.context = Object.freeze({
      ...store.context!,
      allowedActions: Object.freeze(store.context!.allowedActions
        .filter((action) => action !== "submit_turn")),
    });
    expect(store.canDecideApprovals).toBe(false);
    await expect(store.decideApproval(input)).resolves.toBe("reconciling");
    expect(decide).not.toHaveBeenCalled();
  });

  it("revokes an exactly expired approval without invoking", async () => {
    const decide = vi.fn<ChatClient["decideApprovalV6"]>();
    const { client } = fakeClient({
      decideApprovalV6: decide,
      resyncSessionV6: async (_context, sessionId) => projectionV6(sessionId),
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    vi.setSystemTime(Date.parse(EXPIRES_AT));

    await expect(store.decideApproval({
      threadId: SESSION_A,
      turnId: TURN_A,
      itemId: COMMAND_A,
      approvalRequestId: APPROVAL_A,
      decision: "accept_once",
    })).resolves.toBe("reconciling");

    expect(decide).not.toHaveBeenCalled();
    expect(store.conversationApprovalState.reconciliation).toBe("required");
    expect(store.conversationApprovalState.approvals[APPROVAL_A]).toMatchObject({
      authority: "historical",
      authorityStreamId: null,
    });
  });

  it("keeps a disconnected approval locked while authoritative resync is pending", async () => {
    const delayedResync = new Deferred<ChatResyncProjectionV6>();
    let resyncCall = 0;
    const resync = vi.fn<ChatClient["resyncSessionV6"]>((_context, sessionId) => {
      resyncCall += 1;
      return resyncCall === 1
        ? Promise.resolve(projectionV6(sessionId))
        : delayedResync.promise;
    });
    const decide = vi.fn<ChatClient["decideApprovalV6"]>();
    const { client, invalidate } = fakeClient({
      decideApprovalV6: decide,
      resyncSessionV6: resync,
    });
    const store = createV6Store(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    invalidate({
      contextId: CONTEXT,
      sessionId: SESSION_A,
      subscriptionId: LOCAL_SUBSCRIPTION_A,
    });
    expect(store.conversationApprovalState.reconciliation).toBe("required");
    await expect(store.decideApproval({
      threadId: SESSION_A,
      turnId: TURN_A,
      itemId: COMMAND_A,
      approvalRequestId: APPROVAL_A,
      decision: "accept_once",
    })).resolves.toBe("reconciling");
    expect(decide).not.toHaveBeenCalled();
    delayedResync.resolve(projectionV6(SESSION_A));
  });
});
