// Retained expert resources keep their original immutable source authority.
// User edits in the sibling checkout are never hidden, reset or committed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function identity(desktop) {
  const pin = JSON.parse(readFileSync(path.join(desktop, "contracts/experts-assets-feat164.candidate.json")));
  assert.equal(pin.source.revision_kind, "git-commit");
  assert.equal(pin.source.repository, "https://github.com/36Dge/yijie-skills.git");
  assert.match(pin.source.revision, /^[a-f0-9]{40}$/);
  return { revision: pin.source.revision, directory: path.join(desktop, ".local/native-tools/expert-source", pin.source.revision) };
}

export function nativeToolsExpertSource(desktop) {
  const { revision, directory } = identity(desktop);
  assert(existsSync(directory), "Prepare the retained FEAT-169 expert source before startup");
  assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  const git = args => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
  assert.equal(git(["rev-parse", "HEAD"]), revision);
  assert.equal(git(["status", "--porcelain", "--untracked-files=normal"]), "", "Retained expert source changed");
  return directory;
}

function regularTree(directory) {
  assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name), info = lstatSync(file);
    assert(!info.isSymbolicLink(), "Resource source contains an alias");
    if (info.isDirectory()) regularTree(file);
    else assert(info.isFile(), "Resource source contains a non-file");
  }
}

function prepare(desktop) {
  const { revision, directory } = identity(desktop);
  const source = path.resolve(desktop, "../yijie-skills");
  assert.equal(execFileSync("git", ["-C", source, "remote", "get-url", "origin"], { encoding: "utf8" }).trim(), "https://github.com/36Dge/yijie-skills.git");
  if (!existsSync(directory)) {
    mkdirSync(path.dirname(directory), { recursive: true });
    execFileSync("git", ["-C", source, "worktree", "add", "--detach", directory, revision], { stdio: "pipe" });
  }
  nativeToolsExpertSource(desktop);
  const relative = "dist/skills-experts-feat164-s4";
  const output = path.join(directory, relative);
  if (!existsSync(output)) {
    const original = path.join(source, relative);
    regularTree(original);
    mkdirSync(path.dirname(output), { recursive: true });
    const stage = output + ".pending";
    assert(!existsSync(stage), "Retained resource copy is unfinished; preserve and inspect it");
    cpSync(original, stage, { recursive: true, errorOnExist: true, force: false });
    renameSync(stage, output);
  }
  // The existing synchronizer still validates every manifest, authority and
  // archive digest before any resource is installed or used by the client.
  return nativeToolsExpertSource(desktop);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--prepare"]);
  const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  prepare(desktop);
  console.log("Retained expert source prepared; original checkout and resource pins preserved.");
}
