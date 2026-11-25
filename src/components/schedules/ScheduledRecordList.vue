<script setup lang="ts">
import { computed } from "vue";
import { NButton } from "naive-ui";
import type { RecordRow, RecordView } from "../../api/generated/scheduled-task-ipc-v2.gen";
import { durationLabel, executionTimeLabel, recordElementId, recordStatus, recordTone } from "../../domain/scheduled-task-ui";
import YjIcon from "../yijie/YjIcon.vue";
import ScheduledCardAction from "./ScheduledCardAction.vue";

const props = defineProps<{ rows: RecordRow[]; rerunDisabled: boolean }>();
const emit = defineEmits<{ open: [row: RecordRow]; rerun: [row: RecordRow]; conversation: [row: RecordRow] }>();

function openRow(event: MouseEvent, row: RecordRow) {
  if (event.target instanceof Element && event.target.closest("button, a, [data-record-actions]")) return;
  emit("open", row);
}
function statusLabel(record: RecordView) {
  if (record.kind === "run" && record.attention === "needs_attention") return "需关注";
  const label = recordStatus(record);
  return label === "执行已结束" ? "已结束" : label;
}
function triggerLabel(record: RecordView) {
  return record.kind === "run" ? { manual: "手动触发", automatic: "定时触发", rerun: "重新执行" }[record.run.trigger] : "定时触发";
}
function recordTime(record: RecordView) {
  const label = executionTimeLabel(record.timing, true);
  if (record.timing.execution_time === "not_started") return { date: "", clock: "本次未执行" };
  if (label === "未知") return { date: "", clock: "执行时间未知" };
  const separator = label.indexOf(" ");
  return { date: label.slice(0, separator), clock: label.slice(separator + 1) };
}
const entries = computed(() => props.rows.map(row => ({ row, time: recordTime(row.record) })));

function rerunUnavailable(row: RecordRow) {
  return row.record.kind !== "run" || row.record.plan.raw_state === "deleted" || row.record.plan.target_state === "missing";
}
function rerunHint(row: RecordRow) {
  if (row.record.plan.raw_state === "deleted") return "原任务已删除，不能重新执行";
  if (row.record.plan.target_state === "missing") return "当前运行目标不可用";
  return "重新执行";
}
function conversationAvailable(row: RecordRow) {
  return row.record.kind === "run" && row.record.conversation.status === "available";
}
</script>

<template>
  <div class="scheduled-records">
    <table class="scheduled-records__table" role="table" aria-label="执行记录">
      <colgroup>
        <col class="scheduled-records__time-col"><col><col class="scheduled-records__status-col"><col class="scheduled-records__duration-col"><col class="scheduled-records__actions-col">
      </colgroup>
      <thead>
        <tr><th scope="col">执行时间</th><th scope="col">任务名称</th><th scope="col">执行状态</th><th scope="col">耗时</th><th scope="col">操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="{ row, time } in entries" :key="recordElementId(row.record)" class="scheduled-records__row" :data-tone="recordTone(row.record)" @click="openRow($event, row)">
          <td class="scheduled-records__when">
            <div v-if="time.date" class="scheduled-records__stamp">
              <span class="scheduled-records__clock">{{ time.clock }}</span>
              <span class="scheduled-records__date">{{ time.date }}</span>
            </div>
            <span v-else class="scheduled-records__no-time">{{ time.clock }}</span>
          </td>
          <th scope="row" class="scheduled-records__task">
            <button :id="recordElementId(row.record)" type="button" class="scheduled-records__title"
              :aria-label="`查看 ${row.name} 的执行记录详情`" @click.stop="emit('open', row)">{{ row.name }}</button>
            <span class="scheduled-records__trigger">{{ triggerLabel(row.record) }}</span>
            <span v-if="row.record.kind === 'run' && row.record.attention === 'needs_attention'" class="scheduled-records__note">审批或执行结果待核对</span>
          </th>
          <td class="scheduled-records__state">
            <span class="scheduled-records__status">{{ statusLabel(row.record) }}</span>
          </td>
          <td class="scheduled-records__elapsed">
            <span v-if="row.record.timing.duration !== 'not_started'" class="scheduled-records__duration">
              <span class="scheduled-records__duration-prefix" aria-hidden="true">耗时 </span>{{ durationLabel(row.record.timing, true) }}
            </span>
            <span v-else class="scheduled-records__dash" aria-hidden="true">—</span>
          </td>
          <td class="scheduled-records__end">
            <div class="scheduled-records__actions" data-record-actions @click.stop>
              <ScheduledCardAction v-if="row.record.kind === 'run'" :id="`schedule-rerun-${row.record.run.run_id}`" icon="rerun" :label="rerunHint(row)"
                :disabled="rerunDisabled || rerunUnavailable(row)" @click="emit('rerun', row)" />
              <NButton v-if="conversationAvailable(row)" class="scheduled-records__conversation" quaternary size="small" @click="emit('conversation', row)">
                查看对话<YjIcon name="arrowUpRight" size="xs" />
              </NButton>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.scheduled-records { container-type: inline-size; min-width: 0; overflow: hidden; border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-xl); background: var(--yj-color-bg-card); }
.scheduled-records__table { width: 100%; border-spacing: 0; table-layout: fixed; text-align: start; }
.scheduled-records__time-col { width: 17%; }
.scheduled-records__status-col { width: 16%; }
.scheduled-records__duration-col { width: 12%; }
.scheduled-records__actions-col { width: 9.5rem; }
.scheduled-records__table thead { background: var(--yj-color-control-hover); color: var(--yj-color-text-secondary); }
.scheduled-records__table thead th { padding: var(--yj-space-3) var(--yj-space-2); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); font-weight: var(--yj-font-weight-medium); text-align: start; }
.scheduled-records__table thead th:first-child, .scheduled-records__row .scheduled-records__when { padding-inline-start: var(--yj-space-10); }
.scheduled-records__table thead th:last-child { padding-inline-end: var(--yj-space-5); text-align: end; }
.scheduled-records__row { height: var(--yj-layout-schedule-record-row-height); color: var(--yj-color-text-primary); cursor: pointer; }
.scheduled-records__row > * { padding: var(--yj-space-3) var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); vertical-align: middle; overflow-wrap: anywhere; }
.scheduled-records__row:hover, .scheduled-records__row:focus-within { background: var(--yj-color-control-hover); }
.scheduled-records__when { position: relative; font-variant-numeric: tabular-nums; }
.scheduled-records__when::before, .scheduled-records__when::after { position: absolute; inset-inline-start: var(--yj-space-5); content: ""; }
.scheduled-records__when::before { inset-block: 0; width: var(--yj-border-width); background: var(--yj-color-border-default); }
.scheduled-records__row:first-child .scheduled-records__when::before { top: 50%; }
.scheduled-records__row:last-child .scheduled-records__when::before { bottom: 50%; }
.scheduled-records__when::after { top: 50%; width: var(--yj-space-2); height: var(--yj-space-2); transform: translate(-50%, -50%); box-sizing: border-box; border: var(--yj-border-width) solid var(--yj-color-border-strong); border-radius: 50%; background: var(--yj-color-bg-card); }
.scheduled-records__stamp { display: grid; }
.scheduled-records__clock { font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); font-weight: var(--yj-font-weight-medium); letter-spacing: -.025em; }
.scheduled-records__date, .scheduled-records__no-time, .scheduled-records__trigger, .scheduled-records__note { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.scheduled-records__task { text-align: start; font-weight: var(--yj-font-weight-regular); }
.scheduled-records__title { display: -webkit-box; max-width: 100%; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; padding: 0; border: 0; border-radius: var(--yj-radius-xs); background: transparent; color: inherit; font: inherit; font-size: var(--yj-font-size-card-title); font-weight: var(--yj-font-weight-semibold); line-height: var(--yj-line-height-card-title); text-align: start; overflow-wrap: anywhere; }
.scheduled-records__title:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-border-width); }
.scheduled-records__trigger, .scheduled-records__note { display: block; }
.scheduled-records__note { color: var(--yj-color-semantic-warning-ink); }
.scheduled-records__status { display: inline-flex; align-items: baseline; gap: var(--yj-space-2); max-width: 100%; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); font-weight: var(--yj-font-weight-medium); }
.scheduled-records__status::before { content: ""; flex: none; width: .5em; height: .5em; align-self: flex-start; margin-top: calc((var(--yj-line-height-caption) - .5em) / 2); border-radius: 50%; background: currentColor; }
.scheduled-records__row[data-tone="default"] .scheduled-records__status::before { box-sizing: border-box; border: var(--yj-border-width) solid currentColor; background: transparent; }
.scheduled-records__row[data-tone="error"] .scheduled-records__status { color: var(--yj-color-semantic-error-ink); }
.scheduled-records__row[data-tone="warning"] .scheduled-records__status { color: var(--yj-color-semantic-warning-ink); }
.scheduled-records__row[data-tone="info"] .scheduled-records__status { color: var(--yj-color-semantic-info-ink); }
.scheduled-records__duration { font-variant-numeric: tabular-nums; font-size: var(--yj-font-size-body); }
.scheduled-records__duration-prefix { display: none; }
.scheduled-records__dash { color: var(--yj-color-text-tertiary); }
.scheduled-records__row .scheduled-records__end { padding-inline-end: var(--yj-space-4); }
.scheduled-records__actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--yj-space-1); }
.scheduled-records__actions :deep(.n-button--disabled .yj-icon) { color: var(--yj-color-text-disabled); }
.scheduled-records__conversation :deep(.n-button__content) { gap: var(--yj-space-1); }
@container (max-width: 660px) {
  .scheduled-records__table, .scheduled-records__table tbody { display: block; }
  .scheduled-records__table colgroup { display: none; }
  .scheduled-records__table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .scheduled-records__row { display: grid; grid-template-columns: 5.5rem minmax(0, 1fr) auto; grid-template-areas: "when task state" "when elapsed actions"; align-items: center; gap: var(--yj-space-1) var(--yj-space-3); height: auto; padding: var(--yj-space-2) var(--yj-space-4); }
  .scheduled-records__row + .scheduled-records__row { border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); }
  .scheduled-records__row > *, .scheduled-records__row .scheduled-records__when, .scheduled-records__row .scheduled-records__end { min-width: 0; padding: 0; border: 0; }
  .scheduled-records__task { grid-area: task; }
  .scheduled-records__state { grid-area: state; align-self: start; justify-self: end; }
  .scheduled-records__when { grid-area: when; }
  .scheduled-records__when::before, .scheduled-records__when::after { display: none; }
  .scheduled-records__elapsed .scheduled-records__duration { font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
  .scheduled-records__elapsed { grid-area: elapsed; }
  .scheduled-records__duration-prefix { display: inline; }
  .scheduled-records__dash { display: none; }
  .scheduled-records__end { grid-area: actions; }
}
@container (max-width: 430px) {
  .scheduled-records__row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "task state" "when elapsed" "actions actions"; }
  .scheduled-records__stamp { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--yj-space-1); }
  .scheduled-records__date { order: -1; }
  .scheduled-records__clock { font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); letter-spacing: normal; }
  .scheduled-records__elapsed { justify-self: end; }
}
</style>
