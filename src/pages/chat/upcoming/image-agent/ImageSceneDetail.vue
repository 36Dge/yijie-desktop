<script setup lang="ts">
import { computed, ref } from "vue";
import ScenarioDetail from "../agent/ScenarioDetail.vue";
import ImageSceneViewer from "./ImageSceneViewer.vue";
import SceneAsset from "./SceneAsset.vue";
import type { ImageScene, SceneId } from "./scenes";

const props = defineProps<{ scene: ImageScene }>();
const emit = defineEmits<{ apply: [id: SceneId] }>();
const resultIndex = ref(0);
const result = computed(() => props.scene.result.images[resultIndex.value]);
const images = computed(() => [...props.scene.input.images, ...props.scene.result.images]);
const viewing = ref<number | null>(null);
let opener: HTMLButtonElement | null = null;

function openImage(index: number, button: HTMLButtonElement) {
  opener = button;
  viewing.value = index;
}

function restoreFocus() {
  opener?.focus({ preventScroll: true });
  opener = null;
}
</script>

<template>
  <ScenarioDetail :title="scene.title" :description="scene.description" :output-label="result.title" @apply="emit('apply', scene.id)">
    <template #output>
      <SceneAsset :key="result.src" :image="result" :wide="scene.id === 'aplus' || (scene.id === 'suite' && resultIndex === 0)"
        @open="openImage(scene.input.images.length + resultIndex, $event)" />
      <div v-if="scene.result.images.length > 1" class="result-picker" role="group" aria-label="切换示例图">
        <button v-for="(image, index) in scene.result.images" :key="image.src" type="button" :aria-pressed="index === resultIndex"
          @click="resultIndex = index">
          <img :src="image.thumbnail" alt="" draggable="false" />{{ image.title }}
        </button>
      </div>
    </template>
    <template #materials>
      <button v-for="(material, index) in scene.materials" :key="material.src" type="button" :aria-label="'查看' + material.name"
        @click="openImage(index, $event.currentTarget as HTMLButtonElement)">
        <img :src="scene.input.images[index].thumbnail" alt="" draggable="false" />{{ material.name }}
      </button>
    </template>
  </ScenarioDetail>
  <ImageSceneViewer v-model="viewing" :images="images" :group="scene.label" @closed="restoreFocus" />
</template>

<style scoped>
.result-picker { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
.result-picker button {
  display: inline-flex;
  align-items: center;
  background: transparent;
  color: var(--yj-color-text-secondary);
  gap: 6px;
  min-height: 30px;
  padding: 3px var(--yj-space-2) 3px var(--yj-space-1);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-sm);
  font-size: var(--yj-font-size-caption);
}
.result-picker button:hover { background: var(--yj-color-control-hover); }
.result-picker button[aria-pressed="true"] { border-color: var(--yj-color-text-primary); color: var(--yj-color-text-primary); }
.result-picker img { width: 28px; height: var(--yj-space-5); border-radius: var(--yj-radius-xs); object-fit: cover; }
@media (pointer: coarse) {
  .result-picker button { min-height: 44px; }
}
</style>
