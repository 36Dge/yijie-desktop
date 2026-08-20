import {
  ARTIFACT_NATIVE_ERROR_CODES,
  ArtifactNativeContractError,
  artifactNativeRequest,
  parseArtifactNativeError,
  parseArtifactSaveResponse,
  type ArtifactNativeErrorCode,
  type ArtifactNativeErrorShape,
  type ArtifactNativeIdentity,
  type ArtifactSaveResult,
} from "./chat-artifact-native";

export const ARTIFACT_FILE_NATIVE_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_FILE_NATIVE_COMMAND_NAMES = [
  "chat_read_artifact_file_preview_v1",
  "chat_save_artifact_file_v1",
] as const;
export const ARTIFACT_FILE_NATIVE_ERROR_CODES = ARTIFACT_NATIVE_ERROR_CODES;

export type ArtifactFileNativeErrorCode = ArtifactNativeErrorCode;
export type ArtifactFileNativeErrorShape = ArtifactNativeErrorShape;
export type ArtifactFileNativeIdentity = ArtifactNativeIdentity;
export type ArtifactFileSaveResult = ArtifactSaveResult;
export type ArtifactFilePreviewResult =
  | Readonly<{
    status: "previewed";
    mediaType: "text/plain" | "application/json";
    text: string;
    truncated: boolean;
  }>
  | Readonly<{
    status: "previewed";
    mediaType: "text/csv";
    rows: readonly (readonly string[])[];
    truncated: boolean;
  }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PROJECTION_BYTES = 262_144;
const MAX_RESPONSE_BYTES = 524_288;
const MAX_TEXT_LINES = 2_000;
const MAX_TEXT_LINE_BYTES = 8_192;
const MAX_CSV_ROWS = 200;
const MAX_CSV_COLUMNS = 50;
const MAX_CSV_CELL_BYTES = 4_096;
const encoder = new TextEncoder();

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArtifactNativeContractError();
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new ArtifactNativeContractError();
  }
}

function envelope(value: unknown): Record<string, unknown> {
  if (encodedBytes(value) > MAX_RESPONSE_BYTES) throw new ArtifactNativeContractError();
  const outer = record(value);
  exact(outer, ["schemaVersion", "requestId", "data"]);
  if (
    outer.schemaVersion !== ARTIFACT_FILE_NATIVE_SCHEMA_VERSION ||
    typeof outer.requestId !== "string" ||
    !UUID.test(outer.requestId)
  ) {
    throw new ArtifactNativeContractError();
  }
  return record(outer.data);
}

function encodedBytes(value: unknown): number {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new ArtifactNativeContractError();
  }
}

function boundedText(value: unknown): string {
  if (typeof value !== "string") throw new ArtifactNativeContractError();
  const lines = value.split("\n");
  if (
    lines.length > MAX_TEXT_LINES ||
    lines.some((line) => encoder.encode(line).byteLength > MAX_TEXT_LINE_BYTES)
  ) {
    throw new ArtifactNativeContractError();
  }
  return value;
}

function stringRows(value: unknown): readonly (readonly string[])[] {
  if (!Array.isArray(value) || value.length > MAX_CSV_ROWS) throw new ArtifactNativeContractError();
  return value.map((row) => {
    if (
      !Array.isArray(row) ||
      row.length > MAX_CSV_COLUMNS ||
      row.some((cell) => typeof cell !== "string" || encoder.encode(cell).byteLength > MAX_CSV_CELL_BYTES)
    ) {
      throw new ArtifactNativeContractError();
    }
    return row as string[];
  });
}

export const artifactFileNativeRequest = artifactNativeRequest;

export function parseArtifactFilePreviewResponse(value: unknown): ArtifactFilePreviewResult {
  const data = envelope(value);
  if (encodedBytes(data) > MAX_PROJECTION_BYTES) throw new ArtifactNativeContractError();
  if (data.mediaType === "text/csv") {
    exact(data, ["status", "mediaType", "rows", "truncated"]);
    if (data.status !== "previewed" || typeof data.truncated !== "boolean") {
      throw new ArtifactNativeContractError();
    }
    return {
      status: "previewed",
      mediaType: "text/csv",
      rows: stringRows(data.rows),
      truncated: data.truncated,
    };
  }
  exact(data, ["status", "mediaType", "text", "truncated"]);
  if (
    data.status !== "previewed" ||
    (data.mediaType !== "text/plain" && data.mediaType !== "application/json") ||
    typeof data.truncated !== "boolean"
  ) {
    throw new ArtifactNativeContractError();
  }
  return {
    status: "previewed",
    mediaType: data.mediaType,
    text: boundedText(data.text),
    truncated: data.truncated,
  };
}

export const parseArtifactFileSaveResponse = parseArtifactSaveResponse;
export const parseArtifactFileNativeError = parseArtifactNativeError;
