import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  readTaskDirectoryPreferences,
  writeTaskDirectoryPreferences,
  type TaskDirectoryPreference,
} from "../domain/task-directory-preference";
import {
  DEFAULT_SIDEBAR_MODE,
  readSidebarMode,
  writeSidebarMode,
  type SidebarMode,
  type SidebarPreferenceStorage,
} from "../domain/sidebar-preference";

export const useSidebarStore = defineStore("sidebar", () => {
  const mode = ref<SidebarMode>(DEFAULT_SIDEBAR_MODE);
  const isHydrated = ref(false);
  const taskDirectoryPreferences = ref<readonly TaskDirectoryPreference[]>([]);
  let taskDirectoryPreferencesWritable = false;
  const isCollapsed = computed(() => mode.value === "collapsed");
  let storage: SidebarPreferenceStorage | undefined;

  function hydrate(nextStorage?: SidebarPreferenceStorage): void {
    if (isHydrated.value) {
      return;
    }

    storage = nextStorage;
    mode.value = nextStorage ? readSidebarMode(nextStorage) : DEFAULT_SIDEBAR_MODE;
    const preferences = readTaskDirectoryPreferences(nextStorage);
    taskDirectoryPreferences.value = preferences.entries;
    taskDirectoryPreferencesWritable = preferences.writable;
    isHydrated.value = true;
  }

  function setMode(nextMode: SidebarMode): void {
    mode.value = nextMode;

    if (storage) {
      writeSidebarMode(storage, nextMode);
    }
  }

  function toggle(): void {
    setMode(isCollapsed.value ? "expanded" : "collapsed");
  }

  function saveTaskDirectoryPreference(entry: TaskDirectoryPreference): void {
    if (!storage || !taskDirectoryPreferencesWritable) throw new Error("task-directory-preferences-unavailable");
    const next = taskDirectoryPreferences.value.filter((value) => value.projectId !== entry.projectId);
    if (entry.removed || entry.pinnedAt !== null) next.push(entry);
    // Commit the UI only after persistence succeeds; a failed write must not look saved.
    writeTaskDirectoryPreferences(storage, next);
    taskDirectoryPreferences.value = next;
  }

  function setTaskDirectoryPinned(projectId: string, pinned: boolean): void {
    const existing = taskDirectoryPreferences.value.find((entry) => entry.projectId === projectId);
    saveTaskDirectoryPreference({ projectId, removed: false, pinnedAt: pinned ? existing?.pinnedAt ?? Math.floor(Date.now() / 1000) : null });
  }

  function removeTaskDirectory(projectId: string): void {
    saveTaskDirectoryPreference({ projectId, pinnedAt: null, removed: true });
  }

  return {
    mode,
    isCollapsed,
    isHydrated,
    taskDirectoryPreferences,
    setTaskDirectoryPinned,
    removeTaskDirectory,
    hydrate,
    setMode,
    toggle,
  };
});
