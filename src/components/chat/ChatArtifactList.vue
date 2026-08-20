<script setup lang="ts">
import type { ArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactShell from "./ChatArtifactShell.vue";

defineProps<{
  artifacts: readonly ArtifactProjection[];
}>();
</script>

<template>
  <section v-if="artifacts.length > 0" class="artifact-list" aria-label="生成内容">
    <ol class="artifact-list__items">
      <li v-for="artifact in artifacts" :key="artifact.artifactId">
        <ChatArtifactShell :artifact="artifact" />
      </li>
    </ol>
  </section>
</template>

<style scoped>
.artifact-list__items {
  display: grid;
  gap: var(--yj-space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}
</style>
