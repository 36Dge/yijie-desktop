<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import type { ListingScene, ReportPlatform } from "./scenes";

defineProps<{ scene: ListingScene & { id: ReportPlatform } }>();
const view = shallowRef<typeof import("./ListingReport.vue")["default"]>();
const failed = ref(false);

async function load() {
  failed.value = false;
  try { view.value = (await import("./ListingReport.vue")).default; }
  catch { failed.value = true; }
}
onMounted(load);
</script>

<template>
  <component :is="view" v-if="view" :scene="scene" />
  <div v-else class="report-load" role="status">
    <template v-if="failed">暂时无法打开这份报告。<button type="button" @click="load">重试</button></template>
    <template v-else>正在打开报告…</template>
  </div>
</template>

<style scoped>
.report-load { display: flex; align-items: center; gap: var(--yj-space-2); min-height: var(--yj-space-12); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-context-window); }
.report-load button { border: 0; border-radius: var(--yj-radius-sm); background: var(--yj-color-control-hover); color: var(--yj-color-text-primary); padding: var(--yj-space-1) var(--yj-space-2); }
</style>
