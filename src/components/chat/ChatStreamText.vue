<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{ text: string; streaming?: boolean }>(), { streaming: false });
// Only animation ranges are retained. Every received character is rendered immediately;
// there is no playback queue or second authoritative copy of the model output.
const ranges = ref<{ start: number; end: number }[]>([]);
const prefix = computed(() => props.text.slice(0, ranges.value[0]?.start ?? props.text.length));
watch(() => [props.text, props.streaming] as const, ([text, streaming], previous) => {
  const [before, wasStreaming] = previous ?? ["", streaming];
  if (!streaming || !wasStreaming || !text.startsWith(before)) {
    ranges.value = [];
    return;
  }
  if (text.length > before.length) {
    ranges.value = [...ranges.value, { start: before.length, end: text.length }].slice(-32);
  }
}, { immediate: true });
function settle(end: number) {
  // The page freezes native updates during selection. Decorative cleanup must
  // respect that same reading interaction instead of replacing selected nodes.
  if (document.getSelection()?.isCollapsed === false) return;
  ranges.value = ranges.value.filter(range => range.end > end);
}
</script>

<template>
  {{ prefix }}<span v-for="range in ranges" :key="range.start" class="chat-stream-text__fresh"
    @animationend="settle(range.end)">{{ text.slice(range.start, range.end) }}</span>
</template>

<style scoped>
.chat-stream-text__fresh {
  animation: chat-stream-arrive var(--yj-motion-slow) var(--yj-ease-standard) both;
}
@keyframes chat-stream-arrive {
  from { opacity: var(--yj-opacity-chat-stream-start); }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .chat-stream-text__fresh { animation: none; }
}
</style>
