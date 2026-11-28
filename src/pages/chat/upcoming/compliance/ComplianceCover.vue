<script setup lang="ts">
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import type { ComplianceScene } from "./scenes";
defineProps<{ scene: ComplianceScene }>();
</script>

<template>
  <span class="check-cover" :class="'check-cover--' + scene.id" aria-hidden="true">
    <span class="art input-art">
      <img :src="scene.photo" alt="" decoding="async" draggable="false" />
      <span class="art-label">{{ scene.coverLabels[0] }}</span>
    </span>
    <span class="art detail-art">
      <img v-if="scene.focusPhoto" :src="scene.focusPhoto" alt="" decoding="async" draggable="false" />
      <span v-else-if="scene.id === 'invention'" class="tech-features">
        <img :src="scene.controlPhoto" alt="" decoding="async" draggable="false" />
        <span><YjIcon name="settings" size="xs" />即热供水</span>
        <span><YjIcon name="skillProductAttributes" size="xs" />喷杆自洁</span>
      </span>
      <span v-else-if="scene.id === 'word'" class="word-excerpt"><mark>BabyBjörn</mark><span>Potty Chair</span></span>
      <span v-else class="policy-excerpt">
        <strong>Amazon · US</strong><span><YjIcon name="listView" size="xs" />包装标签</span><span><YjIcon name="file" size="xs" />净含量</span>
      </span>
      <span class="art-label">{{ scene.coverLabels[1] }}</span>
    </span>
    <span class="art-arrow"><YjIcon name="arrowRight" size="xs" /></span>
  </span>
</template>

<style scoped>
.check-cover {
  --split: 52%;
  display: grid;
  position: relative;
  width: 100%;
  aspect-ratio: 1.83;
  grid-template: minmax(0, 1fr) / minmax(0, var(--split)) minmax(0, 1fr);
  gap: 2px;
  overflow: hidden;
  border-radius: var(--yj-image-gallery-radius);
  background: var(--yj-color-bg-page);
}
.art { display: grid; position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.input-art { background: var(--yj-selection-art-paper); }
.detail-art { place-items: center; background: var(--yj-selection-art-sage); color: var(--yj-color-on-brand); }
.art > img { display: block; width: 100%; height: 100%; min-height: 0; min-width: 0; }
.input-art > img { object-fit: contain; padding: var(--yj-space-2); mix-blend-mode: multiply; }
.detail-art > img { object-fit: cover; }
.check-cover--invention { --split: 54%; }
.check-cover--invention .input-art { background: var(--yj-color-bg-connector-artwork); }
.tech-features img { display: block; width: 100%; max-width: var(--yj-space-16); height: auto; border-radius: var(--yj-radius-xs); mix-blend-mode: multiply; }
.tech-features, .policy-excerpt, .word-excerpt { display: grid; align-content: center; gap: var(--yj-space-1); padding: 0 var(--yj-space-1) var(--yj-space-2); }
.tech-features > span, .policy-excerpt > span { display: flex; align-items: center; gap: var(--yj-space-1); white-space: nowrap; font-size: var(--yj-font-size-caption); }
.detail-art :deep(svg) { color: inherit; }
.word-excerpt { font-size: var(--yj-font-size-caption); line-height: 1.45; }
.word-excerpt mark { color: inherit; background: transparent; box-shadow: inset 0 -.34em color-mix(in srgb, var(--yj-color-brand-primary) 70%, transparent); font-size: var(--yj-font-size-card-title); font-weight: var(--yj-font-weight-semibold); }
.policy-excerpt strong { font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-semibold); }
.check-cover--graphic .input-art, .check-cover--policy .input-art { background: var(--yj-image-aplus-backdrop); }
.check-cover--graphic .detail-art > img { width: 68%; height: auto; max-height: 74%; object-fit: contain; border-radius: var(--yj-radius-md); }
.check-cover--graphic .detail-art { background: var(--yj-image-aplus-backdrop); }
.check-cover--copyright .input-art > img { object-fit: cover; object-position: center 43%; padding: 0; mix-blend-mode: normal; }
.art-label {
  position: absolute; bottom: 5px; left: 5px; padding: 1px 5px; border-radius: var(--yj-radius-xs);
  color: var(--yj-video-play-ink); background: color-mix(in srgb, var(--yj-color-on-brand) 84%, transparent);
  font-size: 11px; line-height: 15px; white-space: nowrap;
}
.detail-art .art-label { left: auto; right: 5px; }
.art-arrow {
  display: grid; position: absolute; place-items: center; top: 50%; left: calc(var(--split) + 1px); transform: translate(-50%, -50%);
  width: var(--yj-space-5); aspect-ratio: 1; border-radius: var(--yj-radius-full); background: var(--yj-color-bg-card);
  box-shadow: 0 0 0 var(--yj-border-width) color-mix(in srgb, var(--yj-color-on-brand) 12%, transparent);
}
@container scene-gallery (max-width: 355px) {
  .check-cover { aspect-ratio: 1.42; --split: 49%; }
  .tech-features > span, .policy-excerpt { font-size: 11px; }
  .word-excerpt mark { font-size: var(--yj-font-size-context-window); }
  .tech-features :deep(svg), .policy-excerpt :deep(svg) { display: none; }
}
</style>
