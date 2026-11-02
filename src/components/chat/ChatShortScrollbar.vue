<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  viewport: HTMLElement | null;
  content: HTMLElement | null;
  active?: boolean;
  controls: string;
  label: string;
}>(), { active: true });
const emit = defineEmits<{
  scroll: [position: number, maximum: number, previousPosition: number];
  "reading-start": [];
  resize: [];
}>();
const rail = ref<HTMLElement | null>(null);
const thumb = ref<HTMLElement | null>(null);
const maximum = ref(0);
const position = ref(0);
const offset = ref(0);
const viewportHeight = ref(0);
const scrollbarVisible = ref(false);
const drag = ref<{ pointerId: number; y: number; scrollTop: number } | null>(null);
const isDragging = computed(() => drag.value !== null);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function sync() {
  const element = props.viewport;
  if (!element || !props.active || element.clientHeight === 0) {
    maximum.value = 0;
    return;
  }
  maximum.value = Math.max(0, element.scrollHeight - element.clientHeight);
  viewportHeight.value = element.clientHeight;
  position.value = Math.max(0, Math.min(maximum.value, element.scrollTop));
  const travel = Math.max(0, (rail.value?.clientHeight ?? 0) - (thumb.value?.offsetHeight ?? 0));
  offset.value = maximum.value > 0 ? position.value / maximum.value * travel : 0;
}

function show() {
  clearTimeout(hideTimer);
  scrollbarVisible.value = maximum.value > 0;
  hideTimer = setTimeout(() => { if (!drag.value) scrollbarVisible.value = false; }, 700);
}

function trackScroll() {
  const previous = position.value;
  sync();
  if (!props.active) return;
  emit("scroll", position.value, maximum.value, previous);
  show();
}

function wheelIntent(event: WheelEvent) {
  // Notify the live reader before native scrolling, so a queued follow frame
  // cannot undo a small upward gesture near the bottom.
  if (!event.ctrlKey && event.deltaY < 0) emit("reading-start");
}

function keyboardIntent(event: KeyboardEvent) {
  if (event.target === props.viewport && ["ArrowUp", "PageUp", "Home"].includes(event.key)) emit("reading-start");
}

function scrollTo(top: number) {
  const element = props.viewport;
  if (!element) return;
  if (top < element.scrollTop) emit("reading-start");
  element.scrollTop = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, top));
  trackScroll();
}

function startDrag(event: PointerEvent) {
  if (event.button !== 0 || maximum.value <= 0 || !props.viewport) return;
  event.preventDefault();
  emit("reading-start");
  thumb.value?.focus({ preventScroll: true });
  drag.value = { pointerId: event.pointerId, y: event.clientY, scrollTop: props.viewport.scrollTop };
  show();
  thumb.value?.setPointerCapture(event.pointerId);
}

function moveDrag(event: PointerEvent) {
  if (!drag.value || event.pointerId !== drag.value.pointerId || !rail.value || !thumb.value) return;
  const travel = rail.value.getBoundingClientRect().height - thumb.value.getBoundingClientRect().height;
  if (travel > 0) scrollTo(drag.value.scrollTop + (event.clientY - drag.value.y) / travel * maximum.value);
}

function clearDrag() {
  const pointerId = drag.value?.pointerId;
  drag.value = null;
  if (pointerId !== undefined && thumb.value?.hasPointerCapture(pointerId)) thumb.value.releasePointerCapture(pointerId);
}

function endDrag(event: PointerEvent) {
  if (event.pointerId !== drag.value?.pointerId) return;
  clearDrag();
  trackScroll();
}

function jumpOnRail(event: PointerEvent) {
  if (event.button !== 0 || !rail.value || !thumb.value || maximum.value <= 0) return;
  event.preventDefault();
  const bounds = rail.value.getBoundingClientRect();
  const height = thumb.value.getBoundingClientRect().height;
  if (bounds.height > height) scrollTo((event.clientY - bounds.top - height / 2) / (bounds.height - height) * maximum.value);
  props.viewport?.focus({ preventScroll: true });
}

function scrollWithKeyboard(event: KeyboardEvent) {
  const element = props.viewport;
  if (!element) return;
  const positions: Record<string, number> = {
    ArrowUp: element.scrollTop - 40, ArrowDown: element.scrollTop + 40,
    PageUp: element.scrollTop - element.clientHeight, PageDown: element.scrollTop + element.clientHeight,
    Home: 0, End: maximum.value,
  };
  const nextPosition = positions[event.key];
  if (typeof nextPosition !== "number") return;
  event.preventDefault();
  event.stopPropagation();
  scrollTo(nextPosition);
}

function reset() {
  clearDrag();
  clearTimeout(hideTimer);
  scrollbarVisible.value = false;
}

watch([() => props.viewport, () => props.content], ([viewport, content], _previous, onCleanup) => {
  if (!viewport) return;
  viewport.addEventListener("scroll", trackScroll, { passive: true });
  viewport.addEventListener("wheel", wheelIntent, { passive: true });
  viewport.addEventListener("keydown", keyboardIntent, true);
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => { sync(); emit("resize"); });
  observer?.observe(viewport);
  if (content) observer?.observe(content);
  sync();
  onCleanup(() => {
    viewport.removeEventListener("scroll", trackScroll);
    viewport.removeEventListener("wheel", wheelIntent);
    viewport.removeEventListener("keydown", keyboardIntent, true);
    observer?.disconnect();
    reset();
  });
}, { immediate: true, flush: "post" });
watch(() => props.active, () => { sync(); if (!props.active) reset(); }, { flush: "post" });
watch(viewportHeight, sync, { flush: "post" });
onBeforeUnmount(reset);
defineExpose({ sync, reset, isDragging });
</script>

<template>
  <!-- The thumb lives inside the native viewport, so wheel/touch gestures use
       the same browser handling as the content at every zoom. -->
  <Teleport v-if="viewport" :to="viewport">
    <div class="chat-short-scrollbar__anchor">
    <div ref="rail" class="chat-short-scrollbar"
      :class="{ 'chat-short-scrollbar--hidden': maximum <= 0, 'chat-short-scrollbar--active': scrollbarVisible }"
      :style="{ '--chat-scrollbar-viewport-height': `${viewportHeight}px` }" @pointerdown="jumpOnRail">
      <div ref="thumb" class="chat-short-scrollbar__thumb" role="scrollbar" :aria-label="label"
        aria-orientation="vertical" :aria-controls="controls" :aria-valuemin="0" :aria-valuemax="Math.round(maximum)"
        :aria-valuenow="Math.round(position)" :tabindex="maximum > 0 ? 0 : -1"
        :style="{ transform: `translateY(${offset}px)` }"
        @pointerdown.stop="startDrag" @pointermove="moveDrag" @pointerup="endDrag"
        @pointercancel="endDrag" @lostpointercapture="endDrag" @keydown="scrollWithKeyboard" />
    </div>
    </div>
  </Teleport>
</template>

<style scoped>
.chat-short-scrollbar__anchor {
  position: sticky;
  grid-area: 1 / 1;
  align-self: start;
  justify-self: end;
  top: var(--yj-space-1);
  height: 0;
  width: var(--yj-space-3);
}
.chat-short-scrollbar {
  position: absolute;
  top: 0;
  right: 0;
  height: max(0px, calc(var(--chat-scrollbar-viewport-height) - var(--yj-space-2)));
  width: var(--yj-space-3);
  user-select: none;
  -webkit-user-select: none;
}
.chat-short-scrollbar--hidden { visibility: hidden; }
.chat-short-scrollbar__thumb {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 0;
  height: min(100%, var(--yj-layout-chat-scrollbar-thumb-height));
  opacity: 0;
  transition: opacity var(--yj-motion-base) var(--yj-ease-standard);
  cursor: grab;
  touch-action: none;
}
.chat-short-scrollbar--active .chat-short-scrollbar__thumb,
.chat-short-scrollbar:hover .chat-short-scrollbar__thumb,
.chat-short-scrollbar__thumb:focus-visible {
  opacity: 1;
  transition-duration: 0s;
}
.chat-short-scrollbar__thumb:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
.chat-short-scrollbar__thumb:active { cursor: grabbing; }
.chat-short-scrollbar__thumb::after {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: var(--yj-layout-chat-scrollbar-width);
  border-radius: var(--yj-radius-sm);
  background: var(--yj-color-border-strong);
}
@media (prefers-reduced-motion: reduce) {
  .chat-short-scrollbar__thumb { transition: none; }
}
</style>
