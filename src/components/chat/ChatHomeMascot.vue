<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import awake from "../../assets/mascot/otter-awake.webp";
import asset from "../../assets/mascot/provenance.json";
import { createMascotPlayback } from "./home-mascot-playback";
import { createMascotHoverTrigger } from "./home-mascot-hover";
import { getAcceptedHoverMedia, type MascotMedia } from "./home-mascot-hover-media";

const props = withDefaults(defineProps<{ ready: boolean; skipAnimation?: boolean }>(), { skipAnimation: false });
const bundledSheets = import.meta.glob<string>("../../assets/mascot/frames/*.webp", { eager: true, query: "?url", import: "default" });
const sheetUrls = asset.playback.sheets.map(sheet => bundledSheets[`../../assets/mascot/${sheet.file}`]);
const [width, height] = asset.deliveryResolution;
const hoverMedia = getAcceptedHoverMedia();
const activeClip = ref<"entry" | "hover">("entry");
let currentMedia: MascotMedia = { asset, urls: sheetUrls };
const phase = ref<"waiting" | "loading" | "playing" | "paused" | "resting" | "static">("waiting");
const canvas = ref<HTMLCanvasElement | null>(null);
const drawnFrame = ref(-1);
const posterFailed = ref(false);
const decoded = new Map<number, HTMLImageElement>();
const pending = new Map<number, Promise<void>>();
const images = new Set<HTMLImageElement>();
let context: CanvasRenderingContext2D | null = null;
let frameBuffer: HTMLCanvasElement | null = null;
let frameContext: CanvasRenderingContext2D | null = null;
let playback: ReturnType<typeof createMascotPlayback> | null = null;
let preference: MediaQueryList | null = null;
let mounted = false;
let disposed = false;
let consumed = false;
let epoch = 0;
let currentSheet = 0;
let hoverTrigger: ReturnType<typeof createMascotHoverTrigger> | null = null;
let hitMask: Uint8Array | null = null;
let lastPointer: { x: number; y: number; blocked: boolean } | null = null;

function syncHoverAvailability(): void {
  hoverTrigger?.setEnabled(Boolean(mounted && !disposed && phase.value === "resting"
    && hoverMedia && hitMask && !preference?.matches && !document.hidden));
}
function prepareHitMask(): void {
  if (!hoverMedia || !context || hitMask) return;
  try {
    const rgba = context.getImageData(0, 0, width, height).data;
    hitMask = new Uint8Array(width * height);
    for (let i = 0; i < hitMask.length; i++) hitMask[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
  } catch { hitMask = null; }
}
function pointerHits(): boolean {
  if (!lastPointer || lastPointer.blocked || !hitMask || !canvas.value) return false;
  const bounds = canvas.value.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const x = lastPointer.x - bounds.left, y = lastPointer.y - bounds.top;
  if (x < 0 || x >= bounds.width || y < 0 || y >= bounds.height) return false;
  const overlap = Math.max(0, parseFloat(getComputedStyle(canvas.value).getPropertyValue("--yj-home-mascot-overlap")) || 0);
  // The input card's overlapping strip must remain ordinary input space.
  if (y >= bounds.height - overlap) return false;
  const px = Math.min(width - 1, Math.floor(x / bounds.width * width));
  const py = Math.min(height - 1, Math.floor(y / bounds.height * height));
  return hitMask[py * width + px] === 1;
}
function pointerMoved(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  lastPointer = {
    x: event.clientX, y: event.clientY,
    blocked: (event.pointerType !== "mouse" && event.pointerType !== "pen") || event.buttons !== 0
      || Boolean(target?.closest("button, a, input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")),
  };
  hoverTrigger?.setInside(pointerHits());
}
function pointerLeft(): void { lastPointer = null; hoverTrigger?.setInside(false); }
function makePlayback(): ReturnType<typeof createMascotPlayback> {
  return createMascotPlayback({ frameCount: currentMedia.asset.frameCount, fps: currentMedia.asset.fps, paint, complete: () => {
    phase.value = "resting";
    releaseSheets();
    if (activeClip.value === "entry") {
      prepareHitMask();
      // A pointer already resting here when the entrance finishes is not a fresh entry.
      hoverTrigger?.setInside(pointerHits());
    }
    hoverTrigger?.complete();
    syncHoverAvailability();
  } });
}
async function startHover(): Promise<void> {
  if (!hoverMedia || phase.value !== "resting" || preference?.matches || document.hidden) {
    hoverTrigger?.complete(); syncHoverAvailability(); return;
  }
  playback?.dispose();
  releaseSheets();
  currentMedia = hoverMedia;
  currentSheet = 0;
  activeClip.value = "hover";
  phase.value = "loading";
  syncHoverAvailability();
  playback = makePlayback();
  await primeSheets();
  if (disposed || phase.value !== "loading") return;
  if (preference?.matches) { freeze(); return; }
  if (document.hidden) { phase.value = "paused"; return; }
  phase.value = "playing";
  playback.play();
}

function releaseSheets(): void {
  epoch += 1;
  for (const image of images) image.src = "";
  images.clear(); decoded.clear(); pending.clear();
}
function freeze(): void {
  consumed = true;
  playback?.pause();
  phase.value = "static";
  hoverTrigger?.setEnabled(false);
  hoverTrigger?.complete();
  // Keep the pixels already on the canvas. Never substitute a different pose.
  releaseSheets();
}
function loadSheet(index: number): Promise<void> {
  if (index >= currentMedia.urls.length || decoded.has(index)) return Promise.resolve();
  const existing = pending.get(index);
  if (existing) return existing;
  const generation = epoch;
  const image = new Image();
  images.add(image);
  image.decoding = "async";
  const operation = (async () => {
    if (!currentMedia.urls[index]) throw new Error("mascot_sheet_missing");
    image.src = currentMedia.urls[index];
    await image.decode();
    if (disposed || generation !== epoch || index < currentSheet) {
      image.src = ""; images.delete(image); return;
    }
    decoded.set(index, image);
  })().catch(() => {
    if (!disposed && generation === epoch) freeze();
  }).finally(() => { if (generation === epoch) pending.delete(index); });
  pending.set(index, operation);
  return operation;
}
function primeSheets(): Promise<void[]> {
  return Promise.all(Array.from({ length: currentMedia.asset.playback.maxResidentSheets }, (_, offset) => loadSheet(currentSheet + offset)));
}
function paint(frame: number): boolean {
  if (!context || !frameBuffer || !frameContext) return false;
  const { columns, framesPerSheet } = currentMedia.asset.playback;
  const sheetIndex = Math.floor(frame / framesPerSheet);
  const image = decoded.get(sheetIndex);
  if (!image) { void loadSheet(sheetIndex); return false; }
  const cell = frame % framesPerSheet;
  try {
    frameContext.clearRect(0, 0, width, height);
    frameContext.drawImage(image, (cell % columns) * width, Math.floor(cell / columns) * height, width, height, 0, 0, width, height);
    // Replace transparent pixels too, without clearing the last valid displayed pose first.
    context.globalCompositeOperation = "copy";
    context.drawImage(frameBuffer, 0, 0);
  } catch { freeze(); return false; }
  drawnFrame.value = frame;
  if (currentSheet !== sheetIndex) {
    currentSheet = sheetIndex;
    for (const [index, previous] of decoded) {
      if (index < currentSheet) { previous.src = ""; images.delete(previous); decoded.delete(index); }
    }
    void primeSheets();
  }
  return true;
}
async function attempt(): Promise<void> {
  if (!mounted || consumed) return;
  if (props.skipAnimation || preference?.matches || document.hidden || !context || !frameContext) { freeze(); return; }
  if (!props.ready) return;
  consumed = true;
  phase.value = "loading";
  await primeSheets();
  if (disposed || phase.value !== "loading") return;
  if (props.skipAnimation || preference?.matches) { freeze(); return; }
  if (document.hidden) { phase.value = "paused"; return; }
  phase.value = "playing";
  playback?.play();
}
function visibilityChanged(): void {
  if (document.hidden) hoverTrigger?.setEnabled(false);
  if (document.hidden && phase.value === "playing") {
    playback?.pause(); phase.value = "paused";
  } else if (!document.hidden && phase.value === "paused" && !preference?.matches) {
    phase.value = "playing"; playback?.play();
  }
  syncHoverAvailability();
}
function motionChanged(): void {
  if (preference?.matches && phase.value !== "resting") freeze();
  syncHoverAvailability();
}
watch(() => [props.ready, props.skipAnimation], () => { void attempt(); });
onMounted(() => {
  mounted = true;
  context = canvas.value?.getContext("2d") ?? null;
  frameBuffer = document.createElement("canvas");
  frameBuffer.width = width;
  frameBuffer.height = height;
  frameContext = frameBuffer.getContext("2d");
  hoverTrigger = createMascotHoverTrigger({ start: () => { void startHover(); } });
  playback = makePlayback();
  preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", motionChanged);
  document.addEventListener("visibilitychange", visibilityChanged);
  document.addEventListener("pointermove", pointerMoved, { passive: true });
  document.addEventListener("pointerleave", pointerLeft, { passive: true });
  void attempt();
});
onBeforeUnmount(() => {
  disposed = true;
  mounted = false;
  playback?.dispose();
  hoverTrigger?.dispose();
  hitMask = null; lastPointer = null;
  releaseSheets();
  if (frameBuffer) { frameBuffer.width = 0; frameBuffer.height = 0; }
  frameBuffer = null; frameContext = null;
  preference?.removeEventListener("change", motionChanged);
  document.removeEventListener("visibilitychange", visibilityChanged);
  document.removeEventListener("pointermove", pointerMoved);
  document.removeEventListener("pointerleave", pointerLeft);
});
</script>

<template>
  <div class="home-mascot" :class="{ 'home-mascot--unavailable': posterFailed && drawnFrame < 0 }" :data-phase="phase" :data-frame="drawnFrame" :data-clip="activeClip" aria-hidden="true">
    <img class="home-mascot__image" :class="{ 'home-mascot__poster--hidden': drawnFrame >= 0 }" :src="awake" :width="width" :height="height" alt="" draggable="false" @error="posterFailed = true" />
    <canvas ref="canvas" class="home-mascot__image home-mascot__overlay" :class="{ 'home-mascot__canvas--waiting': drawnFrame < 0 }" :width="width" :height="height" />
  </div>
</template>

<style scoped>
.home-mascot {
  position: absolute;
  right: var(--yj-home-mascot-right);
  bottom: calc(100% - var(--yj-home-mascot-overlap));
  width: var(--yj-home-mascot-width);
  pointer-events: none;
  user-select: none;
}
.home-mascot::before {
  content: "";
  position: absolute;
  left: 12%;
  right: 8%;
  bottom: var(--yj-home-mascot-overlap);
  height: var(--yj-home-mascot-contact-height);
  border-radius: 50%;
  background: var(--yj-home-mascot-contact-shadow);
  filter: blur(var(--yj-home-mascot-contact-blur));
}
.home-mascot__image { position: relative; display: block; width: 100%; height: auto; }
.home-mascot__overlay { position: absolute; inset: 0; }
.home-mascot__canvas--waiting, .home-mascot__poster--hidden, .home-mascot--unavailable { visibility: hidden; }
@container home-composer (max-width: 640px) {
  .home-mascot { width: var(--yj-home-mascot-width-compact); right: var(--yj-space-4); }
}
</style>
