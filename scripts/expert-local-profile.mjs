// Desktop-owned deployment configuration, not a content authority or wire API.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function expertLocalProfile(key, root = desktopRoot) {
  const source = JSON.parse(await readFile(path.join(root, "src-tauri/experts-local-profiles.json"), "utf8"));
  assert.equal(source.schema_version, 1);
  assert.deepEqual(source.profiles.map(profile => profile.key), ["daily", "default", "content-v011", "content-v012", "content-v013"]);
  assert.equal(new Set(source.profiles.map(profile => profile.identifier)).size, source.profiles.length);
  assert.equal(new Set(source.profiles.map(profile => profile.runtimeDirectory)).size, source.profiles.length);
  assert.equal(new Set(source.profiles.map(profile => profile.hostPort)).size, source.profiles.length);
  const selected = source.profiles.find(profile => profile.key === key);
  assert.ok(selected, "Unsupported expert local profile");
  if (key === "daily") {
    assert.equal(selected.identifier, "com.yijie.ai");
    assert.equal(selected.productName, "易界 AI");
    assert.equal(selected.runtimeDirectory, "demo-fast");
    assert.equal(selected.hostPort, 18081);
    assert.equal(selected.overlay, "tauri.experts-daily.conf.json");
    const daily = JSON.parse(await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
    assert.equal(selected.identifier, daily.identifier);
    assert.equal(selected.productName, daily.productName);
  } else {
    assert.match(selected.identifier, /^com\.yijie\.ai\.feat158-[a-z0-9-]+$/);
    assert.match(selected.runtimeDirectory, /^feat158-[a-z0-9-]+$/);
    assert.ok(Number.isInteger(selected.hostPort) && selected.hostPort >= 18158 && selected.hostPort <= 18161);
  }
  assert.match(selected.overlay, /^tauri\.experts-[a-z0-9-]+\.conf\.json$/);
  assert.ok(!/[\r\n\t/]/u.test(selected.productName));
  const overlay = JSON.parse(await readFile(path.join(root, "src-tauri", selected.overlay), "utf8"));
  assert.deepEqual(overlay, {
    $schema: "https://schema.tauri.app/config/2",
    productName: selected.productName,
    identifier: selected.identifier,
    bundle: { resources: { "../.local/skill-packages-experts": "skill-packages-experts" } },
  }, "Expert overlay must be an exact projection of the reviewed profile");
  return selected;
}

export function expertHostBinary(profile, root = desktopRoot) {
  return profile.key === "daily"
    ? path.resolve(root, "../yijie-agent-host/.local/bin/yijie-agent-host")
    : path.join(root, ".local", profile.runtimeDirectory, "bin/yijie-agent-host");
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  assert.equal(process.argv.length, 3, "Expected one supported expert profile key");
  const profile = await expertLocalProfile(process.argv[2]);
  process.stdout.write([`src-tauri/${profile.overlay}`, profile.runtimeDirectory, profile.hostPort, profile.productName, profile.identifier, expertHostBinary(profile)].join("\t") + "\n");
}
