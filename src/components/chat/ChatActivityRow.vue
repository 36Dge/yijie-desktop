<script setup lang="ts">
import { computed } from "vue";
import type { ConversationActivityEntry } from "../../domain/conversation-activity-entry";
import { hasReadableProcessContent, showConversationItemActions } from "../../domain/conversation-process";
import type {
  ConversationTimelineArtifactReferenceContentBlock,
  ConversationTimelineAttachmentReferenceContentBlock,
  ConversationTimelineItemViewModel,
  ConversationTimelineTurnViewModel,
} from "../../domain/conversation-timeline";
import type { YjIconName } from "../../icons/registry";
import ChatCommandItem, {
  type ChatApprovalDecisionChange,
  type ChatApprovalTransientState,
} from "./ChatCommandItem.vue";
import { presentSkillMessage, type SelectedChatSkill } from "../../domain/chat-skills";
import ChatSkillPill from "./ChatSkillPill.vue";
import ChatSafeContent from "./ChatSafeContent.vue";
import ChatDeepThinking from "./ChatDeepThinking.vue";
import ChatContextUpdate from "./ChatContextUpdate.vue";
import ChatToolItem from "./ChatToolItem.vue";
import ChatNativeToolItem from "./ChatNativeToolItem.vue";
import ChatWebSearchItem from "./ChatWebSearchItem.vue";
import ChatTimelineItemShell, {
  type ChatTimelineDisclosureChange,
} from "./ChatTimelineItemShell.vue";


const props = withDefaults(defineProps<{
  item: ConversationTimelineItemViewModel;
  activityEntry?: ConversationActivityEntry;
  answerCandidate?: boolean;
  turn: ConversationTimelineTurnViewModel;
  processPresentation?: boolean;
  visible?: boolean;
  skillCatalog?: readonly SelectedChatSkill[];
  connectorNames?: readonly string[];
  canDecideApprovals?: boolean;
  approvalAuthorityRevision?: number;
  approvalTransients?: Readonly<Record<string, ChatApprovalTransientState | undefined>>;
}>(), {processPresentation: false, visible: true, skillCatalog: () => [], connectorNames: () => [], canDecideApprovals: false, approvalAuthorityRevision: 0, approvalTransients: () => ({})});
const firstUserMessage = computed(() => props.turn.items.find(item => item.presentation === "user_message")?.identity);
const skillMessages = computed(() => new Map(props.turn.items.filter(item => item.role === "user").map(item => [item.identity, presentSkillMessage(item.contentBlocks, props.skillCatalog)])));
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
  if (props.processPresentation && item.presentation === "assistant_unclassified") return "模型消息";
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


function forwardDisclosure(change: ChatTimelineDisclosureChange) { emit("disclosure-change", change); }
function forwardApprovalDecision(change: ChatApprovalDecisionChange) { emit("approval-decision", change); }
</script>
<template>
          <ChatContextUpdate v-if="item.presentation === 'context_update'" :state="item.contextUpdateState ?? 'unknown'" />
          <ChatDeepThinking v-else-if="item.presentation === 'reasoning'" :item="item"
            :visible="visible"
            :live="visible && turn.liveObserved === true && item.busy === true" :state-message="reasoningStateMessage(item)"
            :thinking="false"
            @disclosure-change="forwardDisclosure" />
          <ChatWebSearchItem v-else-if="item.presentation === 'web_search'" :item="item"
            :search-occurrence="1" :process-presentation="processPresentation" @disclosure-change="forwardDisclosure" />
          <ChatCommandItem
            v-else-if="item.presentation === 'command' && item.execution?.kind === 'command'"
            :item="item"
            :activity-entry="activityEntry"
            :process-presentation="processPresentation"
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
            :process-presentation="processPresentation"
            :execution="item.execution"
            @disclosure-change="forwardDisclosure"
          />
          <ChatToolItem
            v-else-if="item.presentation === 'tool' && item.execution?.kind === 'tool' && !('native' in item.execution)"
            :item="item"
            :process-presentation="processPresentation"
            :execution="item.execution"
            @disclosure-change="forwardDisclosure"
          />

          <ChatTimelineItemShell
            v-else
            :item="item"
            :label="answerCandidate ? '模型消息' : itemLabel(item)"
            :answer-candidate="answerCandidate"
            :status-label="itemStatusLabel(item)"
            :icon="itemIcon(item)"
            :collapsible="item.collapsible && !processPresentation && !answerCandidate"
            :process-presentation="processPresentation"
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
              :file-links="item.kind === 'assistant_message'"
              :link-target="item.kind === 'assistant_message' ? {sessionId: item.threadId, turnId: item.turnId, itemId: item.itemId} : undefined"
              :mode="item.presentation === 'user_message' ? 'plain' : item.contentMode"
              :typography="!processPresentation && (answerCandidate || ['final_answer', 'assistant_unclassified'].includes(item.presentation)) ? 'answer' : 'compact'"
              :streaming="item.kind === 'assistant_message' && item.busy === true && visible"
              :animate="visible && !['failed', 'interrupted'].includes(turn.domainStatus)"
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
              v-if="showConversationItemActions(item, turn, processPresentation, Boolean(slots['structured-answer'])) && slots['item-actions']"
              #actions
            >
              <slot name="item-actions" :item="item" />
            </template>
          </ChatTimelineItemShell>
</template>
<style scoped>
.chat-turn-group__skill-mention { margin-inline-end: var(--yj-space-2); }
.chat-turn-group__connector-mention { color: var(--yj-color-connector-mention); margin-inline-end: var(--yj-space-2); overflow-wrap: anywhere; }
.chat-turn-group__unknown, .chat-turn-group__draft-note { color: var(--yj-color-text-secondary); }
</style>
