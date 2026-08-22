import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  CHAT_ARTIFACT_LIVE_EVENT_CHANNEL,
  parseChatArtifactLiveEvent,
  type ChatArtifactLiveEvent,
} from "../domain/chat-artifact-live";

export type ChatArtifactLiveListen = (
  channel: string,
  handler: (payload: unknown) => void,
) => Promise<UnlistenFn>;

export interface ChatArtifactLiveClient {
  listen(
    handler: (event: ChatArtifactLiveEvent) => void,
    onInvalid?: () => void,
  ): Promise<UnlistenFn>;
}

const productionListen: ChatArtifactLiveListen = (channel, handler) =>
  listen<unknown>(channel, (event) => handler(event.payload));

export function createChatArtifactLiveClient(
  nativeListen: ChatArtifactLiveListen = productionListen,
): ChatArtifactLiveClient {
  return {
    listen(handler, onInvalid) {
      return nativeListen(CHAT_ARTIFACT_LIVE_EVENT_CHANNEL, (payload) => {
        try {
          handler(parseChatArtifactLiveEvent(payload));
        } catch {
          onInvalid?.();
        }
      });
    },
  };
}

export const chatArtifactLiveClient = createChatArtifactLiveClient();
