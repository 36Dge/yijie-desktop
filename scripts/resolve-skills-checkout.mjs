import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function readCheckoutHead(root) {
  try { await stat(root); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  return (await exec("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
}

// Select a source only. Every consumer must still verify the exact commit, clean
// working tree, canonical origin, provider locks and pinned bytes before use.
export async function resolveSkillsCheckout({ repositoryRoot, fullCommit, explicitRoot }, readHead = readCheckoutHead) {
  if (explicitRoot !== undefined) return path.resolve(repositoryRoot, explicitRoot);
  const sibling = path.resolve(repositoryRoot, "../yijie-skills");
  const siblingHead = await readHead(sibling);
  if (siblingHead === fullCommit) return sibling;
  const pinned = path.join(repositoryRoot, ".local", `skills-pinned-${fullCommit.slice(0, 7)}`);
  if (await readHead(pinned) === fullCommit) return pinned;
  throw new Error(
    `Skills requires pinned commit ${fullCommit}; sibling HEAD is ${siblingHead ?? "unavailable"}. ` +
    `Prepare a clean checkout of that commit at ${pinned}, or set YIJIE_DESKTOP_SKILLS_DIR to one. ` +
    "The lock and existing checkouts have not been changed.",
  );
}
