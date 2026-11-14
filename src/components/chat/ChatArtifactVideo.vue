<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { NModal, useMessage } from "naive-ui";
import type { ChatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import { chatFilePresentation } from "../../domain/chat-file-presentation";
import { useChatArtifactVideo } from "../../composables/useChatArtifactVideo";
import YjIcon from "../yijie/YjIcon.vue";
import YjTooltip from "../yijie/YjTooltip.vue";

const props = defineProps<{ artifact: ArtifactProjection; contextId: string; client?: ChatArtifactVideoNativeClient }>();
const message = useMessage();
const { eligible, viewerOpen, cover, error, saving, busy,
  openViewer, closeViewer, refresh, saveVideo } = useChatArtifactVideo(props, (text, tone) => message[tone](text));
const id = useId();
const preview = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const refreshButton = ref<HTMLButtonElement | null>(null);
const displayName = computed(() => props.artifact.displayName ?? "未命名视频");
const metadata = computed(() => {
  const format = props.artifact.mediaType ? chatFilePresentation(props.artifact.mediaType).label : "视频";
  const bytes = props.artifact.sizeBytes;
  if (bytes === null) return format;
  const size = bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${format} · ${size}`;
});

function play() {
  preview.value?.focus({ preventScroll: true });
  openViewer();
}
function close() {
  const trigger = preview.value;
  closeViewer();
  void nextTick(() => { if (!viewerOpen.value && trigger?.isConnected) trigger.focus({ preventScroll: true }); });
}
function refreshViewer() {
  refreshButton.value?.focus({ preventScroll: true });
  refresh();
}
watch(viewerOpen, async open => {
  if (!open) return;
  await nextTick();
  if (viewerOpen.value) closeButton.value?.focus({ preventScroll: true });
});
defineExpose({ play });
</script>

<template>
  <section v-if="eligible" class="artifact-video" :aria-label="`视频：${displayName}`">
    <button ref="preview" class="artifact-video__preview" type="button" tabindex="0" data-testid="artifact-video-preview"
      :aria-label="`播放视频：${displayName}`" aria-haspopup="dialog" :aria-busy="!cover && busy" @click="play">
      <canvas v-if="cover" ref="thumbnail" class="artifact-video__thumbnail" data-testid="artifact-video-thumbnail" aria-hidden="true" />
      <span v-if="!cover && busy" class="artifact-video__cover-status" role="status"><YjIcon name="video" size="xl" tone="muted" /><span>加载封面…</span></span>
      <span v-else-if="!cover && error" class="artifact-video__cover-status" role="alert"><YjIcon name="warning" size="lg" tone="muted" /><span>{{ error.message }}</span><span>点击打开视频</span></span>
      <span v-else class="artifact-video__play" aria-hidden="true"><YjIcon name="run" size="lg" /></span>
    </button>

    <NModal :show="viewerOpen" :mask-closable="true" :close-on-esc="true" :trap-focus="true" :auto-focus="false" :block-scroll="true" @update:show="!$event && close()">
      <div class="artifact-video__dialog" data-testid="artifact-video-dialog" role="dialog" aria-modal="true" :aria-labelledby="`${id}-title`" tabindex="-1" @keydown.esc.stop.prevent="close">
        <header class="artifact-video__header">
          <YjTooltip text="关闭" placement="bottom-start" :show-arrow="false" to="body">
            <button ref="closeButton" class="artifact-video__icon-button" type="button" tabindex="0" aria-label="关闭视频预览" data-testid="artifact-video-close" @click="close"><YjIcon name="dismiss" size="sm" :stroke-width="1.5" /></button>
          </YjTooltip>
          <strong :id="`${id}-title`" class="artifact-video__title">{{ displayName }}</strong>
          <span class="artifact-video__metadata">{{ metadata }}</span>
          <div class="artifact-video__actions">
            <YjTooltip text="刷新预览" placement="bottom-end" :show-arrow="false" to="body">
              <button ref="refreshButton" class="artifact-video__icon-button" type="button" tabindex="0" aria-label="刷新预览" data-testid="artifact-video-refresh"
                :disabled="error?.retryable === false" :aria-disabled="busy || undefined" :aria-busy="busy || undefined" @click="refreshViewer"><YjIcon name="refresh" size="sm" :stroke-width="1.5" /></button>
            </YjTooltip>
            <YjTooltip :text="saving ? '下载中…' : '下载视频'" placement="bottom-end" :show-arrow="false" to="body">
              <button class="artifact-video__icon-button" type="button" tabindex="0" aria-label="下载视频" data-testid="artifact-video-save"
                :aria-disabled="saving || undefined" :aria-busy="saving || undefined" @click="saveVideo"><YjIcon name="download" size="sm" :stroke-width="1.5" /></button>
            </YjTooltip>
          </div>
        </header>
        <div class="artifact-video__body" :aria-busy="busy">
          <div class="artifact-video__viewport">
            <div ref="mediaHost" class="artifact-video__media-host" />
            <div v-if="busy" class="artifact-video__status" role="status">
              <canvas v-if="cover" ref="viewerCover" class="artifact-video__viewer-cover" aria-hidden="true" />
              <span class="artifact-video__loading-label">加载中…</span>
            </div>
            <div v-else-if="error" class="artifact-video__status" role="alert">
              <YjIcon name="warning" size="lg" tone="muted" /><span>{{ error.message }}</span>
              <button v-if="error.retryable" class="yj-control" type="button" data-testid="artifact-video-retry" @click="refreshViewer">重新加载</button>
            </div>
          </div>
        </div>
      </div>
    </NModal>
  </section>
</template>

<style scoped>
.artifact-video { min-width: 0; }
.artifact-video__preview { position: relative; display: grid; place-items: center; width: var(--yj-video-inline-size); max-width: 100%; aspect-ratio: 1; overflow: hidden; padding: 0; border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-composer-tray); color: var(--yj-color-text-secondary); cursor: pointer; }
.artifact-video__thumbnail { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.artifact-video__play { position: relative; display: grid; place-items: center; width: var(--yj-space-12); height: var(--yj-space-12); border-radius: var(--yj-radius-full); background: var(--yj-video-play-bg); color: var(--yj-video-play-ink); transition: transform var(--yj-motion-fast) var(--yj-ease-standard); }
.artifact-video__play :deep(svg) { color: inherit; fill: currentColor; }
.artifact-video__preview:hover .artifact-video__play { transform: scale(1.08); }
.artifact-video__cover-status, .artifact-video__status { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: var(--yj-space-3); padding: var(--yj-space-4); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); text-align: center; }
.artifact-video :focus-visible, .artifact-video__dialog :focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.artifact-video__dialog { display: grid; grid-template-rows: auto minmax(0, 1fr); width: min(var(--yj-image-viewer-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); height: min(var(--yj-image-viewer-height), calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8))); overflow: hidden; border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-elevated); color: var(--yj-color-text-primary); box-shadow: var(--yj-shadow-modal); }
.artifact-video__header { display: flex; align-items: center; gap: var(--yj-space-2); min-width: 0; padding: var(--yj-space-1) var(--yj-space-3); background: var(--yj-color-bg-nav); }
.artifact-video__title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-medium); }
.artifact-video__metadata { flex: none; color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); white-space: nowrap; }
.artifact-video__actions { display: flex; flex: none; gap: var(--yj-space-2); margin-inline-start: auto; }
.artifact-video__icon-button { display: grid; place-items: center; flex: none; width: var(--yj-space-8); height: var(--yj-space-8); padding: 0; border: 0; border-radius: var(--yj-radius-md); background: transparent; color: var(--yj-color-icon-subtle); cursor: pointer; }
.artifact-video__icon-button .yj-icon { color: inherit; }
.artifact-video__icon-button:hover:not(:disabled):not([aria-disabled="true"]), .artifact-video__icon-button:focus-visible:not(:disabled):not([aria-disabled="true"]) { background: var(--yj-color-control-pressed); color: var(--yj-color-icon-muted); }
.artifact-video__icon-button:active:not(:disabled):not([aria-disabled="true"]) { background: var(--yj-color-border-default); }
.artifact-video__icon-button[aria-disabled="true"] { color: var(--yj-color-text-disabled); cursor: wait; }
.artifact-video__icon-button:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.artifact-video__body { display: grid; align-items: center; min-height: 0; min-width: 0; padding: var(--yj-space-4); }
.artifact-video__viewport { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.artifact-video__media-host { display: contents; }
.artifact-video__viewport :deep(.artifact-video__media) { display: block; width: 100%; max-height: 100%; aspect-ratio: 16 / 9; border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-subtle); object-fit: contain; }
.artifact-video__viewport :deep(.artifact-video__media:focus-visible) { outline-offset: calc(var(--yj-space-1) * -1); }
.artifact-video__status { position: absolute; inset: 0; background: var(--yj-color-bg-elevated); }
.artifact-video__viewer-cover { position: absolute; width: 100%; max-height: 100%; object-fit: contain; }
.artifact-video__loading-label { position: relative; padding: var(--yj-space-2) var(--yj-space-3); border-radius: var(--yj-radius-md); background: var(--yj-color-bg-elevated); }
@media (prefers-reduced-motion: reduce) { .artifact-video__play { transition: none; } }
</style>
