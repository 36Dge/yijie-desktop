import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FEAT131_REPLAY_BUNDLE_CANARIES = Object.freeze([
  "feat131-desktop-replay-v1",
  "feat131-desktop-replay-v2",
  "referenceAppVersion",
  "referenceAppBuild",
  "codex-inspired-approximate-parity-v1-2026-08-27",
  "feat131-replay-harness-test-only",
  "GS-001-streaming-complete.synthetic.json",
  "GS-012-resync-recovery.synthetic.json",
  "GS-013-sequence-gap.synthetic.json",
]);

export function validateFeat131ReplayBundleEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("FEAT-131 bundle boundary found no production files");
  }
  for (const entry of entries) {
    if (
      typeof entry?.relativePath !== "string" ||
      !(entry.bytes instanceof Uint8Array)
    ) {
      throw new Error("FEAT-131 bundle boundary received an invalid file entry");
    }
    const source = Buffer.from(entry.bytes).toString("utf8");
    const canary = FEAT131_REPLAY_BUNDLE_CANARIES.find((candidate) => source.includes(candidate));
    if (canary) {
      throw new Error(`FEAT-131 test-only replay canary entered production bundle: ${entry.relativePath}`);
    }
  }
}

async function collectFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...await collectFiles(root, entryPath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`FEAT-131 bundle boundary rejects non-regular entry: ${path.relative(root, entryPath)}`);
    }
    collected.push({
      relativePath: path.relative(root, entryPath),
      bytes: await readFile(entryPath),
    });
  }
  return collected;
}

export async function checkFeat131ReplayBoundary(root) {
  const resolvedRoot = path.resolve(root);
  const entries = await collectFiles(resolvedRoot);
  validateFeat131ReplayBundleEntries(entries);
  return Object.freeze({ files: entries.length });
}

function distArgument(arguments_) {
  const index = arguments_.indexOf("--dist");
  if (index < 0 || !arguments_[index + 1] || arguments_[index + 2]) {
    throw new Error("usage: check-feat131-replay-boundary.mjs --dist <dist>");
  }
  return arguments_[index + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkFeat131ReplayBoundary(distArgument(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ check: "FEAT-131-replay-boundary", status: "passed", ...result })}\n`);
}
