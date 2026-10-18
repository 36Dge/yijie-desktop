import { invoke } from "@tauri-apps/api/core";
import { artifactFileNativeRequest, type ArtifactFileNativeIdentity } from "../domain/chat-artifact-file-native";

// Same identity-only request and Native authorization as file preview/save.
export async function openArtifactHTML(contextId: string, identity: ArtifactFileNativeIdentity): Promise<void> {
  const request = artifactFileNativeRequest(contextId, identity);
  const value: unknown = await invoke("chat_open_artifact_html_preview_v1", { request });
  if (typeof value !== "object" || value === null) throw Error("artifact_native_unavailable");
  const response = value as Record<string, unknown>;
  if (Object.keys(response).sort().join() !== "data,requestId,schemaVersion" ||
      response.schemaVersion !== 1 || response.requestId !== request.requestId ||
      typeof response.data !== "object" || response.data === null ||
      Object.keys(response.data).join() !== "status" ||
      (response.data as Record<string, unknown>).status !== "opened") throw Error("artifact_native_unavailable");
}
export async function closeArtifactHTML(contextId: string, identity: ArtifactFileNativeIdentity): Promise<void> {
  await invoke("chat_close_artifact_html_preview_v1", { request: artifactFileNativeRequest(contextId, identity) });
}
