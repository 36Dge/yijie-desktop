import { describe, expect, it } from "vitest";
import type { ChatArtifact } from "./chat-ipc";
import {
  ArtifactProjectionError,
  createArtifactProjection,
  reduceArtifactList,
  reduceArtifactProjection,
} from "./chat-artifact";

const SESSION_ID = "019c1a00-0000-7000-8000-000000000101";
const TURN_ID = "019c1a00-0000-7000-8000-000000000102";
const ARTIFACT_ID = "019c1a00-0000-7000-8000-000000000103";

function artifact(overrides: Partial<ChatArtifact> = {}): ChatArtifact {
  return Object.freeze({
    artifactId: ARTIFACT_ID,
    kind: "image",
    provenance: "synthetic",
    status: "announced",
    ordinal: 0,
    progressStage: null,
    progressPercent: null,
    displayName: "local-demo.png",
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

function projection(overrides: Partial<ChatArtifact> = {}) {
  return createArtifactProjection(SESSION_ID, TURN_ID, artifact(overrides));
}

describe("chat Artifact domain reducer", () => {
  it("projects only parser-approved safe metadata fields", () => {
    const untypedInput = {
      ...artifact(),
      hostHref: "http://127.0.0.1/private",
      digest: "not-for-ui",
      body: "not-for-ui",
    } as ChatArtifact;
    const created = createArtifactProjection(SESSION_ID, TURN_ID, untypedInput);
    expect(Object.keys(created)).not.toEqual(expect.arrayContaining(["hostHref", "digest", "body"]));
  });

  it("preserves identity for exact duplicates and accepts monotonic lifecycle progress", () => {
    const announced = projection();
    expect(reduceArtifactProjection(announced, projection())).toBe(announced);

    const generating = reduceArtifactProjection(announced, projection({
      status: "generating",
      progressStage: "generating",
      progressPercent: 24,
    }));
    const processing = reduceArtifactProjection(generating, projection({
      status: "processing",
      progressStage: "processing",
      progressPercent: 61,
    }));
    const transferring = reduceArtifactProjection(processing, projection({
      status: "transferring",
      progressStage: null,
      progressPercent: null,
      mediaType: "image/png",
      sizeBytes: 2048,
    }));

    expect(processing.progressStage).toBe("processing");
    expect(processing.progressPercent).toBe(61);
    expect(transferring.progressStage).toBe("processing");
    expect(transferring.progressPercent).toBe(61);
  });

  it.each([
    ["ordinal", { ordinal: 1 }],
    ["kind", { kind: "video" as const }],
    ["provenance", { provenance: "tool" as const }],
  ])("fails closed on %s identity conflicts", (_field, overrides) => {
    const current = projection();
    expect(() => reduceArtifactProjection(current, projection(overrides)))
      .toThrowError(ArtifactProjectionError);
  });

  it("fails closed on ordinal collisions between different Artifacts", () => {
    const current = reduceArtifactList(Object.freeze([]), projection());
    const collision = projection({ artifactId: "019c1a00-0000-7000-8000-000000000104" });
    expect(() => reduceArtifactList(current, collision)).toThrowError(ArtifactProjectionError);
    expect(current).toHaveLength(1);
  });

  it("fails closed on status, progress stage, and percent regressions", () => {
    const current = projection({
      status: "processing",
      progressStage: "finalizing",
      progressPercent: 72,
    });

    expect(() => reduceArtifactProjection(current, projection({
      status: "generating",
      progressStage: "generating",
      progressPercent: 73,
    }))).toThrowError(ArtifactProjectionError);
    expect(() => reduceArtifactProjection(current, projection({
      status: "processing",
      progressStage: "processing",
      progressPercent: 73,
    }))).toThrowError(ArtifactProjectionError);
    expect(() => reduceArtifactProjection(current, projection({
      status: "processing",
      progressStage: "finalizing",
      progressPercent: 71,
    }))).toThrowError(ArtifactProjectionError);
  });

  it.each([
    ["ready", "processing"],
    ["failed", "ready"],
    ["cancelled", "ready"],
    ["expired", "ready"],
  ] as const)("rejects terminal regression from %s to %s", (from, to) => {
    const terminal = projection({
      status: from,
      progressStage: null,
      progressPercent: null,
      ...(from === "ready" || from === "expired"
        ? {
            mediaType: "image/png" as const,
            sizeBytes: 2048,
            localCommittedAt: 1_000,
            expiresAt: 605_801_000,
          }
        : { errorCode: "artifact_stopped", retryable: false }),
    });
    expect(() => reduceArtifactProjection(terminal, projection({ status: to })))
      .toThrowError(ArtifactProjectionError);
  });

  it("allows ready to expire without changing stable object identity fields", () => {
    const ready = projection({
      status: "ready",
      mediaType: "image/png",
      sizeBytes: 2048,
      localCommittedAt: 1_000,
      expiresAt: 605_801_000,
    });
    const expired = reduceArtifactProjection(ready, projection({
      status: "expired",
      mediaType: "image/png",
      sizeBytes: 2048,
      localCommittedAt: 1_000,
      expiresAt: 605_801_000,
    }));

    expect(expired.status).toBe("expired");
    expect(expired.artifactId).toBe(ready.artifactId);
    expect(expired.ordinal).toBe(ready.ordinal);
  });
});
