<script setup lang="ts">
import { computed } from "vue";
import { useChatDisclosureChoice } from "../../composables/useChatDisclosureChoice";
import type { ConversationNativeToolExecution } from "../../domain/conversation-view";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import type { ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{item: ConversationTimelineItemViewModel; execution: ConversationNativeToolExecution}>();
const emit = defineEmits<{"disclosure-change": [change: ChatTimelineDisclosureChange]}>();
const native = computed(() => props.execution.native.item);
const changes = computed(() => native.value.fileChange?.changes ?? []);
const expandedChanges = useChatDisclosureChoice<Readonly<Record<number, boolean>>>(() => `${props.item.identity}:files`, () => ({}));
const state = computed(() => props.execution.status === "completed" ? "已" : props.execution.status === "failed" ? "未能" : props.execution.status === "declined" ? "已拒绝" : props.item.busy ? "正在" : "待确认：");
function verb(kind: string): string { return kind === "add" ? "创建" : kind === "delete" ? "删除" : kind === "update" ? "编辑" : "变更"; }
function toggled(event: Event, index: number) {
  const expanded = (event.target as HTMLDetailsElement).open;
  expandedChanges.value = {...expandedChanges.value, [index]: expanded};
  emit("disclosure-change", {itemIdentity: `${props.item.identity}:change:${index}`, expanded});
}
</script>

<template>
  <section class="chat-file-change" aria-label="文件变更" :aria-busy="item.busy">
    <p v-if="item.activityLabel || ['failed', 'declined'].includes(execution.status)" role="note">{{ item.activityLabel ?? (execution.status === 'failed' ? '文件变更失败' : '文件变更已拒绝') }}</p>
    <p v-if="!changes.length">文件变更明细不可用。</p>
    <details v-for="change in changes" :key="`${native.id}:change:${change.index}`" :open="expandedChanges[change.index] === true" @toggle="toggled($event, change.index)">
      <summary>
        <YjIcon name="file" size="sm" tone="muted" />
        <span class="chat-file-change__path">{{ state }}{{ verb(change.kind) }} {{ change.pathLabel ?? '文件（路径不可展示）' }}<template v-if="change.movePathLabel"> → {{ change.movePathLabel }}</template></span>
        <span v-if="execution.status === 'completed' && change.addedLines != null && change.removedLines != null" class="chat-file-change__counts">+{{ change.addedLines }} −{{ change.removedLines }}</span>
      </summary>
      <pre v-if="change.diffText != null">{{ change.diffText }}</pre>
      <p v-else>变更内容不可展示。</p>
      <p v-if="change.addedLines == null || change.removedLines == null">增删行统计不可用。</p>
    </details>
    <p v-if="native.availability !== 'available'" class="chat-file-change__note">部分变更信息不可展示。</p>
  </section>
</template>

<style scoped>
.chat-file-change { display:grid; min-width:0; gap:var(--yj-space-2); color:var(--yj-color-text-secondary); }
.chat-file-change p { margin:0; font-size:var(--yj-font-size-caption); }
.chat-file-change summary { cursor:pointer; overflow-wrap:anywhere; }
.chat-file-change summary > * { vertical-align:middle; margin-inline-end:var(--yj-space-2); }
.chat-file-change summary:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
.chat-file-change__path { overflow-wrap:anywhere; }
.chat-file-change__counts { white-space:nowrap; font-variant-numeric:tabular-nums; }
.chat-file-change pre { margin:var(--yj-space-2) 0; padding:var(--yj-space-2); max-height:28rem; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--yj-color-text-primary); background:var(--yj-color-bg-card); font-family:var(--yj-font-family-mono); font-size:var(--yj-font-size-caption); }
</style>
