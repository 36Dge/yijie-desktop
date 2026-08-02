import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/public-api.lock.json");
const generatorRoot = path.join(repositoryRoot, "tools/public-api-generator");
const checkOnly = process.argv.includes("--check");
const PINNED_REPOSITORY = "https://github.com/36Dge/yijie-contracts.git";
const PINNED_COMMIT = "c000a0245acb5c3f7ead5d2a877fb60c281c588c";
const PINNED_GENERATOR_COMMAND =
  "pnpm --dir tools/public-api-generator exec openapi-typescript openapi/public/public.yaml";
const PINNED_FIXTURE_PATHS = new Set([
  "tests/fixtures/public/access/capability-v1-empty.json",
  "tests/fixtures/public/access/capability-v1-ready.json",
  "tests/fixtures/public/access/capability-v1-unknown.json",
  "tests/fixtures/public/access/error-authorization-unavailable.json",
  "tests/fixtures/public/access/error-internal-error.json",
  "tests/fixtures/public/access/error-invalid-tenant-context.json",
  "tests/fixtures/public/access/error-tenant-access-denied.json",
  "tests/fixtures/public/access/error-unauthorized.json",
  "tests/fixtures/public/access/error-user-access-denied.json",
  "tests/fixtures/public/access/tenant-list-v1-empty.json",
  "tests/fixtures/public/access/tenant-list-v1-multiple.json",
  "tests/fixtures/public/access/tenant-list-v1-single.json",
  "tests/fixtures/public/tasks-v2/create-request.json",
  "tests/fixtures/public/tasks-v2/error-access-denied.json",
  "tests/fixtures/public/tasks-v2/error-task-not-found.json",
  "tests/fixtures/public/tasks-v2/task-response.json",
]);

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

export function validateLock(lock) {
  if (
    !lock ||
    lock.schema_version !== 1 ||
    lock.contract_version !== "0.3.0-candidate" ||
    lock.repository !== PINNED_REPOSITORY ||
    lock.full_commit !== PINNED_COMMIT ||
    !/^[0-9a-f]{64}$/.test(lock.source_sha256 ?? "") ||
    !/^[0-9a-f]{64}$/.test(lock.generated_sha256 ?? "") ||
    lock.source_path !== "openapi/public/public.yaml" ||
    lock.generated_path !== "src/api/generated/public.gen.ts" ||
    lock.generator?.package !== "openapi-typescript" ||
    lock.generator?.version !== "7.13.0" ||
    lock.generator?.typescript_version !== "5.9.3" ||
    lock.generator?.command !== PINNED_GENERATOR_COMMAND ||
    !Array.isArray(lock.fixtures) ||
    lock.fixtures.length !== PINNED_FIXTURE_PATHS.size
  ) {
    throw new Error("contract lock metadata is incomplete or invalid");
  }
  safeRelativePath(lock.source_path);
  safeRelativePath(lock.generated_path);
  const fixturePaths = new Set();
  for (const fixture of lock.fixtures) {
    safeRelativePath(fixture?.path);
    if (
      !PINNED_FIXTURE_PATHS.has(fixture.path) ||
      fixturePaths.has(fixture.path) ||
      !/^[0-9a-f]{64}$/.test(fixture?.sha256 ?? "")
    ) {
      throw new Error("contract fixture digest is invalid");
    }
    fixturePaths.add(fixture.path);
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

async function verifyContractsCheckout(lock, contractsRoot) {
  const [head, status, origin] = await Promise.all([
    git(contractsRoot, "rev-parse", "HEAD"),
    git(contractsRoot, "status", "--porcelain", "--untracked-files=no"),
    git(contractsRoot, "remote", "get-url", "origin"),
  ]);
  if (head !== lock.full_commit) {
    throw new Error(`contracts HEAD is ${head}, expected ${lock.full_commit}`);
  }
  if (status !== "") {
    throw new Error("contracts checkout has tracked changes");
  }
  if (normalizeRepository(origin) !== normalizeRepository(lock.repository)) {
    throw new Error("contracts origin does not match the pinned repository");
  }
}

async function verifyGenerator(lock) {
  const require = createRequire(path.join(generatorRoot, "package.json"));
  const packagePath = require.resolve(`${lock.generator.package}/package.json`);
  const typescriptPath = require.resolve("typescript/package.json");
  const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
  const typescriptMetadata = JSON.parse(await readFile(typescriptPath, "utf8"));
  if (
    packageMetadata.version !== lock.generator.version ||
    typescriptMetadata.version !== lock.generator.typescript_version
  ) {
    throw new Error(
      `generator toolchain is ${packageMetadata.version}/TypeScript ${typescriptMetadata.version}, ` +
        `expected ${lock.generator.version}/TypeScript ${lock.generator.typescript_version}`,
    );
  }
  return import(pathToFileURL(require.resolve(lock.generator.package)).href);
}

async function verifyPinnedFile(root, relativePath, expectedDigest) {
  const absolutePath = path.join(root, safeRelativePath(relativePath));
  const contents = await readFile(absolutePath);
  const actualDigest = sha256(contents);
  if (actualDigest !== expectedDigest) {
    throw new Error(`SHA-256 for ${relativePath} is ${actualDigest}, expected ${expectedDigest}`);
  }
  return contents;
}

export async function generatePublicApi() {
  const lock = validateLock(JSON.parse(await readFile(lockPath, "utf8")));
  const contractsRoot = path.resolve(
    repositoryRoot,
    process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts",
  );
  await verifyContractsCheckout(lock, contractsRoot);
  const generator = await verifyGenerator(lock);
  const generateTypes =
    typeof generator.default === "function" ? generator.default : generator.default?.default;
  if (typeof generateTypes !== "function") {
    throw new Error("pinned OpenAPI generator entrypoint is invalid");
  }
  const source = await verifyPinnedFile(contractsRoot, lock.source_path, lock.source_sha256);
  await Promise.all(
    lock.fixtures.map((fixture) =>
      verifyPinnedFile(contractsRoot, fixture.path, fixture.sha256),
    ),
  );

  const generated = `${generator.COMMENT_HEADER}${generator.astToString(
    await generateTypes(source),
  )}`;
  const generatedDigest = sha256(generated);
  if (generatedDigest !== lock.generated_sha256) {
    throw new Error(
      `generated SHA-256 is ${generatedDigest}, expected ${lock.generated_sha256}`,
    );
  }

  const outputPath = path.join(repositoryRoot, safeRelativePath(lock.generated_path));
  if (checkOnly) {
    const current = await readFile(outputPath, "utf8");
    if (current !== generated) {
      throw new Error("generated Public API types are not up to date");
    }
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated);
  }

  process.stdout.write(
    `Public API types verified at ${lock.full_commit} with ${lock.generator.package} ` +
      `${lock.generator.version}/TypeScript ${lock.generator.typescript_version}.\n`,
  );
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  generatePublicApi().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "contract generation failed"}\n`);
    process.exitCode = 1;
  });
}
