<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps<{ text: string; active: boolean }>();
const viewport = ref<HTMLElement | null>(null);
const label = ref<HTMLElement | null>(null);
const travel = ref<{ distance: number; duration: number } | null>(null);
const scrolling = computed(() => props.active && travel.value !== null);
const scrollStyle = computed(() => travel.value ? {
  "--title-scroll-duration": `${travel.value.duration}s`,
} : undefined);

// Only an active row measures or observes layout; an idle history list costs no
// animation frames or ResizeObservers. CSS runs the movement on the compositor.
watch([() => props.active, () => props.text], ([active], _, cleanup) => {
  travel.value = null;
  if (!active) return;
  let disposed = false;
  let resize: ResizeObserver | undefined;
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  function measure() {
    if (disposed) return;
    const container = viewport.value, content = label.value;
    if (!container || !content || motion?.matches || container.clientWidth === 0 || content.scrollWidth <= container.clientWidth + 1) {
      travel.value = null;
      return;
    }
    // Layout widths stay in CSS pixels at every application zoom level.
    const style = getComputedStyle(container);
    const gap = Number.parseFloat(style.getPropertyValue("--yj-sidebar-title-gap")) || 32;
    const speed = Number.parseFloat(style.getPropertyValue("--yj-sidebar-title-speed")) || 32;
    const distance = content.scrollWidth + gap;
    const duration = distance / Math.max(1, speed);
    if (travel.value?.distance !== distance || travel.value.duration !== duration) travel.value = { distance, duration };
  }
  function motionChanged() {
    travel.value = null;
    void nextTick(measure);
  }
  void nextTick(() => {
    if (disposed) return;
    measure();
    if (typeof ResizeObserver !== "undefined" && viewport.value && label.value) {
      resize = new ResizeObserver(measure);
      resize.observe(viewport.value);
      resize.observe(label.value);
    }
    motion?.addEventListener("change", motionChanged);
  });
  cleanup(() => {
    disposed = true;
    resize?.disconnect();
    motion?.removeEventListener("change", motionChanged);
  });
}, { immediate: true, flush: "post" });
</script>

<template>
  <span ref="viewport" class="chat-session-title" :class="{ 'chat-session-title--scrolling': scrolling }" :style="scrollStyle">
    <span :key="text" class="chat-session-title__track">
      <span ref="label" class="chat-session-title__text">{{ text }}</span>
      <span v-if="scrolling" class="chat-session-title__text" aria-hidden="true">{{ text }}</span>
    </span>
  </span>
</template>

<style scoped>
.chat-session-title { display: block; min-width: 0; overflow: hidden; white-space: nowrap; }
.chat-session-title__track { display: block; }
.chat-session-title__text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-session-title--scrolling {
  --title-edge-width: min(var(--yj-space-4), 15%);
  --title-mask: linear-gradient(to right,
    transparent, currentColor var(--title-edge-width),
    currentColor calc(100% - var(--title-edge-width)), transparent);
  -webkit-mask-image: var(--title-mask);
  mask-image: var(--title-mask);
}
.chat-session-title--scrolling .chat-session-title__track {
  display: inline-flex;
  gap: var(--yj-sidebar-title-gap);
  animation: sidebar-title-scroll var(--title-scroll-duration) linear var(--yj-motion-sidebar-title-delay) infinite;
}
.chat-session-title--scrolling .chat-session-title__text { flex: none; overflow: visible; }
/* Two identical copies plus one gap: half the track and half the gap bring the
 * second copy exactly to the first one's origin, including fractional widths. */
@keyframes sidebar-title-scroll { to { transform: translateX(calc(-50% - var(--yj-sidebar-title-gap) / 2)); } }
@media (prefers-reduced-motion: reduce) {
  .chat-session-title__track { animation: none !important; }
}
</style>
