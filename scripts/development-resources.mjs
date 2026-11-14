// tauri-build 2.6 derives resource output from OUT_DIR, which is the shared
// intermediate cache with Cargo's separate build-dir. Native resolves resources
// beside the actual executable. Stage only pinned resource bytes there; never
// copy executables, change the native resolver, or substitute an unverified root.
import assert from "node:assert/strict";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { installOutput, readRegularFile, safeRelativePath, sha256, verifyOutput } from "./sync-desktop-skill-resources.mjs";

export async function stageBundleResources(source, destination, manifestDigest, authorityDigest) {
  assert.equal(await realpath(source), source, "resource source must be canonical");
  const manifestBytes = await readRegularFile(path.join(source, "bundle-manifest.json"), 1024 * 1024);
  assert.equal(sha256(manifestBytes), manifestDigest, "development manifest differs from its pin");
  const manifest = JSON.parse(manifestBytes);
  const files = [{ relativePath: "bundle-manifest.json", bytes: manifestBytes }];
  if (authorityDigest) {
    const bytes = await readRegularFile(path.join(source, "authority.json"), 256 * 1024);
    assert.equal(sha256(bytes), authorityDigest, "development expert authority differs from its pin");
    files.push({ relativePath: "authority.json", bytes });
  }
  for (const skill of manifest.skills) {
    if (!skill.archive) continue;
    const relativePath = safeRelativePath(skill.archive.path);
    const bytes = await readRegularFile(path.join(source, relativePath), skill.archive.compressed_size_bytes);
    assert.equal(bytes.length, skill.archive.compressed_size_bytes);
    assert.equal(sha256(bytes), skill.archive.sha256, "development archive differs from its manifest");
    files.push({ relativePath, bytes });
  }
  await verifyOutput(source, files);
  const info = await lstat(destination).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
  if (info) {
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), "development resource slot must be a directory");
    try {
      await verifyOutput(destination, files);
      return { files: files.length, changed: false };
    } catch (error) {
      if (error?.code === "EACCES" || error?.code === "EPERM") throw error;
    }
  }
  await installOutput(destination, files);
  await verifyOutput(destination, files);
  return { files: files.length, changed: true };
}

export async function stageNativeSkillResources(source, destination, authority) {
  assert.equal(await realpath(source), source, "native Skill source must be canonical");
  const files=[];
  for (const [name,digest] of Object.entries(authority.files)) {
    const relativePath=safeRelativePath(name);
    const bytes=await readRegularFile(path.join(source,relativePath),64*1024*1024);
    assert.equal(sha256(bytes),digest,"native Skill resource differs from its pin");
    files.push({relativePath,bytes});
  }
  await verifyOutput(source,files);
  try { await verifyOutput(destination,files);return {files:files.length,changed:false}; }
  catch(error) { if(error?.code==="EACCES"||error?.code==="EPERM")throw error; }
  await installOutput(destination,files);await verifyOutput(destination,files);
  return {files:files.length,changed:true};
}

export async function stageDevelopmentResources(root, environment, arguments_) {
  if (environment.YIJIE_DEVELOPMENT_CLIENT !== "true") return;
  assert.equal(await realpath(root), root, "development project must be canonical");
  const target = path.join(root, ".local/development/target");
  assert.equal(environment.CARGO_TARGET_DIR, target, "development target differs from the fixed entry");
  const resources = {};
  for (let i = 0; i < arguments_.length; i++) if (arguments_[i] === "--config") {
    const file = safeRelativePath(arguments_[++i]);
    const config = JSON.parse(await readRegularFile(path.join(root, file), 256 * 1024));
    Object.assign(resources, config.bundle?.resources ?? {});
  }
  const ordinary = JSON.parse(await readRegularFile(path.join(root, "contracts/desktop-skill-bundle-local.lock.json"), 256 * 1024));
  const expert = JSON.parse(await readRegularFile(path.join(root, "contracts/experts-assets-feat164.candidate.json"), 64 * 1024));
  const slots = [
    ["../.local/skill-packages", "skill-packages", ordinary.channels["local-development"].manifest_sha256],
    ["../.local/feat164-kimi-k31/skill-packages-experts", "skill-packages-experts", expert.manifest_sha256, expert.authority_sha256],
  ];
  const nativeSource="../.local/skill-marketplace",nativeSlot="skill-marketplace";
  const includeNative=resources[nativeSource]!==undefined;
  if(environment.YIJIE_FEAT174_NATIVE_SKILLS==="true")assert(includeNative,"native Skill resource slot is required");
  const expected=Object.fromEntries(slots.map(([source,slot])=>[source,slot]));
  if(includeNative)expected[nativeSource]=nativeSlot;
  assert.deepEqual(resources, expected, "development resource configuration changed");
  let directory = root;
  for (const segment of [".local", "development", "target", "debug"]) {
    directory = path.join(directory, segment);
    await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(directory);
    assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.geteuid() && !(info.mode & 0o022), "development resource destination is unsafe");
  }
  for (const [source, slot, manifest, authority] of slots) {
    const result = await stageBundleResources(path.resolve(root, "src-tauri", source), path.join(directory, slot), manifest, authority);
    process.stdout.write(`Development resources verified: ${slot}, ${result.files} files${result.changed ? ", staged" : ", unchanged"}.\n`);
  }
  if(includeNative){
    const authority=JSON.parse(await readRegularFile(path.join(root,"contracts/native-skill-resources.candidate.json"),1024*1024));
    const result=await stageNativeSkillResources(path.resolve(root,"src-tauri",nativeSource),path.join(directory,nativeSlot),authority);
    process.stdout.write(`Development resources verified: ${nativeSlot}, ${result.files} files${result.changed?", staged":", unchanged"}.\n`);
  }
}
