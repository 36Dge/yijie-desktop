<script setup lang="ts" generic="T extends DraftFields">
import { languagesByMarket, type DraftFields } from "./config";
const draft = defineModel<T>({ required: true });
</script>
<template>
  <div class="target-settings">
    <h4>投放信息</h4>
    <div class="config-targets">
      <label>目标平台<select v-model="draft.platform" aria-label="目标平台"><option v-for="v in ['亚马逊','TikTok','Instagram','YouTube Shorts']" :key="v">{{ v }}</option></select></label>
      <label>目标站点<select v-model="draft.market" aria-label="目标站点" @change="draft.language = languagesByMarket[draft.market]!"><option v-for="(_, v) in languagesByMarket" :key="v">{{ v }}</option></select></label>
      <label>语言<select v-model="draft.language" aria-label="语言"><option v-for="v in ['英语','中文','日语','德语']" :key="v">{{ v }}</option></select></label>
    </div>
  </div>
</template>
<style scoped>
.target-settings { padding: 10px; border-top: 1px solid var(--agent-line); }
.target-settings h4 { margin: 0 0 8px; font-size: 13px; }
.config-targets { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
.config-targets label { display: grid; gap: 4px; min-width: 0; font-size: 11px; color: var(--yj-color-text-secondary); }
.config-targets select { width: 100%; }
</style>
