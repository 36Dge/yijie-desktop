<script setup lang="ts">
import ScenarioWorkbench from "../agent/ScenarioWorkbench.vue";
import ImageSceneCover from "./ImageSceneCover.vue";
import ImageSceneDetail from "./ImageSceneDetail.vue";
import { imageScenes, type SceneId } from "./scenes";

const emit = defineEmits<{ apply: [id: SceneId] }>();
const scenes = Object.values(imageScenes);
</script>

<template>
  <ScenarioWorkbench class="image-scenes" kind-label="生图" :scenes="scenes" :describe="scene => scene.comparison?.description ?? scene.detail">
    <template #cover="{ scene }"><ImageSceneCover :scene="scene" /></template>
    <template #detail="{ scene }"><ImageSceneDetail :key="scene.id" :scene="scene" @apply="emit('apply', $event)" /></template>
  </ScenarioWorkbench>
</template>
