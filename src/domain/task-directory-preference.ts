import type { SidebarPreferenceStorage } from "./sidebar-preference";

// UI-only metadata. Never store paths, names, conversation content or authority here.
export const TASK_DIRECTORY_PREFERENCE_STORAGE_KEY = "yijie.desktop.ui.task-directories.v1";
export interface TaskDirectoryPreference {
  readonly projectId: string;
  readonly pinnedAt: number | null;
  readonly removed: boolean;
}

function validEntry(value: unknown): value is TaskDirectoryPreference {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).length === 3
    && typeof entry.projectId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.projectId)
    && (entry.pinnedAt === null || (Number.isSafeInteger(entry.pinnedAt) && (entry.pinnedAt as number) >= 0))
    && typeof entry.removed === "boolean"
    && (!entry.removed || entry.pinnedAt === null);
}

export function readTaskDirectoryPreferences(storage?: SidebarPreferenceStorage): {
  entries: readonly TaskDirectoryPreference[];
  writable: boolean;
} {
  if (!storage) return { entries: [], writable: false };
  try {
    const raw = storage.getItem(TASK_DIRECTORY_PREFERENCE_STORAGE_KEY);
    if (raw === null) return { entries: [], writable: true };
    const value = JSON.parse(raw);
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)
      || !value.entries.every(validEntry)
      || new Set(value.entries.map((entry: TaskDirectoryPreference) => entry.projectId)).size !== value.entries.length) {
      return { entries: [], writable: false };
    }
    return { entries: value.entries, writable: true };
  } catch {
    return { entries: [], writable: false };
  }
}

export function writeTaskDirectoryPreferences(
  storage: SidebarPreferenceStorage,
  entries: readonly TaskDirectoryPreference[],
): void {
  if (!entries.every(validEntry)) throw new Error("invalid-task-directory-preference");
  storage.setItem(TASK_DIRECTORY_PREFERENCE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, entries }));
}
