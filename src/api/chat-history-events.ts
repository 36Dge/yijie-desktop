import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Content-free invalidation; refreshed history still requires the native context. */
export function onChatHistoryChanged(handler: () => void): Promise<UnlistenFn> {
  return listen<unknown>("yijie://chat-history-changed-v1", ({ payload }) => {
    if (payload && typeof payload === "object" && !Array.isArray(payload)
      && Object.keys(payload).length === 1 && "schemaVersion" in payload
      && payload.schemaVersion === 1) handler();
  });
}
