import type { SidebarPreferenceStorage } from "./sidebar-preference";

// Local UI receipts only: never persist titles, content, paths or authority.
export const CHAT_READING_STORAGE_KEY = "yijie.desktop.ui.chat-reading.v1";
export interface ChatReadingReceipt {
  readonly sessionId: string;
  readonly activityAt: number;
  readonly turnId: string | null;
}

function validReceipt(value: unknown): value is ChatReadingReceipt {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  return Object.keys(entry).length === 3
    && typeof entry.sessionId === "string" && uuid.test(entry.sessionId)
    && Number.isSafeInteger(entry.activityAt) && (entry.activityAt as number) >= 0
    && (entry.turnId === null || (typeof entry.turnId === "string" && uuid.test(entry.turnId)));
}

export function readChatReadingReceipts(storage?: SidebarPreferenceStorage): {
  entries: readonly ChatReadingReceipt[];
  writable: boolean;
} {
  if (!storage) return { entries: [], writable: false };
  try {
    const raw = storage.getItem(CHAT_READING_STORAGE_KEY);
    if (raw === null) return { entries: [], writable: true };
    const value = JSON.parse(raw);
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)
      || !value.entries.every(validReceipt)
      || new Set(value.entries.map((entry: ChatReadingReceipt) => entry.sessionId)).size !== value.entries.length) {
      return { entries: [], writable: false };
    }
    return { entries: value.entries, writable: true };
  } catch {
    return { entries: [], writable: false };
  }
}

export function writeChatReadingReceipts(storage: SidebarPreferenceStorage, entries: readonly ChatReadingReceipt[]): void {
  storage.setItem(CHAT_READING_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, entries: entries.filter(validReceipt) }));
}
