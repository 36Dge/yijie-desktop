<script setup lang="ts">
import { computed } from "vue";
import { NButton, NCard, NModal } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";
import type { RecordDetail } from "../../api/generated/scheduled-task-ipc.gen";
import { durationLabel, executionTimeLabel, recordStatus, recordTone, timingNote } from "../../domain/scheduled-task-ui";

const props = defineProps<{ detail: RecordDetail | null; name: string; rerunDisabled: boolean; error?: string }>();
const emit = defineEmits<{ close: []; closed: []; rerun: []; conversation: [] }>();
const run = computed(() => props.detail?.record.kind === "run" ? props.detail.record : null);
const trigger = computed(() => run.value ? { manual: "手动触发", automatic: "定时触发", rerun: "重新执行" }[run.value.run.trigger] : "定时计划");
const conversationUnavailable = computed(() => !run.value || run.value.conversation.status !== "available");
const note = computed(() => {
  if (!run.value) return "";
  if (run.value.conversation.status === "deleted") return "对应对话已删除。";
  if (run.value.conversation.status !== "available") return "对应对话暂不可用。";
  if (run.value.attention === "needs_attention") return "审批或执行状态需核对，请查看完整对话。";
  if (run.value.run.native_outcome === "failed") return "执行失败，请查看完整对话了解原因。";
  return "";
});
</script>

<template>
  <NModal :show="!!detail" @update:show="show => { if (!show) emit('close'); }" @after-leave="emit('closed')">
    <NCard class="scheduled-record-dialog" title="执行记录详情" closable role="dialog" aria-modal="true" aria-label="执行记录详情" @close="emit('close')">
      <dl v-if="detail" class="scheduled-record-dialog__fields">
        <dt>任务名称</dt><dd class="scheduled-record-dialog__name">{{ name }}</dd>
        <dt>执行状态</dt><dd><span class="scheduled-record-dialog__status" :data-tone="recordTone(detail.record)">{{ recordStatus(detail.record) }}</span></dd>
        <dt>触发方式</dt><dd>{{ trigger }}</dd>
        <dt>执行时间</dt><dd :title="executionTimeLabel(detail.record.timing)">{{ executionTimeLabel(detail.record.timing, true) }}</dd>
        <dt>执行耗时</dt><dd :title="`${durationLabel(detail.record.timing)} · ${timingNote(detail.record.timing)}`">{{ durationLabel(detail.record.timing, true) }}</dd>
      </dl>
      <p v-if="error" class="scheduled-record-dialog__error" role="alert">{{ error }}</p>
      <p v-else-if="note" class="scheduled-record-dialog__note">{{ note }}</p>
      <template #footer>
        <div class="scheduled-record-dialog__actions">
          <NButton :disabled="!run || rerunDisabled" @click="emit('rerun')"><template #icon><YjIcon name="rerun" size="sm" /></template>重新执行</NButton>
          <NButton type="primary" :disabled="conversationUnavailable" @click="emit('conversation')"><template #icon><YjIcon name="arrowUpRight" size="sm" /></template>查看完整对话</NButton>
        </div>
      </template>
    </NCard>
  </NModal>
</template>

<style scoped>
.scheduled-record-dialog { width: min(var(--yj-layout-schedule-record-width), calc(100vw - var(--yj-space-8))); max-height: calc(100vh - var(--yj-space-8)); overflow: auto; border-radius: var(--yj-radius-xl); }
.scheduled-record-dialog__fields { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: start; gap: var(--yj-space-4) var(--yj-space-10); margin: var(--yj-space-2) 0; font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.scheduled-record-dialog__fields dt { color: var(--yj-color-text-tertiary); }
.scheduled-record-dialog__fields dd { min-width: 0; margin: 0; color: var(--yj-color-text-primary); overflow-wrap: anywhere; }
.scheduled-record-dialog__status[data-tone="error"] { color: var(--yj-color-semantic-error-ink); }
.scheduled-record-dialog__status[data-tone="warning"] { color: var(--yj-color-semantic-warning-ink); }
.scheduled-record-dialog__status[data-tone="info"] { color: var(--yj-color-semantic-info-ink); }
.scheduled-record-dialog__name { font-weight: var(--yj-font-weight-semibold); }
.scheduled-record-dialog__note, .scheduled-record-dialog__error { margin: var(--yj-space-4) 0 0; font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-body); color: var(--yj-color-text-secondary); }
.scheduled-record-dialog__error { color: var(--yj-color-semantic-error-ink); }
.scheduled-record-dialog__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--yj-space-3); }
</style>
