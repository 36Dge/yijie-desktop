<script setup lang="ts">
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import ScenarioWorkbench from "../agent/ScenarioWorkbench.vue";
import VideoSceneCover from "./VideoSceneCover.vue";
import VideoSceneDetail from "./VideoSceneDetail.vue";
import { videoScenes, type VideoSceneId } from "./scenes";

const emit = defineEmits<{ apply: [id: VideoSceneId] }>();
const scenes = Object.values(videoScenes);
</script>

<template>
  <ScenarioWorkbench class="video-scenes" kind-label="视频" :scenes="scenes" :describe="scene => scene.duration + ' 秒。' + scene.description">
    <template #cover="{ scene }"><VideoSceneCover :scene="scene" /></template>
    <template #indicator="{ scene }">
      <span class="video-duration" aria-hidden="true"><YjIcon name="squarePlay" size="xs" tone="muted" />{{ scene.duration }} 秒</span>
    </template>
    <template #detail="{ scene }"><VideoSceneDetail :key="scene.id" :scene="scene" @apply="emit('apply', $event)" /></template>
  </ScenarioWorkbench>
</template>

<style scoped>
.video-duration {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: var(--yj-space-1);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  font-variant-numeric: tabular-nums;
}
</style>
