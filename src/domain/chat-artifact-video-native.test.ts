import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_VIDEO_NATIVE_COMMAND_NAMES,
  ARTIFACT_VIDEO_NATIVE_ERROR_CODES,
  artifactVideoNativeRequest,
  parseArtifactVideoPreviewOpenResponse,
  parseArtifactVideoPreviewReleaseResponse,
  parseArtifactVideoSaveResponse,
} from "./chat-artifact-video-native";

const REQUEST_ID = "019c1a00-0000-7000-8000-000000000081";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000082";
const IDENTITY = Object.freeze({
  sessionId: "019c1a00-0000-7000-8000-000000000083",
  turnId: "019c1a00-0000-7000-8000-000000000084",
  artifactId: "019c1a00-0000-7000-8000-000000000085",
});

const schema = JSON.parse(readFileSync(
  new URL("../../src-tauri/schemas/chat-artifact-video-native-v1.schema.json", import.meta.url),
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
  if (!validate) throw new Error(`Missing video native definition: ${definition}`);
  return validate;
}

describe("private Artifact video native boundary", () => {
  it("keeps an independent exact command and scheme allowlist", () => {
    expect(schema["x-yijie-command-names"]).toEqual(ARTIFACT_VIDEO_NATIVE_COMMAND_NAMES);
    expect(schema["x-yijie-error-codes"]).toEqual(ARTIFACT_VIDEO_NATIVE_ERROR_CODES);
    expect(schema["x-yijie-preview-scheme"]).toBe("yijie-artifact-video");
    expect(ARTIFACT_VIDEO_NATIVE_COMMAND_NAMES).toEqual([
      "chat_open_artifact_video_preview_v1",
      "chat_release_artifact_video_preview_v1",
      "chat_save_artifact_video_v1",
    ]);
  });

  it("accepts only identity in open, release, and save requests", () => {
    const request = artifactVideoNativeRequest(CONTEXT_ID, IDENTITY, REQUEST_ID);
    for (const definition of ["openRequest", "releaseRequest", "saveRequest"]) {
      const validate = validator(definition);
      expect(validate(request), JSON.stringify(validate.errors)).toBe(true);
      for (const [field, value] of [
        ["bytes", [0, 0, 0, 24]],
        ["base64", "AAAAHGZ0eXA="],
        ["digest", "a".repeat(64)],
        ["hostHref", "/v3/artifact/content"],
        ["path", "/private/movie.mp4"],
        ["filename", "movie.mp4"],
        ["token", "secret"],
      ] as const) {
        const leaked = structuredClone(request) as { payload: Record<string, unknown> };
        leaked.payload[field] = value;
        expect(validate(leaked), field).toBe(false);
      }
    }
  });

  it("parses only opaque video URLs and content-free outcomes", () => {
    const previewUrl = `yijie-artifact-video://localhost/v1/${"A".repeat(43)}`;
    expect(parseArtifactVideoPreviewOpenResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "opened", previewUrl },
    })).toEqual({ status: "opened", previewUrl });
    expect(parseArtifactVideoPreviewReleaseResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "released" },
    })).toEqual({ status: "released" });
    expect(parseArtifactVideoSaveResponse({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: { status: "cancelled", code: null },
    })).toEqual({ status: "cancelled", code: null });

    for (const data of [
      { status: "opened", previewUrl: `blob:${previewUrl}` },
      { status: "opened", previewUrl: previewUrl + "?token=x" },
      { status: "saved", code: null, path: "/private/movie.mp4" },
      { status: "saved", code: null, digest: "a".repeat(64) },
    ]) {
      const parse = data.status === "opened"
        ? parseArtifactVideoPreviewOpenResponse
        : parseArtifactVideoSaveResponse;
      expect(() => parse({ schemaVersion: 1, requestId: REQUEST_ID, data } as never)).toThrow();
    }
  });
});
