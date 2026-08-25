import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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
import { runDefaultTauriBuild } from "./run-tauri-build.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const skillsRoot = path.resolve(repositoryRoot, "../yijie-skills");
const lock = JSON.parse(
  await readFile(path.join(repositoryRoot, "contracts/desktop-skill-bundle-local.lock.json"), "utf8"),
);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("Desktop local Skill resources", () => {
  it("accepts only the exact local + demo_fast reviewed resource lock", () => {
    expect(validateResourceLock(structuredClone(lock))).toEqual(lock);
    expect(sha256("desktop-skill-resource")).toBe(
      "aca5e27e70d01f04ba9a365071b4f755475d2c931165597d4f76e3c24340eac6",
    );
    expect(() => safeRelativePath("../skill.zip")).toThrow();
    expect(() =>
      validateResourceLock({
        ...lock,
        bundle: { ...lock.bundle, distribution_channel: "desktop-release" },
      }),
    ).toThrow();
  });

  it("validates and atomically synchronizes exact manifest and archive bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yijie-desktop-skills-"));
    temporaryDirectories.push(root);
    const outputRoot = path.join(root, "skill-packages");
    const first = await syncDesktopSkillResources({
      skillsRoot,
      outputRoot,
      packageProducer: false,
    });
    expect(first.manifest.distribution_channel).toBe("local-development");
    expect(first.manifest.skills.map(({ id }) => id)).toEqual([
      "yijie.content-marketing.copywriting",
    ]);
    await expect(
      syncDesktopSkillResources({
        skillsRoot,
        outputRoot,
        check: true,
        packageProducer: false,
      }),
    ).resolves.toBeDefined();

    await writeFile(path.join(outputRoot, "bundle-manifest.json"), "{}\n");
    await expect(
      syncDesktopSkillResources({
        skillsRoot,
        outputRoot,
        check: true,
        packageProducer: false,
      }),
    ).rejects.toThrow("differs from the reviewed producer bytes");

    await expect(
      syncDesktopSkillResources({
        skillsRoot,
        outputRoot,
        packageProducer: false,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects manifest-byte drift even when parsed fields look equivalent", async () => {
    const raw = await readFile(path.join(skillsRoot, lock.bundle.manifest_path));
    const manifest = JSON.parse(raw.toString("utf8"));
    expect(() => validateBundleManifest(manifest, raw, lock)).not.toThrow();
    const reformatted = Buffer.from(JSON.stringify(manifest));
    expect(() => validateBundleManifest(manifest, reformatted, lock)).toThrow(
      "reviewed local-development lock",
    );
  });

  it("keeps local-development out of default and override release builds", async () => {
    await expect(checkDesktopSkillReleaseBoundary()).resolves.toBeUndefined();
    expect(includesSkillBundle({ "../.local/skill-packages": "skill-packages" })).toBe(true);
    const localManifest = JSON.parse(
      await readFile(path.join(skillsRoot, lock.bundle.manifest_path), "utf8"),
    );
    expect(() => assertDesktopReleaseManifest(localManifest)).toThrow(
      "desktop-distribution authorization",
    );
    const releaseManifest = structuredClone(localManifest);
    releaseManifest.distribution_channel = "desktop-release";
    releaseManifest.source.revision_kind = "git-commit";
    for (const skill of releaseManifest.skills) {
      skill.license.authorization_scope = "desktop-distribution";
    }
    expect(() => assertDesktopReleaseManifest(releaseManifest)).not.toThrow();
    await expect(
      runDefaultTauriBuild(["--config", "src-tauri/tauri.demo-fast.conf.json"]),
    ).rejects.toThrow("rejects CLI and TAURI_CONFIG overrides");
    await expect(
      runDefaultTauriBuild(["-csrc-tauri/tauri.demo-fast.conf.json"]),
    ).rejects.toThrow("rejects CLI and TAURI_CONFIG overrides");
    await expect(
      runDefaultTauriBuild([], { ...process.env, TAURI_CONFIG: "{}" }),
    ).rejects.toThrow("rejects CLI and TAURI_CONFIG overrides");
  });

  it("builds the demo-fast bundle with the exact compile-time UI profile", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    );
    const command = packageJson.scripts["tauri:build:demo-fast"];
    expect(command).toContain("VITE_YIJIE_ENV=local");
    expect(command).toContain("VITE_YIJIE_LOCAL_PROFILE=demo_fast");
    expect(command).toContain("VITE_YIJIE_CHAT_LOCAL_UI_ENABLED=true");
    expect(command).toContain("VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED=true");
    expect(command).toContain("VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED=false");
    expect(command).toContain("--config src-tauri/tauri.demo-fast.conf.json");
  });
});
