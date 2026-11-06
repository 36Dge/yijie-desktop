<script setup lang="ts">
import YjTooltip from "../yijie/YjTooltip.vue";
import { computed, nextTick, ref, useId, watch } from "vue";
import { NButton, NPopover } from "naive-ui";
import type { ChatClipboardAdapter } from "../../api/chat-clipboard-adapter";
import { answerCompletionTime, answerFeedbackReasons, answerModelBadge, type AnswerFeedbackReason, type AnswerVote } from "../../domain/chat-answer-actions";
import ChatCopyAction from "./ChatCopyAction.vue";
import ChatActionButton from "./ChatActionButton.vue";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{identity: string; text: string; adapter: ChatClipboardAdapter; modelProfileId?: string | null; completedAt?: number | null}>();
// Presentation state only: no API, store, persistence, telemetry or model input.
const vote = ref<AnswerVote>(null), feedbackOpen = ref(false);
const reasons = ref<readonly AnswerFeedbackReason[]>([]), draft = ref<readonly AnswerFeedbackReason[]>([]);
const announcement = ref(""); const clock = ref(Date.now());
const panel = ref<HTMLElement | null>(null), dislikeButton = ref<InstanceType<typeof ChatActionButton> | null>(null);
const feedbackId = `${useId()}-answer-feedback`;
const model = computed(() => answerModelBadge(props.modelProfileId));
const completed = computed(() => answerCompletionTime(props.completedAt, clock.value));
function close(restoreFocus = false) {
  const identity = props.identity;
  feedbackOpen.value = false; draft.value = [];
  if (restoreFocus) void nextTick(() => { if (props.identity === identity) dislikeButton.value?.focus(); });
}
function like() {
  close(); vote.value = vote.value === "like" ? null : "like"; reasons.value = [];
  announcement.value = vote.value ? "已点赞。" : "已取消点赞。";
}
async function dislike() {
  if (feedbackOpen.value) { close(); return; }
  if (vote.value === "dislike") { vote.value = null; reasons.value = []; announcement.value = "已取消点踩。"; return; }
  draft.value = []; feedbackOpen.value = true;
  await nextTick(); panel.value?.querySelector<HTMLButtonElement>('[role="checkbox"]')?.focus();
}
function toggleReason(reason: AnswerFeedbackReason) {
  draft.value = draft.value.includes(reason) ? draft.value.filter(value => value !== reason) : [...draft.value, reason];
}
function confirm() {
  if (!draft.value.length) return;
  reasons.value = [...draft.value]; vote.value = "dislike"; announcement.value = "已标记点踩。评价不会影响模型。";
  close(true);
}
function panelKey(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
  if (event.key !== "Tab") return;
  const buttons = [...(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  const first = buttons[0], last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
  else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
}
watch(() => [props.identity, props.text], () => { close(); vote.value = null; reasons.value = []; announcement.value = ""; });
</script>

<template>
  <div class="chat-answer-actions" :class="{'is-feedback-open': feedbackOpen}" role="group" aria-label="回答操作"
    @mouseenter="clock=Date.now()" @focusin="clock=Date.now()">
    <ChatCopyAction :adapter="adapter" :text="text" compact />
    <ChatActionButton label="点赞" icon="thumbsUp" :pressed="vote === 'like'" @click="like" />
    <NPopover :show="feedbackOpen" trigger="manual" placement="top-start" :show-arrow="false"
      :style="{width:'min(var(--yj-layout-chat-feedback-width), calc(100vw - 2 * var(--yj-space-4)))',padding:'var(--yj-space-4)',zoom:'var(--yj-ui-scale, 1)'}"
      @clickoutside="close()">
      <template #trigger><span class="chat-answer-actions__trigger">
        <ChatActionButton ref="dislikeButton" label="点踩" icon="thumbsDown" :pressed="vote === 'dislike'"
          :expanded="feedbackOpen" :controls="feedbackId" :tooltip-disabled="feedbackOpen" @click="dislike" />
      </span></template>
      <section :id="feedbackId" ref="panel" class="chat-answer-feedback" role="dialog" :aria-labelledby="`${feedbackId}-title`" @keydown="panelKey">
        <header><strong :id="`${feedbackId}-title`">请选择不满意的原因</strong><ChatActionButton label="关闭" icon="dismiss" @click="close(true)" /></header>
        <div class="chat-answer-feedback__reasons" role="group" aria-label="可多选的不满意原因">
          <button v-for="reason in answerFeedbackReasons" :key="reason" type="button" role="checkbox" :aria-checked="draft.includes(reason)"
            class="chat-answer-feedback__reason" @click="toggleReason(reason)">{{ reason }}</button>
        </div>
        <p>仅标记这条回答，不会影响模型。</p>
        <NButton type="primary" attr-type="button" block size="small" :disabled="!draft.length" @click="confirm">确认反馈</NButton>
      </section>
    </NPopover>
    <span class="chat-answer-actions__metadata">
      <span class="chat-answer-actions__model" aria-label="本轮使用的模型"><span class="chat-answer-actions__brand" :class="{'is-kimi': model.icon === 'modelKimi'}"><YjIcon :name="model.icon" size="sm" :stroke-width="1.5" /></span><span>{{ model.label }}</span></span>
      <YjTooltip v-if="completed" :text="completed.title"><time  class="chat-answer-actions__time" :datetime="completed.datetime" >{{ completed.label }}</time></YjTooltip>
      <YjTooltip v-else text="没有可用的完成时间"><span  class="chat-answer-actions__time" >时间未知</span></YjTooltip>
    </span>
    <span class="chat-answer-actions__announcement" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</span>
  </div>
</template>

<style scoped>
.chat-answer-actions { display: flex; align-items: center; flex-wrap: wrap; width: fit-content; max-width: 100%; gap: var(--yj-space-1); color: var(--yj-color-text-tertiary); }
.chat-answer-actions__trigger { display: inline-flex; }
.chat-answer-actions__metadata { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--yj-space-2); margin-inline-start: var(--yj-space-2); min-height: var(--yj-space-8); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.chat-answer-actions__model { display: inline-flex; align-items: center; gap: var(--yj-space-1); white-space: nowrap; }
.chat-answer-actions__brand { display: inline-flex; align-items: center; justify-content: center; width: var(--yj-space-4); height: var(--yj-space-4); border-radius: var(--yj-radius-xs); }
.chat-answer-actions__brand :deep(.yj-icon) { color: inherit; }
.chat-answer-actions__brand.is-kimi { background: var(--yj-color-model-kimi-bg); color: var(--yj-color-model-kimi-ink); }
.chat-answer-actions__time { visibility: hidden; opacity: 0; white-space: nowrap; transition: opacity var(--yj-motion-fast); }
.chat-answer-actions:hover .chat-answer-actions__time, .chat-answer-actions:focus-within .chat-answer-actions__time,
.chat-answer-actions.is-feedback-open .chat-answer-actions__time { visibility: visible; opacity: 1; }
.chat-answer-feedback { display: grid; gap: var(--yj-space-3); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); color: var(--yj-color-text-body); }
.chat-answer-feedback header { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-2); }
.chat-answer-feedback strong { font-weight: var(--yj-font-weight-semibold); }
.chat-answer-feedback__reasons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--yj-space-2); }
.chat-answer-feedback__reason { min-height: var(--yj-control-height-sm); padding: var(--yj-space-1) var(--yj-space-2); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-sm); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.chat-answer-feedback__reason:hover { background: var(--yj-color-control-hover); }
.chat-answer-feedback__reason[aria-checked="true"] { border-color: var(--yj-color-border-strong); background: var(--yj-color-control-pressed); }
.chat-answer-feedback__reason:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.chat-answer-feedback p { margin: 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.chat-answer-actions__announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (hover: none) { .chat-answer-actions__time { visibility: visible; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .chat-answer-actions__time { transition: none; } }
</style>
