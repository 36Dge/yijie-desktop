// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { parseS7bRuntimeSeed, runtimeObservation } from "./s7b-runtime-harness";

describe("FEAT-128 S7B runtime harness contract", () => {
  it("accepts only the content-free ready-video seed projection", () => {
    expect(parseS7bRuntimeSeed({
      schemaVersion: 1,
      contextId: "019c1a00-0000-7000-8000-000000000601",
      sessionId: "019c1a00-0000-7000-8000-000000000602",
      turnId: "019c1a00-0000-7000-8000-000000000603",
      artifactId: "019c1a00-0000-7000-8000-000000000604",
      displayName: "synthetic-video.mp4",
    })).toEqual(expect.objectContaining({ displayName: "synthetic-video.mp4" }));
    expect(() => parseS7bRuntimeSeed({
      schemaVersion: 1,
      contextId: "019c1a00-0000-7000-8000-000000000601",
      sessionId: "019c1a00-0000-7000-8000-000000000602",
      turnId: "019c1a00-0000-7000-8000-000000000603",
      artifactId: "019c1a00-0000-7000-8000-000000000604",
      displayName: "synthetic-video.mp4",
      bytes: "forbidden",
    })).toThrow("runtime_seed_invalid");
  });

  it("reports only metadata, playback, and seek booleans", () => {
    expect(runtimeObservation("passed", null)).toEqual({
      schemaVersion: 1,
      status: "passed",
      metadataReady: true,
      playbackStarted: true,
      seeked: true,
      failureCode: null,
    });
    expect(runtimeObservation("failed", "runtime_seek_timeout")).toEqual({
      schemaVersion: 1,
      status: "failed",
      metadataReady: false,
      playbackStarted: false,
      seeked: false,
      failureCode: "runtime_seek_timeout",
    });
  });
});
