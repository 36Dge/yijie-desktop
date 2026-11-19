<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { sourceHref } from "../../composables/useWebSources";
import { readWebRetrievalResult, type DeepSearchPreview } from "../../domain/web-retrieval-display";
const props = defineProps<{ tool?: string; text?: string; preview?: DeepSearchPreview }>();
const emit = defineEmits<{ "open-source": [url: string] }>();
const result = computed(() => readWebRetrievalResult(props.tool ?? "", props.text ?? ""));
const showAll = ref(false);
const sourceListId = useId();
const previewLimit = 3;
const previewRows = computed(() => props.preview && "results" in props.preview ? props.preview.results : []);
function sourceSite(url: string) {
  try { return new URL(url).hostname; } catch { return ""; }
}
const labels = { available: "正文可用", unavailable: "未取得正文", truncated: "正文已截断" } as const;
</script>
<template>
  <div class="web-result yj-selectable-text" aria-label="网页检索材料">
    <p v-if="preview && 'error' in preview" role="status">{{ preview.error.message }}</p>
    <template v-else-if="preview && 'results' in preview">
      <p v-if="preview.truncated" role="note">部分搜索结果未完整展示。</p>
      <p v-else-if="!previewRows.length" role="status">未找到相关网页。</p>
      <ol v-if="previewRows.length" :id="sourceListId" class="web-result__rows" aria-label="搜索结果">
        <li v-for="(row, index) in (showAll ? previewRows : previewRows.slice(0, previewLimit))" :key="`${index}:${row.url}`">
          <strong v-if="row.title" class="web-result__title">{{ row.title }}</strong>
          <a v-if="sourceHref(row.url)" class="web-result__link" :href="row.url" target="_blank" rel="noopener noreferrer"
            @click.prevent="emit('open-source', row.url)" @auxclick.middle.prevent="emit('open-source', row.url)">{{ sourceSite(row.url) }}</a>
          <span v-else>{{ sourceSite(row.url) }}</span>
          <p v-if="row.snippet" class="web-result__snippet">{{ row.snippet }}</p>
        </li>
      </ol>
      <button v-if="previewRows.length > previewLimit" type="button" class="web-result__more"
        :aria-controls="sourceListId" :aria-expanded="showAll" @click="showAll = !showAll">
        {{ showAll ? "收起更多结果" : `查看另外 ${previewRows.length - previewLimit} 条` }}
      </button>
    </template>
    <pre v-else-if="!result">{{ text }}</pre>
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
.web-result__rows { display: grid; gap: var(--yj-space-3); list-style: none; padding: 0; margin: 0; }
.web-result__rows li { display: grid; min-width: 0; }
.web-result__title { overflow-wrap: anywhere; }
.web-result__link { justify-self: start; max-width: 100%; overflow-wrap: anywhere; color: var(--yj-color-chat-link); text-decoration: none; }
.web-result__link:hover, .web-result__link:focus-visible { text-decoration: underline; text-underline-offset: var(--yj-space-1); }
.web-result__rows .web-result__snippet { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.web-result__more { justify-self: start; padding: var(--yj-space-1) 0; font: inherit; color: var(--yj-color-text-secondary); background: transparent; border: 0; cursor: pointer; }
.web-result__link:focus-visible, .web-result__more:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
</style>
