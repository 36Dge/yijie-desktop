<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { NConfigProvider, NMessageProvider, darkTheme } from "naive-ui";
import { provideArtifactMediaCache } from "../../../src/composables/chat-artifact-media-cache";
import type { ChatArtifactNativeClient } from "../../../src/api/chat-artifact-native-client";
import ChatArtifactList from "../../../src/components/chat/ChatArtifactList.vue";
import type { ArtifactProjection } from "../../../src/domain/chat-artifact";
import type { ChatArtifactVideoNativeClient } from "../../../src/api/chat-artifact-video-native-client";
import type { ArtifactNativeIdentity } from "../../../src/domain/chat-artifact-native";
import { createNaiveThemeOverrides } from "../../../src/design/theme/naive-theme";
import { uiZoomCssValue, uiZoomedViewportCss, uiZoomedWindowMinimumCss } from "../../../src/domain/ui-zoom";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "../../../src/styles/component-colors.css";
import "../../../src/styles/tooltips.css";
const dark = ref(false), longTitle = ref(false), zoom = ref(100), narrow = ref(false), shown = ref(true), holdReads = ref(false);
const sample = ref("video-red");
const colorNames: Readonly<Record<string, string>> = { red: "红", blue: "蓝", green: "绿" };
const tasks = ["video-red", "video-blue", "video-green", "image-red", "image-blue", "image-green"].map((key, index) => ({
  key, label: `${key.startsWith("video") ? "视频" : "图片"} · ${colorNames[key.split("-")[1]!]}`,
  sessionId: `019c1a00-0000-7000-8000-000000001${String(index).padStart(3, "0")}`,
  turnId: `019c1a00-0000-7000-8000-000000002${String(index).padStart(3, "0")}`,
  artifactId: `019c1a00-0000-7000-8000-000000003${String(index).padStart(3, "0")}`,
}));
provideArtifactMediaCache(() => "019c1a00-0000-7000-8000-000000000501", () => true);
const counts = ref<Record<string, number>>({}), released = ref(0);
const gates = shallowRef<Array<() => void>>([]);
function continueReads() { const waiting = gates.value; gates.value = []; waiting.forEach(resolve => resolve()); }
function finishPendingRead(event: KeyboardEvent) { if (event.key === "F8") { event.preventDefault(); continueReads(); } }
watch(holdReads, value => { if (!value) continueReads(); });
const artifact = computed<ArtifactProjection>(() => {
  const task = tasks.find(task => task.key === sample.value)!;
  const kind = task.key.startsWith("video") ? "video" : "image";
  return { sessionId: task.sessionId, turnId: task.turnId, artifactId: task.artifactId, kind, provenance: "synthetic", status: "ready", ordinal: 0,
    progressStage: null, progressPercent: null, displayName: kind === "image" ? "同名图片.png" : longTitle.value ? "同名视频-用于验证快速切换多个任务与超长文件名仍然完整保留元数据和操作按钮.mp4" : "同名视频.mp4",
    mediaType: kind === "video" ? "video/mp4" : "image/png", sizeBytes: 9122611, localCommittedAt: 1_000, expiresAt: 9999999999, hasPoster: false, errorCode: null, retryable: null };
});
async function preview(identity: ArtifactNativeIdentity) {
  const task = tasks.find(task => task.sessionId === identity.sessionId && task.turnId === identity.turnId && task.artifactId === identity.artifactId)!;
  const request = (counts.value[task.key] ?? 0) + 1;
  counts.value = { ...counts.value, [task.key]: request };
  if (holdReads.value) await new Promise<void>(resolve => { gates.value = [...gates.value, resolve]; });
  const extension = task.key.startsWith("video") ? "mp4" : "png";
  return `/.local/media-stress-20261114/${task.key}.${extension}?task=${task.key}&request=${request}`;
}
const client: ChatArtifactVideoNativeClient = {
  async openVideoPreview(_context, identity) { return { status: "opened", previewUrl: await preview(identity) }; },
  async releaseVideoPreview() { released.value++; return { status: "released" }; },
  async saveVideo() { return { status: "cancelled", code: null }; },
};
const imageClient: ChatArtifactNativeClient = {
  async openImagePreview(_context, identity) { return { status: "opened", previewUrl: await preview(identity) }; },
  async releaseImagePreview() { released.value++; return { status: "released" }; },
  async copyImage() { return { status: "copied" }; },
  async saveImage() { return { status: "cancelled", code: null }; },
};
const players = ref<Array<{ task: string | null; paused: boolean; attached: boolean; time: number }>>([]);
const observed = new Set<HTMLVideoElement>();
let timer: ReturnType<typeof setInterval> | undefined;
function reportPlayers() {
  players.value = [...observed].map(video => ({ task: new URL(video.getAttribute("src") ?? "", location.href).searchParams.get("task"), paused: video.paused, attached: video.isConnected, time: Number(video.currentTime.toFixed(2)) }));
}
function observePlayback(event: Event) {
  if (!(event.target instanceof HTMLVideoElement) || observed.has(event.target)) return;
  const video = event.target;
  observed.add(video);
  video.addEventListener("pause", reportPlayers);
  video.addEventListener("timeupdate", reportPlayers);
  reportPlayers();
}
onMounted(() => { document.addEventListener("play", observePlayback, true); document.addEventListener("keydown", finishPendingRead); timer = setInterval(reportPlayers, 200); });
onBeforeUnmount(() => {
  continueReads(); clearInterval(timer); document.removeEventListener("play", observePlayback, true); document.removeEventListener("keydown", finishPendingRead);
  for (const video of observed) { video.removeEventListener("pause", reportPlayers); video.removeEventListener("timeupdate", reportPlayers); }
});
watch(dark, value => { document.documentElement.dataset.theme = value ? "dark" : "light"; }, { immediate: true });
const theme = computed(() => { void dark.value; return createNaiveThemeOverrides(name => getComputedStyle(document.documentElement).getPropertyValue(name)); });
watch(zoom, value => {
  const style = document.documentElement.style, viewport = uiZoomedViewportCss(value), minimum = uiZoomedWindowMinimumCss(value);
  style.setProperty("zoom", uiZoomCssValue(value)); style.setProperty("--yj-ui-scale", uiZoomCssValue(value));
  style.setProperty("--yj-ui-viewport-width", viewport.width); style.setProperty("--yj-ui-viewport-height", viewport.height);
  style.setProperty("--yj-layout-window-min-width", minimum.width); style.setProperty("--yj-layout-window-min-height", minimum.height);
}, { immediate: true });
</script>
<template>
  <NConfigProvider :theme="dark ? darkTheme : null" :theme-overrides="theme"><NMessageProvider>
    <main>
      <header class="audit-controls">
        <label>任务 <select v-model="sample"><option v-for="task in tasks" :key="task.key" :value="task.key">{{ task.label }}</option></select></label>
        <label><input v-model="shown" type="checkbox">显示产物</label>
        <label><input v-model="holdReads" type="checkbox">暂缓读取</label>
        <button type="button" :disabled="gates.length === 0" @click="continueReads">完成待处理读取（{{ gates.length }}，F8）</button>
        <label><input v-model="dark" type="checkbox">暗色</label>
        <label><input v-model="longTitle" type="checkbox">长标题</label>
        <label><input v-model="narrow" type="checkbox">窄列</label>
        <label>界面缩放 <select v-model="zoom"><option :value="100">100%</option><option :value="200">200%</option></select></label>
      </header>
      <p>不同任务使用相同文件名，红、蓝、绿画面应与所选任务一致。</p>
      <div :style="{ width: narrow ? '180px' : '100%' }"><ChatArtifactList v-if="shown" :key="sample" :artifacts="[artifact]" :native-client="imageClient" context-id="019c1a00-0000-7000-8000-000000000501" :video-native-client="client" /></div>
      <p class="audit-note">普通本地合成素材；8.7 MB 为布局用模拟元数据。这里只验证前端交互，原生保存另行检查。</p>
      <output data-testid="media-read-counts">{{ JSON.stringify({ reads: counts, released }) }}</output>
      <p data-testid="media-playing-count">正在播放：{{ players.filter(player => !player.paused).length }}</p>
      <output data-testid="media-player-states">{{ JSON.stringify(players) }}</output>
    </main>
  </NMessageProvider></NConfigProvider>
</template>
<style scoped>
main { padding: var(--yj-space-6); color: var(--yj-color-text-primary); }
.audit-controls { display: flex; flex-wrap: wrap; gap: var(--yj-space-4); }
.audit-note, output { font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); }
output { display: block; overflow-wrap: anywhere; }
</style>
