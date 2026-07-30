import { computed, ref } from "vue";
import { defineStore } from "pinia";
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
  const isCollapsed = computed(() => mode.value === "collapsed");
  let storage: SidebarPreferenceStorage | undefined;

  function hydrate(nextStorage?: SidebarPreferenceStorage): void {
    if (isHydrated.value) {
      return;
    }

    storage = nextStorage;
    mode.value = nextStorage ? readSidebarMode(nextStorage) : DEFAULT_SIDEBAR_MODE;
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

  return {
    mode,
    isCollapsed,
    isHydrated,
    hydrate,
    setMode,
    toggle,
  };
});
