<script setup lang="ts">
import type { ArchiveV5NativeItem } from "../../api/generated/native-conversation-history.gen";
const props = defineProps<{ item: ArchiveV5NativeItem }>();
const actionLabels: Record<string, string> = { read: "读取", listFiles: "列出文件", search: "搜索", unknown: "操作记录" };
const changeLabels: Record<string, string> = { add: "新增", delete: "删除", update: "更新", unknown: "变更记录" };
const statuses: Record<string, string> = { completed: "已完成", failed: "失败", declined: "已拒绝", inProgress: "记录为进行中" };
</script>

<template>
  <details class="chat-archive-activity" :open="props.item.type === 'fileChange'">
    <summary>{{ props.item.type === "fileChange" ? "历史文件变更" : "历史过程详情" }}<span v-if="props.item.status"> · {{ statuses[props.item.status] ?? "状态未提供" }}</span></summary>
    <p v-if="props.item.commandPreview" class="chat-archive-activity__preview">{{ props.item.commandPreview }}</p>
    <ul v-if="props.item.commandActions?.length">
      <li v-for="action in props.item.commandActions" :key="action.index">
        {{ actionLabels[action.type] }}<span v-if="action.pathLabel"> · {{ action.pathLabel }}</span><span v-if="action.name"> · {{ action.name }}</span>
        <p v-if="action.query">{{ action.query }}</p><pre v-if="action.commandPreview">{{ action.commandPreview }}</pre>
      </li>
    </ul>
    <div v-for="change in props.item.fileChange?.changes ?? []" :key="change.index" class="chat-archive-activity__file">
      <p>{{ changeLabels[change.kind] }}<span v-if="change.pathLabel"> · {{ change.pathLabel }}</span><span v-if="change.movePathLabel"> → {{ change.movePathLabel }}</span>
        <span v-if="change.addedLines !== undefined"> · +{{ change.addedLines }}</span><span v-if="change.removedLines !== undefined"> −{{ change.removedLines }}</span>
      </p>
      <pre v-if="change.diffText !== undefined">{{ change.diffText }}</pre>
      <p v-else>原记录未提供可显示的变更内容。</p>
    </div>
    <p v-if="props.item.appContext">{{ props.item.appContext.appName ?? props.item.appContext.connectorId ?? "应用" }}<span v-if="props.item.appContext.actionName"> · {{ props.item.appContext.actionName }}</span></p>
  </details>
</template>

<style scoped>
.chat-archive-activity { margin-block: var(--yj-space-2); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-body); }
.chat-archive-activity summary { cursor: pointer; }
.chat-archive-activity pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 24rem; overflow: auto; }
.chat-archive-activity__file, .chat-archive-activity__preview { margin-block: var(--yj-space-2); }
</style>
