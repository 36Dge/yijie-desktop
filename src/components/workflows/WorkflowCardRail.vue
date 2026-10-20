<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import YjIcon from "../yijie/YjIcon.vue";
const props = defineProps<{ count: number; loading?: boolean }>();
const rail = ref<HTMLUListElement | null>(null);
const hasOverflow = ref(false);
const canPrevious = ref(false);
const canNext = ref(false);
let observer: ResizeObserver | undefined;
function measure() {
  if (!rail.value) return;
  const { scrollLeft, scrollWidth, clientWidth } = rail.value;
  hasOverflow.value = scrollWidth > clientWidth + 1;
  canPrevious.value = scrollLeft > 1;
  canNext.value = scrollLeft + clientWidth < scrollWidth - 1;
}
function move(direction: number) { rail.value?.scrollBy({ left: direction * rail.value.clientWidth }); }
function keyboard(event: KeyboardEvent) {
  // Nested links keep their native Enter/Tab behavior.
  if (event.target !== rail.value || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Home" || event.key === "End") rail.value?.scrollTo({ left: event.key === "Home" ? 0 : rail.value.scrollWidth });
  else move(event.key === "ArrowLeft" ? -1 : 1);
}
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined" && rail.value) {
    observer = new ResizeObserver(measure);
    observer.observe(rail.value);
  }
});
watch(() => props.count, async () => { await nextTick(); measure(); });
onActivated(async () => { await nextTick(); measure(); });
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="workflow-card-rail workflow-card-layout" :aria-busy="!!loading">
    <div class="workflow-card-rail__navigation-slot">
      <span v-if="loading" class="workflow-card-rail__loading" role="status" aria-label="正在更新工作流" />
    <div class="workflow-card-rail__navigation" :class="{ 'workflow-card-rail__navigation--hidden': !hasOverflow }" :inert="!hasOverflow" :aria-hidden="!hasOverflow" aria-label="工作流卡片翻页">
      <span>左右滑动查看更多工作流</span>
      <button type="button" class="workflow-showcase-control yj-control yj-control--icon" aria-label="上一组工作流" :disabled="!canPrevious" @click="move(-1)"><YjIcon name="chevronRight" size="sm" class="workflow-card-rail__previous" /></button>
      <button type="button" class="workflow-showcase-control yj-control yj-control--icon" aria-label="下一组工作流" :disabled="!canNext" @click="move(1)"><YjIcon name="chevronRight" size="sm" /></button>
    </div>
    </div>
    <ul ref="rail" class="workflow-card-rail__list" aria-label="我的工作流列表" tabindex="0" @scroll="measure" @keydown="keyboard"><slot /></ul>
  </div>
</template>

<style scoped>
.workflow-card-rail__previous { transform: rotate(180deg); }
.workflow-card-rail { min-width: 0; }
.workflow-card-rail__navigation-slot { position: relative; margin-bottom: var(--yj-space-2); }
.workflow-card-rail__navigation--hidden { visibility: hidden; }
.workflow-card-rail__loading { position: absolute; top: var(--yj-space-2); left: 0; width: var(--yj-space-4); height: var(--yj-space-4); border: var(--yj-focus-ring-width) solid var(--yj-color-border-subtle); border-top-color: var(--yj-color-text-secondary); border-radius: 50%; animation: workflow-list-hint 1ms step-end 180ms both, workflow-list-spin 800ms linear infinite; }
@keyframes workflow-list-hint { from { visibility: hidden; } to { visibility: visible; } }
@keyframes workflow-list-spin { to { transform: rotate(360deg); } }
.workflow-card-rail__navigation { display: flex; justify-content: flex-end; align-items: center; gap: var(--yj-space-2); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.workflow-card-rail__list { display: grid; grid-auto-flow: column; grid-auto-columns: calc((100% - (var(--workflow-visible-cards) - 1) * var(--yj-space-4)) / var(--workflow-visible-cards)); gap: var(--yj-space-4); list-style: none; margin: 0; padding: var(--yj-space-1) 0 var(--yj-space-3); overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scroll-behavior: smooth; }
.workflow-card-rail__list :deep(li) { min-width: 0; scroll-snap-align: start; }
.workflow-card-rail__list :deep(li > *) { height: 100%; }
.workflow-card-rail__list:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); border-radius: var(--yj-radius-lg); }
@media (prefers-reduced-motion: reduce) { .workflow-card-rail__list { scroll-behavior: auto; } .workflow-card-rail__loading { animation: workflow-list-hint 1ms step-end 180ms both; } }
</style>
