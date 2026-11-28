<script setup lang="ts">
import { ref, watch } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import MaterialImage from "../agent/MaterialImage.vue";
import type { CheckImage } from "./manual";

defineProps<{ label: string }>();
const image = defineModel<CheckImage | null>({ required: true });
const picker = ref<HTMLInputElement>();
const problem = ref("");
watch(image, () => { problem.value = ""; }, { flush: "sync" });

function setFile(file?: File) {
  if (!file) return;
  const supported = file.type ? ["image/jpeg", "image/png", "image/webp"].includes(file.type) : /\.(jpe?g|png|webp)$/i.test(file.name);
  if (supported) {
    image.value = { name: file.name || "粘贴的图片", source: file };
    problem.value = "";
  } else problem.value = "请选择 JPG、PNG 或 WebP 图片";
}
function choose(event: Event) {
  const input = event.target as HTMLInputElement;
  setFile(input.files?.[0]);
  input.value = "";
}
function paste(event: ClipboardEvent) {
  const data = event.clipboardData;
  if (!data) return;
  const file = data.files[0] ?? Array.from(data.items).find(item => item.kind === "file")?.getAsFile();
  if (file) { event.preventDefault(); setFile(file); return; }
  const text = data.getData("text/plain").trim();
  if (!text) return;
  event.preventDefault();
  try {
    const url = new URL(text);
    if (url.protocol === "https:" && !url.username && !url.password && /\.(jpe?g|png|webp)$/i.test(url.pathname)) {
      image.value = { name: url.pathname.split("/").pop() || "图片直链", link: url.href };
      return;
    }
  } catch { /* Clipboard text need not be a URL. */ }
  problem.value = "请粘贴截图或以 JPG、PNG、WebP 结尾的 HTTPS 图片直链";
}
function unreadable() {
  image.value = null;
  problem.value = "图片无法显示，请重新选择图片";
}
</script>

<template>
  <div class="material-input" @dragover.prevent @drop.stop.prevent="setFile($event.dataTransfer?.files[0])" @paste="paste">
    <div class="material-label"><strong>{{ label }}</strong><button v-if="image" type="button" @click="image = null">移除</button></div>
    <button type="button" class="material-surface" :aria-label="(image ? '更换' : '添加') + label" @click="picker?.click()">
      <MaterialImage v-if="image && 'source' in image" :source="image.source" :alt="image.name" @error="unreadable" />
      <span v-else-if="image" class="material-placeholder"><YjIcon name="fileImage" /><strong>已附图片直链</strong><small>待复核时读取</small></span>
      <span v-else class="material-placeholder"><YjIcon name="image" size="lg" />选择{{ label }}</span>
      <span class="material-action"><YjIcon :name="image ? 'edit' : 'plus'" size="xs" />{{ image ? '更换图片' : '选择图片' }}</span>
    </button>
    <input ref="picker" type="file" accept="image/jpeg,image/png,image/webp" :aria-label="'选择' + label" hidden @change="choose" />
    <small>可拖入图片，或在图框中粘贴截图、图片直链。</small>
    <p v-if="problem" role="alert">{{ problem }}</p>
  </div>
</template>

<style scoped>
.material-input { display: grid; align-content: start; gap: var(--yj-space-2); min-width: 0; }
.material-label { display: flex; justify-content: space-between; align-items: baseline; gap: var(--yj-space-2); }
.material-label strong { font-size: var(--yj-font-size-context-window); font-weight: var(--yj-font-weight-medium); }
.material-label button { border: 0; background: transparent; padding: 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.material-surface {
  position: relative; display: grid; place-items: center; width: 100%; min-width: 0; aspect-ratio: 1.23;
  border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-connector-artwork); overflow: hidden; color: var(--yj-color-on-brand); padding: var(--yj-space-2);
}
.material-surface:has(.material-placeholder) { background: var(--yj-color-control-hover); border-style: dashed; color: var(--yj-color-text-secondary); }
.material-surface > img { position: absolute; inset: 0; width: 100%; height: 100%; padding: var(--yj-space-2); object-fit: contain; }
.material-action { position: absolute; inset: auto var(--yj-space-2) var(--yj-space-2) auto; display: inline-flex; align-items: center; gap: var(--yj-space-1); background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-sm); padding: 2px var(--yj-space-2); font-size: var(--yj-font-size-caption); }
.material-placeholder { display: grid; justify-items: center; gap: var(--yj-space-1); font-size: var(--yj-font-size-context-window); }
.material-input > small, .material-placeholder small { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.material-input > p { margin: 0; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-caption); }
.material-input button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: 2px; }
@container scene-gallery (max-width: 480px) {
  .material-surface { aspect-ratio: 2.4; }
}
</style>
