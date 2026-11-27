<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NModal } from "naive-ui";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import type { SceneImage } from "./scenes";
const props = defineProps<{ images: readonly SceneImage[]; group: string }>();
const index = defineModel<number | null>({ required: true });
const active = computed(() => props.images[index.value ?? 0]);
const closeButton = ref<HTMLButtonElement>();
const emit = defineEmits<{ closed: [] }>();
let start: { x: number; y: number } | undefined;
function move(by: number) {
  if (index.value !== null) index.value = (index.value + by + props.images.length) % props.images.length;
}
function finishSwipe(event: PointerEvent) {
  if (!start) return;
  const dx = event.clientX - start.x, dy = event.clientY - start.y;
  start = undefined;
  if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
}
watch(() => index.value !== null, (open, _, onCleanup) => {
  if (!open) return;
  function key(event: KeyboardEvent) {
    if (!["Escape", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") index.value = null;
    else move(event.key === "ArrowLeft" ? -1 : 1);
  }
  document.addEventListener("keydown", key, true);
  onCleanup(() => document.removeEventListener("keydown", key, true));
});
</script>
<template>
  <NModal :show="index !== null" :auto-focus="false" @update:show="!$event && (index = null)"
    @after-enter="closeButton?.focus({ preventScroll: true })" @after-leave="emit('closed')">
    <section v-if="active" class="scene-viewer" role="dialog" aria-modal="true" aria-labelledby="scene-viewer-title">
      <header><div><small>{{ group }}</small><h2 id="scene-viewer-title">{{ active.title }} <span>{{ (index ?? 0) + 1 }} / {{ images.length }}</span></h2></div>
        <button ref="closeButton" type="button" aria-label="关闭大图预览" @click="index = null"><YjIcon name="dismiss" /></button>
      </header>
      <div class="scene-viewer__stage" @pointerdown="start = { x: $event.clientX, y: $event.clientY }" @pointerup="finishSwipe" @pointercancel="start = undefined">
        <button class="scene-viewer__prev" type="button" aria-label="查看上一张" @click="move(-1)"><YjIcon name="chevronRight" size="xl" /></button>
        <div class="scene-viewer__canvas"><img :src="active.src" :alt="active.alt" draggable="false" /></div>
        <button type="button" aria-label="查看下一张" @click="move(1)"><YjIcon name="chevronRight" size="xl" /></button>
      </div>
      <footer aria-label="图片列表"><button v-for="(item, i) in images" :key="item.src" type="button" :aria-label="'查看' + item.title"
        :aria-current="i === index ? 'true' : undefined" @click="index = i"><img :src="item.thumbnail" alt="" /></button></footer>
    </section>
  </NModal>
</template>
<style scoped>
.scene-viewer { display: grid; grid-template-rows: auto minmax(0,1fr) auto; width: min(1120px, calc(100% - 40px)); height: min(900px, calc(var(--yj-ui-viewport-height, 100vh) - 40px)); overflow: hidden; border: 1px solid var(--agent-line); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); box-shadow: var(--yj-shadow-modal); }
.scene-viewer header, .scene-viewer footer { display: flex; align-items: center; gap: 9px; padding: 13px 18px; }
.scene-viewer header { justify-content: space-between; border-bottom: 1px solid var(--agent-line); }
.scene-viewer small { color: var(--agent-ink); font-weight: 600; }
.scene-viewer h2 { margin: 2px 0 0; font-size: var(--yj-font-size-card-title); }
.scene-viewer h2 span { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); }
.scene-viewer button { display: grid; place-items: center; padding: 0; border: 1px solid var(--agent-line); border-radius: var(--yj-radius-md); background: var(--yj-color-bg-card); color: inherit; }
.scene-viewer header button { width: 34px; height: 34px; }
.scene-viewer__stage { display: grid; min-height: 0; grid-template-columns: 52px minmax(0,1fr) 52px; align-items: center; gap: 12px; padding: 14px; background: var(--agent-tint); touch-action: pan-y; }
.scene-viewer__stage button { width: 100%; aspect-ratio: 1; }
.scene-viewer__prev :deep(svg) { transform: rotate(180deg); }
.scene-viewer__canvas { height: 100%; min-height: 0; overflow: hidden; border: 1px solid var(--agent-line); border-radius: var(--yj-radius-md);
  background: linear-gradient(90deg,var(--agent-grid) 1px,transparent 1px), linear-gradient(var(--agent-grid) 1px,transparent 1px),var(--yj-color-bg-card); background-size: 22px 22px; }
.scene-viewer__canvas img { display: block; width: 100%; height: 100%; object-fit: contain; }
.scene-viewer footer { justify-content: center; border-top: 1px solid var(--agent-line); }
.scene-viewer footer button { width: 64px; height: 48px; overflow: hidden; }
.scene-viewer footer button[aria-current] { outline: 2px solid var(--agent-ink); }
.scene-viewer footer img { width: 100%; height: 100%; object-fit: cover; }
@media (max-width: 760px) { .scene-viewer__stage { grid-template-columns: 32px minmax(0,1fr) 32px; gap: 6px; padding: 8px; } }
</style>
