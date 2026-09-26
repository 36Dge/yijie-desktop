<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { NCard } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{ show: boolean; target: HTMLButtonElement | null }>();
const emit = defineEmits<{ dismiss: [] }>();
const card = ref<{ $el: HTMLElement } | null>(null);
const panel = computed(() => card.value?.$el ?? null);
const overlay = ref<HTMLElement | null>(null);
const anchor = ref({ left: 0, top: 0, width: 0, height: 0 });
const placement = ref({ left: 0, top: 0, arrow: 0, above: false });
const ready = ref(false);
let observer: ResizeObserver | undefined;
let frame = 0;
const anchorStyle = computed(() => ({
  left: `${anchor.value.left}px`, top: `${anchor.value.top}px`,
  width: `${anchor.value.width}px`, height: `${anchor.value.height}px`,
}));
const panelStyle = computed(() => ({ left: `${placement.value.left}px`, top: `${placement.value.top}px`, "--guide-arrow-left": `${placement.value.arrow}px` }));

function measure() {
  if (!props.target || !overlay.value) return;
  const target = props.target.getBoundingClientRect();
  const bounds = overlay.value.getBoundingClientRect();
  if (ready.value && bounds.width > 0 && bounds.height > 0 && (target.bottom <= bounds.top || target.top >= bounds.bottom || target.right <= bounds.left || target.left >= bounds.right)) {
    dismiss();
    return;
  }
  // Derive the current CSS zoom from the rendered overlay, including uiZoom.
  const scale = overlay.value.offsetWidth ? bounds.width / overlay.value.offsetWidth : 1;
  anchor.value = { left: (target.left - bounds.left) / scale, top: (target.top - bounds.top) / scale, width: target.width / scale, height: target.height / scale };
  if (!panel.value) return;
  const styles = getComputedStyle(overlay.value);
  const inset = parseFloat(styles.getPropertyValue("--yj-space-2")) || 0;
  const gap = parseFloat(styles.getPropertyValue("--yj-space-3")) || 0;
  const width = panel.value.offsetWidth;
  const height = panel.value.offsetHeight;
  const viewportWidth = bounds.width / scale;
  const viewportHeight = bounds.height / scale;
  const left = Math.max(inset, Math.min(anchor.value.left + anchor.value.width - width, viewportWidth - width - inset));
  const below = anchor.value.top + anchor.value.height + gap;
  const above = below + height > viewportHeight - inset;
  const top = Math.max(inset, Math.min(above ? anchor.value.top - gap - height : below, viewportHeight - height - inset));
  placement.value = { left, top, above, arrow: Math.max(inset * 2, Math.min(anchor.value.left + anchor.value.width / 2 - left, width - inset * 2)) };
}
function scheduleMeasure() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(measure);
}
function dismiss(restoreFocus = false) {
  emit("dismiss");
  if (restoreFocus) props.target?.focus({ preventScroll: true });
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(true); }
  // Tab can reach the close control directly instead of traversing the page.
  if (event.key === "Tab" && !event.shiftKey && event.target === props.target) {
    event.preventDefault(); panel.value?.querySelector<HTMLButtonElement>("button")?.focus();
  } else if (event.key === "Tab" && event.shiftKey && panel.value?.contains(event.target as Node)) {
    event.preventDefault(); props.target?.focus();
  }
}
function outside(event: Event) {
  const target = event.target as Node;
  if (props.target?.contains(target) || panel.value?.contains(target)) return;
  dismiss();
}
function stop() {
  ready.value = false;
  observer?.disconnect(); observer = undefined;
  cancelAnimationFrame(frame);
  window.removeEventListener("resize", scheduleMeasure);
  window.removeEventListener("scroll", scheduleMeasure, true);
  document.removeEventListener("keydown", keydown, true);
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("focusin", outside, true);
}
watch(() => [props.show, props.target] as const, async ([show, target], _, onCleanup) => {
  stop();
  let cancelled = false;
  onCleanup(() => { cancelled = true; stop(); });
  if (!show || !target) return;
  await nextTick();
  if (cancelled) return;
  target.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
  measure();
  ready.value = true;
  await nextTick();
  if (cancelled) return;
  target.focus({ preventScroll: true });
  observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleMeasure);
  observer?.observe(target);
  if (panel.value) observer?.observe(panel.value);
  const page = target.closest(".workflow-page");
  if (page) observer?.observe(page);
  window.addEventListener("resize", scheduleMeasure);
  window.addEventListener("scroll", scheduleMeasure, true);
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("focusin", outside, true);
}, { immediate: true });
onBeforeUnmount(stop);
</script>

<template>
  <Teleport to="body">
    <div v-if="show" ref="overlay" class="workflow-create-guide" :class="{ 'workflow-create-guide--ready': ready }">
      <div class="workflow-create-guide__spotlight" :style="anchorStyle" aria-hidden="true" />
      <NCard ref="card" :bordered="false" :content-style="{ padding: '0' }" class="workflow-create-guide__panel" :class="{ 'workflow-create-guide__panel--above': placement.above }" :style="panelStyle" role="dialog" aria-modal="false" aria-labelledby="workflow-guide-title" aria-describedby="workflow-guide-description">
          <header class="workflow-create-guide__header">
            <h2 id="workflow-guide-title">从创建第一个工作流开始</h2>
            <button type="button" class="workflow-create-guide__close yj-control yj-control--icon" aria-label="关闭新手引导" @click="dismiss(true)"><YjIcon name="dismiss" size="sm" /></button>
          </header>
          <p id="workflow-guide-description" class="workflow-create-guide__description">点击高亮的“创建工作流”，填写名称和描述，开始编排你的流程。</p>
          <p class="workflow-create-guide__hint">可按 Esc 关闭，之后不再提示。</p>
      </NCard>
    </div>
  </Teleport>
</template>

<style scoped>
.workflow-create-guide { position: fixed; inset: 0; z-index: var(--yj-z-onboarding); pointer-events: none; visibility: hidden; }
.workflow-create-guide--ready { visibility: visible; }
.workflow-create-guide__spotlight { position: absolute; }
.workflow-create-guide__spotlight { border-radius: var(--yj-radius-md); outline: var(--yj-focus-ring-width) solid var(--yj-color-brand-primary); outline-offset: var(--yj-space-1); box-shadow: 0 0 0 100vmax var(--yj-color-onboarding-scrim); }
.workflow-create-guide__panel { position: absolute; width: min(var(--yj-layout-onboarding-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); max-height: calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-4)); overflow: visible; padding: var(--yj-space-5); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-elevated); color: var(--yj-color-text-primary); box-shadow: var(--yj-shadow-popover); pointer-events: auto; }
.workflow-create-guide__panel::before { content: ""; position: absolute; width: var(--yj-space-2); height: var(--yj-space-2); left: var(--guide-arrow-left); top: calc(var(--yj-space-1) * -1 - var(--yj-border-width)); transform: translateX(-50%) rotate(45deg); background: var(--yj-color-bg-elevated); border-top: var(--yj-border-width) solid var(--yj-color-border-default); border-left: var(--yj-border-width) solid var(--yj-color-border-default); }
.workflow-create-guide__panel--above::before { top: auto; bottom: calc(var(--yj-space-1) * -1 - var(--yj-border-width)); transform: translateX(-50%) rotate(225deg); }
.workflow-create-guide__header { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-3); margin-bottom: var(--yj-space-2); }
.workflow-create-guide__hint { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.workflow-create-guide__close { border: 0; background: transparent; color: var(--yj-color-text-secondary); cursor: pointer; }
.workflow-create-guide__close:hover { background: var(--yj-color-control-hover); }
.workflow-create-guide__close:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); }
.workflow-create-guide__panel h2 { margin: 0; font-size: var(--yj-font-size-card-title); line-height: var(--yj-line-height-card-title); }
.workflow-create-guide__panel p { margin: 0; }
.workflow-create-guide__description { color: var(--yj-color-text-body); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.workflow-create-guide__panel .workflow-create-guide__hint { margin-top: var(--yj-space-4); }
</style>
