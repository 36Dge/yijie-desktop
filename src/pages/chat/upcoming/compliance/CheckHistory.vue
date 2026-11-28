<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import MaterialImage from "../agent/MaterialImage.vue";
import { isReviewed, type CheckRecord } from "./manual";
import type { CheckId } from "./scenes";

const props = defineProps<{ mode: CheckId }>();
const records = defineModel<CheckRecord[]>({ required: true });
const query = ref("");
const status = ref("全部");
const history = ref<HTMLDetailsElement>();
const own = computed(() => records.value.filter(record => record.mode === props.mode));
const visible = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
  return own.value.filter(record => {
    const matchesStatus = status.value === "全部" || (isReviewed(record) ? "已复核" : "待复核") === status.value;
    return matchesStatus && [record.name, record.sku, ...record.fields.map(field => field.value)].some(text => text.toLocaleLowerCase().includes(term));
  });
});

function togglePoint(record: CheckRecord, title: string) {
  const reviewed = record.reviewed.includes(title) ? record.reviewed.filter(item => item !== title) : [...record.reviewed, title];
  records.value = records.value.map(item => item.id === record.id ? { ...item, reviewed } : item);
}
async function reveal(id: number) {
  status.value = "全部"; query.value = "";
  await nextTick();
  if (!history.value) return;
  history.value.open = true;
  const row = history.value.querySelector<HTMLDetailsElement>(`[data-record="${id}"]`);
  if (row) {
    row.open = true;
    const summary = row.querySelector("summary");
    summary?.focus({ preventScroll: true });
    summary?.scrollIntoView({ block: "nearest" });
  }
}
defineExpose({ reveal });
</script>

<template>
  <details ref="history" class="check-history" open>
    <summary class="history-heading"><strong>检测记录</strong><small>{{ own.length }} 条</small><YjIcon name="chevronDown" size="xs" /></summary>
    <div class="history-tools">
      <label class="search-field"><YjIcon name="search" size="xs" /><input v-model="query" type="search" aria-label="搜索检测记录" placeholder="搜索关键词、SKU" /></label>
      <label class="review-filter">复核结果<select v-model="status" aria-label="复核结果"><option>全部</option><option>待复核</option><option>已复核</option></select></label>
    </div>
    <p v-if="!visible.length" class="empty-records" role="status">{{ own.length ? '没有符合筛选条件的记录' : '暂无检测记录' }}</p>
    <details v-for="record in visible" :key="record.id" class="record" :data-record="record.id">
      <summary>
        <MaterialImage v-if="record.material && 'source' in record.material" class="record-thumb" :source="record.material.source" :alt="record.material.name" loading="lazy" />
        <YjIcon v-else name="file" size="sm" /><span class="record-name">{{ record.name }}</span>
        <span class="record-status">{{ isReviewed(record) ? '已复核' : '待复核' }}</span><small>{{ record.time }}</small><YjIcon name="chevronDown" size="xs" />
      </summary>
      <div class="record-body">
        <dl class="record-inputs">
          <div v-for="field in record.fields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div>
        </dl>
        <h4>复核清单 <small>{{ record.reviewed.length }} / {{ record.points.length }}</small></h4>
        <label v-for="point in record.points" :key="point.title" class="review-point">
          <input type="checkbox" :checked="record.reviewed.includes(point.title)" :aria-label="point.title" @change="togglePoint(record, point.title)" />
          <span><strong>{{ point.title }}</strong><small>{{ point.note }}</small></span>
        </label>
      </div>
    </details>
  </details>
</template>

<style scoped>
.check-history { margin-top: var(--yj-space-6); }
.check-history summary { cursor: pointer; display: flex; align-items: center; gap: var(--yj-space-2); min-width: 0; list-style: none; }
.check-history summary::-webkit-details-marker { display: none; }
.check-history summary > :last-child { flex: none; }
.check-history[open] > summary > :last-child, .record[open] > summary > :last-child { transform: rotate(180deg); }
.history-heading { padding-block: var(--yj-space-1); }
.history-heading strong { font-weight: var(--yj-font-weight-semibold); font-size: var(--yj-font-size-card-title); }
.history-heading > svg { margin-inline-start: auto; }
.check-history small, .record-status, .empty-records { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.history-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--yj-space-2); margin: var(--yj-space-2) 0; }
.history-tools label { display: inline-flex; align-items: center; gap: var(--yj-space-1); max-width: 100%; min-height: var(--yj-control-height-sm); padding: 0 var(--yj-space-2); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-sm); background: var(--yj-color-bg-card); }
.review-filter { font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); }
.history-tools input, .history-tools select { min-width: 0; font: inherit; font-size: var(--yj-font-size-caption); border: 0; outline: 0; color: var(--yj-color-text-primary); background: transparent; }
.search-field input { width: 14em; }
.history-tools label:focus-within { border-color: var(--yj-color-focus-ring); }
.empty-records { padding-block: var(--yj-space-3); margin: 0; }
.record { margin-top: var(--yj-space-2); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-md); background: var(--yj-color-bg-card); }
.record > summary { padding: var(--yj-space-3); font-size: var(--yj-font-size-context-window); }
.record-thumb { flex: none; width: var(--yj-space-8); height: var(--yj-space-8); object-fit: contain; border-radius: var(--yj-radius-xs); background: var(--yj-color-bg-connector-artwork); }
.record-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--yj-font-weight-medium); }
.record-status { margin-inline-start: auto; white-space: nowrap; }
.record-body { display: grid; gap: var(--yj-space-2); padding: 0 var(--yj-space-3) var(--yj-space-3); }
.record-inputs { margin: 0; padding: var(--yj-space-3); background: var(--yj-color-control-hover); border-radius: var(--yj-radius-sm); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.record-inputs > div { display: grid; grid-template-columns: minmax(0, 7em) minmax(0, 1fr); gap: var(--yj-space-2); }
.record-inputs > div + div { margin-top: var(--yj-space-1); }
.record-inputs dt { color: var(--yj-color-text-secondary); }
.record-inputs dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; max-height: 12em; overflow: auto; }
.record-body h4 { margin: var(--yj-space-1) 0 0; font-size: var(--yj-font-size-context-window); }
.record-body h4 small { margin-inline-start: var(--yj-space-1); font-weight: var(--yj-font-weight-regular); }
.review-point { display: flex; align-items: start; gap: var(--yj-space-2); cursor: pointer; }
.review-point > span { display: grid; gap: 2px; }
.review-point strong { font-size: var(--yj-font-size-context-window); font-weight: var(--yj-font-weight-medium); }
.review-point small { line-height: var(--yj-line-height-caption); }
.review-point input { margin: 2px 0 0; accent-color: var(--yj-color-text-primary); }
.check-history :is(summary, input[type="checkbox"]):focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: 2px; }
</style>
