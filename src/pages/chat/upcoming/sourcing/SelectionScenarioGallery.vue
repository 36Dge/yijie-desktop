<script setup lang="ts">
import ScenarioWorkbench from "../agent/ScenarioWorkbench.vue";
import SelectionCover from "./SelectionCover.vue";
import SelectionWorkflow from "./SelectionWorkflow.vue";
import { selectionScenes } from "./examples";
</script>

<template>
  <ScenarioWorkbench class="selection-scenes" kind-label="选品" aria-label="选品分析示例" :scenes="selectionScenes" :describe="scene => scene.premise">
    <template #cover="{ scene }"><SelectionCover :scene="scene" /></template>
    <template #detail="{ scene }"><SelectionWorkflow :key="scene.id" :scene="scene" /></template>
  </ScenarioWorkbench>
</template>
