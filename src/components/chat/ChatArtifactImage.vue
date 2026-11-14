<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch, watchEffect } from "vue";
import { NModal, NPopover, useMessage } from "naive-ui";
import type { ChatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import { useChatArtifactImage } from "../../composables/useChatArtifactImage";
import { drawArtifactFrame } from "../../composables/chat-artifact-media-cache";
import YjIcon from "../yijie/YjIcon.vue";
import YjTooltip from "../yijie/YjTooltip.vue";

const props = defineProps<{ artifact: ArtifactProjection; contextId: string; client?: ChatArtifactNativeClient }>();
const message = useMessage();
const { eligible, generating, title, status, alt, source, inlinePhase, inlineError, inlineBusy,
  lightboxOpen, lightboxPhase, lightboxError, lightboxBusy, openLightbox, closeLightbox,
  openPreview, action, performAction } = useChatArtifactImage(props, (text, tone) => { message[tone](text); });
const id = useId();
const menuOpen = ref(false);
const overlay = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const preview = ref<HTMLButtonElement | null>(null);
const inlineCanvas = ref<HTMLCanvasElement | null>(null);
const inlineImageHost = ref<HTMLElement | null>(null);
const viewerImageHost = ref<HTMLElement | null>(null);
const viewerPresented = computed(() => lightboxOpen.value || viewerImageHost.value !== null);
const closeButton = ref<HTMLButtonElement | null>(null);
const viewport = ref<HTMLElement | null>(null);
const zoom = ref(1);
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`);
const dimensions = ref({ width: 0, height: 0 });
const bounds = ref({ width: 0, height: 0 });
const imageSize = computed(() => {
  const { width, height } = dimensions.value;
  if (!width || !height || !bounds.value.width || !bounds.value.height) return undefined;
  const fit = Math.min(bounds.value.width / width, bounds.value.height / height, 1);
  return { width: `${width * fit * zoom.value}px`, height: `${height * fit * zoom.value}px` };
});
let observer: ResizeObserver | undefined;
let viewerRevision = 0;
let pan: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
let gestureStartZoom: number | null = null;
const panning = ref(false);

async function setMenuOpen(open: boolean) {
  menuOpen.value = open;
  if (!open) return;
  await nextTick();
  // A pointer-opened menu owns Escape/arrow keys too, without highlighting
  // an arbitrary action as though it had been selected with the keyboard.
  if (menuOpen.value) menu.value?.focus({ preventScroll: true });
}
async function openMenuWithKeyboard() {
  await setMenuOpen(true);
  if (menuOpen.value) menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}
watch(eligible, ready => { if (!ready) menuOpen.value = false; });
watch(() => [props.contextId, props.artifact.sessionId, props.artifact.turnId, props.artifact.artifactId], () => { menuOpen.value = false; });
function dismissMenu(restore = true) {
  menuOpen.value = false;
  if (restore) trigger.value?.focus({ preventScroll: true });
}
function menuKey(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); dismissMenu(); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = [...menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : index < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0)
    : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
  items[next]?.focus();
}
function selectAction(kind: "copy" | "save") {
  dismissMenu();
  void performAction(kind);
}
function openViewer() {
  if (!eligible.value || inlinePhase.value !== "ready" || lightboxOpen.value) return;
  dismissMenu(false);
  // The library focus trap records this trigger before the modal is mounted.
  preview.value?.focus({ preventScroll: true });
  openLightbox();
}
function closeViewer() {
  const target = preview.value;
  closeLightbox();
  void nextTick(() => { if (!lightboxOpen.value && target?.isConnected) target.focus({ preventScroll: true }); });
}
function refreshViewer(event: MouseEvent) {
  if (lightboxBusy.value || lightboxError.value?.retryable === false) return;
  // WebKit does not always focus pointer-activated buttons. Keep an explicit
  // focus owner while the image is replaced, without disabling that owner.
  (event.currentTarget as HTMLButtonElement).focus({ preventScroll: true });
  void openPreview("lightbox");
}
function measure() {
  if (viewport.value) bounds.value = { width: viewport.value.clientWidth, height: viewport.value.clientHeight };
}
watch(lightboxOpen, async open => {
  const revision = ++viewerRevision;
  observer?.disconnect();
  observer = undefined;
  pan = null; panning.value = false;
  gestureStartZoom = null;
  if (open) { zoom.value = 1; dimensions.value = { width: 0, height: 0 }; }
  await nextTick();
  if (revision === viewerRevision && open && lightboxOpen.value) {
    closeButton.value?.focus();
    measure();
    if (viewport.value && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(viewport.value);
    }
  }
});
watchEffect(() => {
  const image = source.value;
  if (image && inlineCanvas.value && inlinePhase.value === "ready") drawArtifactFrame(inlineCanvas.value, image, 880);
  if (!image || inlinePhase.value !== "ready") return;
  const host = viewerPresented.value ? viewerImageHost.value : inlineImageHost.value;
  if (!host) return;
  image.className = viewerPresented.value ? "artifact-image__dialog-image" : "artifact-image__inline";
  image.dataset.testid = viewerPresented.value ? "artifact-image-dialog-img" : "artifact-image-inline";
  image.alt = alt.value;
  image.draggable = false;
  image.style.width = viewerPresented.value ? imageSize.value?.width ?? "" : "";
  image.style.height = viewerPresented.value ? imageSize.value?.height ?? "" : "";
  if (image.parentElement !== host) host.replaceChildren(image);
}, { flush: "post" });
watch([source, lightboxOpen, lightboxPhase], async () => {
  if (!lightboxOpen.value || !source.value) return;
  dimensions.value = { width: source.value.naturalWidth, height: source.value.naturalHeight };
  await nextTick();
  measure();
}, { flush: "post" });
async function setZoom(value: number) {
  if (lightboxPhase.value !== "ready" || !Number.isFinite(value)) return;
  const previous = zoom.value;
  // Keep fractional wheel/trackpad movement; round only the displayed percent.
  const next = Math.min(4, Math.max(0.1, value));
  if (next === previous) return;
  const view = viewport.value;
  const oldWidth = view?.scrollWidth ?? 0;
  const oldHeight = view?.scrollHeight ?? 0;
  const x = view && oldWidth ? (view.scrollLeft + view.clientWidth / 2) / oldWidth : 0.5;
  const y = view && oldHeight ? (view.scrollTop + view.clientHeight / 2) / oldHeight : 0.5;
  zoom.value = next;
  await nextTick();
  if (view) {
    view.scrollLeft = x * view.scrollWidth - view.clientWidth / 2;
    view.scrollTop = y * view.scrollHeight - view.clientHeight / 2;
  }
}
function wheel(event: WheelEvent) {
  if (gestureStartZoom !== null && event.ctrlKey) return;
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.value.height : 1);
  void setZoom(zoom.value * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)));
}
function startGesture() {
  gestureStartZoom = lightboxPhase.value === "ready" ? zoom.value : null;
  stopPan();
}
function changeGesture(event: Event) {
  const scale = (event as Event & { scale?: number }).scale;
  if (gestureStartZoom !== null && typeof scale === "number" && scale > 0) void setZoom(gestureStartZoom * scale);
}
function endGesture() { gestureStartZoom = null; }
function startPan(event: PointerEvent) {
  if (event.button !== 0 || zoom.value <= 1 || !viewport.value) return;
  event.preventDefault();
  pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.value.scrollLeft, top: viewport.value.scrollTop };
  viewport.value.setPointerCapture(event.pointerId);
  panning.value = true;
}
function movePan(event: PointerEvent) {
  if (!pan || pan.pointerId !== event.pointerId || !viewport.value) return;
  const scale = viewport.value.getBoundingClientRect().width / viewport.value.clientWidth || 1;
  viewport.value.scrollLeft = pan.left - (event.clientX - pan.x) / scale;
  viewport.value.scrollTop = pan.top - (event.clientY - pan.y) / scale;
}
function stopPan() { pan = null; panning.value = false; }
function key(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeViewer(); return; }
  if (["+", "=", "-", "0"].includes(event.key)) {
    event.preventDefault(); event.stopPropagation();
    void setZoom(event.key === "0" ? 1 : zoom.value + (event.key === "-" ? -0.1 : 0.1));
  }
}
onBeforeUnmount(() => { ++viewerRevision; observer?.disconnect(); });
defineExpose({ openLightbox: openViewer });
</script>

<template>
  <Teleport to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <figure v-if="artifact.kind === 'image'" class="artifact-image" :aria-labelledby="`${id}-title`" :aria-busy="generating || inlineBusy">
    <figcaption :id="`${id}-title`" class="artifact-image__title">{{ title }}</figcaption>
    <div class="artifact-image__frame" :class="{ 'is-menu-open': menuOpen, 'is-loading-frame': inlineBusy }">
      <button v-if="inlinePhase === 'ready'" ref="preview" type="button" tabindex="0" class="artifact-image__preview" data-testid="artifact-image-preview"
        :aria-label="`预览图片：${title}`" @click="openViewer">
        <span ref="inlineImageHost" class="artifact-image__source-host" />
        <canvas v-if="viewerPresented" ref="inlineCanvas" class="artifact-image__inline" data-testid="artifact-image-inline" role="img" :aria-label="alt" />
      </button>
      <div v-if="generating || inlineBusy" class="artifact-image__placeholder"  role="status" data-testid="artifact-image-loading">
        <YjIcon class="artifact-image__loading-icon" name="image" size="xl" />
        <span>{{ generating ? status : '加载中…' }}</span>
      </div>
      <div v-else-if="inlineError || !eligible" class="artifact-image__placeholder artifact-image__error" :role="inlineError || artifact.status === 'failed' ? 'alert' : 'status'">
        <YjIcon :name="artifact.status === 'cancelled' ? 'image' : 'warning'" size="xl" tone="muted" />
        <span>{{ inlineError?.message ?? status }}</span>
        <button v-if="inlineError?.retryable" class="yj-control" type="button" data-testid="artifact-image-retry" @click="openPreview('inline')">重新加载</button>
      </div>
      <NPopover v-if="eligible" :to="overlay ?? false" :show="menuOpen" trigger="click" placement="bottom-end" :show-arrow="false" raw @update:show="setMenuOpen">
        <template #trigger>
          <span class="artifact-image__more-anchor chat-control-anchor">
            <YjTooltip :text="menuOpen ? null : '图片操作'" to="body">
              <button ref="trigger" class="artifact-image__more" type="button" tabindex="0" aria-label="图片操作" aria-haspopup="menu" :aria-expanded="menuOpen" :aria-controls="menuOpen ? `${id}-menu` : undefined"
                data-testid="artifact-image-more" @keydown.down.prevent="openMenuWithKeyboard" @keydown.enter.prevent="openMenuWithKeyboard" @keydown.space.prevent="openMenuWithKeyboard" @keydown.esc.stop="dismissMenu()">
                <YjIcon name="more" size="md" />
              </button>
            </YjTooltip>
          </span>
        </template>
        <div :id="`${id}-menu`" ref="menu" class="artifact-image__menu chat-control-menu" role="menu" tabindex="-1" aria-label="图片操作" @keydown="menuKey">
          <button class="chat-control-option" type="button" role="menuitem" disabled aria-description="暂未开放">
            <YjIcon name="quote" size="sm" />引用到对话
          </button>
          <button class="chat-control-option" type="button" role="menuitem" data-testid="artifact-image-copy" :disabled="Boolean(action)" @click="selectAction('copy')">
            <YjIcon name="copy" size="sm" />{{ action === 'copy' ? '复制中…' : '复制图片' }}
          </button>
          <button class="chat-control-option" type="button" role="menuitem" data-testid="artifact-image-save" :disabled="Boolean(action)" @click="selectAction('save')">
            <YjIcon name="download" size="sm" />{{ action === 'save' ? '下载中…' : '下载图片' }}
          </button>
        </div>
      </NPopover>
    </div>
    <NModal :show="lightboxOpen" :mask-closable="true" :close-on-esc="true" :trap-focus="true" :auto-focus="false" :block-scroll="true" @update:show="!$event && closeViewer()" @after-enter="measure">
      <div class="artifact-image__dialog" data-testid="artifact-image-dialog" role="dialog" aria-modal="true"
        :aria-labelledby="`${id}-viewer-title`" :aria-describedby="`${id}-zoom-help`" tabindex="-1" @keydown="key">
        <header class="artifact-image__dialog-header">
          <YjTooltip text="关闭" placement="bottom-start" :show-arrow="false" to="body">
            <button ref="closeButton" class="artifact-image__icon-button" type="button" tabindex="0" data-testid="artifact-image-close" aria-label="关闭图片预览" @click="closeViewer"><YjIcon name="dismiss" size="sm" :stroke-width="1.5" /></button>
          </YjTooltip>
          <strong :id="`${id}-viewer-title`">{{ title }}</strong><span class="artifact-image__kind">· 图片</span>
          <YjTooltip text="刷新预览" placement="bottom-end" :show-arrow="false" to="body">
            <button class="artifact-image__icon-button artifact-image__refresh" type="button" tabindex="0" data-testid="artifact-image-refresh" aria-label="刷新预览"
              :disabled="lightboxError?.retryable === false" :aria-disabled="lightboxBusy || undefined" :aria-busy="lightboxBusy || undefined" @click="refreshViewer"><YjIcon name="refresh" size="sm" :stroke-width="1.5" /></button>
          </YjTooltip>
        </header>
        <div class="artifact-image__dialog-body" :aria-busy="lightboxBusy">
          <div ref="viewport" class="artifact-image__viewport" :class="{ 'is-zoomed': zoom > 1, 'is-panning': panning }" tabindex="0" aria-label="图片缩放与移动"
            @wheel.prevent="wheel" @gesturestart.prevent="startGesture" @gesturechange.prevent="changeGesture" @gestureend.prevent="endGesture"
            @pointerdown="startPan" @pointermove="movePan" @pointerup="stopPan" @pointercancel="stopPan" @lostpointercapture="stopPan" @dblclick="setZoom(1)">
            <div class="artifact-image__canvas" :style="imageSize ? { minWidth: imageSize.width, minHeight: imageSize.height } : undefined">
              <div ref="viewerImageHost" class="artifact-image__source-host" />
            </div>
          </div>
          <div v-if="lightboxBusy" class="artifact-image__dialog-status" :class="{ 'artifact-image__dialog-status--refresh': inlinePhase === 'ready' }" role="status" data-testid="artifact-image-refresh-status">
            <YjIcon v-if="inlinePhase !== 'ready'" class="artifact-image__loading-icon" name="image" size="xl" />{{ inlinePhase === 'ready' ? '刷新中…' : '加载中…' }}
          </div>
          <div v-else-if="lightboxError" class="artifact-image__dialog-status" role="alert"><span>{{ lightboxError.message }}</span><button v-if="lightboxError.retryable" class="yj-control" type="button" @click="openPreview('lightbox')">重新加载</button></div>
          <output v-if="inlinePhase === 'ready'" class="artifact-image__zoom" data-testid="artifact-image-zoom-value" aria-label="缩放比例" aria-live="polite">{{ zoomLabel }}</output>
        </div>
        <p :id="`${id}-zoom-help`" class="sr-only">滚轮或触控板缩放图片，放大后可拖动。键盘加号放大、减号缩小、0 恢复，Escape 关闭。</p>
      </div>
    </NModal>
  </figure>
</template>

<style scoped>
.artifact-image { display: grid; justify-items: start; gap: var(--yj-space-2); min-width: 0; margin: 0; }
.artifact-image__title { max-width: min(100%, var(--yj-image-inline-size)); color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-semibold); overflow-wrap: anywhere; }
.artifact-image__frame { position: relative; display: block; max-width: min(100%, var(--yj-image-inline-size)); width: fit-content; border-radius: var(--yj-radius-xs); }
.artifact-image__frame.is-loading-frame { width: var(--yj-image-placeholder-size); height: var(--yj-image-placeholder-size); }
.artifact-image__frame.is-loading-frame .artifact-image__preview { position: absolute; inset: 0; visibility: hidden; }
.artifact-image__preview { display: block; max-width: 100%; padding: 0; border: 0; border-radius: inherit; overflow: hidden; background: transparent; cursor: pointer; }
.artifact-image__frame :deep(.artifact-image__inline) { display: block; width: auto; height: auto; max-width: 100%; max-height: var(--yj-image-inline-size); border-radius: inherit; object-fit: contain; }
.is-loading { opacity: 0; }
.artifact-image__preview:disabled { cursor: wait; }
.artifact-image__placeholder { display: flex; box-sizing: border-box; flex-direction: column; align-items: center; justify-content: center; gap: var(--yj-space-3); width: var(--yj-image-placeholder-size); max-width: 100%; aspect-ratio: 1; padding: var(--yj-space-6); border-radius: var(--yj-radius-md); background: var(--yj-color-bg-composer-tray); color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); text-align: center; }
.artifact-image__loading-icon { width: var(--yj-space-10); height: var(--yj-space-10); color: var(--yj-color-text-secondary); animation: image-breathe 1.8s ease-in-out infinite; }
.artifact-image__placeholder.is-overlay { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: auto; }
.artifact-image__error { gap: var(--yj-space-2); font-size: var(--yj-font-size-caption); }
.artifact-image__more-anchor { position: absolute; top: var(--yj-space-2); right: var(--yj-space-2); opacity: 0; pointer-events: none; transition: opacity var(--yj-motion-fast) var(--yj-ease-standard); }
.artifact-image__frame:hover .artifact-image__more-anchor, .artifact-image__frame:focus-within .artifact-image__more-anchor, .is-menu-open .artifact-image__more-anchor { opacity: 1; pointer-events: auto; }
.artifact-image__more { display: grid; place-items: center; width: var(--yj-space-8); height: var(--yj-space-8); padding: 0; border: 0; border-radius: var(--yj-radius-md); background: transparent; color: var(--yj-color-text-primary); cursor: pointer; }
.artifact-image__menu { width: min(var(--yj-image-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); border-radius: var(--yj-radius-xl); }
.artifact-image__menu:focus { outline: none; }
.artifact-image__menu .chat-control-option { padding: var(--yj-space-2); min-height: var(--yj-space-8); gap: var(--yj-space-3); }
.artifact-image :focus-visible, .artifact-image__dialog :focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.artifact-image__dialog { position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr); width: min(var(--yj-image-viewer-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); height: min(var(--yj-image-viewer-height), calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8))); overflow: hidden; border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-elevated); color: var(--yj-color-text-primary); box-shadow: var(--yj-shadow-modal); }
.artifact-image__dialog-header { display: flex; align-items: center; gap: var(--yj-space-2); min-width: 0; padding: var(--yj-space-1) var(--yj-space-3); background: var(--yj-color-bg-nav); }
.artifact-image__dialog-header strong { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-medium); }
.artifact-image__kind { flex: none; color: var(--yj-color-text-tertiary); }
.artifact-image__icon-button { display: grid; place-items: center; flex: none; width: var(--yj-space-8); height: var(--yj-space-8); padding: 0; border: 0; border-radius: var(--yj-radius-md); background: transparent; color: var(--yj-color-icon-subtle); cursor: pointer; }
.artifact-image__icon-button .yj-icon { color: inherit; }
.artifact-image__icon-button:hover:not(:disabled):not([aria-disabled="true"]), .artifact-image__icon-button:focus-visible:not(:disabled):not([aria-disabled="true"]) { background: var(--yj-color-control-pressed); color: var(--yj-color-icon-muted); }
.artifact-image__icon-button:active:not(:disabled):not([aria-disabled="true"]) { background: var(--yj-color-border-default); }
.artifact-image__icon-button[aria-disabled="true"] { color: var(--yj-color-text-disabled); cursor: wait; }
.artifact-image__icon-button:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.artifact-image__icon-button:disabled .yj-icon { color: inherit; }
.artifact-image__refresh { margin-inline-start: auto; }
.artifact-image__dialog-body { position: relative; display: grid; min-height: 0; min-width: 0; padding: var(--yj-space-4); }
.artifact-image__viewport { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; touch-action: none; }
.artifact-image__viewport.is-zoomed { cursor: grab; }
.artifact-image__viewport.is-panning { cursor: grabbing; }
.artifact-image__canvas { display: grid; width: 100%; height: 100%; place-items: center; }
.artifact-image__source-host { display: contents; }
.artifact-image__canvas :deep(.artifact-image__dialog-image) { display: block; max-width: none; max-height: none; object-fit: contain; user-select: none; }
.artifact-image__dialog-status { position: absolute; inset: var(--yj-space-4); display: flex; align-items: center; justify-content: center; flex-direction: column; gap: var(--yj-space-3); background: var(--yj-color-bg-elevated); color: var(--yj-color-text-secondary); text-align: center; }
.artifact-image__dialog-status--refresh { inset: auto var(--yj-space-4) var(--yj-space-4) auto; padding: var(--yj-space-2) var(--yj-space-3); border-radius: var(--yj-radius-md); background: color-mix(in srgb, var(--yj-color-bg-elevated) 94%, transparent); font-size: var(--yj-font-size-caption); pointer-events: none; }
.artifact-image__zoom { position: absolute; left: 50%; bottom: var(--yj-space-6); transform: translateX(-50%); padding: var(--yj-space-1) var(--yj-space-3); border-radius: var(--yj-radius-full); background: color-mix(in srgb, var(--yj-color-bg-nav) 94%, transparent); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); font-variant-numeric: tabular-nums; pointer-events: none; }
.sr-only { position: absolute; width: var(--yj-border-width); height: var(--yj-border-width); padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes image-breathe { 0%, 100% { opacity: 0.45; transform: scale(0.96); } 50% { opacity: 1; transform: scale(1); } }
@media (hover: none) { .artifact-image__more-anchor { opacity: 1; pointer-events: auto; } }
@media (prefers-reduced-motion: reduce) { .artifact-image__loading-icon { animation: none; } .artifact-image__more-anchor { transition: none; } }
</style>
