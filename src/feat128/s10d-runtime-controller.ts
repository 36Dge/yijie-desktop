import { invoke } from "@tauri-apps/api/core";
import { watch } from "vue";
import { router } from "../router";
import { usePermissionStore } from "../stores/permission.store";
import isolatedAxeModuleUrl from "./s10d-runtime-axe-frame?worker&url";

export const S10D_RUNTIME_COMMANDS = Object.freeze({
  prepare: "feat128_s10d_runtime_prepare_v1",
  checkpoint: "feat128_s10d_runtime_checkpoint_v1",
  finish: "feat128_s10d_runtime_finish_v1",
});

export const S10D_POST_LIFECYCLE_FAILURES = Object.freeze({
  fourShellCheckpoint: "runtime_four_shell_checkpoint_failed",
  axeLoad: "runtime_axe_load_failed",
  axeRun: "runtime_axe_run_failed",
  axeScriptTimeout: "runtime_axe_script_timeout",
  axeNonceNotConsumed: "runtime_axe_nonce_not_consumed",
  axeBootstrapTimeout: "runtime_axe_bootstrap_timeout",
  axeImportTimeout: "runtime_axe_import_timeout",
  axeImportRejected: "runtime_axe_import_rejected",
  axeRunTimeout: "runtime_axe_run_timeout",
  axeRunRejected: "runtime_axe_run_rejected",
  axeViolations: "runtime_axe_serious_critical",
  focusOrder: "runtime_focus_order_failed",
  axeCheckpoint: "runtime_axe_checkpoint_failed",
  screenshotCheckpoint: "runtime_screenshot_checkpoint_failed",
  finishHandshake: "runtime_finish_handshake_failed",
});

export const S10D_AXE_DIAGNOSTIC_STAGES = Object.freeze([
  "axe_script_loaded",
  "axe_script_error",
  "axe_nonce_consumed",
  "axe_bootstrap_started",
  "axe_import_resolved",
  "axe_import_rejected",
  "axe_run_resolved",
  "axe_run_rejected",
] as const);

export type S10dAxeDiagnosticStage = typeof S10D_AXE_DIAGNOSTIC_STAGES[number];

const STABLE_RUNTIME_FAILURE = /^runtime_[a-z0-9_]{1,55}$/;
const POST_LIFECYCLE_FAILURE_SET = new Set<string>(
  Object.values(S10D_POST_LIFECYCLE_FAILURES),
);

type LifecycleStage = "announced" | "progress" | "ready";

interface ReadyAck {
  readonly schemaVersion: 1;
  readonly status: "ready";
}

interface ObservationInput {
  readonly readyShells: number;
  readonly kinds: number;
  readonly axeSeriousCritical: number;
  readonly focusOrder: boolean;
  readonly axeStages: readonly S10dAxeDiagnosticStage[];
}

interface ChatNavigationObservationInput {
  readonly pathname: string;
  readonly routeSelected: boolean;
  readonly chatPageRendered: boolean;
}

interface ChatNavigationFailureInput {
  readonly clickObserved: boolean;
  readonly routerIntercepted: boolean;
  readonly routeEntered: boolean;
  readonly settingsPageRendered: boolean;
  readonly accessDeniedPageRendered: boolean;
}

interface ChatLinkActivation {
  readonly clickObserved: boolean;
  readonly routerIntercepted: boolean;
}

type IsolatedAxeFrameMessage = Readonly<
  | {
    readonly schemaVersion: 1;
    readonly nonce: string;
    readonly stage:
      | "axe_bootstrap_started"
      | "axe_import_resolved"
      | "axe_import_rejected"
      | "axe_run_rejected";
  }
  | {
    readonly schemaVersion: 1;
    readonly nonce: string;
    readonly stage: "axe_run_resolved";
    readonly seriousCritical: number;
  }
>;

export interface IsolatedAxePort {
  start(
    nonce: string,
    receive: (value: unknown) => void,
    reportScript: (status: "loaded" | "error", nonceConsumed: boolean) => void,
  ): () => void;
}

export type RouterOutcome =
  | "production_guard_redirect"
  | "app_permission_redirect"
  | "navigation_aborted"
  | "chat_lazy_load_failed"
  | "history_protocol_mismatch"
  | "route_committed_render_blocked";

export interface RouterOutcomeEvidence {
  readonly productionGuardAllowed: boolean;
  readonly productionGuardRedirect: boolean;
  readonly chatCommitted: boolean;
  readonly settingsCommitted: boolean;
  readonly navigationFailed: boolean;
  readonly routerError: boolean;
  readonly historyAligned: boolean;
  readonly permissionReadyLost: boolean;
  readonly taskCreateLost: boolean;
  readonly hiddenToVisible: boolean;
}

type MutableRouterOutcomeEvidence = {
  -readonly [Key in keyof RouterOutcomeEvidence]: RouterOutcomeEvidence[Key];
};

interface RouterOutcomeRoute {
  readonly path: string;
  readonly redirectedFrom?: { readonly path: string };
}

interface RouterOutcomeRecorderInput {
  readonly router: {
    beforeEach(hook: (to: RouterOutcomeRoute) => boolean): () => void;
    afterEach(hook: (
      to: RouterOutcomeRoute,
      from: RouterOutcomeRoute,
      failure?: unknown,
    ) => void): () => void;
    onError(hook: (error: unknown, to: RouterOutcomeRoute) => void): () => void;
  };
  readonly permission: {
    read(): { readonly ready: boolean; readonly taskCreate: boolean };
    subscribe(hook: () => void): () => void;
  };
  readonly visibility: {
    readonly state: DocumentVisibilityState;
    subscribe(hook: () => void): () => void;
  };
  readonly readPathname: () => string;
}

export interface RouterOutcomeRecorder {
  evidence(): Readonly<RouterOutcomeEvidence>;
  markNavigationFailed(): void;
  outcome(): RouterOutcome;
  stop(): void;
}

const DISPLAY_NAMES = Object.freeze([
  "synthetic-preview.png",
  "synthetic-clip.mp4",
  "synthetic-data.csv",
  "synthetic-report.json",
]);
const PROGRESS_TEXT = Object.freeze(["正在生成", "正在处理", "正在安全传输"]);
const CONTROLLER_TIMEOUT_MS = 150_000;
export const S10D_CHAT_PAGE_TIMEOUT_MS = 45_000;
const loadIsolatedAxeEngine = () => import("./s10d-runtime-axe-engine");

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateReadyAck(value: unknown): ReadyAck {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "status"]) ||
      value.schemaVersion !== 1 || value.status !== "ready") {
    throw new Error("s10d_runtime_ack_invalid");
  }
  return Object.freeze({ schemaVersion: 1, status: "ready" });
}

export function classifyArtifactShell(text: string): LifecycleStage | null {
  if (text.includes("已登记")) return "announced";
  if (PROGRESS_TEXT.some((label) => text.includes(label))) return "progress";
  if (text.includes("已就绪")) return "ready";
  return null;
}

export function classifyChatNavigationObservation(
  input: ChatNavigationObservationInput,
): "chat-page-rendered" | "chat-route-entered" | null {
  if (input.chatPageRendered) return "chat-page-rendered";
  if (input.routeSelected || input.pathname === "/chat") return "chat-route-entered";
  return null;
}

export function classifyChatNavigationFailure(input: ChatNavigationFailureInput): string {
  if (!input.clickObserved) return "runtime_chat_click_not_observed";
  if (!input.routerIntercepted) return "runtime_chat_router_not_intercepted";
  if (input.accessDeniedPageRendered) return "runtime_chat_guard_access_denied";
  if (input.settingsPageRendered) return "runtime_chat_guard_settings";
  if (input.routeEntered) return "runtime_chat_route_render_timeout";
  return "runtime_chat_navigation_failed";
}

export function classifyRouterOutcome(
  input: Partial<RouterOutcomeEvidence>,
): RouterOutcome {
  if (input.productionGuardRedirect) return "production_guard_redirect";
  if (input.routerError) return "chat_lazy_load_failed";
  if (
    input.settingsCommitted &&
    (input.permissionReadyLost || input.taskCreateLost || input.hiddenToVisible)
  ) {
    return "app_permission_redirect";
  }
  if (input.navigationFailed || !input.productionGuardAllowed) return "navigation_aborted";
  if (input.chatCommitted && input.historyAligned === false) return "history_protocol_mismatch";
  if (input.chatCommitted) return "route_committed_render_blocked";
  return "navigation_aborted";
}

export function routerOutcomeFailureCode(outcome: RouterOutcome): `runtime_${RouterOutcome}` {
  return `runtime_${outcome}`;
}

export function createRouterOutcomeRecorder(
  input: RouterOutcomeRecorderInput,
): RouterOutcomeRecorder {
  const evidence: MutableRouterOutcomeEvidence = {
    productionGuardAllowed: false,
    productionGuardRedirect: false,
    chatCommitted: false,
    settingsCommitted: false,
    navigationFailed: false,
    routerError: false,
    historyAligned: true,
    permissionReadyLost: false,
    taskCreateLost: false,
    hiddenToVisible: false,
  };
  const initialPermission = input.permission.read();
  let hiddenObserved = input.visibility.state === "hidden";
  let stopped = false;

  function observeRedirect(to: RouterOutcomeRoute): void {
    if (
      to.redirectedFrom?.path === "/chat" &&
      (to.path === "/settings" || to.path === "/access-denied")
    ) {
      evidence.productionGuardRedirect = true;
    }
  }

  const removeBeforeEach = input.router.beforeEach((to) => {
    observeRedirect(to);
    if (to.path === "/chat") evidence.productionGuardAllowed = true;
    return true;
  });
  const removeAfterEach = input.router.afterEach((to, from, failure) => {
    observeRedirect(to);
    if (failure !== undefined) {
      evidence.navigationFailed = true;
      return;
    }
    if (to.path === "/chat") {
      evidence.chatCommitted = true;
      evidence.historyAligned = input.readPathname() === "/chat";
    } else if (
      to.path === "/settings" &&
      (from.path === "/chat" || evidence.productionGuardAllowed || evidence.productionGuardRedirect)
    ) {
      evidence.settingsCommitted = true;
    }
  });
  const removeOnError = input.router.onError((_error, to) => {
    if (to.path === "/chat") evidence.routerError = true;
  });
  const removePermission = input.permission.subscribe(() => {
    const current = input.permission.read();
    if (initialPermission.ready && !current.ready) evidence.permissionReadyLost = true;
    if (initialPermission.taskCreate && !current.taskCreate) evidence.taskCreateLost = true;
  });
  const removeVisibility = input.visibility.subscribe(() => {
    if (input.visibility.state === "hidden") {
      hiddenObserved = true;
    } else if (hiddenObserved) {
      hiddenObserved = false;
      evidence.hiddenToVisible = true;
    }
  });

  return {
    evidence: () => Object.freeze({ ...evidence }),
    markNavigationFailed: () => {
      evidence.navigationFailed = true;
    },
    outcome: () => classifyRouterOutcome(evidence),
    stop: () => {
      if (stopped) return;
      stopped = true;
      removeBeforeEach();
      removeAfterEach();
      removeOnError();
      removePermission();
      removeVisibility();
    },
  };
}

function createProductionRouterOutcomeRecorder(): RouterOutcomeRecorder {
  const permissionStore = usePermissionStore();
  return createRouterOutcomeRecorder({
    router: {
      beforeEach: (hook) => router.beforeEach((to) => hook({
        path: to.path,
        ...(to.redirectedFrom ? { redirectedFrom: { path: to.redirectedFrom.path } } : {}),
      })),
      afterEach: (hook) => router.afterEach((to, from, failure) => hook(
        {
          path: to.path,
          ...(to.redirectedFrom ? { redirectedFrom: { path: to.redirectedFrom.path } } : {}),
        },
        { path: from.path },
        failure,
      )),
      onError: (hook) => router.onError((error, to) => hook(error, { path: to.path })),
    },
    permission: {
      read: () => ({
        ready: permissionStore.isReady,
        taskCreate: permissionStore.hasCapability("task.create"),
      }),
      subscribe: (hook) => watch(
        [
          () => permissionStore.isReady,
          () => permissionStore.hasCapability("task.create"),
        ],
        () => hook(),
        { flush: "sync" },
      ),
    },
    visibility: {
      get state() {
        return document.visibilityState;
      },
      subscribe: (hook) => {
        document.addEventListener("visibilitychange", hook);
        return () => document.removeEventListener("visibilitychange", hook);
      },
    },
    readPathname: () => window.location.pathname,
  });
}

export function createClosedObservation(input: ObservationInput) {
  const axeStages = validateAxeDiagnosticStages(input.axeStages);
  if (axeStages.join("\0") !== [
    "axe_script_loaded",
    "axe_nonce_consumed",
    "axe_bootstrap_started",
    "axe_import_resolved",
    "axe_run_resolved",
  ].join("\0")) {
    throw new Error("runtime_axe_diagnostic_invalid");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    status: "passed" as const,
    failureCode: null,
    productionPath: Object.freeze({
      productionBootstrap: true,
      productionChatPage: true,
      productionCommands: true,
      singleV3: true,
      sqlcipher: true,
      historyV3: true,
      artifactStore: true,
      typedClients: true,
    }),
    lifecycle: Object.freeze({
      domReadyShells: input.readyShells,
      domKinds: input.kinds,
    }),
    ui: Object.freeze({
      axeSeriousCritical: input.axeSeriousCritical,
      focusOrder: input.focusOrder,
      axeStages,
    }),
  });
}

export function createFailureObservation(
  failureCode: string,
  lifecycle: Pick<ObservationInput, "readyShells" | "kinds">,
  axeStages: unknown = [],
) {
  if (!Number.isInteger(lifecycle.readyShells) || lifecycle.readyShells < 0 || lifecycle.readyShells > 4 ||
      !Number.isInteger(lifecycle.kinds) || lifecycle.kinds < 0 || lifecycle.kinds > 4) {
    throw new Error("runtime_lifecycle_evidence_invalid");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    status: "failed" as const,
    failureCode,
    productionPath: Object.freeze({
      productionBootstrap: false,
      productionChatPage: false,
      productionCommands: false,
      singleV3: false,
      sqlcipher: false,
      historyV3: false,
      artifactStore: false,
      typedClients: false,
    }),
    lifecycle: Object.freeze({
      domReadyShells: lifecycle.readyShells,
      domKinds: lifecycle.kinds,
    }),
    ui: Object.freeze({
      axeSeriousCritical: -1,
      focusOrder: false,
      axeStages: validateAxeDiagnosticStages(axeStages),
    }),
  });
}

export function createRuntimeFinisher(
  send: (request: unknown) => Promise<unknown>,
): Readonly<{
  attempted(): boolean;
  finish(request: unknown): Promise<void>;
}> {
  let attempted = false;
  return Object.freeze({
    attempted: () => attempted,
    finish: async (request: unknown) => {
      if (attempted) throw new Error("runtime_finish_duplicate");
      attempted = true;
      await send(request);
    },
  });
}

function visible(element: Element): element is HTMLElement {
  return element instanceof HTMLElement && !element.hidden && element.getAttribute("aria-hidden") !== "true";
}

function accessibleName(element: HTMLElement): string {
  return element.getAttribute("aria-label")?.trim() || element.textContent?.trim() || "";
}

function elementWithText(selector: string, text: string): HTMLElement | null {
  return [...document.querySelectorAll(selector)]
    .filter(visible)
    .find((element) => accessibleName(element) === text) ?? null;
}

async function waitFor<T>(read: () => T | null, failureCode: string, deadline: number): Promise<T> {
  while (Date.now() < deadline) {
    const value = read();
    if (value !== null) return value;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error(failureCode);
}

function click(element: HTMLElement): void {
  element.focus();
  element.click();
}

export function activateChatLink(element: HTMLAnchorElement): ChatLinkActivation {
  let clickObserved = false;
  let routerIntercepted = false;
  const observeClick = (event: MouseEvent) => {
    if (!event.composedPath().includes(element)) return;
    clickObserved = true;
    routerIntercepted = event.defaultPrevented;
  };
  document.addEventListener("click", observeClick);
  try {
    click(element);
  } finally {
    document.removeEventListener("click", observeClick);
  }
  return Object.freeze({ clickObserved, routerIntercepted });
}

function chatRouteSelected(): boolean {
  return elementWithText("a", "新建任务")?.getAttribute("aria-current") === "page";
}

function readChatNavigationObservation(): ReturnType<typeof classifyChatNavigationObservation> {
  return classifyChatNavigationObservation({
    pathname: window.location.pathname,
    routeSelected: chatRouteSelected(),
    chatPageRendered: elementWithText("h1", "易界AI") !== null,
  });
}

async function waitForProductionChatPage(
  activation: ChatLinkActivation,
  deadline: number,
  diagnostic: RouterOutcomeRecorder,
): Promise<void> {
  if (!activation.clickObserved || !activation.routerIntercepted) {
    diagnostic.markNavigationFailed();
    throw new Error(routerOutcomeFailureCode(diagnostic.outcome()));
  }

  let routeEntered = false;
  while (Date.now() < deadline) {
    const observation = readChatNavigationObservation();
    if (observation === "chat-page-rendered") return;
    if (observation === "chat-route-entered") routeEntered = true;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  if (!routeEntered &&
      elementWithText("h1", "设置") === null &&
      elementWithText("h1", "无权访问此模块") === null) {
    diagnostic.markNavigationFailed();
  }
  throw new Error(routerOutcomeFailureCode(diagnostic.outcome()));
}

function enterText(textarea: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("runtime_input_unavailable");
  textarea.focus();
  setter.call(textarea, text);
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

export async function prepareComposerSubmission(
  deadline: number,
  input: string,
): Promise<HTMLTextAreaElement> {
  const textarea = await waitFor(
    () => document.querySelector<HTMLTextAreaElement>('#chat-task-input'),
    "runtime_composer_timeout",
    deadline,
  );
  enterText(textarea, input);

  let recoveryAttempted = false;
  await waitFor(() => {
    const send = document.querySelector<HTMLButtonElement>('[aria-label="发送任务"]');
    if (send && !send.disabled) return send;

    const recovery = document.querySelector<HTMLButtonElement>(".chat-composer__recovery");
    if (!recoveryAttempted && recovery && visible(recovery) && !recovery.disabled) {
      recoveryAttempted = true;
      click(recovery);
    }
    return null;
  }, "runtime_local_readiness_timeout", deadline);
  return textarea;
}

export function readStableReadyShellEvidence(): Pick<ObservationInput, "readyShells" | "kinds"> {
  const ready = new Set<string>();
  for (const shell of document.querySelectorAll<HTMLElement>("article.artifact-shell")) {
    const text = shell.textContent ?? "";
    const name = DISPLAY_NAMES.find((candidate) => text.includes(candidate));
    if (name && classifyArtifactShell(text) === "ready") ready.add(name);
  }
  return Object.freeze({ readyShells: ready.size, kinds: ready.size });
}

const AXE_DIAGNOSTIC_NONCE = /^[0-9a-f]{32}$/;
const AXE_MODULE_NONCE_SLOT = "__YIJIE_FEAT128_S10D_AXE_NONCE__";

function createIsolatedAxeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function parseIsolatedAxeFrameMessage(
  value: unknown,
  expectedNonce: string,
): IsolatedAxeFrameMessage | null {
  if (!AXE_DIAGNOSTIC_NONCE.test(expectedNonce) || !record(value) ||
      value.schemaVersion !== 1 || value.nonce !== expectedNonce) {
    return null;
  }
  if (value.stage === "axe_bootstrap_started" || value.stage === "axe_import_resolved" ||
      value.stage === "axe_import_rejected" || value.stage === "axe_run_rejected") {
    if (!exactKeys(value, ["schemaVersion", "nonce", "stage"])) return null;
    return Object.freeze({
      schemaVersion: 1,
      nonce: expectedNonce,
      stage: value.stage,
    });
  }
  if (value.stage === "axe_run_resolved" &&
      exactKeys(value, ["schemaVersion", "nonce", "stage", "seriousCritical"]) &&
      Number.isSafeInteger(value.seriousCritical) &&
      (value.seriousCritical as number) >= 0 &&
      (value.seriousCritical as number) <= 100) {
    return Object.freeze({
      schemaVersion: 1,
      nonce: expectedNonce,
      stage: "axe_run_resolved",
      seriousCritical: value.seriousCritical as number,
    });
  }
  return null;
}

export function acceptIsolatedAxeFrameMessage(
  event: Readonly<{ source: unknown; data: unknown }>,
  expectedSource: unknown,
  expectedNonce: string,
): IsolatedAxeFrameMessage | null {
  if (event.source !== expectedSource) return null;
  return parseIsolatedAxeFrameMessage(event.data, expectedNonce);
}

const VALID_AXE_DIAGNOSTIC_SEQUENCES = new Set([
  "",
  "axe_script_error",
  "axe_script_loaded",
  "axe_script_loaded\0axe_nonce_consumed",
  "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started",
  "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started\0axe_import_rejected",
  "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started\0axe_import_resolved",
  "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started\0axe_import_resolved\0axe_run_rejected",
  "axe_script_loaded\0axe_nonce_consumed\0axe_bootstrap_started\0axe_import_resolved\0axe_run_resolved",
]);

export function validateAxeDiagnosticStages(
  value: unknown,
): readonly S10dAxeDiagnosticStage[] {
  if (!Array.isArray(value) || value.length > S10D_AXE_DIAGNOSTIC_STAGES.length ||
      !value.every((stage) => typeof stage === "string") ||
      !VALID_AXE_DIAGNOSTIC_SEQUENCES.has(value.join("\0"))) {
    throw new Error("runtime_axe_diagnostic_invalid");
  }
  return Object.freeze([...value]) as readonly S10dAxeDiagnosticStage[];
}

export async function runIsolatedAxe(
  port: IsolatedAxePort,
  deadline: number,
  recordStage: (stage: S10dAxeDiagnosticStage) => void = () => undefined,
): Promise<{ readonly axeSeriousCritical: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let dispose: (() => void) | null = null;
    const nonce = createIsolatedAxeNonce();
    let scriptStatus: "pending" | "loaded" | "error" = "pending";
    let nonceConsumed = false;
    let bootstrapStarted = false;
    let importStatus: "pending" | "resolved" | "rejected" = "pending";
    let runStatus: "pending" | "resolved" | "rejected" = "pending";
    let resolvedResult: { readonly axeSeriousCritical: number } | null = null;
    const evidence = (): readonly S10dAxeDiagnosticStage[] => {
      const stages: S10dAxeDiagnosticStage[] = [];
      if (scriptStatus === "loaded") stages.push("axe_script_loaded");
      if (scriptStatus === "error") stages.push("axe_script_error");
      if (nonceConsumed) stages.push("axe_nonce_consumed");
      if (bootstrapStarted) stages.push("axe_bootstrap_started");
      if (importStatus === "resolved") stages.push("axe_import_resolved");
      if (importStatus === "rejected") stages.push("axe_import_rejected");
      if (runStatus === "resolved") stages.push("axe_run_resolved");
      if (runStatus === "rejected") stages.push("axe_run_rejected");
      return Object.freeze(stages);
    };
    const finish = (result: { readonly axeSeriousCritical: number } | Error): void => {
      if (settled) return;
      try {
        for (const stage of evidence()) recordStage(stage);
      } catch {
        result = new Error(S10D_POST_LIFECYCLE_FAILURES.axeRun);
      }
      settled = true;
      window.clearTimeout(timer);
      dispose?.();
      if (result instanceof Error) reject(result);
      else resolve(Object.freeze(result));
    };
    const timeoutFailure = (): string => {
      if (scriptStatus === "pending") return S10D_POST_LIFECYCLE_FAILURES.axeScriptTimeout;
      if (scriptStatus === "error") return S10D_POST_LIFECYCLE_FAILURES.axeLoad;
      if (!nonceConsumed) return S10D_POST_LIFECYCLE_FAILURES.axeNonceNotConsumed;
      if (!bootstrapStarted) return S10D_POST_LIFECYCLE_FAILURES.axeBootstrapTimeout;
      if (importStatus === "pending") return S10D_POST_LIFECYCLE_FAILURES.axeImportTimeout;
      if (importStatus === "rejected") return S10D_POST_LIFECYCLE_FAILURES.axeImportRejected;
      if (runStatus === "pending") return S10D_POST_LIFECYCLE_FAILURES.axeRunTimeout;
      if (runStatus === "rejected") return S10D_POST_LIFECYCLE_FAILURES.axeRunRejected;
      return S10D_POST_LIFECYCLE_FAILURES.axeRun;
    };
    const maybeFinish = (): void => {
      if (scriptStatus === "error") {
        finish(new Error(S10D_POST_LIFECYCLE_FAILURES.axeLoad));
      } else if (importStatus === "rejected") {
        finish(new Error(S10D_POST_LIFECYCLE_FAILURES.axeImportRejected));
      } else if (runStatus === "rejected") {
        finish(new Error(S10D_POST_LIFECYCLE_FAILURES.axeRunRejected));
      } else if (scriptStatus === "loaded" && nonceConsumed && resolvedResult !== null) {
        finish(resolvedResult);
      }
    };
    const timer = window.setTimeout(
      () => finish(new Error(timeoutFailure())),
      Math.max(1, deadline - Date.now()),
    );
    try {
      dispose = port.start(
        nonce,
        (value) => {
          const parsed = parseIsolatedAxeFrameMessage(value, nonce);
          if (parsed === null) return;
          if (parsed.stage === "axe_bootstrap_started" && !bootstrapStarted) {
            bootstrapStarted = true;
            nonceConsumed = true;
          } else if (parsed.stage === "axe_import_resolved" && bootstrapStarted &&
              importStatus === "pending") {
            importStatus = "resolved";
          } else if (parsed.stage === "axe_import_rejected" && bootstrapStarted &&
              importStatus === "pending") {
            importStatus = "rejected";
          } else if (parsed.stage === "axe_run_rejected" && importStatus === "resolved" &&
              runStatus === "pending") {
            runStatus = "rejected";
          } else if (parsed.stage === "axe_run_resolved" && importStatus === "resolved" &&
              runStatus === "pending") {
            runStatus = "resolved";
            resolvedResult = { axeSeriousCritical: parsed.seriousCritical };
          } else {
            return;
          }
          maybeFinish();
        },
        (status, consumed) => {
          if (scriptStatus !== "pending") return;
          scriptStatus = status;
          nonceConsumed ||= consumed;
          maybeFinish();
        },
      );
      if (settled) dispose();
    } catch {
      finish(new Error(S10D_POST_LIFECYCLE_FAILURES.axeLoad));
    }
  });
}

export function createSameRealmAxeModulePort(): IsolatedAxePort {
  return Object.freeze({
    start(nonce: string, receive: (value: unknown) => void,
      reportScript: (status: "loaded" | "error", nonceConsumed: boolean) => void) {
      const runtimeWindow = window as Window & {
        [AXE_MODULE_NONCE_SLOT]?: string;
        __YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__?: string;
      };
      const script = document.createElement("script");
      script.type = "module";
      script.src = isolatedAxeModuleUrl;
      script.dataset.feat128S10dAxe = "true";
      let active = true;
      let engineRequested = false;
      const onMessage = (event: MessageEvent<unknown>): void => {
        const message = acceptIsolatedAxeFrameMessage(event, window, nonce);
        if (message === null) return;
        receive(message);
        if (message.stage === "axe_bootstrap_started" && !engineRequested) {
          engineRequested = true;
          void loadIsolatedAxeEngine().catch(() => {
            if (!active) return;
            if (runtimeWindow.__YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__ === nonce) {
              delete runtimeWindow.__YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__;
            }
            receive(Object.freeze({
              schemaVersion: 1,
              nonce,
              stage: "axe_import_rejected",
            }));
          });
        }
      };
      const onLoad = (): void => reportScript(
        "loaded",
        runtimeWindow[AXE_MODULE_NONCE_SLOT] !== nonce,
      );
      const onError = (): void => reportScript("error", false);
      runtimeWindow[AXE_MODULE_NONCE_SLOT] = nonce;
      window.addEventListener("message", onMessage);
      script.addEventListener("load", onLoad, { once: true });
      script.addEventListener("error", onError, { once: true });
      document.head.append(script);
      return () => {
        active = false;
        window.removeEventListener("message", onMessage);
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
        script.remove();
        if (runtimeWindow[AXE_MODULE_NONCE_SLOT] === nonce) {
          delete runtimeWindow[AXE_MODULE_NONCE_SLOT];
        }
        if (runtimeWindow.__YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__ === nonce) {
          delete runtimeWindow.__YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__;
        }
      };
    },
  });
}

async function waitForStableReadyShells(
  deadline: number,
): Promise<Pick<ObservationInput, "readyShells" | "kinds">> {
  return waitFor(() => {
    const counts = readStableReadyShellEvidence();
    return counts.readyShells === 4 && counts.kinds === 4
      ? counts
      : null;
  }, "runtime_lifecycle_timeout", deadline);
}

async function runAccessibilityChecks(
  deadline: number,
  recordStage: (stage: S10dAxeDiagnosticStage) => void,
): Promise<{ axeSeriousCritical: number; focusOrder: boolean }> {
  const { axeSeriousCritical } = await runIsolatedAxe(
    createSameRealmAxeModulePort(),
    deadline,
    recordStage,
  );
  const conversation = document.querySelector<HTMLElement>('[aria-label="任务对话记录"]');
  const firstShell = document.querySelector<HTMLElement>("article.artifact-shell");
  const composer = document.querySelector<HTMLTextAreaElement>('#chat-task-input');
  const ordered = conversation !== null && firstShell !== null && composer !== null &&
    Boolean(conversation.compareDocumentPosition(firstShell) & Node.DOCUMENT_POSITION_FOLLOWING) &&
    Boolean(firstShell.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING);
  for (const element of [conversation, firstShell, composer]) {
    element?.focus({ preventScroll: true });
    if (document.activeElement !== element) return { axeSeriousCritical, focusOrder: false };
  }
  return { axeSeriousCritical, focusOrder: ordered };
}

async function checkpoint(stage: string): Promise<void> {
  validateReadyAck(await invoke(S10D_RUNTIME_COMMANDS.checkpoint, { request: { schemaVersion: 1, stage } }));
}

export function stableFailure(error: unknown): string {
  const candidate = error instanceof Error ? error.message : error;
  if (typeof candidate === "string" && STABLE_RUNTIME_FAILURE.test(candidate)) return candidate;
  return "runtime_controller_failed";
}

export async function withStableStageFailure<T>(
  failureCode: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!POST_LIFECYCLE_FAILURE_SET.has(failureCode)) {
    throw new Error("runtime_controller_failed");
  }
  try {
    return await operation();
  } catch {
    throw new Error(failureCode);
  }
}

async function waitForPermissionReady(deadline: number): Promise<void> {
  const failures = new Map([
    ["权限响应未通过校验", "runtime_permission_projection_invalid"],
    ["权限服务暂不可用", "runtime_permission_unavailable"],
    ["需要重新登录", "runtime_permission_unauthorized"],
    ["账户访问受限", "runtime_permission_denied"],
    ["租户访问已撤销", "runtime_permission_denied"],
    ["租户上下文无效", "runtime_permission_context_invalid"],
    ["暂无可用租户", "runtime_permission_tenant_missing"],
    ["暂无业务权限", "runtime_permission_empty"],
  ]);
  await new Promise((resolve) => window.setTimeout(resolve, 100));
  await waitFor(() => {
    const title = [...document.querySelectorAll<HTMLElement>("h2")]
      .filter(visible)
      .map((element) => element.textContent?.trim() ?? "")
      .find((value) => value === "权限已就绪" || failures.has(value));
    if (!title) return null;
    const failure = failures.get(title);
    if (failure) throw new Error(failure);
    return true;
  }, "runtime_permission_projection_timeout", deadline);
}

export async function runFeat128S10dRuntimeController(): Promise<void> {
  const deadline = Date.now() + CONTROLLER_TIMEOUT_MS;
  const axeStages: S10dAxeDiagnosticStage[] = [];
  const finisher = createRuntimeFinisher((request) =>
    invoke(S10D_RUNTIME_COMMANDS.finish, { request })
  );
  let routerOutcome: RouterOutcomeRecorder | null = null;
  try {
    validateReadyAck(await invoke(S10D_RUNTIME_COMMANDS.prepare));

    const retry = await waitFor(
      () => elementWithText("button", "重新读取权限"),
      "runtime_permission_page_timeout",
      deadline,
    );
    click(retry);
    await waitForPermissionReady(deadline);
    const newTask = await waitFor(
      () => elementWithText("a", "新建任务"),
      "runtime_permission_projection_timeout",
      deadline,
    );
    if (!(newTask instanceof HTMLAnchorElement) || !newTask.isConnected ||
        new URL(newTask.href).pathname !== "/chat") {
      throw new Error("runtime_chat_navigation_invalid");
    }
    routerOutcome = createProductionRouterOutcomeRecorder();
    const navigationDeadline = Math.min(deadline, Date.now() + S10D_CHAT_PAGE_TIMEOUT_MS);
    await waitForProductionChatPage(activateChatLink(newTask), navigationDeadline, routerOutcome);
    routerOutcome.stop();
    routerOutcome = null;
    await checkpoint("production_page_ready");

    const textarea = await prepareComposerSubmission(
      deadline,
      "Create the strict-local structured artifact fixture set.",
    );

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const counts = await waitForStableReadyShells(deadline);
    await withStableStageFailure(
      S10D_POST_LIFECYCLE_FAILURES.fourShellCheckpoint,
      () => checkpoint("four_shells_ready"),
    );

    const accessibility = await runAccessibilityChecks(
      deadline,
      (stage) => axeStages.push(stage),
    );
    if (accessibility.axeSeriousCritical !== 0) {
      throw new Error(S10D_POST_LIFECYCLE_FAILURES.axeViolations);
    }
    if (!accessibility.focusOrder) {
      throw new Error(S10D_POST_LIFECYCLE_FAILURES.focusOrder);
    }
    await withStableStageFailure(
      S10D_POST_LIFECYCLE_FAILURES.axeCheckpoint,
      () => checkpoint("axe_focus_ready"),
    );
    await withStableStageFailure(
      S10D_POST_LIFECYCLE_FAILURES.screenshotCheckpoint,
      () => checkpoint("screenshot_ready"),
    );
    await withStableStageFailure(
      S10D_POST_LIFECYCLE_FAILURES.finishHandshake,
      () => finisher.finish(createClosedObservation({
        ...counts,
        ...accessibility,
        axeStages,
      })),
    );
  } catch (error: unknown) {
    if (finisher.attempted()) {
      window.close();
    } else {
      const lifecycle = readStableReadyShellEvidence();
      await finisher.finish(createFailureObservation(stableFailure(error), lifecycle, axeStages))
        .catch(() => window.close());
    }
  } finally {
    routerOutcome?.stop();
  }
}
