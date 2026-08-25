import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateResourceLock } from "./sync-desktop-skill-resources.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/desktop-skill-bundle-local.lock.json");

function normalizedTarget(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\.\//, "") : "";
}

export function includesSkillBundle(resources) {
  if (Array.isArray(resources)) {
    return resources.some((entry) => normalizedTarget(entry).includes("skill-packages"));
  }
  if (resources && typeof resources === "object") {
    return Object.entries(resources).some(
      ([source, target]) =>
        normalizedTarget(source).includes("skill-packages") ||
        normalizedTarget(target) === "skill-packages" ||
        normalizedTarget(target).startsWith("skill-packages/"),
    );
  }
  return false;
}

export function assertDesktopReleaseManifest(manifest) {
  if (
    manifest?.distribution_channel !== "desktop-release" ||
    manifest?.source?.revision_kind !== "git-commit" ||
    !Array.isArray(manifest?.skills) ||
    manifest.skills.length === 0 ||
    manifest.skills.some(
      (skill) =>
        skill?.license?.authorization_scope !== "desktop-distribution" ||
        skill?.license?.redistribution_status !== "verified" ||
        skill?.provenance?.review_status !== "verified",
    )
  ) {
    throw new Error(
      "Desktop release Skill resources require desktop-release, immutable source, " +
        "verified provenance and desktop-distribution authorization",
    );
  }
  return manifest;
}

export function validateTauriResourceBoundary(defaultConfig, overlayConfig, lock) {
  if (includesSkillBundle(defaultConfig?.bundle?.resources)) {
    throw new Error("default Tauri config must not include the local-development Skill bundle");
  }
  const resources = overlayConfig?.bundle?.resources;
  if (
    !resources ||
    Array.isArray(resources) ||
    Object.keys(resources).length !== 1 ||
    resources["../.local/skill-packages"] !== lock.desktop_resource.bundle_target
  ) {
    throw new Error("demo_fast Tauri overlay does not map the reviewed generated Skill root");
  }
  if (
    lock.release_boundary.default_includes_skill_bundle !== false ||
    lock.release_boundary.status !== "blocked_pending_license"
  ) {
    throw new Error("Desktop local Skill release boundary is not fail-closed");
  }
}

export async function checkDesktopSkillReleaseBoundary() {
  const lock = validateResourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  const [defaultConfig, overlayConfig] = await Promise.all([
    readFile(path.join(repositoryRoot, lock.release_boundary.default_tauri_config), "utf8").then(
      JSON.parse,
    ),
    readFile(path.join(repositoryRoot, lock.desktop_resource.tauri_overlay), "utf8").then(
      JSON.parse,
    ),
  ]);
  validateTauriResourceBoundary(defaultConfig, overlayConfig, lock);
  process.stdout.write(
    "Desktop release boundary verified: default Tauri bundle excludes local-development Skills.\n",
  );
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  checkDesktopSkillReleaseBoundary().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "release boundary check failed"}\n`);
    process.exitCode = 1;
  });
}
