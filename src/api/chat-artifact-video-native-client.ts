import { invoke } from "@tauri-apps/api/core";
import {
  artifactVideoNativeRequest,
  parseArtifactVideoNativeError,
  parseArtifactVideoPreviewOpenResponse,
  parseArtifactVideoPreviewReleaseResponse,
  parseArtifactVideoSaveResponse,
  type ArtifactVideoNativeErrorShape,
  type ArtifactVideoNativeIdentity,
  type ArtifactVideoPreviewOpenResult,
  type ArtifactVideoPreviewReleaseResult,
  type ArtifactVideoSaveResult,
} from "../domain/chat-artifact-video-native";

export type ChatArtifactVideoNativeInvoker = (
  command: string,
  arguments_?: Record<string, unknown>,
) => Promise<unknown>;

export class ChatArtifactVideoNativeClientError extends Error {
  constructor(readonly shape: ArtifactVideoNativeErrorShape) {
    super(shape.code);
    this.name = "ChatArtifactVideoNativeClientError";
  }
}

export interface ChatArtifactVideoNativeClient {
  openVideoPreview(contextId: string, identity: ArtifactVideoNativeIdentity): Promise<ArtifactVideoPreviewOpenResult>;
  releaseVideoPreview(contextId: string, identity: ArtifactVideoNativeIdentity): Promise<ArtifactVideoPreviewReleaseResult>;
  saveVideo(contextId: string, identity: ArtifactVideoNativeIdentity): Promise<ArtifactVideoSaveResult>;
}

async function tauriInvoke(command: string, arguments_?: Record<string, unknown>): Promise<unknown> {
  return invoke<unknown>(command, arguments_);
}

const FALLBACK_ERROR: ArtifactVideoNativeErrorShape = Object.freeze({
  schemaVersion: 1,
  requestId: null,
  code: "artifact_native_unavailable",
  retryable: false,
});

export function createChatArtifactVideoNativeClient(
  nativeInvoke: ChatArtifactVideoNativeInvoker = tauriInvoke,
): ChatArtifactVideoNativeClient {
  async function run<T>(
    command: string,
    contextId: string,
    identity: ArtifactVideoNativeIdentity,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const request = artifactVideoNativeRequest(contextId, identity);
    try {
      return parse(await nativeInvoke(command, { request }));
    } catch (error: unknown) {
      if (error instanceof ChatArtifactVideoNativeClientError) throw error;
      try {
        throw new ChatArtifactVideoNativeClientError(parseArtifactVideoNativeError(error));
      } catch (parseError: unknown) {
        if (parseError instanceof ChatArtifactVideoNativeClientError) throw parseError;
        throw new ChatArtifactVideoNativeClientError(FALLBACK_ERROR);
      }
    }
  }

  return {
    openVideoPreview: (contextId, identity) => run(
      "chat_open_artifact_video_preview_v1", contextId, identity, parseArtifactVideoPreviewOpenResponse,
    ),
    releaseVideoPreview: (contextId, identity) => run(
      "chat_release_artifact_video_preview_v1", contextId, identity, parseArtifactVideoPreviewReleaseResponse,
    ),
    saveVideo: (contextId, identity) => run(
      "chat_save_artifact_video_v1", contextId, identity, parseArtifactVideoSaveResponse,
    ),
  };
}

export const chatArtifactVideoNativeClient = createChatArtifactVideoNativeClient();
