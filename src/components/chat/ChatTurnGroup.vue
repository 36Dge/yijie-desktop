<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { isCollapsibleProcessItem } from "../../domain/conversation-process";
import type {
  ConversationTimelineArtifactReferenceContentBlock,
  ConversationTimelineAttachmentReferenceContentBlock,
  ConversationTimelineItemViewModel,
  ConversationTimelineNoticeViewModel,
  ConversationTimelineProgressViewModel,
  ConversationTimelineTurnViewModel,
} from "../../domain/conversation-timeline";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";
import ChatCommandItem, {
  type ChatApprovalDecisionChange,
  type ChatApprovalTransientState,
} from "./ChatCommandItem.vue";
import ChatSafeContent from "./ChatSafeContent.vue";
import ChatToolItem from "./ChatToolItem.vue";
import ChatNativeToolItem from "./ChatNativeToolItem.vue";
import ChatTurnPlan from "./ChatTurnPlan.vue";
import ChatTimelineItemShell, {
  type ChatTimelineDisclosureChange,
} from "./ChatTimelineItemShell.vue";

const props = withDefaults(defineProps<{
  turn: ConversationTimelineTurnViewModel;
  position: number;
  timingLabel?: string | null;
  canDecideApprovals?: boolean;
  approvalAuthorityRevision?: number;
  approvalTransients?: Readonly<Record<string, ChatApprovalTransientState | undefined>>;
}>(), {
  timingLabel: null,
  canDecideApprovals: false,
  approvalAuthorityRevision: 0,
  approvalTransients: () => Object.freeze({}),
});

const processId = `${useId()}-process`;
const expansionChoice = ref<boolean | null>(null);
const processItems = computed(() => props.turn.items.filter(item =>
  isCollapsibleProcessItem(item) && (!item.approval ||
    !["submitting", "reconciling", "error"].includes(props.approvalTransients[item.approval.approvalRequestId]?.phase ?? "idle"))));
const processKeys = computed(() => new Set(processItems.value.map(item => item.identity)));
const processPlan = computed(() => props.turn.plan && !props.turn.plan.steps.some(step => step.status === "unknown") ? props.turn.plan : null);
const hasProcess = computed(() => processItems.value.length > 0 || processPlan.value !== null);
const processExpanded = computed(() => expansionChoice.value ??
  (props.turn.liveObserved === true && ["in_progress", "waiting_approval"].includes(props.turn.domainStatus)));
const processItemId = (item: ConversationTimelineItemViewModel) => `${processId}-${encodeURIComponent(item.identity)}`;
const processControls = computed(() => [...(processPlan.value ? [`${processId}-plan`] : []), ...processItems.value.map(processItemId)].join(" "));
watch(() => props.turn.identity, () => { expansionChoice.value = null; });
function toggleProcess() {
  expansionChoice.value = !processExpanded.value;
  emit("disclosure-change", { itemIdentity: props.turn.identity, expanded: processExpanded.value });
}
function preserveProcessExpansion(item: ConversationTimelineItemViewModel) {
  if (processKeys.value.has(item.identity) && processExpanded.value) expansionChoice.value = true;
}

const turnEntries = computed(() => {
  const entries: { kind: "item" | "timing" | "plan"; identity: string; item: ConversationTimelineItemViewModel | null }[] =
    props.turn.items.map(item => ({ kind: "item", identity: item.identity, item }));
  const firstOutput = props.turn.items.findIndex(item => item.presentation !== "user_message");
  const index = firstOutput < 0 ? entries.length : firstOutput;
  entries.splice(index, 0, { kind: "timing", identity: `${props.turn.identity}:timing`, item: null });
  if (processPlan.value) entries.splice(index + 1, 0, { kind: "plan", identity: `${props.turn.identity}:plan`, item: null });
  return entries;
});

const emit = defineEmits<{
  "disclosure-change": [change: ChatTimelineDisclosureChange];
  "approval-decision": [change: ChatApprovalDecisionChange];
}>();

const slots = defineSlots<{
  "structured-answer"(props: { turnId: string }): unknown;
  "legacy-records"(props: {turnId: string}): unknown;
  "artifact-reference"(props: {
    item: ConversationTimelineItemViewModel;
    block: ConversationTimelineArtifactReferenceContentBlock;
  }): unknown;
  "attachment-reference"(props: {
    item: ConversationTimelineItemViewModel;
    block: ConversationTimelineAttachmentReferenceContentBlock;
  }): unknown;
  "item-actions"(props: { item: ConversationTimelineItemViewModel }): unknown;
  "code-actions"(props: {
    item: ConversationTimelineItemViewModel;
    codeIdentity: string;
    text: string;
    language: string | null;
  }): unknown;
}>();

function itemLabel(item: ConversationTimelineItemViewModel): string {
  switch (item.presentation) {
    case "user_message":
      return "用户消息";
    case "commentary":
      return "处理过程";
    case "final_answer":
    case "assistant_unclassified":
      return "模型回答";
    case "artifact":
      return "生成内容";
    case "reasoning":
      return item.contentBlocks.some(b => b.type === "text" && b.reasoningSource === "summary") &&
        !item.contentBlocks.some(b => b.type === "text" && b.reasoningSource === "content" && b.text.length > 0)
        ? "推理摘要" : "过程记录";
    case "command":
      return "命令执行";
    case "tool":
      return "工具调用";
    case "unknown":
    default:
      return "未知内容";
  }
}

function itemIcon(item: ConversationTimelineItemViewModel): YjIconName {
  switch (item.presentation) {
    case "user_message":
      return "user";
    case "final_answer":
    case "assistant_unclassified":
      return "assistant";
    case "commentary":
      return "pending";
    case "artifact":
      return "file";
    case "reasoning":
      return "pending";
    case "command":
      return "workspace";
    case "tool":
      return "skillOperations";
    case "unknown":
    default:
      return "warning";
  }
}

function itemStatusLabel(item: ConversationTimelineItemViewModel): string {
  if (item.presentation === "reasoning" && item.reasoning !== null) {
    switch (item.reasoning?.status) {
      case "in_progress":
        return "进行中";
      case "complete":
        return "已完成";
      case "incomplete":
        return "未完整结束";
      case "unavailable":
        return "不可用";
      case "unknown":
      default:
        return "状态未知";
    }
  }
  switch (item.domainStatus) {
    case "started":
      return "已开始";
    case "streaming":
      return "进行中";
    case "completed":
      return "已完成";
    case "incomplete":
      return "未完整结束";
  }
}

function turnStatusLabel(turn: ConversationTimelineTurnViewModel): string {
  if (["queued", "in_progress", "waiting_approval"].includes(turn.domainStatus) && turn.source === "legacy_archive") return "旧版记录，当前执行状态未确认";
  if (turn.source === "native_observed" && turn.domainStatus === "in_progress" && !turn.liveObserved) return "上次记录为进行中，当前进度待确认";
  if (turn.source === "local_submission") {
    if (turn.submissionStatus === "failed") return "提交失败";
    if (turn.submissionStatus === "uncertain") return "提交结果待确认";
    if (turn.submissionStatus === "cancelled") return "提交已取消";
    return "等待提交";
  }
  if (turn.statusSource === "runtime_read") {
    if (turn.domainStatus === "failed") return "历史记录显示失败，详情不完整";
    if (turn.domainStatus === "interrupted") return "历史记录显示已中断";
    if (turn.domainStatus === "completed") return "历史已结束，结果信息不完整";
  }
  switch (turn.domainStatus) {
    case "unknown":
      return "执行状态待确认";
    case "queued":
      return "等待处理";
    case "in_progress":
      return "正在处理";
    case "waiting_approval":
      return "等待继续";
    case "completed":
      return "已完成";
    case "interrupted":
      return "已中断";
    case "failed":
      return "未完成";
    case "recovery_required":
      return "需要核对";
  }
}

function turnStatusIcon(turn: ConversationTimelineTurnViewModel): YjIconName {
  switch (turn.phase) {
    case "complete":
      return "check";
    case "interrupted":
      return "stop";
    case "failed":
    case "recovery_required":
      return "warning";
    default:
      return "pending";
  }
}

function progressLabel(progress: ConversationTimelineProgressViewModel): string {
  switch (progress.domainStatus) {
    case "queued":
      return "本轮正在等待处理";
    case "in_progress":
      return "本轮正在处理中";
    case "waiting_approval":
      return "本轮正在等待继续";
  }
}

function turnStateMessage(turn: ConversationTimelineTurnViewModel): string | null {
  switch (turn.domainStatus) {
    case "interrupted":
      return "本轮已中断，已确认的内容仍可阅读。";
    case "failed":
      return "本轮未能完成，已确认的内容仍可阅读。";
    case "recovery_required":
      return "本轮状态需要核对，现有内容仍可阅读。";
    default:
      return null;
  }
}

function noticeMessage(notice: ConversationTimelineNoticeViewModel): string {
  const message = notice.severity === "error"
    ? "本轮发生错误，已保留可用内容。"
    : "本轮存在需要注意的信息。";
  return notice.count > 1 ? `${message} 共 ${notice.count} 次。` : message;
}

function reasoningReasonLabel(item: ConversationTimelineItemViewModel): string | null {
  switch (item.reasoning?.reasonCode) {
    case "reasoning_not_emitted":
      return "本轮未产生可显示的模型推理记录";
    case "turn_interrupted":
      return "本轮已中断";
    case "stream_gap":
      return "模型推理记录存在流缺口";
    case "runtime_error":
      return "运行时错误中断了模型推理记录";
    case "limit_exceeded":
      return "模型推理记录超过可用限制";
    case "protocol_error":
      return "模型推理记录协议状态异常";
    case "host_shutdown":
      return "Host 已停止";
    case "unknown":
      return "未提供具体原因";
    case null:
    case undefined:
    default:
      return null;
  }
}

function reasoningStateMessage(item: ConversationTimelineItemViewModel): string | null {
  if (item.presentation !== "reasoning") return null;
  if (item.activityLabel) return item.activityLabel;
  if (item.contentBlocks.some(b => b.type === "text" && b.reasoningSource === "summary") &&
      !item.contentBlocks.some(b => b.type === "text" && b.reasoningSource === "content" && b.text.length > 0)) return "仅提供推理摘要，未提供原始模型推理正文。";
  const hasContent = item.contentBlocks.length > 0;
  if (item.reasoning === null) {
    if (item.domainStatus === "started" || item.domainStatus === "streaming") {
      return hasContent ? null : "正在等待过程记录…";
    }
    return "此过程仅包含状态元数据；详情未进入当前对话投影。";
  }
  const reason = reasoningReasonLabel(item);
  switch (item.reasoning?.status) {
    case "in_progress":
      return hasContent ? null : "正在等待模型推理记录…";
    case "complete":
      return hasContent ? null : "模型推理记录已完成，但没有可显示的正文。";
    case "incomplete":
      return `模型推理记录未完整结束，已保留可用内容${reason ? `；${reason}` : ""}。`;
    case "unavailable":
      return `模型推理记录不可用${reason ? `；${reason}` : ""}。`;
    case "unknown":
    default:
      return "模型推理记录状态未知，已保留当前可用内容。";
  }
}

function forwardDisclosure(change: ChatTimelineDisclosureChange): void {
  emit("disclosure-change", change);
}

function forwardApprovalDecision(change: ChatApprovalDecisionChange): void {
  emit("approval-decision", change);
}
</script>

<template>
  <section
    class="chat-turn-group"
    :class="`chat-turn-group--${turn.phase}`"
    :aria-label="`对话 ${position}`"
  >
    <header v-if="turn.domainStatus !== 'completed'" class="chat-turn-group__header">
      <span class="chat-turn-group__status">
        <YjIcon
          :name="turnStatusIcon(turn)"
          size="sm"
          :tone="turn.phase === 'failed' || turn.phase === 'recovery_required' ? 'warning' : 'muted'"
        />
        {{ turnStatusLabel(turn) }}
        <span v-if="turn.source === 'legacy_archive'"> · 旧版记录</span>
        <span v-else-if="turn.source === 'native_rebuilt'"> · 历史恢复，内容可能不完整</span>
      </span>
    </header>

    <div
      v-if="turn.progress"
      class="chat-turn-group__progress"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <YjIcon name="pending" size="sm" tone="primary" />
      <span>{{ progressLabel(turn.progress) }}</span>
    </div>

    <p v-if="turnStateMessage(turn)" class="chat-turn-group__turn-state" role="note">
      {{ turnStateMessage(turn) }}
    </p>

    <slot v-if="turn.source === 'legacy_archive'" name="legacy-records" :turn-id="turn.turnId" />
    <ChatTurnPlan v-if="turn.plan && !processPlan" :key="turn.plan.identity" :plan="turn.plan" />

    <ol v-if="turn.items.length > 0 || timingLabel || hasProcess" class="chat-turn-group__items" aria-label="本轮对话内容">
      <template v-for="{ item, kind, identity } in turnEntries" :key="identity">
        <li v-if="kind === 'timing' && (timingLabel || hasProcess)" class="chat-turn-group__timing">
          <button v-if="hasProcess" class="chat-turn-group__process-toggle" type="button"
            :aria-label="`${timingLabel || '处理过程'}，${processExpanded ? '收起' : '展开'}本轮处理过程`"
            :aria-expanded="processExpanded" :aria-controls="processControls" @click="toggleProcess">
            <span>{{ timingLabel || '处理过程' }}</span>
            <YjIcon :name="processExpanded ? 'chevronDown' : 'chevronRight'" size="sm" tone="muted" />
          </button>
          <span v-else aria-label="本轮耗时">{{ timingLabel }}</span>
        </li>
        <li v-else-if="kind === 'plan' && processPlan" v-show="processExpanded" :id="`${processId}-plan`" @focusin="expansionChoice = true" @pointerdown="expansionChoice = true">
          <ChatTurnPlan :key="processPlan.identity" :plan="processPlan" />
        </li>
        <li v-else-if="item"
          :id="processKeys.has(item.identity) ? processItemId(item) : undefined"
          v-show="!processKeys.has(item.identity) || processExpanded"
          class="chat-turn-group__item"
          :class="`chat-turn-group__item--${item.presentation}`"
          :data-process-item="processKeys.has(item.identity) ? '' : undefined"
          @focusin="preserveProcessExpansion(item)"
          @pointerdown="preserveProcessExpansion(item)"
        >
          <ChatCommandItem
            v-if="item.presentation === 'command' && item.execution?.kind === 'command'"
            :item="item"
            :process-presentation="processKeys.has(item.identity)"
            :execution="item.execution"
            :approval="item.approval ?? null"
            :approval-transient="item.approval
              ? approvalTransients[item.approval.approvalRequestId] ?? null
              : null"
            :can-decide-approval="canDecideApprovals"
            :approval-authority-revision="approvalAuthorityRevision"
            @disclosure-change="forwardDisclosure"
            @approval-decision="forwardApprovalDecision"
          />

          <ChatNativeToolItem
            v-else-if="item.presentation === 'tool' && item.execution?.kind === 'tool' && 'native' in item.execution"
            :item="item"
            :process-presentation="processKeys.has(item.identity)"
            :execution="item.execution"
            @disclosure-change="forwardDisclosure"
          />
          <ChatToolItem
            v-else-if="item.presentation === 'tool' && item.execution?.kind === 'tool' && !('native' in item.execution)"
            :item="item"
            :process-presentation="processKeys.has(item.identity)"
            :execution="item.execution"
            @disclosure-change="forwardDisclosure"
          />

          <ChatTimelineItemShell
            v-else
            :item="item"
            :label="itemLabel(item)"
            :status-label="itemStatusLabel(item)"
            :icon="itemIcon(item)"
            :collapsible="item.collapsible && !processKeys.has(item.identity)"
            :process-presentation="processKeys.has(item.identity)"
            :default-expanded="item.defaultExpanded"
            @disclosure-change="forwardDisclosure"
          >
            <div
              v-if="item.presentation === 'unknown' || item.presentation === 'command' || item.presentation === 'tool'"
              class="chat-turn-group__unknown"
              role="note"
            >
              <strong>{{ item.presentation === "unknown" ? "此内容类型暂不支持" : "此执行状态暂不可用" }}</strong>
              <code>{{ item.presentation === "unknown" ? "unsupported_content" : "unsupported_execution" }}</code>
            </div>

            <p
              v-else-if="item.presentation === 'assistant_unclassified' && slots['structured-answer']"
              class="chat-turn-group__draft-note"
              role="note"
            >
              草案以校验结果为准。
            </p>

            <p
              v-if="reasoningStateMessage(item)"
              class="chat-turn-group__reasoning-state"
              role="note"
            >
              {{ reasoningStateMessage(item) }}
            </p>

            <div v-if="item.presentation === 'reasoning'" class="chat-turn-group__reasoning-segments">
              <section v-for="block in item.contentBlocks" :key="block.identity" :aria-label="block.type === 'text' && block.reasoningSource === 'summary' ? '推理摘要' : '模型推理记录'">
                <strong class="chat-turn-group__segment-label">{{ block.type === "text" && block.reasoningSource === "summary" ? "推理摘要" : "模型推理记录" }}</strong>
                <ChatSafeContent :blocks="[block]" mode="plain" />
              </section>
            </div>
            <slot v-else-if="(item.presentation === 'final_answer' || item.presentation === 'assistant_unclassified') && slots['structured-answer']" name="structured-answer" :turn-id="turn.turnId" />
            <ChatSafeContent
              v-else-if="item.presentation !== 'unknown' && item.presentation !== 'command' && item.presentation !== 'tool' && item.contentBlocks.length > 0"
              :blocks="item.contentBlocks"
              :mode="item.presentation === 'user_message' ? 'plain' : item.contentMode"
            >
              <template
                v-if="slots['artifact-reference']"
                #artifact-reference="{ block }"
              >
                <slot name="artifact-reference" :item="item" :block="block" />
              </template>
              <template
                v-if="slots['attachment-reference']"
                #attachment-reference="{ block }"
              >
                <slot name="attachment-reference" :item="item" :block="block" />
              </template>
              <template
                v-if="item.copyPolicy === 'text_and_code' && slots['code-actions']"
                #code-actions="{ codeIdentity, text, language }"
              >
                <slot
                  name="code-actions"
                  :item="item"
                  :code-identity="codeIdentity"
                  :text="text"
                  :language="language"
                />
              </template>
            </ChatSafeContent>

            <template
              v-if="!((item.presentation === 'final_answer' || item.presentation === 'assistant_unclassified') && slots['structured-answer']) && item.presentation !== 'command' && item.presentation !== 'tool' && item.copyPolicy === 'text_and_code' && slots['item-actions']"
              #actions
            >
              <slot name="item-actions" :item="item" />
            </template>
          </ChatTimelineItemShell>
        </li>
      </template>
    </ol>

    <ul v-if="turn.notices.length > 0" class="chat-turn-group__notices" aria-label="本轮通知">
      <li
        v-for="notice in turn.notices"
        :key="notice.identity"
        class="chat-turn-group__notice"
        :class="`chat-turn-group__notice--${notice.severity}`"
      >
        <div class="chat-turn-group__notice-body" role="note">
          <YjIcon
            name="warning"
            size="sm"
            :tone="notice.severity === 'error' ? 'error' : 'warning'"
          />
          <span>{{ noticeMessage(notice) }}</span>
          <code>{{ notice.code }}</code>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.chat-turn-group__process-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-1);
  padding: var(--yj-space-1) 0;
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.chat-turn-group__process-toggle:hover { color: var(--yj-color-text-primary); }
.chat-turn-group__process-toggle:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
.chat-turn-group__timing {
  padding-bottom: var(--yj-space-2);
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  font-variant-numeric: tabular-nums;
}

.chat-turn-group__reasoning-segments { display: grid; gap: var(--yj-space-3); }
.chat-turn-group__segment-label {
  display: block; margin-bottom: var(--yj-space-1);
  color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption);
}

.chat-turn-group {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-3);
  padding-block: var(--yj-space-4);
}

.chat-turn-group + .chat-turn-group {
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
}

.chat-turn-group__header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--yj-space-3);
}

.chat-turn-group__status,
.chat-turn-group__progress {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-2);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__progress {
  width: fit-content;
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-semantic-info-ink);
  background: var(--yj-color-info-soft);
}

.chat-turn-group__turn-state {
  margin: var(--yj-space-0);
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-body);
  background: var(--yj-color-warning-soft);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__items,
.chat-turn-group__notices {
  display: grid;
  min-width: 0;
  margin: var(--yj-space-0);
  padding: var(--yj-space-0);
  gap: var(--yj-space-4);
  list-style: none;
}

.chat-turn-group__item {
  min-width: 0;
}

.chat-turn-group__item--user_message {
  display: grid;
  justify-items: end;
}

.chat-turn-group__item--user_message :deep(.chat-timeline-item-shell) {
  max-width: min(100%, var(--yj-layout-chat-column-max));
}

.chat-turn-group__unknown {
  display: grid;
  gap: var(--yj-space-1);
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.chat-turn-group__draft-note,
.chat-turn-group__reasoning-state {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__reasoning-state + .chat-safe-content {
  margin-block-start: var(--yj-space-3);
}

.chat-turn-group__unknown code,
.chat-turn-group__notice code {
  width: fit-content;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__notices {
  gap: var(--yj-space-2);
}

.chat-turn-group__notice-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--yj-space-2);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-body);
  background: var(--yj-color-bg-subtle);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__notice--error .chat-turn-group__notice-body {
  border-color: var(--yj-color-error);
  background: var(--yj-color-error-soft);
}

.chat-turn-group__notice--warning .chat-turn-group__notice-body {
  border-color: var(--yj-color-warning);
  background: var(--yj-color-warning-soft);
}
</style>
