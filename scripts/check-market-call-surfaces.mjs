// Read-only bridge from the fixed development entry to canonical Contracts checks.
// Local source provenance is explicit; it is never an immutable/release approval.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const families = ["market-selection", "market-host", "experts"];
const immutableCommit = "64ed36dfb2c4df7645d969e0eaf1b3f3bb0a50c4";

export function marketCallSurfaceMode(candidates, env) {
  assert.equal(candidates.length, families.length * 2, "Both consumer source closures are required");
  const local = candidates.some(candidate => Object.hasOwn(candidate, "local_candidate"));
  if (!local) {
    for (const candidate of candidates) assert.equal(candidate.source_commit, immutableCommit);
    return "immutable";
  }
  assert(env.YIJIE_ENV === "local" && env.YIJIE_LOCAL_PROFILE === "demo_fast"
    && env.YIJIE_DEVELOPMENT_CLIENT === "true" && env.YIJIE_KIMI_K31_PRO_CANDIDATE === "true",
  "Unpublished market sources require the fixed local development client");
  for (const candidate of candidates) {
    assert.equal(candidate.local_candidate, "market-p1", "Mixed or unknown call-surface candidate");
    assert.equal(candidate.mode, "local_worktree_candidate");
    assert.equal(candidate.release, false);
    assert(!Object.hasOwn(candidate, "source_commit"), "A local candidate cannot claim an immutable commit");
    assert.match(candidate.worktree_head ?? "", /^[a-f0-9]{40}$/u);
  }
  return "local-market";
}

export function verifyMarketCallSurfaces(desktopRoot, contractsRoot, hostRoot, env = process.env) {
  // The canonical sync script resolves these same sibling consumers.
  assert.equal(path.resolve(desktopRoot), path.resolve(contractsRoot, "../yijie-desktop"));
  assert.equal(path.resolve(hostRoot), path.resolve(contractsRoot, "../yijie-agent-host"));
  const candidates = [[desktopRoot, "contracts"], [hostRoot, "api"]].flatMap(([root, directory]) =>
    families.map(family => JSON.parse(readFileSync(path.join(root, directory, `${family}-v2.candidate.json`), "utf8"))));
  const mode = marketCallSurfaceMode(candidates, env);
  for (const consumer of ["desktop", "agent-host"]) {
    execFileSync(process.execPath, ["scripts/sync-model-call-surfaces-v2.mjs", `--consumer=${consumer}`,
      ...(mode === "local-market" ? ["--local-market-candidate"] : []), "--check"],
    { cwd: contractsRoot, stdio: "pipe" });
  }
  return mode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--check"]);
  const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const mode = verifyMarketCallSurfaces(desktop, path.resolve(desktop, "../yijie-contracts"), path.resolve(desktop, "../yijie-agent-host"));
  console.log(`Market call surfaces verified: ${mode}; sources and both consumers checked; no service started.`);
}
