<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  resolveAppNavigation,
  type AppNavVisibilityProjection,
} from "../../navigation/app-nav";
import { useSidebarStore } from "../../stores/sidebar.store";
import YjSidebar from "./YjSidebar.vue";

const props = withDefaults(
  defineProps<{
    navigationVisibility?: AppNavVisibilityProjection;
  }>(),
  {
    navigationVisibility: () => ({}),
  },
);

const route = useRoute();
const sidebarStore = useSidebarStore();
const navigationEntries = computed(() =>
  resolveAppNavigation(undefined, props.navigationVisibility),
);

let storage: Storage | undefined;

if (typeof window !== "undefined") {
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
}

sidebarStore.hydrate(storage);
</script>

<template>
  <div class="yj-app-shell">
    <YjSidebar
      :entries="navigationEntries"
      :collapsed="sidebarStore.isCollapsed"
      :current-path="route.path"
      @toggle="sidebarStore.toggle"
    />
    <main class="yj-app-shell__content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.yj-app-shell {
  display: flex;
  width: 100%;
  min-width: var(--yj-layout-window-min-width);
  min-height: var(--yj-layout-window-min-height);
  height: 100vh;
  overflow: hidden;
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-app);
}

.yj-app-shell__content {
  min-width: 0;
  flex: 1;
  overflow: auto;
  background: var(--yj-color-bg-page);
}
</style>
