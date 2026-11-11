<script setup lang="ts">
import { isSidebarFile } from "../../domain/conversation-file-preview";
import ChatArtifactFile from "./ChatArtifactFile.vue";
import ChatArtifactReport from "./ChatArtifactReport.vue";
import type { ChatArtifactFileNativeClient } from "../../api/chat-artifact-file-native-client";
import type { ChatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import type { ChatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
import type { ChatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactShell from "./ChatArtifactShell.vue";

const props = defineProps<{
  artifacts: readonly ArtifactProjection[];
  contextId: string;
  openFile?: (artifact: ArtifactProjection) => void;
  nativeClient?: ChatArtifactNativeClient;
  videoNativeClient?: ChatArtifactVideoNativeClient;
  fileNativeClient?: ChatArtifactFileNativeClient;
  reportNativeClient?: ChatArtifactReportNativeClient;
}>();
function hasDocumentCard(artifact: ArtifactProjection) {
  return Boolean(props.openFile) && artifact.status === "ready" &&
    (artifact.kind === "report" || (artifact.kind === "file" && isSidebarFile(artifact.mediaType ?? "", artifact.displayName ?? "")));
}
</script>

<template>
  <section v-if="artifacts.length > 0" class="artifact-list" aria-label="生成内容">
    <ol class="artifact-list__items">
      <li v-for="artifact in artifacts" :key="artifact.artifactId">
        <ChatArtifactFile
          v-if="hasDocumentCard(artifact) && artifact.kind === 'file'"
          card
          :artifact="artifact"
          :context-id="contextId"
          :client="fileNativeClient"
          :open-file="openFile"
        />
        <ChatArtifactReport
          v-else-if="hasDocumentCard(artifact) && artifact.kind === 'report'"
          card
          :artifact="artifact"
          :context-id="contextId"
          :client="reportNativeClient"
          :open-file="openFile"
        />
        <ChatArtifactShell
          v-else
          :artifact="artifact"
          :open-file="openFile"
          :context-id="contextId"
          :native-client="nativeClient"
          :video-native-client="videoNativeClient"
          :file-native-client="fileNativeClient"
          :report-native-client="reportNativeClient"
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
