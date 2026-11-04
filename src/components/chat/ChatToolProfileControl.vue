<script setup lang="ts">
import { NSelect } from "naive-ui";
import type { ToolProfile } from "../../domain/chat-tool-profile";
defineProps<{ modelValue: ToolProfile; disabled?: boolean; readonly?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: ToolProfile] }>();
const options = [
  { label: "完整模式", value: "full" },
  { label: "轻量问答", value: "light" },
];
function select(value: string): void {
  if (value === "full" || value === "light") emit("update:modelValue", value);
}
</script>

<template>
  <span v-if="readonly" class="tool-profile-readonly" title="此聊天使用轻量问答。需要多代理或长期目标工具时，请新建完整模式聊天。">轻量问答</span>
  <NSelect v-else class="tool-profile-select" size="small" :value="modelValue" :options="options" :disabled="disabled"
    aria-label="新聊天工具模式" title="轻量问答关闭多代理和长期目标工具，保留检索、文件与已选连接器；创建后保持所选模式。"
    @update:value="select" />
</template>

<style scoped>
.tool-profile-select { width: 8em; flex: 0 0 auto; }
.tool-profile-readonly { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); white-space: nowrap; }
</style>
