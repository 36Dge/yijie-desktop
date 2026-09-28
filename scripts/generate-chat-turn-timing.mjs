import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const source = read("src-tauri/schemas/chat-turn-timing-v1.schema.json");
const native = read("contracts/native-turn-timing.schema.json");
const pin = read("contracts/native-turn-timing.candidate.json");
for (const [file, artifact] of [
  ["contracts/native-turn-timing.schema.json", "sdks/jsonschema/native-turn-timing.schema.json"],
  ["src-tauri/src/chat/schedules/timing_generated.rs", "sdks/rust/native-turn-timing/types.gen.rs"],
]) {
  const hash = createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
  if (hash !== pin.generated.find(entry => entry.path === artifact)?.sha256) {
    throw Error(`Pinned native timing artifact drift: ${file}`);
  }
}
const require = createRequire(path.join(root, "../yijie-contracts/package.json"));
const { compile } = require("json-schema-to-typescript");
const Ajv = require("ajv/dist/2020").default;
const standalone = require("ajv/dist/standalone").default;
const defs = { ...native.$defs, ...source.$defs };
const schema = { ...source.$defs.TurnTimingView, $defs: defs };
const ts = await compile(structuredClone(schema), "TurnTimingView", {
  bannerComment: "/* Generated from private IPC and pinned native timing schemas. Do not edit. */",
});
const ajv = new Ajv({ strict: false, code: { source: true, esm: true }, formats: { uuid: true, int64: true } });
ajv.addSchema(schema, "turn-timing");
const validator = "/* Generated from timing schemas by AJV. Do not edit. */\n" +
  standalone(ajv, { validateTurnTimingView: "turn-timing" });
const rustType = value => {
  if (value.$ref === "#/$defs/CanonicalID") return "uuid::Uuid";
  if (JSON.stringify(value) === JSON.stringify({ anyOf: [{ $ref: "#/$defs/NativeTurnTiming" }, { type: "null" }] })) {
    return "Option<super::schedules::timing_generated::NativeTurnTiming>";
  }
  throw Error("Review changed timing leaf before generation");
};
const rust = Object.entries(source.$defs).map(([name, definition]) => {
  if (definition.additionalProperties !== false || definition.required.length !== Object.keys(definition.properties).length) {
    throw Error("Timing wrapper must be closed with required fields");
  }
  return `#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ${name} {
${Object.entries(definition.properties).map(([key, value]) => `pub ${key.replace(/[A-Z]/g, c => "_" + c.toLowerCase())}: ${rustType(value)},`).join("\n")}
}`;
}).join("\n");
const formatted = spawnSync("rustfmt", ["--edition", "2021"], {
  input: "// Generated from chat-turn-timing-v1.schema.json. Do not edit.\n" + rust, encoding: "utf8",
});
if (formatted.status !== 0) throw Error(formatted.stderr);
for (const [file, content] of Object.entries({
  "src/api/generated/chat-turn-timing.gen.ts": ts,
  "src/api/generated/chat-turn-timing-validator.gen.js": validator,
  "src/api/generated/chat-turn-timing-validator.gen.d.ts": 'import type { TurnTimingView } from "./chat-turn-timing.gen";\nexport declare function validateTurnTimingView(value: unknown): value is TurnTimingView;\n',
  "src-tauri/src/chat/turn_timing_generated.rs": formatted.stdout,
})) {
  const target = path.join(root, file);
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== content) throw Error(`Turn timing generation drift: ${file}`);
  } else writeFileSync(target, content);
}
