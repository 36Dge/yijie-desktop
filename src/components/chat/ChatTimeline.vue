<script setup lang="ts">
import type {
  ConversationTimelineArtifactReferenceContentBlock,
  ConversationTimelineAttachmentReferenceContentBlock,
  ConversationTimelineItemViewModel,
  ConversationTimelineNoticeViewModel,
  ConversationTimelineViewModel,
} from "../../domain/conversation-timeline";
import YjEmpty from "../yijie/YjEmpty.vue";
import YjIcon from "../yijie/YjIcon.vue";
import ChatTurnGroup from "./ChatTurnGroup.vue";
import type { ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";

defineProps<{
  timeline: ConversationTimelineViewModel;
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

function forwardDisclosure(change: ChatTimelineDisclosureChange): void {
  emit("disclosure-change", change);
}

function threadNoticeMessage(notice: ConversationTimelineNoticeViewModel): string {
  const message = notice.severity === "error"
    ? "对话发生错误，已保留可用内容。"
    : "对话连接存在需要注意的信息，已确认的内容仍可阅读。";
  return notice.count > 1 ? `${message} 共 ${notice.count} 次。` : message;
}
</script>

<template>
  <section
    class="chat-timeline"
    aria-label="对话内容"
    :aria-busy="timeline.phase === 'loading' ? 'true' : 'false'"
  >
    <p
      v-if="timeline.syncStatus === 'recovery_required'"
      class="chat-timeline__banner chat-timeline__banner--recovery"
      role="note"
    >
      对话状态需要核对，现有内容仍可阅读。
    </p>

    <ul v-if="timeline.notices.length > 0" class="chat-timeline__notices" aria-label="对话通知">
      <li
        v-for="notice in timeline.notices"
        :key="notice.identity"
        class="chat-timeline__notice"
        :class="`chat-timeline__notice--${notice.severity}`"
      >
        <div class="chat-timeline__notice-body" role="note">
          <YjIcon
            name="warning"
            size="sm"
            :tone="notice.severity === 'error' ? 'error' : 'warning'"
          />
          <span>{{ threadNoticeMessage(notice) }}</span>
          <code>{{ notice.code }}</code>
        </div>
      </li>
    </ul>

    <p
      v-if="timeline.phase === 'loading'"
      class="chat-timeline__banner"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      正在加载对话…
    </p>

    <div
      v-if="timeline.phase === 'loading' && timeline.turns.length === 0"
      class="chat-timeline__skeleton"
      aria-hidden="true"
    >
      <span class="chat-timeline__skeleton-line chat-timeline__skeleton-line--short" />
      <span class="chat-timeline__skeleton-line" />
      <span class="chat-timeline__skeleton-line chat-timeline__skeleton-line--medium" />
    </div>

    <p
      v-else-if="timeline.phase === 'unavailable'"
      class="chat-timeline__banner chat-timeline__banner--unavailable"
      role="note"
    >
      对话当前不可用，已确认的内容仍可阅读。
    </p>

    <p
      v-else-if="timeline.phase === 'archived'"
      class="chat-timeline__banner"
      role="note"
    >
      此对话已归档，内容仅供阅读。
    </p>

    <YjEmpty
      v-if="timeline.isReadyEmpty"
      title="尚无对话内容"
      description="发送消息后，对话内容会按轮次显示在这里。"
      icon="assistant"
    />

    <ol v-if="timeline.turns.length > 0" class="chat-timeline__turns">
      <li
        v-for="(turn, index) in timeline.turns"
        :key="turn.identity"
        class="chat-timeline__turn"
      >
        <ChatTurnGroup
          :turn="turn"
          :position="index + 1"
          @disclosure-change="forwardDisclosure"
        >
          <template
            v-if="slots['artifact-reference']"
            #artifact-reference="{ item, block }"
          >
            <slot name="artifact-reference" :item="item" :block="block" />
          </template>
          <template
            v-if="slots['attachment-reference']"
            #attachment-reference="{ item, block }"
          >
            <slot name="attachment-reference" :item="item" :block="block" />
          </template>
          <template v-if="slots['item-actions']" #item-actions="{ item }">
            <slot name="item-actions" :item="item" />
          </template>
          <template
            v-if="slots['code-actions']"
            #code-actions="{ item, codeIdentity, text, language }"
          >
            <slot
              name="code-actions"
              :item="item"
              :code-identity="codeIdentity"
              :text="text"
              :language="language"
            />
          </template>
        </ChatTurnGroup>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.chat-timeline {
  display: grid;
  width: min(100%, var(--yj-layout-chat-column-max));
  min-width: 0;
  margin-inline: auto;
  gap: var(--yj-space-4);
}

.chat-timeline__banner {
  margin: var(--yj-space-0);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-subtle);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-timeline__banner--recovery {
  border-color: var(--yj-color-warning);
  background: var(--yj-color-warning-soft);
}

.chat-timeline__banner--unavailable {
  border-color: var(--yj-color-error);
  background: var(--yj-color-error-soft);
}

.chat-timeline__notices {
  display: grid;
  min-width: 0;
  margin: var(--yj-space-0);
  padding: var(--yj-space-0);
  gap: var(--yj-space-2);
  list-style: none;
}

.chat-timeline__notice-body {
  display: grid;
  min-width: 0;
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

.chat-timeline__notice-body code {
  color: var(--yj-color-text-tertiary);
  overflow-wrap: anywhere;
}

.chat-timeline__notice--error .chat-timeline__notice-body {
  border-color: var(--yj-color-error);
  background: var(--yj-color-error-soft);
}

.chat-timeline__notice--warning .chat-timeline__notice-body {
  border-color: var(--yj-color-warning);
  background: var(--yj-color-warning-soft);
}

.chat-timeline__skeleton {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-3);
  padding: var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-subtle);
}

.chat-timeline__skeleton-line {
  width: 100%;
  height: var(--yj-space-3);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-border-subtle);
}

.chat-timeline__skeleton-line--short {
  width: 32%;
}

.chat-timeline__skeleton-line--medium {
  width: 68%;
}

.chat-timeline__turns {
  display: grid;
  min-width: 0;
  margin: var(--yj-space-0);
  padding: var(--yj-space-0);
  list-style: none;
}

.chat-timeline__turn {
  min-width: 0;
}

.chat-timeline__turn + .chat-timeline__turn {
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
}

@media (max-width: 40rem) {
  .chat-timeline__notice-body {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .chat-timeline__notice-body code {
    grid-column: 2;
  }
}
</style>
