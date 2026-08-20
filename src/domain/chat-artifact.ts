import type { ChatArtifact } from "./chat-ipc";

export type ArtifactProjectionErrorCode =
  | "identity_conflict"
  | "ordinal_conflict"
  | "status_regression"
  | "progress_stage_regression"
  | "progress_percent_regression"
  | "metadata_conflict";

export class ArtifactProjectionError extends Error {
  constructor(readonly code: ArtifactProjectionErrorCode) {
    super("artifact-projection-invalid");
    this.name = "ArtifactProjectionError";
  }
}

export interface ArtifactProjection extends ChatArtifact {
  readonly sessionId: string;
  readonly turnId: string;
}

const STATUS_ORDER: Readonly<Record<ChatArtifact["status"], number>> = Object.freeze({
  announced: 0,
  generating: 1,
  processing: 2,
  transferring: 3,
  ready: 4,
  failed: 4,
  cancelled: 4,
  expired: 5,
});

const PROGRESS_STAGE_ORDER: Readonly<Record<NonNullable<ChatArtifact["progressStage"]>, number>> =
  Object.freeze({ generating: 0, processing: 1, finalizing: 2 });

function terminal(status: ChatArtifact["status"]): boolean {
  return status === "ready" || status === "failed" || status === "cancelled" || status === "expired";
}

function sameProjection(left: ArtifactProjection, right: ArtifactProjection): boolean {
  return left.sessionId === right.sessionId &&
    left.turnId === right.turnId &&
    left.artifactId === right.artifactId &&
    left.kind === right.kind &&
    left.provenance === right.provenance &&
    left.status === right.status &&
    left.ordinal === right.ordinal &&
    left.progressStage === right.progressStage &&
    left.progressPercent === right.progressPercent &&
    left.displayName === right.displayName &&
    left.mediaType === right.mediaType &&
    left.sizeBytes === right.sizeBytes &&
    left.localCommittedAt === right.localCommittedAt &&
    left.expiresAt === right.expiresAt &&
    left.hasPoster === right.hasPoster &&
    left.errorCode === right.errorCode &&
    left.retryable === right.retryable;
}

function stableNullable<T>(previous: T | null, incoming: T | null): T | null {
  if (previous === null) return incoming;
  if (incoming === null) return previous;
  if (previous !== incoming) throw new ArtifactProjectionError("metadata_conflict");
  return previous;
}

function assertIdentity(previous: ArtifactProjection, incoming: ArtifactProjection): void {
  if (previous.sessionId !== incoming.sessionId ||
      previous.turnId !== incoming.turnId ||
      previous.artifactId !== incoming.artifactId ||
      previous.kind !== incoming.kind ||
      previous.provenance !== incoming.provenance ||
      previous.ordinal !== incoming.ordinal) {
    throw new ArtifactProjectionError("identity_conflict");
  }
}

function assertStatusForward(
  previous: ChatArtifact["status"],
  incoming: ChatArtifact["status"],
): void {
  if (previous === incoming || (previous === "ready" && incoming === "expired")) return;
  if (terminal(previous) || STATUS_ORDER[incoming] < STATUS_ORDER[previous]) {
    throw new ArtifactProjectionError("status_regression");
  }
}

function mergeProgressStage(
  previous: ChatArtifact["progressStage"],
  incoming: ChatArtifact["progressStage"],
  incomingStatus: ChatArtifact["status"],
): ChatArtifact["progressStage"] {
  if (terminal(incomingStatus)) return null;
  if (previous !== null && incoming !== null &&
      PROGRESS_STAGE_ORDER[incoming] < PROGRESS_STAGE_ORDER[previous]) {
    throw new ArtifactProjectionError("progress_stage_regression");
  }
  return incoming ?? previous;
}

function mergeProgressPercent(
  previous: number | null,
  incoming: number | null,
  incomingStatus: ChatArtifact["status"],
): number | null {
  if (terminal(incomingStatus)) return null;
  if (previous !== null && incoming !== null && incoming < previous) {
    throw new ArtifactProjectionError("progress_percent_regression");
  }
  return incoming ?? previous;
}

export function createArtifactProjection(
  sessionId: string,
  turnId: string,
  artifact: ChatArtifact,
): ArtifactProjection {
  return Object.freeze({
    sessionId,
    turnId,
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    provenance: artifact.provenance,
    status: artifact.status,
    ordinal: artifact.ordinal,
    progressStage: artifact.progressStage,
    progressPercent: artifact.progressPercent,
    displayName: artifact.displayName,
    mediaType: artifact.mediaType,
    sizeBytes: artifact.sizeBytes,
    localCommittedAt: artifact.localCommittedAt,
    expiresAt: artifact.expiresAt,
    hasPoster: artifact.hasPoster,
    errorCode: artifact.errorCode,
    retryable: artifact.retryable,
  });
}

export function reduceArtifactProjection(
  previous: ArtifactProjection,
  incoming: ArtifactProjection,
): ArtifactProjection {
  assertIdentity(previous, incoming);
  if (sameProjection(previous, incoming)) return previous;
  assertStatusForward(previous.status, incoming.status);

  const next: ArtifactProjection = Object.freeze({
    sessionId: previous.sessionId,
    turnId: previous.turnId,
    artifactId: previous.artifactId,
    kind: previous.kind,
    provenance: previous.provenance,
    status: incoming.status,
    ordinal: previous.ordinal,
    progressStage: mergeProgressStage(
      previous.progressStage,
      incoming.progressStage,
      incoming.status,
    ),
    progressPercent: mergeProgressPercent(
      previous.progressPercent,
      incoming.progressPercent,
      incoming.status,
    ),
    displayName: stableNullable(previous.displayName, incoming.displayName),
    mediaType: stableNullable(previous.mediaType, incoming.mediaType),
    sizeBytes: stableNullable(previous.sizeBytes, incoming.sizeBytes),
    localCommittedAt: stableNullable(previous.localCommittedAt, incoming.localCommittedAt),
    expiresAt: stableNullable(previous.expiresAt, incoming.expiresAt),
    hasPoster: previous.hasPoster || incoming.hasPoster,
    errorCode: stableNullable(previous.errorCode, incoming.errorCode),
    retryable: stableNullable(previous.retryable, incoming.retryable),
  });

  if (previous.hasPoster && !incoming.hasPoster) {
    throw new ArtifactProjectionError("metadata_conflict");
  }
  return sameProjection(previous, next) ? previous : next;
}

export function reduceArtifactList(
  current: readonly ArtifactProjection[],
  incoming: ArtifactProjection,
): readonly ArtifactProjection[] {
  const existingIndex = current.findIndex((item) => item.artifactId === incoming.artifactId);
  if (existingIndex >= 0) {
    const previous = current[existingIndex]!;
    const updated = reduceArtifactProjection(previous, incoming);
    if (updated === previous) return current;
    const next = [...current];
    next[existingIndex] = updated;
    return Object.freeze(next);
  }

  if (current.some((item) => item.ordinal === incoming.ordinal)) {
    throw new ArtifactProjectionError("ordinal_conflict");
  }
  return Object.freeze([...current, incoming].sort((left, right) => left.ordinal - right.ordinal));
}
