<script setup lang="ts">
import { ref } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import type { SceneImage } from "./scenes";
defineProps<{ image: SceneImage; wide?: boolean }>();
const emit = defineEmits<{ open: [trigger: HTMLButtonElement] }>();
const phase = ref<"loading" | "ready" | "error">("loading");
const attempt = ref(0);
function activate(event: MouseEvent) {
  if (phase.value !== "error") { emit("open", event.currentTarget as HTMLButtonElement); return; }
  phase.value = "loading";
  attempt.value++;
}
</script>

<template>
  <button class="scene-asset" :class="{ 'scene-asset--wide': wide }" type="button"
    :aria-label="phase === 'error' ? '重新加载' + image.title : '放大查看' + image.title" @click="activate">
    <img :key="attempt" :src="image.src" :alt="image.alt" draggable="false" decoding="async"
      @load="phase = 'ready'" @error="phase = 'error'" />
    <span v-if="phase !== 'ready'" class="scene-asset__status">{{ phase === 'error' ? '图片加载失败，点击重试' : '正在载入图片…' }}</span>
    <span v-else class="scene-asset__zoom" aria-hidden="true"><YjIcon name="enterFullscreen" size="xs" /></span>
  </button>
</template>

<style scoped>
.scene-asset {
  position: relative; display: block; width: 100%; aspect-ratio: 4 / 3; overflow: hidden;
  border: 0; border-radius: var(--yj-image-gallery-radius); padding: 0;
  background: var(--yj-color-bg-composer-tray); color: var(--yj-color-text-secondary); cursor: zoom-in;
}
.scene-asset--wide { aspect-ratio: 1464 / 600; }
.scene-asset img { display: block; width: 100%; height: 100%; object-fit: contain; }
.scene-asset__zoom {
  position: absolute; right: var(--yj-space-2); bottom: var(--yj-space-2);
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--yj-radius-sm);
  border: var(--yj-border-width) solid var(--yj-color-border-default); background: var(--yj-color-bg-elevated);
}
.scene-asset__status { position: absolute; inset: 0; display: grid; place-items: center; background: var(--yj-color-control-hover); font-size: var(--yj-font-size-caption); }
</style>
