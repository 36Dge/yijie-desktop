<script setup lang="ts">
import type { ChatArtifactFileNativeClient } from "../../api/chat-artifact-file-native-client";
import type { ChatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import type { ChatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactShell from "./ChatArtifactShell.vue";

defineProps<{
  artifacts: readonly ArtifactProjection[];
  contextId: string;
  nativeClient?: ChatArtifactNativeClient;
  videoNativeClient?: ChatArtifactVideoNativeClient;
  fileNativeClient?: ChatArtifactFileNativeClient;
}>();
</script>

<template>
  <section v-if="artifacts.length > 0" class="artifact-list" aria-label="生成内容">
    <ol class="artifact-list__items">
      <li v-for="artifact in artifacts" :key="artifact.artifactId">
        <ChatArtifactShell
          :artifact="artifact"
          :context-id="contextId"
          :native-client="nativeClient"
          :video-native-client="videoNativeClient"
          :file-native-client="fileNativeClient"
        />
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
