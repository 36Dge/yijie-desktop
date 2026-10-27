import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syncDesktopExpertResources, verifyExpertProvenanceOnly } from "./sync-desktop-expert-resources.mjs";

const source = new URL("../../yijie-skills/dist/skills-experts-thirteen-overall-v013/", import.meta.url);
function bundle() {
  const manifest = JSON.parse(readFileSync(new URL("bundle-manifest.json", source)));
  const authority = JSON.parse(readFileSync(new URL("authority.json", source)));
  return { manifest, authority, files: manifest.skills.map(skill => ({ relativePath: skill.archive.path, bytes: Buffer.from(`ordinary archive ${skill.id}`) })) };
}

test("local provenance refresh accepts only producer revision and Contracts evidence changes", () => {
  const previous = bundle(), next = bundle();
  next.manifest.source.revision = "1111111111111111111111111111111111111111";
  next.authority.source = { ...next.manifest.source };
  next.authority.manifest_sha256 = "2".repeat(64);
  next.authority.contracts_candidate.sha256 = "3".repeat(64);
  verifyExpertProvenanceOnly(previous, next);
});

test("provenance refresh preserves every resource metadata record including the newest version", () => {
  const previous = bundle(), next = bundle();
  assert.equal(previous.manifest.skills.length, 75);
  next.manifest.skills.at(-1).description = "A different ordinary description";
  assert.throws(() => verifyExpertProvenanceOnly(previous, next), /metadata or resources changed/);
});

test("provenance refresh preserves reviewed authorization and every archive byte", () => {
  const previous = bundle(), changedReview = bundle(), changedArchive = bundle();
  changedReview.authority.experts.at(-1).content_review.sha256 = "4".repeat(64);
  assert.throws(() => verifyExpertProvenanceOnly(previous, changedReview), /authorization or review changed/);
  changedArchive.files.at(-1).bytes = Buffer.from("A different ordinary archive");
  assert.throws(() => verifyExpertProvenanceOnly(previous, changedArchive), /archive bytes changed/);
});

test("provenance refresh is local only and cannot turn a check into a mutation", async () => {
  await assert.rejects(syncDesktopExpertResources({ refreshProvenance: true, environment: {} }), /explicit local/);
  await assert.rejects(syncDesktopExpertResources({ refreshProvenance: true, check: true, environment: { YIJIE_ENV: "local", YIJIE_LOCAL_PROFILE: "demo_fast" } }), /cannot be combined/);
});


test("a previous local candidate is only accepted as a paired refresh input", async () => {
  const environment = { YIJIE_ENV: "local", YIJIE_LOCAL_PROFILE: "demo_fast" };
  await assert.rejects(syncDesktopExpertResources({ refreshProvenance: true, previousSourceLock: "ordinary-prior-lock.json", environment }), /explicit pair/);
  await assert.rejects(syncDesktopExpertResources({ previousSourceLock: "ordinary-prior-lock.json", previousSkillsCandidate: "ordinary-prior-candidate.json", environment }), /explicit pair/);
});
