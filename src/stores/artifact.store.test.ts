import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChatArtifact, ChatHistoryPage, ChatHistoryTurn } from "../domain/chat-ipc";
import { ArtifactProjectionError } from "../domain/chat-artifact";
import { createArtifactStoreDefinition } from "./artifact.store";

const SESSION_A = "019c1a00-0000-7000-8000-000000000201";
const SESSION_B = "019c1a00-0000-7000-8000-000000000202";
const TURN_A = "019c1a00-0000-7000-8000-000000000203";
const TURN_B = "019c1a00-0000-7000-8000-000000000204";
const ARTIFACT_A = "019c1a00-0000-7000-8000-000000000205";
const ARTIFACT_B = "019c1a00-0000-7000-8000-000000000206";
let storeSequence = 0;

function artifact(
  artifactId: string,
  ordinal: number,
  overrides: Partial<ChatArtifact> = {},
): ChatArtifact {
  return Object.freeze({
    artifactId,
    kind: "file",
    provenance: "synthetic",
    status: "announced",
    ordinal,
    progressStage: null,
    progressPercent: null,
    displayName: `demo-${ordinal}.txt`,
    mediaType: null,
    sizeBytes: null,
    localCommittedAt: null,
    expiresAt: null,
    hasPoster: false,
    errorCode: null,
    retryable: null,
    ...overrides,
  });
}

function turn(turnId: string, artifacts: readonly ChatArtifact[]): ChatHistoryTurn {
  return Object.freeze({
    turnId,
    status: "completed",
    terminalAt: 1,
    reasoningStatus: "complete",
    reasoningReasonCode: null,
    messages: Object.freeze([]),
    reasoning: Object.freeze([]),
    artifacts: Object.freeze([...artifacts]),
  });
}

function history(...turns: readonly ChatHistoryTurn[]): ChatHistoryPage {
  return Object.freeze({ turns: Object.freeze([...turns]), nextCursor: null });
}

function createStore() {
  return createArtifactStoreDefinition(`artifact-test-${storeSequence++}`)();
}

describe("Artifact store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("uses one reducer for history and live projections while preserving order and identity", () => {
    const store = createStore();
    const page = history(turn(TURN_A, [
      artifact(ARTIFACT_B, 1),
      artifact(ARTIFACT_A, 0),
    ]));

    store.ingestHistoryV3(SESSION_A, page);
    const first = store.artifactsForTurn(SESSION_A, TURN_A);
    expect(first.map((item) => item.artifactId)).toEqual([ARTIFACT_A, ARTIFACT_B]);

    store.ingestHistoryV3(SESSION_A, page);
    expect(store.artifactsForTurn(SESSION_A, TURN_A)).toBe(first);
    expect(store.artifactsForTurn(SESSION_A, TURN_A)[0]).toBe(first[0]);

    store.applyProjection(SESSION_A, TURN_A, artifact(ARTIFACT_A, 0, {
      status: "processing",
      progressStage: "processing",
      progressPercent: 48,
    }));
    const updated = store.artifactsForTurn(SESSION_A, TURN_A);
    expect(updated).toHaveLength(2);
    expect(updated[0]?.progressPercent).toBe(48);
    expect(updated[1]).toBe(first[1]);
  });

  it("keeps ready Artifacts when another item fails or expires", () => {
    const store = createStore();
    const ready = artifact(ARTIFACT_A, 0, {
      status: "ready",
      mediaType: "text/plain",
      sizeBytes: 32,
      localCommittedAt: 1_000,
      expiresAt: 605_801_000,
    });
    const failed = artifact(ARTIFACT_B, 1, {
      status: "failed",
      errorCode: "artifact_generation_failed",
      retryable: false,
    });
    store.ingestHistoryV3(SESSION_A, history(turn(TURN_A, [ready, failed])));

    const items = store.artifactsForTurn(SESSION_A, TURN_A);
    expect(items.map((item) => item.status)).toEqual(["ready", "failed"]);

    store.applyProjection(SESSION_A, TURN_A, artifact(ARTIFACT_A, 0, {
      status: "expired",
      mediaType: "text/plain",
      sizeBytes: 32,
      localCommittedAt: 1_000,
      expiresAt: 605_801_000,
    }));
    expect(store.artifactsForTurn(SESSION_A, TURN_A).map((item) => item.status))
      .toEqual(["expired", "failed"]);
  });

  it("survives session switches, reloads, and repeated history without duplicates", () => {
    const store = createStore();
    store.ingestHistoryV3(SESSION_A, history(turn(TURN_A, [artifact(ARTIFACT_A, 0)])));
    store.ingestHistoryV3(SESSION_B, history(turn(TURN_B, [artifact(ARTIFACT_A, 0)])));

    store.selectSession(SESSION_A);
    expect(store.activeArtifacts).toHaveLength(1);
    store.selectSession(SESSION_B);
    expect(store.activeArtifacts).toHaveLength(1);
    store.selectSession(SESSION_A);
    store.ingestHistoryV3(SESSION_A, history(turn(TURN_A, [artifact(ARTIFACT_A, 0)])));
    expect(store.activeArtifacts).toHaveLength(1);
  });

  it("rejects a conflicting replay atomically and stores only safe metadata", () => {
    const store = createStore();
    store.ingestHistoryV3(SESSION_A, history(turn(TURN_A, [artifact(ARTIFACT_A, 0)])));
    const before = store.artifactsForTurn(SESSION_A, TURN_A);

    expect(() => store.ingestHistoryV3(SESSION_A, history(turn(TURN_A, [
      artifact(ARTIFACT_A, 0),
      artifact(ARTIFACT_B, 0),
    ])))).toThrowError(ArtifactProjectionError);
    expect(store.artifactsForTurn(SESSION_A, TURN_A)).toBe(before);

    const keys = Object.keys(before[0] ?? {});
    expect(keys).not.toEqual(expect.arrayContaining([
      "bytes", "base64", "digest", "href", "hostHref", "absolutePath", "token", "body",
    ]));
  });
});
