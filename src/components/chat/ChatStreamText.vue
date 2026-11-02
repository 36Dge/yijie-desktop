<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { chatTextRevealKey, useChatTextReveal } from "../../composables/useChatTextReveal";

const props = withDefaults(defineProps<{ text: string; streaming?: boolean; offset?: number }>(), { streaming: false, offset: 0 });
const root = ref<HTMLElement | null>(null);
const inherited = inject(chatTextRevealKey, null);
const reveal = inherited ?? useChatTextReveal(() => props.text, () => props.streaming, () => true, root);
const visibleEnd = computed(() => Math.min(props.text.length, Math.max(0, reveal.frame.value.cursor - props.offset)));
const ranges = computed<readonly { start: number; end: number; key: number }[]>((previous) => {
  const next = reveal.frame.value.ranges.flatMap(range => {
  const start = Math.max(0, range.start - props.offset);
  const end = Math.min(visibleEnd.value, range.end - props.offset);
  return end > start ? [{ start, end, key: range.start }] : [];
  });
  return previous?.length === next.length && next.every((range, index) => range.start === previous[index]!.start && range.end === previous[index]!.end && range.key === previous[index]!.key) ? previous : next;
});
const prefix = computed(() => props.text.slice(0, ranges.value[0]?.start ?? visibleEnd.value));
</script>

<template>
  <span ref="root" class="chat-stream-text">{{ prefix }}<span v-for="range in ranges" :key="range.key" class="chat-stream-text__fresh">{{ text.slice(range.start, range.end) }}</span></span>
</template>

<style scoped>
.chat-stream-text__fresh {
  animation: chat-stream-arrive var(--yj-motion-chat-stream-fade) linear both;
}
@keyframes chat-stream-arrive {
  from { opacity: var(--yj-opacity-chat-stream-start); }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .chat-stream-text__fresh { animation: none; }
}
</style>
