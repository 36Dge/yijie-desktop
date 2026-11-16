import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { marketCallSurfaceMode } from "./check-market-call-surfaces.mjs";

const fixedLocal = { YIJIE_ENV: "local", YIJIE_LOCAL_PROFILE: "demo_fast", YIJIE_DEVELOPMENT_CLIENT: "true", YIJIE_KIMI_K31_PRO_CANDIDATE: "true" };
const immutable = () => Array.from({ length: 6 }, () => ({ source_commit: "64ed36dfb2c4df7645d969e0eaf1b3f3bb0a50c4" }));
const local = () => Array.from({ length: 6 }, () => ({ local_candidate: "market-p1", mode: "local_worktree_candidate", release: false, worktree_head: "a".repeat(40) }));

test("keeps immutable mode and accepts a complete unpublished fixed-client candidate", () => {
  assert.equal(marketCallSurfaceMode(immutable(), {}), "immutable");
  assert.equal(marketCallSurfaceMode(local(), fixedLocal), "local-market");
});
test("requires the fixed local profile and consistent source modes", () => {
  for (const [key, value] of Object.entries({ YIJIE_ENV: "production", YIJIE_LOCAL_PROFILE: "production_hardened", YIJIE_DEVELOPMENT_CLIENT: "false", YIJIE_KIMI_K31_PRO_CANDIDATE: "false" })) {
    assert.throws(() => marketCallSurfaceMode(local(), { ...fixedLocal, [key]: value }), /fixed local development client/u);
  }
  const mixed = local(); mixed[3] = immutable()[3];
  assert.throws(() => marketCallSurfaceMode(mixed, fixedLocal), /Mixed or unknown/u);
  assert.throws(() => marketCallSurfaceMode(local().slice(1), fixedLocal), /Both consumer/u);
});
test("does not relabel a release or immutable source as a local candidate", () => {
  const published = local(); published[0].release = true;
  assert.throws(() => marketCallSurfaceMode(published, fixedLocal));
  const ambiguous = local(); ambiguous[0].source_commit = immutable()[0].source_commit;
  assert.throws(() => marketCallSurfaceMode(ambiguous, fixedLocal), /cannot claim/u);
  const incomplete = local(); delete incomplete[0].worktree_head;
  assert.throws(() => marketCallSurfaceMode(incomplete, fixedLocal));
});
test("normal preflight and Kimi build route through the same read-only checker", () => {
  const launcher = readFileSync(new URL("./run-local-demo-fast.sh", import.meta.url), "utf8");
  const build = readFileSync(new URL("./kimi-k31-build-candidate.mjs", import.meta.url), "utf8");
  assert.equal(launcher.split('node "$desktop_root/scripts/check-market-call-surfaces.mjs" --check').length - 1, 2);
  assert(!launcher.includes("scripts/sync-model-call-surfaces-v2.mjs"));
  assert.match(build, /verifyMarketCallSurfaces\(desktopRoot,contractsRoot,/u);
  assert(!build.includes("scripts/sync-model-call-surfaces-v2.mjs"));
});
