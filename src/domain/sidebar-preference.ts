export const SIDEBAR_PREFERENCE_STORAGE_KEY = "yijie.desktop.ui.sidebar.v1";
export const DEFAULT_SIDEBAR_MODE = "expanded";

const SIDEBAR_MODES = ["expanded", "collapsed"] as const;

export type SidebarMode = (typeof SIDEBAR_MODES)[number];

export interface SidebarPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isSidebarMode(value: string | null): value is SidebarMode {
  return value !== null && SIDEBAR_MODES.some((mode) => mode === value);
}

export function readSidebarMode(storage: SidebarPreferenceStorage): SidebarMode {
  try {
    const storedMode = storage.getItem(SIDEBAR_PREFERENCE_STORAGE_KEY);
    return isSidebarMode(storedMode) ? storedMode : DEFAULT_SIDEBAR_MODE;
  } catch {
    return DEFAULT_SIDEBAR_MODE;
  }
}

export function writeSidebarMode(storage: SidebarPreferenceStorage, mode: SidebarMode): void {
  try {
    storage.setItem(SIDEBAR_PREFERENCE_STORAGE_KEY, mode);
  } catch {
    // Persistence is best-effort; the current in-memory UI state remains usable.
  }
}
