<script setup lang="ts">
import { computed } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import type { ImageScene } from "./scenes";

const props = defineProps<{ scene: ImageScene }>();
const coverImages = computed(() => props.scene.id === "aplus"
  ? props.scene.result.images
  : [props.scene.input.images[0], props.scene.result.images[0]]);
</script>

<template>
  <span class="scene-cover" :class="[`scene-cover--${scene.id}`, { 'scene-cover--comparison': scene.comparison }]" aria-hidden="true">
    <template v-if="scene.comparison">
      <span class="cover-input">
        <img class="cover-photo" :src="scene.comparison.source.thumbnail" alt="" decoding="async" draggable="false" />
        <span v-if="scene.comparison.product" class="cover-product">
          <img :src="scene.comparison.product.thumbnail" alt="" decoding="async" draggable="false" />
          <span>+</span>
        </span>
        <span class="cover-tag">{{ scene.comparison.before }}</span>
      </span>
      <span class="cover-output">
        <img v-for="image in scene.result.images" :key="image.src" class="cover-photo" :src="image.thumbnail" alt="" decoding="async" draggable="false" />
        <span class="cover-tag">{{ scene.comparison.after }}</span>
      </span>
      <span class="cover-arrow"><YjIcon name="arrowRight" size="xs" /></span>
    </template>
    <template v-else>
      <img v-for="image in coverImages" :key="image.src" :src="image.thumbnail" alt="" decoding="async" draggable="false" />
    </template>
  </span>
</template>

<style scoped>
.scene-cover {
  display: grid;
  position: relative;
  width: 100%;
  aspect-ratio: 1.83;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  overflow: hidden;
  border-radius: var(--yj-image-gallery-radius);
  background: var(--yj-color-control-hover);
}
.scene-cover img {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  object-fit: cover;
}
.scene-cover--comparison {
  --split: 50%;
  grid-template-columns: minmax(0, var(--split)) minmax(0, 1fr);
  gap: 2px;
  background: var(--yj-color-bg-page);
}
.cover-input, .cover-output {
  display: grid;
  position: relative;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.cover-tag {
  position: absolute;
  inset: auto auto 5px 5px;
  padding: 1px 5px;
  border-radius: var(--yj-radius-xs);
  background: color-mix(in srgb, var(--yj-color-on-brand) 84%, transparent);
  color: var(--yj-video-play-ink);
  font-size: 11px;
  font-weight: var(--yj-font-weight-medium);
  line-height: 15px;
  white-space: nowrap;
}
.cover-output > .cover-tag { inset-inline: auto 5px; }
.cover-arrow {
  position: absolute;
  top: 50%;
  left: calc(var(--split) + 1px);
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  width: var(--yj-space-5);
  aspect-ratio: 1;
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-bg-card);
  box-shadow: 0 0 0 var(--yj-border-width) color-mix(in srgb, var(--yj-color-on-brand) 12%, transparent);
}
.scene-cover--suite { --split: 34%; }
.scene-cover--suite .cover-input { background: var(--yj-color-bg-connector-artwork); }
.scene-cover--suite .cover-input > img { object-fit: contain; padding: var(--yj-space-1) var(--yj-space-1) var(--yj-space-3); }
.scene-cover--suite .cover-output { grid-template: auto minmax(0, 1fr) / repeat(2, minmax(0, 1fr)); gap: 2px; }
.scene-cover--suite .cover-output > img:first-child { grid-column: 1 / -1; height: auto; aspect-ratio: 1962 / 802; object-fit: contain; }
.scene-cover--suite .cover-output > img:nth-child(2) { object-fit: contain; background: var(--yj-color-bg-connector-artwork); }
.scene-cover--suite .cover-output > img:nth-child(3) { object-position: 60% 60%; }
.scene-cover--suite .cover-tag { inset-inline: 5px auto; }
.scene-cover--scene .cover-photo { object-position: 50% 4%; }
.scene-cover--replace .cover-photo { transform: scale(1.42); transform-origin: 50% 54%; }
.cover-product {
  position: absolute;
  top: 5px;
  left: 5px;
  width: clamp(28px, 34%, 42px);
  aspect-ratio: 1;
  border: 2px solid var(--yj-color-bg-connector-artwork);
  border-radius: var(--yj-radius-sm);
  background: var(--yj-color-bg-connector-artwork);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--yj-color-on-brand) 22%, transparent);
}
.cover-product img { border-radius: var(--yj-radius-xs); object-fit: contain; }
.cover-product > span {
  position: absolute;
  right: -4px;
  bottom: -3px;
  display: grid;
  place-items: center;
  width: 13px;
  height: 13px;
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-bg-connector-artwork);
  color: var(--yj-color-on-brand);
  font-size: 11px;
  line-height: 1;
}
.scene-cover--model, .scene-cover--white { gap: 2px; background: var(--yj-color-bg-page); }
.scene-cover--model { grid-template-columns: 35% minmax(0, 1fr); }
.scene-cover--model img:first-child { object-position: 50% 48%; }
.scene-cover--model img:last-child { object-position: 50% 4%; }
.scene-cover--white { grid-template-columns: 37% minmax(0, 1fr); }
.scene-cover--white img:first-child { object-position: 50% 35%; }
.scene-cover--white img:last-child { object-fit: contain; background: var(--yj-color-bg-connector-artwork); }
.scene-cover--aplus {
  grid-template-rows: repeat(2, minmax(0, 1fr));
  justify-items: center;
  gap: 2px;
  padding-block: 5px;
  background: var(--yj-image-aplus-backdrop);
}
.scene-cover--aplus img { width: auto; max-width: 100%; object-fit: contain; }
@container scene-gallery (max-width: 355px) {
  .scene-cover { aspect-ratio: 1.42; }
  .scene-cover--replace .cover-photo { transform: scale(1.7); transform-origin: 50% 55%; }
}
</style>
