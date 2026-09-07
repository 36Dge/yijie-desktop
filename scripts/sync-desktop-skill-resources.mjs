import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { isLocalPermissionCandidate, verifyLocalPermissionCandidate } from "./local-permission-candidate.mjs";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/desktop-skill-bundle-local.lock.json");
export const SKILL_CHANNELS = ["local-development", "desktop-release"];
export const EXPECTED_CATEGORY_COUNTS = Object.freeze({
  "sourcing-selection": 5,
  "market-research": 9,
  "content-marketing": 7,
  "traffic-advertising": 9,
  "store-operations": 8,
});

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
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.includes("\\") || value.includes("\0")) {
    throw new Error("Skill resource path must be a safe relative path");
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Skill resource path escapes its root");
  }
  return normalized;
}

const isSha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sameJSON = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalizeRepository = (value) => value.trim().replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase();

export function validateResourceLock(lock) {
  if (!lock || lock.schema_version !== 2 ||
      lock.contracts?.version !== "0.5.1" ||
      lock.contracts?.repository !== "https://github.com/36Dge/yijie-contracts.git" ||
      lock.contracts?.full_commit !== "164b14f609537d727a52326832da04430aecc4ab" ||
      lock.contracts?.schema_path !== "jsonschema/skills/skill-bundle-manifest-v2.schema.json" ||
      lock.contracts?.schema_sha256 !== "39a898111ba3dcae2f369fdcb571a2e892830d1d0a57c90ab6210a0ab897a649" ||
      lock.agent_host?.repository !== "https://github.com/36Dge/yijie-agent-host.git" ||
      lock.agent_host?.full_commit !== "1b7bfd1ce4323e52035b2ba1e62842c2d332d9ed" ||
      lock.agent_host?.contracts_lock_path !== "api/contracts.lock" ||
      lock.agent_host?.skills_lock_path !== "api/skills.lock" ||
      lock.producer?.name !== "@yijie/skills" || lock.producer?.version !== "0.3.0" ||
      lock.producer?.repository !== "https://github.com/36Dge/yijie-skills.git" ||
      lock.producer?.full_commit !== "10c45bec29603b002e861e1499d5b4e684251af5" ||
      lock.producer?.source_tree_sha256 !== "3247a14004c76170cf41a2d854e2ceffa1fd43de6e0ca8bb596f1d61d9be1029" ||
      lock.producer?.contract_lock_path !== "contracts/lock.json" ||
      lock.producer?.package_commands?.["local-development"] !== "pnpm --dir ../yijie-skills package" ||
      lock.producer?.package_commands?.["desktop-release"] !== "pnpm --dir ../yijie-skills package:desktop-release" ||
      lock.catalog?.bundle_id !== "yijie.desktop.skill-packages" || lock.catalog?.bundle_version !== "0.3.0" ||
      lock.catalog?.skill_count !== 38 || lock.catalog?.installable_count !== 38 || lock.catalog?.blocked_count !== 0 ||
      !sameJSON(lock.catalog?.category_counts, EXPECTED_CATEGORY_COUNTS) ||
      lock.catalog?.archive_inventory_sha256 !== "0bfb2d66b484b281cc7e22667d611dda81c6ab862ece5b78da4e8301fc497715" ||
      lock.channels?.["local-development"]?.manifest_path !== "dist/skill-packages/bundle-manifest.json" ||
      lock.channels?.["local-development"]?.manifest_sha256 !== "cc2b9be4d0e640e0888e97f6f7a09149a248386931786a7a089c8094304d94a5" ||
      lock.channels?.["local-development"]?.generated_root !== ".local/skill-packages" ||
      lock.channels?.["local-development"]?.tauri_overlay !== "src-tauri/tauri.demo-fast.conf.json" ||
      lock.channels?.["local-development"]?.profile?.environment !== "local" ||
      lock.channels?.["local-development"]?.profile?.local_profile !== "demo_fast" ||
      lock.channels?.["desktop-release"]?.manifest_path !== "dist/skill-packages-desktop-release/bundle-manifest.json" ||
      lock.channels?.["desktop-release"]?.manifest_sha256 !== "9f8459077615514183fdd4c81ff3b6b2ef1ea735257b04c040399d4c91c1daa2" ||
      lock.channels?.["desktop-release"]?.generated_root !== ".local/skill-packages-desktop-release" ||
      lock.channels?.["desktop-release"]?.tauri_overlay !== "src-tauri/tauri.desktop-release.conf.json" ||
      SKILL_CHANNELS.some((channel) => lock.channels?.[channel]?.required_authorization_scope !== "desktop-distribution") ||
      lock.desktop_resource?.bundle_target !== "skill-packages" ||
      lock.desktop_resource?.default_tauri_config !== "src-tauri/tauri.conf.json" ||
      lock.desktop_resource?.default_includes_skill_bundle !== false ||
      lock.desktop_resource?.default_build_channel !== "desktop-release" ||
      lock.desktop_resource?.assurance_scope !== "desktop-release-resource-channel-only" ||
      lock.desktop_resource?.runtime_claim !== "none" ||
      lock.desktop_resource?.canonical_runtime_profile?.environment !== "local" ||
      lock.desktop_resource?.canonical_runtime_profile?.local_profile !== "demo_fast" ||
      lock.desktop_resource?.status !== "resource_channel_ready") {
    throw new Error("Desktop Skill resource lock is incomplete or invalid");
  }
  for (const value of [lock.contracts.schema_path, lock.agent_host.contracts_lock_path,
    lock.agent_host.skills_lock_path, lock.producer.contract_lock_path, lock.desktop_resource.default_tauri_config]) {
    safeRelativePath(value);
  }
  for (const channel of SKILL_CHANNELS) {
    const entry = lock.channels[channel];
    if (!isSha256(entry.manifest_sha256)) throw new Error(`${channel} manifest digest is invalid`);
    [entry.manifest_path, entry.generated_root, entry.tauri_overlay].forEach(safeRelativePath);
  }
  return lock;
}

async function git(root, ...arguments_) {
  return (await exec("git", ["-C", root, ...arguments_])).stdout.trim();
}

async function verifyRepository(root, repository, commit, { requireHead = false } = {}) {
  // Contracts/Host may advance while this resource channel keeps its older exact object.
  const [head, pinnedCommit, origin, status] = await Promise.all([
    git(root, "rev-parse", "HEAD"),
    git(root, "rev-parse", "--verify", `${commit}^{commit}`).catch(() => {
      throw new Error(`${root} pinned commit ${commit} is unavailable`);
    }),
    git(root, "remote", "get-url", "origin"),
    git(root, "status", "--porcelain"),
  ]);
  if (pinnedCommit !== commit) throw new Error(`${root} pinned commit resolves to ${pinnedCommit}, expected ${commit}`);
  if (requireHead && head !== commit) throw new Error(`${root} HEAD is ${head}, expected ${commit}`);
  if (normalizeRepository(origin) !== normalizeRepository(repository)) throw new Error(`${root} origin differs from its lock`);
  if (status && (requireHead || !isLocalPermissionCandidate())) throw new Error(`${root} immutable checkout is not clean`);
}

async function readRegularFile(filePath, maximum = Number.MAX_SAFE_INTEGER) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new Error(`${filePath} is not an allowed regular file`);
  return readFile(filePath);
}

async function readPinnedRegularFile(root, commit, relativePath, maximum = Number.MAX_SAFE_INTEGER) {
  const { stdout } = await exec(
    "git",
    ["-C", root, "show", `${commit}:${safeRelativePath(relativePath)}`],
    { encoding: null, maxBuffer: Math.min(maximum + 1, 64 * 1024 * 1024) },
  );
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  if (bytes.length > maximum) throw new Error(`${relativePath} exceeds its allowed size`);
  return bytes;
}

function parseKeyValueFile(bytes) {
  return Object.fromEntries(bytes.toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("immutable provider lock contains an invalid line");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

async function verifyConsumerLocks(skillsRoot, agentHostRoot, lock) {
  const [packageBytes, producerBytes, hostContractsBytes, hostSkillsBytes] = await Promise.all([
    readPinnedRegularFile(skillsRoot, lock.producer.full_commit, "package.json", 128 * 1024),
    readPinnedRegularFile(
      skillsRoot,
      lock.producer.full_commit,
      lock.producer.contract_lock_path,
      64 * 1024,
    ),
    readPinnedRegularFile(
      agentHostRoot,
      lock.agent_host.full_commit,
      lock.agent_host.contracts_lock_path,
      64 * 1024,
    ),
    readPinnedRegularFile(
      agentHostRoot,
      lock.agent_host.full_commit,
      lock.agent_host.skills_lock_path,
      64 * 1024,
    ),
  ]);
  const packageJson = JSON.parse(packageBytes.toString("utf8"));
  const producer = JSON.parse(producerBytes.toString("utf8"));
  const hostContracts = parseKeyValueFile(hostContractsBytes);
  const hostSkills = parseKeyValueFile(hostSkillsBytes);
  if (packageJson.name !== lock.producer.name || packageJson.version !== lock.producer.version ||
      producer.contracts_version !== lock.contracts.version || producer.source_revision !== lock.contracts.full_commit ||
      producer.artifacts?.skill_bundle_manifest_v2?.source_path !== lock.contracts.schema_path ||
      producer.artifacts?.skill_bundle_manifest_v2?.sha256 !== lock.contracts.schema_sha256 ||
      hostContracts.CONTRACTS_VERSION !== lock.contracts.version || hostContracts.CONTRACTS_COMMIT !== lock.contracts.full_commit ||
      hostContracts.SKILL_BUNDLE_MANIFEST_V2_SCHEMA_SHA256 !== lock.contracts.schema_sha256 ||
      hostSkills.CONTRACTS_COMMIT !== lock.contracts.full_commit || hostSkills.MANIFEST_V2_SHA256 !== lock.contracts.schema_sha256 ||
      hostSkills.SKILLS_VERSION !== lock.producer.version || hostSkills.SKILLS_REPOSITORY !== lock.producer.repository ||
      hostSkills.SKILLS_COMMIT !== lock.producer.full_commit || hostSkills.SKILLS_SOURCE_TREE_SHA256 !== lock.producer.source_tree_sha256 ||
      hostSkills.LOCAL_DEVELOPMENT_MANIFEST_SHA256 !== lock.channels["local-development"].manifest_sha256 ||
      hostSkills.DESKTOP_RELEASE_MANIFEST_SHA256 !== lock.channels["desktop-release"].manifest_sha256 ||
      hostSkills.ARCHIVE_INVENTORY_SHA256 !== lock.catalog.archive_inventory_sha256 ||
      hostSkills.SKILL_COUNT !== "38" || hostSkills.INSTALLABLE_COUNT !== "38" || hostSkills.BLOCKED_COUNT !== "0" ||
      hostSkills.CATEGORY_COUNTS !== "5/9/7/9/8") {
    throw new Error("Skills producer or Agent Host does not consume the exact reviewed v2 locks");
  }
}

function validateManifestAgainstSchema(schema, manifest) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("uri", (value) => { try { return new URL(value).protocol.length > 1; } catch { return false; } });
  ajv.addFormat("date-time", (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  const validate = ajv.compile(schema);
  if (!validate(manifest)) throw new Error(`Skill bundle manifest does not match v2 schema: ${JSON.stringify(validate.errors)}`);
}

export function validateBundleManifest(manifest, rawManifest, lock, channel) {
  const channelLock = lock.channels[channel];
  if (!channelLock || sha256(rawManifest) !== channelLock.manifest_sha256 || manifest.schema_version !== 2 ||
      manifest.bundle_id !== lock.catalog.bundle_id || manifest.bundle_version !== lock.catalog.bundle_version ||
      manifest.distribution_channel !== channel || manifest.source?.repository !== lock.producer.repository ||
      manifest.source?.revision_kind !== "git-commit" || manifest.source?.revision !== lock.producer.full_commit ||
      manifest.source?.tree_sha256 !== lock.producer.source_tree_sha256 || !Array.isArray(manifest.skills) ||
      manifest.skills.length !== 38) throw new Error(`${channel} Skill bundle manifest differs from its immutable lock`);
  const ids = new Set();
  const counts = Object.fromEntries(Object.keys(EXPECTED_CATEGORY_COUNTS).map((key) => [key, 0]));
  for (const skill of manifest.skills) {
    if (typeof skill?.id !== "string" || ids.has(skill.id) || skill?.catalog_entry_mode !== "bundled" ||
        skill?.release?.catalog_status !== "installable" || skill?.provenance?.review_status !== "verified" ||
        skill?.license?.redistribution_status !== "verified" ||
        skill?.license?.authorization_scope !== channelLock.required_authorization_scope ||
        typeof skill?.icon?.key !== "string" || !skill.icon.key || typeof skill?.risk?.level !== "string" ||
        !skill?.capabilities || !Array.isArray(skill.capabilities.required_tools) ||
        typeof skill?.archive?.path !== "string" || !isSha256(skill.archive.sha256) ||
        !Number.isSafeInteger(skill.archive.compressed_size_bytes) || skill.archive.compressed_size_bytes <= 0 ||
        !(skill.category in counts)) throw new Error(`${skill?.id ?? "unknown Skill"} is not an installable reviewed v2 entry`);
    safeRelativePath(skill.archive.path);
    ids.add(skill.id);
    counts[skill.category] += 1;
  }
  if (!sameJSON(counts, lock.catalog.category_counts)) throw new Error(`Skill category counts differ from 5/9/7/9/8`);
  return manifest;
}

async function verifyBundleFiles(skillsRoot, manifest, channelLock, lock) {
  const bundleRoot = path.dirname(path.join(skillsRoot, safeRelativePath(channelLock.manifest_path)));
  const files = [];
  const inventoryLines = [];
  for (const skill of manifest.skills) {
    const relativePath = safeRelativePath(skill.archive.path);
    const bytes = await readRegularFile(path.join(bundleRoot, relativePath), 64 * 1024 * 1024);
    if (bytes.length !== skill.archive.compressed_size_bytes || sha256(bytes) !== skill.archive.sha256) {
      throw new Error(`${relativePath} differs from its archive metadata`);
    }
    files.push({ relativePath, bytes });
    inventoryLines.push(`${relativePath} ${skill.archive.sha256}`);
  }
  const inventory = `${inventoryLines.sort().join("\n")}\n`;
  if (sha256(inventory) !== lock.catalog.archive_inventory_sha256) throw new Error("Skill archive inventory differs from its lock");
  const entries = await readdir(path.join(bundleRoot, "packages"), { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) throw new Error("Skill package directory contains a non-regular entry");
  if (!sameJSON(entries.map((entry) => `packages/${entry.name}`).sort(), files.map(({ relativePath }) => relativePath).sort())) {
    throw new Error("Skill package directory does not contain exactly 38 reviewed archives");
  }
  return { files, inventory };
}

async function expectedBundles(skillsRoot, contractsRoot, agentHostRoot, lock) {
  await verifySourceChain(skillsRoot, contractsRoot, agentHostRoot, lock);
  const schemaBytes = await readPinnedRegularFile(
    contractsRoot,
    lock.contracts.full_commit,
    lock.contracts.schema_path,
    1024 * 1024,
  );
  if (sha256(schemaBytes) !== lock.contracts.schema_sha256) throw new Error("Bundle Manifest v2 schema differs from its pin");
  const schema = JSON.parse(schemaBytes.toString("utf8"));
  const bundles = {};
  for (const channel of SKILL_CHANNELS) {
    const channelLock = lock.channels[channel];
    const rawManifest = await readRegularFile(path.join(skillsRoot, safeRelativePath(channelLock.manifest_path)), 2 * 1024 * 1024);
    const manifest = JSON.parse(rawManifest.toString("utf8"));
    validateManifestAgainstSchema(schema, manifest);
    validateBundleManifest(manifest, rawManifest, lock, channel);
    const bundleFiles = await verifyBundleFiles(skillsRoot, manifest, channelLock, lock);
    bundles[channel] = { manifest, inventory: bundleFiles.inventory,
      files: [{ relativePath: "bundle-manifest.json", bytes: rawManifest }, ...bundleFiles.files] };
  }
  const local = structuredClone(bundles["local-development"].manifest);
  const release = structuredClone(bundles["desktop-release"].manifest);
  local.distribution_channel = release.distribution_channel = "reviewed-channel";
  if (!sameJSON(local, release) || bundles["local-development"].inventory !== bundles["desktop-release"].inventory) {
    throw new Error("local-development and desktop-release catalog/archive inventories differ");
  }
  const localArchives = new Map(bundles["local-development"].files.slice(1).map((file) => [file.relativePath, file.bytes]));
  for (const file of bundles["desktop-release"].files.slice(1)) {
    if (!localArchives.get(file.relativePath)?.equals(file.bytes)) throw new Error(`${file.relativePath} differs across channels`);
  }
  return bundles;
}

async function verifySourceChain(skillsRoot, contractsRoot, agentHostRoot, lock) {
  await Promise.all([
    verifyRepository(contractsRoot, lock.contracts.repository, lock.contracts.full_commit),
    verifyRepository(
      skillsRoot,
      lock.producer.repository,
      lock.producer.full_commit,
      { requireHead: true },
    ),
    verifyRepository(agentHostRoot, lock.agent_host.repository, lock.agent_host.full_commit),
    verifyConsumerLocks(skillsRoot, agentHostRoot, lock),
  ]);
}

async function listFiles(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`generated resource contains a symlink: ${relative}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`generated resource contains a special file: ${relative}`);
  }
  return files.sort();
}

async function verifyOutput(outputRoot, expectedFiles) {
  if (!sameJSON(await listFiles(outputRoot), expectedFiles.map(({ relativePath }) => relativePath).sort())) {
    throw new Error("generated Desktop Skill resource file set differs from its lock");
  }
  for (const expected of expectedFiles) {
    if (!(await readRegularFile(path.join(outputRoot, expected.relativePath))).equals(expected.bytes)) {
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
      const temporary = path.join(staging, `.copy-${randomUUID()}`);
      await writeFile(temporary, expected.bytes, { mode: 0o644, flag: "wx" });
      await rename(temporary, destination);
      await chmod(destination, 0o644);
    }
    await verifyOutput(staging, expectedFiles);
    try {
      const existing = await lstat(outputRoot);
      if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error("existing Skill resource root is unsafe");
      await rename(outputRoot, backup); movedPrevious = true;
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    await rename(staging, outputRoot);
    if (movedPrevious) await rm(backup, { force: true, recursive: true });
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    if (movedPrevious) { await rm(outputRoot, { force: true, recursive: true }); await rename(backup, outputRoot).catch(() => {}); }
    throw error;
  }
}

async function packageProducerChannels(skillsRoot, producerExecutor) {
  await producerExecutor("pnpm", ["--dir", skillsRoot, "package"], { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 });
  await producerExecutor("pnpm", ["--dir", skillsRoot, "package:desktop-release"], { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 });
}

async function defaultLocalSkillsRoot() {
  const sibling = path.resolve(repositoryRoot, "../yijie-skills");
  if (!isLocalPermissionCandidate()) return sibling;
  const lock = validateResourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  const { stdout } = await exec("git", ["-C", sibling, "rev-parse", "HEAD"]);
  if (stdout.trim() === lock.producer.full_commit) return sibling;
  const pinned = path.join(repositoryRoot, ".local", `skills-pinned-${lock.producer.full_commit.slice(0, 7)}`);
  await verifyRepository(pinned, lock.producer.repository, lock.producer.full_commit, { requireHead: true });
  return pinned;
}

export async function syncDesktopSkillResources({
  channel = "local-development", allChannels = false,
  skillsRoot = path.resolve(repositoryRoot, process.env.YIJIE_DESKTOP_SKILLS_DIR ?? "../yijie-skills"),
  contractsRoot = path.resolve(repositoryRoot, process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts"),
  agentHostRoot = path.resolve(repositoryRoot, process.env.YIJIE_DESKTOP_AGENT_HOST_DIR ?? "../yijie-agent-host"),
  outputRoot, check = false, packageProducer = false, producerExecutor = exec,
} = {}) {
  if (!SKILL_CHANNELS.includes(channel)) throw new Error(`Unsupported Skill channel: ${channel}`);
  if (isLocalPermissionCandidate()) {
    if (channel !== "local-development" || allChannels) {
      throw new Error("Permission candidates are restricted to local development consumption");
    }
    await verifyLocalPermissionCandidate(repositoryRoot, contractsRoot, agentHostRoot);
  }
  const lock = validateResourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  if (packageProducer) {
    await verifySourceChain(skillsRoot, contractsRoot, agentHostRoot, lock);
    await packageProducerChannels(skillsRoot, producerExecutor);
  }
  const bundles = await expectedBundles(skillsRoot, contractsRoot, agentHostRoot, lock);
  const outputs = {};
  for (const selected of allChannels ? SKILL_CHANNELS : [channel]) {
    const resolvedOutput = path.resolve(outputRoot && !allChannels ? outputRoot :
      path.join(repositoryRoot, safeRelativePath(lock.channels[selected].generated_root)));
    if (check) await verifyOutput(resolvedOutput, bundles[selected].files);
    else await installOutput(resolvedOutput, bundles[selected].files);
    outputs[selected] = resolvedOutput;
  }
  return { lock, bundles, outputs, manifest: bundles[channel].manifest, outputRoot: outputs[channel] };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const channel = argument("--channel") ?? "local-development";
  const allChannels = process.argv.includes("--all-channels");
  const check = process.argv.includes("--check");
  const outputArgument = argument("--output");
  if (allChannels && outputArgument) throw new Error("--output cannot be combined with --all-channels");
  const outputRoot = outputArgument ? path.resolve(repositoryRoot, outputArgument) : undefined;
  if (outputRoot) {
    const relative = path.relative(path.join(repositoryRoot, ".local"), outputRoot);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("CLI Skill resource output must stay inside yijie-desktop/.local");
    }
  }
  const explicitSkillsRoot = argument("--skills-root") ?? process.env.YIJIE_DESKTOP_SKILLS_DIR;
  syncDesktopSkillResources({ channel, allChannels,
    skillsRoot: explicitSkillsRoot ? path.resolve(repositoryRoot, explicitSkillsRoot) : await defaultLocalSkillsRoot(),
    contractsRoot: path.resolve(repositoryRoot, argument("--contracts-root") ?? process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts"),
    agentHostRoot: path.resolve(repositoryRoot, argument("--agent-host-root") ?? process.env.YIJIE_DESKTOP_AGENT_HOST_DIR ?? "../yijie-agent-host"),
    outputRoot, check, packageProducer: !process.argv.includes("--skip-package") && !check,
  }).then(({ bundles }) => process.stdout.write(
    `${check ? "Verified" : "Synchronized"} ${allChannels ? "both reviewed channels" : channel}: ` +
    `${bundles[channel].manifest.skills.length} installable Skills, categories 5/9/7/9/8.\n`,
  )).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Skill resource sync failed"}\n`);
    process.exitCode = 1;
  });
}
