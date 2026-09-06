<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  items: readonly {
    key: string;
    label: string;
  }[];
  modelValue: string;
  ariaLabel?: string;
  "aria-label"?: string;
  panelId?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [key: string];
}>();

const tabElements = ref<HTMLButtonElement[]>([]);
const accessibleLabel = computed(() =>
  props.ariaLabel ?? props["aria-label"] ?? "筛选选项"
);

function tabId(key: string): string | undefined {
  return props.panelId ? `${props.panelId}-tab-${key}` : undefined;
}

function select(key: string): void {
  if (key === props.modelValue) return;
  emit("update:modelValue", key);
}

function handleKeydown(event: KeyboardEvent, currentIndex: number): void {
  if (props.items.length === 0) return;

  let nextIndex: number;
  switch (event.key) {
    case "ArrowLeft":
      nextIndex = (currentIndex - 1 + props.items.length) % props.items.length;
      break;
    case "ArrowRight":
      nextIndex = (currentIndex + 1) % props.items.length;
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = props.items.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  const nextItem = props.items[nextIndex];
  if (!nextItem) return;
  tabElements.value[nextIndex]?.focus();
  select(nextItem.key);
}
</script>

<template>
  <div class="yj-tabs" role="tablist" :aria-label="accessibleLabel">
    <button
      v-for="(item, index) in items"
      :key="item.key"
      ref="tabElements"
      class="yj-tabs__tab"
      :class="{ 'yj-tabs__tab--selected': item.key === modelValue }"
      type="button"
      role="tab"
      :id="tabId(item.key)"
      :aria-controls="panelId"
      :aria-selected="item.key === modelValue"
      :tabindex="item.key === modelValue ? 0 : -1"
      @click="select(item.key)"
      @keydown="handleKeydown($event, index)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<style scoped>
.yj-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--yj-space-2);
}

.yj-tabs__tab {
  min-height: var(--yj-space-8);
  padding: var(--yj-space-1) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  transition:
    color var(--yj-motion-fast) var(--yj-ease-standard),
    border-color var(--yj-motion-fast) var(--yj-ease-standard),
    background-color var(--yj-motion-fast) var(--yj-ease-standard);
}

.yj-tabs__tab:hover {
  border-color: var(--yj-color-border-control-hover);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-control-hover);
}

.yj-tabs__tab:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}

.yj-tabs__tab--selected {
  border-color: var(--yj-color-on-brand);
  color: var(--yj-color-on-brand);
  background: var(--yj-color-brand-primary);
  font-weight: var(--yj-font-weight-semibold);
}
.yj-tabs__tab:active {
  color: var(--yj-color-text-primary);
  border-color: var(--yj-color-border-control-hover);
  background: var(--yj-color-control-pressed);
}

.yj-tabs__tab--selected:hover {
  color: var(--yj-color-on-brand);
  border-color: var(--yj-color-on-brand);
  background: var(--yj-color-brand-hover);
}

.yj-tabs__tab--selected:active {
  color: var(--yj-color-on-brand);
  border-color: var(--yj-color-on-brand);
  background: var(--yj-color-brand-active);
}
</style>
