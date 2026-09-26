<script setup lang="ts">
import { computed } from "vue";
import type { AppNavEntry } from "../../navigation/app-nav";
import ChatSidebarTree from "../chat/ChatSidebarTree.vue";
import YjIcon from "./YjIcon.vue";
import YjLogo from "./YjLogo.vue";
import YjNavItem from "./YjNavItem.vue";

const props = withDefaults(defineProps<{
  entries: readonly AppNavEntry[];
  collapsed: boolean;
  currentPath: string;
  showChatTree?: boolean;
}>(), {
  showChatTree: false,
});

const emit = defineEmits<{
  "recover-new-task": [];
}>();

const mainEntries = computed(() => props.entries.filter((entry) => entry.placement === "main"));
const bottomEntries = computed(() => props.entries.filter((entry) => entry.placement === "bottom"));

function isSelected(entry: AppNavEntry): boolean {
  if (entry.kind !== "item" || entry.disabled) return false;
  return entry.key === "newTask"
    ? props.currentPath === "/chat"
    : entry.to === props.currentPath || (entry.key === "workspace" && props.currentPath.startsWith("/workflows/"));
}

function handleEntryClick(entry: AppNavEntry): void {
  if (entry.kind === "item" && entry.key === "newTask" && props.currentPath === "/chat") {
    emit("recover-new-task");
  }
}
</script>

<template>
  <aside
    class="yj-sidebar"
    :class="{ 'yj-sidebar--collapsed': collapsed, 'yj-sidebar--chat-tree': showChatTree && !collapsed }"
    :aria-label="collapsed ? '主导航（已收起）' : '主导航'"
  >
    <div class="yj-sidebar__brand">
      <YjLogo :variant="collapsed ? 'icon-only' : 'horizontal'" size="md" />
    </div>

    <nav class="yj-sidebar__navigation" aria-label="应用导航">
      <ul class="yj-sidebar__list yj-sidebar__list--main">
        <li
          v-for="entry in mainEntries"
          :key="entry.key"
          :class="{ 'yj-sidebar__history-entry': entry.kind === 'section' && entry.key === 'taskHistory' }"
        >
          <div
            v-if="entry.kind === 'section'"
            class="yj-sidebar__section"
            :class="{
              'yj-sidebar__section--collapsed': collapsed,
              'yj-sidebar__section--active': currentPath.startsWith('/chat/'),
            }"
            role="heading"
            aria-level="2"
            :aria-label="collapsed ? entry.label : undefined"
            :title="collapsed ? entry.label : undefined"
          >
            <YjIcon :name="entry.icon" :tone="currentPath.startsWith('/chat/') ? 'primary' : 'default'" />
            <span v-if="!collapsed" class="yj-sidebar__section-label">{{ entry.label }}</span>
          </div>
          <YjNavItem
            v-else
            :item="entry"
            :collapsed="collapsed"
            :selected="isSelected(entry)"
            @click="handleEntryClick(entry)"
          />
          <ChatSidebarTree
            v-if="showChatTree && entry.kind === 'section' && entry.key === 'taskHistory'"
            v-show="!collapsed"
            :current-path="currentPath"
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
  background: var(--yj-color-bg-nav);
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

.yj-sidebar__navigation {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--yj-space-3) var(--yj-space-3) var(--yj-space-4);
}

.yj-sidebar__list {
  display: flex;
  flex-direction: column;
  gap: var(--yj-space-1);
  padding: var(--yj-space-0);
  margin: var(--yj-space-0);
  list-style: none;
}

.yj-sidebar__list--main {
  --yj-nav-item-height: var(--yj-control-height-md);
  --yj-nav-item-padding-block: var(--yj-space-1);
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: hidden;
}

.yj-sidebar__list--bottom {
  margin-top: auto;
  padding-top: var(--yj-space-4);
}

.yj-sidebar__history-entry {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  margin-top: var(--yj-space-2);
}

.yj-sidebar__section {
  display: flex;
  min-height: var(--yj-space-10);
  flex: none;
  align-items: center;
  gap: var(--yj-space-3);
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-body);
}

.yj-sidebar__section--active {
  color: var(--yj-color-text-primary);
}

.yj-sidebar__section--collapsed {
  justify-content: center;
  padding-inline: var(--yj-space-2);
}

.yj-sidebar__section-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .yj-sidebar--chat-tree {
    width: 196px;
    flex-basis: 196px;
  }

  .yj-sidebar--chat-tree .yj-sidebar__navigation {
    padding-inline: var(--yj-space-2);
  }
}
</style>
