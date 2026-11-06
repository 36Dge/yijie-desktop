<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { RuntimeApproval, RuntimeApprovalDecision } from "../../api/runtime-permission-client";
import ChatApprovalPrompt from "./ChatApprovalPrompt.vue";

const props = defineProps<{ requests: readonly RuntimeApproval[]; deciding: string | null; connected: boolean }>();
defineEmits<{ decision: [id: string, decision: RuntimeApprovalDecision] }>();
// The Host snapshot also contains receipts, including read-only legacy MCP.
// Only a live, undecided callback belongs beside the composer.
const pending = computed(() => props.requests.filter(r => r.status === "pending" && r.kind !== "mcp" && !r.mcp));
const current = computed(() => pending.value[0]);
const scopeOpen = ref(false);
watch(() => current.value?.id, () => { scopeOpen.value = false; }, { flush: "sync" });
const sources = {
  command: { name: "终端", icon: "terminal", question: "允许运行这条命令吗？" },
  file_change: { name: "文件更改", icon: "file", question: "允许这次文件更改吗？" },
  permissions: { name: "权限请求", icon: "shield", question: "允许这次访问吗？" },
  auto_review: { name: "自动审核需人工确认", icon: "shield", question: "允许这次操作吗？" },
  mcp: { name: "工具调用", icon: "connector", question: "" },
} as const;
</script>

<template>
  <section v-if="current" class="runtime-approvals" aria-label="待处理审批" aria-live="polite">
    <ChatApprovalPrompt v-for="request in pending.slice(0, 1)" :key="request.id" :source="sources[request.kind].name" :icon="sources[request.kind].icon"
      :question="request.reason || sources[request.kind].question" :command-prefix="request.commandPrefix"
      :disabled="!!deciding || !connected" :submitting="deciding === request.id"
      @once="$emit('decision', request.id, 'approve_once')" @similar="$emit('decision', request.id, 'approve_similar')" @reject="$emit('decision', request.id, 'reject')">
      <template #context>
        <span v-if="pending.length > 1">待处理 {{ pending.length }} 项</span>
        <button v-if="request.kind === 'command' && request.scope && !request.scope.includes('\n')" type="button" class="runtime-approvals__scope-toggle" :aria-expanded="scopeOpen" @click="scopeOpen = !scopeOpen">工作目录</button>
      </template>
      <pre v-if="request.summary">{{ request.summary }}</pre>
      <pre v-if="request.scope && (request.kind !== 'command' || scopeOpen || request.scope.includes('\n'))" class="runtime-approvals__scope">{{ request.scope }}</pre>
    </ChatApprovalPrompt>
  </section>
</template>

<style scoped>
.runtime-approvals { width:min(100%, var(--yj-layout-chat-composer-max)); margin-block-end:var(--yj-space-2); }
.runtime-approvals__scope-toggle { margin-inline-start:auto; padding:0 var(--yj-space-1); border:0; border-radius:var(--yj-radius-xs); background:transparent; color:inherit; cursor:pointer; font:inherit; }
.runtime-approvals__scope-toggle:hover { color:var(--yj-color-text-primary); text-decoration:underline; }
.runtime-approvals__scope-toggle:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); }
.runtime-approvals__scope { margin-block-start:var(--yj-space-2); }
</style>
