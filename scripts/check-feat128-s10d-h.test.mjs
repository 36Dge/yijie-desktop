import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkFeat128S10dH,
  validateControllerSource,
  validateMainSource,
  validateProjectBootstrapSources,
  validateScopeFiles,
} from "./check-feat128-s10d-h.mjs";

const EXACT_COMMANDS = `
  feat128_s10d_runtime_prepare_v1
  feat128_s10d_runtime_checkpoint_v1
  feat128_s10d_runtime_finish_v1
`;

const S9B_R_REPAIR_DIGESTS = new Map([
  [
    "src/components/chat/ChatArtifactReport.vue",
    "d65bcd4170f8de049593ac2b896c5957b8e2cc274366f0ec2d02a16d61acba58",
  ],
  [
    "src/components/chat/ChatArtifactReport.test.ts",
    "324da41605aa9e298b880fc7a602662f0d113480e3cd38b3871c31e541e95588",
  ],
  [
    "src/components/chat/chat-artifact-report-chart-renderer.ts",
    "a394de872fc2d7fb2defd023feb42e7df2d390191f1c3eda6476ee5e11531159",
  ],
]);

const S9B_R_REPAIR_FILES = [...S9B_R_REPAIR_DIGESTS.keys()];
const TERMINAL_ORDER_EVIDENCE_REPAIR_DIGESTS = new Map([
  [
    "src-tauri/src/chat/application.rs",
    "df87a667ec887eda5de4f3c07ccfdeae66409eeef7bbea9bd1e37f2aaa809f2c",
  ],
  [
    "docs/design/docs/design/05-patterns/14-feat-128-structured-chat-artifacts.md",
    "c7631d898c349bf875f1975fe6517f139c0310eefad5cafb50fcb792c443b4bd",
  ],
]);
const TERMINAL_ORDER_EVIDENCE_REPAIR_FILES = [
  ...TERMINAL_ORDER_EVIDENCE_REPAIR_DIGESTS.keys(),
];
const POST_LIFECYCLE_REPAIR_DIGESTS = new Map([
  [
    "src/App.vue",
    "739c2f384253d31e84ed3c331119c9ebe8b6346c5e917319c8869489f04bdfe7",
  ],
  [
    "src/App.test.ts",
    "864845cb4c6b2068f20ef36db121da3fde01ed659da8b9cbb16da61086b360e2",
  ],
  [
    "src-tauri/src/chat/worker.rs",
    "602fe3db2e013c09ac2daf30e0f65013017f08213db1057a9e7a0b8700d898cf",
  ],
  [
    "src/stores/chat.store.ts",
    "852174663a6803667feff22ee9a17a1cef109ee74e9b35dc4dd5da39f956a29e",
  ],
  [
    "src/stores/chat.store.test.ts",
    "bf94f7a423d1c7b06067dd8b217c3f4b990edeffcd0ad59fc45fd78ff85b1186",
  ],
  [
    "src/feat128/s10d-runtime-axe-frame.ts",
    "40688cc0ee64bc27cf9f31c6418a95c341d9a1d571ac2fed42301906fae89524",
  ],
  [
    "src/feat128/s10d-runtime-axe-engine.ts",
    "2be6de2e433ed6f348e5181c0ac251cda96a3bb42d2826d601e2e6cd9320301b",
  ],
]);
const POST_LIFECYCLE_REPAIR_FILES = [...POST_LIFECYCLE_REPAIR_DIGESTS.keys()];
const ALL_REPAIR_DIGESTS = new Map([
  ...S9B_R_REPAIR_DIGESTS,
  ...TERMINAL_ORDER_EVIDENCE_REPAIR_DIGESTS,
  ...POST_LIFECYCLE_REPAIR_DIGESTS,
]);

describe("FEAT-128 S10D-H scope boundary", () => {
  it("allows only the frozen H harness files", () => {
    expect(() => validateScopeFiles([
      "contracts/agent-host-v2-turn.lock.json",
      "contracts/agent-host-v3-artifacts.lock.json",
      "scripts/check-agent-host-contract.mjs",
      "scripts/check-agent-host-contract.test.mjs",
      "scripts/check-agent-host-v3-contract.mjs",
      "src-tauri/src/lib.rs",
      "src-tauri/src/chat/mod.rs",
      "src-tauri/src/feat128_s10d_runtime.rs",
      "src-tauri/src/native_auth/runtime.rs",
      "src/main.ts",
      "src/feat128/s10d-runtime-controller.ts",
      "src/feat128/s10d-runtime-controller.test.ts",
      "scripts/run-feat128-s10d-runtime-smoke.sh",
      "scripts/check-feat128-s10d-h.mjs",
      "scripts/check-feat128-s10d-h.test.mjs",
      ...S9B_R_REPAIR_FILES,
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES,
    ], ALL_REPAIR_DIGESTS)).not.toThrow();
    expect(() => validateScopeFiles(["src/pages/chat/ChatPage.vue"]))
      .toThrow("S10D-H changed a forbidden file");
  });

  it("allows the approved S9B-R repair only at exact content digests", () => {
    expect(() => validateScopeFiles([
      ...S9B_R_REPAIR_FILES,
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES,
    ], ALL_REPAIR_DIGESTS))
      .not.toThrow();

    const wrongDigests = new Map(ALL_REPAIR_DIGESTS);
    wrongDigests.set(S9B_R_REPAIR_FILES[0], "0".repeat(64));
    expect(() => validateScopeFiles([
      ...S9B_R_REPAIR_FILES,
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES,
    ], wrongDigests))
      .toThrow("S10D-H approved S9B-R repair digest mismatch");
  });

  it("fails closed when an approved S9B-R repair file is missing", () => {
    expect(() => validateScopeFiles([
      ...S9B_R_REPAIR_FILES.slice(0, 2),
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES,
    ], ALL_REPAIR_DIGESTS))
      .toThrow("S10D-H approved S9B-R repair file missing");
  });

  it("rejects every additional components/chat file", () => {
    expect(() => validateScopeFiles([
      ...S9B_R_REPAIR_FILES,
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES,
      "src/components/chat/ChatArtifactShell.vue",
    ], ALL_REPAIR_DIGESTS)).toThrow("S10D-H changed a forbidden file");
  });

  it("allows the terminal-order/evidence repair only at exact content digests", () => {
    expect(() => validateScopeFiles([
      ...S9B_R_REPAIR_FILES,
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES,
    ], ALL_REPAIR_DIGESTS)).not.toThrow();
    const wrongDigests = new Map(ALL_REPAIR_DIGESTS);
    wrongDigests.set(TERMINAL_ORDER_EVIDENCE_REPAIR_FILES[0], "0".repeat(64));
    expect(() => validateScopeFiles([
      ...S9B_R_REPAIR_FILES,
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES,
    ], wrongDigests)).toThrow("S10D-H terminal-order/evidence repair digest mismatch");
  });

  it("allows the post-lifecycle repair only at exact content digests", () => {
    expect(() => validateScopeFiles([
      ...S9B_R_REPAIR_FILES,
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES,
    ], ALL_REPAIR_DIGESTS)).not.toThrow();
    const wrongDigests = new Map(ALL_REPAIR_DIGESTS);
    wrongDigests.set(POST_LIFECYCLE_REPAIR_FILES[0], "0".repeat(64));
    expect(() => validateScopeFiles([
      ...S9B_R_REPAIR_FILES,
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES,
    ], wrongDigests)).toThrow("S10D-H post-lifecycle repair digest mismatch");
    expect(() => validateScopeFiles([
      ...S9B_R_REPAIR_FILES,
      ...TERMINAL_ORDER_EVIDENCE_REPAIR_FILES,
      ...POST_LIFECYCLE_REPAIR_FILES.slice(1),
    ], ALL_REPAIR_DIGESTS)).toThrow("S10D-H post-lifecycle repair file missing");
  });

  it("requires deterministic native project bootstrap and rejects picker automation", () => {
    const chat = `
      #[cfg(feature = "feat128-s10-runtime")]
      async fn feat128_s10d_register_profile_project() {}
    `;
    const runtime = "chat.feat128_s10d_register_profile_project(project).await";
    const runner = "/usr/sbin/screencapture -l";
    expect(() => validateProjectBootstrapSources(chat, runtime, runner)).not.toThrow();
    expect(() => validateProjectBootstrapSources(chat, "chat_pick_project(chat).await", runner))
      .toThrow("S10D-H prepare must use deterministic project bootstrap");
    expect(() => validateProjectBootstrapSources(chat, runtime, "/usr/bin/osascript System Events picker_timeout"))
      .toThrow("S10D-H runner must not automate the native project picker");
  });

  it("requires production App/router bootstrap before the optional controller", () => {
    expect(() => validateMainSource(`
      const feat128S10dRuntimeEnabled = import.meta.env.VITE_FEAT128_S10D_RUNTIME === "true";
      const app = createApp(App).use(createPinia()).use(router);
      app.mount(root);
      await router.isReady();
      if (feat128S10dRuntimeEnabled) await import("./feat128/s10d-runtime-controller");
    `)).not.toThrow();
    expect(() => validateMainSource(`
      await import("./feat128/s10d-runtime-controller");
      createApp(App).mount(root);
    `)).toThrow("S10D-H controller must follow production bootstrap");
  });

  it("rejects second-app, store mutation, and production command shortcuts", () => {
    expect(() => validateControllerSource(`
      invoke("feat128_s10d_runtime_prepare_v1");
      invoke("feat128_s10d_runtime_checkpoint_v1");
      invoke("feat128_s10d_runtime_finish_v1");
      document.querySelector('[aria-label="发送任务"]');
    `)).not.toThrow();
    expect(() => validateControllerSource("createApp(App).mount(root)"))
      .toThrow("S10D-H controller bypasses production UI");
    expect(() => validateControllerSource("invoke('chat_submit_turn_v1')"))
      .toThrow("S10D-H controller bypasses production UI");
    expect(() => validateControllerSource("useArtifactStore().resetAuthority()"))
      .toThrow("S10D-H controller bypasses production UI");
  });

  it("allows only the exact read-only router and permission diagnostic surface", () => {
    expect(() => validateControllerSource(`
      import { watch } from "vue";
      import { router } from "../router";
      import { usePermissionStore } from "../stores/permission.store";
      ${EXACT_COMMANDS}
      const permissionStore = usePermissionStore();
      const removeBeforeEach = router.beforeEach(() => true);
      const removeAfterEach = router.afterEach(() => undefined);
      const removeOnError = router.onError(() => undefined);
      const stopPermission = watch([
        () => permissionStore.isReady,
        () => permissionStore.hasCapability("task.create"),
      ], () => undefined);
      removeBeforeEach();
      removeAfterEach();
      removeOnError();
      stopPermission();
    `)).not.toThrow();
  });

  it.each([
    ["router.push('/chat')", "router navigation"],
    ["router.replace('/settings')", "router navigation"],
    ["router.go(-1)", "router navigation"],
    ["router.back()", "router navigation"],
    ["router.forward()", "router navigation"],
    ["history.pushState({}, '', '/chat')", "History navigation"],
    ["history.replaceState({}, '', '/chat')", "History navigation"],
    ["location.assign('/chat')", "location navigation"],
    ["location.replace('/chat')", "location navigation"],
    ["permissionStore.refresh()", "permission mutation"],
    ["permissionStore.ensureInitialized()", "permission mutation"],
    ["permissionStore.selectTenant('tenant')", "permission mutation"],
    ["permissionStore.clearForLogout()", "permission mutation"],
    ["permissionStore.phase = 'ready'", "permission mutation"],
    ["permissionStore.$patch({ phase: 'ready' })", "permission mutation"],
    ["permissionStore.$reset()", "permission mutation"],
    ["import { useChatStore } from '../stores/chat.store'", "other Store"],
    ["import { useArtifactStore } from '../stores/artifact.store'", "other Store"],
    ["createPinia()", "Pinia seed"],
    ["createApp(App)", "second App"],
    ["invoke('chat_submit_turn_v1')", "production command"],
    ["localStorage.setItem('seed', 'x')", "browser storage"],
    ["indexedDB.open('seed')", "browser storage"],
    ["openDatabase('seed')", "direct DB"],
    ["readFile('/tmp/spool')", "direct spool"],
  ])("rejects %s as %s", (forbidden) => {
    expect(() => validateControllerSource(`${EXACT_COMMANDS}\n${forbidden}`))
      .toThrow("S10D-H controller bypasses production UI");
  });

  it("checks the actual repository", async () => {
    await expect(checkFeat128S10dH()).resolves.toBeUndefined();
  });

  it("requires one bounded content-free lifecycle diagnostic after explicit cleanup", () => {
    const runner = readFileSync(new URL("./run-feat128-s10d-runtime-smoke.sh", import.meta.url), "utf8");
    for (const classification of [
      "native_lifecycle_incomplete",
      "native_complete_dom_ready_incomplete",
      "native_complete_dom_kind_incomplete",
      "lifecycle_complete_finish_failed",
    ]) {
      expect(runner).toContain(classification);
    }
    expect(runner).toContain("hostNative");
    expect(runner).toContain("domReadyShells");
    expect(runner).toContain("runRoot: true");
  });

  it("classifies storage residue without masking lifecycle evidence or final cleanup", () => {
    const runner = readFileSync(new URL("./run-feat128-s10d-runtime-smoke.sh", import.meta.url), "utf8");
    for (const classification of [
      "desktop_sqlcipher_wal",
      "desktop_sqlcipher_shm",
      "desktop_atomic_tmp",
      "host_spool_or_tmp",
      "unknown_storage_residue",
    ]) {
      expect(runner).toContain(classification);
    }
    expect(runner).toContain("residueClassification");
    expect(runner).toContain("cleanup_run_root");
    expect(runner).not.toContain("content_free_failure runtime_storage_residue");
    expect(runner).not.toContain("content_free_failure runtime_spool_residue");
  });

  it("reports only a closed WAL state and infers a missing post-screenshot result as finish handshake failure", () => {
    const runner = readFileSync(new URL("./run-feat128-s10d-runtime-smoke.sh", import.meta.url), "utf8");
    expect(runner).toContain("walState");
    expect(runner).toContain("desktop_sqlcipher_wal:empty");
    expect(runner).toContain("desktop_sqlcipher_wal:nonempty");
    expect(runner).toContain("runtime_finish_handshake_failed");
    expect(runner).not.toContain("walBytes");
  });

  it("preserves only the bounded fixed-order axe stage sequence in failure evidence", () => {
    const runner = readFileSync(new URL("./run-feat128-s10d-runtime-smoke.sh", import.meta.url), "utf8");
    expect(runner).toContain("axeStages");
    for (const stage of [
      "axe_script_loaded",
      "axe_script_error",
      "axe_nonce_consumed",
      "axe_bootstrap_started",
      "axe_import_resolved",
      "axe_import_rejected",
      "axe_run_resolved",
      "axe_run_rejected",
    ]) {
      expect(runner).toContain(stage);
    }
    expect(runner).not.toContain("axeError");
    expect(runner).not.toContain("axeMessage");
  });

  it("runs the isolated axe chunk only against the same-realm production document", () => {
    const controller = readFileSync(
      new URL("../src/feat128/s10d-runtime-controller.ts", import.meta.url),
      "utf8",
    );
    const axeModule = readFileSync(
      new URL("../src/feat128/s10d-runtime-axe-engine.ts", import.meta.url),
      "utf8",
    );
    expect(controller).not.toContain('document.createElement("iframe")');
    expect(controller).toContain("document.head.append(script)");
    expect(axeModule).toContain("axe.run(document");
    expect(axeModule).not.toContain("window.parent.document");
    expect(axeModule).not.toContain("freezePrototype");
  });

  it("boots before the production controller imports the isolated axe module chunk", () => {
    const controller = readFileSync(
      new URL("../src/feat128/s10d-runtime-controller.ts", import.meta.url),
      "utf8",
    );
    const bootstrap = readFileSync(
      new URL("../src/feat128/s10d-runtime-axe-frame.ts", import.meta.url),
      "utf8",
    );
    const engine = readFileSync(
      new URL("../src/feat128/s10d-runtime-axe-engine.ts", import.meta.url),
      "utf8",
    );
    expect(controller).toContain('script.addEventListener("load"');
    expect(controller).toContain('script.addEventListener("error"');
    expect(bootstrap).toContain('stage: "axe_bootstrap_started"');
    expect(controller).toContain('import("./s10d-runtime-axe-engine")');
    expect(bootstrap).not.toContain("axeEngineModuleUrl");
    expect(bootstrap).not.toContain("import(");
    expect(bootstrap).not.toContain('import axe from "axe-core"');
    expect(engine).toContain('import axeScriptUrl from "axe-core/axe.min.js?url"');
    expect(engine).toContain('stage: "axe_import_resolved"');
    expect(engine).toContain("axe.run(document");
  });
});
