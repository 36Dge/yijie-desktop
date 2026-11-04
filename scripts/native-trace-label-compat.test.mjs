import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import Ajv from "ajv";

// Consume the exact pinned Native6 contract. No new/relaxed schema is defined.
const spec = JSON.parse(readFileSync(new URL("../src-tauri/contracts/native-conversation-v6.json", import.meta.url), "utf8"));
function resolve(value) {
  if (Array.isArray(value)) return value.map(resolve);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "nullable") continue;
    out[key] = key === "$ref" ? item.replace("#/components/schemas/", "#/$defs/") : resolve(item);
  }
  return value.nullable ? {anyOf: [out, {type: "null"}]} : out;
}
const ajv = new Ajv({strict: false, formats: {int32: true, int64: true, uuid: true, "date-time": true}});
const valid = ajv.compile({...resolve(spec.components.schemas.NativeItem), $defs: resolve(spec.components.schemas)});

test("unchanged Native6 accepts rich safe labels and pre-repair saved records without migration", () => {
  const old = {id: "command-1", type: "commandExecution", availability: "available", status: "completed", commandLabel: "执行命令", exitCode: 0};
  const richer = {...old, commandLabel: "python3 --version；tail -n 5 README.md", commandActions: [{index: 0, kind: "unknown", label: "python3 --version"}, {index: 1, kind: "unknown", label: "tail -n 5 README.md"}]};
  const before = JSON.stringify(old);
  assert(valid(old)); assert(valid(richer)); assert.equal(JSON.stringify(old), before);
  for (const provenance of ["nativeAppContext", "registeredTool", "allowedTitle"]) {
    assert(valid({id: "tool", type: "mcpToolCall", availability: "partial", status: "inProgress", toolLabel: "查看公开资料", toolDisplay: {provenance, title: "查看公开资料", sourceLabel: "浏览器"}}));
  }
  assert(!Object.hasOwn(spec.components.schemas.NativeCommandActionDisplay.properties, "status"));
});
