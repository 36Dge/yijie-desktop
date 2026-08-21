import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_REPORT_NATIVE_COMMAND_NAMES,
  ARTIFACT_REPORT_NATIVE_ERROR_CODES,
  artifactReportNativeRequest,
  parseArtifactReportPreviewResponse,
  parseArtifactReportSaveResponse,
} from "./chat-artifact-report-native";

const REQUEST_ID = "019c1a00-0000-7000-8000-0000000000c1";
const CONTEXT_ID = "019c1a00-0000-7000-8000-0000000000c2";
const IDENTITY = Object.freeze({
  sessionId: "019c1a00-0000-7000-8000-0000000000c3",
  turnId: "019c1a00-0000-7000-8000-0000000000c4",
  artifactId: "019c1a00-0000-7000-8000-0000000000c5",
});
const schema = JSON.parse(readFileSync(
  new URL("../../src-tauri/schemas/chat-artifact-report-native-v1.schema.json", import.meta.url),
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
  if (!validate) throw new Error(`Missing report native definition: ${definition}`);
  return validate;
}

describe("artifact report native contract", () => {
  it("uses an identity-only request and parses a closed bounded projection", () => {
    const request = artifactReportNativeRequest(CONTEXT_ID, IDENTITY, REQUEST_ID);
    expect(request.payload).toEqual(IDENTITY);
    expect(validator("identityRequest")(request)).toBe(true);
    for (const [field, value] of [
      ["bytes", [1, 2, 3]],
      ["base64", "e30="],
      ["digest", "a".repeat(64)],
      ["hostHref", "/v3/artifacts/content"],
      ["path", "/private/report.json"],
      ["token", "secret"],
    ] as const) {
      const leaked = structuredClone(request) as { payload: Record<string, unknown> };
      leaked.payload[field] = value;
      expect(validator("identityRequest")(leaked), field).toBe(false);
    }
    expect(parseArtifactReportPreviewResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: {
        schemaVersion: 1,
        title: "Safe",
        generatedAt: "2026-08-20T10:00:00+08:00",
        sourceTime: null,
        truncated: false,
        sections: [],
      },
    })).toMatchObject({ schemaVersion: 1, title: "Safe", sections: [] });
    expect(ARTIFACT_REPORT_NATIVE_COMMAND_NAMES).toEqual([
      "chat_read_artifact_report_preview_v1",
      "chat_save_artifact_report_v1",
    ]);
    expect(schema["x-yijie-command-names"]).toEqual(ARTIFACT_REPORT_NATIVE_COMMAND_NAMES);
    expect(schema["x-yijie-error-codes"]).toEqual(ARTIFACT_REPORT_NATIVE_ERROR_CODES);
  });

  it("rejects unknown projection fields, source payloads, controls, and ordinal drift", () => {
    const response = {
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: {
        schemaVersion: 1,
        title: "Safe",
        generatedAt: "2026-08-20T02:00:00Z",
        sourceTime: null,
        truncated: false,
        sections: [{
          ordinal: 0,
          id: "future",
          type: "unsupported",
          required: false,
          truncated: false,
        }],
      },
    };
    expect(parseArtifactReportPreviewResponse(response).sections[0]?.type).toBe("unsupported");
    expect(() => parseArtifactReportPreviewResponse({
      ...response,
      data: { ...response.data, sections: [{ ...response.data.sections[0], payload: "leak" }] },
    })).toThrow();
    expect(() => parseArtifactReportPreviewResponse({
      ...response,
      data: { ...response.data, title: "unsafe\u202e" },
    })).toThrow();
    expect(() => parseArtifactReportPreviewResponse({
      ...response,
      data: { ...response.data, sections: [{ ...response.data.sections[0], ordinal: 1 }] },
    })).toThrow();
  });

  it("keeps canonical save outcomes content-free", () => {
    expect(parseArtifactReportSaveResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "saved", code: null },
    })).toEqual({ status: "saved", code: null });
    for (const data of [
      { status: "saved", code: null, path: "/private/report.json" },
      { status: "saved", code: null, digest: "a".repeat(64) },
      { status: "failed", code: "internal report parser details" },
    ]) {
      expect(() => parseArtifactReportSaveResponse({ schemaVersion: 1, requestId: REQUEST_ID, data }))
        .toThrow();
    }
  });
});
