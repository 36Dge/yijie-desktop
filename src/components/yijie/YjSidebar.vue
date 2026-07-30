<script setup lang="ts">
import { computed } from "vue";
import type { AppNavEntry } from "../../navigation/app-nav";
import YjIcon from "./YjIcon.vue";
import YjLogo from "./YjLogo.vue";
import YjNavItem from "./YjNavItem.vue";

const props = defineProps<{
  entries: readonly AppNavEntry[];
  collapsed: boolean;
  currentPath: string;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const mainEntries = computed(() => props.entries.filter((entry) => entry.placement === "main"));
const bottomEntries = computed(() => props.entries.filter((entry) => entry.placement === "bottom"));
const toggleLabel = computed(() => (props.collapsed ? "展开侧栏" : "收起侧栏"));

function isSelected(entry: AppNavEntry): boolean {
  return entry.kind === "item" && !entry.disabled && entry.to === props.currentPath;
}
</script>

<template>
  <aside
    class="yj-sidebar"
    :class="{ 'yj-sidebar--collapsed': collapsed }"
    :aria-label="collapsed ? '主导航（已收起）' : '主导航'"
  >
    <div class="yj-sidebar__brand">
      <YjLogo :variant="collapsed ? 'icon-only' : 'horizontal'" size="md" />
      <button
        class="yj-sidebar__toggle"
        type="button"
        :aria-label="toggleLabel"
        :title="toggleLabel"
        :aria-expanded="!collapsed"
        @click="emit('toggle')"
      >
        <YjIcon :name="collapsed ? 'expandSidebar' : 'collapseSidebar'" size="sm" />
      </button>
    </div>

    <nav class="yj-sidebar__navigation" aria-label="应用导航">
      <ul class="yj-sidebar__list">
        <li v-for="entry in mainEntries" :key="entry.key">
          <div v-if="entry.kind === 'divider'" class="yj-sidebar__divider" role="separator" />
          <YjNavItem
            v-else
            :item="entry"
            :collapsed="collapsed"
            :selected="isSelected(entry)"
          />
        </li>
      </ul>

      <ul class="yj-sidebar__list yj-sidebar__list--bottom">
        <li v-for="entry in bottomEntries" :key="entry.key">
          <YjNavItem
            v-if="entry.kind === 'item'"
            :item="entry"
            :collapsed="collapsed"
            :selected="isSelected(entry)"
          />
        </li>
      </ul>
    </nav>
  </aside>
</template>

<style scoped>
.yj-sidebar {
  position: relative;
  z-index: 1;
  display: flex;
  width: var(--yj-layout-sidebar-expanded);
  flex: 0 0 var(--yj-layout-sidebar-expanded);
  flex-direction: column;
  border-right: 1px solid var(--yj-color-border-subtle);
  background: var(--yj-color-bg-card);
  transition:
    width var(--yj-motion-base) var(--yj-ease-standard),
    flex-basis var(--yj-motion-base) var(--yj-ease-standard);
}

.yj-sidebar--collapsed {
  width: var(--yj-layout-sidebar-collapsed);
  flex-basis: var(--yj-layout-sidebar-collapsed);
}

.yj-sidebar__brand {
  position: relative;
  display: flex;
  min-height: var(--yj-space-16);
  align-items: center;
  padding-inline: var(--yj-space-4);
  border-bottom: 1px solid var(--yj-color-border-subtle);
}

.yj-sidebar--collapsed .yj-sidebar__brand {
  justify-content: center;
  padding-inline: var(--yj-space-3);
}

.yj-sidebar__toggle {
  position: absolute;
  top: 50%;
  right: calc(var(--yj-space-4) * -1);
  display: inline-flex;
  width: var(--yj-space-8);
  height: var(--yj-space-8);
  align-items: center;
  justify-content: center;
  padding: var(--yj-space-0);
  transform: translateY(-50%);
  border: 1px solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-icon-default);
  background: var(--yj-color-bg-elevated);
  box-shadow: var(--yj-shadow-xs);
  cursor: pointer;
  transition:
    color var(--yj-motion-fast) var(--yj-ease-standard),
    border-color var(--yj-motion-fast) var(--yj-ease-standard),
    background-color var(--yj-motion-fast) var(--yj-ease-standard);
}

.yj-sidebar__toggle:hover {
  border-color: var(--yj-color-brand-border);
  color: var(--yj-color-brand-text);
  background: var(--yj-color-brand-soft);
}

.yj-sidebar__toggle:focus-visible {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.yj-sidebar__navigation {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--yj-space-5) var(--yj-space-3) var(--yj-space-4);
}

.yj-sidebar__list {
  display: flex;
  flex-direction: column;
  gap: var(--yj-space-1);
  padding: var(--yj-space-0);
  margin: var(--yj-space-0);
  list-style: none;
}

.yj-sidebar__list--bottom {
  margin-top: auto;
  padding-top: var(--yj-space-4);
}

.yj-sidebar__divider {
  height: 1px;
  margin: var(--yj-space-3);
  background: var(--yj-color-border-subtle);
}
</style>
