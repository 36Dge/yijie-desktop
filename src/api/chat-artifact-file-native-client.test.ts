import { describe, expect, it, vi } from "vitest";
import { createChatArtifactFileNativeClient } from "./chat-artifact-file-native-client";

const REQUEST_ID = "019c1a00-0000-7000-8000-0000000000b1";
const CONTEXT_ID = "019c1a00-0000-7000-8000-0000000000b2";
const IDENTITY = Object.freeze({
  sessionId: "019c1a00-0000-7000-8000-0000000000b3",
  turnId: "019c1a00-0000-7000-8000-0000000000b4",
  artifactId: "019c1a00-0000-7000-8000-0000000000b5",
});

describe("Artifact file native client", () => {
  it("invokes only read-preview and save with identity-only payloads", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const invoke = vi.fn(async (
      command: string,
      arguments_?: Record<string, unknown>,
    ) => {
      void arguments_;
      return {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        data: command.includes("read")
          ? { status: "previewed", mediaType: "text/plain", text: "safe", truncated: false }
          : { status: "saved", code: null },
      };
    });
    const client = createChatArtifactFileNativeClient(invoke);

    await client.readFilePreview(CONTEXT_ID, IDENTITY);
    await client.saveFile(CONTEXT_ID, IDENTITY);

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "chat_read_artifact_file_preview_v1",
      "chat_save_artifact_file_v1",
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

  it("maps arbitrary native failures to closed unavailable", async () => {
    const client = createChatArtifactFileNativeClient(async () => {
      throw { message: "secret /Users/example/file.csv" };
    });
    await expect(client.saveFile(CONTEXT_ID, IDENTITY)).rejects.toMatchObject({
      shape: { code: "artifact_native_unavailable" },
    });
  });
});
