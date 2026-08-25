import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/desktop-skill-bundle-local.lock.json");
const checkOnly = process.argv.includes("--check");
const skipPackage = process.argv.includes("--skip-package") || checkOnly;

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

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
    throw new Error("Skill resource path must be a safe relative path");
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Skill resource path escapes its root");
  }
  return normalized;
}

function normalizeRepository(value) {
  return value.trim().replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase();
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function validateResourceLock(lock) {
  if (
    !lock ||
    lock.schema_version !== 1 ||
    lock.profile?.environment !== "local" ||
    lock.profile?.local_profile !== "demo_fast" ||
    lock.contracts?.repository !== "https://github.com/36Dge/yijie-contracts.git" ||
    lock.contracts?.full_commit !== "d6dff903e0c12b6a5e69599df1e33ef46d8bea6b" ||
    lock.contracts?.schema_path !== "jsonschema/skills/skill-bundle-manifest-v1.schema.json" ||
    lock.contracts?.schema_sha256 !==
      "d86185a1d5f4d9a136c88b679d50ac3e83bcc2b722eee39cba674c5be3b88469" ||
    lock.producer?.repository !== "https://github.com/36Dge/yijie-skills.git" ||
    !/^[a-f0-9]{40}$/.test(lock.producer?.head_commit ?? "") ||
    lock.producer?.package_command !== "pnpm --dir ../yijie-skills package" ||
    lock.producer?.contract_lock_path !== "contracts/lock.json" ||
    lock.bundle?.bundle_id !== "yijie.desktop.skill-packages" ||
    lock.bundle?.bundle_version !== "0.1.0" ||
    lock.bundle?.distribution_channel !== "local-development" ||
    lock.bundle?.manifest_path !== "dist/skill-packages/bundle-manifest.json" ||
    !isSha256(lock.bundle?.manifest_sha256) ||
    lock.bundle?.source_revision_kind !== "git-commit" ||
    lock.bundle?.source_revision !== lock.producer.head_commit ||
    !isSha256(lock.bundle?.source_tree_sha256) ||
    !Array.isArray(lock.bundle?.skills) ||
    lock.bundle.skills.length !== 1 ||
    lock.desktop_resource?.generated_root !== ".local/skill-packages" ||
    lock.desktop_resource?.tauri_overlay !== "src-tauri/tauri.demo-fast.conf.json" ||
    lock.desktop_resource?.bundle_target !== "skill-packages" ||
    lock.release_boundary?.default_tauri_config !== "src-tauri/tauri.conf.json" ||
    lock.release_boundary?.default_includes_skill_bundle !== false ||
    lock.release_boundary?.desktop_release_required_channel !== "desktop-release" ||
    lock.release_boundary?.desktop_release_required_authorization_scope !==
      "desktop-distribution" ||
    lock.release_boundary?.status !== "blocked_pending_license"
  ) {
    throw new Error("Desktop local Skill resource lock is incomplete or invalid");
  }
  safeRelativePath(lock.contracts.schema_path);
  safeRelativePath(lock.producer.contract_lock_path);
  safeRelativePath(lock.bundle.manifest_path);
  safeRelativePath(lock.desktop_resource.generated_root);
  safeRelativePath(lock.desktop_resource.tauri_overlay);
  safeRelativePath(lock.release_boundary.default_tauri_config);
  const ids = new Set();
  for (const skill of lock.bundle.skills) {
    if (
      typeof skill?.id !== "string" ||
      ids.has(skill.id) ||
      typeof skill?.version !== "string" ||
      !isSha256(skill?.archive_sha256) ||
      !Number.isSafeInteger(skill?.archive_size_bytes) ||
      skill.archive_size_bytes <= 0 ||
      skill.authorization_scope !== "local-development"
    ) {
      throw new Error("Desktop local Skill resource entry is invalid");
    }
    safeRelativePath(skill.archive_path);
    ids.add(skill.id);
  }
  return lock;
}

async function git(root, ...arguments_) {
  const { stdout } = await exec("git", ["-C", root, ...arguments_]);
  return stdout.trim();
}

async function verifyRepository(root, repository, commit, requireClean) {
  const [head, origin, status] = await Promise.all([
    git(root, "rev-parse", "HEAD"),
    git(root, "remote", "get-url", "origin"),
    requireClean ? git(root, "status", "--porcelain") : Promise.resolve(""),
  ]);
  if (head !== commit) throw new Error(`repository HEAD is ${head}, expected ${commit}`);
  if (normalizeRepository(origin) !== normalizeRepository(repository)) {
    throw new Error("repository origin does not match its immutable lock");
  }
  if (requireClean && status !== "") throw new Error("immutable Contracts checkout is not clean");
}

async function readRegularFile(filePath, maximum = Number.MAX_SAFE_INTEGER) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) {
    throw new Error(`${filePath} is not an allowed regular file`);
  }
  return readFile(filePath);
}

function validUri(value) {
  try {
    const uri = new URL(value);
    return uri.protocol.length > 1;
  } catch {
    return false;
  }
}

function validDateTime(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function validateManifestAgainstSchema(schema, manifest) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("uri", validUri);
  ajv.addFormat("date-time", validDateTime);
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    throw new Error(`Skill bundle manifest does not match v1 schema: ${JSON.stringify(validate.errors)}`);
  }
}

export function validateBundleManifest(manifest, rawManifest, lock) {
  if (
    sha256(rawManifest) !== lock.bundle.manifest_sha256 ||
    manifest.schema_version !== 1 ||
    manifest.bundle_id !== lock.bundle.bundle_id ||
    manifest.bundle_version !== lock.bundle.bundle_version ||
    manifest.distribution_channel !== lock.bundle.distribution_channel ||
    manifest.source?.repository !== lock.producer.repository ||
    manifest.source?.revision_kind !== lock.bundle.source_revision_kind ||
    manifest.source?.revision !== lock.bundle.source_revision ||
    manifest.source?.tree_sha256 !== lock.bundle.source_tree_sha256 ||
    !Array.isArray(manifest.skills) ||
    manifest.skills.length !== lock.bundle.skills.length
  ) {
    throw new Error("Skill bundle manifest differs from its reviewed local-development lock");
  }
  const byID = new Map(manifest.skills.map((skill) => [skill.id, skill]));
  if (byID.size !== manifest.skills.length) throw new Error("Skill bundle contains duplicate IDs");
  for (const expected of lock.bundle.skills) {
    const skill = byID.get(expected.id);
    if (
      skill?.version !== expected.version ||
      skill?.archive?.path !== expected.archive_path ||
      skill?.archive?.sha256 !== expected.archive_sha256 ||
      skill?.archive?.compressed_size_bytes !== expected.archive_size_bytes ||
      skill?.license?.authorization_scope !== expected.authorization_scope ||
      skill?.license?.redistribution_status !== "verified" ||
      skill?.provenance?.review_status !== "verified" ||
      skill?.release?.catalog_status !== "installable"
    ) {
      throw new Error(`${expected.id} differs from its reviewed local-development entry`);
    }
  }
  return manifest;
}

async function verifyProducerContractLock(skillsRoot, lock) {
  const producerLockPath = path.join(
    skillsRoot,
    safeRelativePath(lock.producer.contract_lock_path),
  );
  const producerLock = JSON.parse(
    (await readRegularFile(producerLockPath, 64 * 1024)).toString("utf8"),
  );
  if (
    producerLock.contracts_version !== "0.5.0" ||
    producerLock.source_revision_kind !== "git-commit" ||
    producerLock.source_revision !== lock.contracts.full_commit ||
    producerLock.artifacts?.skill_bundle_manifest_v1?.source_path !== lock.contracts.schema_path ||
    producerLock.artifacts?.skill_bundle_manifest_v1?.sha256 !== lock.contracts.schema_sha256
  ) {
    throw new Error("yijie-skills does not pin the reviewed Bundle Manifest v1 contract");
  }
}

async function verifyBundleFiles(skillsRoot, manifest, lock) {
  const bundleRoot = path.dirname(path.join(skillsRoot, safeRelativePath(lock.bundle.manifest_path)));
  const files = [];
  for (const expected of lock.bundle.skills) {
    const archivePath = path.join(bundleRoot, safeRelativePath(expected.archive_path));
    const bytes = await readRegularFile(archivePath, 64 * 1024 * 1024);
    if (bytes.length !== expected.archive_size_bytes || sha256(bytes) !== expected.archive_sha256) {
      throw new Error(`${expected.archive_path} bytes differ from the reviewed archive`);
    }
    files.push({ relativePath: expected.archive_path, bytes });
  }
  const packageDirectory = path.join(bundleRoot, "packages");
  const packageEntries = await readdir(packageDirectory, { withFileTypes: true });
  if (packageEntries.some((entry) => !entry.isFile())) {
    throw new Error("Skill bundle package directory contains a non-regular entry");
  }
  const actualArchives = packageEntries.map((entry) => `packages/${entry.name}`).sort();
  const expectedArchives = lock.bundle.skills.map((skill) => skill.archive_path).sort();
  if (JSON.stringify(actualArchives) !== JSON.stringify(expectedArchives)) {
    throw new Error("Skill bundle package directory contains an unreviewed archive set");
  }
  return files;
}

async function expectedBundle(skillsRoot, contractsRoot, lock) {
  await Promise.all([
    verifyRepository(
      contractsRoot,
      lock.contracts.repository,
      lock.contracts.full_commit,
      true,
    ),
    verifyRepository(skillsRoot, lock.producer.repository, lock.producer.head_commit, false),
    verifyProducerContractLock(skillsRoot, lock),
  ]);
  const [schemaBytes, rawManifest] = await Promise.all([
    readRegularFile(
      path.join(contractsRoot, safeRelativePath(lock.contracts.schema_path)),
      1024 * 1024,
    ),
    readRegularFile(
      path.join(skillsRoot, safeRelativePath(lock.bundle.manifest_path)),
      1024 * 1024,
    ),
  ]);
  if (sha256(schemaBytes) !== lock.contracts.schema_sha256) {
    throw new Error("Bundle Manifest v1 schema differs from its pin");
  }
  const schema = JSON.parse(schemaBytes.toString("utf8"));
  const manifest = JSON.parse(rawManifest.toString("utf8"));
  validateManifestAgainstSchema(schema, manifest);
  validateBundleManifest(manifest, rawManifest, lock);
  const files = await verifyBundleFiles(skillsRoot, manifest, lock);
  return {
    files: [{ relativePath: "bundle-manifest.json", bytes: rawManifest }, ...files],
    manifest,
  };
}

async function listFiles(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`generated resource contains a symlink: ${relative}`);
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative)));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`generated resource contains a special file: ${relative}`);
  }
  return files.sort();
}

async function verifyOutput(outputRoot, expectedFiles) {
  const actualFiles = await listFiles(outputRoot);
  const expectedNames = expectedFiles.map((file) => file.relativePath).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedNames)) {
    throw new Error("generated Desktop Skill resource file set differs from its lock");
  }
  for (const expected of expectedFiles) {
    const actual = await readRegularFile(path.join(outputRoot, expected.relativePath));
    if (!actual.equals(expected.bytes)) {
      throw new Error(`${expected.relativePath} differs from the reviewed producer bytes`);
    }
  }
}

async function installOutput(outputRoot, expectedFiles) {
  const parent = path.dirname(outputRoot);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(path.join(parent, ".skill-packages-staging-"));
  const backup = path.join(parent, `.skill-packages-backup-${randomUUID()}`);
  let movedPrevious = false;
  try {
    await chmod(staging, 0o755);
    for (const expected of expectedFiles) {
      const destination = path.join(staging, expected.relativePath);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
      const temporarySource = path.join(staging, `.copy-${randomUUID()}`);
      await writeFile(temporarySource, expected.bytes, { mode: 0o644, flag: "wx" });
      await rename(temporarySource, destination);
      await chmod(destination, 0o644);
    }
    await verifyOutput(staging, expectedFiles);
    try {
      const existing = await lstat(outputRoot);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new Error("existing generated Skill resource root is unsafe");
      }
      await rename(outputRoot, backup);
      movedPrevious = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(staging, outputRoot);
    if (movedPrevious) await rm(backup, { force: true, recursive: true });
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    if (movedPrevious) {
      await rm(outputRoot, { force: true, recursive: true });
      await rename(backup, outputRoot).catch(() => {});
    }
    throw error;
  }
}

export async function syncDesktopSkillResources({
  skillsRoot = path.resolve(repositoryRoot, "../yijie-skills"),
  contractsRoot = path.resolve(repositoryRoot, "../yijie-contracts"),
  outputRoot,
  check = false,
  packageProducer = false,
} = {}) {
  const lock = validateResourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  const resolvedOutput = path.resolve(
    outputRoot ?? path.join(repositoryRoot, safeRelativePath(lock.desktop_resource.generated_root)),
  );
  if (packageProducer) {
    await exec("pnpm", ["--dir", skillsRoot, "package"], {
      cwd: repositoryRoot,
      maxBuffer: 4 * 1024 * 1024,
    });
  }
  const expected = await expectedBundle(skillsRoot, contractsRoot, lock);
  if (check) await verifyOutput(resolvedOutput, expected.files);
  else await installOutput(resolvedOutput, expected.files);
  return { lock, manifest: expected.manifest, outputRoot: resolvedOutput };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const skillsRoot = path.resolve(repositoryRoot, argument("--skills-root") ?? "../yijie-skills");
  const contractsRoot = path.resolve(
    repositoryRoot,
    argument("--contracts-root") ?? process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts",
  );
  const outputRoot = path.resolve(
    repositoryRoot,
    argument("--output") ?? ".local/skill-packages",
  );
  const localRoot = path.join(repositoryRoot, ".local");
  const relativeOutput = path.relative(localRoot, outputRoot);
  if (
    relativeOutput === "" ||
    relativeOutput === ".." ||
    relativeOutput.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutput)
  ) {
    throw new Error("CLI Skill resource output must stay inside yijie-desktop/.local");
  }
  syncDesktopSkillResources({
    skillsRoot,
    contractsRoot,
    outputRoot,
    check: checkOnly,
    packageProducer: !skipPackage,
  })
    .then(({ manifest }) => {
      process.stdout.write(
        `${checkOnly ? "Verified" : "Synchronized"} ${manifest.skills.length} reviewed ` +
          `Desktop Skill resource(s) for local + demo_fast.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Skill resource sync failed"}\n`);
      process.exitCode = 1;
    });
}
