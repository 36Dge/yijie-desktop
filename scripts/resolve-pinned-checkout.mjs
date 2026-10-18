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

// Select an existing source only. Consumers still verify clean status, canonical
// origin, the complete immutable commit, provider locks and every pinned byte.
// Never prepare a checkout, alter a lock or replace an explicit source here.
async function resolvePinnedCheckout(options, source, readHead) {
  const { repositoryRoot, fullCommit, explicitRoot } = options;
  if (!/^[a-f0-9]{40}$/.test(fullCommit ?? "")) throw new Error("Expected a complete pinned Git commit");
  if (explicitRoot !== undefined) return path.resolve(repositoryRoot, explicitRoot);
  const sibling = path.resolve(repositoryRoot, `../yijie-${source.name}`);
  const siblingHead = await readHead(sibling);
  if (siblingHead === fullCommit) return sibling;
  const pinned = path.join(repositoryRoot, ".local", `${source.name}-pinned-${fullCommit.slice(0, 7)}`);
  if (await readHead(pinned) === fullCommit) return pinned;
  throw new Error(
    `${source.label} requires pinned commit ${fullCommit}; sibling HEAD is ${siblingHead ?? "unavailable"}. ` +
    `Prepare a clean checkout of that commit at ${pinned}, or set ${source.environment} to one. ` +
    "The lock and existing checkouts have not been changed.",
  );
}

export function resolveSkillsCheckout(options, readHead = readCheckoutHead) {
  return resolvePinnedCheckout(options, {
    name: "skills", label: "Skills", environment: "YIJIE_DESKTOP_SKILLS_DIR",
  }, readHead);
}

export function resolveAgentHostCheckout(options, readHead = readCheckoutHead) {
  return resolvePinnedCheckout(options, {
    name: "agent-host", label: "Agent Host", environment: "YIJIE_DESKTOP_AGENT_HOST_DIR",
  }, readHead);
}
