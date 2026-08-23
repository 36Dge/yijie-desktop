import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = "8afdc996c11bbad2d275eb8b86a0f6b82ca5da52";
const ALLOWED = new Set([
  "contracts/agent-host-v2-turn.lock.json",
  "contracts/agent-host-v3-artifacts.lock.json",
  "scripts/check-agent-host-contract.mjs",
  "scripts/check-agent-host-contract.test.mjs",
  "scripts/check-agent-host-v3-contract.mjs",
  "src-tauri/src/lib.rs",
  "src-tauri/src/chat/mod.rs",
  "src-tauri/src/feat128_s10d_runtime.rs",
  "src-tauri/src/native_auth/mod.rs",
  "src-tauri/src/native_auth/runtime.rs",
  "src/main.ts",
  "src/feat128/s10d-runtime-controller.ts",
  "src/feat128/s10d-runtime-controller.test.ts",
  "scripts/run-feat128-s10d-runtime-smoke.sh",
  "scripts/check-feat128-s10d-h.mjs",
  "scripts/check-feat128-s10d-h.test.mjs",
]);

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

const APPROVED_REPAIR_DIGESTS = new Map([
  ...S9B_R_REPAIR_DIGESTS,
  ...TERMINAL_ORDER_EVIDENCE_REPAIR_DIGESTS,
  ...POST_LIFECYCLE_REPAIR_DIGESTS,
]);

function repairName(file) {
  if (S9B_R_REPAIR_DIGESTS.has(file)) return "approved S9B-R";
  if (TERMINAL_ORDER_EVIDENCE_REPAIR_DIGESTS.has(file)) return "terminal-order/evidence";
  return "post-lifecycle";
}

export function validateScopeFiles(files, repairDigests = new Map()) {
  const changed = new Set(files);
  for (const file of files) {
    if (ALLOWED.has(file)) continue;
    const expectedDigest = APPROVED_REPAIR_DIGESTS.get(file);
    if (expectedDigest === undefined) {
      throw new Error(`S10D-H changed a forbidden file: ${file}`);
    }
    if (repairDigests.get(file) !== expectedDigest) {
      throw new Error(`S10D-H ${repairName(file)} repair digest mismatch: ${file}`);
    }
  }
  for (const file of APPROVED_REPAIR_DIGESTS.keys()) {
    if (!changed.has(file)) {
      throw new Error(`S10D-H ${repairName(file)} repair file missing: ${file}`);
    }
  }
}

async function readS9bRRepairDigests() {
  const digests = new Map();
  for (const file of APPROVED_REPAIR_DIGESTS.keys()) {
    let content;
    try {
      content = await readFile(path.join(ROOT, file));
    } catch {
      throw new Error(`S10D-H approved S9B-R repair file missing: ${file}`);
    }
    digests.set(file, createHash("sha256").update(content).digest("hex"));
  }
  return digests;
}

export function validateMainSource(source) {
  const production = source.indexOf("createApp(App)");
  const mounted = source.indexOf(".mount(root)", production);
  const ready = source.indexOf("router.isReady()", mounted);
  const controller = source.indexOf('import("./feat128/s10d-runtime-controller")');
  if (production < 0 || mounted < 0 || ready < 0 || controller < 0 || controller < ready) {
    throw new Error("S10D-H controller must follow production bootstrap");
  }
  if (!source.includes('VITE_FEAT128_S10D_RUNTIME === "true"')) {
    throw new Error("S10D-H exact frontend gate missing");
  }
}

export function validateControllerSource(source) {
  const fail = () => {
    throw new Error("S10D-H controller bypasses production UI");
  };
  const forbidden = [
    /createApp\s*\(/,
    /createPinia\s*\(/,
    /setActivePinia\s*\(/,
    /use(?:Artifact|Chat)Store\s*\(/,
    /invoke\s*\(\s*["']chat_/,
    /localStorage|sessionStorage|indexedDB/,
    /\b(?:window\s*\.\s*)?history\s*\.\s*(?:pushState|replaceState|go|back|forward)\s*\(/,
    /\b(?:window\s*\.\s*)?location\s*\.\s*(?:assign|replace)\s*\(/,
    /\b(?:window\s*\.\s*)?location\s*\.\s*href\s*=/,
    /\b(?:openDatabase|readFile|writeFile|readDir)\s*\(/,
    /\b(?:fetch|XMLHttpRequest)\s*\(/,
    /import\s*\(\s*["'][^"']*(?:stores|pinia|router)[^"']*["']\s*\)/,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    fail();
  }

  const imports = source.matchAll(
    /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/g,
  );
  for (const match of imports) {
    const clause = match[1].replace(/\s+/g, "");
    const module = match[2];
    if (module === "../router") {
      if (clause !== "{router}") fail();
    } else if (module === "../stores/permission.store") {
      if (clause !== "{usePermissionStore}") fail();
    } else if (module === "vue") {
      if (clause !== "{watch}") fail();
    } else if (/(?:stores|pinia|router)/.test(module)) {
      fail();
    }
  }

  const routerMembers = source.matchAll(/\brouter\s*\.\s*([A-Za-z_$][\w$]*)/g);
  const allowedRouterMembers = new Set(["beforeEach", "afterEach", "onError"]);
  for (const match of routerMembers) {
    if (!allowedRouterMembers.has(match[1])) fail();
  }
  if (
    /\brouter\s*\[/.test(source) ||
    /\{[^}]*\b(?:push|replace|go|back|forward)\b[^}]*\}\s*=\s*router/.test(source)
  ) {
    fail();
  }

  const permissionFactoryCalls = [...source.matchAll(/\busePermissionStore\s*\(/g)].length;
  if (permissionFactoryCalls > 0) {
    if (
      permissionFactoryCalls !== 1 ||
      !/const\s+permissionStore\s*=\s*usePermissionStore\s*\(\s*\)\s*;/.test(source)
    ) {
      fail();
    }
  }
  const permissionMembers = source.matchAll(
    /\bpermissionStore\s*\.\s*([A-Za-z_$][\w$]*)/g,
  );
  const allowedPermissionMembers = new Set(["isReady", "hasCapability"]);
  for (const match of permissionMembers) {
    if (!allowedPermissionMembers.has(match[1])) fail();
  }
  if (
    /\bpermissionStore\s*\[/.test(source) ||
    /\bpermissionStore\s*\.\s*(?:isReady|hasCapability)\s*(?:=|\+\+|--)/.test(source) ||
    /\b(?:delete\s+permissionStore|Object\.assign\s*\(\s*permissionStore|Reflect\.set\s*\(\s*permissionStore)/.test(source) ||
    /\{[^}]+\}\s*=\s*permissionStore/.test(source)
  ) {
    fail();
  }
  for (const command of [
    "feat128_s10d_runtime_prepare_v1",
    "feat128_s10d_runtime_checkpoint_v1",
    "feat128_s10d_runtime_finish_v1",
  ]) {
    if (!source.includes(command)) throw new Error("S10D-H exact command missing");
  }
}

export function validateProjectBootstrapSources(chatSource, runtimeSource, runnerSource) {
  if (!chatSource.includes('#[cfg(feature = "feat128-s10-runtime")]') ||
      !chatSource.includes("feat128_s10d_register_profile_project")) {
    throw new Error("S10D-H feature-only project bootstrap missing");
  }
  if (!runtimeSource.includes(".feat128_s10d_register_profile_project(") ||
      runtimeSource.includes("chat_pick_project")) {
    throw new Error("S10D-H prepare must use deterministic project bootstrap");
  }
  for (const forbidden of [
    "/usr/bin/osascript",
    "System Events",
    "NSOpenPanel",
    "AXDefaultButton",
    "picker_",
  ]) {
    if (runnerSource.includes(forbidden)) {
      throw new Error("S10D-H runner must not automate the native project picker");
    }
  }
}

function changedFiles() {
  const committed = execFileSync("git", ["diff", "--name-only", `${BASELINE}..HEAD`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const working = execFileSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return [...new Set([
    ...committed.split("\n").filter(Boolean),
    ...working.split("\n").filter(Boolean).map((line) => line.slice(3)),
  ])];
}

export async function checkFeat128S10dH() {
  const files = changedFiles();
  const repairDigests = await readS9bRRepairDigests();
  validateScopeFiles(files, repairDigests);
  const [main, controller, lib, chat, runtime, runner] = await Promise.all([
    readFile(path.join(ROOT, "src/main.ts"), "utf8"),
    readFile(path.join(ROOT, "src/feat128/s10d-runtime-controller.ts"), "utf8"),
    readFile(path.join(ROOT, "src-tauri/src/lib.rs"), "utf8"),
    readFile(path.join(ROOT, "src-tauri/src/chat/mod.rs"), "utf8"),
    readFile(path.join(ROOT, "src-tauri/src/feat128_s10d_runtime.rs"), "utf8"),
    readFile(path.join(ROOT, "scripts/run-feat128-s10d-runtime-smoke.sh"), "utf8"),
  ]);
  validateMainSource(main);
  validateControllerSource(controller);
  validateProjectBootstrapSources(chat, runtime, runner);
  if (!lib.includes('#[cfg(feature = "feat128-s10-runtime")]\nmod feat128_s10d_runtime;')) {
    throw new Error("S10D-H native module gate missing");
  }
  for (const command of ["prepare_v1", "checkpoint_v1", "finish_v1"]) {
    if (!lib.includes(`feat128_s10d_runtime::feat128_s10d_runtime_${command}`)) {
      throw new Error("S10D-H native command registration missing");
    }
  }
  for (const token of [
    "--features feat128-s10-runtime,tauri/custom-protocol",
    "/usr/sbin/screencapture",
    "port_is_free 18080",
    "127.0.0.1:18082",
  ]) {
    if (!runner.includes(token)) throw new Error("S10D-H runner boundary missing");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkFeat128S10dH().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "S10D-H checker failed"}\n`);
    process.exitCode = 1;
  });
}
