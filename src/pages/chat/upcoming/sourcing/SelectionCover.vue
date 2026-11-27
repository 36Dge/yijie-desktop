<script setup lang="ts">
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import { products, type SelectionScene } from "./examples";

defineProps<{ scene: SelectionScene }>();
</script>

<template>
  <span class="selection-cover" :class="`selection-cover--${scene.id}`" aria-hidden="true">
    <span v-for="panel in scene.cover" :key="panel.label" class="cover-panel">
      <span v-if="'photos' in panel" class="cover-photos" :data-count="panel.photos.length" :class="{ closeup: panel.closeup }">
        <span v-for="id in panel.photos" :key="id" class="cover-photo">
          <img :src="panel.closeup ? (products[id].detailImage ?? products[id].image) : products[id].image"
            alt="" decoding="async" draggable="false" />
        </span>
      </span>
      <span v-else class="cover-notes">
        <span v-for="note in panel.notes" :key="note.text"><YjIcon :name="note.icon" size="xs" />{{ note.text }}</span>
      </span>
      <span class="cover-label">{{ panel.label }}</span>
    </span>
    <span v-if="scene.cover.length > 1" class="cover-arrow"><YjIcon name="arrowRight" size="xs" /></span>
  </span>
</template>

<style scoped>
.selection-cover {
  --split: 51%;
  display: grid;
  position: relative;
  grid-template: minmax(0, 1fr) / minmax(0, var(--split)) minmax(0, 1fr);
  gap: 2px;
  width: 100%;
  aspect-ratio: 1.83;
  overflow: hidden;
  border-radius: var(--yj-image-gallery-radius);
}
.cover-panel { display: grid; position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--yj-selection-art-paper); }
.cover-panel:nth-child(2) { background: var(--yj-selection-art-sage); }
.cover-photos, .cover-photo { display: grid; min-width: 0; min-height: 0; overflow: hidden; }
.cover-photos { grid-template: minmax(0, 1fr) / minmax(0, 1fr); }
.cover-photos[data-count="3"] { grid-template: repeat(2, minmax(0, 1fr)) / minmax(0, 1.4fr) minmax(0, 1fr); }
.cover-photos[data-count="3"] .cover-photo:first-child { grid-row: span 2; }
.cover-photos[data-count="6"] { grid-template: repeat(2, minmax(0, 1fr)) / repeat(3, minmax(0, 1fr)); gap: 2px; background: var(--yj-color-bg-page); }
.cover-photos[data-count="6"] .cover-photo { background: var(--yj-selection-art-paper); }
.cover-photos[data-count="6"] .cover-photo:nth-child(even) { background: var(--yj-selection-art-sage); }
.cover-photo img {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: var(--yj-space-2);
  object-fit: contain;
  mix-blend-mode: multiply;
}
.closeup .cover-photo img,
.selection-cover--full .cover-photo:first-child img,
.selection-cover--boutique .cover-panel:first-child img { padding: 0; object-fit: cover; mix-blend-mode: normal; }
.selection-cover--full { --split: 56%; }
.selection-cover--bulk { grid-template-columns: minmax(0, 1fr); }
.selection-cover--curated { --split: 55%; }
.selection-cover--boutique { --split: 43%; }
.selection-cover--boutique .cover-panel:first-child img { object-position: center 25%; }
.selection-cover--develop { --split: 56%; }
.cover-notes { align-self: center; display: grid; gap: var(--yj-space-2); padding: 0 var(--yj-space-2) var(--yj-space-3) var(--yj-space-3); }
.cover-notes > span { display: flex; align-items: center; gap: var(--yj-space-1); color: var(--yj-color-on-brand); font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-medium); white-space: nowrap; }
.cover-notes :deep(svg) { color: inherit; }
.cover-label {
  position: absolute;
  bottom: 5px;
  left: 5px;
  padding: 1px 5px;
  border-radius: var(--yj-radius-xs);
  background: color-mix(in srgb, var(--yj-color-on-brand) 84%, transparent);
  color: var(--yj-video-play-ink);
  font-size: 11px;
  line-height: 15px;
  white-space: nowrap;
}
.cover-panel:nth-child(2) .cover-label { left: auto; right: 5px; }
.cover-arrow { position: absolute; top: 50%; left: calc(var(--split) + 1px); transform: translate(-50%, -50%); display: grid; place-items: center; width: var(--yj-space-5); aspect-ratio: 1; border-radius: 50%; background: var(--yj-color-bg-card); box-shadow: 0 0 0 1px color-mix(in srgb,var(--yj-color-on-brand) 12%,transparent); }
@container scene-gallery (max-width: 355px) {
  .selection-cover { aspect-ratio: 1.42; }
  .selection-cover--full, .selection-cover--develop { --split: 51%; }
  .cover-notes { padding-inline: var(--yj-space-2); }
  .cover-notes > span { font-size: 11px; }
  .cover-notes :deep(svg) { display: none; }
  .cover-photo img { padding: var(--yj-space-1); }
}
</style>
