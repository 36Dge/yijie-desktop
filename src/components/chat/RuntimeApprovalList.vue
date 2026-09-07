<script setup lang="ts">
import type { RuntimeApproval, RuntimeApprovalDecision } from "../../api/runtime-permission-client";
import YjIcon from "../yijie/YjIcon.vue";
defineProps<{ requests: readonly RuntimeApproval[]; deciding: string | null; connected: boolean }>();
defineEmits<{ decision: [id: string, decision: RuntimeApprovalDecision] }>();
const labels = { pending: "需要你的批准", approved: "已批准本次", rejected: "已拒绝", unavailable: "请求已失效" };
</script>
<template>
  <section v-if="requests.length" class="runtime-approvals" aria-label="操作审批" aria-live="polite">
    <article v-for="request in requests" :key="request.id" class="runtime-approval">
      <header><YjIcon name="shield" size="md" /><strong>{{ labels[request.status] }}</strong><span v-if="request.kind === 'auto_review'">自动审核需人工确认</span></header>
      <p class="runtime-approval-summary">{{ request.summary }}</p>
      <div v-if="request.scope"><strong>{{ request.kind === 'command' ? '工作目录' : '影响范围' }}</strong><pre>{{ request.scope }}</pre></div>
      <p v-if="request.reason" class="runtime-approval-reason">{{ request.reason }}</p>
      <p v-if="request.kind === 'auto_review' && request.status === 'approved'" class="runtime-approval-reason">本次操作已获得批准；若当前轮已结束，可继续任务以执行。</p>
      <footer v-if="request.status === 'pending'"><button type="button" :disabled="!!deciding || !connected" @click="$emit('decision', request.id, 'reject')">拒绝</button><button type="button" :disabled="!!deciding || !connected" @click="$emit('decision', request.id, 'approve_once')">{{ deciding === request.id ? '正在提交' : '批准本次' }}</button></footer>
    </article>
  </section>
</template>
<style scoped>
.runtime-approvals { display:grid; gap:var(--yj-space-3); margin-block:var(--yj-space-4); }
.runtime-approval { border:1px solid var(--yj-color-border-default); border-radius:var(--yj-radius-lg); padding:var(--yj-space-4); background:var(--yj-color-bg-card); color:var(--yj-color-text-primary); }
header,footer { display:flex; align-items:center; gap:var(--yj-space-2); flex-wrap:wrap; }
header > span,.runtime-approval-reason { color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-caption); }
.runtime-approval-summary,pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:180px; overflow:auto; }
pre { font-size:var(--yj-font-size-caption); }
footer { justify-content:flex-end; }
button { background:var(--yj-color-bg-card); border:1px solid var(--yj-color-border-control); border-radius:var(--yj-radius-md); padding:var(--yj-space-2) var(--yj-space-4); color:inherit; font:inherit; cursor:pointer; }
button:last-child { background:var(--yj-color-brand-primary); color:var(--yj-color-on-brand); }
button:disabled { opacity:.5; cursor:default; }
button:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:2px; }
</style>
