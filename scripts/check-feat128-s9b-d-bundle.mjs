import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FEAT128_S9B_D_BUNDLE_LIMITS = Object.freeze({
  baselineRawBytes: 655_731,
  baselineGzipBytes: 206_580,
  deltaRawBytes: 716_800,
  deltaGzipBytes: 225_280,
  finalRawBytes: 1_372_531,
  finalGzipBytes: 431_860,
});

async function javascriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return javascriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".js") ? [entryPath] : [];
  }));
  return nested.flat().sort();
}

export async function measureJavaScriptBundle(root) {
  const files = await javascriptFiles(root);
  if (files.length === 0) throw new Error("bundle checker found no JavaScript assets");
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const bytes = await readFile(file);
    rawBytes += bytes.byteLength;
    gzipBytes += gzipSync(bytes, { level: 9 }).byteLength;
  }
  return Object.freeze({ rawBytes, gzipBytes, files: files.length });
}

export function validateBundleTotals(totals) {
  const rawDelta = totals.rawBytes - FEAT128_S9B_D_BUNDLE_LIMITS.baselineRawBytes;
  const gzipDelta = totals.gzipBytes - FEAT128_S9B_D_BUNDLE_LIMITS.baselineGzipBytes;
  if (
    totals.rawBytes > FEAT128_S9B_D_BUNDLE_LIMITS.finalRawBytes ||
    rawDelta > FEAT128_S9B_D_BUNDLE_LIMITS.deltaRawBytes
  ) {
    throw new Error(`FEAT-128 S9B-D raw JavaScript budget exceeded: ${totals.rawBytes}`);
  }
  if (
    totals.gzipBytes > FEAT128_S9B_D_BUNDLE_LIMITS.finalGzipBytes ||
    gzipDelta > FEAT128_S9B_D_BUNDLE_LIMITS.deltaGzipBytes
  ) {
    throw new Error(`FEAT-128 S9B-D gzip JavaScript budget exceeded: ${totals.gzipBytes}`);
  }
  return Object.freeze({ ...totals, rawDelta, gzipDelta });
}

function distArgument(arguments_) {
  const index = arguments_.indexOf("--dist");
  if (index < 0 || !arguments_[index + 1] || arguments_[index + 2]) {
    throw new Error("usage: check-feat128-s9b-d-bundle.mjs --dist <dist/assets>");
  }
  return path.resolve(arguments_[index + 1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const totals = validateBundleTotals(await measureJavaScriptBundle(distArgument(process.argv.slice(2))));
  console.log(JSON.stringify({ check: "FEAT-128-S9B-D", status: "passed", ...totals }));
}
