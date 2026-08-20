import { describe, expect, it, vi } from "vitest";
import { createChatArtifactNativeClient } from "./chat-artifact-native-client";

const REQUEST_ID = "019c1a00-0000-7000-8000-000000000071";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000072";
const IDENTITY = Object.freeze({
  sessionId: "019c1a00-0000-7000-8000-000000000073",
  turnId: "019c1a00-0000-7000-8000-000000000074",
  artifactId: "019c1a00-0000-7000-8000-000000000075",
});

describe("Artifact native client", () => {
  it("invokes only exact commands with identity-only payloads", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const invoke = vi.fn(async (
      command: string,
      arguments_?: Record<string, unknown>,
    ) => {
      void arguments_;
      if (command === "chat_open_artifact_image_preview_v1") return {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        data: {
          status: "opened",
          previewUrl: `yijie-artifact-preview://localhost/v1/${"A".repeat(43)}`,
        },
      };
      if (command === "chat_release_artifact_image_preview_v1") return {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        data: { status: "released" },
      };
      return {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        data: { status: "saved", code: null },
      };
    });
    const client = createChatArtifactNativeClient(invoke);

    await client.openImagePreview(CONTEXT_ID, IDENTITY);
    await client.releaseImagePreview(CONTEXT_ID, IDENTITY);
    await client.saveImage(CONTEXT_ID, IDENTITY);

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "chat_open_artifact_image_preview_v1",
      "chat_release_artifact_image_preview_v1",
      "chat_save_artifact_image_v1",
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

  it("maps only closed content-free errors", async () => {
    const stable = createChatArtifactNativeClient(async () => {
      throw {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        code: "artifact_native_not_ready",
        retryable: false,
      };
    });
    await expect(stable.saveImage(CONTEXT_ID, IDENTITY)).rejects.toMatchObject({
      shape: { code: "artifact_native_not_ready" },
    });

    const arbitrary = createChatArtifactNativeClient(async () => {
      throw { message: "secret /Users/example/output.png" };
    });
    await expect(arbitrary.saveImage(CONTEXT_ID, IDENTITY)).rejects.toMatchObject({
      shape: { code: "artifact_native_unavailable" },
    });
  });
});
