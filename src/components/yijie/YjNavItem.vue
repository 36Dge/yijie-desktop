<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { AppNavItem } from "../../navigation/app-nav";
import YjIcon from "./YjIcon.vue";

const props = defineProps<{
  item: AppNavItem;
  collapsed: boolean;
  selected: boolean;
}>();

const routeTarget = computed(() => (props.item.disabled ? undefined : props.item.to));
const accessibleLabel = computed(() =>
  props.item.disabled ? `${props.item.label}，即将开放` : props.item.label,
);
</script>

<template>
  <RouterLink
    v-if="routeTarget"
    class="yj-nav-item"
    :class="{ 'yj-nav-item--selected': selected, 'yj-nav-item--collapsed': collapsed }"
    :to="routeTarget"
    :aria-current="selected ? 'page' : undefined"
    :aria-label="collapsed ? accessibleLabel : undefined"
    :title="collapsed ? accessibleLabel : undefined"
  >
    <YjIcon :name="item.icon" :tone="selected ? 'primary' : 'default'" />
    <span v-if="!collapsed" class="yj-nav-item__label">{{ item.label }}</span>
  </RouterLink>

  <div
    v-else
    class="yj-nav-item yj-nav-item--disabled"
    :class="{ 'yj-nav-item--collapsed': collapsed }"
    aria-disabled="true"
    :aria-label="accessibleLabel"
    :title="collapsed ? accessibleLabel : undefined"
  >
    <YjIcon :name="item.icon" tone="muted" />
    <span v-if="!collapsed" class="yj-nav-item__label">{{ item.label }}</span>
    <span v-if="!collapsed" class="yj-nav-item__status">即将开放</span>
  </div>
</template>

<style scoped>
.yj-nav-item {
  display: flex;
  min-height: var(--yj-space-10);
  align-items: center;
  gap: var(--yj-space-3);
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-body);
  font-weight: 500;
  line-height: var(--yj-line-height-body);
  text-decoration: none;
  transition:
    color var(--yj-motion-fast) var(--yj-ease-standard),
    background-color var(--yj-motion-fast) var(--yj-ease-standard);
}

.yj-nav-item:not(.yj-nav-item--disabled):hover {
  color: var(--yj-color-text-primary);
  background: var(--yj-color-control-hover);
}

.yj-nav-item:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: calc(var(--yj-space-1) * -1);
}

.yj-nav-item--selected {
  color: var(--yj-color-text-primary);
  background: var(--yj-color-control-hover);
}

.yj-nav-item:not(.yj-nav-item--disabled):active {
  background: var(--yj-color-control-pressed);
}

.yj-nav-item--collapsed {
  justify-content: center;
  padding-inline: var(--yj-space-2);
}

.yj-nav-item--disabled {
  color: var(--yj-color-text-disabled);
  cursor: not-allowed;
}

.yj-nav-item--disabled :deep(.yj-icon) {
  color: var(--yj-color-text-disabled);
}

.yj-nav-item--disabled:hover {
  color: var(--yj-color-text-disabled);
  background: transparent;
}

.yj-nav-item__label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yj-nav-item__status {
  flex-shrink: 0;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
</style>
