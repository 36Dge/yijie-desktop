import { invoke } from "@tauri-apps/api/core";
import {
  artifactNativeRequest,
  parseArtifactNativeError,
  parseArtifactPreviewOpenResponse,
  parseArtifactPreviewReleaseResponse,
  parseArtifactSaveResponse,
  type ArtifactNativeErrorShape,
  type ArtifactNativeIdentity,
  type ArtifactPreviewOpenResult,
  type ArtifactPreviewReleaseResult,
  type ArtifactSaveResult,
} from "../domain/chat-artifact-native";

export type ChatArtifactNativeInvoker = (
  command: string,
  arguments_?: Record<string, unknown>,
) => Promise<unknown>;

export class ChatArtifactNativeClientError extends Error {
  constructor(readonly shape: ArtifactNativeErrorShape) {
    super(shape.code);
    this.name = "ChatArtifactNativeClientError";
  }
}

export interface ChatArtifactNativeClient {
  openImagePreview(contextId: string, identity: ArtifactNativeIdentity): Promise<ArtifactPreviewOpenResult>;
  releaseImagePreview(contextId: string, identity: ArtifactNativeIdentity): Promise<ArtifactPreviewReleaseResult>;
  saveImage(contextId: string, identity: ArtifactNativeIdentity): Promise<ArtifactSaveResult>;
}

async function tauriInvoke(command: string, arguments_?: Record<string, unknown>): Promise<unknown> {
  return invoke<unknown>(command, arguments_);
}

const FALLBACK_ERROR: ArtifactNativeErrorShape = Object.freeze({
  schemaVersion: 1,
  requestId: null,
  code: "artifact_native_unavailable",
  retryable: false,
});

export function createChatArtifactNativeClient(
  nativeInvoke: ChatArtifactNativeInvoker = tauriInvoke,
): ChatArtifactNativeClient {
  async function run<T>(
    command: string,
    contextId: string,
    identity: ArtifactNativeIdentity,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const request = artifactNativeRequest(contextId, identity);
    try {
      return parse(await nativeInvoke(command, { request }));
    } catch (error: unknown) {
      if (error instanceof ChatArtifactNativeClientError) throw error;
      try {
        throw new ChatArtifactNativeClientError(parseArtifactNativeError(error));
      } catch (parseError: unknown) {
        if (parseError instanceof ChatArtifactNativeClientError) throw parseError;
        throw new ChatArtifactNativeClientError(FALLBACK_ERROR);
      }
    }
  }

  return {
    openImagePreview: (contextId, identity) => run(
      "chat_open_artifact_image_preview_v1", contextId, identity, parseArtifactPreviewOpenResponse,
    ),
    releaseImagePreview: (contextId, identity) => run(
      "chat_release_artifact_image_preview_v1", contextId, identity, parseArtifactPreviewReleaseResponse,
    ),
    saveImage: (contextId, identity) => run(
      "chat_save_artifact_image_v1", contextId, identity, parseArtifactSaveResponse,
    ),
  };
}

export const chatArtifactNativeClient = createChatArtifactNativeClient();
