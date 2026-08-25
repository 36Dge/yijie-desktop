import { demoFastLocalProfileEnabled } from "./local-profile";

const ENABLED_VALUE = "true";

export function isLocalChatUiEnabled(value: unknown): boolean {
  return value === ENABLED_VALUE;
}

export const localChatUiEnabled =
  demoFastLocalProfileEnabled ||
  isLocalChatUiEnabled(import.meta.env.VITE_YIJIE_CHAT_LOCAL_UI_ENABLED);
