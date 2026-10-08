<script setup lang="ts">
import { computed } from "vue";
import type { Decision, MarketApproval, NativeObservation } from "../../domain/market-host-native.generated";
import YjIcon from "../yijie/YjIcon.vue";
const props = defineProps<{
  observation: NativeObservation | null;
  connected: boolean;
  refreshing: boolean;
  deciding: string | null;
  error: string | null;
  actionable: (approval: MarketApproval) => boolean;
  toolObservation?: NativeObservation | null;
  selectedTurnId?: string | null;
  historyRefreshing?: boolean;
  historyError?: string | null;
}>();
defineEmits<{ refresh: []; decision: [approvalId: string, decision: Decision]; selectTurn: [turnId: string | null] }>();
const labels = { pending: "需要你的批准", approved: "已批准本次", rejected: "已拒绝", cancelled: "已取消本次", expired: "请求已过期", unavailable: "请求已失效" };
const toolLabels = { in_progress: "执行中", completed: "已完成", failed: "执行失败" };
const names = computed(() => new Map(props.observation?.selectionDisplay.map(item => [item.serviceId, item.displayName])));
const displayed = computed(() => props.toolObservation === undefined ? props.observation : props.toolObservation);
const toolNames = computed(() => new Map(displayed.value?.selectionDisplay.map(item => [item.serviceId, item.displayName])));
function approvalName(approval: MarketApproval): string {
  const display = props.observation?.availableTurns?.find(turn => turn.nativeTurnId === approval.identity.nativeTurnId)?.selectionDisplay;
  return display?.find(item => item.serviceId === approval.identity.serviceId)?.displayName ?? names.value.get(approval.identity.serviceId) ?? approval.identity.serviceId;
}
</script>
<template>
  <section v-if="observation?.managed || error" class="market-activity" aria-label="连接器调用" :aria-busy="refreshing" aria-live="polite">
    <p v-if="error" class="market-activity__notice" role="alert">{{ error }} <button class="yj-control" type="button" :disabled="refreshing || !!deciding" @click="$emit('refresh')">{{ refreshing ? '正在核对' : '刷新状态' }}</button></p>
    <article v-for="approval in observation?.approvals?.requests ?? []" :key="approval.approvalId" class="market-activity__card" :aria-label="approval.review.title">
      <header><YjIcon name="shield" size="md" /><strong>{{ labels[approval.state] }}</strong><span>{{ approvalName(approval) }}</span></header>
      <strong>{{ approval.review.title }}</strong>
      <p>{{ approval.review.summary }}</p>
      <pre v-if="approval.review.argumentsJson" aria-label="本次工具调用完整参数">{{ approval.review.argumentsJson }}</pre>
      <p class="market-activity__meta">{{ approval.review.risk === 'read' ? '读取数据' : '修改数据' }} · {{ approval.identity.toolName }} · 有效期至 {{ new Date(approval.expiresAtUnixMs).toLocaleTimeString('zh-CN') }}</p>
      <p v-if="approval.state === 'approved'" class="market-activity__meta">本次批准已确认，执行结果以实际工具返回为准。</p>
      <footer v-if="approval.state === 'pending'">
        <button class="yj-control yj-control--regular" type="button" :disabled="!actionable(approval)" @click="$emit('decision', approval.approvalId, 'cancel')">取消本次</button>
        <button class="yj-control yj-control--regular" type="button" :disabled="!actionable(approval)" @click="$emit('decision', approval.approvalId, 'reject')">拒绝</button>
        <button class="yj-control yj-control--regular market-activity__approve" type="button" :disabled="!actionable(approval)" @click="$emit('decision', approval.approvalId, 'approve_once')">{{ deciding === approval.approvalId ? '正在提交' : '批准本次' }}</button>
      </footer>
    </article>
    <label v-if="observation?.availableTurns?.length" class="market-activity__history">
      <span>工具调用记录</span>
      <select class="yj-control" aria-label="查看连接器调用轮次" :value="selectedTurnId ?? ''" @change="$emit('selectTurn', ($event.target as HTMLSelectElement).value || null)">
        <option value="">最新轮次</option>
        <option v-for="(turn, index) in observation.availableTurns" :key="turn.nativeTurnId" :value="turn.nativeTurnId">{{ index === 0 ? '最近一次' : `往前第 ${index} 次` }} · {{ turn.selectionDisplay.map(item => item.displayName).join('、') || '未选用连接器' }} · {{ turn.nativeTurnId.slice(-6) }}</option>
      </select>
    </label>
    <p v-if="observation?.turnsTruncated" class="market-activity__meta">仅列出最近 128 轮连接器提交。</p>
    <p v-if="historyRefreshing" role="status">正在读取所选轮次的工具结果。</p>
    <p v-if="historyError" role="alert">{{ historyError }} <button class="yj-control" type="button" :disabled="historyRefreshing" @click="$emit('selectTurn', selectedTurnId ?? null)">刷新此轮</button></p>
    <p v-if="selectedTurnId && displayed?.tools && !displayed.tools.items.length && !historyRefreshing" class="market-activity__meta">此轮没有连接器工具调用记录。</p>
    <article v-for="item in displayed?.tools?.items ?? []" :key="item.nativeItemId" class="market-activity__card" aria-label="连接器工具结果">
      <header><YjIcon name="connector" size="md" /><strong>{{ item.service ? toolNames.get(item.service.serviceId) ?? item.service.serviceId : '连接器工具' }}</strong><span>{{ toolLabels[item.state] }}</span></header>
      <p class="market-activity__meta">{{ item.toolName }}</p>
      <pre v-if="item.resultText">{{ item.resultText }}</pre>
      <p v-else-if="item.state === 'in_progress'">正在等待工具返回。</p>
      <p v-else-if="item.state === 'failed'">本次工具调用失败，请根据对话中的结果继续处理。</p>
      <p v-else>工具调用已结束，没有可展示的文本结果。</p>
      <p v-if="item.truncated" class="market-activity__meta">结果较长，仅展示部分内容。</p>
    </article>
    <p v-if="displayed?.tools?.truncated" class="market-activity__meta">调用记录较多，仅展示当前返回的部分记录。</p>
  </section>
</template>
<style scoped>
.market-activity { display:grid; gap:var(--yj-space-3); margin-block:var(--yj-space-4); min-width:0; }
.market-activity__card { display:grid; gap:var(--yj-space-2); border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-lg); padding:var(--yj-space-4); background:var(--yj-color-bg-card); color:var(--yj-color-text-primary); min-width:0; }
header,footer,.market-activity__notice { display:flex; align-items:center; gap:var(--yj-space-2); flex-wrap:wrap; }
header > span,.market-activity__meta { color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-caption); }
p,pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
pre { max-height:var(--yj-layout-chat-entry-max); overflow:auto; font-size:var(--yj-font-size-caption); }
footer { justify-content:flex-end; }
button { background:var(--yj-color-bg-card); border:var(--yj-border-width) solid var(--yj-color-border-default); color:var(--yj-color-text-primary); cursor:pointer; }
.market-activity__approve { background:var(--yj-color-brand-primary); color:var(--yj-color-on-brand); }
button:disabled { background:var(--yj-color-control-disabled-bg); color:var(--yj-color-text-disabled); cursor:default; }
button:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
.market-activity__history { display:grid; gap:var(--yj-space-2); min-width:0; }
select { width:100%; min-width:0; max-width:100%; color:var(--yj-color-text-primary); background:var(--yj-color-bg-card); border:var(--yj-border-width) solid var(--yj-color-border-default); }
select:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
</style>
