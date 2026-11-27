<script setup lang="ts">
import { computed } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import type { VideoScene } from "./scenes";

const props = defineProps<{ scene: VideoScene }>();
const firstResult = computed(() => props.scene.cover.findIndex(frame => frame.kind === "result"));
</script>

<template>
  <span class="video-cover" :class="`video-cover--${scene.id}`" aria-hidden="true">
    <span v-for="(frame, index) in scene.cover" :key="frame.src" class="cover-frame" :data-kind="frame.kind">
      <img :src="frame.src" alt="" decoding="async" draggable="false" />
      <span class="cover-frame__caption">{{ frame.label }}</span>
      <span v-if="index > 0 && index === firstResult" class="cover-frame__arrow"><YjIcon name="arrowRight" size="xs" /></span>
    </span>
  </span>
</template>

<style scoped>
.video-cover {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 2px;
  width: 100%;
  aspect-ratio: 1.83;
  overflow: hidden;
  border-radius: var(--yj-image-gallery-radius);
  background: var(--yj-color-bg-page);
}
.cover-frame { position: relative; display: block; min-width: 0; min-height: 0; background: var(--yj-color-bg-composer-tray); }
.cover-frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cover-frame[data-kind="image"] { background: var(--yj-color-bg-connector-artwork); }
.cover-frame[data-kind="image"] img { object-fit: contain; }
.cover-frame__caption {
  position: absolute;
  bottom: 5px;
  left: 4px;
  padding: 1px 4px;
  border-radius: var(--yj-radius-xs);
  background: color-mix(in srgb, var(--yj-color-on-brand) 84%, transparent);
  color: var(--yj-video-play-ink);
  font-size: 11px;
  font-weight: var(--yj-font-weight-medium);
  line-height: 15px;
  white-space: nowrap;
}
.cover-frame__arrow {
  position: absolute;
  top: 50%;
  left: -1px;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  width: var(--yj-space-5);
  aspect-ratio: 1;
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-bg-card);
  box-shadow: 0 0 0 var(--yj-border-width) color-mix(in srgb, var(--yj-color-on-brand) 12%, transparent);
}
.video-cover--seeding, .video-cover--motion { grid-template-columns: minmax(0, .84fr) minmax(0, 1fr) minmax(0, 1.12fr); }
.video-cover--seeding .cover-frame:last-child img, .video-cover--motion .cover-frame:last-child img { object-position: 50% 8%; }
.video-cover--talking { grid-template-columns: minmax(0, 1.14fr) minmax(0, 1fr); }
.video-cover--talking .cover-frame:first-child img { object-position: 50% 22%; }
.video-cover--replicate { grid-template-columns: minmax(0, .72fr) repeat(2, minmax(0, 1fr)); }
.video-cover--replicate .cover-frame:not([data-kind="image"]) { background: var(--yj-color-on-brand); }
.video-cover--replicate .cover-frame:not([data-kind="image"]) img { object-fit: contain; }
.video-cover--replicate .cover-frame[data-kind="image"] img, .video-cover--motion .cover-frame[data-kind="image"] img { object-fit: cover; }
@container scene-gallery (max-width: 355px) {
  .video-cover { aspect-ratio: 1.42; }
  .video-cover--seeding, .video-cover--motion, .video-cover--replicate { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .cover-frame__caption { left: 2px; bottom: 3px; padding-inline: 3px; }
}
</style>
