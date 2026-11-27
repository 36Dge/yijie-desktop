<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import type { VideoExample } from "./scenes";

defineProps<{ clip: VideoExample }>();
const player = ref<HTMLVideoElement>();
const failed = ref(false);
function retry() {
  failed.value = false;
  player.value?.load();
}
function pausePlayback() {
  if (player.value && !player.value.paused) player.value.pause();
}
function resetPlayback() {
  const element = player.value;
  if (element && (!element.paused || element.currentTime > 0)) element.load();
}
defineExpose({ pausePlayback, resetPlayback });
onBeforeUnmount(() => {
  const element = player.value;
  if (!element) return;
  element.pause();
  element.removeAttribute("src");
  element.load();
});
</script>

<template>
  <div class="sample-player">
    <video ref="player" :src="clip.src" :poster="clip.poster" :aria-label="clip.label"
      controls playsinline preload="metadata" @error="failed = true" @loadedmetadata="failed = false" />
    <div v-if="failed" class="sample-player__error" role="status">
      <span>视频加载失败</span><button type="button" @click="retry">重新加载</button>
    </div>
  </div>
</template>

<style scoped>
.sample-player { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; background: var(--yj-color-on-brand); }
.sample-player video { display: block; width: 100%; height: 100%; object-fit: contain; }
.sample-player__error { position: absolute; inset: 0; display: grid; align-content: center; justify-items: center; gap: var(--yj-space-2); color: var(--yj-color-text-secondary); background: var(--yj-color-bg-card); }
.sample-player__error button { border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-sm); background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); }
</style>
