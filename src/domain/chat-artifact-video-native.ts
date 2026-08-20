import {
  ARTIFACT_NATIVE_ERROR_CODES,
  ArtifactNativeContractError,
  artifactNativeRequest,
  parseArtifactNativeError,
  type ArtifactNativeErrorCode,
  type ArtifactNativeErrorShape,
  type ArtifactNativeIdentity,
} from "./chat-artifact-native";

export const ARTIFACT_VIDEO_NATIVE_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_VIDEO_NATIVE_COMMAND_NAMES = [
  "chat_open_artifact_video_preview_v1",
  "chat_release_artifact_video_preview_v1",
  "chat_save_artifact_video_v1",
] as const;
export const ARTIFACT_VIDEO_NATIVE_ERROR_CODES = ARTIFACT_NATIVE_ERROR_CODES;

export type ArtifactVideoNativeErrorCode = ArtifactNativeErrorCode;
export type ArtifactVideoNativeErrorShape = ArtifactNativeErrorShape;
export type ArtifactVideoNativeIdentity = ArtifactNativeIdentity;
export interface ArtifactVideoPreviewOpenResult {
  readonly status: "opened";
  readonly previewUrl: string;
}
export interface ArtifactVideoPreviewReleaseResult { readonly status: "released" }
export type ArtifactVideoSaveResult =
  | Readonly<{ status: "saved" | "cancelled"; code: null }>
  | Readonly<{ status: "failed"; code: ArtifactVideoNativeErrorCode }>;

const VIDEO_PREVIEW_URL = /^yijie-artifact-video:\/\/localhost\/v1\/[A-Za-z0-9_-]{43}$/;
const ERROR_CODES = new Set<string>(ARTIFACT_VIDEO_NATIVE_ERROR_CODES);

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
  const outer = record(value);
  exact(outer, ["schemaVersion", "requestId", "data"]);
  if (outer.schemaVersion !== ARTIFACT_VIDEO_NATIVE_SCHEMA_VERSION || typeof outer.requestId !== "string") {
    throw new ArtifactNativeContractError();
  }
  return record(outer.data);
}

export const artifactVideoNativeRequest = artifactNativeRequest;

export function parseArtifactVideoPreviewOpenResponse(value: unknown): ArtifactVideoPreviewOpenResult {
  const data = envelope(value);
  exact(data, ["status", "previewUrl"]);
  if (data.status !== "opened" || typeof data.previewUrl !== "string" || !VIDEO_PREVIEW_URL.test(data.previewUrl)) {
    throw new ArtifactNativeContractError();
  }
  return { status: "opened", previewUrl: data.previewUrl };
}

export function parseArtifactVideoPreviewReleaseResponse(value: unknown): ArtifactVideoPreviewReleaseResult {
  const data = envelope(value);
  exact(data, ["status"]);
  if (data.status !== "released") throw new ArtifactNativeContractError();
  return { status: "released" };
}

export function parseArtifactVideoSaveResponse(value: unknown): ArtifactVideoSaveResult {
  const data = envelope(value);
  exact(data, ["status", "code"]);
  if ((data.status === "saved" || data.status === "cancelled") && data.code === null) {
    return { status: data.status, code: null };
  }
  if (data.status === "failed" && typeof data.code === "string" && ERROR_CODES.has(data.code)) {
    return { status: "failed", code: data.code as ArtifactVideoNativeErrorCode };
  }
  throw new ArtifactNativeContractError();
}

export const parseArtifactVideoNativeError = parseArtifactNativeError;
