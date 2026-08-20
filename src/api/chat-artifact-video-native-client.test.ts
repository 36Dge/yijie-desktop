import { describe, expect, it, vi } from "vitest";
import { createChatArtifactVideoNativeClient } from "./chat-artifact-video-native-client";

const REQUEST_ID = "019c1a00-0000-7000-8000-000000000091";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000092";
const IDENTITY = Object.freeze({
  sessionId: "019c1a00-0000-7000-8000-000000000093",
  turnId: "019c1a00-0000-7000-8000-000000000094",
  artifactId: "019c1a00-0000-7000-8000-000000000095",
});

describe("Artifact video native client", () => {
  it("invokes only the three exact commands with identity-only payloads", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const invoke = vi.fn(async (
      command: string,
      arguments_?: Record<string, unknown>,
    ) => {
      void arguments_;
      return {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        data: command.includes("open")
          ? { status: "opened", previewUrl: `yijie-artifact-video://localhost/v1/${"A".repeat(43)}` }
          : command.includes("release")
            ? { status: "released" }
            : { status: "saved", code: null },
      };
    });
    const client = createChatArtifactVideoNativeClient(invoke);

    await client.openVideoPreview(CONTEXT_ID, IDENTITY);
    await client.releaseVideoPreview(CONTEXT_ID, IDENTITY);
    await client.saveVideo(CONTEXT_ID, IDENTITY);

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "chat_open_artifact_video_preview_v1",
      "chat_release_artifact_video_preview_v1",
      "chat_save_artifact_video_v1",
    ]);
    for (const [, arguments_] of invoke.mock.calls) {
      expect(arguments_).toEqual({
        request: {
          schemaVersion: 1,
          requestId: REQUEST_ID,
          contextId: CONTEXT_ID,
          payload: IDENTITY,
        },
      });
      expect(JSON.stringify(arguments_)).not.toMatch(
        /(?:bytes|base64|digest|sha256|contentHref|hostHref|path|filename|token)/i,
      );
    }
  });

  it("maps malformed native failures to the closed unavailable code", async () => {
    const client = createChatArtifactVideoNativeClient(async () => {
      throw { message: "secret /Users/example/movie.mp4" };
    });
    await expect(client.saveVideo(CONTEXT_ID, IDENTITY)).rejects.toMatchObject({
      shape: { code: "artifact_native_unavailable" },
    });
  });
});
