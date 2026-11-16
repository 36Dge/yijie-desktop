<script setup lang="ts">
import { computed } from "vue";
import type { Decision, DecisionFact, MarketApproval, NativeObservation, ToolObservation } from "../../domain/market-host-v2-native.generated";
import WebRetrievalResult from "./WebRetrievalResult.vue";
import ChatApprovalPrompt from "./ChatApprovalPrompt.vue";
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
const pending = computed(() => props.observation?.approvals?.requests.filter(item => item.state === "pending") ?? []);
const toolLabels = { in_progress: "执行中", completed: "已完成", failed: "执行失败" };
const names = computed(() => new Map(props.observation?.selectionDisplay.map(item => [item.serviceId, item.displayName])));
const displayed = computed(() => props.toolObservation === undefined ? props.observation : props.toolObservation);
const decisionLabels = { approve_once: "已允许一次", reject: "已拒绝", cancel: "已取消本次" };
const decisionIntents = { approve_once: "允许一次", reject: "拒绝", cancel: "取消本次" };
const unlinkedDecisions = computed(() => {
  const facts = new Map<string, DecisionFact>();
  for (const fact of displayed.value?.decisionFacts ?? []) {
    const key = `${fact.callRef}:${fact.decisionId}`;
    const previous = facts.get(key);
    // Native supplies append order; wall-clock adjustments cannot reorder facts.
    if (!previous || (previous.kind !== "acknowledged" && fact.kind === "acknowledged")) facts.set(key, fact);
  }
  return [...facts.values()].filter(fact => !displayed.value?.tools?.items.some(item => item.correlation?.callRef === fact.callRef && item.correlation.decisionReceipt?.decisionId === fact.decisionId));
});
function approvalName(approval: MarketApproval): string {
  const display = props.observation?.availableTurns?.find(turn => turn.nativeTurnId === approval.identity.nativeTurnId)?.selectionDisplay;
  return display?.find(item => item.serviceId === approval.identity.serviceId)?.displayName ?? names.value.get(approval.identity.serviceId) ?? approval.identity.serviceId;
}
function toolSourceName(item: ToolObservation): string {
  const identity = item.correlation ?? item.service;
  if (!identity) return "连接器工具";
  return callSourceName(item.nativeTurnId, identity);
}
function callSourceName(turnId: string, identity: Pick<DecisionFact, "serviceId" | "reference">): string {
  const original = displayed.value?.availableTurns?.find(turn => turn.nativeTurnId === turnId)
    ?? props.observation?.availableTurns?.find(turn => turn.nativeTurnId === turnId);
  // An explicit historical response supplies that turn's display on older readers.
  // The default observation may instead describe a newer, still unbound submission.
  const display = original?.selectionDisplay
    ?? (props.selectedTurnId === turnId && displayed.value?.tools?.nativeTurnId === turnId
      ? displayed.value.selectionDisplay : []);
  return display.find(entry => entry.serviceId === identity.serviceId
    && entry.reference.installationId === identity.reference.installationId
    && entry.reference.revision === identity.reference.revision
    && entry.reference.generation === identity.reference.generation)?.displayName ?? identity.serviceId;
}
</script>
<template>
  <section v-if="observation?.managed || error" class="market-activity" aria-label="连接器调用" :aria-busy="refreshing" aria-live="polite">
    <p v-if="error" class="market-activity__notice" role="alert">{{ error }} <button class="yj-control" type="button" :disabled="refreshing || !!deciding" @click="$emit('refresh')">{{ refreshing ? '正在核对' : '刷新状态' }}</button></p>
    <ChatApprovalPrompt v-for="approval in pending" :key="approval.approvalId" :source="approvalName(approval)" icon="connector" :question="approval.review.title"
      :submitting="deciding === approval.approvalId" :disabled="!actionable(approval)"
      @reject="$emit('decision', approval.approvalId, 'reject')" @once="$emit('decision', approval.approvalId, 'approve_once')">
      <p>{{ approval.review.summary }}</p>
      <pre v-if="approval.review.argumentsJson" aria-label="本次工具调用完整参数">{{ approval.review.argumentsJson }}</pre>
      <p class="market-activity__meta">{{ approval.review.risk === 'read' ? '读取数据' : '修改数据' }} · {{ approval.identity.toolName }} · {{ approval.decisionExpiresAtUnixMs ? '最晚批准时间' : '有效期至' }} {{ new Date(approval.decisionExpiresAtUnixMs ?? approval.expiresAtUnixMs).toLocaleTimeString('zh-CN') }}</p>
      <template #extra-action><button class="approval-secondary" type="button" :disabled="!actionable(approval)" @click="$emit('decision', approval.approvalId, 'cancel')">取消本次</button></template>
    </ChatApprovalPrompt>
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
    <article v-for="fact in unlinkedDecisions" :key="`${fact.callRef}:${fact.decisionId}`" class="market-activity__card" aria-label="只读决定记录">
      <strong>{{ callSourceName(fact.nativeTurnId, fact) }}</strong>
      <p class="market-activity__meta">{{ fact.toolName }} · {{ new Date(fact.observedAtUnixMs).toLocaleString('zh-CN') }}</p>
      <p>{{ fact.kind === 'acknowledged' ? '已确认' : '已请求' }}{{ decisionIntents[fact.decision] }}</p>
      <p v-if="fact.kind !== 'acknowledged'" class="market-activity__meta">决定送达未确认。</p>
      <p class="market-activity__meta">当前展示尚无关联的工具结果；这条记录不能证明外部操作已执行或成功。</p>
    </article>
    <p v-if="displayed?.decisionFactsTruncated" class="market-activity__meta">仅展示此轮部分决定记录，优先保留待确认调用的记录。</p>
    <article v-for="item in displayed?.tools?.items ?? []" :key="item.nativeItemId" class="market-activity__card" aria-label="连接器工具结果">
      <header><YjIcon name="connector" size="md" /><strong>{{ toolSourceName(item) }}</strong><span>{{ toolLabels[item.state] }}</span></header>
      <p class="market-activity__meta">{{ item.toolName }}</p>
      <p v-if="item.correlation" class="market-activity__meta" aria-label="本次调用的批准记录">{{ item.correlation.decisionReceipt ? decisionLabels[item.correlation.decisionReceipt.decision] : '未记录到用户决定' }} · {{ item.correlation.admissionConsumed ? '执行结果以工具记录为准' : '本次未开始执行' }}</p>
      <p v-else-if="item.state !== 'in_progress'" class="market-activity__meta">审批与结果关联未确认。</p>
      <p v-if="item.resultTextSource === 'structured' && item.resultText" class="market-activity__meta">结构化结果（JSON）</p>
      <WebRetrievalResult v-if="item.resultText && ['kimi_web_search', 'kimi_web_search_pro', 'kimi_web_fetch'].includes(item.toolName)" :tool="item.toolName" :text="item.resultText" />
      <pre v-else-if="item.resultText">{{ item.resultText }}</pre>
      <p v-else-if="item.state === 'in_progress'">正在等待工具返回。</p>
      <p v-else-if="item.state === 'failed'">本次工具调用失败，请根据对话中的结果继续处理。</p>
      <p v-else>工具调用已结束，没有可展示的文本结果。</p>
      <template v-if="item.structuredResultText"><p class="market-activity__meta">结构化结果（JSON）</p><pre aria-label="结构化工具结果">{{ item.structuredResultText }}</pre></template>
      <p v-if="item.truncated" class="market-activity__meta">结果展示不完整，部分内容已省略。</p>
    </article>
    <p v-if="displayed?.tools?.truncated" class="market-activity__meta">调用记录较多，仅展示当前返回的部分记录。</p>
  </section>
</template>
<style scoped>
.market-activity { display:grid; gap:var(--yj-space-3); margin-block:var(--yj-space-4); min-width:0; }
.market-activity__card { display:grid; gap:var(--yj-space-2); border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-lg); padding:var(--yj-space-4); background:var(--yj-color-bg-card); color:var(--yj-color-text-primary); min-width:0; }
header,.market-activity__notice { display:flex; align-items:center; gap:var(--yj-space-2); flex-wrap:wrap; }
header > span,.market-activity__meta { color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-caption); }
p,pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
pre { max-height:var(--yj-layout-chat-entry-max); overflow:auto; font-size:var(--yj-font-size-caption); }
button { background:var(--yj-color-bg-card); border:var(--yj-border-width) solid var(--yj-color-border-default); color:var(--yj-color-text-primary); cursor:pointer; }
button:disabled { background:var(--yj-color-control-disabled-bg); color:var(--yj-color-text-disabled); cursor:default; }
button:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
.market-activity__history { display:grid; gap:var(--yj-space-2); min-width:0; }
select { width:100%; min-width:0; max-width:100%; color:var(--yj-color-text-primary); background:var(--yj-color-bg-card); border:var(--yj-border-width) solid var(--yj-color-border-default); }
select:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
</style>
