import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/agent-host-v2-turn.lock.json");
const generatorRoot = path.join(repositoryRoot, "tools/public-api-generator");
const checkOnly = process.argv.includes("--check");
const PINNED_REPOSITORY = "https://github.com/36Dge/yijie-contracts.git";
const PINNED_COMMIT = "d6dff903e0c12b6a5e69599df1e33ef46d8bea6b";
const PINNED_SOURCE_PATH = "openapi/agent-host/agent-host.yaml";
const PINNED_SOURCE_SHA256 =
  "406b55dad02d5a3d489955bcf29c973b94252c3e300f8ff853709a71d6874431";
const PINNED_FIXTURE_SOURCE_PATH = "tests/fixtures/agent/host-v2/turn-request.json";
const PINNED_FIXTURE_SHA256 =
  "ec464ce56f749852e65be8d1472d8f5d8cccc82c89d2dd16fab33fbdbe62decc";
const PINNED_FIXTURE_SNAPSHOT_PATH =
  "src-tauri/fixtures/agent-host-v2/turn-request.json";
const PINNED_OPERATION_PATH = "/v2/agent-sessions/{agent_session_id}/turns";
const PINNED_REQUEST_SCHEMA = "#/components/schemas/StartTurnV2Request";
const CANONICAL_PROJECTION_OMISSIONS = Object.freeze([
  "trace_id",
  "request_id",
  "tenant_id",
  "user_id",
  "reasoning_effort",
]);
const ISO_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) {
    throw new Error("contract path must be a non-empty relative path");
  }
  const normalized = path.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error("contract path must stay inside its repository");
  }
  return normalized;
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function localCalendarDate(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !ISO_CALENDAR_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateExceptionWindow(exception, currentDate = localCalendarDate()) {
  if (!isCalendarDate(currentDate) || !isCalendarDate(exception?.expires_on)) {
    throw new Error("Agent Host adapter exception dates must be ISO calendar dates");
  }
  if (currentDate > exception.expires_on) {
    throw new Error(
      `Agent Host adapter exception ${exception.id ?? "unknown"} expired on ` +
        `${exception.expires_on}`,
    );
  }
}

export function validateLock(lock) {
  if (
    !lock ||
    lock.schema_version !== 1 ||
    lock.contract_version !== "0.5.0" ||
    lock.repository !== PINNED_REPOSITORY ||
    lock.full_commit !== PINNED_COMMIT ||
    lock.source?.path !== PINNED_SOURCE_PATH ||
    lock.source?.sha256 !== PINNED_SOURCE_SHA256 ||
    lock.operation?.method !== "post" ||
    lock.operation?.path !== PINNED_OPERATION_PATH ||
    lock.operation?.operation_id !== "startAgentTurnV2" ||
    lock.operation?.request_schema !== PINNED_REQUEST_SCHEMA ||
    lock.canonical_fixture?.source_path !== PINNED_FIXTURE_SOURCE_PATH ||
    lock.canonical_fixture?.source_sha256 !== PINNED_FIXTURE_SHA256 ||
    lock.canonical_fixture?.snapshot_path !== PINNED_FIXTURE_SNAPSHOT_PATH ||
    lock.canonical_fixture?.snapshot_sha256 !== PINNED_FIXTURE_SHA256 ||
    lock.parser?.package !== "@redocly/openapi-core" ||
    lock.parser?.version !== "1.34.18" ||
    lock.parser?.api !== "parseYaml" ||
    lock.parser?.provided_by !== "openapi-typescript@7.13.0" ||
    lock.consumer?.mode !== "hand-written-rust-adapter" ||
    lock.consumer?.adapter_path !== "src-tauri/src/chat/host_bridge.rs" ||
    lock.consumer?.adapter_sha256 !==
      "5517be0351222ac461578ad5e3a2b0ec6516c5df622d13d9b687e1494b8a5467" ||
    lock.consumer?.readiness_path !== "src-tauri/src/chat/mod.rs" ||
    lock.consumer?.readiness_sha256 !==
      "29248c14570d85cdc15a210b6099988c5972a4e5c88c9ce71ded968fb25b9a4d" ||
    lock.consumer?.public_lock_path !== "contracts/public-api.lock.json" ||
    lock.consumer?.serialization_test !==
      "chat::host_bridge::tests::start_turn_v2_adapter_serializes_canonical_contract_projection" ||
    lock.consumer?.approved_rust_generator !== "N/A" ||
    typeof lock.consumer?.generator_rationale !== "string" ||
    lock.consumer.generator_rationale.length === 0 ||
    !sameStringArray(
      lock.consumer?.canonical_projection_omits_optional_fields,
      CANONICAL_PROJECTION_OMISSIONS,
    ) ||
    lock.exception?.id !== "EXC-127-002" ||
    lock.exception?.owner !== "段成威" ||
    lock.exception?.approved_on !== "2026-08-19" ||
    lock.exception?.expires_on !== "2026-11-17" ||
    lock.exception?.status !== "active" ||
    typeof lock.exception?.scope !== "string" ||
    lock.exception.scope.length === 0 ||
    typeof lock.exception?.removal_trigger !== "string" ||
    lock.exception.removal_trigger.length === 0
  ) {
    throw new Error("Agent Host contract lock metadata is incomplete or invalid");
  }
  validateExceptionWindow(lock.exception);

  for (const relativePath of [
    lock.source.path,
    lock.canonical_fixture.source_path,
    lock.canonical_fixture.snapshot_path,
    lock.consumer.adapter_path,
    lock.consumer.readiness_path,
    lock.consumer.public_lock_path,
  ]) {
    safeRelativePath(relativePath);
  }
  return lock;
}

function normalizeRepository(value) {
  return value.trim().replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase();
}

async function git(contractsRoot, ...arguments_) {
  const { stdout } = await exec("git", ["-C", contractsRoot, ...arguments_]);
  return stdout.trim();
}

export async function verifyContractsCheckout(lock, contractsRoot) {
  const [head, status, origin] = await Promise.all([
    git(contractsRoot, "rev-parse", "HEAD"),
    git(contractsRoot, "status", "--porcelain"),
    git(contractsRoot, "remote", "get-url", "origin"),
  ]);
  if (head !== lock.full_commit) {
    throw new Error(`contracts HEAD is ${head}, expected ${lock.full_commit}`);
  }
  if (status !== "") {
    throw new Error("contracts checkout is not clean");
  }
  if (normalizeRepository(origin) !== normalizeRepository(lock.repository)) {
    throw new Error("contracts origin does not match the pinned repository");
  }
}

export async function verifyPinnedFile(root, relativePath, expectedDigest) {
  const absolutePath = path.join(root, safeRelativePath(relativePath));
  const contents = await readFile(absolutePath);
  const actualDigest = sha256(contents);
  if (actualDigest !== expectedDigest) {
    throw new Error(`SHA-256 for ${relativePath} is ${actualDigest}, expected ${expectedDigest}`);
  }
  return contents;
}

export async function loadPinnedOpenApiParser(lock) {
  const toolRequire = createRequire(path.join(generatorRoot, "package.json"));
  const providerMetadata = JSON.parse(
    await readFile(toolRequire.resolve("openapi-typescript/package.json"), "utf8"),
  );
  if (`openapi-typescript@${providerMetadata.version}` !== lock.parser.provided_by) {
    throw new Error(
      `OpenAPI parser provider is openapi-typescript@${providerMetadata.version}, ` +
        `expected ${lock.parser.provided_by}`,
    );
  }
  const generatorEntry = toolRequire.resolve("openapi-typescript");
  const generatorRequire = createRequire(generatorEntry);
  const parserPackagePath = generatorRequire.resolve(`${lock.parser.package}/package.json`);
  const parserMetadata = JSON.parse(await readFile(parserPackagePath, "utf8"));
  if (parserMetadata.version !== lock.parser.version) {
    throw new Error(
      `OpenAPI parser is ${parserMetadata.version}, expected ${lock.parser.version}`,
    );
  }
  const parserEntry = generatorRequire.resolve(lock.parser.package);
  const parserModule = await import(pathToFileURL(parserEntry).href);
  const parseYaml = parserModule[lock.parser.api] ?? parserModule.default?.[lock.parser.api];
  if (typeof parseYaml !== "function") {
    throw new Error(`OpenAPI parser does not export ${lock.parser.api}`);
  }
  return parseYaml;
}

function dereferenceSchema(document, value, stack = []) {
  if (Array.isArray(value)) {
    return value.map((item) => dereferenceSchema(document, item, stack));
  }
  if (value === null || typeof value !== "object") return value;
  if (typeof value.$ref === "string") {
    const prefix = "#/components/schemas/";
    if (!value.$ref.startsWith(prefix)) {
      throw new Error(`unsupported request schema reference ${value.$ref}`);
    }
    const name = value.$ref.slice(prefix.length);
    if (stack.includes(name)) {
      throw new Error(`circular request schema reference ${[...stack, name].join(" -> ")}`);
    }
    const referenced = document.components?.schemas?.[name];
    if (!referenced) throw new Error(`request schema ${name} is missing`);
    return dereferenceSchema(document, referenced, [...stack, name]);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      dereferenceSchema(document, item, stack),
    ]),
  );
}

function requestValidator(document, lock) {
  const operation = document.paths?.[lock.operation.path]?.[lock.operation.method];
  if (
    operation?.operationId !== lock.operation.operation_id ||
    operation?.requestBody?.content?.["application/json"]?.schema?.$ref !==
      lock.operation.request_schema
  ) {
    throw new Error("pinned Agent Host operation no longer references the expected request schema");
  }
  const schemaName = lock.operation.request_schema.slice("#/components/schemas/".length);
  const sourceSchema = document.components?.schemas?.[schemaName];
  if (!sourceSchema) throw new Error(`request schema ${schemaName} is missing`);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("uuid", {
    type: "string",
    validate: (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  });
  ajv.addFormat("int64", { type: "number", validate: Number.isSafeInteger });
  return {
    schema: sourceSchema,
    validate: ajv.compile(dereferenceSchema(document, sourceSchema, [schemaName])),
  };
}

function assertValidRequest(validate, request, label) {
  if (!validate(request)) {
    throw new Error(`${label} does not match the pinned request schema: ${JSON.stringify(validate.errors)}`);
  }
}

function assertCanonicalContentIntegrity(fixture) {
  const image = fixture.content_blocks?.find((block) => block.type === "image");
  if (!image || typeof image.data_url !== "string") {
    throw new Error("canonical fixture does not contain an image data URL");
  }
  const prefix = `data:${image.media_type};base64,`;
  if (!image.data_url.startsWith(prefix)) {
    throw new Error("canonical image data URL media type does not match");
  }
  const encoded = image.data_url.slice(prefix.length);
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.byteLength !== image.size_bytes ||
    bytes.toString("base64") !== encoded ||
    sha256(bytes) !== image.sha256
  ) {
    throw new Error("canonical image bytes do not match size/base64/SHA-256 metadata");
  }
}

export function projectCanonicalFixture(fixture, omittedFields = CANONICAL_PROJECTION_OMISSIONS) {
  const projection = structuredClone(fixture);
  for (const field of omittedFields) delete projection[field];
  return projection;
}

export function validateContractDocument(document, lock, fixture) {
  const { schema, validate } = requestValidator(document, lock);
  assertValidRequest(validate, fixture, "canonical fixture");
  assertCanonicalContentIntegrity(fixture);

  const required = new Set(schema.required ?? []);
  for (const field of lock.consumer.canonical_projection_omits_optional_fields) {
    if (!schema.properties?.[field] || required.has(field)) {
      throw new Error(`Rust adapter projection may omit only optional schema field ${field}`);
    }
  }
  const projection = projectCanonicalFixture(
    fixture,
    lock.consumer.canonical_projection_omits_optional_fields,
  );
  assertValidRequest(validate, projection, "Rust adapter canonical projection");
  return projection;
}

export function validateConsumerPins(lock, publicLock, readinessSource) {
  if (publicLock?.full_commit !== lock.full_commit) {
    throw new Error("Public API and Agent Host contract locks pin different commits");
  }
  if (sha256(readinessSource) !== lock.consumer.readiness_sha256) {
    throw new Error("Rust readiness source differs from its reviewed digest");
  }
  const declaration = `const CONTRACT_COMMIT: &str = "${lock.full_commit}";`;
  if (readinessSource.split(declaration).length !== 2) {
    throw new Error("Rust readiness contract commit differs from the contract locks");
  }
}

export async function checkAgentHostContract() {
  const lock = validateLock(JSON.parse(await readFile(lockPath, "utf8")));
  const contractsRoot = path.resolve(
    repositoryRoot,
    process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts",
  );
  await verifyContractsCheckout(lock, contractsRoot);
  const [source, canonicalFixtureBytes, parseYaml] = await Promise.all([
    verifyPinnedFile(contractsRoot, lock.source.path, lock.source.sha256),
    verifyPinnedFile(
      contractsRoot,
      lock.canonical_fixture.source_path,
      lock.canonical_fixture.source_sha256,
    ),
    loadPinnedOpenApiParser(lock),
  ]);

  const fixture = JSON.parse(canonicalFixtureBytes.toString("utf8"));
  const document = parseYaml(source.toString("utf8"));
  validateContractDocument(document, lock, fixture);

  const snapshotPath = path.join(
    repositoryRoot,
    safeRelativePath(lock.canonical_fixture.snapshot_path),
  );
  if (!checkOnly) {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, canonicalFixtureBytes);
  }
  const snapshot = await verifyPinnedFile(
    repositoryRoot,
    lock.canonical_fixture.snapshot_path,
    lock.canonical_fixture.snapshot_sha256,
  );
  if (!snapshot.equals(canonicalFixtureBytes)) {
    throw new Error("canonical Agent Host fixture snapshot differs from its pinned source bytes");
  }
  if (JSON.stringify(JSON.parse(snapshot.toString("utf8"))) !== JSON.stringify(fixture)) {
    throw new Error("canonical Agent Host fixture snapshot has semantic drift");
  }
  const [publicLock, readinessSource, adapterSource] = await Promise.all([
    readFile(path.join(repositoryRoot, safeRelativePath(lock.consumer.public_lock_path)), "utf8")
      .then(JSON.parse),
    verifyPinnedFile(
      repositoryRoot,
      lock.consumer.readiness_path,
      lock.consumer.readiness_sha256,
    ).then((source) => source.toString("utf8")),
    verifyPinnedFile(
      repositoryRoot,
      lock.consumer.adapter_path,
      lock.consumer.adapter_sha256,
    ),
  ]);
  if (adapterSource.length === 0) {
    throw new Error("Rust Agent Host adapter source is empty");
  }
  validateConsumerPins(lock, publicLock, readinessSource);

  process.stdout.write(
    `Agent Host v2 turn contract verified at ${lock.full_commit}; ` +
      `${lock.consumer.mode} is covered by ${lock.exception.id}.\n`,
  );
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  checkAgentHostContract().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Agent Host contract check failed"}\n`,
    );
    process.exitCode = 1;
  });
}
