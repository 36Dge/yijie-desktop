<script setup lang="ts">
import type { ConversationTurnOutput } from "../../domain/conversation-turn-output";
import type { ConversationTimelineTurnViewModel } from "../../domain/conversation-timeline";
import { showConversationItemActions } from "../../domain/conversation-process";
import ChatActivityRow from "./ChatActivityRow.vue";

defineProps<{ output: ConversationTurnOutput; turn: ConversationTimelineTurnViewModel }>();
const slots = defineSlots<InstanceType<typeof ChatActivityRow>["$slots"]>();
</script>

<template>
  <section class="chat-turn-output" :aria-label="output.answer ? '模型回答与生成内容' : '生成内容'">
    <div class="chat-turn-output__body">
      <ChatActivityRow v-if="output.answer" :item="output.answer.item" :turn="turn" :answer-candidate="output.answer.answerCandidate">
        <template v-if="slots['structured-answer']" #structured-answer="scope"><slot name="structured-answer" v-bind="scope" /></template>
        <template v-if="slots['artifact-reference']" #artifact-reference="scope"><slot name="artifact-reference" v-bind="scope" /></template>
        <template v-if="slots['attachment-reference']" #attachment-reference="scope"><slot name="attachment-reference" v-bind="scope" /></template>
        <template v-if="slots['code-actions']" #code-actions="scope"><slot name="code-actions" v-bind="scope" /></template>
      </ChatActivityRow>
      <div class="chat-turn-output__artifacts">
        <ChatActivityRow v-for="node in output.artifacts" :key="node.identity" :item="node.item" :turn="turn">
          <template v-if="slots['artifact-reference']" #artifact-reference="scope"><slot name="artifact-reference" v-bind="scope" /></template>
          <template v-if="slots['attachment-reference']" #attachment-reference="scope"><slot name="attachment-reference" v-bind="scope" /></template>
          <template v-if="slots['item-actions']" #item-actions="scope"><slot name="item-actions" v-bind="scope" /></template>
          <template v-if="slots['code-actions']" #code-actions="scope"><slot name="code-actions" v-bind="scope" /></template>
        </ChatActivityRow>
      </div>
    </div>
    <div v-if="output.answer && slots['item-actions'] && showConversationItemActions(output.answer.item, turn, false, Boolean(slots['structured-answer']))"
      class="chat-turn-output__actions" role="group" aria-label="模型回答操作">
      <slot name="item-actions" :item="output.answer.item" />
    </div>
  </section>
</template>

<style scoped>
.chat-turn-output, .chat-turn-output__body, .chat-turn-output__artifacts { min-width: 0; }
.chat-turn-output__body, .chat-turn-output__artifacts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--yj-space-3);
}
.chat-turn-output__actions {
  display: flex;
  align-items: center;
  gap: var(--yj-space-1);
  margin-block-start: var(--yj-space-3);
}
.chat-turn-output__actions :deep(:focus-visible) {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
</style>
