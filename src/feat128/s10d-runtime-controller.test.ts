// @vitest-environment happy-dom

import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatComposer from "../components/chat/ChatComposer.vue";
import type { ChatProject } from "../domain/chat-ipc";
import {
  S10D_AXE_DIAGNOSTIC_STAGES,
  S10D_CHAT_PAGE_TIMEOUT_MS,
  S10D_POST_LIFECYCLE_FAILURES,
  S10D_RUNTIME_COMMANDS,
  acceptIsolatedAxeFrameMessage,
  activateChatLink,
  classifyRouterOutcome,
  classifyChatNavigationFailure,
  classifyChatNavigationObservation,
  classifyArtifactShell,
  createClosedObservation,
  createFailureObservation,
  createRouterOutcomeRecorder,
  createRuntimeFinisher,
  createSameRealmAxeModulePort,
  prepareComposerSubmission,
  readStableReadyShellEvidence,
  runIsolatedAxe,
  routerOutcomeFailureCode,
  stableFailure,
  validateAxeDiagnosticStages,
  withStableStageFailure,
  validateReadyAck,
} from "./s10d-runtime-controller";

const PROJECT: ChatProject = Object.freeze({
  projectId: "12800000-0000-4000-8000-200000000001",
  safeName: "Synthetic Workspace",
  pinnedAt: null,
  lastUsedAt: 1,
  available: true,
});
const SYNTHETIC_INPUT = "Create the strict-local structured artifact fixture set.";

function mountRuntimeComposer(overrides: Record<string, unknown> = {}): VueWrapper {
  const holder: { current: VueWrapper | null } = { current: null };
  const wrapper = mount(ChatComposer, {
    attachTo: document.body,
    props: {
      modelValue: "",
      mode: "new",
      projects: [PROJECT],
      selectedProjectId: PROJECT.projectId,
      readiness: {
        title: "正在检查本地运行环境",
        detail: "完成安全检查后即可发送任务。",
        actionLabel: null,
        tone: "neutral",
      },
      canSend: false,
      canAttach: false,
      sending: false,
      streaming: false,
      recoveryAvailable: false,
      "onUpdate:modelValue": (value: string) => {
        void holder.current?.setProps({ modelValue: value });
      },
      ...overrides,
    },
  });
  holder.current = wrapper;
  return wrapper;
}

describe("FEAT-128 S10D-H production controller boundary", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("uses only the three feature-only control commands", () => {
    expect(S10D_RUNTIME_COMMANDS).toEqual(Object.freeze({
      prepare: "feat128_s10d_runtime_prepare_v1",
      checkpoint: "feat128_s10d_runtime_checkpoint_v1",
      finish: "feat128_s10d_runtime_finish_v1",
    }));
  });

  it("accepts only the closed content-free native ack", () => {
    expect(validateReadyAck({ schemaVersion: 1, status: "ready" })).toEqual({
      schemaVersion: 1,
      status: "ready",
    });
    expect(() => validateReadyAck({
      schemaVersion: 1,
      status: "ready",
      requestId: "forbidden",
    })).toThrow("s10d_runtime_ack_invalid");
  });

  it("preserves only stable runtime codes from Error or Tauri string rejection", () => {
    expect(stableFailure(new Error("runtime_checkpoint_invalid"))).toBe("runtime_checkpoint_invalid");
    expect(stableFailure("runtime_checkpoint_invalid")).toBe("runtime_checkpoint_invalid");
    expect(stableFailure("native detail forbidden")).toBe("runtime_controller_failed");
    expect(stableFailure({ message: "runtime_checkpoint_invalid" })).toBe("runtime_controller_failed");
  });

  it("uses one closed failure code for every post-lifecycle stage", async () => {
    expect(S10D_POST_LIFECYCLE_FAILURES).toEqual({
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
    for (const failureCode of Object.values(S10D_POST_LIFECYCLE_FAILURES)) {
      await expect(withStableStageFailure(failureCode, async () => {
        throw "native detail forbidden";
      })).rejects.toThrow(failureCode);
    }
  });

  it("runs axe in a disposable module and normalizes bounded bootstrap evidence", async () => {
    const dispose = vi.fn();
    const stages: string[] = [];
    const result = await runIsolatedAxe({
      start(nonce, receive, reportScript) {
        expect(nonce).toMatch(/^[0-9a-f]{32}$/);
        queueMicrotask(() => {
          reportScript("loaded", true);
          receive({ schemaVersion: 1, nonce, stage: "axe_bootstrap_started" });
          receive({ schemaVersion: 1, nonce, stage: "axe_import_resolved" });
          receive({
            schemaVersion: 1,
            nonce,
            stage: "axe_run_resolved",
            seriousCritical: 0,
          });
        });
        return dispose;
      },
    }, Date.now() + 1_000, (stage) => stages.push(stage));
    expect(result).toEqual({ axeSeriousCritical: 0 });
    expect(stages).toEqual([
      "axe_script_loaded",
      "axe_nonce_consumed",
      "axe_bootstrap_started",
      "axe_import_resolved",
      "axe_run_resolved",
    ]);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("maps isolated axe load/run failures without retaining raw errors", async () => {
    const loadDispose = vi.fn();
    await expect(runIsolatedAxe({
      start(_nonce, _receive, reportScript) {
        queueMicrotask(() => reportScript("error", false));
        return loadDispose;
      },
    }, Date.now() + 1_000)).rejects.toThrow("runtime_axe_load_failed");
    expect(loadDispose).toHaveBeenCalledOnce();

    const runDispose = vi.fn();
    const stages: string[] = [];
    await expect(runIsolatedAxe({
      start(nonce, receive, reportScript) {
        queueMicrotask(() => {
          reportScript("loaded", true);
          receive({ schemaVersion: 1, nonce, stage: "axe_bootstrap_started" });
          receive({ schemaVersion: 1, nonce, stage: "axe_import_resolved" });
          receive({ schemaVersion: 1, nonce, stage: "axe_run_rejected" });
        });
        return runDispose;
      },
    }, Date.now() + 1_000, (stage) => stages.push(stage)))
      .rejects.toThrow("runtime_axe_run_rejected");
    expect(stages).toEqual([
      "axe_script_loaded",
      "axe_nonce_consumed",
      "axe_bootstrap_started",
      "axe_import_resolved",
      "axe_run_rejected",
    ]);
    expect(runDispose).toHaveBeenCalledOnce();
  });

  it("accepts axe diagnostics only from the exact frame source with nonce-bound closed schema", () => {
    const source = Object.freeze({ frame: true });
    const nonce = "a".repeat(32);
    const valid = {
      source,
      data: { schemaVersion: 1, nonce, stage: "axe_bootstrap_started" },
    };
    expect(acceptIsolatedAxeFrameMessage(valid, source, nonce)).toEqual(valid.data);
    expect(acceptIsolatedAxeFrameMessage(valid, Object.freeze({ frame: true }), nonce)).toBeNull();
    expect(acceptIsolatedAxeFrameMessage(valid, source, "b".repeat(32))).toBeNull();
    expect(acceptIsolatedAxeFrameMessage({
      source,
      data: { ...valid.data, error: "forbidden raw error" },
    }, source, nonce)).toBeNull();
    expect(acceptIsolatedAxeFrameMessage({
      source,
      data: {
        schemaVersion: 1,
        nonce,
        stage: "axe_run_resolved",
        seriousCritical: 101,
      },
    }, source, nonce)).toBeNull();
  });

  it("uses only the closed content-free axe bootstrap diagnostic stages", () => {
    expect(S10D_AXE_DIAGNOSTIC_STAGES).toEqual([
      "axe_script_loaded",
      "axe_script_error",
      "axe_nonce_consumed",
      "axe_bootstrap_started",
      "axe_import_resolved",
      "axe_import_rejected",
      "axe_run_resolved",
      "axe_run_rejected",
    ]);
  });

  it("classifies a missing axe script event before inspecting later stages", async () => {
    const dispose = vi.fn();
    const stages: string[] = [];
    await expect(runIsolatedAxe({
      start() {
        return dispose;
      },
    }, Date.now() + 10, (stage) => stages.push(stage)))
      .rejects.toThrow("runtime_axe_script_timeout");
    expect(stages).toEqual([]);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not accept individually valid axe messages outside the fixed stage order", async () => {
    const stages: string[] = [];
    await expect(runIsolatedAxe({
      start(nonce, receive, reportScript) {
        queueMicrotask(() => {
          reportScript("loaded", true);
          receive({
            schemaVersion: 1,
            nonce,
            stage: "axe_run_resolved",
            seriousCritical: 0,
          });
        });
        return () => undefined;
      },
    }, Date.now() + 10, (stage) => stages.push(stage)))
      .rejects.toThrow("runtime_axe_bootstrap_timeout");
    expect(stages).toEqual(["axe_script_loaded", "axe_nonce_consumed"]);
  });

  it.each([
    {
      name: "nonce was not consumed",
      emit(nonce: string, receive: (value: unknown) => void,
        report: (status: "loaded" | "error", consumed: boolean) => void) {
        void nonce;
        void receive;
        report("loaded", false);
      },
      failure: "runtime_axe_nonce_not_consumed",
      evidence: ["axe_script_loaded"],
    },
    {
      name: "bootstrap message was not accepted",
      emit(nonce: string, receive: (value: unknown) => void,
        report: (status: "loaded" | "error", consumed: boolean) => void) {
        void nonce;
        void receive;
        report("loaded", true);
      },
      failure: "runtime_axe_bootstrap_timeout",
      evidence: ["axe_script_loaded", "axe_nonce_consumed"],
    },
    {
      name: "axe import remained pending",
      emit(nonce: string, receive: (value: unknown) => void,
        report: (status: "loaded" | "error", consumed: boolean) => void) {
        report("loaded", true);
        receive({ schemaVersion: 1, nonce, stage: "axe_bootstrap_started" });
      },
      failure: "runtime_axe_import_timeout",
      evidence: ["axe_script_loaded", "axe_nonce_consumed", "axe_bootstrap_started"],
    },
    {
      name: "axe import rejected",
      emit(nonce: string, receive: (value: unknown) => void,
        report: (status: "loaded" | "error", consumed: boolean) => void) {
        report("loaded", true);
        receive({ schemaVersion: 1, nonce, stage: "axe_bootstrap_started" });
        receive({ schemaVersion: 1, nonce, stage: "axe_import_rejected" });
      },
      failure: "runtime_axe_import_rejected",
      evidence: [
        "axe_script_loaded",
        "axe_nonce_consumed",
        "axe_bootstrap_started",
        "axe_import_rejected",
      ],
    },
    {
      name: "axe run remained pending",
      emit(nonce: string, receive: (value: unknown) => void,
        report: (status: "loaded" | "error", consumed: boolean) => void) {
        report("loaded", true);
        receive({ schemaVersion: 1, nonce, stage: "axe_bootstrap_started" });
        receive({ schemaVersion: 1, nonce, stage: "axe_import_resolved" });
      },
      failure: "runtime_axe_run_timeout",
      evidence: [
        "axe_script_loaded",
        "axe_nonce_consumed",
        "axe_bootstrap_started",
        "axe_import_resolved",
      ],
    },
  ])("classifies $name with one closed failure", async ({ emit, failure, evidence }) => {
    const stages: string[] = [];
    await expect(runIsolatedAxe({
      start(nonce, receive, reportScript) {
        queueMicrotask(() => emit(nonce, receive, reportScript));
        return () => undefined;
      },
    }, Date.now() + 10, (stage) => stages.push(stage))).rejects.toThrow(failure);
    expect(stages).toEqual(evidence);
  });

  it("loads the isolated axe chunk in the production realm and cleans its nonce and script", () => {
    const receive = vi.fn();
    const reportScript = vi.fn();
    const nonce = "c".repeat(32);
    const runtimeWindow = window as Window & {
      __YIJIE_FEAT128_S10D_AXE_NONCE__?: string;
    };
    const dispose = createSameRealmAxeModulePort().start(nonce, receive, reportScript);
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[data-feat128-s10d-axe="true"]',
    );
    expect(document.querySelector("iframe")).toBeNull();
    expect(script?.type).toBe("module");
    expect(runtimeWindow.__YIJIE_FEAT128_S10D_AXE_NONCE__).toBe(nonce);

    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: { schemaVersion: 1, nonce, stage: "axe_bootstrap_started" },
    }));
    expect(receive).toHaveBeenCalledWith({
      schemaVersion: 1,
      nonce,
      stage: "axe_bootstrap_started",
    });

    dispose();
    expect(document.head.contains(script)).toBe(false);
    expect(runtimeWindow.__YIJIE_FEAT128_S10D_AXE_NONCE__).toBeUndefined();
  });

  it("classifies only stable production shell lifecycle text", () => {
    expect(classifyArtifactShell("图片 synthetic-preview.png 已登记")).toBe("announced");
    expect(classifyArtifactShell("视频 synthetic-clip.mp4 正在生成")).toBe("progress");
    expect(classifyArtifactShell("文件 synthetic-data.csv 已就绪")).toBe("ready");
    expect(classifyArtifactShell("报告 synthetic-report.json 失败")).toBeNull();
  });

  it("counts only four currently stable ready shells and never reconstructs transient DOM frames", () => {
    document.body.innerHTML = `
      <article class="artifact-shell">图片 synthetic-preview.png 已登记</article>
      <article class="artifact-shell">视频 synthetic-clip.mp4 正在生成</article>
      <article class="artifact-shell">文件 synthetic-data.csv 已就绪</article>
      <article class="artifact-shell">报告 synthetic-report.json 已就绪</article>
    `;
    expect(readStableReadyShellEvidence()).toEqual({ readyShells: 2, kinds: 2 });
    for (const shell of document.querySelectorAll("article.artifact-shell")) {
      shell.textContent = shell.textContent
        ?.replace("已登记", "已就绪")
        .replace("正在生成", "已就绪") ?? "";
    }
    expect(readStableReadyShellEvidence()).toEqual({ readyShells: 4, kinds: 4 });
  });

  it("uses the exact frozen Tauri/Page deadline", () => {
    expect(S10D_CHAT_PAGE_TIMEOUT_MS).toBe(45_000);
  });

  it("enters valid input before waiting for the real composer send state", async () => {
    const wrapper = mountRuntimeComposer({
      canSend: true,
      canAttach: true,
      readiness: {
        title: "本地运行环境已就绪",
        detail: "项目内容保持在本机。",
        actionLabel: null,
        tone: "success",
      },
    });
    try {
      expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
      const textarea = await prepareComposerSubmission(Date.now() + 1_000, SYNTHETIC_INPUT);
      expect(textarea.value).toBe(SYNTHETIC_INPUT);
      expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });

  it("boundedly waits for a late recovery action and invokes it only after input", async () => {
    let recoveryCalls = 0;
    const holder: { current: VueWrapper | null } = { current: null };
    const wrapper = mountRuntimeComposer({
      onRecover: () => {
        recoveryCalls += 1;
        const mounted = holder.current;
        if (mounted === null) throw new Error("runtime_test_wrapper_missing");
        expect(mounted.get("textarea").element.value).toBe(SYNTHETIC_INPUT);
        void mounted.setProps({
          canSend: true,
          canAttach: true,
          recoveryAvailable: false,
          readiness: {
            title: "本地运行环境已就绪",
            detail: "项目内容保持在本机。",
            actionLabel: null,
            tone: "success",
          },
        });
      },
    });
    holder.current = wrapper;
    try {
      const preparing = prepareComposerSubmission(Date.now() + 1_000, SYNTHETIC_INPUT);
      await new Promise((resolve) => window.setTimeout(resolve, 25));
      await wrapper.setProps({
        recoveryAvailable: true,
        readiness: {
          title: "本地服务暂不可用",
          detail: "请重试启动本地服务。",
          actionLabel: "重试启动",
          tone: "warning",
        },
      });
      await preparing;
      expect(recoveryCalls).toBe(1);
      expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });

  it("accepts route-selected, pathname, or rendered ChatPage as navigation evidence", () => {
    expect(classifyChatNavigationObservation({
      pathname: "/settings",
      routeSelected: false,
      chatPageRendered: false,
    })).toBeNull();
    expect(classifyChatNavigationObservation({
      pathname: "/settings",
      routeSelected: true,
      chatPageRendered: false,
    })).toBe("chat-route-entered");
    expect(classifyChatNavigationObservation({
      pathname: "/chat",
      routeSelected: false,
      chatPageRendered: false,
    })).toBe("chat-route-entered");
    expect(classifyChatNavigationObservation({
      pathname: "/settings",
      routeSelected: false,
      chatPageRendered: true,
    })).toBe("chat-page-rendered");
  });

  it("observes exact anchor activation and RouterLink interception", () => {
    const intercepted = document.createElement("a");
    intercepted.href = "/chat";
    intercepted.addEventListener("click", (event) => event.preventDefault());
    document.body.append(intercepted);
    expect(activateChatLink(intercepted)).toEqual({
      clickObserved: true,
      routerIntercepted: true,
    });

    const browserFallback = document.createElement("a");
    browserFallback.href = "#fallback";
    document.body.append(browserFallback);
    expect(activateChatLink(browserFallback)).toEqual({
      clickObserved: true,
      routerIntercepted: false,
    });
  });

  it("classifies closed navigation failures without treating unknown state as success", () => {
    expect(classifyChatNavigationFailure({
      clickObserved: false,
      routerIntercepted: false,
      routeEntered: false,
      settingsPageRendered: false,
      accessDeniedPageRendered: false,
    })).toBe("runtime_chat_click_not_observed");
    expect(classifyChatNavigationFailure({
      clickObserved: true,
      routerIntercepted: false,
      routeEntered: false,
      settingsPageRendered: false,
      accessDeniedPageRendered: false,
    })).toBe("runtime_chat_router_not_intercepted");
    expect(classifyChatNavigationFailure({
      clickObserved: true,
      routerIntercepted: true,
      routeEntered: false,
      settingsPageRendered: true,
      accessDeniedPageRendered: false,
    })).toBe("runtime_chat_guard_settings");
    expect(classifyChatNavigationFailure({
      clickObserved: true,
      routerIntercepted: true,
      routeEntered: false,
      settingsPageRendered: false,
      accessDeniedPageRendered: true,
    })).toBe("runtime_chat_guard_access_denied");
    expect(classifyChatNavigationFailure({
      clickObserved: true,
      routerIntercepted: true,
      routeEntered: true,
      settingsPageRendered: false,
      accessDeniedPageRendered: false,
    })).toBe("runtime_chat_route_render_timeout");
    expect(classifyChatNavigationFailure({
      clickObserved: true,
      routerIntercepted: true,
      routeEntered: false,
      settingsPageRendered: false,
      accessDeniedPageRendered: false,
    })).toBe("runtime_chat_navigation_failed");
  });

  it.each([
    [{ productionGuardRedirect: true }, "production_guard_redirect"],
    [{ productionGuardAllowed: true, settingsCommitted: true, permissionReadyLost: true }, "app_permission_redirect"],
    [{ productionGuardAllowed: true, navigationFailed: true }, "navigation_aborted"],
    [{ productionGuardAllowed: true, routerError: true }, "chat_lazy_load_failed"],
    [{ productionGuardAllowed: true, chatCommitted: true, historyAligned: false }, "history_protocol_mismatch"],
    [{ productionGuardAllowed: true, chatCommitted: true }, "route_committed_render_blocked"],
  ] as const)("classifies one closed router outcome from content-free evidence", (evidence, outcome) => {
    expect(classifyRouterOutcome(evidence)).toBe(outcome);
    expect(routerOutcomeFailureCode(outcome)).toBe(`runtime_${outcome}`);
  });

  it("classifies guard-allowed but uncommitted unknown state as an aborted navigation", () => {
    expect(classifyRouterOutcome({ productionGuardAllowed: true })).toBe("navigation_aborted");
  });

  it("keeps router, permission, and visibility observations content-free and disposable", () => {
    const beforeEachHooks = new Set<(to: { path: string; redirectedFrom?: { path: string } }) => boolean>();
    const afterEachHooks = new Set<(
      to: { path: string; redirectedFrom?: { path: string } },
      from: { path: string },
      failure?: unknown,
    ) => void>();
    const errorHooks = new Set<(error: unknown, to: { path: string }) => void>();
    const permissionHooks = new Set<() => void>();
    const visibilityHooks = new Set<() => void>();
    let ready = true;
    let taskCreate = true;
    let visibilityState: DocumentVisibilityState = "hidden";
    const recorder = createRouterOutcomeRecorder({
      router: {
        beforeEach: (hook) => {
          beforeEachHooks.add(hook);
          return () => beforeEachHooks.delete(hook);
        },
        afterEach: (hook) => {
          afterEachHooks.add(hook);
          return () => afterEachHooks.delete(hook);
        },
        onError: (hook) => {
          errorHooks.add(hook);
          return () => errorHooks.delete(hook);
        },
      },
      permission: {
        read: () => ({ ready, taskCreate }),
        subscribe: (hook) => {
          permissionHooks.add(hook);
          return () => permissionHooks.delete(hook);
        },
      },
      visibility: {
        get state() {
          return visibilityState;
        },
        subscribe: (hook) => {
          visibilityHooks.add(hook);
          return () => visibilityHooks.delete(hook);
        },
      },
      readPathname: () => "/settings",
    });

    for (const hook of beforeEachHooks) hook({ path: "/chat" });
    ready = false;
    taskCreate = false;
    for (const hook of permissionHooks) hook();
    visibilityState = "visible";
    for (const hook of visibilityHooks) hook();
    for (const hook of afterEachHooks) hook({ path: "/settings" }, { path: "/chat" });

    expect(recorder.outcome()).toBe("app_permission_redirect");
    expect(Object.keys(recorder.evidence()).sort()).toEqual([
      "chatCommitted",
      "hiddenToVisible",
      "historyAligned",
      "navigationFailed",
      "permissionReadyLost",
      "productionGuardAllowed",
      "productionGuardRedirect",
      "routerError",
      "settingsCommitted",
      "taskCreateLost",
    ]);

    recorder.stop();
    expect(beforeEachHooks.size).toBe(0);
    expect(afterEachHooks.size).toBe(0);
    expect(errorHooks.size).toBe(0);
    expect(permissionHooks.size).toBe(0);
    expect(visibilityHooks.size).toBe(0);
  });

  it("creates an exact content-free terminal observation", () => {
    expect(createClosedObservation({
      readyShells: 4,
      kinds: 4,
      axeSeriousCritical: 0,
      focusOrder: true,
      axeStages: [
        "axe_script_loaded",
        "axe_nonce_consumed",
        "axe_bootstrap_started",
        "axe_import_resolved",
        "axe_run_resolved",
      ],
    })).toEqual({
      schemaVersion: 1,
      status: "passed",
      failureCode: null,
      productionPath: {
        productionBootstrap: true,
        productionChatPage: true,
        productionCommands: true,
        singleV3: true,
        sqlcipher: true,
        historyV3: true,
        artifactStore: true,
        typedClients: true,
      },
      lifecycle: { domReadyShells: 4, domKinds: 4 },
      ui: {
        axeSeriousCritical: 0,
        focusOrder: true,
        axeStages: [
          "axe_script_loaded",
          "axe_nonce_consumed",
          "axe_bootstrap_started",
          "axe_import_resolved",
          "axe_run_resolved",
        ],
      },
    });
  });

  it("preserves only the current bounded DOM evidence in a failed terminal observation", () => {
    expect(createFailureObservation("runtime_lifecycle_timeout", {
      readyShells: 3,
      kinds: 2,
    }, ["axe_script_loaded", "axe_nonce_consumed", "axe_bootstrap_started"])).toMatchObject({
      schemaVersion: 1,
      status: "failed",
      failureCode: "runtime_lifecycle_timeout",
      lifecycle: { domReadyShells: 3, domKinds: 2 },
      ui: {
        axeSeriousCritical: -1,
        focusOrder: false,
        axeStages: ["axe_script_loaded", "axe_nonce_consumed", "axe_bootstrap_started"],
      },
    });
  });

  it("accepts only bounded fixed-order content-free axe stage sequences", () => {
    expect(validateAxeDiagnosticStages([])).toEqual([]);
    expect(validateAxeDiagnosticStages(["axe_script_error"]))
      .toEqual(["axe_script_error"]);
    expect(validateAxeDiagnosticStages(["axe_script_loaded"]))
      .toEqual(["axe_script_loaded"]);
    expect(validateAxeDiagnosticStages([
      "axe_script_loaded",
      "axe_nonce_consumed",
      "axe_bootstrap_started",
      "axe_import_rejected",
    ])).toEqual([
      "axe_script_loaded",
      "axe_nonce_consumed",
      "axe_bootstrap_started",
      "axe_import_rejected",
    ]);
    expect(validateAxeDiagnosticStages([
      "axe_script_loaded",
      "axe_nonce_consumed",
      "axe_bootstrap_started",
      "axe_import_resolved",
      "axe_run_resolved",
    ])).toEqual([
      "axe_script_loaded",
      "axe_nonce_consumed",
      "axe_bootstrap_started",
      "axe_import_resolved",
      "axe_run_resolved",
    ]);
    for (const invalid of [
      ["axe_run_resolved"],
      ["axe_script_loaded", "axe_bootstrap_started"],
      ["axe_script_loaded", "axe_nonce_consumed", "axe_import_resolved"],
      ["axe_script_loaded", "axe_script_loaded"],
      ["axe_script_loaded", "raw_error"],
      Array.from({ length: 6 }, () => "axe_script_loaded"),
    ]) {
      expect(() => validateAxeDiagnosticStages(invalid))
        .toThrow("runtime_axe_diagnostic_invalid");
    }
  });

  it.each(["passed", "timeout", "controller_exception"])(
    "attempts the existing finish channel exactly once for %s",
    async () => {
      const requests: unknown[] = [];
      const finisher = createRuntimeFinisher(async (request) => {
        requests.push(request);
      });
      const request = createFailureObservation("runtime_lifecycle_timeout", {
        readyShells: 1,
        kinds: 1,
      });

      await finisher.finish(request);
      await expect(finisher.finish(request)).rejects.toThrow("runtime_finish_duplicate");
      expect(finisher.attempted()).toBe(true);
      expect(requests).toHaveLength(1);
    },
  );
});
