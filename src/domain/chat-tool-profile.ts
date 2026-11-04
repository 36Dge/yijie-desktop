export type { ToolProfile } from "./market-selection-v2.generated";

// The fixed entry enables this only after the paired Host/Native source checks.
export function lightChatEnabled(): boolean {
  return import.meta.env.VITE_YIJIE_LIGHT_CHAT_ENABLED === "true";
}
