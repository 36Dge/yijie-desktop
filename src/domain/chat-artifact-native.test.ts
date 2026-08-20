import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_NATIVE_COMMAND_NAMES,
  ARTIFACT_NATIVE_ERROR_CODES,
  artifactNativeRequest,
  parseArtifactNativeError,
  parseArtifactPreviewOpenResponse,
  parseArtifactPreviewReleaseResponse,
  parseArtifactSaveResponse,
} from "./chat-artifact-native";

const REQUEST_ID = "019c1a00-0000-7000-8000-000000000061";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000062";
const IDENTITY = Object.freeze({
  sessionId: "019c1a00-0000-7000-8000-000000000063",
  turnId: "019c1a00-0000-7000-8000-000000000064",
  artifactId: "019c1a00-0000-7000-8000-000000000065",
});

const schema = JSON.parse(readFileSync(
  new URL("../../src-tauri/schemas/chat-artifact-native-v1.schema.json", import.meta.url),
  "utf8",
)) as Readonly<{ $id: string; [key: string]: unknown }>;
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const keyword of [
  "x-yijie-schema-version",
  "x-yijie-command-names",
  "x-yijie-command-contracts",
  "x-yijie-error-codes",
  "x-yijie-preview-scheme",
]) ajv.addKeyword(keyword);
ajv.addSchema(schema);

function validator(definition: string): ValidateFunction {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`Missing Artifact native definition: ${definition}`);
  return validate;
}

describe("private Artifact native boundary", () => {
  it("keeps the three commands and stable errors closed", () => {
    expect(schema["x-yijie-command-names"]).toEqual(ARTIFACT_NATIVE_COMMAND_NAMES);
    expect(schema["x-yijie-error-codes"]).toEqual(ARTIFACT_NATIVE_ERROR_CODES);
    expect(schema["x-yijie-preview-scheme"]).toBe("yijie-artifact-preview");
  });

  it("accepts only identity fields in every request payload", () => {
    const request = artifactNativeRequest(CONTEXT_ID, IDENTITY, REQUEST_ID);
    for (const definition of ["openRequest", "releaseRequest", "saveRequest"]) {
      const validate = validator(definition);
      expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
      for (const [field, value] of [
        ["path", "/private/output.png"],
        ["bytes", [137, 80, 78, 71]],
        ["base64", "iVBORw0KGgo="],
        ["digest", "a".repeat(64)],
        ["contentHref", "/v3/private/content"],
        ["token", "secret"],
      ] as const) {
        const leaked = structuredClone(request) as { payload: Record<string, unknown> };
        leaked.payload[field] = value;
        expect(validate(leaked), field).toBe(false);
      }
    }
  });

  it("parses only opaque preview and content-free release/save results", () => {
    const handle = "A".repeat(43);
    expect(parseArtifactPreviewOpenResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "opened", previewUrl: `yijie-artifact-preview://localhost/v1/${handle}` },
    })).toEqual({
      status: "opened",
      previewUrl: `yijie-artifact-preview://localhost/v1/${handle}`,
    });
    expect(parseArtifactPreviewReleaseResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "released" },
    })).toEqual({ status: "released" });
    expect(parseArtifactSaveResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "cancelled", code: null },
    })).toEqual({ status: "cancelled", code: null });

    for (const leaked of [
      { status: "saved", code: null, path: "/private/output.png" },
      { status: "saved", code: null, name: "output.png" },
      { status: "saved", code: null, digest: "a".repeat(64) },
      { status: "saved", code: null, bytes: [1] },
    ]) {
      expect(() => parseArtifactSaveResponse({
        schemaVersion: 1,
        requestId: REQUEST_ID,
        data: leaked,
      })).toThrow();
    }
  });

  it("rejects malformed preview URLs and arbitrary native errors", () => {
    for (const previewUrl of [
      "https://localhost/v1/" + "A".repeat(43),
      "yijie-artifact-preview://evil/v1/" + "A".repeat(43),
      "yijie-artifact-preview://localhost/v1/short",
      "yijie-artifact-preview://localhost/v1/" + "A".repeat(43) + "?x=1",
    ]) {
      expect(() => parseArtifactPreviewOpenResponse({
        schemaVersion: 1,
        requestId: REQUEST_ID,
        data: { status: "opened", previewUrl },
      })).toThrow();
    }
    expect(parseArtifactNativeError({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      code: "artifact_native_expired",
      retryable: false,
    })).toMatchObject({ code: "artifact_native_expired" });
    expect(() => parseArtifactNativeError({ message: "Bearer /private/image.png" })).toThrow();
  });
});
