<script setup lang="ts">
import { useId } from "vue";
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
import ChatSafeContent from "./ChatSafeContent.vue";
import ChatTimelineItemShell, {
  type ChatTimelineDisclosureChange,
} from "./ChatTimelineItemShell.vue";

const PROCESS_COLLAPSE_THRESHOLD = 320;

defineProps<{
  turn: ConversationTimelineTurnViewModel;
  position: number;
}>();

const emit = defineEmits<{
  "disclosure-change": [change: ChatTimelineDisclosureChange];
}>();

const slots = defineSlots<{
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

const headingId = `${useId()}-heading`;

function itemLabel(item: ConversationTimelineItemViewModel): string {
  switch (item.kind) {
    case "user_message":
      return "用户消息";
    case "assistant_message":
      return "模型回答";
    case "artifact":
      return "生成内容";
    case "reasoning":
      return "过程记录";
    case "unknown":
    default:
      return "未知内容";
  }
}

function itemIcon(item: ConversationTimelineItemViewModel): YjIconName {
  switch (item.kind) {
    case "user_message":
      return "user";
    case "assistant_message":
      return "assistant";
    case "artifact":
      return "file";
    case "reasoning":
      return "pending";
    case "unknown":
    default:
      return "warning";
  }
}

function itemStatusLabel(item: ConversationTimelineItemViewModel): string {
  switch (item.domainStatus) {
    case "started":
      return "已开始";
    case "streaming":
      return "进行中";
    case "completed":
      return "已完成";
  }
}

function turnStatusLabel(turn: ConversationTimelineTurnViewModel): string {
  switch (turn.domainStatus) {
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

function processTextLength(item: ConversationTimelineItemViewModel): number {
  return item.contentBlocks.reduce((total, block) => {
    if (block.type === "text" || block.type === "code") return total + block.text.length;
    return total;
  }, 0);
}

function processDefaultExpanded(item: ConversationTimelineItemViewModel): boolean {
  return item.kind !== "reasoning" || processTextLength(item) <= PROCESS_COLLAPSE_THRESHOLD;
}

function forwardDisclosure(change: ChatTimelineDisclosureChange): void {
  emit("disclosure-change", change);
}
</script>

<template>
  <section
    class="chat-turn-group"
    :class="`chat-turn-group--${turn.phase}`"
    :aria-labelledby="headingId"
  >
    <header class="chat-turn-group__header">
      <h2 :id="headingId">第 {{ position }} 轮</h2>
      <span class="chat-turn-group__status">
        <YjIcon
          :name="turnStatusIcon(turn)"
          size="sm"
          :tone="turn.phase === 'failed' || turn.phase === 'recovery_required' ? 'warning' : 'muted'"
        />
        {{ turnStatusLabel(turn) }}
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

    <ol v-if="turn.items.length > 0" class="chat-turn-group__items" aria-label="本轮对话内容">
      <li
        v-for="item in turn.items"
        :key="item.identity"
        class="chat-turn-group__item"
        :class="`chat-turn-group__item--${item.kind}`"
      >
        <ChatTimelineItemShell
          :item="item"
          :label="itemLabel(item)"
          :status-label="itemStatusLabel(item)"
          :icon="itemIcon(item)"
          :collapsible="item.kind === 'reasoning'"
          :default-expanded="processDefaultExpanded(item)"
          @disclosure-change="forwardDisclosure"
        >
          <div v-if="item.kind === 'unknown'" class="chat-turn-group__unknown" role="note">
            <strong>此内容类型暂不支持</strong>
            <code>unsupported_content</code>
          </div>

          <p
            v-else-if="item.kind === 'reasoning' && item.domainStatus === 'completed' && item.contentBlocks.length === 0"
            class="chat-turn-group__metadata-only"
            role="note"
          >
            此过程仅包含状态元数据；详情未进入当前对话投影。
          </p>

          <ChatSafeContent
            v-else
            :blocks="item.contentBlocks"
            :mode="item.kind === 'reasoning' ? 'plain' : 'rich'"
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
              v-if="slots['code-actions']"
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

          <template v-if="slots['item-actions']" #actions>
            <slot name="item-actions" :item="item" />
          </template>
        </ChatTimelineItemShell>
      </li>
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
  justify-content: space-between;
  gap: var(--yj-space-3);
}

.chat-turn-group__header h2 {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-caption);
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
  color: var(--yj-color-brand-text);
  background: var(--yj-color-brand-soft);
}

.chat-turn-group__turn-state {
  margin: var(--yj-space-0);
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-secondary);
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
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.chat-turn-group__metadata-only {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-secondary);
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
  color: var(--yj-color-text-secondary);
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
