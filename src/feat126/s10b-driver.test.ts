import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import type { ChatClient } from "../api/chat-client";
import { createChatStoreDefinition, useChatStore, type LiveReasoningPart } from "../stores/chat.store";
import {
  classifyFeat126DriverFailure,
  createFeat126DriverTransport,
  failClosedFeat126DriverOnce,
  FEAT126_R8_CASES,
  runFeat126S10R8,
  runFeat126S10Driver,
  type DriverInvoke,
  type S10BPiniaDriverStore,
} from "./s10b-driver";
import {
  CHAT_CONTROL_PLANE_EVENT_CHANNEL,
  CHAT_EVENT_CHANNEL,
} from "../domain/chat-ipc";
import type {
  ChatCleanupStatus,
  ChatHistoryPage,
  ChatProject,
  ChatReasoningItem,
  ChatSession,
  ChatSessionControlPlane,
} from "../domain/chat-ipc";

const PROJECT_ID = "019fbd88-cbc3-7bf1-934d-7b05cd693f99";

describe("FEAT-126 S10BO2 driver", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_FEAT126_S10_DRIVER", "true");
    vi.stubEnv("VITE_FEAT126_S10_R8", "false");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("executes the closed login, project, bind, recovery and abort flow", async () => {
    const order: string[] = [];
    const driverInvoke: DriverInvoke = async (command) => {
      order.push(command);
      if (command === "feat126_s10_driver_login") {
        return { schemaVersion: 1, status: "signed_in", flow: "authorization_code", pkceMethod: "S256" };
      }
      if (command === "feat126_s10_driver_register_project") {
        return { schemaVersion: 1, projectId: PROJECT_ID, capability: "local_only" };
      }
      if (command === "feat126_s10_driver_wait_abort") return { kind: "abort" };
      return undefined;
    };
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind(selector) {
        order.push(`bind:${selector}`);
      },
      async revalidateProject(projectId) {
        order.push(`revalidate:${projectId}`);
        return { projectId, available: true };
      },
      async requestLocalRecovery() {
        order.push("requestLocalRecovery");
        return { lifecycle: "ready", host: "ready", runtime: "ready", storage: "ready", canSend: true };
      },
      async dispose() {},
    };

    await expect(runFeat126S10Driver(store, driverInvoke)).resolves.toEqual({ projectId: PROJECT_ID });
    expect(order).toEqual([
      "feat126_s10_driver_startup_stage",
      "feat126_s10_driver_login",
      "feat126_s10_driver_register_project",
      "bind:feat126-driver-owned-authority",
      `revalidate:${PROJECT_ID}`,
      "requestLocalRecovery",
      "feat126_s10_driver_component_ready",
      "feat126_s10_driver_wait_abort",
    ]);
  });

  it("never forwards a tenant selector through the trusted bind command", async () => {
    const calls: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    const transport = createFeat126DriverTransport(async (command, arguments_) => {
      calls.push([command, arguments_]);
      return { schemaVersion: 1 };
    });
    await transport.invoke("chat_bind_context_v1", {
      request: {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        payload: { tenantSelector: "feat126-driver-owned-authority" },
      },
    });
    expect(calls).toEqual([["feat126_s10_driver_bind", undefined]]);
    await expect(transport.invoke("chat_bind_context_v1", {
      request: {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        payload: { tenantSelector: "12500000-0000-4000-8000-100000000001" },
      },
    })).rejects.toThrow("driver_bind_request_invalid");
  });

  it("maps only the closed startup projection commands", async () => {
    const calls: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    const transport = createFeat126DriverTransport(async (command, arguments_) => {
      calls.push([command, arguments_]);
      return { schemaVersion: 1 };
    });
    const request = { schemaVersion: 1, requestId: crypto.randomUUID(), contextId: crypto.randomUUID(), payload: {} };
    await transport.invoke("chat_list_projects_v1", { request });
    expect(calls).toEqual([["feat126_s10_driver_list_projects", { request }]]);
    await expect(transport.invoke("chat_create_session_v1", { request }))
      .rejects.toThrow("driver_command_forbidden");
    await expect(transport.invoke("chat_submit_turn_v1", { request }))
      .rejects.toThrow("driver_command_forbidden");
    await expect(transport.invoke("chat_delete_session_v1", { request }))
      .rejects.toThrow("driver_command_forbidden");
  });

  it("routes only the reviewed production chat commands in R8 mode", async () => {
    vi.stubEnv("VITE_FEAT126_S10_R8", "true");
    const calls: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    const transport = createFeat126DriverTransport(async (command, arguments_) => {
      calls.push([command, arguments_]);
      return { schemaVersion: 1 };
    });
    const request = { schemaVersion: 1, requestId: crypto.randomUUID(), contextId: crypto.randomUUID(), payload: {} };
    await transport.invoke("chat_get_session_control_plane_v1", { request });
    expect(calls).toEqual([["feat126_s10_driver_chat", {
      command: "chat_get_session_control_plane_v1",
      request,
    }]]);
    await expect(transport.invoke("runtime_health", { request }))
      .rejects.toThrow("driver_command_forbidden");
  });

  it("executes the frozen R8 cases and accepts a natural terminal that wins the interrupt race", async () => {
    type MutableR8Store = S10BPiniaDriverStore & {
      selectedSessionId: string | null;
      sessions: ChatSession[];
      projects: ChatProject[];
      history: ChatHistoryPage | null;
      cleanupStatus: ChatCleanupStatus | null;
      controlPlane: ChatSessionControlPlane | null;
      liveReasoning: LiveReasoningPart[];
      liveTurnStatus: string | null;
      reasoning: Map<string, readonly ChatReasoningItem[]>;
      createSession(projectId: string, input: string): Promise<string | null>;
      submitTurn(input: string): Promise<void>;
      loadOlderHistory(): Promise<void>;
      loadReasoning(turnId: string): Promise<readonly ChatReasoningItem[]>;
      renameSelected(title: string): Promise<void>;
      setSelectedPinned(pinned: boolean): Promise<void>;
      setProjectPinned(projectId: string, pinned: boolean): Promise<void>;
      resyncSelected(): Promise<void>;
      reloadSessions(): Promise<void>;
      refreshControlPlane(): Promise<ChatSessionControlPlane | null>;
      refreshSelectedCleanup(): Promise<Readonly<{ kind: string }> | null>;
      interruptSelected(): Promise<boolean>;
      deleteSelected(): Promise<Readonly<{ kind: string }> | null>;
      selectSession(sessionId: string): Promise<void>;
      interruptCallCount: number;
      interruptObservedReasoningCount: number;
    };
    const turn = (ordinal: number, status: string, reasoningStatus: string) => Object.freeze({
      turnId: `019fbd88-cbc3-7bf1-934d-7b05cd693f${ordinal.toString().padStart(2, "0")}`,
      status,
      terminalAt: 1,
      reasoningStatus,
      reasoningReasonCode: reasoningStatus === "complete" ? null : "stream_gap",
      messages: Object.freeze([]),
      reasoning: Object.freeze([]),
    });
    const makeStore = (
      restored = false,
      naturalTerminalWinsInterrupt = false,
      staleInitialSessionProjection = false,
      delayedInterruptible = false,
    ): MutableR8Store => {
      const sessionId = "019fbd88-cbc3-7bf1-934d-7b05cd693f91";
      let incompleteInterruptPending = false;
      let queuedInterruptPending = false;
      const initialTurns = restored
        ? [turn(1, "completed", "complete"), turn(2, "completed", "complete"), turn(3, "failed", "incomplete")]
        : [];
      const store = {
        phase: "ready",
        context: { allowedActions: ["use_project"] },
        selectedSessionId: restored ? sessionId : null,
        sessions: restored ? [{
          sessionId, projectId: PROJECT_ID, title: "fallback", titleSource: "fallback" as const,
          pinnedAt: null, lastActivityAt: 1, latestTurnStatus: "failed", projectAvailable: true,
        }] : [],
        projects: [{ projectId: PROJECT_ID, safeName: "project", pinnedAt: null, lastUsedAt: 1, available: true }],
        history: restored ? { turns: Object.freeze(initialTurns), nextCursor: null } : null,
        cleanupStatus: null,
        controlPlane: restored ? { sessionId, state: "bound" as const, issueCode: null, retryable: false, recovery: "none" as const } : null,
        liveReasoning: [],
        liveTurnStatus: null,
        reasoning: new Map<string, readonly ChatReasoningItem[]>(),
        interruptCallCount: 0,
        interruptObservedReasoningCount: 0,
        async bind() {}, async revalidateProject() { return null; }, async requestLocalRecovery() { return null; }, async dispose() {},
        async createSession(projectId: string) {
          const isFault = this.sessions.length === 0 && restored;
          const nextId = isFault ? "019fbd88-cbc3-7bf1-934d-7b05cd693f92" : sessionId;
          const status = isFault ? "failed" : "completed";
          const reasoningStatus = isFault ? "unavailable" : "complete";
          this.selectedSessionId = nextId;
          this.sessions = [{
            sessionId: nextId, projectId, title: "fallback", titleSource: "fallback",
            pinnedAt: null, lastActivityAt: 1,
            latestTurnStatus: staleInitialSessionProjection && !isFault ? "queued" : status,
            projectAvailable: true,
          }];
          const nextTurn = turn(isFault ? 5 : 1, status, reasoningStatus);
          this.history = { turns: Object.freeze([nextTurn]), nextCursor: null };
          this.controlPlane = { sessionId: nextId, state: "bound", issueCode: null, retryable: false, recovery: "none" };
          this.reasoning.set(nextTurn.turnId, Object.freeze([{
            itemOrdinal: 0, status: isFault ? "unavailable" : "complete",
            reasonCode: isFault ? "limit_exceeded" : null, finalizedAtMs: 1,
            parts: isFault ? Object.freeze([]) : Object.freeze([{ contentIndex: 0, text: "synthetic" }]),
          }]));
          return nextId;
        },
        async submitTurn(input: string) {
          const incomplete = input.includes("004");
          const disconnected = input.includes("007");
          incompleteInterruptPending = incomplete && (naturalTerminalWinsInterrupt || delayedInterruptible);
          queuedInterruptPending = incomplete && delayedInterruptible;
          const status = queuedInterruptPending
            ? "queued"
            : incompleteInterruptPending
            ? "streaming"
            : incomplete ? "failed" : disconnected ? "interrupted" : "completed";
          const reasoningStatus = status === "completed" ? "complete" : "incomplete";
          const nextTurn = turn((this.history?.turns.length ?? 0) + 1, status, reasoningStatus);
          this.history = { turns: Object.freeze([...(this.history?.turns ?? []), nextTurn]), nextCursor: null };
          this.sessions = this.sessions.map((session) => ({ ...session, latestTurnStatus: status }));
          const reasoning = Object.freeze([{
            itemOrdinal: 0, status: reasoningStatus as "complete" | "incomplete",
            reasonCode: reasoningStatus === "complete" ? null : "stream_gap", finalizedAtMs: 1,
            parts: Object.freeze([{ contentIndex: 0, text: "synthetic" }]),
          }]);
          if (!delayedInterruptible || !incomplete) this.reasoning.set(nextTurn.turnId, reasoning);
          if (naturalTerminalWinsInterrupt && incomplete) {
            this.liveReasoning = [{ itemOrdinal: 0, contentIndex: 0, text: "synthetic" }];
            this.liveTurnStatus = "streaming";
          }
        },
        async loadOlderHistory() {},
        async loadHistoryPage(limit: number) {
          return {
            page: { turns: Object.freeze((this.history?.turns ?? []).slice(0, limit)), nextCursor: null },
            cursorMonotonic: true,
            pagesDisjoint: true,
          };
        },
        async loadReasoning(turnId: string) { return this.reasoning.get(turnId) ?? Object.freeze([]); },
        async renameSelected(title: string) { this.sessions = this.sessions.map((session) => ({ ...session, title, titleSource: "user" as const })); },
        async setSelectedPinned(pinned: boolean) { this.sessions = this.sessions.map((session) => ({ ...session, pinnedAt: pinned ? 1 : null })); },
        async setProjectPinned(projectId: string, pinned: boolean) { this.projects = this.projects.map((project) => project.projectId === projectId ? { ...project, pinnedAt: pinned ? 1 : null } : project); },
        async resyncSelected() {
          if (!queuedInterruptPending) return;
          queuedInterruptPending = false;
          queueMicrotask(() => {
            this.liveReasoning = [{ itemOrdinal: 0, contentIndex: 0, text: "synthetic" }];
            this.liveTurnStatus = "streaming";
          });
        },
        async reloadSessions() {
          const turns = this.history?.turns ?? [];
          const latest = turns[turns.length - 1]?.status;
          if (latest !== undefined) {
            this.sessions = this.sessions.map((session) => ({
              ...session,
              latestTurnStatus: latest,
            }));
          }
        },
        async refreshControlPlane() { return this.controlPlane; },
        async refreshSelectedCleanup() { return { kind: "navigate" }; },
        async interruptSelected() {
          if (!incompleteInterruptPending) return false;
          this.interruptCallCount += 1;
          this.interruptObservedReasoningCount = this.liveReasoning.length;
          incompleteInterruptPending = false;
          const turns = this.history?.turns ?? [];
          this.history = {
            turns: Object.freeze(turns.map((existing, index) => index === turns.length - 1
              ? Object.freeze({ ...existing, status: "failed" })
              : existing)),
            nextCursor: this.history?.nextCursor ?? null,
          };
          this.sessions = this.sessions.map((session) => ({ ...session, latestTurnStatus: "failed" }));
          this.liveTurnStatus = "failed";
          const interruptedTurn = turns[turns.length - 1];
          if (interruptedTurn !== undefined && this.liveReasoning.length > 0) {
            this.reasoning.set(interruptedTurn.turnId, Object.freeze([{
              itemOrdinal: 0, status: "incomplete", reasonCode: "turn_interrupted", finalizedAtMs: 1,
              parts: Object.freeze([{ contentIndex: 0, text: "synthetic" }]),
            }]));
          }
          if (naturalTerminalWinsInterrupt) throw new Error("chat_conflict");
          return true;
        },
        async deleteSelected() {
          this.cleanupStatus = { operationId: crypto.randomUUID(), desktopState: "complete", hostState: "complete", runtimeState: "complete", outcomeCode: "complete", lastErrorCode: null, requestedAt: 1, completedAt: 2, expiresAt: null };
          this.selectedSessionId = null; this.sessions = []; this.history = null; this.controlPlane = null;
          return { kind: "navigate" };
        },
        async selectSession(next: string) { this.selectedSessionId = next; },
      } satisfies MutableR8Store;
      for (const existing of initialTurns) {
        store.reasoning.set(existing.turnId, Object.freeze([{
          itemOrdinal: 0, status: existing.reasoningStatus as "complete" | "incomplete",
          reasonCode: existing.reasoningReasonCode, finalizedAtMs: 1,
          parts: Object.freeze([{ contentIndex: 0, text: "synthetic" }]),
        }]));
      }
      return store;
    };
    const executePhase = async (phase: "before_restart" | "after_restart", store: MutableR8Store) => {
      const expected = phase === "before_restart" ? FEAT126_R8_CASES.slice(0, 3) : FEAT126_R8_CASES.slice(3);
      const pending = [...expected];
      const observed: string[] = [];
      const invoke: DriverInvoke = async (command, arguments_) => {
        if (command === "feat126_s10_driver_wait_case") return { kind: "mode_transition", caseId: pending.shift() };
        if (command === "feat126_s10_driver_r8_observation") {
          const caseId = String(arguments_?.caseId);
          const observations = arguments_?.observations as Record<string, boolean>;
          return { caseId, observations, schemaVersion: 1, status: "passed" };
        }
        if (command === "feat126_s10_driver_case_result") { observed.push(String(arguments_?.caseId)); return undefined; }
        if (command === "feat126_s10_driver_planned_restart") { observed.push("planned_restart"); return undefined; }
        throw new Error("unexpected_command");
      };
      await expect(runFeat126S10R8(store, PROJECT_ID, invoke, phase)).resolves.toEqual(expected);
      expect(observed).toEqual(phase === "before_restart" ? [...expected, "planned_restart"] : expected);
    };
    await executePhase("before_restart", makeStore(false));
    await executePhase("before_restart", makeStore(false, true));
    await executePhase("before_restart", makeStore(false, false, true));
    const delayedInterruptible = makeStore(false, false, false, true);
    await executePhase("before_restart", delayedInterruptible);
    expect(delayedInterruptible.interruptCallCount).toBe(1);
    expect(delayedInterruptible.interruptObservedReasoningCount).toBe(1);
    expect(await delayedInterruptible.loadReasoning(delayedInterruptible.history!.turns[2]!.turnId)).toHaveLength(1);
    await executePhase("after_restart", makeStore(true));
  });

  it("fails closed when a native R8 observation is not true", async () => {
    const invoke: DriverInvoke = async (command, arguments_) => {
      if (command === "feat126_s10_driver_wait_case") return { kind: "mode_transition", caseId: "s10b_006" };
      if (command === "feat126_s10_driver_r8_observation") {
        return { caseId: arguments_?.caseId, observations: { ...(arguments_?.observations as Record<string, boolean>), stable_sort: false }, schemaVersion: 1, status: "passed" };
      }
      throw new Error("unexpected_command");
    };
    const store = {
      phase: "ready", context: { allowedActions: ["use_project"] }, selectedSessionId: "session",
      sessions: [{ sessionId: "session", projectId: PROJECT_ID, title: "title", titleSource: "user" as const, pinnedAt: 1, lastActivityAt: 1, latestTurnStatus: "interrupted", projectAvailable: true }],
      projects: [{ projectId: PROJECT_ID, safeName: "project", pinnedAt: 1, lastUsedAt: 1, available: true }],
      history: { turns: [{ turnId: "turn", status: "interrupted", terminalAt: 1, reasoningStatus: "incomplete", reasoningReasonCode: "stream_gap", messages: [], reasoning: [] }], nextCursor: null },
      cleanupStatus: null, controlPlane: { sessionId: "session", state: "bound" as const, issueCode: null, retryable: false, recovery: "none" as const },
      async bind() {}, async revalidateProject() { return null; }, async requestLocalRecovery() { return null; }, async dispose() {},
      async loadHistoryPage() { return null; }, async createSession() { return null; }, async submitTurn() {}, async loadOlderHistory() {}, async loadReasoning() { return []; },
      async renameSelected() {}, async setSelectedPinned() {}, async setProjectPinned() {}, async resyncSelected() {}, async reloadSessions() {}, async refreshControlPlane() { return null; }, async refreshSelectedCleanup() { return null; }, async interruptSelected() {}, async deleteSelected() { return null; }, async selectSession() {},
    } satisfies S10BPiniaDriverStore & Record<string, unknown>;
    const failure = await runFeat126S10R8(store, PROJECT_ID, invoke, "after_restart")
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("driver_case_failed");
    const projected: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    await failClosedFeat126DriverOnce(
      classifyFeat126DriverFailure(failure),
      async (command, arguments_) => { projected.push([command, arguments_]); },
    );
    expect(projected).toEqual([[
      "feat126_s10_driver_fail_closed",
      { failureClass: "driver_case_failed" },
    ]]);
  });

  it("subscribes only to approved chat channels and forwards payloads with unlisten", async () => {
    const subscriptions: Array<readonly [string, (payload: unknown) => void]> = [];
    const unlisten = vi.fn();
    const transport = createFeat126DriverTransport(undefined, async (channel, handler) => {
      subscriptions.push([channel, handler]);
      return unlisten;
    });
    await expect(transport.listen("unreviewed.event", () => undefined))
      .rejects.toThrow("driver_event_channel_forbidden");
    expect(subscriptions).toHaveLength(0);
    const received: unknown[] = [];
    const stopEvents = await transport.listen(CHAT_EVENT_CHANNEL, (payload) => received.push(payload));
    const stopControlPlane = await transport.listen(CHAT_CONTROL_PLANE_EVENT_CHANNEL, (payload) => received.push(payload));
    expect(subscriptions.map(([channel]) => channel)).toEqual([
      CHAT_EVENT_CHANNEL,
      CHAT_CONTROL_PLANE_EVENT_CHANNEL,
    ]);
    subscriptions[0]![1]({ kind: "reasoning_append" });
    subscriptions[1]![1]({ state: "bound" });
    expect(received).toEqual([{ kind: "reasoning_append" }, { state: "bound" }]);
    stopEvents();
    stopControlPlane();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("fails before ready emission when project or readiness evidence is not exact", async () => {
    const calls: string[] = [];
    const driverInvoke: DriverInvoke = async (command) => {
      calls.push(command);
      if (command === "feat126_s10_driver_login") {
        return { schemaVersion: 1, status: "signed_in", flow: "authorization_code", pkceMethod: "S256" };
      }
      if (command === "feat126_s10_driver_register_project") {
        return { schemaVersion: 1, projectId: PROJECT_ID, capability: "local_only" };
      }
      return undefined;
    };
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() {},
      async revalidateProject(projectId) {
        return { projectId, available: true };
      },
      async requestLocalRecovery() {
        return { lifecycle: "blocked", host: "unavailable", runtime: "unavailable", storage: "ready", canSend: false };
      },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, driverInvoke)).rejects.toThrow("driver_readiness_failed");
    expect(calls).not.toContain("feat126_s10_driver_component_ready");
  });

  it.each([
    ["event_listener", null, "driver_bind_event_failed"],
    ["context", "chat_unauthenticated", "driver_bind_context_unauthenticated"],
    ["context", "chat_capability_denied", "driver_bind_context_denied"],
    ["context", "chat_temporarily_unavailable", "driver_bind_context_unavailable"],
    ["context", "chat_request_invalid", "driver_bind_context_invalid"],
    ["projects", null, "driver_bind_project_snapshot_failed"],
    ["sessions", null, "driver_bind_session_snapshot_failed"],
    ["readiness", null, "driver_bind_readiness_snapshot_failed"],
  ] as const)("projects the closed %s bind leaf", async (stage, errorCode, failureClass) => {
    const store: S10BPiniaDriverStore = {
      phase: "unavailable",
      context: null,
      lastBindFailureStage: stage,
      lastErrorCode: errorCode,
      async bind() {},
      async revalidateProject() { return null; },
      async requestLocalRecovery() { return null; },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async (command) => {
      if (command === "feat126_s10_driver_startup_stage") return undefined;
      if (command === "feat126_s10_driver_login") {
        return { schemaVersion: 1, status: "signed_in", flow: "authorization_code", pkceMethod: "S256" };
      }
      if (command === "feat126_s10_driver_register_project") {
        return { schemaVersion: 1, projectId: PROJECT_ID, capability: "local_only" };
      }
      return undefined;
    })).rejects.toThrow(failureClass);
  });

  it("projects only closed startup leaves and never forwards an unknown error", () => {
    expect(classifyFeat126DriverFailure(new Error("driver_readiness_failed")))
      .toBe("driver_readiness_failed");
    expect(classifyFeat126DriverFailure("driver_case_failed"))
      .toBe("driver_case_failed");
    expect(classifyFeat126DriverFailure(new Error("token=must-not-cross-the-boundary")))
      .toBe("driver_frontend_startup_invalid");
    expect(classifyFeat126DriverFailure("token=must-not-cross-the-boundary"))
      .toBe("driver_frontend_startup_invalid");
  });

  it("preserves only reviewed native login stage leaves", async () => {
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() {},
      async revalidateProject() { return null; },
      async requestLocalRecovery() { return null; },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async (command) => {
      if (command === "feat126_s10_driver_startup_stage") return undefined;
      throw "driver_login_credentials_rejected";
    })).rejects.toThrow("driver_login_credentials_rejected");
    const unknown = runFeat126S10Driver(store, async (command) => {
      if (command === "feat126_s10_driver_startup_stage") return undefined;
      throw "token=must-not-cross-the-boundary";
    });
    await expect(unknown).rejects.toThrow("driver_login_failed");
    await expect(unknown).rejects.not.toThrow("token=must-not-cross-the-boundary");
  });

  it("attempts fail-closed exactly once and closes locally when IPC is unavailable", async () => {
    const calls: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    let closeCount = 0;
    await failClosedFeat126DriverOnce(
      "driver_frontend_startup_invalid",
      async (command, arguments_) => {
        calls.push([command, arguments_]);
        throw new Error("untrusted IPC detail");
      },
      () => { closeCount += 1; },
    );
    expect(calls).toEqual([[
      "feat126_s10_driver_fail_closed",
      { failureClass: "driver_frontend_startup_invalid" },
    ]]);
    expect(closeCount).toBe(1);
  });

  it("preserves the first failing startup stage and does not continue toward ready", async () => {
    const calls: string[] = [];
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() { calls.push("bind"); },
      async revalidateProject() { calls.push("revalidate"); return null; },
      async requestLocalRecovery() { calls.push("recovery"); return null; },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async (command) => {
      calls.push(command);
      throw new Error("untrusted native detail");
    })).rejects.toThrow("driver_frontend_startup_invalid");
    expect(calls).toEqual(["feat126_s10_driver_startup_stage"]);
  });

  it("binds the first frontend IPC to the exact content-free bootstrap stage", async () => {
    const calls: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() {},
      async revalidateProject() { return null; },
      async requestLocalRecovery() { return null; },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async (command, arguments_) => {
      calls.push([command, arguments_]);
      throw new Error("closed");
    })).rejects.toThrow("driver_frontend_startup_invalid");
    expect(calls).toEqual([[
      "feat126_s10_driver_startup_stage",
      { stage: "frontend_bootstrap" },
    ]]);
  });

  it("classifies component-ready emission failure before waiting for abort", async () => {
    const calls: string[] = [];
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() {},
      async revalidateProject(projectId) { return { projectId, available: true }; },
      async requestLocalRecovery() {
        return { lifecycle: "ready", host: "ready", runtime: "ready", storage: "ready", canSend: true };
      },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async (command) => {
      calls.push(command);
      if (command === "feat126_s10_driver_login") {
        return { schemaVersion: 1, status: "signed_in", flow: "authorization_code", pkceMethod: "S256" };
      }
      if (command === "feat126_s10_driver_register_project") {
        return { schemaVersion: 1, projectId: PROJECT_ID, capability: "local_only" };
      }
      if (command === "feat126_s10_driver_component_ready") throw new Error("write failed");
      return undefined;
    })).rejects.toThrow("driver_ready_emit_failed");
    expect(calls).not.toContain("feat126_s10_driver_wait_abort");
  });

  it("rejects unknown fields in native driver projections", async () => {
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() {},
      async revalidateProject() { return null; },
      async requestLocalRecovery() { return null; },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async () => ({
      schemaVersion: 1,
      status: "signed_in",
      flow: "authorization_code",
      pkceMethod: "S256",
      bearer: "forbidden",
    }))).rejects.toThrow("driver_login_projection_invalid");
  });

  it("pre-installs the trusted client under the production Pinia store id", () => {
    const pinia = createPinia();
    const useDriverStore = createChatStoreDefinition({} as ChatClient);
    const driverStore = useDriverStore(pinia);
    expect(useChatStore(pinia)).toBe(driverStore);
  });
});
