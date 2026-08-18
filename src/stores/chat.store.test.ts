import { createPinia, setActivePinia } from "pinia";
import { watch } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatClient } from "../api/chat-client";
import type {
  ChatAttachment,
  ChatAttachmentImportEvent,
  ChatControlPlaneEvent,
  ChatProjectionEvent,
  ChatResyncProjection,
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
} from "./chat.store";

const NOW = Date.parse("2026-08-03T12:00:00Z");
const TENANT = "019c1a00-0000-7000-8000-000000000002";
const CONTEXT = "019c1a00-0000-7000-8000-000000000003";
const CONTEXT_B = "019c1a00-0000-7000-8000-000000000004";
const SESSION_A = "019c1a00-0000-7000-8000-000000000005";
const SESSION_B = "019c1a00-0000-7000-8000-000000000006";
const TURN_A = "019c1a00-0000-7000-8000-000000000007";
const SESSION_CREATED = "019c1a00-0000-7000-8000-000000000008";

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
  emitControlPlane: (event: ChatControlPlaneEvent) => void;
  emitAttachmentImport: (event: ChatAttachmentImportEvent) => void;
  invalidate: () => void;
} {
  let eventHandler: (event: ChatProjectionEvent) => void = () => undefined;
  let invalidHandler: () => void = () => undefined;
  let controlPlaneHandler: (event: ChatControlPlaneEvent) => void = () => undefined;
  let attachmentImportHandler: (event: ChatAttachmentImportEvent) => void = () => undefined;
  const client: ChatClient = {
    bindContext: async () => ({
      contextId: CONTEXT,
      expiresAtEpochSeconds: Math.floor(NOW / 1000) + 300,
      allowedActions: [
        "read_sessions", "create_session", "submit_turn", "rename_session", "pin_session",
        "interrupt_turn", "delete_session", "read_projects", "use_project", "pin_project",
        "remove_project", "read_cleanup",
      ],
    }),
    listProjects: async () => [],
    pickProject: async () => null,
    revalidateProject: async () => { throw new Error("not used"); },
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
    resyncSession: async (_context, sessionId) => projection(sessionId),
    resyncSessionV2: (...arguments_) => client.resyncSession(...arguments_),
    unsubscribeSession: async () => true,
    cancelRequest: async () => true,
    onEvent: async (handler, onInvalid) => {
      eventHandler = handler;
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
    emitControlPlane: (value) => controlPlaneHandler(value),
    emitAttachmentImport: (value) => attachmentImportHandler(value),
    invalidate: () => invalidHandler(),
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
    expect(store.liveAssistantText).toBe("hello");

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
      nextSessionId: SESSION_B,
      path: `/chat/${SESSION_B}`,
    });
  });
});
