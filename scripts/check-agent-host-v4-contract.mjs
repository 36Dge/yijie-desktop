import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { loadPinnedOpenApiParser } from "./check-agent-host-contract.mjs";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/agent-host-v4-streaming.lock.json");

const CONTRACTS_REPOSITORY = "https://github.com/36Dge/yijie-contracts.git";
const CONTRACTS_COMMIT = "3c3000a6fbe2f08ab2131a463a1691e867d661b1";
const HOST_REPOSITORY = "https://github.com/36Dge/yijie-agent-host.git";
const HOST_COMMIT = "83d3163e21579042d2cc21f303e943946ff97eb0";
const SOURCE_PINS = Object.freeze({
  openapi: [
    "openapi/agent-host/agent-host.yaml",
    "bd53dfd84976c81b5154c587c72547a5b698b72d301a4850fd0b6338022f9c83",
  ],
  event_schema: [
    "jsonschema/agent/session-event-v4.schema.json",
    "d972806e59195c5e1f5fe810db6e1df80be349b77ecc4cf192ed0f391d9ed739",
  ],
  runtime_projection: [
    "compatibility/agent-host-runtime-v1.json",
    "6a81fbb1390af99c0f1f6d6b53a872b3b8bfa0447d0dd03cb02f5169208e85dc",
  ],
  protobuf: [
    "protobuf/yijie/events/v4/agent_session.proto",
    "7130ffad6f7d415bbaaf35a10bc380b2b75ecaaa4762dc871ce0a274472ecdea",
  ],
});
const HOST_SOURCE_PINS = Object.freeze({
  openapi: ["api/openapi/agent-host.yaml", SOURCE_PINS.openapi[1]],
  event_schema: ["api/jsonschema/agent-session-event-v4.schema.json", SOURCE_PINS.event_schema[1]],
  runtime_projection: [
    "api/compatibility/agent-host-runtime-v1.json",
    SOURCE_PINS.runtime_projection[1],
  ],
  generated_openapi: [
    "internal/contracts/agenthost.gen.go",
    "2660ac177638421eac24051cf3ec8b268d2cfb18284f75cb4584c7b8549022ea",
  ],
});
const CONTRACTS_FIXTURE_TREE = Object.freeze([
  "tests/fixtures/agent/session-event-v4",
  "34c1d28d00a5693c408803bdf42ed742bbe1448a",
]);
const HOST_FIXTURE_TREE = Object.freeze([
  "api/fixtures/agent/session-event-v4",
  "34c1d28d00a5693c408803bdf42ed742bbe1448a",
]);
const HOST_LOCK_PIN = Object.freeze([
  "api/contracts.lock",
  "2867f1834a363cd759e80ffede1749c4905ffbc9df64b47bdbdf74ba6e43b28a",
]);
const LEGACY_V4_RUNTIME_SHA256 =
  "6d28e3ad1bb941561ce08a231abf003dd0e69b5dcafe6376cc5987c3d1f07a00";
const FIXTURE_NAMES = Object.freeze([
  "agent-message-commentary-started.json",
  "agent-message-final-completed.json",
  "agent-message-null-phase-started.json",
  "turn-plan-cleared.json",
  "turn-plan-updated.json",
]);
const V4_RUNTIME_NOTIFICATIONS = Object.freeze([
  "error",
  "item/agentMessage/delta",
  "item/completed",
  "item/reasoning/textDelta",
  "item/started",
  "skills/changed",
  "thread/started",
  "turn/completed",
  "turn/plan/updated",
  "turn/started",
  "warning",
]);
const FEAT136_RUNTIME_NOTIFICATIONS = Object.freeze([
  "item/commandExecution/outputDelta",
  "item/mcpToolCall/progress",
]);
const RUNTIME_NOTIFICATIONS = Object.freeze(
  [...V4_RUNTIME_NOTIFICATIONS, ...FEAT136_RUNTIME_NOTIFICATIONS].sort(),
);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new Error("FEAT-134 contract path must be a safe relative path");
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("FEAT-134 contract path escapes its repository");
  }
  return normalized;
}

function sameSourcePins(actual, expected) {
  return Object.entries(expected).every(
    ([name, [sourcePath, digest]]) =>
      actual?.[name]?.path === sourcePath && actual?.[name]?.sha256 === digest,
  ) && Object.keys(actual ?? {}).length === Object.keys(expected).length;
}

export function validateLock(lock) {
  if (
    !lock ||
    lock.schema_version !== 1 ||
    lock.contract_version !== "0.7.0" ||
    lock.contracts?.repository !== CONTRACTS_REPOSITORY ||
    lock.contracts?.full_commit !== CONTRACTS_COMMIT ||
    !sameSourcePins(lock.contracts?.sources, SOURCE_PINS) ||
    lock.contracts?.fixture_tree?.path !== CONTRACTS_FIXTURE_TREE[0] ||
    lock.contracts?.fixture_tree?.git_tree_oid !== CONTRACTS_FIXTURE_TREE[1] ||
    lock.agent_host?.repository !== HOST_REPOSITORY ||
    lock.agent_host?.full_commit !== HOST_COMMIT ||
    lock.agent_host?.contracts_lock?.path !== HOST_LOCK_PIN[0] ||
    lock.agent_host?.contracts_lock?.sha256 !== HOST_LOCK_PIN[1] ||
    !sameSourcePins(lock.agent_host?.sources, HOST_SOURCE_PINS) ||
    lock.agent_host?.fixture_tree?.path !== HOST_FIXTURE_TREE[0] ||
    lock.agent_host?.fixture_tree?.git_tree_oid !== HOST_FIXTURE_TREE[1] ||
    lock.toolchain?.parser?.package !== "@redocly/openapi-core" ||
    lock.toolchain?.parser?.version !== "1.34.18" ||
    lock.toolchain?.parser?.api !== "parseYaml" ||
    lock.toolchain?.parser?.provided_by !== "openapi-typescript@7.13.0" ||
    lock.toolchain?.validator?.package !== "ajv" ||
    lock.toolchain?.validator?.version !== "8.17.1" ||
    lock.activation?.environment !== "local" ||
    lock.activation?.local_profile !== "demo_fast" ||
    lock.activation?.launcher_script !== "scripts/run-local-demo-fast.sh" ||
    lock.activation?.launcher_argument !== "--stable-api-only" ||
    lock.activation?.package_entry !== "tauri:demo-fast:stable" ||
    lock.activation?.build_entry !== "tauri:build:demo-fast:stable" ||
    lock.activation?.runtime_flag !== "YIJIE_FEAT134_STREAMING_ENABLED" ||
    lock.activation?.compile_flag !== "VITE_YIJIE_FEAT134_STREAMING_ENABLED" ||
    lock.activation?.feat136_runtime_flag !== "YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED" ||
    lock.activation?.feat136_compile_flag !== "VITE_YIJIE_FEAT136_EXECUTION_ENABLED" ||
    lock.activation?.enabled_value !== "true"
  ) {
    throw new Error("FEAT-134 v4 Contracts/Host lock is incomplete or invalid");
  }
  for (const source of Object.values(lock.contracts.sources)) safeRelativePath(source.path);
  for (const source of Object.values(lock.agent_host.sources)) safeRelativePath(source.path);
  safeRelativePath(lock.contracts.fixture_tree.path);
  safeRelativePath(lock.agent_host.fixture_tree.path);
  safeRelativePath(lock.agent_host.contracts_lock.path);
  safeRelativePath(lock.activation.launcher_script);
  return lock;
}

function normalizeRepository(value) {
  return value.trim().replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase();
}

async function git(root, ...arguments_) {
  return (await exec("git", ["-C", root, ...arguments_])).stdout.trim();
}

export async function verifyExactCheckout(root, repository, commit, label) {
  const [head, status, origin] = await Promise.all([
    git(root, "rev-parse", "HEAD"),
    git(root, "status", "--porcelain"),
    git(root, "remote", "get-url", "origin"),
  ]);
  if (head !== commit) throw new Error(`${label} HEAD is ${head}, expected ${commit}`);
  if (status !== "") throw new Error(`${label} checkout is not clean`);
  if (normalizeRepository(origin) !== normalizeRepository(repository)) {
    throw new Error(`${label} origin differs from its exact pin`);
  }
}

async function readRegularPinnedFile(root, source, maximum = 4 * 1024 * 1024) {
  const target = path.join(root, safeRelativePath(source.path));
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) {
    throw new Error(`${source.path} is not an allowed regular file`);
  }
  const bytes = await readFile(target);
  const actual = sha256(bytes);
  if (actual !== source.sha256) {
    throw new Error(`${source.path} digest is ${actual}, expected ${source.sha256}`);
  }
  return bytes;
}

function parseKeyValueFile(bytes) {
  return Object.fromEntries(
    bytes.toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => {
      const separator = line.indexOf("=");
      if (separator < 1) throw new Error("Agent Host contracts.lock has an invalid line");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
}

export function validateHostContractsLock(bytes) {
  if (sha256(bytes) !== HOST_LOCK_PIN[1]) {
    throw new Error("Agent Host contracts.lock digest differs from the Desktop pin");
  }
  const values = parseKeyValueFile(bytes);
  const expected = {
    CONTRACTS_VERSION: "0.7.0",
    CONTRACTS_REF: CONTRACTS_COMMIT,
    CONTRACTS_COMMIT,
    OPENAPI_SHA256: SOURCE_PINS.openapi[1],
    RUNTIME_COMPATIBILITY_SHA256: SOURCE_PINS.runtime_projection[1],
    AGENT_SESSION_EVENT_V4_SCHEMA_SHA256: SOURCE_PINS.event_schema[1],
    AGENT_SESSION_EVENT_V4_FIXTURE_TREE: CONTRACTS_FIXTURE_TREE[1],
  };
  for (const [name, value] of Object.entries(expected)) {
    if (values[name] !== value) {
      throw new Error(`Agent Host contracts.lock ${name} differs from the exact v4 pin`);
    }
  }
  return values;
}

export function validateOpenApi(document) {
  const operation = document.paths?.["/v4/agent-sessions/{agent_session_id}/events"]?.get;
  const negotiation = document.components?.parameters?.EventSchemaVersionV4;
  if (
    document.info?.version !== "0.7.0" ||
    operation?.operationId !== "streamAgentSessionEventsV4" ||
    !operation.parameters?.some(({ $ref }) => $ref === "#/components/parameters/EventSchemaVersionV4") ||
    negotiation?.name !== "event_schema_version" ||
    negotiation?.in !== "query" ||
    negotiation?.required !== true ||
    JSON.stringify(negotiation?.schema?.enum) !== "[4]" ||
    operation.responses?.["200"]?.headers?.["X-Yijie-Event-Schema-Version"]?.schema?.enum?.[0] !== 4 ||
    operation.responses?.["200"]?.content?.["text/event-stream"]?.schema?.[
      "x-yijie-event-data-schema"
    ] !== "../../jsonschema/agent/session-event-v4.schema.json"
  ) {
    throw new Error("Agent Host v4 OpenAPI negotiation or schema authority drifted");
  }
  for (const version of [1, 2, 3]) {
    if (!document.paths?.[`/v${version}/agent-sessions/{agent_session_id}/events`]?.get) {
      throw new Error(`legacy v${version} event operation is missing`);
    }
  }
}

export function validateRuntimeProjection(projection) {
  if (
    projection?.contracts_version !== "0.7.0" ||
    projection?.runtime?.repository_commit !== "0ce5902ed400866be0196886bb78f693a004d68d" ||
    projection?.runtime?.upstream_tag !== "rust-v0.144.6" ||
    projection?.runtime?.upstream_commit !== "5d1fbf26c43abc65a203928b2e31561cb039e06d" ||
    projection?.runtime?.version !== "0.144.6" ||
    projection?.runtime?.transport !== "stdio" ||
    projection?.runtime?.experimental_api !== false ||
    projection?.runtime?.schema_file_count !== 267 ||
    projection?.runtime?.schema_tree_sha256 !==
      "82ee9de771cf1d41bac16d87380f1121e7794107aa3aa526ad702d5d1bf7afe1" ||
    projection?.host_projection?.sandbox !== "read-only" ||
    projection?.host_projection?.approval_policy !== "never" ||
    JSON.stringify([...(projection?.host_projection?.runtime_notifications ?? [])].sort()) !==
      JSON.stringify(RUNTIME_NOTIFICATIONS) ||
    !V4_RUNTIME_NOTIFICATIONS.every((notification) =>
      projection.host_projection.runtime_notifications.includes(notification)
    )
  ) {
    throw new Error("FEAT-134 Runtime compatibility projection drifted");
  }
}

export function validateRuntimeProjectionV4Bytes(bytes) {
  let legacyV4 = Buffer.from(bytes).toString("utf8");
  for (const [addition, previous] of [
    ['  "contracts_version": "0.7.0",\n', '  "contracts_version": "0.6.0",\n'],
    ['      "item/commandExecution/outputDelta",\n', ""],
    ['      "item/mcpToolCall/progress",\n', ""],
  ]) {
    if (legacyV4.split(addition).length !== 2) {
      throw new Error("FEAT-134 Runtime v4 byte baseline has an unexpected v0.7 delta");
    }
    legacyV4 = legacyV4.replace(addition, previous);
  }
  if (sha256(legacyV4) !== LEGACY_V4_RUNTIME_SHA256) {
    throw new Error("FEAT-134 Runtime v4 byte baseline drifted");
  }
}

function compileEventSchema(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  ajv.addFormat("date-time", (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  return ajv.compile(schema);
}

async function verifyFixtureTree(root, commit, fixture) {
  const actual = await git(root, "rev-parse", `${commit}:${safeRelativePath(fixture.path)}`);
  if (actual !== fixture.git_tree_oid) {
    throw new Error(`${fixture.path} tree is ${actual}, expected ${fixture.git_tree_oid}`);
  }
}

async function validateFixtures(contractsRoot, fixtureRoot, schemaBytes) {
  const root = path.join(contractsRoot, safeRelativePath(fixtureRoot));
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  if (JSON.stringify(names) !== JSON.stringify(FIXTURE_NAMES)) {
    throw new Error("FEAT-134 v4 fixture set differs from the exact five synthetic fixtures");
  }
  const validate = compileEventSchema(JSON.parse(schemaBytes.toString("utf8")));
  for (const name of names) {
    const fixture = JSON.parse(await readFile(path.join(root, name), "utf8"));
    if (!validate(fixture)) {
      throw new Error(`${name} does not validate: ${JSON.stringify(validate.errors)}`);
    }
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countShellAssignment(source, assignment) {
  return [
    ...source.matchAll(
      new RegExp(`(?:^|\\s)${escapeRegularExpression(assignment)}(?=\\s|$)`, "gm"),
    ),
  ].length;
}

function countShellVariableAssignments(source, name) {
  return [
    ...source.matchAll(
      new RegExp(`(?:^|\\s)${escapeRegularExpression(name)}=`, "gm"),
    ),
  ].length;
}

function hasExactShellLine(source, line) {
  return new RegExp(`^${escapeRegularExpression(line)}$`, "m").test(source);
}

export function validateStableActivation(packageJson, runnerSource, activation) {
  const scripts = packageJson?.scripts ?? {};
  const runtimeAssignment = `${activation.runtime_flag}=${activation.enabled_value}`;
  const compileAssignment = `${activation.compile_flag}=${activation.enabled_value}`;
  const feat136RuntimeAssignment =
    `${activation.feat136_runtime_flag}=${activation.enabled_value}`;
  const feat136CompileAssignment =
    `${activation.feat136_compile_flag}=${activation.enabled_value}`;
  const stableCommand = `./scripts/run-local-demo-fast.sh ${activation.launcher_argument}`;
  const buildCommand = scripts[activation.build_entry];
  if (scripts[activation.package_entry] !== stableCommand || typeof buildCommand !== "string") {
    throw new Error("FEAT-134 stable package entry differs from its exact launcher boundary");
  }
  for (const fragment of [
    "node scripts/check-agent-host-v4-contract.mjs",
    "VITE_YIJIE_ENV=local",
    "VITE_YIJIE_LOCAL_PROFILE=demo_fast",
    compileAssignment,
    feat136CompileAssignment,
    "--config src-tauri/tauri.feat131-stable.conf.json",
  ]) {
    if (!buildCommand.includes(fragment)) {
      throw new Error(`FEAT-134 stable build is missing ${fragment}`);
    }
  }
  if (
    !buildCommand.includes(
      `env -u ${activation.runtime_flag} -u ${activation.compile_flag} ` +
        `-u ${activation.feat136_runtime_flag} -u ${activation.feat136_compile_flag}`,
    )
  ) {
    throw new Error(
      "stable build does not clear ambient FEAT-134/136 activation before its exact compile flags",
    );
  }
  if (
    countShellVariableAssignments(buildCommand, activation.runtime_flag) !== 0 ||
    countShellVariableAssignments(buildCommand, activation.compile_flag) !== 1 ||
    countShellVariableAssignments(buildCommand, activation.feat136_runtime_flag) !== 0 ||
    countShellVariableAssignments(buildCommand, activation.feat136_compile_flag) !== 1 ||
    countShellAssignment(buildCommand, compileAssignment) !== 1 ||
    countShellAssignment(buildCommand, feat136CompileAssignment) !== 1
  ) {
    throw new Error("runtime flags may be injected only by the stable launcher");
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (name === activation.build_entry) continue;
    if (
      countShellVariableAssignments(String(command), activation.runtime_flag) !== 0 ||
      countShellVariableAssignments(String(command), activation.compile_flag) !== 0 ||
      countShellVariableAssignments(String(command), activation.feat136_runtime_flag) !== 0 ||
      countShellVariableAssignments(String(command), activation.feat136_compile_flag) !== 0
    ) {
      throw new Error(`non-stable package entry ${name} injects a FEAT-134/136 flag`);
    }
  }

  const caseStart = runnerSource.indexOf('case "$#" in');
  const stableStart = runnerSource.indexOf("  1)", caseStart);
  const stableEnd = runnerSource.indexOf("    ;;", stableStart);
  const execStart = runnerSource.indexOf("exec env \\", stableEnd);
  if (caseStart < 0 || stableStart < 0 || stableEnd < 0 || execStart < 0) {
    throw new Error("FEAT-134 launcher structure is incomplete");
  }
  const stableBranch = runnerSource.slice(stableStart, stableEnd);
  const execBoundary = runnerSource.slice(execStart);
  if (
    !stableBranch.includes(`[[ "$1" == "${activation.launcher_argument}" ]]`) ||
    !stableBranch.includes('stable_api_only="true"') ||
    !stableBranch.includes("feat134_environment=(") ||
    countShellVariableAssignments(stableBranch, activation.runtime_flag) !== 1 ||
    countShellVariableAssignments(stableBranch, activation.compile_flag) !== 1 ||
    countShellVariableAssignments(stableBranch, activation.feat136_runtime_flag) !== 1 ||
    countShellVariableAssignments(stableBranch, activation.feat136_compile_flag) !== 1 ||
    countShellAssignment(stableBranch, runtimeAssignment) !== 1 ||
    countShellAssignment(stableBranch, compileAssignment) !== 1 ||
    countShellAssignment(stableBranch, feat136RuntimeAssignment) !== 1 ||
    countShellAssignment(stableBranch, feat136CompileAssignment) !== 1 ||
    countShellVariableAssignments(runnerSource, activation.runtime_flag) !== 1 ||
    countShellVariableAssignments(runnerSource, activation.compile_flag) !== 1 ||
    countShellVariableAssignments(runnerSource, activation.feat136_runtime_flag) !== 1 ||
    countShellVariableAssignments(runnerSource, activation.feat136_compile_flag) !== 1 ||
    !runnerSource.slice(0, caseStart).includes("feat134_environment=()") ||
    !hasExactShellLine(execBoundary, `  -u ${activation.runtime_flag} \\`) ||
    !hasExactShellLine(execBoundary, `  -u ${activation.compile_flag} \\`) ||
    !hasExactShellLine(execBoundary, `  -u ${activation.feat136_runtime_flag} \\`) ||
    !hasExactShellLine(execBoundary, `  -u ${activation.feat136_compile_flag} \\`) ||
    !hasExactShellLine(execBoundary, '  "${feat134_environment[@]}" \\') ||
    !hasExactShellLine(execBoundary, "  YIJIE_ENV=local \\") ||
    !hasExactShellLine(execBoundary, "  YIJIE_LOCAL_PROFILE=demo_fast \\") ||
    !hasExactShellLine(execBoundary, "  VITE_YIJIE_ENV=local \\") ||
    !hasExactShellLine(execBoundary, "  VITE_YIJIE_LOCAL_PROFILE=demo_fast \\")
  ) {
    throw new Error("FEAT-134/136 flags are not isolated to exact local/demo_fast/stable launch");
  }
}

export async function checkAgentHostV4Contract({
  contractsRoot = path.resolve(repositoryRoot, process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts"),
  agentHostRoot = path.resolve(repositoryRoot, process.env.YIJIE_DESKTOP_AGENT_HOST_DIR ?? "../yijie-agent-host"),
} = {}) {
  const lock = validateLock(JSON.parse(await readFile(lockPath, "utf8")));
  await Promise.all([
    verifyExactCheckout(
      contractsRoot,
      lock.contracts.repository,
      lock.contracts.full_commit,
      "Contracts",
    ),
    verifyExactCheckout(
      agentHostRoot,
      lock.agent_host.repository,
      lock.agent_host.full_commit,
      "Agent Host",
    ),
  ]);

  const [contractSources, hostSources, hostLockBytes, parseYaml, packageJson, runnerSource] =
    await Promise.all([
      Promise.all(
        Object.entries(lock.contracts.sources).map(async ([name, source]) => [
          name,
          await readRegularPinnedFile(contractsRoot, source),
        ]),
      ).then(Object.fromEntries),
      Promise.all(
        Object.entries(lock.agent_host.sources).map(async ([name, source]) => [
          name,
          await readRegularPinnedFile(agentHostRoot, source),
        ]),
      ).then(Object.fromEntries),
      readRegularPinnedFile(agentHostRoot, lock.agent_host.contracts_lock),
      loadPinnedOpenApiParser(lock.toolchain),
      readFile(path.join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(path.join(repositoryRoot, safeRelativePath(lock.activation.launcher_script)), "utf8"),
      verifyFixtureTree(contractsRoot, lock.contracts.full_commit, lock.contracts.fixture_tree),
      verifyFixtureTree(agentHostRoot, lock.agent_host.full_commit, lock.agent_host.fixture_tree),
    ]);

  const contractOpenApi = contractSources.openapi;
  const contractSchema = contractSources.event_schema;
  const contractRuntime = contractSources.runtime_projection;
  const hostOpenApi = hostSources.openapi;
  const hostSchema = hostSources.event_schema;
  const hostRuntime = hostSources.runtime_projection;
  if (
    !contractOpenApi.equals(hostOpenApi) ||
    !contractSchema.equals(hostSchema) ||
    !contractRuntime.equals(hostRuntime)
  ) {
    throw new Error("Agent Host v4 source snapshots differ from the exact Contracts authority");
  }
  validateHostContractsLock(hostLockBytes);
  validateOpenApi(parseYaml(contractOpenApi.toString("utf8")));
  validateRuntimeProjectionV4Bytes(contractRuntime);
  validateRuntimeProjection(JSON.parse(contractRuntime.toString("utf8")));
  await validateFixtures(contractsRoot, lock.contracts.fixture_tree.path, contractSchema);
  validateStableActivation(packageJson, runnerSource, lock.activation);

  process.stdout.write(
    `FEAT-134 v4 verified at Contracts ${lock.contracts.full_commit} and Agent Host ` +
      `${lock.agent_host.full_commit}; activation is exact local/demo_fast/stable only.\n`,
  );
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  checkAgentHostV4Contract().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "FEAT-134 v4 check failed"}\n`);
    process.exitCode = 1;
  });
}
