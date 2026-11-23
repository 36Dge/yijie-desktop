<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref } from "vue";
defineProps<{ loading?: boolean }>();
const rail = ref<HTMLUListElement | null>(null);
const isScrolling = ref(false);
let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined;
function hideScrollbar() {
  clearTimeout(scrollIdleTimer);
  isScrolling.value = false;
}
function trackScroll() {
  isScrolling.value = true;
  clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(hideScrollbar, 150);
}
function move(direction: number) { rail.value?.scrollBy({ left: direction * rail.value.clientWidth }); }
function keyboard(event: KeyboardEvent) {
  // Nested links keep their native Enter/Tab behavior.
  if (event.target !== rail.value || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Home" || event.key === "End") rail.value?.scrollTo({ left: event.key === "Home" ? 0 : rail.value.scrollWidth });
  else move(event.key === "ArrowLeft" ? -1 : 1);
}
onDeactivated(hideScrollbar);
onBeforeUnmount(hideScrollbar);
</script>

<template>
  <div class="workflow-card-rail workflow-card-layout" :aria-busy="!!loading">
    <span v-if="loading" class="workflow-card-rail__loading" role="status" aria-label="正在更新工作流" />
    <ul ref="rail" class="workflow-card-rail__list" :class="{ 'workflow-card-rail__list--scrolling': isScrolling }"
      aria-label="我的工作流列表" tabindex="0" @scroll.passive="trackScroll" @keydown="keyboard"><slot /></ul>
  </div>
</template>

<style scoped>
.workflow-card-rail { position: relative; min-width: 0; }
.workflow-card-rail__loading { position: absolute; top: var(--yj-space-2); right: var(--yj-space-2); z-index: 1; pointer-events: none; width: var(--yj-space-4); height: var(--yj-space-4); border: var(--yj-focus-ring-width) solid var(--yj-color-border-subtle); border-top-color: var(--yj-color-text-secondary); border-radius: 50%; animation: workflow-list-hint 1ms step-end 180ms both, workflow-list-spin 800ms linear infinite; }
@keyframes workflow-list-hint { from { visibility: hidden; } to { visibility: visible; } }
@keyframes workflow-list-spin { to { transform: rotate(360deg); } }
.workflow-card-rail__list { display: grid; grid-auto-flow: column; grid-auto-columns: calc((100% - (var(--workflow-visible-cards) - 1) * var(--yj-space-4)) / var(--workflow-visible-cards)); gap: var(--yj-space-4); list-style: none; margin: 0; padding: var(--yj-space-1) 0 var(--yj-space-3); overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scroll-behavior: smooth; }
.workflow-card-rail__list :deep(li) { min-width: 0; scroll-snap-align: start; }
.workflow-card-rail__list :deep(li > *) { height: 100%; }
.workflow-card-rail__list:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); border-radius: var(--yj-radius-lg); }
@media not (forced-colors: active) {
  .workflow-card-rail__list { --workflow-scrollbar-thumb: transparent; }
  .workflow-card-rail__list--scrolling {
    --workflow-scrollbar-thumb: color-mix(in srgb, var(--yj-color-border-strong) 65%, transparent);
  }
  /* Keep the native 12px drag area even when the 2px indicator is hidden. */
  .workflow-card-rail__list::-webkit-scrollbar { height: var(--yj-space-3); background: transparent; }
  .workflow-card-rail__list::-webkit-scrollbar-thumb {
    border: calc(var(--yj-space-1) + var(--yj-border-width)) solid transparent;
    border-radius: var(--yj-radius-full);
    background-color: var(--workflow-scrollbar-thumb);
    background-clip: padding-box;
  }
  @supports not selector(::-webkit-scrollbar) {
    .workflow-card-rail__list { scrollbar-width: thin; scrollbar-color: var(--workflow-scrollbar-thumb) transparent; }
  }
}
@media (prefers-reduced-motion: reduce) { .workflow-card-rail__list { scroll-behavior: auto; } .workflow-card-rail__loading { animation: workflow-list-hint 1ms step-end 180ms both; } }
</style>
