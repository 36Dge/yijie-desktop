import { createPinia, setActivePinia } from "pinia";
import { watch } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatClient, ChatInvalidEventScope } from "../api/chat-client";
import {
  conversationMessageItemId,
  conversationReasoningItemId,
} from "../api/chat-conversation-adapter";
import {
  selectConversationItem,
  selectConversationTurn,
} from "../domain/conversation-state";
import type { ChatArtifactLiveEvent } from "../domain/chat-artifact-live";
import type {
  ChatAllowedAction,
  ChatAttachment,
  ChatAttachmentImportEvent,
  ChatControlPlaneEvent,
  ChatHistoryPage,
  ChatHistoryPageV4,
  ChatProjectionEvent,
  ChatProjectionEventV4,
  ChatResyncProjection,
  ChatResyncProjectionV4,
  ChatSession,
} from "../domain/chat-ipc";
import {
  CHAT_NEW_DRAFT_TARGET,
  ChatClientError,
  chatSessionDraftTarget,
} from "../domain/chat-ipc";
import {
  CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS,
  CHAT_DRAFT_ATTACHMENT_LIMIT,
  createChatStoreDefinition,
  type ChatSubmissionResult,
} from "./chat.store";
import { createArtifactStoreDefinition } from "./artifact.store";

const NOW = Date.parse("2026-08-03T12:00:00Z");
const TENANT = "019c1a00-0000-7000-8000-000000000002";
const CONTEXT = "019c1a00-0000-7000-8000-000000000003";
const CONTEXT_B = "019c1a00-0000-7000-8000-000000000004";
const SESSION_A = "019c1a00-0000-7000-8000-000000000005";
const SESSION_B = "019c1a00-0000-7000-8000-000000000006";
const TURN_A = "019c1a00-0000-7000-8000-000000000007";
const SESSION_CREATED = "019c1a00-0000-7000-8000-000000000008";
const ARTIFACT_A = "019c1a00-0000-7000-8000-000000000019";
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
  emit: (event: ChatProjectionEvent) => void;
  emitV4: (event: ChatProjectionEventV4) => void;
  emitControlPlane: (event: ChatControlPlaneEvent) => void;
  emitAttachmentImport: (event: ChatAttachmentImportEvent) => void;
  invalidate: (scope?: ChatInvalidEventScope | null) => void;
} {
  let eventHandler: (event: ChatProjectionEvent) => void = () => undefined;
  let eventHandlerV4: (event: ChatProjectionEventV4) => void = () => undefined;
  let invalidHandler: (scope?: ChatInvalidEventScope | null) => void = () => undefined;
  let controlPlaneHandler: (event: ChatControlPlaneEvent) => void = () => undefined;
  let attachmentImportHandler: (event: ChatAttachmentImportEvent) => void = () => undefined;
  const client: ChatClient = {
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
    resyncSession: async (_context, sessionId) => projection(sessionId),
    resyncSessionV2: (...arguments_) => client.resyncSession(...arguments_),
    resyncSessionV4: async (_context, sessionId) => projectionV4(sessionId),
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
    emit: (value) => eventHandler(value),
    emitV4: (value) => eventHandlerV4(value),
    emitControlPlane: (value) => controlPlaneHandler(value),
    emitAttachmentImport: (value) => attachmentImportHandler(value),
    invalidate: (scope) => invalidHandler(scope),
  };
}

function createStore(client: ChatClient) {
  return createChatStoreDefinition(client, `chat-test-${storeSequence++}`)();
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
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
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

  it("ignores exact duplicates and resyncs on a sequence gap", async () => {
    const resync = vi.fn(async (_context: string, sessionId: string) => projection(sessionId));
    const { client, emit } = fakeClient({ resyncSession: resync });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(resync).toHaveBeenCalledTimes(1);

    const first = event(
      "1",
      "019c1a00-0000-7000-8000-00000000000d",
      "assistant_append",
      { text: "hello" },
    );
    emit(first);
    emit(first);
    emit({ ...first, projectionSequence: "99" });
    expect(store.liveAssistantText).toBe("hello");
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      conversationMessageItemId(TURN_A, "assistant"),
    )?.contentBlocks).toEqual([{ blockIndex: 0, type: "text", text: "hello" }]);
    expect(resync).toHaveBeenCalledTimes(1);

    emit(event(
      "3",
      "019c1a00-0000-7000-8000-00000000000e",
      "assistant_append",
      { text: "gap" },
    ));
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
    expect(resync).toHaveBeenCalledTimes(2);
    expect(store.liveAssistantText).toBe("");
  });

  it("tracks cleanup events in the shared projection sequence before refreshing cleanup", async () => {
    const cleanupOperationId = "019c1a00-0000-7000-8000-000000000099";
    const pendingCleanup = Object.freeze({
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
    const getCleanupStatus = vi.fn(async () => pendingCleanup);
    const resync = vi.fn(async (_context: string, sessionId: string) => projection(sessionId));
    const { client, emit } = fakeClient({ getCleanupStatus, resyncSession: resync });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    expect(resync).toHaveBeenCalledTimes(1);

    const cleanup = event(
      "1",
      "019c1a00-0000-7000-8000-000000000041",
      "cleanup_state",
      { operationId: cleanupOperationId, state: "pending" },
    );
    emit(cleanup);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    const cleanupRefreshCalls = getCleanupStatus.mock.calls.length;
    expect(cleanupRefreshCalls).toBeGreaterThan(0);

    emit(cleanup);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(getCleanupStatus).toHaveBeenCalledTimes(cleanupRefreshCalls);

    emit(event(
      "2",
      "019c1a00-0000-7000-8000-000000000042",
      "assistant_append",
      { text: "after-cleanup" },
    ));
    expect(store.liveAssistantText).toBe("after-cleanup");
    expect(resync).toHaveBeenCalledTimes(1);

    emit(event(
      "4",
      "019c1a00-0000-7000-8000-000000000043",
      "cleanup_state",
      { operationId: cleanupOperationId, state: "pending" },
    ));
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(resync).toHaveBeenCalledTimes(2);
    expect(getCleanupStatus).toHaveBeenCalledTimes(cleanupRefreshCalls);
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
    for (let index = 0; index < 8 && getCleanupStatus.mock.calls.length === 0; index += 1) {
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
    for (let index = 0; index < 8; index += 1) await Promise.resolve();

    expect(store.selectedSessionId).toBe(SESSION_B);
    expect(store.cleanupStatus).toBeNull();
    expect(store.deleteDisposition).toBeNull();
    expect(getCleanupStatus).toHaveBeenCalledTimes(1);
  });

  it("projects interleaved assistant and reasoning events through the unified reducer", async () => {
    const { client, emit } = fakeClient();
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    emit(event("1", "019c1a00-0000-7000-8000-000000000031", "assistant_append", { text: "A1" }));
    emit(event("2", "019c1a00-0000-7000-8000-000000000032", "reasoning_append", {
      itemOrdinal: 0,
      contentIndex: 0,
      text: "R1",
    }));
    emit(event("3", "019c1a00-0000-7000-8000-000000000033", "assistant_append", { text: "A2" }));
    emit(event("4", "019c1a00-0000-7000-8000-000000000034", "reasoning_append", {
      itemOrdinal: 0,
      contentIndex: 0,
      text: "R2",
    }));

    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      conversationMessageItemId(TURN_A, "assistant"),
    )?.contentBlocks).toEqual([{ blockIndex: 0, type: "text", text: "A1A2" }]);
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      conversationReasoningItemId(TURN_A, 0),
    )?.contentBlocks).toEqual([{ blockIndex: 0, type: "text", text: "R1R2" }]);
    expect(store.liveAssistantText).toBe("A1A2");
    expect(store.liveReasoning.map((part) => part.text)).toEqual(["R1R2"]);
  });

  it("ignores late valid and safely scoped malformed events after switching A to B", async () => {
    const resyncSession = vi.fn(async (_context: string, sessionId: string) => projection(sessionId));
    const { client, emit, invalidate } = fakeClient({ resyncSession });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    await store.selectSession(SESSION_B);
    expect(resyncSession).toHaveBeenCalledTimes(2);

    emit(event(
      "1",
      "019c1a00-0000-7000-8000-000000000035",
      "assistant_append",
      { text: "late-a" },
    ));
    invalidate({
      contextId: CONTEXT,
      sessionId: SESSION_A,
      subscriptionId: "019c1a00-0000-7000-8000-00000000000a",
    });
    for (let index = 0; index < 4; index += 1) await Promise.resolve();

    expect(store.selectedSessionId).toBe(SESSION_B);
    expect(store.liveAssistantText).toBe("");
    expect(resyncSession).toHaveBeenCalledTimes(2);

    invalidate({
      contextId: CONTEXT,
      sessionId: SESSION_B,
      subscriptionId: "019c1a00-0000-7000-8000-00000000000b",
    });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(resyncSession).toHaveBeenCalledTimes(3);
  });

  it("reloads authoritative history and clears the live projection after a terminal event", async () => {
    let resyncCalls = 0;
    const completedProjection: ChatResyncProjection = Object.freeze({
      session: Object.freeze({ ...session(SESSION_A), latestTurnStatus: "completed" }),
      history: Object.freeze({
        turns: Object.freeze([Object.freeze({
          turnId: TURN_A,
          status: "completed" as const,
          terminalAt: 2,
          reasoningStatus: "complete" as const,
          reasoningReasonCode: null,
          messages: Object.freeze([Object.freeze({
            messageId: "019c1a00-0000-7000-8000-000000000021",
            role: "assistant" as const,
            content: "persisted answer",
            status: "completed",
            ordinal: 0,
            createdAt: 2,
          })]),
          reasoning: Object.freeze([]),
          artifacts: Object.freeze([]),
        })]),
        nextCursor: null,
      }),
      cleanup: null,
    });
    const resyncSession = vi.fn(async (_context: string, sessionId: string) => {
      resyncCalls += 1;
      return resyncCalls === 1 ? projection(sessionId) : completedProjection;
    });
    const { client, emit } = fakeClient({ resyncSession });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    emit(event(
      "1",
      "019c1a00-0000-7000-8000-00000000000d",
      "assistant_append",
      { text: "persisted answer" },
    ));
    emit(event(
      "2",
      "019c1a00-0000-7000-8000-00000000000e",
      "turn_terminal",
      { status: "completed" },
    ));
    for (let index = 0; index < 12; index += 1) await Promise.resolve();

    expect(resyncSession).toHaveBeenCalledTimes(2);
    expect(store.phase).toBe("ready");
    expect(store.liveAssistantText).toBe("");
    expect(store.liveReasoning).toEqual([]);
    expect(store.liveTurnStatus).toBe("completed");
    expect(store.history?.turns[0]?.messages[0]?.content).toBe("persisted answer");
    expect(store.sessions.find((value) => value.sessionId === SESSION_A)?.latestTurnStatus).toBe("completed");
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A)).toMatchObject({
      status: "completed",
      terminalStatus: "completed",
    });
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      conversationMessageItemId(TURN_A, "assistant"),
    )).toMatchObject({
      status: "completed",
      reconciliation: "matched",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "persisted answer" }],
    });
  });

  it("keeps domain, history, and sidebar lifecycle aligned when terminal resync fails", async () => {
    const queuedProjection: ChatResyncProjection = Object.freeze({
      session: Object.freeze({ ...session(SESSION_A), latestTurnStatus: "queued" }),
      history: Object.freeze({
        turns: Object.freeze([Object.freeze({
          turnId: TURN_A,
          status: "queued",
          terminalAt: null,
          reasoningStatus: "incomplete",
          reasoningReasonCode: null,
          messages: Object.freeze([]),
          reasoning: Object.freeze([]),
          artifacts: Object.freeze([]),
        })]),
        nextCursor: null,
      }),
      cleanup: null,
    });
    let resyncCalls = 0;
    const resyncSession = vi.fn(async () => {
      resyncCalls += 1;
      if (resyncCalls === 1) return queuedProjection;
      throw new ChatClientError({
        schemaVersion: 1,
        code: "chat_temporarily_unavailable",
        retryable: true,
        recovery: "retry",
      });
    });
    const { client, emit } = fakeClient({ resyncSession });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    emit(event(
      "1",
      "019c1a00-0000-7000-8000-00000000003a",
      "assistant_append",
      { text: "safe live answer" },
    ));

    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A)?.status)
      .toBe("in_progress");
    expect(store.liveTurnStatus).toBe("streaming");
    expect(store.history?.turns[0]?.status).toBe("streaming");
    expect(store.sessions.find((value) => value.sessionId === SESSION_A)?.latestTurnStatus)
      .toBe("streaming");

    emit(event(
      "2",
      "019c1a00-0000-7000-8000-00000000003b",
      "turn_terminal",
      { status: "completed" },
    ));
    for (let index = 0; index < 12; index += 1) await Promise.resolve();

    expect(resyncSession).toHaveBeenCalledTimes(2);
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A)).toMatchObject({
      status: "completed",
      terminalStatus: "completed",
    });
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      conversationMessageItemId(TURN_A, "assistant"),
    )).toMatchObject({
      status: "completed",
      reconciliation: "not_applicable",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "safe live answer" }],
    });
    expect(store.liveTurnStatus).toBe("completed");
    expect(store.history?.turns[0]?.status).toBe("completed");
    expect(store.sessions.find((value) => value.sessionId === SESSION_A)?.latestTurnStatus)
      .toBe("completed");
  });

  it("treats an unseen live Turn as latest when terminal resync fails", async () => {
    const liveTurnId = "019c1a00-0000-7000-8000-000000000001";
    const historicalProjection: ChatResyncProjection = Object.freeze({
      session: Object.freeze({ ...session(SESSION_A), latestTurnStatus: "failed" }),
      history: Object.freeze({
        turns: Object.freeze([Object.freeze({
          turnId: TURN_A,
          status: "failed" as const,
          terminalAt: 1,
          reasoningStatus: "incomplete" as const,
          reasoningReasonCode: null,
          messages: Object.freeze([]),
          reasoning: Object.freeze([]),
          artifacts: Object.freeze([]),
        })]),
        nextCursor: null,
      }),
      cleanup: null,
    });
    let resyncCalls = 0;
    const resyncSession = vi.fn(async () => {
      resyncCalls += 1;
      if (resyncCalls === 1) return historicalProjection;
      throw new ChatClientError({
        schemaVersion: 1,
        code: "chat_temporarily_unavailable",
        retryable: true,
        recovery: "retry",
      });
    });
    const { client, emit } = fakeClient({ resyncSession });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    emit({
      ...event(
        "1",
        "019c1a00-0000-7000-8000-00000000004a",
        "assistant_append",
        { text: "new live answer" },
      ),
      turnId: liveTurnId,
    });

    expect(selectConversationTurn(store.conversationState, SESSION_A, liveTurnId)).toMatchObject({
      ordinal: 1,
      status: "in_progress",
    });
    expect(store.sessions.find((value) => value.sessionId === SESSION_A)?.latestTurnStatus)
      .toBe("streaming");

    emit({
      ...event(
        "2",
        "019c1a00-0000-7000-8000-00000000004b",
        "turn_terminal",
        { status: "completed" },
      ),
      turnId: liveTurnId,
    });
    for (let index = 0; index < 12; index += 1) await Promise.resolve();

    expect(resyncSession).toHaveBeenCalledTimes(2);
    expect(selectConversationTurn(store.conversationState, SESSION_A, liveTurnId)).toMatchObject({
      ordinal: 1,
      status: "completed",
      terminalStatus: "completed",
    });
    expect(store.sessions.find((value) => value.sessionId === SESSION_A)?.latestTurnStatus)
      .toBe("completed");
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
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(getSessionControlPlane).toHaveBeenCalledTimes(2);
    expect(store.controlPlane?.state).toBe("retry_wait");
    expect(store.lastErrorCode).toBe("chat_temporarily_unavailable");
    expect(store.canSend).toBe(false);
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
    for (let index = 0; index < 8; index += 1) await Promise.resolve();

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
    for (let index = 0; index < 8 && calls === 0; index += 1) await Promise.resolve();
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

  it("clears text synchronously on context invalidation, malformed wire, and expiry", async () => {
    const { client, emit, invalidate } = fakeClient({
      bindContext: async () => ({
        contextId: CONTEXT,
        expiresAtEpochSeconds: Math.floor(NOW / 1000) + 1,
        allowedActions: ["read_sessions", "read_projects"],
      }),
    });
    const store = createStore(client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);
    emit(event(
      "1",
      "019c1a00-0000-7000-8000-00000000000d",
      "assistant_append",
      { text: "sensitive synthetic body" },
    ));
    expect(store.liveAssistantText).not.toBe("");

    emit(event(
      "2",
      "019c1a00-0000-7000-8000-00000000000e",
      "context_invalidated",
      { reason: "authority_changed" },
    ));
    expect(store.context).toBeNull();
    expect(store.liveAssistantText).toBe("");

    await store.bind(TENANT);
    invalidate();
    expect(store.phase).toBe("resync-required");
    await store.bind(TENANT);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.context).toBeNull();
    expect(store.phase).toBe("resync-required");
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
    for (let index = 0; index < 8 && createSession.mock.calls.length === 0; index += 1) {
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
    for (let index = 0; index < 8 && createSession.mock.calls.length === 0; index += 1) {
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
    const { client, emit } = fakeClient({
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
    for (let index = 0; index < 8 && submitTurnV2.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(submitTurnV2).toHaveBeenCalledOnce();

    emit(event(
      "1",
      "019c1a00-0000-7000-8000-00000000004c",
      "turn_state",
      { status: "streaming" },
    ));
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
    for (let index = 0; index < 8 && submitTurn.mock.calls.length === 0; index += 1) {
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
    for (let index = 0; index < 8 && createSession.mock.calls.length === 0; index += 1) {
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
    for (let index = 0; index < 8 && createSession.mock.calls.length === 0; index += 1) {
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
    for (let index = 0; index < 8 && createSession.mock.calls.length === 0; index += 1) {
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
    for (let index = 0; index < 8 && settled === null; index += 1) await Promise.resolve();

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

  it("returns a sealed reply acceptance without waiting for post-durable resync", async () => {
    const delayedResync = new Deferred<Awaited<ReturnType<ChatClient["resyncSession"]>>>();
    let resyncCalls = 0;
    const resyncSession = vi.fn<ChatClient["resyncSession"]>(async (_context, sessionId) => {
      resyncCalls += 1;
      return resyncCalls === 1 ? projection(sessionId) : delayedResync.promise;
    });
    const store = createStore(fakeClient({ resyncSession }).client);
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    let settled: ChatSubmissionResult | null = null;
    const pending = store.submitTurnWithResult("reply task");
    void pending.then((result) => { settled = result; });
    for (let index = 0; index < 8 && settled === null; index += 1) await Promise.resolve();

    try {
      expect(settled).toMatchObject({ status: "local_durable_accepted" });
      expect(store.submissionState).toBe("idle");
      for (let index = 0; index < 8 && resyncSession.mock.calls.length < 2; index += 1) {
        await Promise.resolve();
      }
      expect(resyncSession).toHaveBeenCalledTimes(2);
    } finally {
      delayedResync.resolve(projection(SESSION_A));
      await pending;
    }
  });

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
    expect(listSessions).toHaveBeenCalledTimes(2);
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
    for (let index = 0; index < 8 && listCalls < 2; index += 1) await Promise.resolve();
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

  it("advances over buffered events already included in the durable cut and applies later events once", async () => {
    const snapshot: ChatHistoryPageV4 = Object.freeze({
      turns: Object.freeze([Object.freeze({
        turnId: TURN_A,
        projectionAuthority: "v4" as const,
        status: "streaming",
        terminalAt: null,
        reasoningStatus: "unknown",
        reasoningReasonCode: null,
        messages: Object.freeze([]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([Object.freeze({
          ...sourceV4(3),
          itemId: "overlap-final",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer" as const,
          status: "in_progress" as const,
          text: "A",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: Object.freeze([]),
          startedAtMs: 1,
          completedAtMs: null,
        })]),
        plan: null,
        notices: Object.freeze([]),
      })]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "3",
    });
    const delayedResync = new Deferred<ChatResyncProjectionV4>();
    const resyncV4 = vi.fn<ChatClient["resyncSessionV4"]>(() => delayedResync.promise);
    const { client, emitV4 } = fakeClient({ resyncSessionV4: resyncV4 });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-overlap-${storeSequence++}`,
      undefined,
      true,
    )();
    await store.bind(TENANT);

    const selecting = store.selectSession(SESSION_A);
    await vi.waitFor(() => expect(resyncV4).toHaveBeenCalledOnce());
    emitV4(eventV4(1, "turn_started", sourceV4(1)));
    emitV4(eventV4(2, "item_started", {
      ...sourceV4(2),
      itemId: "overlap-final",
      itemOrdinal: 1,
      itemType: "agentMessage",
      phase: "final_answer",
      text: "",
    }));
    emitV4(eventV4(3, "agent_message_append", {
      ...sourceV4(3),
      itemId: "overlap-final",
      itemOrdinal: 1,
      phase: "final_answer",
      text: "A",
    }));
    emitV4(eventV4(4, "plan_updated", {
      ...sourceV4(4),
      explanation: null,
      steps: [{ ordinal: 0, step: "late plan", status: "in_progress" }],
    }));

    delayedResync.resolve(projectionV4(SESSION_A, snapshot));
    await selecting;

    expect(store.conversationState.syncStatus).toBe("synchronized");
    expect(selectConversationItem(store.conversationState, SESSION_A, TURN_A, "overlap-final"))
      .toMatchObject({ contentBlocks: [{ text: "A" }] });
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A)?.plan?.steps)
      .toEqual([{ ordinal: 0, text: "late plan", status: "in_progress" }]);
    expect(store.conversationState.streamPositions[
      "019c1a00-0000-7000-8000-00000000000a"
    ]).toBe("4");

    emitV4(eventV4(5, "agent_message_append", {
      ...sourceV4(5),
      itemId: "overlap-final",
      itemOrdinal: 1,
      phase: "final_answer",
      text: "B",
    }));
    expect(selectConversationItem(store.conversationState, SESSION_A, TURN_A, "overlap-final"))
      .toMatchObject({ contentBlocks: [{ text: "AB" }] });
    expect(resyncV4).toHaveBeenCalledOnce();
  });

  it("upgrades an active legacy scaffold to v4 facts without inventing a final item", async () => {
    const userMessage = Object.freeze({
      messageId: "13430000-0000-4000-8000-000000000011",
      role: "user" as const,
      content: "synthetic request",
      contentBlocks: Object.freeze([{ type: "text" as const, text: "synthetic request" }]),
      status: "committed",
      ordinal: 0,
      createdAt: 1,
    });
    const legacyActive: ChatHistoryPageV4 = Object.freeze({
      turns: Object.freeze([Object.freeze({
        turnId: TURN_A,
        projectionAuthority: "legacy" as const,
        status: "streaming",
        terminalAt: null,
        reasoningStatus: "pending",
        reasoningReasonCode: null,
        messages: Object.freeze([userMessage, Object.freeze({
          messageId: "13430000-0000-4000-8000-000000000012",
          role: "assistant" as const,
          content: "",
          contentBlocks: Object.freeze([{ type: "text" as const, text: " " }]),
          status: "pending",
          ordinal: 1,
          createdAt: 2,
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
    const terminalV4: ChatHistoryPageV4 = Object.freeze({
      turns: Object.freeze([Object.freeze({
        ...legacyActive.turns[0]!,
        projectionAuthority: "v4" as const,
        status: "completed",
        terminalAt: 5,
        messages: Object.freeze([userMessage]),
        timelineItems: Object.freeze([Object.freeze({
          ...sourceV4(4),
          itemId: "race-final",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer" as const,
          status: "completed" as const,
          text: "confirmed final",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: Object.freeze([]),
          startedAtMs: 2,
          completedAtMs: 4,
        })]),
      })]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "5",
    });
    const firstResync = new Deferred<ChatResyncProjectionV4>();
    let resyncCount = 0;
    const resyncV4 = vi.fn<ChatClient["resyncSessionV4"]>((_context, sessionId) => {
      resyncCount += 1;
      return resyncCount === 1
        ? firstResync.promise
        : Promise.resolve(projectionV4(sessionId, terminalV4));
    });
    const { client, emitV4 } = fakeClient({ resyncSessionV4: resyncV4 });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-authority-race-${storeSequence++}`,
      undefined,
      true,
    )();
    await store.bind(TENANT);

    const selecting = store.selectSession(SESSION_A);
    await vi.waitFor(() => expect(resyncV4).toHaveBeenCalledOnce());
    emitV4(eventV4(1, "turn_started", sourceV4(1)));
    emitV4(eventV4(2, "item_started", {
      ...sourceV4(2),
      itemId: "race-final",
      itemOrdinal: 1,
      itemType: "agentMessage",
      phase: "final_answer",
      text: "",
    }));
    emitV4(eventV4(3, "agent_message_append", {
      ...sourceV4(3),
      itemId: "race-final",
      itemOrdinal: 1,
      phase: "final_answer",
      text: "confirmed final",
    }));
    emitV4(eventV4(4, "item_completed", {
      ...sourceV4(4),
      itemId: "race-final",
      itemOrdinal: 1,
      itemType: "agentMessage",
      phase: "final_answer",
      text: "confirmed final",
    }));
    emitV4(eventV4(5, "turn_terminal", {
      ...sourceV4(5),
      status: "completed",
      code: null,
      unfinishedReasoningReasonCode: "protocol_error",
    }));

    firstResync.resolve(projectionV4(SESSION_A, legacyActive));
    await selecting;
    await vi.waitFor(() => expect(resyncV4).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));

    expect(store.conversationState.syncStatus).toBe("synchronized");
    expect(store.lastErrorCode).toBeNull();
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      conversationMessageItemId(TURN_A, "assistant"),
    )).toBeNull();
    expect(selectConversationItem(store.conversationState, SESSION_A, TURN_A, "race-final"))
      .toMatchObject({
        status: "completed",
        agentMessagePhase: "final_answer",
        contentBlocks: [{ text: "confirmed final" }],
      });
  });

  it("drops an oversized resync event buffer and requests a fresh content-free recovery", async () => {
    const firstResync = new Deferred<ChatResyncProjectionV4>();
    const trailingResync = new Deferred<ChatResyncProjectionV4>();
    let resyncCount = 0;
    const resyncV4 = vi.fn<ChatClient["resyncSessionV4"]>(() => {
      resyncCount += 1;
      return resyncCount === 1 ? firstResync.promise : trailingResync.promise;
    });
    const { client, emitV4 } = fakeClient({ resyncSessionV4: resyncV4 });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-buffer-bound-${storeSequence++}`,
      undefined,
      true,
    )();
    await store.bind(TENANT);

    const selecting = store.selectSession(SESSION_A);
    await vi.waitFor(() => expect(resyncV4).toHaveBeenCalledOnce());
    emitV4(eventV4(1, "turn_started", sourceV4(1)));
    emitV4(eventV4(2, "item_started", {
      ...sourceV4(2),
      itemId: "buffered-final",
      itemOrdinal: 1,
      itemType: "agentMessage",
      phase: "final_answer",
      text: "",
    }));
    const chunk = "x".repeat(80 * 1024);
    for (let sequence = 3; sequence <= 65; sequence += 1) {
      emitV4(eventV4(sequence, "agent_message_append", {
        ...sourceV4(sequence),
        itemId: "buffered-final",
        itemOrdinal: 1,
        phase: "final_answer",
        text: chunk,
      }));
    }

    firstResync.resolve(projectionV4(SESSION_A));
    await selecting;
    await vi.waitFor(() => expect(resyncV4).toHaveBeenCalledTimes(2));

    expect(store.phase).toBe("resyncing");
    expect(selectConversationItem(
      store.conversationState,
      SESSION_A,
      TURN_A,
      "buffered-final",
    )).toBeNull();

    trailingResync.resolve(projectionV4(SESSION_A));
    await vi.waitFor(() => expect(store.phase).toBe("ready"));
    expect(resyncV4).toHaveBeenCalledTimes(2);
  });

  it("derives compatibility status from the latest durable history when the resync summary is stale", async () => {
    const streamingHistory: ChatHistoryPageV4 = Object.freeze({
      turns: Object.freeze([Object.freeze({
        turnId: TURN_A,
        projectionAuthority: "v4" as const,
        status: "streaming",
        terminalAt: null,
        reasoningStatus: "unknown",
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
      durableSequenceCut: "0",
    });
    const terminalHistory: ChatHistoryPageV4 = Object.freeze({
      turns: Object.freeze([Object.freeze({
        ...streamingHistory.turns[0]!,
        status: "completed",
        terminalAt: 4,
        timelineItems: Object.freeze([Object.freeze({
          ...sourceV4(3),
          itemId: "terminal-final",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer" as const,
          status: "completed" as const,
          text: "A",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: Object.freeze([]),
          startedAtMs: 2,
          completedAtMs: 4,
        })]),
      })]),
      nextCursor: null,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "4",
    });
    const delayedProjection = new Deferred<ChatResyncProjectionV4>();
    const loadHistoryV4 = vi.fn<ChatClient["loadHistoryV4"]>(async () => terminalHistory);
    const { client, emitV4 } = fakeClient({
      resyncSessionV4: () => delayedProjection.promise,
      loadHistoryV4,
    });
    const artifacts = createArtifactStoreDefinition(`artifact-feat134-race-${storeSequence++}`)();
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-race-${storeSequence++}`,
      () => ({
        liveClient: { listen: async () => () => undefined },
        store: artifacts,
        authority: () => ({ authorizationRevision: 1, tenantId: TENANT }),
      }),
      true,
    )();
    await store.bind(TENANT);

    const selecting = store.selectSession(SESSION_A);
    emitV4(eventV4(1, "turn_started", sourceV4(1)));
    emitV4(eventV4(2, "item_started", {
      ...sourceV4(2),
      itemId: "terminal-final",
      itemOrdinal: 1,
      itemType: "agentMessage",
      phase: "final_answer",
      text: "",
    }));
    emitV4(eventV4(3, "agent_message_append", {
      ...sourceV4(3),
      itemId: "terminal-final",
      itemOrdinal: 1,
      phase: "final_answer",
      text: "A",
    }));
    emitV4(eventV4(4, "turn_terminal", {
      ...sourceV4(4),
      status: "completed",
      code: null,
      unfinishedReasoningReasonCode: "protocol_error",
    }));
    delayedProjection.resolve(Object.freeze({
      session: Object.freeze({ ...session(SESSION_A), latestTurnStatus: "streaming" }),
      history: streamingHistory,
      cleanup: null,
    }));
    await selecting;

    expect(loadHistoryV4).toHaveBeenCalledTimes(2);
    expect(store.conversationState.syncStatus).toBe("synchronized");
    expect(store.liveTurnStatus).toBe("completed");
    expect(store.sessions.find((entry) => entry.sessionId === SESSION_A)?.latestTurnStatus)
      .toBe("completed");
    expect(selectConversationItem(store.conversationState, SESSION_A, TURN_A, "terminal-final"))
      .toMatchObject({ contentBlocks: [{ text: "A" }], status: "completed" });
  });

  it("appends an older v4 page without overwriting live content, plan, notices, or the current cut", async () => {
    const cursor = "abcdefghijklmnop";
    const currentHistory: ChatHistoryPageV4 = Object.freeze({
      turns: Object.freeze([Object.freeze({
        turnId: TURN_A,
        projectionAuthority: "v4" as const,
        status: "streaming",
        terminalAt: null,
        reasoningStatus: "unknown",
        reasoningReasonCode: null,
        messages: Object.freeze([]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([]),
        plan: null,
        notices: Object.freeze([]),
      })]),
      nextCursor: cursor,
      sessionNotices: Object.freeze([]),
      durableSequenceCut: "10",
    });
    const oldTurnId = "019c1a00-0000-7000-8000-000000000001";
    const olderHistory: ChatHistoryPageV4 = Object.freeze({
      turns: Object.freeze([Object.freeze({
        turnId: oldTurnId,
        projectionAuthority: "v4" as const,
        status: "completed",
        terminalAt: 1,
        reasoningStatus: "unavailable",
        reasoningReasonCode: "reasoning_not_emitted",
        messages: Object.freeze([]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
        terminalCode: null,
        timelineItems: Object.freeze([Object.freeze({
          ...sourceV4(20),
          itemId: "older-final",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer" as const,
          status: "completed" as const,
          text: "older text",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: Object.freeze([]),
          startedAtMs: 1,
          completedAtMs: 1,
        })]),
        plan: null,
        notices: Object.freeze([]),
      })]),
      nextCursor: null,
      sessionNotices: Object.freeze([Object.freeze({
        ...sourceV4(20),
        scope: "session" as const,
        severity: "warning" as const,
        code: "stale_page_warning",
        willRetry: false,
        observedAtMs: 20,
      })]),
      durableSequenceCut: "20",
    });
    const delayedPage = new Deferred<ChatHistoryPageV4>();
    const loadHistoryV4 = vi.fn<ChatClient["loadHistoryV4"]>(() => delayedPage.promise);
    const { client, emitV4 } = fakeClient({
      resyncSessionV4: async (_context, sessionId) => projectionV4(sessionId, currentHistory),
      loadHistoryV4,
    });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-pagination-${storeSequence++}`,
      undefined,
      true,
    )();
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    const loading = store.loadOlderHistory();
    await vi.waitFor(() => expect(loadHistoryV4).toHaveBeenCalledOnce());
    emitV4(Object.freeze({ ...eventV4(1, "turn_started", sourceV4(11)), durableSequence: "11" }));
    emitV4(Object.freeze({ ...eventV4(2, "plan_updated", {
      ...sourceV4(12),
      explanation: null,
      steps: [{ ordinal: 0, step: "live plan", status: "in_progress" }],
    }), durableSequence: "12" }));
    emitV4(Object.freeze({ ...eventV4(3, "item_started", {
      ...sourceV4(13),
      itemId: "live-final",
      itemOrdinal: 1,
      itemType: "agentMessage",
      phase: "final_answer",
      text: "",
    }), durableSequence: "13" }));
    emitV4(Object.freeze({ ...eventV4(4, "agent_message_append", {
      ...sourceV4(14),
      itemId: "live-final",
      itemOrdinal: 1,
      phase: "final_answer",
      text: "live text",
    }), durableSequence: "14" }));
    emitV4(Object.freeze({ ...eventV4(5, "notice", {
      ...sourceV4(15),
      scope: "session",
      severity: "warning",
      code: "live_warning",
      willRetry: false,
    }, null), durableSequence: "15" }));
    const liveStreamPositions = store.conversationState.streamPositions;
    const liveProcessedEventIds = store.conversationState.processedEventIds;
    delayedPage.resolve(olderHistory);
    await loading;

    expect(store.conversationState.streamPositions).toBe(liveStreamPositions);
    expect(store.conversationState.processedEventIds).toBe(liveProcessedEventIds);
    expect(store.conversationState.threads[SESSION_A]?.notices).toHaveLength(1);
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A)).toMatchObject({
      ordinal: 1,
      status: "in_progress",
      plan: { steps: [{ ordinal: 0, text: "live plan", status: "in_progress" }] },
    });
    expect(selectConversationItem(store.conversationState, SESSION_A, TURN_A, "live-final"))
      .toMatchObject({ contentBlocks: [{ text: "live text" }] });
    expect(selectConversationTurn(store.conversationState, SESSION_A, oldTurnId))
      .toMatchObject({ ordinal: 0, status: "completed" });
    expect(store.history).toMatchObject({
      nextCursor: null,
      durableSequenceCut: "10",
      sessionNotices: [],
    });
  });

  it("keeps commentary separate, exposes only explicit final to legacy compatibility, and does not end the Turn on item completion", async () => {
    const resyncV4 = vi.fn<ChatClient["resyncSessionV4"]>(async (_context, sessionId) =>
      projectionV4(sessionId)
    );
    const { client, emitV4 } = fakeClient({ resyncSessionV4: resyncV4 });
    const store = createChatStoreDefinition(
      client,
      `chat-feat134-live-${storeSequence++}`,
      undefined,
      true,
    )();
    await store.bind(TENANT);
    await store.selectSession(SESSION_A);

    emitV4(eventV4(1, "turn_started", sourceV4(1)));
    emitV4(eventV4(2, "item_started", {
      ...sourceV4(2),
      itemId: "commentary-live",
      itemOrdinal: 1,
      itemType: "agentMessage",
      phase: "commentary",
      text: "",
    }));
    emitV4(eventV4(3, "agent_message_append", {
      ...sourceV4(3),
      itemId: "commentary-live",
      itemOrdinal: 1,
      phase: "commentary",
      text: "synthetic process",
    }));
    expect(store.liveAssistantText).toBe("");

    emitV4(eventV4(4, "item_started", {
      ...sourceV4(4),
      itemId: "final-live",
      itemOrdinal: 2,
      itemType: "agentMessage",
      phase: "final_answer",
      text: "",
    }));
    emitV4(eventV4(5, "agent_message_append", {
      ...sourceV4(5),
      itemId: "final-live",
      itemOrdinal: 2,
      phase: "final_answer",
      text: "synthetic final",
    }));
    emitV4(eventV4(6, "notice", {
      ...sourceV4(6),
      scope: "session",
      severity: "warning",
      code: null,
      willRetry: false,
    }, null));
    emitV4(eventV4(7, "item_completed", {
      ...sourceV4(7),
      itemId: "final-live",
      itemOrdinal: 2,
      itemType: "agentMessage",
      phase: "final_answer",
      text: "synthetic final",
    }));

    expect(store.liveAssistantText).toBe("synthetic final");
    expect(store.phase).toBe("streaming");
    expect(selectConversationTurn(store.conversationState, SESSION_A, TURN_A))
      .toMatchObject({ status: "in_progress", terminalStatus: null });
    expect(selectConversationItem(store.conversationState, SESSION_A, TURN_A, "commentary-live"))
      .toMatchObject({ agentMessagePhase: "commentary" });
    expect(selectConversationItem(store.conversationState, SESSION_A, TURN_A, "final-live"))
      .toMatchObject({ status: "completed", agentMessagePhase: "final_answer" });
    expect(store.conversationState.threads[SESSION_A]?.notices).toHaveLength(1);
    expect(resyncV4).toHaveBeenCalledOnce();
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
});
