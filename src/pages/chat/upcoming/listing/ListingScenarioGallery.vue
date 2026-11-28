<script setup lang="ts">
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import ScenarioWorkbench from "../agent/ScenarioWorkbench.vue";
import ListingReportEntry from "./ListingReportEntry.vue";
import { hasListingReport, listingScenes } from "./scenes";
</script>

<template>
  <ScenarioWorkbench class="listing-scenes" kind-label="平台" aria-label="Listing 优化平台示例" :scenes="listingScenes"
    :is-available="hasListingReport" :describe="scene => scene.detail + (hasListingReport(scene) ? '，查看优化报告' : '，报告待开放')">
    <template #cover="{ scene }">
      <span class="listing-cover" :class="'listing-cover--' + scene.id" aria-hidden="true">
        <span v-for="photo in scene.photos" :key="photo.src" class="listing-panel" :class="{ cutout: photo.contain }">
          <img :src="photo.src" alt="" decoding="async" draggable="false" /><span>{{ photo.label }}</span>
        </span>
      </span>
    </template>
    <template #indicator="{ scene }">
      <YjIcon v-if="hasListingReport(scene)" name="arrowRight" size="xs" tone="muted" />
      <small v-else class="pending-report">待开放</small>
    </template>
    <template #detail="{ scene }"><ListingReportEntry v-if="hasListingReport(scene)" :key="scene.id" :scene="scene" /></template>
  </ScenarioWorkbench>
</template>

<style scoped>
.listing-cover { display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1.14fr) minmax(0, 1fr); gap: 2px; width: 100%; aspect-ratio: 1.83; overflow: hidden; border-radius: var(--yj-image-gallery-radius); background: var(--yj-color-bg-page); }
.listing-panel { display: grid; position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.listing-panel img { width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: cover; }
.listing-panel.cutout { background: var(--yj-color-bg-connector-artwork); }
.listing-panel.cutout img { object-fit: contain; padding: var(--yj-space-1); }
.listing-panel > span { position: absolute; bottom: 5px; left: 5px; padding: 1px 5px; border-radius: var(--yj-radius-xs); color: var(--yj-video-play-ink); background: var(--yj-video-play-bg); font-size: 11px; line-height: 15px; white-space: nowrap; }
.listing-panel:last-child > span { left: auto; right: 5px; }
.pending-report { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-regular); }
@container scene-gallery (max-width: 355px) { .listing-cover { aspect-ratio: 1.42; } .pending-report { font-size: 11px; } }
</style>
