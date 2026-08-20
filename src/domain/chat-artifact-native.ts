export const ARTIFACT_NATIVE_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_NATIVE_COMMAND_NAMES = [
  "chat_open_artifact_image_preview_v1",
  "chat_release_artifact_image_preview_v1",
  "chat_save_artifact_image_v1",
] as const;
export const ARTIFACT_NATIVE_ERROR_CODES = [
  "artifact_native_invalid_request",
  "artifact_native_unauthenticated",
  "artifact_native_forbidden",
  "artifact_native_not_found",
  "artifact_native_not_ready",
  "artifact_native_expired",
  "artifact_native_unsupported",
  "artifact_native_integrity_failed",
  "artifact_native_limit_exceeded",
  "artifact_native_conflict",
  "artifact_native_extension_mismatch",
  "artifact_native_dialog_unavailable",
  "artifact_native_permission_denied",
  "artifact_native_storage_full",
  "artifact_native_io_failed",
  "artifact_native_unavailable",
] as const;

export type ArtifactNativeErrorCode = typeof ARTIFACT_NATIVE_ERROR_CODES[number];
export interface ArtifactNativeIdentity {
  readonly sessionId: string;
  readonly turnId: string;
  readonly artifactId: string;
}
export interface ArtifactNativeErrorShape {
  readonly schemaVersion: 1;
  readonly requestId: string | null;
  readonly code: ArtifactNativeErrorCode;
  readonly retryable: boolean;
}
export interface ArtifactPreviewOpenResult {
  readonly status: "opened";
  readonly previewUrl: string;
}
export interface ArtifactPreviewReleaseResult { readonly status: "released" }
export type ArtifactSaveResult =
  | Readonly<{ status: "saved" | "cancelled"; code: null }>
  | Readonly<{ status: "failed"; code: ArtifactNativeErrorCode }>;

export class ArtifactNativeContractError extends Error {
  constructor() {
    super("artifact-native-contract-invalid");
    this.name = "ArtifactNativeContractError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PREVIEW_URL = /^yijie-artifact-preview:\/\/localhost\/v1\/[A-Za-z0-9_-]{43}$/;
const ERROR_CODES = new Set<string>(ARTIFACT_NATIVE_ERROR_CODES);

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

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ArtifactNativeContractError();
  return value;
}

function envelope(value: unknown): { requestId: string; data: Record<string, unknown> } {
  const outer = record(value);
  exact(outer, ["schemaVersion", "requestId", "data"]);
  if (outer.schemaVersion !== ARTIFACT_NATIVE_SCHEMA_VERSION) throw new ArtifactNativeContractError();
  return { requestId: uuid(outer.requestId), data: record(outer.data) };
}

export function artifactNativeRequest(
  contextId: string,
  identity: ArtifactNativeIdentity,
  requestId: string = crypto.randomUUID(),
) {
  uuid(requestId);
  uuid(contextId);
  const payload = record(identity);
  exact(payload, ["sessionId", "turnId", "artifactId"]);
  uuid(payload.sessionId);
  uuid(payload.turnId);
  uuid(payload.artifactId);
  return {
    schemaVersion: ARTIFACT_NATIVE_SCHEMA_VERSION,
    requestId,
    contextId,
    payload: { sessionId: identity.sessionId, turnId: identity.turnId, artifactId: identity.artifactId },
  } as const;
}

export function parseArtifactPreviewOpenResponse(value: unknown): ArtifactPreviewOpenResult {
  const { data } = envelope(value);
  exact(data, ["status", "previewUrl"]);
  if (data.status !== "opened" || typeof data.previewUrl !== "string" || !PREVIEW_URL.test(data.previewUrl)) {
    throw new ArtifactNativeContractError();
  }
  return { status: "opened", previewUrl: data.previewUrl };
}

export function parseArtifactPreviewReleaseResponse(value: unknown): ArtifactPreviewReleaseResult {
  const { data } = envelope(value);
  exact(data, ["status"]);
  if (data.status !== "released") throw new ArtifactNativeContractError();
  return { status: "released" };
}

export function parseArtifactSaveResponse(value: unknown): ArtifactSaveResult {
  const { data } = envelope(value);
  exact(data, ["status", "code"]);
  if ((data.status === "saved" || data.status === "cancelled") && data.code === null) {
    return { status: data.status, code: null };
  }
  if (data.status === "failed" && typeof data.code === "string" && ERROR_CODES.has(data.code)) {
    return { status: "failed", code: data.code as ArtifactNativeErrorCode };
  }
  throw new ArtifactNativeContractError();
}

export function parseArtifactNativeError(value: unknown): ArtifactNativeErrorShape {
  const error = record(value);
  exact(error, ["schemaVersion", "requestId", "code", "retryable"]);
  if (
    error.schemaVersion !== ARTIFACT_NATIVE_SCHEMA_VERSION ||
    (error.requestId !== null && (typeof error.requestId !== "string" || !UUID.test(error.requestId))) ||
    typeof error.code !== "string" ||
    !ERROR_CODES.has(error.code) ||
    typeof error.retryable !== "boolean"
  ) throw new ArtifactNativeContractError();
  return {
    schemaVersion: 1,
    requestId: error.requestId,
    code: error.code as ArtifactNativeErrorCode,
    retryable: error.retryable,
  };
}
