<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { NConfigProvider, NMessageProvider, darkTheme } from "naive-ui";
import ChatArtifactList from "../../../src/components/chat/ChatArtifactList.vue";
import ChatAnswerActions from "../../../src/components/chat/ChatAnswerActions.vue";
import { createNaiveThemeOverrides } from "../../../src/design/theme/naive-theme";
import { uiZoomCssValue, uiZoomedViewportCss, uiZoomedWindowMinimumCss } from "../../../src/domain/ui-zoom";
import type { ArtifactProjection } from "../../../src/domain/chat-artifact";
import type { ChatArtifactNativeClient } from "../../../src/api/chat-artifact-native-client";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "../../../src/styles/component-colors.css";
import "../../../src/styles/chat-control-menu.css";

// Only normal local drawings and in-memory outcomes. No native bridge or model calls.
const samples = { landscape: [2048, 1152], portrait: [1152, 2048], square: [1536, 1536], panorama: [2560, 640], small: [128, 128] } as const;
const shape = ref<keyof typeof samples>("landscape");
const dark = ref(false), zoom = ref(100), narrow = ref(false), multiple = ref(false), longTitle = ref(false);
const status = ref<ArtifactProjection["status"]>("ready");
const root = ref<HTMLElement | null>(null), report = ref("");
const calls = ref({ open: 0, release: 0, copy: 0, save: 0 });
const urls = new Map<string, string>();
for (const [name, [width, height]] of Object.entries(samples)) {
  const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#dcdfdf"/><rect x="16" y="16" width="${width - 32}" height="${height - 32}" fill="#a5c3cb"/><path d="M16 ${height - 16} L${width / 2} ${height / 3} L${width - 16} ${height - 16}" fill="#638b7b"/><circle cx="${width * 0.72}" cy="${height * 0.25}" r="${Math.min(width, height) * 0.1}" fill="#efd498"/></svg>`;
  urls.set(name, URL.createObjectURL(new Blob([drawing], { type: "image/svg+xml" })));
}
const names = Object.keys(samples) as (keyof typeof samples)[];
const artifactId = (name: string) => `019c1a00-0000-7000-8000-00000000040${names.indexOf(name as keyof typeof samples) + 1}`;
const artifacts = computed<ArtifactProjection[]>(() => (multiple.value ? names.slice(0, 3) : [shape.value]).map(name => ({
  sessionId: "019c1a00-0000-7000-8000-000000000411", turnId: "019c1a00-0000-7000-8000-000000000412", artifactId: artifactId(name),
  kind: "image", provenance: "synthetic", status: status.value, ordinal: names.indexOf(name), progressStage: null, progressPercent: null,
  displayName: longTitle.value ? `${name}-带有完整构图说明和长名称的普通合成图片-用于验证标题换行不会改变图片定位.svg` : `${name}-普通合成图片.svg`, mediaType: "image/svg+xml", sizeBytes: 512, localCommittedAt: 1_000, expiresAt: 9999999999, hasPoster: false, errorCode: null, retryable: true,
})));
const client: ChatArtifactNativeClient = {
  async openImagePreview(_context, identity) { calls.value.open++; const name = names.find(name => artifactId(name) === identity.artifactId)!; return { status: "opened", previewUrl: urls.get(name)! }; },
  async releaseImagePreview() { calls.value.release++; return { status: "released" }; },
  async copyImage() { calls.value.copy++; return { status: "copied" }; },
  async saveImage() { calls.value.save++; return { status: "cancelled", code: null }; },
};
const theme = computed(() => { void dark.value; return createNaiveThemeOverrides(name => getComputedStyle(document.documentElement).getPropertyValue(name)); });
watch(dark, value => { document.documentElement.dataset.theme = value ? "dark" : "light"; }, { immediate: true });
function applyZoom() {
  const style = document.documentElement.style, viewport = uiZoomedViewportCss(zoom.value), minimum = uiZoomedWindowMinimumCss(zoom.value);
  style.setProperty("zoom", uiZoomCssValue(zoom.value)); style.setProperty("--yj-ui-scale", uiZoomCssValue(zoom.value));
  style.setProperty("--yj-ui-viewport-width", viewport.width); style.setProperty("--yj-ui-viewport-height", viewport.height);
  style.setProperty("--yj-layout-window-min-width", minimum.width); style.setProperty("--yj-layout-window-min-height", minimum.height);
}
watch(zoom, applyZoom); onMounted(applyZoom);
onBeforeUnmount(() => { urls.forEach(url => URL.revokeObjectURL(url)); });
async function checkLayout() {
  await nextTick();
  const scale = zoom.value / 100;
  const measurements = [...root.value!.querySelectorAll<HTMLElement>(".artifact-image")].map(figure => {
    const image = figure.querySelector<HTMLImageElement | HTMLCanvasElement>(".artifact-image__inline");
    const button = figure.querySelector<HTMLElement>(".artifact-image__more");
    const width = image instanceof HTMLImageElement ? image.naturalWidth : image?.width;
    const height = image instanceof HTMLImageElement ? image.naturalHeight : image?.height;
    if (!width || !height || !image || !button) return { ok: false, reason: "图片尚未就绪" };
    const img = image.getBoundingClientRect(), frame = figure.querySelector(".artifact-image__frame")!.getBoundingClientRect(), preview = figure.querySelector(".artifact-image__preview")!.getBoundingClientRect(), more = button.getBoundingClientRect();
    const same = (a: number, b: number) => Math.abs(a - b) <= 1;
    return { ok: same(frame.width, img.width) && same(frame.height, img.height) && same(preview.width, img.width) && same(img.right - more.right, 8 * scale) && same(more.top - img.top, 8 * scale) && more.bottom <= img.bottom && img.width <= 440 * scale + 1 && img.height <= 440 * scale + 1 && Math.abs(img.width / img.height - width / height) < 0.005,
      name: image.getAttribute("alt") ?? image.getAttribute("aria-label"), image: [img.width, img.height], frame: [frame.width, frame.height], rightInset: img.right - more.right, topInset: more.top - img.top, scale };
  });
  report.value = JSON.stringify({ ok: measurements.length > 0 && measurements.every(row => row.ok), measurements }, null, 2);
}
</script>
<template>
  <NConfigProvider :theme="dark ? darkTheme : null" :theme-overrides="theme"><NMessageProvider>
    <nav class="audit-controls">
      <label>图片比例 <select v-model="shape" aria-label="图片比例"><option v-for="name in names" :key="name">{{ name }}</option></select></label>
      <label>界面缩放 <select v-model.number="zoom" aria-label="界面缩放"><option v-for="value in [80,100,120,160,200]" :key="value">{{ value }}</option></select></label>
      <label>状态 <select v-model="status" aria-label="图片状态"><option v-for="value in ['ready','announced','generating','transferring','failed','cancelled','expired']" :key="value">{{ value }}</option></select></label>
      <button @click="longTitle = !longTitle">切换长标题</button><button @click="dark = !dark">切换亮暗主题</button><button @click="narrow = !narrow">切换窄列</button><button @click="multiple = !multiple">切换多图</button><button @click="checkLayout">检查布局</button>
    </nav>
    <main ref="root" class="audit-column" :class="{ 'is-narrow': narrow }">
      <p>普通合成图片，用于验证真实组件几何与交互；不发起生图或原生写入。</p>
      <ChatArtifactList :artifacts="artifacts" context-id="019c1a00-0000-7000-8000-000000000413" :native-client="client" />
      <ChatAnswerActions identity="audit-answer" text="普通本地验证" :adapter="{writeText: async () => {}}" />
    </main>
    <pre class="audit-report" aria-label="布局检查结果">{{ report }}</pre><output class="audit-report" aria-label="调用计数">{{ calls }}</output>
  </NMessageProvider></NConfigProvider>
</template>
<style scoped>
.audit-controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--yj-space-3); padding: var(--yj-space-4); }
.audit-controls label { display: inline-flex; gap: var(--yj-space-1); }
.audit-column { width: min(760px, calc(100% - 48px)); margin: var(--yj-space-6) auto; }
.audit-column.is-narrow { width: min(320px, calc(100% - 48px)); }
.audit-report { display: block; white-space: pre-wrap; overflow-wrap: anywhere; padding: var(--yj-space-4); margin: 0; }
</style>
