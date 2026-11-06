<script setup lang="ts">
import { isSidebarFile } from "../../domain/conversation-file-preview";
import { ref } from "vue";
import ChatFileLink from "./ChatFileLink.vue";
import YjTooltip from "../yijie/YjTooltip.vue";
import YjIcon from "../yijie/YjIcon.vue";
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
const details = ref<string | null>(null);
function hasSidebarLink(artifact: ArtifactProjection) {
  return Boolean(props.openFile) && artifact.status === "ready" &&
    (artifact.kind === "report" || (artifact.kind === "file" && isSidebarFile(artifact.mediaType ?? "", artifact.displayName ?? "")));
}
function preview(artifact: ArtifactProjection) {
  details.value = null;
  props.openFile?.(artifact);
}
</script>

<template>
  <section v-if="artifacts.length > 0" class="artifact-list" aria-label="生成内容">
    <ol class="artifact-list__items">
      <li v-for="artifact in artifacts" :key="artifact.artifactId">
        <div v-if="hasSidebarLink(artifact)" class="artifact-list__link">
          <ChatFileLink controls="conversation-file-preview" :tooltip="artifact.displayName ?? '当前对话生成的产物'" @open="preview(artifact)">《{{ artifact.displayName ?? '未命名产物' }}》</ChatFileLink>
          <YjTooltip text="产物详情与操作"><button type="button" class="artifact-list__details" aria-label="产物详情与操作" :aria-expanded="details === artifact.artifactId" @click="details = details === artifact.artifactId ? null : artifact.artifactId"><YjIcon name="more" size="xs" /></button></YjTooltip>
        </div>
        <ChatArtifactShell
          v-if="!hasSidebarLink(artifact) || details === artifact.artifactId"
          :artifact="artifact"
          :open-file="openFile ? preview : undefined"
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
.artifact-list__link { display: flex; align-items: baseline; gap: var(--yj-space-1); }
.artifact-list__details { display: inline-flex; border: 0; border-radius: var(--yj-radius-xs); background: transparent; color: var(--yj-color-text-secondary); cursor: pointer; }
.artifact-list__details:hover { background: var(--yj-color-control-hover); }
.artifact-list__details:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); }
.artifact-list__items {
  display: grid;
  gap: var(--yj-space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}
</style>
