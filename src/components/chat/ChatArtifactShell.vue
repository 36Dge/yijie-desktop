<script setup lang="ts">
import { computed } from "vue";
import { NProgress, NTag } from "naive-ui";
import type { ChatArtifactFileNativeClient } from "../../api/chat-artifact-file-native-client";
import type { ChatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import type { ChatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
import type { ChatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactImage from "./ChatArtifactImage.vue";
import ChatArtifactFile from "./ChatArtifactFile.vue";
import ChatArtifactReport from "./ChatArtifactReport.vue";
import ChatArtifactVideo from "./ChatArtifactVideo.vue";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  artifact: ArtifactProjection;
  contextId: string;
  nativeClient?: ChatArtifactNativeClient;
  videoNativeClient?: ChatArtifactVideoNativeClient;
  fileNativeClient?: ChatArtifactFileNativeClient;
  reportNativeClient?: ChatArtifactReportNativeClient;
}>();

const kindPresentation = computed(() => ({
  image: { label: "图片", icon: "image" as const },
  video: { label: "视频", icon: "file" as const },
  file: { label: "文件", icon: "file" as const },
  report: { label: "报告", icon: "file" as const },
})[props.artifact.kind]);

const statusPresentation = computed(() => ({
  announced: { label: "已登记", icon: "pending" as const, tone: "muted" as const, tag: "default" as const },
  generating: { label: "正在生成", icon: "pending" as const, tone: "primary" as const, tag: "info" as const },
  processing: { label: "正在处理", icon: "pending" as const, tone: "primary" as const, tag: "info" as const },
  transferring: { label: "正在安全传输", icon: "pending" as const, tone: "primary" as const, tag: "info" as const },
  ready: { label: "已就绪", icon: "check" as const, tone: "success" as const, tag: "success" as const },
  failed: { label: "失败", icon: "warning" as const, tone: "error" as const, tag: "error" as const },
  cancelled: { label: "已取消", icon: "stop" as const, tone: "muted" as const, tag: "default" as const },
  expired: { label: "已过期", icon: "pending" as const, tone: "muted" as const, tag: "warning" as const },
})[props.artifact.status]);

const progressStageLabel = computed(() => props.artifact.progressStage === null
  ? null
  : ({ generating: "生成中", processing: "处理中", finalizing: "收尾中" })[
      props.artifact.progressStage
    ]);
const provenanceLabel = computed(() => ({
  synthetic: "本地合成演示",
  provider: "服务生成",
  tool: "工具生成",
})[props.artifact.provenance]);
const displayName = computed(() => props.artifact.displayName ?? `未命名${kindPresentation.value.label}`);
const busy = computed(() =>
  props.artifact.status === "announced" ||
  props.artifact.status === "generating" ||
  props.artifact.status === "processing" ||
  props.artifact.status === "transferring",
);
const titleId = computed(() => `artifact-${props.artifact.artifactId}-title`);
const progressLabel = computed(() => `${displayName.value}处理进度`);
</script>

<template>
  <article
    class="artifact-shell"
    :class="`artifact-shell--${artifact.status}`"
    :aria-busy="busy ? 'true' : 'false'"
    :aria-labelledby="titleId"
    tabindex="0"
  >
    <header class="artifact-shell__header">
      <span class="artifact-shell__kind-icon" aria-hidden="true">
        <YjIcon :name="kindPresentation.icon" size="lg" tone="muted" />
      </span>
      <span class="artifact-shell__identity">
        <strong :id="titleId" class="artifact-shell__name">{{ displayName }}</strong>
        <span class="artifact-shell__kind">{{ kindPresentation.label }}</span>
      </span>
      <NTag size="small" :bordered="false">{{ provenanceLabel }}</NTag>
    </header>

    <ChatArtifactImage
      v-if="artifact.kind === 'image' && artifact.status === 'ready'"
      :artifact="artifact"
      :context-id="contextId"
      :client="nativeClient"
    />

    <ChatArtifactVideo
      v-if="artifact.kind === 'video' && artifact.status === 'ready'"
      :artifact="artifact"
      :context-id="contextId"
      :client="videoNativeClient"
    />

    <ChatArtifactFile
      v-if="artifact.kind === 'file' && artifact.status === 'ready'"
      :artifact="artifact"
      :context-id="contextId"
      :client="fileNativeClient"
    />

    <ChatArtifactReport
      v-if="artifact.kind === 'report' && artifact.status === 'ready'"
      :artifact="artifact"
      :context-id="contextId"
      :client="reportNativeClient"
    />

    <div class="artifact-shell__status-row">
      <div class="artifact-shell__status" role="status" aria-live="polite" aria-atomic="true">
        <YjIcon
          :name="statusPresentation.icon"
          size="sm"
          :tone="statusPresentation.tone"
        />
        <NTag size="small" :type="statusPresentation.tag" :bordered="false">
          {{ statusPresentation.label }}
        </NTag>
        <span v-if="progressStageLabel" class="artifact-shell__stage">{{ progressStageLabel }}</span>
      </div>
      <span v-if="artifact.progressPercent !== null" class="artifact-shell__percent">
        {{ artifact.progressPercent }}%
      </span>
    </div>

    <div
      v-if="artifact.progressPercent !== null"
      class="artifact-shell__progress"
      role="progressbar"
      :aria-label="progressLabel"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="artifact.progressPercent"
    >
      <NProgress
        aria-hidden="true"
        type="line"
        :percentage="artifact.progressPercent"
        :show-indicator="false"
        :height="6"
        :processing="busy"
      />
    </div>
  </article>
</template>

<style scoped>
.artifact-shell {
  display: grid;
  gap: var(--yj-space-3);
  padding: var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-subtle);
  transition: border-color var(--yj-motion-fast) var(--yj-ease-standard),
    background var(--yj-motion-fast) var(--yj-ease-standard);
}

.artifact-shell:focus-visible {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.artifact-shell--ready { border-color: color-mix(in srgb, var(--yj-color-success) 30%, transparent); }
.artifact-shell--failed { border-color: color-mix(in srgb, var(--yj-color-error) 30%, transparent); }
.artifact-shell--expired { border-color: color-mix(in srgb, var(--yj-color-warning) 24%, transparent); }

.artifact-shell__header {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--yj-space-3);
}

.artifact-shell__kind-icon {
  display: inline-flex;
  width: var(--yj-space-10);
  height: var(--yj-space-10);
  align-items: center;
  justify-content: center;
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-card);
}

.artifact-shell__identity { min-width: 0; }
.artifact-shell__name {
  display: block;
  overflow: hidden;
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artifact-shell__kind {
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
}

.artifact-shell__status-row,
.artifact-shell__status {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-2);
}
.artifact-shell__status-row {
  justify-content: space-between;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}
.artifact-shell__status {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}
.artifact-shell__stage::before { content: "·"; margin-right: var(--yj-space-2); }
.artifact-shell__percent { font-variant-numeric: tabular-nums; }
.artifact-shell__progress { width: 100%; }

@media (prefers-reduced-motion: reduce) {
  .artifact-shell { transition: none; }
  .artifact-shell__progress :deep(*) { animation: none !important; transition: none !important; }
}
</style>
