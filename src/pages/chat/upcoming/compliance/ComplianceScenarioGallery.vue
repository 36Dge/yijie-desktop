<script setup lang="ts">
import ScenarioWorkbench from "../agent/ScenarioWorkbench.vue";
import ComplianceCover from "./ComplianceCover.vue";
import ComplianceWorkflow from "./ComplianceWorkflow.vue";
import { complianceScenes } from "./scenes";
import type { CheckRecord } from "./manual";

const records = defineModel<CheckRecord[]>({ required: true });
</script>

<template>
  <ScenarioWorkbench class="compliance-scenes" kind-label="检测" aria-label="合规检测示例" :scenes="complianceScenes"
    :describe="scene => scene.product + ' · ' + scene.stages.join('、')">
    <template #cover="{ scene }"><ComplianceCover :scene="scene" /></template>
    <template #detail="{ scene }"><ComplianceWorkflow :key="scene.id" v-model="records" :scene="scene" /></template>
  </ScenarioWorkbench>
</template>
