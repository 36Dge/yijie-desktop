import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatClient } from "../api/chat-client";
import type {
  ChatControlPlaneEvent,
  ChatProjectionEvent,
  ChatResyncProjection,
  ChatSession,
} from "../domain/chat-ipc";
import { ChatClientError } from "../domain/chat-ipc";
import { createChatStoreDefinition } from "./chat.store";

const NOW = Date.parse("2026-08-03T12:00:00Z");
const TENANT = "019c1a00-0000-7000-8000-000000000002";
const CONTEXT = "019c1a00-0000-7000-8000-000000000003";
const CONTEXT_B = "019c1a00-0000-7000-8000-000000000004";
const SESSION_A = "019c1a00-0000-7000-8000-000000000005";
const SESSION_B = "019c1a00-0000-7000-8000-000000000006";
const TURN_A = "019c1a00-0000-7000-8000-000000000007";

let storeSequence = 0;

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => { this.resolvePromise = resolve; });
  }

  resolve(value: T): void {
    this.resolvePromise(value);
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

function fakeClient(overrides: Partial<ChatClient> = {}): {
  client: ChatClient;
  emit: (event: ChatProjectionEvent) => void;
  emitControlPlane: (event: ChatControlPlaneEvent) => void;
  invalidate: () => void;
} {
  let eventHandler: (event: ChatProjectionEvent) => void = () => undefined;
  let invalidHandler: () => void = () => undefined;
  let controlPlaneHandler: (event: ChatControlPlaneEvent) => void = () => undefined;
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
    listSessions: async () => ({ sessions: [session(SESSION_A), session(SESSION_B)], nextCursor: null }),
    loadHistory: async () => ({ turns: [], nextCursor: null }),
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
    ...overrides,
  };
  return {
    client,
    emit: (value) => eventHandler(value),
    emitControlPlane: (value) => controlPlaneHandler(value),
    invalidate: () => invalidHandler(),
  };
}

function createStore(client: ChatClient) {
  return createChatStoreDefinition(client, `chat-test-${storeSequence++}`)();
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
