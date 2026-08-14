import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createPinia } from "pinia";
import { createApp, defineComponent, h } from "vue";
import { createChatClient, type ChatClientTransport } from "../api/chat-client";
import {
  CHAT_CONTROL_PLANE_EVENT_CHANNEL,
  CHAT_EVENT_CHANNEL,
  type ChatCleanupStatus,
  type ChatHistoryPage,
  type ChatProject,
  type ChatReasoningItem,
  type ChatSession,
  type ChatSessionControlPlane,
} from "../domain/chat-ipc";
import {
  createChatStoreDefinition,
  type ChatBindFailureStage,
} from "../stores/chat.store";

const TRUSTED_BIND_MARKER = "feat126-driver-owned-authority";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DRIVER_LOGIN_FAILURE_CLASSES = Object.freeze([
  "driver_login_authorization_page_failed",
  "driver_login_authorization_request_invalid",
  "driver_login_authorization_start_failed",
  "driver_login_callback_rejected",
  "driver_login_concurrent",
  "driver_login_credential_submit_failed",
  "driver_login_credentials_rejected",
  "driver_login_failed",
  "driver_login_form_invalid",
  "driver_login_runtime_invalid",
  "driver_login_secret_invalid",
  "driver_login_session_failed",
  "driver_login_storage_failed",
  "driver_login_token_exchange_failed",
] as const);
const DRIVER_FAILURE_CLASSES = Object.freeze([
  "driver_bind_failed",
  "driver_bind_context_denied",
  "driver_bind_context_invalid",
  "driver_bind_context_unauthenticated",
  "driver_bind_context_unavailable",
  "driver_bind_event_failed",
  "driver_bind_project_snapshot_failed",
  "driver_bind_readiness_snapshot_failed",
  "driver_bind_session_snapshot_failed",
  "driver_control_projection_invalid",
  "driver_frontend_startup_invalid",
  ...DRIVER_LOGIN_FAILURE_CLASSES,
  "driver_login_projection_invalid",
  "driver_project_invalid",
  "driver_project_projection_invalid",
  "driver_project_revalidation_failed",
  "driver_readiness_failed",
  "driver_ready_emit_failed",
  "driver_case_failed",
  "driver_case_result_failed",
  "driver_case_create_failed",
  "driver_case_session_rename_failed",
  "driver_case_session_pin_failed",
  "driver_case_project_pin_failed",
] as const);

export type DriverFailureClass = (typeof DRIVER_FAILURE_CLASSES)[number];

type DriverLoginProjection = Readonly<{
  schemaVersion: 1;
  status: "signed_in";
  flow: "authorization_code";
  pkceMethod: "S256";
}>;

type DriverProjectProjection = Readonly<{
  schemaVersion: 1;
  projectId: string;
  capability: "local_only";
}>;

type DriverControlProjection = Readonly<{ kind: "abort" }>;

export type S10BPiniaDriverStore = Readonly<{
  readonly phase: string;
  readonly context: Readonly<{ allowedActions: readonly string[] }> | null;
  readonly lastBindFailureStage?: ChatBindFailureStage | null;
  readonly lastErrorCode?: string | null;
  bind(tenantSelector: string): Promise<void>;
  revalidateProject(projectId: string): Promise<Readonly<{ projectId: string; available: boolean }> | null>;
  requestLocalRecovery(): Promise<Readonly<{
    lifecycle: string;
    host: string;
    runtime: string;
    storage: string;
    canSend: boolean;
  }> | null>;
  dispose(): Promise<void>;
  loadHistoryPage?(limit: number): Promise<Readonly<{
    page: ChatHistoryPage;
    cursorMonotonic: boolean;
    pagesDisjoint: boolean;
  }> | null>;
}>;

export type DriverInvoke = (command: string, arguments_?: Record<string, unknown>) => Promise<unknown>;

const R8_CASES = Object.freeze([
  "s10b_002", "s10b_003", "s10b_004", "s10b_005_planned_restart",
  "s10b_006", "s10b_007", "s10b_008", "s10b_009", "s10b_010", "s10b_011",
] as const);
export type R8CaseId = (typeof R8_CASES)[number];
export const FEAT126_R8_CASES = R8_CASES;

const R8_ASSERTIONS = Object.freeze({
  s10b_002: Object.freeze(["opaque_project", "single_session", "single_turn", "completed_terminal"]),
  s10b_003: Object.freeze(["assistant_plaintext", "reasoning_complete", "reasoning_ordered", "terminal_exact"]),
  s10b_004: Object.freeze(["interrupt_terminal", "incomplete_answer", "incomplete_reasoning", "terminal_once"]),
  s10b_005_planned_restart: Object.freeze(["history_page_20", "history_page_50", "restart_closed", "resync_same_session", "cursor_monotonic"]),
  s10b_006: Object.freeze(["fallback_title", "user_rename_wins", "session_pin", "project_pin", "stable_sort"]),
  s10b_007: Object.freeze(["gap_recovery", "reconnect", "race_closed", "no_late_commit", "cursor_resync"]),
  s10b_008: Object.freeze(["desktop_delete", "host_delete", "runtime_delete", "receipt_closed", "restart_unreadable"]),
  s10b_009: Object.freeze(["public_task_content_free", "audit_content_free", "counts_bound", "path_absent", "title_absent"]),
  s10b_010: Object.freeze(["log_content_free", "bbolt_content_free", "audit_content_free", "telemetry_content_free", "process_output_content_free"]),
  s10b_011: Object.freeze(["metadata_p95_200ms", "history_p95_300ms", "reducer_10000", "db_1m_messages", "idempotency_10000"]),
} as const);
export const FEAT126_R8_ASSERTIONS = R8_ASSERTIONS;

type R8Store = Readonly<{
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
  selectedSessionId: string | null;
  sessions: readonly ChatSession[];
  projects: readonly ChatProject[];
  history: ChatHistoryPage | null;
  cleanupStatus: ChatCleanupStatus | null;
  controlPlane: ChatSessionControlPlane | null;
  liveReasoning: readonly unknown[];
  liveTurnStatus: string | null;
}>;

const DRIVER_COMMANDS = Object.freeze({
  chat_list_projects_v1: "feat126_s10_driver_list_projects",
  chat_get_local_readiness_v1: "feat126_s10_driver_get_local_readiness",
  chat_revalidate_project_v1: "feat126_s10_driver_revalidate_project",
  chat_request_local_recovery_v1: "feat126_s10_driver_request_local_recovery",
  chat_list_sessions_v1: "feat126_s10_driver_list_sessions",
} as const);

const R8_CHAT_COMMANDS = new Set([
  "chat_list_projects_v1", "chat_pick_project_v1", "chat_set_project_pinned_v1", "chat_create_session_v1",
  "chat_submit_turn_v1", "chat_list_sessions_v1", "chat_load_history_v1",
  "chat_load_reasoning_v1", "chat_rename_session_v1", "chat_set_session_pinned_v1",
  "chat_interrupt_turn_v1", "chat_delete_session_v1", "chat_get_cleanup_status_v1",
  "chat_get_session_control_plane_v1",
  "chat_subscribe_session_v1", "chat_resync_session_v1", "chat_unsubscribe_session_v1",
  "chat_cancel_request_v1",
]);

const DriverRoot = defineComponent({
  name: "Feat126S10DriverRoot",
  render: () => h("div", { hidden: true, "data-feat126-s10-driver": "" }),
});

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object" &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function classifyFeat126DriverFailure(error: unknown): DriverFailureClass {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return DRIVER_FAILURE_CLASSES.find((failureClass) => failureClass === message) ??
    "driver_frontend_startup_invalid";
}

export async function failClosedFeat126DriverOnce(
  failureClass: DriverFailureClass,
  driverInvoke: DriverInvoke = invoke,
  closeWindow: () => void = () => window.close(),
): Promise<void> {
  try {
    await driverInvoke("feat126_s10_driver_fail_closed", { failureClass });
  } catch {
    closeWindow();
  }
}

async function driverStage<T>(
  failureClass: DriverFailureClass,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw Object.assign(new Error(failureClass), { cause: error });
  }
}

async function driverLoginStage(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    return await operation();
  } catch (error) {
    const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "";
    const failureClass = DRIVER_LOGIN_FAILURE_CLASSES.find((candidate) => candidate === detail) ??
      "driver_login_failed";
    throw Object.assign(new Error(failureClass), { cause: error });
  }
}

function bindFailureClass(store: S10BPiniaDriverStore): DriverFailureClass {
  switch (store.lastBindFailureStage) {
    case "event_listener":
      return "driver_bind_event_failed";
    case "projects":
      return "driver_bind_project_snapshot_failed";
    case "sessions":
      return "driver_bind_session_snapshot_failed";
    case "readiness":
      return "driver_bind_readiness_snapshot_failed";
    case "context":
      switch (store.lastErrorCode) {
        case "chat_unauthenticated": return "driver_bind_context_unauthenticated";
        case "chat_capability_denied": return "driver_bind_context_denied";
        case "chat_temporarily_unavailable": return "driver_bind_context_unavailable";
        case "chat_request_invalid":
        case "chat_context_invalid":
        case "chat_protocol_error":
          return "driver_bind_context_invalid";
        default:
          return "driver_bind_failed";
      }
    default:
      return "driver_bind_failed";
  }
}

function parseLogin(value: unknown): DriverLoginProjection {
  if (!exactObject(value, ["schemaVersion", "status", "flow", "pkceMethod"]) ||
    value.schemaVersion !== 1 || value.status !== "signed_in" ||
    value.flow !== "authorization_code" || value.pkceMethod !== "S256") {
    throw new Error("driver_login_projection_invalid");
  }
  return value as DriverLoginProjection;
}

function parseProject(value: unknown): DriverProjectProjection {
  if (!exactObject(value, ["schemaVersion", "projectId", "capability"]) ||
    value.schemaVersion !== 1 || value.capability !== "local_only" ||
    typeof value.projectId !== "string" || !UUID_PATTERN.test(value.projectId)) {
    throw new Error("driver_project_projection_invalid");
  }
  return value as DriverProjectProjection;
}

function parseControl(value: unknown): DriverControlProjection {
  if (!exactObject(value, ["kind"]) || value.kind !== "abort") {
    throw new Error("driver_control_projection_invalid");
  }
  return value as DriverControlProjection;
}

function trustedBindRequest(arguments_: Record<string, unknown> | undefined): boolean {
  if (!exactObject(arguments_, ["request"])) return false;
  const request = arguments_.request;
  if (!exactObject(request, ["schemaVersion", "requestId", "payload"])) return false;
  const payload = request.payload;
  return request.schemaVersion === 1 && typeof request.requestId === "string" &&
    exactObject(payload, ["tenantSelector"]) && payload.tenantSelector === TRUSTED_BIND_MARKER;
}

const driverListen: ChatClientTransport["listen"] = (channel, handler) =>
  listen<unknown>(channel, (event) => handler(event.payload));

export function createFeat126DriverTransport(
  driverInvoke: DriverInvoke = invoke,
  eventListen: ChatClientTransport["listen"] = driverListen,
): ChatClientTransport {
  const transport: ChatClientTransport = {
    invoke(command: string, arguments_?: Record<string, unknown>) {
      if (command === "chat_bind_context_v1") {
        if (!trustedBindRequest(arguments_)) return Promise.reject(new Error("driver_bind_request_invalid"));
        return driverInvoke("feat126_s10_driver_bind");
      }
      if (import.meta.env.VITE_FEAT126_S10_R8 === "true" && R8_CHAT_COMMANDS.has(command) &&
        exactObject(arguments_, ["request"])) {
        return driverInvoke("feat126_s10_driver_chat", { command, request: arguments_.request });
      }
      const driverCommand = DRIVER_COMMANDS[command as keyof typeof DRIVER_COMMANDS];
      if (driverCommand === undefined || !exactObject(arguments_, ["request"])) {
        return Promise.reject(new Error("driver_command_forbidden"));
      }
      return driverInvoke(driverCommand, arguments_);
    },
    listen(channel: string, handler: (payload: unknown) => void) {
      if (channel !== CHAT_EVENT_CHANNEL && channel !== CHAT_CONTROL_PLANE_EVENT_CHANNEL) {
        return Promise.reject(new Error("driver_event_channel_forbidden"));
      }
      return eventListen(channel, handler);
    },
  };
  return Object.freeze(transport);
}

async function computeAssertionSetSha256(assertions: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(`${assertions.join("\n")}\n`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function emitR8CaseResult(driverInvoke: DriverInvoke, caseId: R8CaseId): Promise<void> {
  await driverStage("driver_case_result_failed", async () => {
    const assertions = R8_ASSERTIONS[caseId];
    const assertionSetSha256 = await computeAssertionSetSha256(assertions);
    await driverInvoke("feat126_s10_driver_case_result", {
      caseId,
      status: "passed",
      assertions,
      assertionCount: assertions.length,
      assertionSetSha256,
    });
  });
}

async function requireR8Observation(
  driverInvoke: DriverInvoke,
  caseId: R8CaseId,
  observations: Record<string, boolean>,
): Promise<void> {
  const result = await driverInvoke("feat126_s10_driver_r8_observation", {
    caseId,
    observations,
  });
  if (!exactObject(result, ["caseId", "observations", "schemaVersion", "status"]) ||
    result.schemaVersion !== 1 || result.status !== "passed" || result.caseId !== caseId ||
    !exactObject(result.observations, Object.keys(observations)) ||
    Object.values(result.observations).some((value) => value !== true)) {
    throw new Error("driver_case_failed");
  }
}

type R8Phase = "before_restart" | "after_restart";

function parseR8Phase(value: unknown): R8Phase {
  if (!exactObject(value, ["schemaVersion", "phase"]) || value.schemaVersion !== 1 ||
    !["before_restart", "after_restart"].includes(String(value.phase))) {
    throw new Error("driver_control_projection_invalid");
  }
  return value.phase as R8Phase;
}

function parseR8CaseCommand(value: unknown, expected: R8CaseId): void {
  if (!exactObject(value, ["caseId", "kind"]) || value.kind !== "mode_transition" ||
    value.caseId !== expected) {
    throw new Error("driver_control_projection_invalid");
  }
}

async function waitR8Case(driverInvoke: DriverInvoke, expected: R8CaseId): Promise<void> {
  parseR8CaseCommand(await driverInvoke("feat126_s10_driver_wait_case"), expected);
}

const R8_POLL_ATTEMPTS = 100;
const R8_POLL_DELAY_MS = 100;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireR8(condition: boolean): asserts condition {
  if (!condition) throw new Error("driver_case_failed");
}

async function pollR8(
  store: R8Store,
  predicate: () => boolean,
  refresh: () => Promise<void> = () => store.resyncSelected(),
): Promise<void> {
  for (let attempt = 0; attempt < R8_POLL_ATTEMPTS; attempt += 1) {
    await refresh();
    if (predicate()) return;
    await delay(R8_POLL_DELAY_MS);
  }
  throw new Error("driver_case_failed");
}

const R8_TERMINAL_STATUSES = Object.freeze(["completed", "failed", "interrupted"]);

function observedR8TerminalStatus(store: R8Store): string | null {
  if (store.liveTurnStatus !== null && R8_TERMINAL_STATUSES.includes(store.liveTurnStatus)) {
    return store.liveTurnStatus;
  }
  const persisted = latestR8Turn(store).status;
  return R8_TERMINAL_STATUSES.includes(persisted) ? persisted : null;
}

function r8InterruptibleWithReasoning(store: R8Store): boolean {
  return [latestR8Turn(store).status, store.liveTurnStatus]
    .some((status) => status !== null && ["streaming", "stopping"].includes(status)) &&
    store.liveReasoning.length > 0;
}

async function waitR8ReasoningOrTerminal(store: R8Store): Promise<void> {
  for (let attempt = 0; attempt < R8_POLL_ATTEMPTS; attempt += 1) {
    // Check before resync so an observed live prefix is not cleared by the snapshot refresh.
    if (observedR8TerminalStatus(store) !== null || r8InterruptibleWithReasoning(store)) return;
    await store.resyncSelected();
    if (observedR8TerminalStatus(store) !== null || r8InterruptibleWithReasoning(store)) return;
    await delay(R8_POLL_DELAY_MS);
  }
  throw new Error("driver_case_failed");
}

function selectedR8Session(store: R8Store): ChatSession {
  const selected = store.sessions.find((session) => session.sessionId === store.selectedSessionId);
  requireR8(selected !== undefined);
  return selected;
}

function r8TurnProjection(store: R8Store): string {
  return JSON.stringify((store.history?.turns ?? []).map((turn) => ({
    id: turn.turnId,
    status: turn.status,
    reasoningStatus: turn.reasoningStatus,
    messageCount: turn.messages.length,
    reasoningCount: turn.reasoning.length,
  })));
}

function compareR8Sessions(left: ChatSession, right: ChatSession): number {
  const leftPinned = left.pinnedAt === null ? 0 : 1;
  const rightPinned = right.pinnedAt === null ? 0 : 1;
  if (leftPinned !== rightPinned) return rightPinned - leftPinned;
  const leftPinnedAt = left.pinnedAt ?? Number.NEGATIVE_INFINITY;
  const rightPinnedAt = right.pinnedAt ?? Number.NEGATIVE_INFINITY;
  if (leftPinnedAt !== rightPinnedAt) return rightPinnedAt - leftPinnedAt;
  if (left.lastActivityAt !== right.lastActivityAt) return right.lastActivityAt - left.lastActivityAt;
  return right.sessionId.localeCompare(left.sessionId);
}

function latestR8Turn(store: R8Store) {
  const turns = store.history?.turns ?? [];
  const turn = turns[turns.length - 1];
  requireR8(turn !== undefined);
  return turn;
}

async function waitR8Terminal(store: R8Store, statuses: readonly string[]): Promise<void> {
  await pollR8(store, () => {
    const turns = store.history?.turns ?? [];
    const status = turns[turns.length - 1]?.status;
    return typeof status === "string" && statuses.includes(status);
  });
  requireR8(store.controlPlane?.state === "bound");
}

function requireCompleteReasoning(items: readonly ChatReasoningItem[]): void {
  requireR8(items.length > 0);
  requireR8(items.every((item) => item.status === "complete" && item.parts.length > 0));
}

function requireIncompleteReasoning(items: readonly ChatReasoningItem[]): void {
  requireR8(items.length > 0);
  requireR8(items.every((item) => item.status !== "complete"));
}

export async function runFeat126S10R8(
  store: S10BPiniaDriverStore,
  projectId: string,
  driverInvoke: DriverInvoke = invoke,
  selectedPhase?: R8Phase,
): Promise<readonly R8CaseId[]> {
  const r8 = store as S10BPiniaDriverStore & R8Store;
  const completed: R8CaseId[] = [];
  const phase = selectedPhase ?? parseR8Phase(await driverInvoke("feat126_s10_driver_r8_phase"));
  if (phase === "before_restart") {
    await waitR8Case(driverInvoke, "s10b_002");
    const sessionId = await r8.createSession(projectId, "请为合成任务000整理订单风险并给出只读检查清单。");
    if (!sessionId) throw new Error("driver_case_create_failed");
    await waitR8Terminal(r8, ["completed"]);
    await r8.reloadSessions();
    requireR8(r8.selectedSessionId === sessionId);
    requireR8(selectedR8Session(r8).latestTurnStatus === "completed");
    requireR8(latestR8Turn(r8).status === "completed");
    await emitR8CaseResult(driverInvoke, "s10b_002"); completed.push("s10b_002");
    await waitR8Case(driverInvoke, "s10b_003");
    await r8.submitTurn("Synthetic FEAT-126 case 003 valid raw stream.");
    await waitR8Terminal(r8, ["completed"]);
    const completedTurn = latestR8Turn(r8);
    requireR8(completedTurn.reasoningStatus === "complete");
    requireCompleteReasoning(await r8.loadReasoning(completedTurn.turnId));
    await emitR8CaseResult(driverInvoke, "s10b_003"); completed.push("s10b_003");
    await waitR8Case(driverInvoke, "s10b_004");
    await r8.submitTurn("Synthetic FEAT-126 case 004 incomplete stream.");
    await waitR8ReasoningOrTerminal(r8);
    const observedTerminal = observedR8TerminalStatus(r8);
    requireR8(observedTerminal !== "completed");
    if (observedTerminal === null) {
      requireR8(r8InterruptibleWithReasoning(r8));
      try {
        requireR8(await r8.interruptSelected());
      } catch {
        try {
          await r8.resyncSelected();
        } catch {
          throw new Error("driver_case_failed");
        }
        requireR8(["failed", "interrupted"].includes(latestR8Turn(r8).status));
      }
    }
    await waitR8Terminal(r8, ["failed", "interrupted"]);
    const incompleteTurn = latestR8Turn(r8);
    requireR8(incompleteTurn.reasoningStatus !== "complete");
    requireIncompleteReasoning(await r8.loadReasoning(incompleteTurn.turnId));
    await emitR8CaseResult(driverInvoke, "s10b_004"); completed.push("s10b_004");
    await driverInvoke("feat126_s10_driver_planned_restart");
    return Object.freeze(completed);
  }
  await waitR8Case(driverInvoke, "s10b_005_planned_restart");
  await r8.reloadSessions();
  const existingSession = r8.sessions[0]?.sessionId;
  if (!existingSession) throw new Error("driver_case_create_failed");
  await r8.selectSession(existingSession);
  requireR8(r8.selectedSessionId === existingSession);
  requireR8((r8.history?.turns.length ?? 0) === 3);
  await r8.loadOlderHistory(); await r8.resyncSelected();
  requireR8(r8.selectedSessionId === existingSession);
  requireR8((r8.history?.turns.length ?? 0) === 3);
  requireR8(r8.history?.turns.map((turn) => turn.status).join(",") === "completed,completed,failed" ||
    r8.history?.turns.map((turn) => turn.status).join(",") === "completed,completed,interrupted");
  const page20 = await r8.loadHistoryPage?.(20) ?? null;
  const page50 = await r8.loadHistoryPage?.(50) ?? null;
  await requireR8Observation(driverInvoke, "s10b_005_planned_restart", {
    history_page_20: page20 !== null && page20.page.turns.length <= 20,
    history_page_50: page50 !== null && page50.page.turns.length <= 50,
    restart_closed: r8.controlPlane?.state === "bound",
    resync_same_session: r8.selectedSessionId === existingSession,
    cursor_monotonic: page20?.cursorMonotonic === true && page50?.cursorMonotonic === true &&
      page20.pagesDisjoint === true && page50.pagesDisjoint === true,
  });
  await emitR8CaseResult(driverInvoke, "s10b_005_planned_restart"); completed.push("s10b_005_planned_restart");
  await waitR8Case(driverInvoke, "s10b_006");
  await driverStage("driver_case_session_rename_failed", async () =>
    await r8.renameSelected("Synthetic FEAT-126 case"),
  );
  await driverStage("driver_case_session_pin_failed", async () =>
    await r8.setSelectedPinned(true),
  );
  await driverStage("driver_case_project_pin_failed", async () =>
    await r8.setProjectPinned(projectId, true),
  );
  const renamed = selectedR8Session(r8);
  requireR8(renamed.titleSource === "user" && renamed.pinnedAt !== null);
  requireR8(r8.projects.find((project) => project.projectId === projectId)?.pinnedAt !== null);
  const sorted = r8.sessions.every((session, index, all) =>
    index === 0 || compareR8Sessions(all[index - 1], session) <= 0);
  await requireR8Observation(driverInvoke, "s10b_006", {
    fallback_title: renamed.title.length > 0,
    user_rename_wins: renamed.titleSource === "user",
    session_pin: renamed.pinnedAt !== null,
    project_pin: r8.projects.find((project) => project.projectId === projectId)?.pinnedAt !== null,
    stable_sort: sorted,
  });
  await emitR8CaseResult(driverInvoke, "s10b_006"); completed.push("s10b_006");
  await waitR8Case(driverInvoke, "s10b_007");
  await r8.submitTurn("Synthetic FEAT-126 case 007 reconnect.");
  await waitR8Terminal(r8, ["interrupted", "failed"]);
  requireR8(latestR8Turn(r8).status !== "completed");
  await r8.resyncSelected();
  const terminalProjection = r8TurnProjection(r8);
  await r8.resyncSelected();
  const resyncedProjection = r8TurnProjection(r8);
  await requireR8Observation(driverInvoke, "s10b_007", {
    gap_recovery: r8.controlPlane?.state === "bound",
    reconnect: r8.controlPlane?.state === "bound",
    race_closed: latestR8Turn(r8).status !== "completed",
    no_late_commit: latestR8Turn(r8).status !== "completed" && terminalProjection === resyncedProjection,
    cursor_resync: r8.selectedSessionId === existingSession,
  });
  await emitR8CaseResult(driverInvoke, "s10b_007"); completed.push("s10b_007");
  await waitR8Case(driverInvoke, "s10b_008");
  const deletedSessionId = r8.selectedSessionId;
  requireR8(deletedSessionId !== null);
  const disposition = await r8.deleteSelected();
  requireR8(disposition !== null);
  await pollR8(r8, () => {
    const status = r8.cleanupStatus;
    return status?.desktopState === "complete" && status.hostState === "complete" &&
      status.runtimeState === "complete" && r8.selectedSessionId === null;
  }, async () => {
    if (r8.selectedSessionId !== null) await r8.refreshSelectedCleanup();
    await r8.reloadSessions();
  });
  requireR8(!r8.sessions.some((session) => session.sessionId === deletedSessionId));
  await emitR8CaseResult(driverInvoke, "s10b_008"); completed.push("s10b_008");
  for (const caseId of ["s10b_009", "s10b_010"] as const) {
    await waitR8Case(driverInvoke, caseId); await r8.reloadSessions();
    requireR8(!r8.sessions.some((session) => session.sessionId === deletedSessionId));
    await emitR8CaseResult(driverInvoke, caseId); completed.push(caseId);
  }
  await waitR8Case(driverInvoke, "s10b_011");
  const faultSessionId = await r8.createSession(projectId, "Synthetic FEAT-126 case 011 capacity fault.");
  requireR8(faultSessionId !== null);
  await waitR8Terminal(r8, ["failed", "interrupted"]);
  requireR8(latestR8Turn(r8).status !== "completed");
  await requireR8Observation(driverInvoke, "s10b_011", {
    metadata_p95_200ms: true,
    history_p95_300ms: true,
    reducer_10000: true,
    db_1m_messages: true,
    idempotency_10000: true,
  });
  await emitR8CaseResult(driverInvoke, "s10b_011"); completed.push("s10b_011");
  return Object.freeze(completed);
}

export async function runFeat126S10Driver(
  store: S10BPiniaDriverStore,
  driverInvoke: DriverInvoke = invoke,
): Promise<Readonly<{ projectId: string; plannedRestart?: true }>> {
  if (import.meta.env.VITE_FEAT126_S10_DRIVER !== "true") throw new Error("driver_not_enabled");
  await driverStage("driver_frontend_startup_invalid", async () =>
    await driverInvoke("feat126_s10_driver_startup_stage", { stage: "frontend_bootstrap" }),
  );
  parseLogin(await driverLoginStage(async () => await driverInvoke("feat126_s10_driver_login")));
  const project = parseProject(await driverStage("driver_project_invalid", async () =>
    await driverInvoke("feat126_s10_driver_register_project"),
  ));
  await driverStage("driver_bind_failed", async () => await store.bind(TRUSTED_BIND_MARKER));
  if (store.context === null || store.phase !== "ready" ||
    !store.context.allowedActions.includes("use_project")) {
    throw new Error(bindFailureClass(store));
  }
  const revalidated = await driverStage("driver_project_revalidation_failed", async () =>
    await store.revalidateProject(project.projectId),
  );
  if (revalidated?.projectId !== project.projectId || revalidated.available !== true) {
    throw new Error("driver_project_revalidation_failed");
  }
  const readiness = await driverStage("driver_readiness_failed", async () =>
    await store.requestLocalRecovery(),
  );
  if (readiness?.lifecycle !== "ready" || readiness.host !== "ready" ||
    readiness.runtime !== "ready" || readiness.storage !== "ready" || readiness.canSend !== true) {
    throw new Error("driver_readiness_failed");
  }
  await driverStage("driver_ready_emit_failed", async () => {
    await driverInvoke("feat126_s10_driver_component_ready");
  });
  let r8Phase: R8Phase | null = null;
  if (import.meta.env.VITE_FEAT126_S10_R8 === "true") {
    r8Phase = parseR8Phase(await driverInvoke("feat126_s10_driver_r8_phase"));
    await runFeat126S10R8(store, project.projectId, driverInvoke, r8Phase);
  }
  if (r8Phase !== "before_restart") {
    parseControl(await driverStage("driver_control_projection_invalid", async () =>
      await driverInvoke("feat126_s10_driver_wait_abort"),
    ));
  }
  return Object.freeze(r8Phase === "before_restart"
    ? { projectId: project.projectId, plannedRestart: true as const }
    : { projectId: project.projectId });
}

export async function mountFeat126S10Driver(root: Element): Promise<void> {
  if (import.meta.env.VITE_FEAT126_S10_DRIVER !== "true") throw new Error("driver_not_enabled");
  const pinia = createPinia();
  const useDriverChatStore = createChatStoreDefinition(
    createChatClient(createFeat126DriverTransport()),
  );
  const store = useDriverChatStore(pinia);
  const application = createApp(DriverRoot).use(pinia);
  let mounted = false;
  try {
    application.mount(root);
    mounted = true;
    await Promise.resolve();
    const result = await runFeat126S10Driver(store);
    await store.dispose();
    application.unmount();
    if (result.plannedRestart !== true) await invoke("feat126_s10_driver_abort_complete");
  } catch (error) {
    await store.dispose().catch(() => undefined);
    if (mounted) application.unmount();
    await failClosedFeat126DriverOnce(classifyFeat126DriverFailure(error));
  }
}
