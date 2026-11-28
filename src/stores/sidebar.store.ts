import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { ChatSidebarHistory } from "../domain/chat-sidebar-history";
import { readSessionOrders, saveSessionMove, type MovePlacement, type SessionOrders } from "../domain/sidebar-session-order";
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
  const sessionOrders = shallowRef<SessionOrders>({});
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
    if (storage) sessionOrders.value = readSessionOrders(storage);
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

  function moveSession(group: string, history: ChatSidebarHistory, sourceId: string, targetId: string, placement: MovePlacement): void {
    if (!storage) throw new Error("sidebar-session-order-unavailable");
    const updated = saveSessionMove(storage, group, history, sourceId, targetId, placement);
    sessionOrders.value = { ...sessionOrders.value, ...updated };
  }

  return {
    mode,
    isCollapsed,
    isHydrated,
    taskDirectoryPreferences,
    sessionOrders,
    moveSession,
    setTaskDirectoryPinned,
    removeTaskDirectory,
    hydrate,
    setMode,
    toggle,
  };
});
