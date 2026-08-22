import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  CHAT_ARTIFACT_LIVE_EVENT_CHANNEL,
  ChatArtifactLiveContractError,
  parseChatArtifactLiveEvent,
} from "./chat-artifact-live";

const schema = JSON.parse(readFileSync(
  new URL("../../src-tauri/schemas/chat-artifact-live-v1.schema.json", import.meta.url),
  "utf8",
)) as Readonly<{ $id: string }>;
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addKeyword("x-yijie-schema-version");
ajv.addKeyword("x-yijie-event-channel");
const validateSchemaEvent = ajv.compile(schema);

const ids = Object.freeze({
  subscriptionId: "018f0000-0000-7000-8000-000000000001",
  contextId: "018f0000-0000-7000-8000-000000000002",
  sessionId: "018f0000-0000-7000-8000-000000000003",
  turnId: "018f0000-0000-7000-8000-000000000004",
  eventId: "018f0000-0000-7000-8000-000000000005",
});

function event(kind: string, payload: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    ...ids,
    notificationSequence: "1",
    kind,
    payload,
  };
}

describe("chat artifact live private contract", () => {
  it("freezes the exact channel and closed content-free changed event", () => {
    expect(CHAT_ARTIFACT_LIVE_EVENT_CHANNEL).toBe("yijie:chat:artifact:changed:v1");
    expect(parseChatArtifactLiveEvent(event("artifact_changed"))).toEqual(event("artifact_changed"));
    expect(() => parseChatArtifactLiveEvent({
      ...event("artifact_changed"),
      artifactId: "018f0000-0000-7000-8000-000000000006",
    })).toThrow(ChatArtifactLiveContractError);
  });

  it("accepts only the closed resync and authority invalidation reasons", () => {
    for (const reason of ["backpressure", "sequence_gap", "protocol_error"] as const) {
      expect(parseChatArtifactLiveEvent(event("resync_required", { reason })).payload).toEqual({ reason });
    }
    expect(parseChatArtifactLiveEvent(event("context_invalidated", {
      reason: "authority_changed",
    })).payload).toEqual({ reason: "authority_changed" });
    expect(() => parseChatArtifactLiveEvent(event("resync_required", { reason: "raw_error" })))
      .toThrow(ChatArtifactLiveContractError);
  });

  it("requires canonical UUIDs and canonical uint64 decimal sequence", () => {
    for (const notificationSequence of ["0", "01", "18446744073709551616", 1]) {
      expect(() => parseChatArtifactLiveEvent({ ...event("artifact_changed"), notificationSequence }))
        .toThrow(ChatArtifactLiveContractError);
    }
    expect(parseChatArtifactLiveEvent({
      ...event("artifact_changed"),
      notificationSequence: "18446744073709551615",
    }).notificationSequence).toBe("18446744073709551615");
    expect(() => parseChatArtifactLiveEvent({
      ...event("artifact_changed"),
      contextId: ids.contextId.toUpperCase(),
    })).toThrow(ChatArtifactLiveContractError);
    expect(validateSchemaEvent(event("artifact_changed")), JSON.stringify(validateSchemaEvent.errors))
      .toBe(true);
    expect(validateSchemaEvent({
      ...event("artifact_changed"),
      notificationSequence: "18446744073709551616",
    })).toBe(false);
  });

  it("rejects metadata, content and native diagnostic canaries", () => {
    const forbidden = ["name", "mediaType", "sizeBytes", "bytes", "base64", "digest", "href", "path", "token", "requestId", "error"];
    for (const key of forbidden) {
      expect(() => parseChatArtifactLiveEvent({
        ...event("artifact_changed"),
        payload: { [key]: "SENSITIVE_CANARY" },
      })).toThrow(ChatArtifactLiveContractError);
    }
  });
});
