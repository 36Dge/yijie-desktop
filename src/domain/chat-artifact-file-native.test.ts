import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_FILE_NATIVE_COMMAND_NAMES,
  ARTIFACT_FILE_NATIVE_ERROR_CODES,
  artifactFileNativeRequest,
  parseArtifactFilePreviewResponse,
  parseArtifactFileSaveResponse,
} from "./chat-artifact-file-native";

const REQUEST_ID = "019c1a00-0000-7000-8000-0000000000a1";
const CONTEXT_ID = "019c1a00-0000-7000-8000-0000000000a2";
const IDENTITY = Object.freeze({
  sessionId: "019c1a00-0000-7000-8000-0000000000a3",
  turnId: "019c1a00-0000-7000-8000-0000000000a4",
  artifactId: "019c1a00-0000-7000-8000-0000000000a5",
});

const schema = JSON.parse(readFileSync(
  new URL("../../src-tauri/schemas/chat-artifact-file-native-v1.schema.json", import.meta.url),
  "utf8",
)) as Readonly<{ $id: string; [key: string]: unknown }>;
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const keyword of [
  "x-yijie-schema-version",
  "x-yijie-command-names",
  "x-yijie-command-contracts",
  "x-yijie-error-codes",
  "x-yijie-preview-limits",
  "x-yijie-save-limits",
]) ajv.addKeyword(keyword);
ajv.addSchema(schema);

function validator(definition: string): ValidateFunction {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`Missing file native definition: ${definition}`);
  return validate;
}

describe("private Artifact file native boundary", () => {
  it("keeps exactly two identity-only commands", () => {
    expect(schema["x-yijie-command-names"]).toEqual(ARTIFACT_FILE_NATIVE_COMMAND_NAMES);
    expect(schema["x-yijie-error-codes"]).toEqual(ARTIFACT_FILE_NATIVE_ERROR_CODES);
    expect(ARTIFACT_FILE_NATIVE_COMMAND_NAMES).toEqual([
      "chat_read_artifact_file_preview_v1",
      "chat_save_artifact_file_v1",
    ]);
    const request = artifactFileNativeRequest(CONTEXT_ID, IDENTITY, REQUEST_ID);
    for (const definition of ["previewRequest", "saveRequest"]) {
      const validate = validator(definition);
      expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
      for (const [field, value] of [
        ["bytes", [1, 2, 3]],
        ["base64", "YWxwaGE="],
        ["digest", "a".repeat(64)],
        ["hostHref", "/v3/artifacts/content"],
        ["path", "/private/file.csv"],
        ["filename", "file.csv"],
        ["token", "secret"],
      ] as const) {
        const leaked = structuredClone(request) as { payload: Record<string, unknown> };
        leaked.payload[field] = value;
        expect(validate(leaked), field).toBe(false);
      }
    }
  });

  it("parses only bounded closed preview projections", () => {
    expect(parseArtifactFilePreviewResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "previewed", mediaType: "text/plain", text: "alpha", truncated: false },
    })).toEqual({ status: "previewed", mediaType: "text/plain", text: "alpha", truncated: false });
    expect(parseArtifactFilePreviewResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "previewed", mediaType: "text/csv", rows: [["quarter", "total"]], truncated: true },
    })).toEqual({
      status: "previewed",
      mediaType: "text/csv",
      rows: [["quarter", "total"]],
      truncated: true,
    });

    for (const data of [
      { status: "previewed", mediaType: "text/markdown", text: "# title", truncated: false },
      { status: "previewed", mediaType: "text/plain", text: "alpha", truncated: false, path: "/tmp/a" },
      { status: "previewed", mediaType: "text/csv", rows: [["x"]], truncated: false, digest: "a".repeat(64) },
      { status: "previewed", mediaType: "text/csv", rows: [[1]], truncated: false },
      { status: "previewed", mediaType: "text/plain", text: "x".repeat(8_193), truncated: true },
      { status: "previewed", mediaType: "text/csv", rows: [["x".repeat(4_097)]], truncated: true },
    ]) {
      expect(() => parseArtifactFilePreviewResponse({ schemaVersion: 1, requestId: REQUEST_ID, data }))
        .toThrow();
    }
  });

  it("keeps save outcomes content-free", () => {
    expect(parseArtifactFileSaveResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "cancelled", code: null },
    })).toEqual({ status: "cancelled", code: null });
    for (const data of [
      { status: "saved", code: null, path: "/private/file.csv" },
      { status: "saved", code: null, filename: "file.csv" },
      { status: "saved", code: null, digest: "a".repeat(64) },
    ]) {
      expect(() => parseArtifactFileSaveResponse({ schemaVersion: 1, requestId: REQUEST_ID, data }))
        .toThrow();
    }
  });
});
