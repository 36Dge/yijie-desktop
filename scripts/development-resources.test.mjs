import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { stageDevelopmentResources } from "./development-resources.mjs";
import { developmentArguments } from "./run-workflow-dev.mjs";
import { sha256 } from "./sync-desktop-skill-resources.mjs";

it("stages pinned ordinary and expert resources beside the executable with a separate Cargo cache, and reuses them on reopen", async () => {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "yijie-development-resources-"));
  const env = {
    YIJIE_DEVELOPMENT_CLIENT: "true", YIJIE_FEAT164_DAILY: "true", YIJIE_KIMI_K31_PRO_CANDIDATE: "true",
    YIJIE_KIMI_K31_CALL_SURFACES: "media", YIJIE_EXPERTS_ENABLED: "true", YIJIE_MARKET_CONNECTORS_ENABLED: "true",
    YIJIE_ARTIFACT_MEDIA_ENABLED: "true", YIJIE_FEAT155_SCHEDULED_DAILY: "true", YIJIE_FEAT155_SCHEDULED_CANDIDATE: "false",
    CARGO_TARGET_DIR: path.join(root, ".local/development/target"), CARGO_BUILD_BUILD_DIR: path.join(root, ".local/cache/desktop"),
  };
  async function file(name, bytes) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes);
  }
  try {
    const resource = Buffer.from("normal resource packaging regression\n");
    const manifest = Buffer.from(JSON.stringify({ skills: [{ archive: { path: "packages/normal.txt", sha256: sha256(resource), compressed_size_bytes: resource.length } }] }));
    const authority = Buffer.from(JSON.stringify({ release: false }));
    for (const folder of [".local/skill-packages", ".local/feat164-kimi-k31/skill-packages-experts"]) {
      await file(`${folder}/bundle-manifest.json`, manifest);
      await file(`${folder}/packages/normal.txt`, resource);
    }
    await file(".local/feat164-kimi-k31/skill-packages-experts/authority.json", authority);
    await file("contracts/desktop-skill-bundle-local.lock.json", JSON.stringify({ channels: { "local-development": { manifest_sha256: sha256(manifest) } } }));
    await file("contracts/experts-assets-feat164.candidate.json", JSON.stringify({ manifest_sha256: sha256(manifest), authority_sha256: sha256(authority) }));
    await file("src-tauri/tauri.demo-fast.conf.json", JSON.stringify({ bundle: { resources: { "../.local/skill-packages": "skill-packages" } } }));
    await file("src-tauri/tauri.feat164-experts.conf.json", JSON.stringify({ bundle: { resources: { "../.local/feat164-kimi-k31/skill-packages-experts": "skill-packages-experts" } } }));
    await file("src-tauri/tauri.workflow-local.conf.json", "{}");
    await stageDevelopmentResources(root, env, developmentArguments(env));
    const target = path.join(env.CARGO_TARGET_DIR, "debug");
    for (const slot of ["skill-packages", "skill-packages-experts"]) {
      expect(await readFile(path.join(target, slot, "bundle-manifest.json"))).toEqual(manifest);
      expect(await readFile(path.join(target, slot, "packages/normal.txt"))).toEqual(resource);
    }
    expect(await readFile(path.join(target, "skill-packages-experts/authority.json"))).toEqual(authority);
    const before = await stat(path.join(target, "skill-packages-experts/authority.json"));
    await stageDevelopmentResources(root, env, developmentArguments(env));
    expect((await stat(path.join(target, "skill-packages-experts/authority.json"))).mtimeMs).toBe(before.mtimeMs);
    expect(await stat(env.CARGO_BUILD_BUILD_DIR).catch(() => null)).toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});
