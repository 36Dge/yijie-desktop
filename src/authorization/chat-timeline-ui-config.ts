import type { InjectionKey } from "vue";

const ENABLED_VALUE = "true";

export const LEGACY_CHAT_TIMELINE_ROLLBACK_KEY: InjectionKey<boolean> =
  Symbol("legacy-chat-timeline-rollback");

export function isLegacyChatTimelineRollbackEnabled(value: unknown): boolean {
  return value === ENABLED_VALUE;
}

export const legacyChatTimelineRollbackEnabled =
  isLegacyChatTimelineRollbackEnabled(
    import.meta.env.VITE_YIJIE_LEGACY_CHAT_TIMELINE_ROLLBACK_ENABLED,
  );
