import fs from "node:fs";
import { execFileSync } from "node:child_process";
import Ajv from "ajv/dist/2020.js";
import { expect, it } from "vitest";
const source = JSON.parse(fs.readFileSync(new URL("../src-tauri/schemas/chat-document-preview-v1.schema.json", import.meta.url)));
const fixtures = JSON.parse(fs.readFileSync(new URL("../src-tauri/schemas/fixtures/chat-document-preview-v1.json", import.meta.url)));
it("keeps generated Desktop types synchronized with the canonical Native schema", () => {
  execFileSync(process.execPath,[new URL("generate-document-preview.mjs",import.meta.url).pathname,"--check"]);
});
it("accepts the same normal requests as the Rust conformance test", () => {
  const ajv=new Ajv({strict:false,validateFormats:false});
  const validate=ajv.compile({ ...source, $ref:"#/definitions/Request" });
  for (const request of fixtures.requests) expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
});
