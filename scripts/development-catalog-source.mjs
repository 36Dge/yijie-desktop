// Like retained expert resources, development reads the already-qualified
// catalog from its exact commit without resetting the active sibling checkout.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

export function developmentCatalogSource(desktopRoot, connectorsRoot, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert.equal(git(connectorsRoot, "rev-parse", "--verify", `${revision}^{commit}`), revision);
  if (git(connectorsRoot, "rev-parse", "HEAD") === revision) return connectorsRoot;
  const directory = path.join(desktopRoot, ".local/development/catalog-source", revision);
  if (!existsSync(directory)) {
    mkdirSync(path.dirname(directory), { recursive: true });
    git(connectorsRoot, "worktree", "add", "--detach", directory, revision);
  }
  assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  assert.equal(git(directory, "rev-parse", "HEAD"), revision, "Retained catalog revision differs");
  assert.equal(git(directory, "status", "--porcelain", "--untracked-files=normal"), "", "Retained catalog source changed");
  return directory;
}
