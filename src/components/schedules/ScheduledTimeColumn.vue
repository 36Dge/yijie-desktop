<script setup lang="ts">
import { onMounted, ref, useId, watch } from "vue";

const props = defineProps<{ label: string; count: number; value: string; initialFocus?: boolean }>();
const emit = defineEmits<{ select: [value: string]; finish: [] }>();
const id = useId();
const list = ref<HTMLElement | null>(null);
const values = Array.from({ length: props.count }, (_, i) => String(i).padStart(2, "0"));
function reveal() {
  const el = list.value;
  const item = el?.querySelector<HTMLElement>('[aria-selected="true"]');
  if (el && item) el.scrollTop = item.offsetTop - (el.clientHeight - item.offsetHeight) / 2;
}
function key(event: KeyboardEvent) {
  const index = Number(props.value);
  const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: values.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  emit("select", values[(next + values.length) % values.length]!);
}
onMounted(reveal);
watch(() => props.value, reveal, { flush: "post" });
</script>
<template>
  <div class="time-column">
    <span :id="id" class="time-column__label">{{ label }}</span>
    <div ref="list" class="time-column__list" role="listbox" tabindex="0" :aria-labelledby="id"
      :aria-activedescendant="`${id}-${value}`" :data-picker-focus="initialFocus || undefined"
      @keydown="key" @keydown.enter.stop.prevent="emit('finish')">
      <button v-for="item in values" :id="`${id}-${item}`" :key="item" type="button" role="option" tabindex="-1"
        :aria-selected="value === item" @mousedown.prevent @click="list?.focus({ preventScroll: true }); emit('select', item)">{{ item }}</button>
    </div>
  </div>
</template>
<style scoped>
.time-column { min-width: 0; text-align: center; }
.time-column__label { display: block; padding-bottom: var(--yj-space-2); font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); }
.time-column__list {
  position: relative; height: clamp(var(--yj-space-16), calc(var(--schedule-picker-height, 32rem) - var(--yj-space-16) - var(--yj-space-10)), calc(var(--yj-control-height-sm) * 5)); overflow-y: auto; overscroll-behavior: contain;
  padding-inline: var(--yj-space-1); scrollbar-width: thin; scrollbar-color: var(--yj-color-border-default) transparent; border-radius: var(--yj-radius-md);
}
.time-column__list:focus-visible { outline: var(--yj-border-width) solid var(--yj-color-border-strong); outline-offset: 1px; }
.time-column button {
  display: block; width: 100%; height: var(--yj-control-height-sm); padding: 0; border: 0; border-radius: var(--yj-radius-sm);
  background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums;
}
.time-column button:hover { background: var(--yj-color-control-hover); }
.time-column button[aria-selected="true"] { background: var(--yj-color-brand-primary); color: var(--yj-color-on-brand); font-weight: var(--yj-font-weight-semibold); }
</style>
