import { invoke } from "@tauri-apps/api/core";
import {
  artifactFileNativeRequest,
  parseArtifactFileNativeError,
  parseArtifactFilePreviewResponse,
  parseArtifactFileSaveResponse,
  type ArtifactFileNativeErrorShape,
  type ArtifactFileNativeIdentity,
  type ArtifactFilePreviewResult,
  type ArtifactFileSaveResult,
} from "../domain/chat-artifact-file-native";

export type ChatArtifactFileNativeInvoker = (
  command: string,
  arguments_?: Record<string, unknown>,
) => Promise<unknown>;

export class ChatArtifactFileNativeClientError extends Error {
  constructor(readonly shape: ArtifactFileNativeErrorShape) {
    super(shape.code);
    this.name = "ChatArtifactFileNativeClientError";
  }
}

export interface ChatArtifactFileNativeClient {
  readFilePreview(
    contextId: string,
    identity: ArtifactFileNativeIdentity,
  ): Promise<ArtifactFilePreviewResult>;
  saveFile(contextId: string, identity: ArtifactFileNativeIdentity): Promise<ArtifactFileSaveResult>;
}

async function tauriInvoke(command: string, arguments_?: Record<string, unknown>): Promise<unknown> {
  return invoke<unknown>(command, arguments_);
}

const FALLBACK_ERROR: ArtifactFileNativeErrorShape = Object.freeze({
  schemaVersion: 1,
  requestId: null,
  code: "artifact_native_unavailable",
  retryable: false,
});

export function createChatArtifactFileNativeClient(
  nativeInvoke: ChatArtifactFileNativeInvoker = tauriInvoke,
): ChatArtifactFileNativeClient {
  async function run<T>(
    command: string,
    contextId: string,
    identity: ArtifactFileNativeIdentity,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const request = artifactFileNativeRequest(contextId, identity);
    try {
      return parse(await nativeInvoke(command, { request }));
    } catch (error: unknown) {
      if (error instanceof ChatArtifactFileNativeClientError) throw error;
      try {
        throw new ChatArtifactFileNativeClientError(parseArtifactFileNativeError(error));
      } catch (parseError: unknown) {
        if (parseError instanceof ChatArtifactFileNativeClientError) throw parseError;
        throw new ChatArtifactFileNativeClientError(FALLBACK_ERROR);
      }
    }
  }

  return {
    readFilePreview: (contextId, identity) => run(
      "chat_read_artifact_file_preview_v1",
      contextId,
      identity,
      parseArtifactFilePreviewResponse,
    ),
    saveFile: (contextId, identity) => run(
      "chat_save_artifact_file_v1",
      contextId,
      identity,
      parseArtifactFileSaveResponse,
    ),
  };
}

export const chatArtifactFileNativeClient = createChatArtifactFileNativeClient();
