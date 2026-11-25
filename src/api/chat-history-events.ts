import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Content-free invalidation; refreshed history still requires the native context. */
function onHistoryInvalidation(channel: string, handler: () => void): Promise<UnlistenFn> {
  return listen<unknown>(channel, ({ payload }) => {
    if (payload && typeof payload === "object" && !Array.isArray(payload)
      && Object.keys(payload).length === 1 && "schemaVersion" in payload
      && payload.schemaVersion === 1) handler();
  });
}

export function onChatHistoryChanged(handler: () => void): Promise<UnlistenFn> {
  return onHistoryInvalidation("yijie://chat-history-changed-v1", handler);
}

export function onScheduledRunCreated(handler: () => void): Promise<UnlistenFn> {
  return onHistoryInvalidation("yijie://scheduled-run-created-v1", handler);
}
