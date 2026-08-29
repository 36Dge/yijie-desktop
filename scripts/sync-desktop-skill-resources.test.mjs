import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPECTED_CATEGORY_COUNTS,
  safeRelativePath,
  sha256,
  syncDesktopSkillResources,
  validateBundleManifest,
  validateResourceLock,
} from "./sync-desktop-skill-resources.mjs";
import {
  assertDesktopReleaseManifest,
  checkDesktopSkillReleaseBoundary,
  includesSkillBundle,
} from "./check-desktop-skill-release-boundary.mjs";
import { releaseBuildEnvironment, runDefaultTauriBuild } from "./run-tauri-build.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.resolve(repositoryRoot, "../yijie-skills");
const lock = JSON.parse(await readFile(path.join(repositoryRoot, "contracts/desktop-skill-bundle-local.lock.json"), "utf8"));
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("Desktop v2 Skill resources", () => {
  it("accepts only the exact Contracts, Host and Skills immutable pins", () => {
    expect(validateResourceLock(structuredClone(lock))).toEqual(lock);
    expect(sha256("desktop-skill-resource")).toBe("aca5e27e70d01f04ba9a365071b4f755475d2c931165597d4f76e3c24340eac6");
    expect(() => safeRelativePath("../skill.zip")).toThrow();
    expect(() => validateResourceLock({ ...lock, producer: { ...lock.producer, version: "0.3.1" } })).toThrow();
    expect(() => validateResourceLock({ ...lock, catalog: { ...lock.catalog, skill_count: 37 } })).toThrow();
  });

  it("validates both channels, 38 entries, 5/9/7/9/8 and byte-identical archives", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yijie-desktop-skills-"));
    temporaryDirectories.push(root);
    const localOutput = path.join(root, "local");
    const releaseOutput = path.join(root, "release");
    const local = await syncDesktopSkillResources({ channel: "local-development", outputRoot: localOutput });
    const release = await syncDesktopSkillResources({ channel: "desktop-release", outputRoot: releaseOutput });
    expect(local.manifest.skills).toHaveLength(38);
    expect(release.manifest.skills).toHaveLength(38);
    expect(local.manifest.skills.every((skill) => skill.release.catalog_status === "installable")).toBe(true);
    expect(local.manifest.skills.reduce((counts, skill) => ({ ...counts, [skill.category]: (counts[skill.category] ?? 0) + 1 }), {}))
      .toEqual(EXPECTED_CATEGORY_COUNTS);
    await expect(syncDesktopSkillResources({ channel: "local-development", outputRoot: localOutput, check: true })).resolves.toBeDefined();
    await expect(syncDesktopSkillResources({ channel: "desktop-release", outputRoot: releaseOutput, check: true })).resolves.toBeDefined();
    await writeFile(path.join(releaseOutput, "bundle-manifest.json"), "{}\n");
    await expect(syncDesktopSkillResources({ channel: "desktop-release", outputRoot: releaseOutput, check: true }))
      .rejects.toThrow("differs from the reviewed producer bytes");
  });

  it("never executes producer scripts before the immutable source chain is verified", async () => {
    const unverifiedSkillsRoot = await mkdtemp(path.join(tmpdir(), "unverified-yijie-skills-"));
    temporaryDirectories.push(unverifiedSkillsRoot);
    let executed = false;
    await expect(syncDesktopSkillResources({
      skillsRoot: unverifiedSkillsRoot,
      packageProducer: true,
      producerExecutor: async () => { executed = true; },
    })).rejects.toThrow();
    expect(executed).toBe(false);
  });

  it("rejects manifest-byte drift even when parsed fields look equivalent", async () => {
    for (const channel of ["local-development", "desktop-release"]) {
      const channelLock = lock.channels[channel];
      const raw = await readFile(path.join(skillsRoot, channelLock.manifest_path));
      const manifest = JSON.parse(raw.toString("utf8"));
      expect(() => validateBundleManifest(manifest, raw, lock, channel)).not.toThrow();
      expect(() => validateBundleManifest(manifest, Buffer.from(JSON.stringify(manifest)), lock, channel)).toThrow("immutable lock");
    }
  });

  it("keeps default resources empty and maps exact demo/release overlays", async () => {
    await syncDesktopSkillResources({ channel: "desktop-release" });
    await expect(checkDesktopSkillReleaseBoundary()).resolves.toBeUndefined();
    expect(includesSkillBundle({ "../.local/skill-packages-desktop-release": "skill-packages" })).toBe(true);
    const releaseManifest = JSON.parse(await readFile(path.join(skillsRoot, lock.channels["desktop-release"].manifest_path), "utf8"));
    expect(() => assertDesktopReleaseManifest(releaseManifest, lock)).not.toThrow();
    const localManifest = JSON.parse(await readFile(path.join(skillsRoot, lock.channels["local-development"].manifest_path), "utf8"));
    expect(() => assertDesktopReleaseManifest(localManifest, lock)).toThrow("exact 38-item");
  });

  it("makes the reviewed release overlay non-overridable", async () => {
    expect(releaseBuildEnvironment({
      VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED: "false",
      VITE_YIJIE_SKILL_MARKETPLACE_UI_ENABLED: "false",
      YIJIE_FEAT134_STREAMING_ENABLED: "true",
      VITE_YIJIE_FEAT134_STREAMING_ENABLED: "true",
    })).toEqual({
      VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED: "true",
      VITE_YIJIE_SKILL_MARKETPLACE_UI_ENABLED: "true",
    });
    await expect(runDefaultTauriBuild(["--config", "src-tauri/tauri.demo-fast.conf.json"]))
      .rejects.toThrow("reviewed desktop-release overlay is mandatory");
    await expect(runDefaultTauriBuild(["-csrc-tauri/tauri.demo-fast.conf.json"]))
      .rejects.toThrow("reviewed desktop-release overlay is mandatory");
    await expect(runDefaultTauriBuild([], { ...process.env, TAURI_CONFIG: "{}" }))
      .rejects.toThrow("reviewed desktop-release overlay is mandatory");
  });

  it("builds demo_fast with its exact compile-time profile and local channel", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
    const command = packageJson.scripts["tauri:build:demo-fast"];
    expect(command).toContain("skills:sync:local");
    expect(command).toContain("VITE_YIJIE_ENV=local");
    expect(command).toContain("VITE_YIJIE_LOCAL_PROFILE=demo_fast");
    expect(command).toContain("VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED=false");
    expect(command).toContain("env -u YIJIE_FEAT134_STREAMING_ENABLED");
    expect(command).toContain("-u VITE_YIJIE_FEAT134_STREAMING_ENABLED");
    expect(command).not.toContain("VITE_YIJIE_FEAT134_STREAMING_ENABLED=true");
    expect(command).toContain("--config src-tauri/tauri.demo-fast.conf.json");
    const runner = await readFile(path.join(repositoryRoot, "scripts/run-local-demo-fast.sh"), "utf8");
    expect(runner).toContain(
      'YIJIE_DESKTOP_CONTRACTS_DIR="$workspace_root/yijie-contracts"',
    );
    expect(runner).toContain('YIJIE_DESKTOP_AGENT_HOST_DIR="$host_root"');
    expect(runner).toContain(
      'YIJIE_DESKTOP_SKILLS_DIR="$workspace_root/yijie-skills"',
    );
    expect(runner.indexOf("pnpm skills:sync:local")).toBeLessThan(
      runner.indexOf("go build -trimpath"),
    );
    expect(runner.indexOf("node scripts/check-agent-host-v4-contract.mjs")).toBeLessThan(
      runner.indexOf("pnpm skills:sync:local"),
    );
  });
});
