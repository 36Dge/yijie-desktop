<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(defineProps<{
  items: readonly {
    key: string;
    label: string;
    count?: number;
  }[];
  modelValue: string;
  ariaLabel?: string;
  "aria-label"?: string;
  panelId?: string;
  variant?: "pill" | "line";
}>(), { variant: "pill" });

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
  <div class="yj-tabs" :class="`yj-tabs--${variant}`" role="tablist" :aria-label="accessibleLabel">
    <button
      v-for="(item, index) in items"
      :key="item.key"
      ref="tabElements"
      class="yj-tabs__tab yj-control"
      :class="{ 'yj-control--pill': variant === 'pill', 'yj-tabs__tab--selected': item.key === modelValue }"
      type="button"
      role="tab"
      :id="tabId(item.key)"
      :aria-controls="panelId"
      :aria-selected="item.key === modelValue"
      :aria-label="item.count === undefined ? undefined : `${item.label} ${item.count}`"
      :tabindex="item.key === modelValue ? 0 : -1"
      @click="select(item.key)"
      @keydown="handleKeydown($event, index)"
    >
      {{ item.label }}<span v-if="item.count !== undefined" class="yj-tabs__count"> {{ item.count }}</span>
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
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
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

.yj-tabs__count {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-regular);
  font-variant-numeric: tabular-nums;
}

.yj-tabs--line {
  gap: var(--yj-space-6);
  align-self: stretch;
}

.yj-tabs--line .yj-tabs__tab {
  --yj-control-height: var(--yj-space-12);
  position: relative;
  padding: 0 var(--yj-space-1);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-card-title);
  font-weight: var(--yj-font-weight-regular);
  line-height: var(--yj-line-height-body);
}

.yj-tabs--line .yj-tabs__tab:hover,
.yj-tabs--line .yj-tabs__tab:active,
.yj-tabs--line .yj-tabs__tab--selected {
  color: var(--yj-color-text-primary);
  background: transparent;
}

.yj-tabs--line .yj-tabs__tab--selected {
  font-weight: var(--yj-font-weight-semibold);
}

.yj-tabs--line .yj-tabs__tab--selected::after {
  content: "";
  position: absolute;
  inset-inline: var(--yj-space-1);
  bottom: calc(var(--yj-border-width) * -1);
  height: var(--yj-space-1);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-brand-primary);
}
</style>
