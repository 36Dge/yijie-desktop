<script setup lang="ts">
import { NButton } from "naive-ui";
import type { RecordRow, RecordView } from "../../api/generated/scheduled-task-ipc.gen";
import { durationLabel, executionTimeLabel, recordElementId, recordStatus, recordTone } from "../../domain/scheduled-task-ui";
import YjIcon from "../yijie/YjIcon.vue";
import ScheduledCardAction from "./ScheduledCardAction.vue";

// Display only: retain native ordering, record identities and action eligibility.
defineProps<{ rows: RecordRow[]; rerunDisabled: boolean }>();
const emit = defineEmits<{ open: [row: RecordRow]; rerun: [row: RecordRow]; conversation: [row: RecordRow] }>();

function openCard(event: MouseEvent, row: RecordRow) {
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
function timeText(record: RecordView) {
  if (record.timing.execution_time === "not_started") return "本次未执行";
  const label = executionTimeLabel(record.timing, true);
  return label === "未知" ? "执行时间未知" : label;
}
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
  <section class="scheduled-records" aria-label="执行记录列表">
    <ul role="list" class="scheduled-records__grid" aria-label="执行记录">
      <li role="listitem" v-for="row in rows" :key="JSON.stringify(row.record.key)" class="scheduled-records__card" :data-tone="recordTone(row.record)" @click="openCard($event, row)">
        <div class="scheduled-records__topline">
          <span class="scheduled-records__time" :title="executionTimeLabel(row.record.timing)">{{ timeText(row.record) }}</span>
          <span class="scheduled-records__status" :title="recordStatus(row.record)">{{ statusLabel(row.record) }}</span>
        </div>
        <h2><button :id="recordElementId(row.record)" class="scheduled-records__title" :title="row.name" :aria-label="`查看 ${row.name} 的执行记录详情`" @click.stop="emit('open', row)">{{ row.name }}</button></h2>
        <p v-if="row.record.kind === 'run' && row.record.attention === 'needs_attention'" class="scheduled-records__note">审批或执行结果待核对</p>
        <div class="scheduled-records__footer">
          <div class="scheduled-records__meta">
            <span>{{ triggerLabel(row.record) }}</span>
            <span v-if="row.record.timing.duration !== 'not_started'" class="scheduled-records__duration" :title="durationLabel(row.record.timing)">耗时 {{ durationLabel(row.record.timing, true) }}</span>
          </div>
          <div class="scheduled-records__actions" data-record-actions @click.stop>
            <ScheduledCardAction v-if="row.record.kind === 'run'" :id="`schedule-rerun-${row.record.run.run_id}`" icon="rerun" :label="rerunHint(row)" :disabled="rerunDisabled || rerunUnavailable(row)" @click="emit('rerun', row)" />
            <NButton v-if="conversationAvailable(row)" class="scheduled-records__conversation" quaternary size="small" @click="emit('conversation', row)"><span>查看对话</span><YjIcon name="arrowUpRight" size="sm" /></NButton>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.scheduled-records { min-width: 0; container-type: inline-size; }
.scheduled-records__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--yj-space-4); margin: 0; padding: 0; list-style: none; }
.scheduled-records__card { display: flex; flex-direction: column; min-width: 0; padding: var(--yj-space-5); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); cursor: pointer; }
.scheduled-records__card:hover, .scheduled-records__card:focus-within { border-color: var(--yj-color-border-strong); }
.scheduled-records__topline { display: flex; align-items: baseline; justify-content: space-between; gap: var(--yj-space-3); min-height: var(--yj-line-height-caption); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.scheduled-records__time { min-width: 0; color: var(--yj-color-text-tertiary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.scheduled-records__status { flex: none; color: var(--yj-color-text-secondary); }
.scheduled-records__card[data-tone="error"] .scheduled-records__status { color: var(--yj-color-semantic-error-ink); }
.scheduled-records__card[data-tone="warning"] .scheduled-records__status { color: var(--yj-color-semantic-warning-ink); }
.scheduled-records__card[data-tone="info"] .scheduled-records__status { color: var(--yj-color-semantic-info-ink); }
.scheduled-records__card h2 { min-width: 0; min-height: calc(var(--yj-line-height-card-title) * 2); margin: var(--yj-space-4) 0 var(--yj-space-5); font-size: var(--yj-font-size-card-title); line-height: var(--yj-line-height-card-title); font-weight: var(--yj-font-weight-semibold); }
.scheduled-records__title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; border: 0; border-radius: var(--yj-radius-xs); padding: 0; background: transparent; color: var(--yj-color-text-primary); text-align: left; font: inherit; }
.scheduled-records__title:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.scheduled-records__note { margin: calc(-1 * var(--yj-space-2)) 0 var(--yj-space-3); color: var(--yj-color-semantic-warning-ink); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.scheduled-records__footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--yj-space-2); min-height: var(--yj-control-height-sm); margin-top: auto; }
.scheduled-records__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--yj-space-1) var(--yj-space-2); color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); font-variant-numeric: tabular-nums; }
.scheduled-records__duration::before { content: "·"; margin-right: var(--yj-space-2); }
.scheduled-records__actions { display: flex; align-items: center; gap: var(--yj-space-1); margin-left: auto; }
.scheduled-records__actions :deep(.n-button--disabled .yj-icon) { color: var(--yj-color-text-disabled); }
.scheduled-records__conversation :deep(.n-button__content) { gap: var(--yj-space-1); }
@container (max-width: 720px) {
  .scheduled-records__grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
