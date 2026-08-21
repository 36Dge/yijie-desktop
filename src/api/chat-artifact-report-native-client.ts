import { invoke } from "@tauri-apps/api/core";
import {
  artifactReportNativeRequest,
  parseArtifactReportNativeError,
  parseArtifactReportPreviewResponse,
  parseArtifactReportSaveResponse,
  type ArtifactReportNativeErrorShape,
  type ArtifactReportNativeIdentity,
  type ArtifactReportPreviewResult,
  type ArtifactReportSaveResult,
} from "../domain/chat-artifact-report-native";

export type ChatArtifactReportNativeInvoker = (
  command: string,
  arguments_?: Record<string, unknown>,
) => Promise<unknown>;

export class ChatArtifactReportNativeClientError extends Error {
  constructor(readonly shape: ArtifactReportNativeErrorShape) {
    super(shape.code);
    this.name = "ChatArtifactReportNativeClientError";
  }
}

export interface ChatArtifactReportNativeClient {
  readReportPreview(contextId: string, identity: ArtifactReportNativeIdentity): Promise<ArtifactReportPreviewResult>;
  saveReport(contextId: string, identity: ArtifactReportNativeIdentity): Promise<ArtifactReportSaveResult>;
}

async function tauriInvoke(command: string, arguments_?: Record<string, unknown>): Promise<unknown> {
  return invoke<unknown>(command, arguments_);
}

const FALLBACK_ERROR: ArtifactReportNativeErrorShape = Object.freeze({
  schemaVersion: 1,
  requestId: null,
  code: "artifact_native_unavailable",
  retryable: false,
});

export function createChatArtifactReportNativeClient(
  nativeInvoke: ChatArtifactReportNativeInvoker = tauriInvoke,
): ChatArtifactReportNativeClient {
  async function run<T>(
    command: string,
    contextId: string,
    identity: ArtifactReportNativeIdentity,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const request = artifactReportNativeRequest(contextId, identity);
    try {
      return parse(await nativeInvoke(command, { request }));
    } catch (error: unknown) {
      if (error instanceof ChatArtifactReportNativeClientError) throw error;
      try {
        throw new ChatArtifactReportNativeClientError(parseArtifactReportNativeError(error));
      } catch (parseError: unknown) {
        if (parseError instanceof ChatArtifactReportNativeClientError) throw parseError;
        throw new ChatArtifactReportNativeClientError(FALLBACK_ERROR);
      }
    }
  }

  return {
    readReportPreview: (contextId, identity) => run(
      "chat_read_artifact_report_preview_v1",
      contextId,
      identity,
      parseArtifactReportPreviewResponse,
    ),
    saveReport: (contextId, identity) => run(
      "chat_save_artifact_report_v1",
      contextId,
      identity,
      parseArtifactReportSaveResponse,
    ),
  };
}

export const chatArtifactReportNativeClient = createChatArtifactReportNativeClient();
