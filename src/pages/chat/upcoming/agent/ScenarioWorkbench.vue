<script setup lang="ts" generic="Scene extends { id: string; label: string; detail: string }">
import { nextTick, ref, shallowRef } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";

defineProps<{
  scenes: readonly Scene[];
  kindLabel: string;
  describe: (scene: Scene) => string;
}>();
defineSlots<{
  cover(props: { scene: Scene }): unknown;
  indicator?(props: { scene: Scene }): unknown;
  detail(props: { scene: Scene }): unknown;
}>();

const library = ref<HTMLElement>();
const backButton = ref<HTMLButtonElement>();
const current = shallowRef<Scene | null>(null);

function focusButton(button?: HTMLButtonElement | null) {
  button?.focus({ preventScroll: true });
  button?.scrollIntoView({ block: "nearest" });
}

async function openScene(scene: Scene) {
  current.value = scene;
  await nextTick();
  focusButton(backButton.value);
}

async function returnToLibrary(id: string) {
  current.value = null;
  await nextTick();
  focusButton(library.value?.querySelector<HTMLButtonElement>(`button[data-scene="${id}"]`));
}
</script>

<template>
  <section ref="library" class="scene-gallery" :aria-label="kindLabel + '创作示例'">
    <div v-if="!current" class="scene-gallery__samples">
      <button v-for="scene in scenes" :key="scene.id" type="button" class="sample" :data-scene="scene.id"
        :aria-label="'查看' + scene.label + '示例'" :aria-description="describe(scene)" @click="openScene(scene)">
        <slot name="cover" :scene="scene" />
        <span class="sample__title">
          <strong>{{ scene.label }}</strong>
          <slot name="indicator" :scene="scene"><YjIcon name="arrowRight" size="xs" tone="muted" /></slot>
        </span>
        <span class="sample__caption">{{ scene.detail }}</span>
      </button>
    </div>
    <template v-else>
      <button ref="backButton" type="button" class="scene-gallery__back" @click="returnToLibrary(current.id)">
        <YjIcon name="chevronRight" size="xs" />全部{{ kindLabel }}示例
      </button>
      <slot name="detail" :scene="current" />
    </template>
  </section>
</template>

<style scoped>
.scene-gallery {
  container: scene-gallery / inline-size;
  width: min(100%, var(--yj-layout-chat-entry-max));
  margin: clamp(var(--yj-space-6), 4.5%, 34px) auto 0;
  padding: clamp(18px, 3%, var(--yj-space-6)) 0 var(--yj-space-2);
  color: var(--yj-color-text-primary);
}
.scene-gallery__samples {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 21px 18px;
}
.sample, .scene-gallery__back { border: 0; padding: 0; background: transparent; color: inherit; }
.sample {
  display: grid;
  align-content: start;
  min-width: 0;
  border-radius: var(--yj-image-gallery-radius);
  text-align: start;
}
.sample__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-2);
  margin-top: 9px;
}
.sample__title strong {
  font-size: var(--yj-font-size-chat-artifact-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-body);
}
.sample__caption {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.sample:hover .sample__title strong, .scene-gallery__back:hover { text-decoration: underline; text-underline-offset: 3px; }
.scene-gallery__back {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-1);
  min-height: 28px;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-context-window);
}
.scene-gallery__back :deep(svg) { transform: rotate(180deg); color: inherit; }
.scene-gallery :deep(button:focus-visible) {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: 2px;
}
@container scene-gallery (max-width: 620px) {
  .scene-gallery__samples { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px var(--yj-space-3); }
}
@container scene-gallery (max-width: 355px) {
  .sample__title strong { font-size: var(--yj-font-size-body); }
  .sample__caption { font-size: 11px; }
}
@media (pointer: coarse) {
  .scene-gallery__back { min-height: 44px; }
}
</style>
