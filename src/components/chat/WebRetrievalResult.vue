<script setup lang="ts">
import { computed } from "vue";
import { readWebRetrievalResult } from "../../domain/web-retrieval-display";
const props = defineProps<{ tool: string; text: string }>();
const result = computed(() => readWebRetrievalResult(props.tool, props.text));
const labels = { available: "正文可用", unavailable: "未取得正文", truncated: "正文已截断" } as const;
</script>
<template>
  <div class="web-result" aria-label="网页检索材料">
    <pre v-if="!result">{{ text }}</pre>
    <p v-else-if="'error' in result" role="status">{{ result.error.message }}</p>
    <template v-else-if="'results' in result">
      <p v-if="result.results.length === 0" role="status">未找到相关网页。</p>
      <p v-if="'dropped_results' in result && result.dropped_results > 0" role="status">{{ result.dropped_results }} 条结果未交付；以下仅展示可用来源。</p>
      <p v-if="result.truncated" role="status">检索材料不完整，部分内容或来源未交付。</p>
      <details v-for="(row, index) in result.results" :key="`${index}:${row.url}`">
        <summary>{{ row.title || row.url }}<span v-if="'content_status' in row"> · {{ labels[row.content_status] }}</span></summary>
        <p class="web-result__source">来源：{{ row.url }}</p>
        <p>{{ row.snippet }}</p>
        <template v-if="'chunks' in row">
          <p v-if="row.site_name || row.date">{{ row.site_name }} {{ row.date }}</p>
          <pre v-for="(chunk, chunkIndex) in row.chunks" :key="chunkIndex">{{ chunk.text }}</pre>
        </template>
        <pre v-else-if="'text' in row">{{ row.text }}</pre>
        <p v-if="'content_status' in row && row.content_status === 'available'" class="web-result__note">这是本次提取的材料，不保证包含完整网页。</p>
      </details>
    </template>
    <template v-else>
      <p>{{ result.title || result.url }}</p>
      <p class="web-result__source">来源：{{ result.url }}</p>
      <p v-if="result.truncated" role="status">正文已截断。</p>
      <pre>{{ result.markdown }}</pre>
    </template>
  </div>
</template>
<style scoped>
.web-result { display:grid; gap:var(--yj-space-2); min-width:0; }
details { border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-md); padding:var(--yj-space-3); min-width:0; }
summary { cursor:pointer; overflow-wrap:anywhere; }
summary:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
p,pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
details > p,details > pre { margin-top:var(--yj-space-2); }
pre { max-height:var(--yj-layout-chat-entry-max); overflow:auto; font-size:var(--yj-font-size-caption); }
.web-result__source,.web-result__note { color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-caption); }
</style>
