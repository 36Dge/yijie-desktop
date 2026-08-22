export const CHAT_ARTIFACT_LIVE_SCHEMA_VERSION = 1 as const;
export const CHAT_ARTIFACT_LIVE_EVENT_CHANNEL = "yijie:chat:artifact:changed:v1" as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SEQUENCE_PATTERN = /^[1-9][0-9]*$/;
const MAX_UINT64 = (1n << 64n) - 1n;

export class ChatArtifactLiveContractError extends Error {
  constructor() {
    super("chat-artifact-live-contract-invalid");
    this.name = "ChatArtifactLiveContractError";
  }
}

export interface ChatArtifactChangedEvent {
  readonly schemaVersion: 1;
  readonly subscriptionId: string;
  readonly contextId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly eventId: string;
  readonly notificationSequence: string;
  readonly kind: "artifact_changed";
  readonly payload: Readonly<Record<string, never>>;
}

export interface ChatArtifactResyncRequiredEvent {
  readonly schemaVersion: 1;
  readonly subscriptionId: string;
  readonly contextId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly eventId: string;
  readonly notificationSequence: string;
  readonly kind: "resync_required";
  readonly payload: Readonly<{
    reason: "backpressure" | "sequence_gap" | "protocol_error";
  }>;
}

export interface ChatArtifactContextInvalidatedEvent {
  readonly schemaVersion: 1;
  readonly subscriptionId: string;
  readonly contextId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly eventId: string;
  readonly notificationSequence: string;
  readonly kind: "context_invalidated";
  readonly payload: Readonly<{ reason: "authority_changed" }>;
}

export type ChatArtifactLiveEvent =
  | ChatArtifactChangedEvent
  | ChatArtifactResyncRequiredEvent
  | ChatArtifactContextInvalidatedEvent;

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChatArtifactLiveContractError();
  }
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ChatArtifactLiveContractError();
  }
  return object;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ChatArtifactLiveContractError();
  }
  return value;
}

function sequence(value: unknown): string {
  if (typeof value !== "string" || !SEQUENCE_PATTERN.test(value)) {
    throw new ChatArtifactLiveContractError();
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new ChatArtifactLiveContractError();
  }
  if (parsed < 1n || parsed > MAX_UINT64) throw new ChatArtifactLiveContractError();
  return value;
}

export function parseChatArtifactLiveEvent(value: unknown): ChatArtifactLiveEvent {
  const root = exactObject(value, [
    "schemaVersion",
    "subscriptionId",
    "contextId",
    "sessionId",
    "turnId",
    "eventId",
    "notificationSequence",
    "kind",
    "payload",
  ]);
  if (root.schemaVersion !== CHAT_ARTIFACT_LIVE_SCHEMA_VERSION || typeof root.kind !== "string") {
    throw new ChatArtifactLiveContractError();
  }
  const common = {
    schemaVersion: CHAT_ARTIFACT_LIVE_SCHEMA_VERSION,
    subscriptionId: uuid(root.subscriptionId),
    contextId: uuid(root.contextId),
    sessionId: uuid(root.sessionId),
    turnId: uuid(root.turnId),
    eventId: uuid(root.eventId),
    notificationSequence: sequence(root.notificationSequence),
  } as const;
  switch (root.kind) {
    case "artifact_changed":
      exactObject(root.payload, []);
      return { ...common, kind: root.kind, payload: Object.freeze({}) };
    case "resync_required": {
      const payload = exactObject(root.payload, ["reason"]);
      if (!matches(payload.reason, ["backpressure", "sequence_gap", "protocol_error"] as const)) {
        throw new ChatArtifactLiveContractError();
      }
      return { ...common, kind: root.kind, payload: { reason: payload.reason } };
    }
    case "context_invalidated": {
      const payload = exactObject(root.payload, ["reason"]);
      if (payload.reason !== "authority_changed") throw new ChatArtifactLiveContractError();
      return { ...common, kind: root.kind, payload: { reason: payload.reason } };
    }
    default:
      throw new ChatArtifactLiveContractError();
  }
}

function matches<const T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}
