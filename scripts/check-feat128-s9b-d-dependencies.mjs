import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_COMMIT = "630c3c8d55a2617499f51bd5bed263b819aaf084";
const EXPECTED = Object.freeze({
  echarts: Object.freeze({
    version: "6.1.0",
    license: "Apache-2.0",
    integrity: "sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==",
  }),
  zrender: Object.freeze({
    version: "6.1.0",
    license: "BSD-3-Clause",
    integrity: "sha512-oEGMDB6pOP2S6OwRR4PdVv610zrjnA3Bh+JnSG12fYJlBKjtNAoEb5fSUoCOOINlH96I2fU38/A2UpRKs67xYQ==",
  }),
  tslib: Object.freeze({
    version: "2.3.0",
    license: "0BSD",
    integrity: "sha512-N82ooyxVNm6h1riLCoyS9e3fuJ3AMG2zIZs2Gd1ATcSFjSA23Q0fzjjZeh0jbJvWVDZ0cJT8yaNNaaXHzueNjg==",
  }),
});
const ADDED_KEYS = Object.freeze(["echarts@6.1.0", "tslib@2.3.0", "zrender@6.1.0"]);
const ALLOWED_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "THIRD_PARTY_NOTICES.md",
  "src/styles/variables.css",
  "src/design/theme/echarts-theme.ts",
  "src/design/theme/echarts-theme.test.ts",
  "src/domain/chat-artifact-report-chart.ts",
  "src/domain/chat-artifact-report-chart.test.ts",
  "src/components/yijie/YjChartCard.vue",
  "src/components/yijie/YjChartCard.test.ts",
  "scripts/check-feat128-s9b-d-dependencies.mjs",
  "scripts/check-feat128-s9b-d-dependencies.test.mjs",
  "scripts/check-feat128-s9b-d-bundle.mjs",
  "scripts/check-feat128-s9b-d-bundle.test.mjs",
]);

export function validateDependencyFacts(facts) {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const actual = facts?.[name];
    if (
      actual?.version !== expected.version ||
      actual?.license !== expected.license ||
      actual?.integrity !== expected.integrity
    ) {
      throw new Error(`${name} dependency identity differs from the FEAT-128 S9B-D decision`);
    }
  }
}

function sectionKeys(source, sectionName) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${sectionName}:`);
  if (start < 0) throw new Error(`pnpm lock is missing ${sectionName}`);
  const keys = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !line.startsWith(" ")) break;
    const match = line.match(/^[ ]{2}(\S[^:]*):(?:\s.*)?$/);
    if (match) keys.push(match[1].replace(/^'|'$/g, ""));
  }
  return keys;
}

function addedKeys(current, baseline, sectionName) {
  const before = new Set(sectionKeys(baseline, sectionName));
  return sectionKeys(current, sectionName).filter((key) => !before.has(key)).sort();
}

function packageBlock(source, key, sectionName) {
  const sectionStart = source.indexOf(`${sectionName}:\n`);
  const start = source.indexOf(`  ${key}:\n`, sectionStart);
  if (start < 0) throw new Error(`pnpm lock is missing ${sectionName} ${key}`);
  const remaining = source.slice(start + 2);
  const next = remaining.slice(1).search(/\n[ ]{2}[^\s].*:\n/);
  return next < 0 ? remaining : remaining.slice(0, next + 1);
}

async function installedMetadata(root, name, version) {
  const packagePath = name === "echarts"
    ? path.join(root, "node_modules", name, "package.json")
    : path.join(root, "node_modules", ".pnpm", `${name}@${version}`, "node_modules", name, "package.json");
  return JSON.parse(await readFile(packagePath, "utf8"));
}

function validateNoInstallLifecycle(metadata, name) {
  for (const script of ["preinstall", "install", "postinstall"]) {
    if (metadata.scripts?.[script]) throw new Error(`${name} has forbidden ${script} lifecycle code`);
  }
}

function validateImports(source) {
  const expected = [
    'import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";',
    'import { BarChart, LineChart, PieChart } from "echarts/charts";',
    'import { init, use } from "echarts/core";',
    'import { CanvasRenderer } from "echarts/renderers";',
  ];
  for (const statement of expected) {
    if (!source.includes(statement)) throw new Error(`missing exact ECharts import: ${statement}`);
  }
  const echartsImports = source.match(/^import .* from "(?:echarts(?:\/[^"]*)?|vue-echarts)";$/gm) ?? [];
  if (echartsImports.length !== expected.length || echartsImports.some((statement) => !expected.includes(statement))) {
    throw new Error("ECharts imports exceed the exact static allowlist");
  }
  if (/\bimport\s*\(|from\s+["']echarts["']|vue-echarts|SVGRenderer|LegendComponent|TitleComponent|DatasetComponent|TransformComponent|DataZoomComponent|ToolboxComponent|GraphicComponent|CustomChart|UniversalTransition/.test(source)) {
    throw new Error("forbidden ECharts module or dynamic/root import found");
  }
}

async function validateScope(root) {
  const [{ stdout: diffOutput }, { stdout: statusOutput }] = await Promise.all([
    exec("git", ["diff", "--name-only", BASELINE_COMMIT, "--"], { cwd: root }),
    exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }),
  ]);
  const changed = new Set(diffOutput.trim().split("\n").filter(Boolean));
  for (const line of statusOutput.split("\n").filter(Boolean)) {
    const file = line.slice(3).replace(/^"|"$/g, "");
    changed.add(file);
  }
  for (const file of changed) {
    if (file.startsWith("tests/visual/feat-128-s9b-d/")) continue;
    if (!ALLOWED_FILES.has(file)) throw new Error(`S9B-D changed a forbidden file: ${file}`);
  }
}

export async function checkFeat128S9bDDependencies(root = repositoryRoot) {
  const [packageSource, lockSource, notice, componentSource, baselineLock] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "pnpm-lock.yaml"), "utf8"),
    readFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8"),
    readFile(path.join(root, "src/components/yijie/YjChartCard.vue"), "utf8"),
    exec("git", ["show", `${BASELINE_COMMIT}:pnpm-lock.yaml`], { cwd: root }).then(({ stdout }) => stdout),
  ]);
  const packageJson = JSON.parse(packageSource);
  if (packageJson.dependencies?.echarts !== "6.1.0" || packageJson.devDependencies?.echarts) {
    throw new Error("package.json must contain exact runtime echarts 6.1.0 only");
  }
  if (!/[ ]{6}echarts:\n[ ]{8}specifier: 6\.1\.0\n[ ]{8}version: 6\.1\.0\n/.test(lockSource)) {
    throw new Error("root lock importer does not pin exact ECharts 6.1.0");
  }
  for (const section of ["packages", "snapshots"]) {
    const added = addedKeys(lockSource, baselineLock, section);
    if (JSON.stringify(added) !== JSON.stringify(ADDED_KEYS)) {
      throw new Error(`unexpected ${section} lock delta: ${added.join(", ")}`);
    }
  }

  const metadata = {};
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const installed = await installedMetadata(root, name, expected.version);
    validateNoInstallLifecycle(installed, name);
    const block = packageBlock(lockSource, `${name}@${expected.version}`, "packages");
    const integrity = block.match(/integrity: ([^}\n]+)/)?.[1];
    metadata[name] = { version: installed.version, license: installed.license, integrity };
  }
  validateDependencyFacts(metadata);

  const echartsSnapshot = packageBlock(lockSource, "echarts@6.1.0", "snapshots");
  const zrenderSnapshot = packageBlock(lockSource, "zrender@6.1.0", "snapshots");
  if (!/[ ]{6}tslib: 2\.3\.0\n[ ]{6}zrender: 6\.1\.0\n/.test(echartsSnapshot) || !/[ ]{6}tslib: 2\.3\.0\n/.test(zrenderSnapshot)) {
    throw new Error("ECharts transitive dependency graph differs from the frozen graph");
  }
  if (!notice.includes("Copyright 2017-2026 The Apache Software Foundation")) {
    throw new Error("Apache ECharts NOTICE attribution is missing");
  }
  for (const expected of Object.values(EXPECTED)) {
    if (!notice.includes(expected.license) || !notice.includes(expected.integrity)) {
      throw new Error("third-party notice is missing an exact license or integrity");
    }
  }
  validateImports(componentSource);
  await validateScope(root);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkFeat128S9bDDependencies();
  console.log("FEAT-128 S9B-D dependency boundary: PASS");
}
