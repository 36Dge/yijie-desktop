import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractsRoot = resolve(
  process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? join(desktopRoot, "../yijie-contracts"),
);
const hostRoot = resolve(
  process.env.YIJIE_DESKTOP_AGENT_HOST_DIR ?? join(desktopRoot, "../yijie-agent-host"),
);
const runtimeRoot = resolve(
  process.env.YIJIE_DESKTOP_CODEX_RUNTIME_DIR ?? join(desktopRoot, "../yijie-codex"),
);
const lock = JSON.parse(
  readFileSync(join(desktopRoot, "src-tauri/contracts/feat137.lock.json"), "utf8"),
);
const reviewWorktree = process.argv.length === 3 && process.argv[2] === "--review-worktree";

function fail(message) {
  throw new Error(`FEAT-137 v6 authority check failed: ${message}`);
}

function git(repositoryRoot, ...args) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" }).trimEnd();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function countExact(source, needle) {
  return source.split(needle).length - 1;
}

function extractInvokeHandler(source, cfg) {
  const marker = `${cfg}\n    let builder = builder.invoke_handler(tauri::generate_handler![`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) {
    fail(`Desktop does not contain exactly one ${cfg} invoke handler`);
  }
  const bodyStart = start + marker.length;
  const bodyEnd = source.indexOf("\n    ]);", bodyStart);
  if (bodyEnd < 0) fail(`Desktop ${cfg} invoke handler is not closed`);
  return source.slice(bodyStart, bodyEnd);
}

if (process.argv.length > (reviewWorktree ? 3 : 2)) {
  fail("unsupported arguments; expected only --review-worktree");
}

if (lock.contractCommit !== "aeccf5d561bd4259389cdb325bae84ce3e0dea86" ||
    lock.contractVersion !== "v0.7.0" || lock.schemaVersion !== 6 ||
    lock.desktopBaseCommit !== "7026b47828961e58854b06c822c9c9e11252260d") {
  fail("Contracts identity is not the frozen v0.7.0 / v6 authority");
}
if (git(contractsRoot, "rev-parse", "HEAD") !== lock.contractCommit ||
    git(contractsRoot, "status", "--porcelain=v1") !== "") {
  fail("Contracts checkout is not the exact clean frozen commit");
}
for (const [relativeFile, expected] of Object.entries(lock.sources)) {
  const actual = sha256(readFileSync(join(contractsRoot, relativeFile)));
  if (actual !== expected) fail(`Contracts source drifted: ${relativeFile}`);
}
for (const [relativeTree, expected] of Object.entries(lock.fixtureTrees)) {
  if (git(contractsRoot, "rev-parse", `HEAD:${relativeTree}`) !== expected) {
    fail(`Contracts fixture tree drifted: ${relativeTree}`);
  }
}

const runtime = lock.runtimeAuthority;
if (runtime?.commit !== "acf2da55d8a53175343aaf112e03368dfef9922a" ||
    runtime?.tree !== "97557e0bd736a91bbbf94ccfa11b57a4bbf23a74" ||
    runtime?.artifactRelativeRoot !== ".yijie/build/macos/aarch64-apple-darwin" ||
    runtime?.hostArtifactDirectory !== "feat-137-acf2da55d8a5" ||
    runtime?.binarySha256 !== "84bb0445a15f99354ddd38ccb407b9b0d3d28522accece3fa9755918ab6978e3" ||
    runtime?.manifestSha256 !== "e62d8210f5abcad7ff0fc1b4d068c7fe4da59501c6fa6b12f18dc4a1f939c6aa") {
  fail("Runtime identity is not the reviewed immutable FEAT-137 provenance authority");
}
if (git(runtimeRoot, "rev-parse", "HEAD") !== runtime.commit ||
    git(runtimeRoot, "rev-parse", "HEAD^{tree}") !== runtime.tree ||
    git(runtimeRoot, "status", "--porcelain=v1", "--untracked-files=all") !== "") {
  fail("Runtime checkout is not the exact clean frozen commit/tree");
}
const runtimeBuildRoot = join(runtimeRoot, runtime.artifactRelativeRoot);
const hostRuntimeArtifactRoot = join(hostRoot, ".local/runtime-artifacts", runtime.hostArtifactDirectory);
for (const [name, expected] of [
  ["codex", runtime.binarySha256],
  ["runtime-manifest.json", runtime.manifestSha256],
]) {
  if (sha256(readFileSync(join(runtimeBuildRoot, name))) !== expected) {
    fail(`Runtime build artifact drifted: ${name}`);
  }
  if (sha256(readFileSync(join(hostRuntimeArtifactRoot, name))) !== expected) {
    fail(`Host stable Runtime artifact drifted: ${name}`);
  }
}

const host = lock.hostAuthority;
if (host?.commit !== "078769a22d035c2921e315e5776185bed6f7feeb" ||
    host?.tree !== "df7e5b6bc4994a1a4023793e766a87c7806f1e07") {
  fail("Host identity is not the reviewed immutable v6 authority");
}
if (git(hostRoot, "rev-parse", "HEAD") !== host.commit ||
    git(hostRoot, "rev-parse", "HEAD^{tree}") !== host.tree ||
    git(hostRoot, "status", "--porcelain=v1", "--untracked-files=all") !== "") {
  fail("Host checkout is not the exact clean frozen commit/tree");
}

for (const [contractFile, hostFile] of [
  ["openapi/agent-host/agent-host.yaml", "api/openapi/agent-host.yaml"],
  ["jsonschema/agent/session-event-v6.schema.json", "api/jsonschema/agent-session-event-v6.schema.json"],
  ["jsonschema/compatibility/agent-host-runtime-approval-v6.schema.json", "api/jsonschema/agent-host-runtime-approval-v6.schema.json"],
  ["compatibility/agent-host-runtime-approval-v6.json", "api/compatibility/agent-host-runtime-approval-v6.json"],
  ["jsonschema/compatibility/agent-host-runtime-approval-v6-v2.schema.json", "api/jsonschema/agent-host-runtime-approval-v6-v2.schema.json"],
  ["compatibility/agent-host-runtime-approval-v6-v2.json", "api/compatibility/agent-host-runtime-approval-v6-v2.json"],
  ["jsonschema/compatibility/agent-host-runtime-approval-v6-v3.schema.json", "api/jsonschema/agent-host-runtime-approval-v6-v3.schema.json"],
  ["compatibility/agent-host-runtime-approval-v6-v3.json", "api/compatibility/agent-host-runtime-approval-v6-v3.json"],
]) {
  if (sha256(readFileSync(join(contractsRoot, contractFile))) !==
      sha256(readFileSync(join(hostRoot, hostFile)))) {
    fail(`Host source is not equal to Contracts: ${hostFile}`);
  }
}

const nativeSource = readFileSync(join(desktopRoot, "src-tauri/src/chat/mod.rs"), "utf8");
if (!nativeSource.includes(`const CONTRACT_COMMIT: &str = "${lock.contractCommit}";`)) {
  fail("Desktop native Contracts identity is not exact");
}
const sidecarSource = readFileSync(join(desktopRoot, "src-tauri/src/chat/sidecar.rs"), "utf8");
if (!sidecarSource.includes(`const FEAT137_COMMAND_APPROVAL_ENV: &str = "${lock.activation.nativeFlag}";`)) {
  fail("Desktop sidecar does not own the exact FEAT-137 native flag");
}
const ipcSource = readFileSync(join(desktopRoot, "src-tauri/src/chat/ipc.rs"), "utf8");
for (const relativeFile of [
  "src-tauri/src/chat/ipc.rs",
  "src-tauri/src/chat/database.rs",
  "src/domain/chat-ipc.ts",
  "src/stores/chat.store.ts",
  "src/pages/chat/ChatPage.vue",
]) {
  const source = readFileSync(join(desktopRoot, relativeFile), "utf8");
  if (/sandboxPermissions|sandbox_permissions/.test(source)) {
    fail(`Runtime sandbox provenance escaped into Desktop projection: ${relativeFile}`);
  }
}
const approvalCommands = [...new Set(
  ipcSource.match(/\bchat_[a-z0-9_]*approval[a-z0-9_]*\b/g) ?? [],
)];
if (JSON.stringify(approvalCommands) !== JSON.stringify(["chat_decide_approval_v6"]) ||
    countExact(ipcSource, "pub async fn chat_decide_approval_v6(") !== 1) {
  fail("Desktop exposes an approval decision command outside the single reviewed v6 command");
}
const payloadStart = ipcSource.indexOf("struct DecideApprovalV6Payload {");
const payloadEnd = ipcSource.indexOf("\n}", payloadStart);
if (payloadStart < 0 || payloadEnd < 0) fail("Desktop v6 decision payload is missing");
const payloadFields = [...ipcSource.slice(payloadStart, payloadEnd).matchAll(
  /^\s+([a-z][a-z0-9_]*):\s*([^,]+),$/gm,
)].map((match) => `${match[1]}: ${match[2]}`);
if (JSON.stringify(payloadFields) !== JSON.stringify([
  "session_id: Uuid",
  "turn_id: Uuid",
  "item_id: String",
  "approval_request_id: Uuid",
  "decision: HostApprovalDecision",
])) {
  fail("Desktop v6 decision payload widened beyond local identity and the closed decision");
}

const libSource = readFileSync(join(desktopRoot, "src-tauri/src/lib.rs"), "utf8");
const normalHandler = extractInvokeHandler(
  libSource,
  '#[cfg(not(feature = "feat126-s10-driver"))]',
);
const featureHandler = extractInvokeHandler(
  libSource,
  '#[cfg(feature = "feat126-s10-driver")]',
);
if (countExact(normalHandler, "chat::ipc::chat_decide_approval_v6") !== 1 ||
    JSON.stringify([...new Set(
      normalHandler.match(/\bchat::ipc::chat_[a-z0-9_]*approval[a-z0-9_]*\b/g) ?? [],
    )]) !== JSON.stringify(["chat::ipc::chat_decide_approval_v6"])) {
  fail("normal Desktop handler must register only chat_decide_approval_v6, exactly once");
}
if (/\bchat_[a-z0-9_]*approval[a-z0-9_]*\b/.test(featureHandler)) {
  fail("feature-only Desktop handler must not register an approval decision command");
}

if (git(desktopRoot, "rev-parse", `${lock.desktopBaseCommit}^{commit}`) !==
      lock.desktopBaseCommit ||
    git(desktopRoot, "merge-base", lock.desktopBaseCommit, "HEAD") !==
      lock.desktopBaseCommit) {
  fail("Desktop HEAD is not based on the immutable FEAT-137 Desktop base");
}
const desktopStatusLines = git(
  desktopRoot,
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
).split("\n").filter(Boolean);
if (reviewWorktree) {
  if (desktopStatusLines.some((line) => line[0] !== " " && !line.startsWith("??"))) {
    fail("Desktop review worktree contains staged or conflicted changes");
  }
} else if (desktopStatusLines.length !== 0) {
  fail("Desktop checkout is not clean; use --review-worktree only before freezing");
}

const protectedDesktopPaths = [
  "Cargo.toml",
  "Cargo.lock",
  "pnpm-lock.yaml",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  ":(glob)src-tauri/tauri*.conf.json",
  "src-tauri/capabilities",
];
const protectedDesktopStatus = git(
  desktopRoot,
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
  "--",
  ...protectedDesktopPaths,
);
const protectedDesktopDiff = git(
  desktopRoot,
  "diff",
  "--name-only",
  lock.desktopBaseCommit,
  "--",
  ...protectedDesktopPaths,
);
if (protectedDesktopStatus !== "" || protectedDesktopDiff !== "") {
  fail("Desktop Cargo, Tauri CSP, or capability configuration drifted");
}
const currentPackage = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
const basePackage = JSON.parse(git(
  desktopRoot,
  "show",
  `${lock.desktopBaseCommit}:package.json`,
));
for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
  if (JSON.stringify(currentPackage[key] ?? {}) !== JSON.stringify(basePackage[key] ?? {})) {
    fail(`Desktop package ${key} drifted`);
  }
}

const desktopDiff = git(
  desktopRoot,
  "diff",
  "--unified=0",
  "--no-ext-diff",
  lock.desktopBaseCommit,
  "--",
);
const addedSource = [
  ...desktopDiff.split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1)),
  ...desktopStatusLines
    .filter((line) => line.startsWith("??"))
    .flatMap((line) => readFileSync(join(desktopRoot, line.slice(3)), "utf8").split("\n")),
].join("\n");
if (/(?:https?|wss?):\/\//i.test(addedSource)) {
  fail("Desktop added an external URL relative to the immutable base");
}
const tauriPluginNeedle = "tauri" + "_plugin_";
const jsPluginNeedle = "@tauri-apps/" + "plugin-";
if (addedSource.includes(tauriPluginNeedle) || addedSource.includes(jsPluginNeedle)) {
  fail("Desktop added a Tauri plugin relative to the immutable base");
}

const packageJson = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
const stableBuild = packageJson.scripts?.[lock.activation.stableEntry] ?? "";
const checkerInvocation = "node scripts/check-agent-host-v6-contract.mjs";
if (!stableBuild.includes(checkerInvocation)) {
  fail("stable build omits the v6 authority check");
}
for (const assignment of [
  "VITE_YIJIE_FEAT134_STREAMING_ENABLED=true",
  "VITE_YIJIE_FEAT136_EXECUTION_ENABLED=true",
  `${lock.activation.webFlag}=true`,
]) {
  if (!stableBuild.includes(assignment)) fail(`stable build omits ${assignment}`);
}
for (const scriptName of ["tauri:dev:raw", "tauri:build", "tauri:build:demo-fast"]) {
  const script = packageJson.scripts?.[scriptName] ?? "";
  if (!script.includes(`-u ${lock.activation.nativeFlag}`) ||
      !script.includes(`-u ${lock.activation.webFlag}`)) {
    fail(`${scriptName} does not clear FEAT-137 activation`);
  }
}
for (const scriptName of ["generate", "generate:check"]) {
  if ((packageJson.scripts?.[scriptName] ?? "").includes(checkerInvocation)) {
    fail(`${scriptName} incorrectly binds default tooling to the immutable Host authority`);
  }
}

const runner = readFileSync(join(desktopRoot, "scripts/run-local-demo-fast.sh"), "utf8");
for (const line of [
  `feat137_runtime_binary_sha256="${runtime.binarySha256}"`,
  `feat137_runtime_manifest_sha256="${runtime.manifestSha256}"`,
  `    codex_runtime_root="$host_root/.local/runtime-artifacts/${runtime.hostArtifactDirectory}"`,
]) {
  if (runner.split("\n").filter((candidate) => candidate === line).length !== 1) {
    fail(`canonical runner does not contain exactly one Runtime authority line: ${line.trim()}`);
  }
}
for (const line of [
  `      ${lock.activation.nativeFlag}=true`,
  `      ${lock.activation.webFlag}=true`,
  `  -u ${lock.activation.nativeFlag} \\`,
  `  -u ${lock.activation.webFlag} \\`,
]) {
  if (runner.split("\n").filter((candidate) => candidate === line).length !== 1) {
    fail(`canonical runner does not contain exactly one closed line: ${line.trim()}`);
  }
}
const checkerOffset = runner.indexOf(checkerInvocation);
const checkerGuardOffset = runner.lastIndexOf('if [[ "$stable_api_only" == "true" ]]; then', checkerOffset);
const checkerGuardEnd = runner.indexOf("\nfi", checkerGuardOffset);
if (checkerOffset < 0 || checkerGuardOffset < 0 || checkerGuardEnd < checkerOffset ||
    runner.indexOf(checkerInvocation, checkerOffset + checkerInvocation.length) >= 0) {
  fail("canonical runner does not isolate exactly one v6 authority check to the stable branch");
}

console.log("FEAT-137 v6 immutable Contracts/Host and Desktop base authority: OK");
