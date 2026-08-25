import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncDesktopSkillResources, validateResourceLock } from "./sync-desktop-skill-resources.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/desktop-skill-bundle-local.lock.json");

function normalizedTarget(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\.\//, "") : "";
}

export function includesSkillBundle(resources) {
  if (Array.isArray(resources)) return resources.some((entry) => normalizedTarget(entry).includes("skill-packages"));
  if (resources && typeof resources === "object") {
    return Object.entries(resources).some(([source, target]) =>
      normalizedTarget(source).includes("skill-packages") ||
      normalizedTarget(target) === "skill-packages" || normalizedTarget(target).startsWith("skill-packages/"));
  }
  return false;
}

export function assertDesktopReleaseManifest(manifest, lock) {
  if (manifest?.schema_version !== 2 || manifest?.bundle_id !== lock.catalog.bundle_id ||
      manifest?.bundle_version !== lock.catalog.bundle_version || manifest?.distribution_channel !== "desktop-release" ||
      manifest?.source?.revision_kind !== "git-commit" || manifest?.source?.revision !== lock.producer.full_commit ||
      manifest?.source?.tree_sha256 !== lock.producer.source_tree_sha256 || !Array.isArray(manifest?.skills) ||
      manifest.skills.length !== 38 || manifest.skills.some((skill) =>
        skill?.catalog_entry_mode !== "bundled" || skill?.release?.catalog_status !== "installable" ||
        skill?.license?.authorization_scope !== "desktop-distribution" ||
        skill?.license?.redistribution_status !== "verified" || skill?.provenance?.review_status !== "verified" ||
        typeof skill?.archive?.path !== "string" || typeof skill?.archive?.sha256 !== "string")) {
    throw new Error("Desktop release requires the exact 38-item installable v2 catalog with verified provenance and redistribution");
  }
  return manifest;
}

function assertSingleResource(config, expectedSource, expectedTarget, label) {
  const resources = config?.bundle?.resources;
  if (!resources || Array.isArray(resources) || Object.keys(resources).length !== 1 ||
      resources[expectedSource] !== expectedTarget) {
    throw new Error(`${label} Tauri overlay does not map the reviewed generated Skill root`);
  }
}

export function validateTauriResourceBoundary(defaultConfig, demoConfig, releaseConfig, lock) {
  if (includesSkillBundle(defaultConfig?.bundle?.resources)) {
    throw new Error("default Tauri config must remain resource-free; channel selection uses reviewed overlays");
  }
  assertSingleResource(demoConfig, "../.local/skill-packages", lock.desktop_resource.bundle_target, "demo_fast");
  assertSingleResource(releaseConfig, "../.local/skill-packages-desktop-release", lock.desktop_resource.bundle_target, "desktop-release");
  if (lock.desktop_resource.default_includes_skill_bundle !== false ||
      lock.desktop_resource.default_build_channel !== "desktop-release" ||
      lock.desktop_resource.assurance_scope !== "desktop-release-resource-channel-only" ||
      lock.desktop_resource.runtime_claim !== "none" ||
      lock.desktop_resource.status !== "resource_channel_ready") {
    throw new Error("Desktop Skill resource-channel boundary is not ready and fail-closed");
  }
}

export async function checkDesktopSkillReleaseBoundary({
  skillsRoot,
  contractsRoot,
  agentHostRoot,
} = {}) {
  const lock = validateResourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  await syncDesktopSkillResources({
    channel: "desktop-release",
    skillsRoot,
    contractsRoot,
    agentHostRoot,
    check: true,
    packageProducer: false,
  });
  const [defaultConfig, demoConfig, releaseConfig] = await Promise.all([
    readFile(path.join(repositoryRoot, lock.desktop_resource.default_tauri_config), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, lock.channels["local-development"].tauri_overlay), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, lock.channels["desktop-release"].tauri_overlay), "utf8").then(JSON.parse),
  ]);
  validateTauriResourceBoundary(defaultConfig, demoConfig, releaseConfig, lock);
  const releaseRoot = path.join(repositoryRoot, lock.channels["desktop-release"].generated_root);
  const info = await lstat(releaseRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("desktop-release generated resource root is unsafe");
  const releaseManifest = JSON.parse(await readFile(path.join(releaseRoot, "bundle-manifest.json"), "utf8"));
  assertDesktopReleaseManifest(releaseManifest, lock);
  process.stdout.write(
    "Desktop Skill resource-channel boundary verified: release overlay contains 38 reviewed resources; " +
      "no standalone production runtime is claimed.\n",
  );
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  checkDesktopSkillReleaseBoundary().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "release boundary check failed"}\n`);
    process.exitCode = 1;
  });
}
