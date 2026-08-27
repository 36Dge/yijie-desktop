<script setup lang="ts">
import type {
  ConversationTimelineArtifactReferenceContentBlock,
  ConversationTimelineAttachmentReferenceContentBlock,
  ConversationTimelineItemViewModel,
  ConversationTimelineViewModel,
} from "../../domain/conversation-timeline";
import YjEmpty from "../yijie/YjEmpty.vue";
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
}>();

function forwardDisclosure(change: ChatTimelineDisclosureChange): void {
  emit("disclosure-change", change);
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

    <p
      v-if="timeline.phase === 'loading'"
      class="chat-timeline__banner"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      正在加载对话…
    </p>

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
</style>
