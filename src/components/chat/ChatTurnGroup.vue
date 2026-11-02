<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { webSearchOccurrences } from "../../domain/web-search-presentation";
import { activeReasoningIdentity, executionProgressDescriptions, hasReadableProcessContent, isCollapsibleProcessItem, nativeWaitingDescription, observedProgressMessages, processDetailItems, showProcessItem } from "../../domain/conversation-process";
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
import { presentSkillMessage, type SelectedChatSkill } from "../../domain/chat-skills";
import ChatSkillPill from "./ChatSkillPill.vue";
import ChatSafeContent from "./ChatSafeContent.vue";
import ChatArchiveActivityDetails from "./ChatArchiveActivityDetails.vue";
import ChatExecutionProgress from "./ChatExecutionProgress.vue";
import ChatThinkingIndicator from "./ChatThinkingIndicator.vue";
import ChatDeepThinking from "./ChatDeepThinking.vue";
import ChatToolItem from "./ChatToolItem.vue";
import ChatNativeToolItem from "./ChatNativeToolItem.vue";
import ChatWebSearchItem from "./ChatWebSearchItem.vue";
import ChatTurnPlan from "./ChatTurnPlan.vue";
import ChatTimelineItemShell, {
  type ChatTimelineDisclosureChange,
} from "./ChatTimelineItemShell.vue";

const props = withDefaults(defineProps<{
  turn: ConversationTimelineTurnViewModel;
  position: number;
  timingLabel?: string | null;
  skillCatalog?: readonly SelectedChatSkill[];
  connectorNames?: readonly string[];
  canDecideApprovals?: boolean;
  approvalAuthorityRevision?: number;
  approvalTransients?: Readonly<Record<string, ChatApprovalTransientState | undefined>>;
}>(), {
  timingLabel: null,
  skillCatalog: () => Object.freeze([]),
  connectorNames: () => Object.freeze([]),
  canDecideApprovals: false,
  approvalAuthorityRevision: 0,
  approvalTransients: () => Object.freeze({}),
});

const processId = `${useId()}-process`;
const displayItems = computed(() => props.turn.items.filter(item => showProcessItem(item, props.turn)));
const searchOccurrences = computed(() => webSearchOccurrences(props.turn.items));
const firstUserMessage = computed(() => props.turn.items.find(item => item.presentation === "user_message")?.identity);
const skillMessages = computed(() => new Map(props.turn.items
  .filter(item => item.role === "user" && item.presentation === "user_message")
  .map(item => [item.identity, presentSkillMessage(item.contentBlocks, props.skillCatalog)])));
const expansionChoice = ref<boolean | null>(null);
const observedProgressKeys = computed(() => slots["structured-answer"] || props.turn.source !== "native_observed"
  ? new Set<string>() : observedProgressMessages(props.turn.items, !["queued", "in_progress", "waiting_approval"].includes(props.turn.domainStatus)));
const processItems = computed(() => displayItems.value.filter(item =>
  isCollapsibleProcessItem(item, observedProgressKeys.value.has(item.identity)) && (!item.approval ||
    !["submitting", "reconciling", "error"].includes(props.approvalTransients[item.approval.approvalRequestId]?.phase ?? "idle"))));
const processKeys = computed(() => new Set(processItems.value.map(item => item.identity)));
const detailKeys = computed(() => processDetailItems(processItems.value));
const executionDescriptions = computed(() => {
  if (slots["structured-answer"]) return new Map();
  const webKeys = new Set(props.turn.items.filter(item => item.presentation === "web_search").map(item => item.identity));
  return new Map([...executionProgressDescriptions(props.turn, processKeys.value, detailKeys.value)]
    .filter(([identity]) => !webKeys.has(identity)));
});
const processPlan = computed(() => props.turn.plan && !props.turn.plan.steps.some(step => step.status === "unknown") ? props.turn.plan : null);
const hasProcess = computed(() => processItems.value.length > 0 || processPlan.value !== null);
const answerStarted = computed(() => props.turn.items.some(item =>
  !processKeys.value.has(item.identity) && (item.presentation === "final_answer" ||
    (item.presentation === "assistant_unclassified" && ["completed", "failed", "interrupted"].includes(props.turn.domainStatus))) &&
  item.contentBlocks.some(block => (block.type === "text" || block.type === "code") && block.text.trim().length > 0)));
const processExpanded = computed(() => expansionChoice.value ??
  (props.turn.liveObserved === true && ["in_progress", "waiting_approval"].includes(props.turn.domainStatus) && !answerStarted.value));
const nativeLiveProgress = computed(() => props.turn.source === "native_observed" &&
  props.turn.statusSource === "runtime_notification" && props.turn.liveObserved && props.turn.progress !== null);
// An empty started Item is metadata, not the first streamed content. Reasoning
// counts as output even when its details are folded in the reading layout.
const hasOutput = computed(() => props.turn.plan !== null || props.turn.items.some(item =>
  item.presentation !== "user_message" && (
    item.approval != null || Boolean(item.activityLabel) || item.availability === "unavailable" ||
    !["reasoning", "commentary", "final_answer", "assistant_unclassified"].includes(item.presentation) ||
    item.contentBlocks.some(block => block.type === "text" || block.type === "code"
      ? block.text.trim().length > 0 : true))));
const outputObserved = ref(false);
watch(() => [props.turn.identity, hasOutput.value] as const, ([identity, output], previous) => {
  outputObserved.value = previous?.[0] === identity ? outputObserved.value || output : output;
}, { immediate: true, flush: "sync" });
const preloading = computed(() => nativeLiveProgress.value && props.turn.domainStatus === "in_progress" && !outputObserved.value);
const awaitingMoreOutput = computed(() => {
  if (!nativeLiveProgress.value || props.turn.domainStatus !== "in_progress") return false;
  if (props.turn.items.some(item => item.approval?.status === "pending" ||
    (item.busy && ["command", "tool", "web_search"].includes(item.presentation)))) return false;
  const latest = [...props.turn.items].reverse().find(item => item.presentation !== "user_message");
  if (latest?.kind === "assistant_message" && latest.contentBlocks.some(block =>
    (block.type === "text" || block.type === "code") && block.text.length > 0)) {
    return (latest.presentation === "commentary" || observedProgressKeys.value.has(latest.identity)) && latest.domainStatus === "completed";
  }
  return !answerStarted.value || latest?.presentation === "reasoning" && latest.busy === true;
});
const localSubmissionTerminal = computed(() => props.turn.source === "local_submission" &&
  ["failed", "cancelled"].includes(props.turn.submissionStatus ?? ""));
const showProgress = computed(() => !preloading.value && !localSubmissionTerminal.value && props.turn.progress && (!nativeLiveProgress.value ||
  props.turn.domainStatus !== "in_progress" || awaitingMoreOutput.value));
const processItemId = (item: ConversationTimelineItemViewModel) => `${processId}-${encodeURIComponent(item.identity)}`;
const processControls = computed(() => [...(processPlan.value ? [`${processId}-plan`] : []), ...processItems.value.map(processItemId),
  ...[...executionDescriptions.value.keys()].map(identity => `${processId}-execution-${encodeURIComponent(identity)}`)].join(" "));
watch(() => props.turn.identity, () => { expansionChoice.value = null; });
function toggleProcess() {
  expansionChoice.value = !processExpanded.value;
  emit("disclosure-change", { itemIdentity: props.turn.identity, expanded: processExpanded.value });
}
function preserveProcessExpansion(item: ConversationTimelineItemViewModel) {
  if (processKeys.value.has(item.identity) && processExpanded.value) expansionChoice.value = true;
}

const turnEntries = computed(() => {
  const entries: { kind: "item" | "timing" | "plan" | "execution"; identity: string; item: ConversationTimelineItemViewModel | null }[] =
    displayItems.value.flatMap(item => executionDescriptions.value.has(item.identity)
      ? [{kind: "execution" as const, identity: `${item.identity}:execution`, item}, {kind: "item" as const, identity: item.identity, item}]
      : [{kind: "item" as const, identity: item.identity, item}]);
  const firstOutput = entries.findIndex(entry => entry.item?.presentation !== "user_message");
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
  if (observedProgressKeys.value.has(item.identity)) return "模型消息";
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
      return "深度思考";
    case "command":
      return "命令执行";
    case "tool":
      return "工具调用";
    case "web_search":
      return "网页活动";
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
    case "web_search":
      return "skillCrossBorderSelection";
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
  if (turn.diagnostic === "native_format_unsupported") return "历史记录暂不可读";
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
  if (turn.source === "local_submission" && turn.submissionStatus === "failed") return "warning";
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
  if (props.turn.source === "local_submission" && props.turn.submissionStatus === "uncertain") {
    return "原提交结果尚未确认，请先核对原操作，勿重复发送。";
  }
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
  if (turn.diagnostic === "native_format_unsupported") return "这条历史由较新版本保存，请使用兼容版本查看。原记录已保留，不会重新提交。";
  if (turn.source === "local_submission") {
    if (turn.submissionStatus === "failed") return "本次提交未成功，原消息已保留。";
    if (turn.submissionStatus === "cancelled") return "本次提交已取消，原消息已保留。";
  }
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
  const hasContent = hasReadableProcessContent(item);
  if (item.busy && !hasContent) return null;
  if (item.reasoning === null) {
    if (item.domainStatus === "incomplete") return "模型推理记录未完整结束，已保留可用内容。";
    if (item.domainStatus === "started" || item.domainStatus === "streaming") {
      return hasContent ? null : "正在等待过程记录…";
    }
    return hasContent ? null : "此过程仅包含状态元数据；详情未进入当前对话投影。";
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
  if (processKeys.value.has(change.itemIdentity) && processExpanded.value) expansionChoice.value = true;
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
    <header v-if="turn.diagnostic === 'native_format_unsupported' || (turn.domainStatus !== 'completed' && !nativeLiveProgress)" class="chat-turn-group__header">
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

    <p v-if="turnStateMessage(turn)" class="chat-turn-group__turn-state" role="note">
      {{ turnStateMessage(turn) }}
    </p>

    <slot v-if="turn.source === 'legacy_archive'" name="legacy-records" :turn-id="turn.turnId" />
    <ChatTurnPlan v-if="turn.plan && !processPlan" :key="turn.plan.identity" :plan="turn.plan" />

    <ol v-if="turn.items.length > 0 || timingLabel || hasProcess || preloading" class="chat-turn-group__items" aria-label="本轮对话内容">
      <template v-for="{ item, kind, identity } in turnEntries" :key="identity">
        <li v-if="kind === 'timing' && (timingLabel || hasProcess || preloading)" class="chat-turn-group__timing"
          :class="{ 'chat-turn-group__timing--preloading': preloading }">
          <Transition name="chat-turn-status" mode="out-in">
            <span v-if="preloading" key="thinking" class="chat-turn-group__thinking" role="status" aria-live="polite">
              <ChatThinkingIndicator />
            </span>
            <button v-else-if="hasProcess" key="process" class="chat-turn-group__process-toggle" type="button"
              :aria-label="`${timingLabel || '处理过程'}，${processExpanded ? '收起' : '展开'}本轮处理过程`"
              :aria-expanded="processExpanded" :aria-controls="processControls" @click="toggleProcess">
              <span>{{ timingLabel || '处理过程' }}</span>
              <YjIcon class="chat-turn-group__process-chevron" :name="processExpanded ? 'chevronDown' : 'chevronRight'"
                size="xs" :stroke-width="1.5" tone="muted" />
            </button>
            <span v-else key="timing" aria-label="本轮耗时">{{ timingLabel }}</span>
          </Transition>
        </li>
        <li v-else-if="kind === 'plan' && processPlan" v-show="processExpanded" :id="`${processId}-plan`" @focusin="expansionChoice = true" @pointerdown="expansionChoice = true">
          <ChatTurnPlan :key="processPlan.identity" :plan="processPlan" />
        </li>
        <li v-else-if="kind === 'execution' && item" v-show="processExpanded"
          :id="`${processId}-execution-${encodeURIComponent(item.identity)}`" class="chat-turn-group__execution-description">
          <ChatExecutionProgress :text="executionDescriptions.get(item.identity)!.text" />
        </li>
        <li v-else-if="item"
          :id="processKeys.has(item.identity) ? processItemId(item) : undefined"
          v-show="item.presentation === 'user_message' || (!preloading && (!processKeys.has(item.identity) || processExpanded))"
          class="chat-turn-group__item"
          :class="`chat-turn-group__item--${item.presentation}`"
          :data-process-item="processKeys.has(item.identity) ? '' : undefined"
          @focusin="preserveProcessExpansion(item)"
          @pointerdown="preserveProcessExpansion(item)"
        >
          <p v-if="item.presentation === 'commentary'"
            class="chat-turn-group__progress-source" data-progress-source="model">模型进度</p>
          <p v-else-if="observedProgressKeys.has(item.identity)"
            class="chat-turn-group__progress-source" data-message-source="model">模型消息</p>
          <ChatArchiveActivityDetails v-if="item.archiveV5?.type === 'fileChange'" :item="item.archiveV5" />
          <ChatDeepThinking v-else-if="item.presentation === 'reasoning'" :item="item"
            :visible="!preloading && (!processKeys.has(item.identity) || processExpanded)"
            :live="turn.liveObserved === true && item.busy === true" :state-message="reasoningStateMessage(item)"
            :thinking="activeReasoningIdentity(turn) === item.identity"
            @disclosure-change="forwardDisclosure" />
          <ChatWebSearchItem v-else-if="item.presentation === 'web_search'" :item="item"
            :search-occurrence="searchOccurrences.get(item.identity) ?? 1" :process-presentation="processKeys.has(item.identity)" @disclosure-change="forwardDisclosure" />
          <ChatCommandItem
            v-else-if="item.presentation === 'command' && item.execution?.kind === 'command'"
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

            <slot v-if="(item.presentation === 'final_answer' || item.presentation === 'assistant_unclassified') && slots['structured-answer']" name="structured-answer" :turn-id="turn.turnId" />
            <ChatSafeContent
              v-else-if="item.presentation !== 'unknown' && item.presentation !== 'command' && item.presentation !== 'tool' && item.contentBlocks.length > 0"
              :blocks="skillMessages.get(item.identity)?.blocks ?? item.contentBlocks"
              :link-target="item.kind === 'assistant_message' ? {sessionId: item.threadId, turnId: item.turnId, itemId: item.itemId} : undefined"
              :mode="item.presentation === 'user_message' ? 'plain' : item.contentMode"
              :streaming="item.kind === 'assistant_message' && item.busy === true && (!processKeys.has(item.identity) || processExpanded)"
              :animate="(!processKeys.has(item.identity) || processExpanded) && !['failed', 'interrupted'].includes(turn.domainStatus)"
            >
              <template v-if="(item.identity === firstUserMessage && connectorNames.length) || skillMessages.get(item.identity)?.skills.length" #text-prefix>
                <span v-if="item.identity === firstUserMessage && connectorNames.length" aria-label="本轮连接器"><span v-for="(name, index) in connectorNames" :key="index" class="chat-turn-group__connector-mention">/ {{ name }}</span></span>
                <span v-if="skillMessages.get(item.identity)?.skills.length" aria-label="本轮技能"><ChatSkillPill v-for="skill in skillMessages.get(item.identity)!.skills" :key="skill.id" :entry="skill" class="chat-turn-group__skill-mention" /></span>
              </template>
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
              v-if="!((item.presentation === 'final_answer' || item.presentation === 'assistant_unclassified') && slots['structured-answer']) && item.presentation !== 'command' && item.presentation !== 'tool' && item.copyPolicy === 'text_and_code' && (item.kind !== 'assistant_message' || item.domainStatus === 'completed') && slots['item-actions']"
              #actions
            >
              <slot name="item-actions" :item="item" />
            </template>
          </ChatTimelineItemShell>
          <ChatArchiveActivityDetails v-if="item.archiveV5 && item.archiveV5.type !== 'fileChange'" :item="item.archiveV5" />
        </li>
      </template>
    </ol>

    <div v-if="showProgress && turn.progress && turn.diagnostic !== 'native_format_unsupported'" class="chat-turn-group__progress" role="status" aria-live="polite" aria-atomic="true">
      <ChatExecutionProgress v-if="awaitingMoreOutput" :text="nativeWaitingDescription(turn)" />
      <span v-else>{{ progressLabel(turn.progress) }}</span>
    </div>

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
.chat-turn-group__skill-mention { margin-inline-end: var(--yj-space-2); }
.chat-turn-group__connector-mention { color: var(--yj-color-connector-mention); margin-inline-end: var(--yj-space-2); overflow-wrap: anywhere; }
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
  min-height: calc(var(--yj-line-height-body) + var(--yj-space-2));
  /* Tighten only the space after the timing row, keeping the button's hit area. */
  margin-block-end: calc(-1 * var(--yj-space-1));
  color: var(--yj-color-chat-timing);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  font-variant-numeric: tabular-nums;
}
.chat-turn-group__timing .chat-turn-group__process-chevron { color: inherit; }
.chat-turn-group__thinking { display: inline-block; padding-block: var(--yj-space-1); }
.chat-turn-status-enter-active,
.chat-turn-status-leave-active { transition: opacity var(--yj-motion-fast) var(--yj-ease-standard); }
.chat-turn-status-enter-from,
.chat-turn-status-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .chat-turn-status-enter-active,
  .chat-turn-status-leave-active { transition: none; }
}

.chat-turn-group__progress-source { margin: 0 0 var(--yj-space-1); color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }

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
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
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

.chat-turn-group__draft-note {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
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

<style scoped>
/* Compact adjacent search entries without changing other process spacing. */
.chat-turn-group__item--web_search + .chat-turn-group__item--web_search {
  margin-block-start: calc(-1 * var(--yj-space-3));
}
</style>
