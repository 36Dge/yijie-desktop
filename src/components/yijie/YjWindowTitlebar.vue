<script setup lang="ts">
import YjTooltip from "./YjTooltip.vue";
import { computed } from "vue";
import YjIcon from "./YjIcon.vue";

const props = withDefaults(defineProps<{ collapsed: boolean; sidebarVisible?: boolean }>(), { sidebarVisible: true });
const emit = defineEmits<{ toggle: [] }>();
const toggleLabel = computed(() => props.collapsed ? "展开侧栏" : "收起侧栏");
</script>

<template>
  <header class="yj-window-titlebar" data-tauri-drag-region>
    <YjTooltip v-if="sidebarVisible" :text="toggleLabel"><button

      class="yj-window-titlebar__sidebar-toggle"
      type="button"
      :aria-label="toggleLabel"

      :aria-expanded="!collapsed"
      @click="emit('toggle')"
    >
      <YjIcon name="sidebar" size="sm" tone="muted" :stroke-width="1.5" />
    </button></YjTooltip>
  </header>
</template>

<style scoped>
.yj-window-titlebar {
  display: flex;
  height: var(--yj-layout-titlebar-height);
  flex: none;
  align-items: center;
  padding-left: var(--yj-layout-titlebar-controls-inset);
  color: var(--yj-color-icon-default);
  background: transparent;
  user-select: none;
  /* Native window controls do not scale with the content zoom. */
  zoom: calc(1 / var(--yj-ui-scale, 1));
}

.yj-window-titlebar__sidebar-toggle {
  display: inline-flex;
  width: var(--yj-space-8);
  height: var(--yj-space-8);
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: inherit;
  background: transparent;
}
.yj-window-titlebar__sidebar-toggle:hover { background: var(--yj-color-nav-hover); }
.yj-window-titlebar__sidebar-toggle:active { background: var(--yj-color-nav-pressed); }
.yj-window-titlebar__sidebar-toggle:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: calc(-1 * var(--yj-space-1));
}
</style>
