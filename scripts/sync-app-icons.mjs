import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  throw new Error("Usage: node scripts/sync-app-icons.mjs [--check]");
}

// The approved App Icon variant shares the sidebar mark's vector geometry.
// Generate through Tauri so ICNS includes the native macOS Retina size family.
await exec("pnpm", ["--dir", "docs/design", "brand:check"], { cwd: root });
const source = path.join(root, "docs/design/docs/public/brand/yijie-app-icon.svg");
const local = path.join(root, ".local");
await mkdir(local, { recursive: true });
const generated = await mkdtemp(path.join(local, "app-icons-"));
const names = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.icns", "icon.ico"];

function comparableIcon(name, bytes) {
  if (name !== "icon.icns") return bytes;
  // Tauri can emit ICNS representations in a different order on each run.
  // Compare every framed representation, including its mask, independently
  // of order; do not rewrite an already matching native icon container.
  if (bytes.length < 8 || bytes.toString("ascii", 0, 4) !== "icns" || bytes.readUInt32BE(4) !== bytes.length) {
    throw new Error("Invalid ICNS container");
  }
  const entries = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error("Incomplete ICNS representation");
    const length = bytes.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > bytes.length) throw new Error("Invalid ICNS representation size");
    entries.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  return Buffer.concat([bytes.subarray(0, 8), ...entries.sort(Buffer.compare)]);
}

try {
  await exec(process.execPath, [
    path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
    "icon", source, "--output", generated,
  ], { cwd: root });
  for (const name of names) {
    const output = path.join(root, "src-tauri/icons", name);
    const [actual, expected] = await Promise.all([
      readFile(output).catch((error) => {
        if (error.code === "ENOENT" && !check) return null;
        throw error;
      }),
      readFile(path.join(generated, name)),
    ]);
    const matches = actual !== null && comparableIcon(name, actual).equals(comparableIcon(name, expected));
    if (check && !matches) throw new Error(`${name} differs from the approved App Icon; run pnpm icons:sync`);
    if (!check && !matches) {
      await copyFile(path.join(generated, name), output);
    }
  }
  process.stdout.write(`${check ? "Verified" : "Generated"} ${names.length} application icons from the approved YiJie vector.\n`);
} finally {
  await rm(generated, { recursive: true, force: true });
}
