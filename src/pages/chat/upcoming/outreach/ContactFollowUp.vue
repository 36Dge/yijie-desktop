<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { browserChatClipboardAdapter } from "../../../../api/chat-clipboard-adapter";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import { campaign, draftFor, eventLabels, stageOf, usd, type Creator, type Language, type Stage } from "./campaign";

const props = defineProps<{ person: Creator }>();
const emit = defineEmits<{
  draft: [stage: "candidate" | "invited", language: Language, value: string];
  advance: [stage: Stage, message?: string];
  orders: [value: number];
}>();
const stage = computed(() => stageOf(props.person));
const language = ref<Language>("en");
const editor = ref<HTMLTextAreaElement>();
const copyNotice = ref("");
const titleId = useId();
const draft = computed({
  get: () => stage.value === "candidate" || stage.value === "invited" ? draftFor(props.person, stage.value, language.value) : "",
  set: value => { if (stage.value === "candidate" || stage.value === "invited") emit("draft", stage.value, language.value, value); },
});
watch([language, draft], () => { copyNotice.value = ""; });
const orderInput = ref(props.person.attributedOrders?.toString() ?? "");
const orderValue = computed(() => {
  const n = Number(orderInput.value);
  return orderInput.value.trim() && Number.isSafeInteger(n) && n >= 0 && Number.isSafeInteger(n * campaign.unitPriceCents) ? n : null;
});
async function copy() {
  const value = draft.value;
  const field = editor.value;
  try {
    await browserChatClipboardAdapter.writeText(value);
    if (editor.value === field && draft.value === value) copyNotice.value = "已复制草稿";
  } catch {
    if (!field || editor.value !== field || draft.value !== value) return;
    field.focus(); field.select();
    copyNotice.value = "已选中草稿，可使用系统复制快捷键";
  }
}
const nextAction: Record<Exclude<Stage, "published">, string> = {
  candidate: "登记邀约", invited: "登记回复", replied: "登记寄样", sampled: "登记发布",
};
</script>

<template>
  <div class="contact-detail">
    <template v-if="stage === 'candidate' || stage === 'invited'">
      <div class="editor-top">
        <label :for="titleId">{{ stage === 'candidate' ? '邀约草稿' : '跟进草稿' }}</label>
        <select v-model="language" aria-label="草稿语言"><option value="en">English</option><option value="zh">中文</option></select>
      </div>
      <textarea :id="titleId" ref="editor" v-model="draft" :lang="language === 'en' ? 'en' : 'zh-CN'" rows="5" />
    </template>
    <p v-else-if="stage === 'replied'" class="next-task"><strong>寄样安排</strong>确认收件信息后，登记一件{{ campaign.product }}。</p>
    <p v-else-if="stage === 'sampled'" class="next-task"><strong>交付内容</strong>一条通勤试背短片，拍清包内装载和背上肩的比例。</p>
    <form v-else class="order-form" @submit.prevent="orderValue !== null && emit('orders', orderValue)">
      <label>归因订单<input :value="orderInput" type="number" min="0" step="1" required inputmode="numeric" placeholder="待归因"
        @input="orderInput = ($event.target as HTMLInputElement).value" /></label>
      <span>成交单价 {{ usd(campaign.unitPriceCents) }}</span>
      <button type="submit" class="record-button" :disabled="orderValue === null || orderValue === person.attributedOrders">保存订单</button>
    </form>
    <div v-if="stage !== 'published'" class="detail-actions">
      <button v-if="stage === 'candidate' || stage === 'invited'" type="button" class="copy-button" :disabled="!draft.trim()" @click="copy">
        <YjIcon name="copy" size="xs" />复制草稿
      </button>
      <span role="status">{{ copyNotice }}</span>
      <button :key="stage" type="button" class="record-button" :disabled="stage === 'candidate' && !draft.trim()"
        @click="emit('advance', stage, stage === 'candidate' ? draft.trim() : undefined)">{{ nextAction[stage] }}</button>
    </div>
    <details v-if="person.history.length" class="contact-history">
      <summary>跟进记录 <small>{{ person.history.length }}</small><YjIcon name="chevronDown" size="xs" /></summary>
      <ol><li v-for="event in person.history" :key="event.stage">
        <span>{{ event.when }}</span><div>{{ eventLabels[event.stage] }}<p v-if="event.message" dir="auto">{{ event.message }}</p></div>
      </li></ol>
    </details>
  </div>
</template>

<style scoped>
.contact-detail { display: grid; gap: var(--yj-space-2); padding: var(--yj-space-3) var(--yj-space-4) var(--yj-space-4); background: var(--yj-color-control-hover); border-radius: var(--yj-radius-md); margin: 0 0 var(--yj-space-2); }
.next-task { margin: 0; display: flex; flex-wrap: wrap; gap: var(--yj-space-1) var(--yj-space-2); font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-context-window); }
.next-task, .order-form > span, .detail-actions > span, .contact-history li > span { color: var(--yj-color-text-secondary); }
.next-task strong, .editor-top label, .order-form label { color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-medium); }
.editor-top, .detail-actions, .order-form { display: flex; align-items: center; gap: var(--yj-space-2); font-size: var(--yj-font-size-context-window); }
.editor-top { justify-content: space-between; }
.editor-top select, .order-form input, .contact-detail textarea { font: inherit; color: var(--yj-color-text-primary); background: var(--yj-color-bg-card); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-sm); }
.editor-top select { min-height: var(--yj-control-height-sm); padding-inline: var(--yj-space-2); font-size: var(--yj-font-size-caption); }
.contact-detail textarea { display: block; width: 100%; min-width: 0; min-height: calc(var(--yj-space-16) + var(--yj-space-8)); max-height: min(35vh, 20em); field-sizing: content; resize: vertical; padding: var(--yj-space-2) var(--yj-space-3); font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-body); }
.detail-actions { flex-wrap: wrap; }
.copy-button, .record-button { display: inline-flex; justify-content: center; align-items: center; min-height: var(--yj-control-height-sm); gap: var(--yj-space-1); color: var(--yj-color-text-primary); font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-medium); border-radius: var(--yj-radius-sm); }
.copy-button { padding: 0; border: 0; background: transparent; }
.copy-button:enabled:hover { text-decoration: underline; text-underline-offset: 3px; }
.record-button { padding: var(--yj-space-1) var(--yj-space-2); margin-inline-start: auto; background: var(--yj-color-bg-card); border: var(--yj-border-width) solid var(--yj-color-border-control); }
.record-button:enabled:hover { border-color: var(--yj-color-text-primary); }
.record-button:disabled, .copy-button:disabled { cursor: default; color: var(--yj-color-text-disabled); border-color: var(--yj-color-border-default); }
.detail-actions > span, .order-form > span { font-size: var(--yj-font-size-caption); }
.order-form { flex-wrap: wrap; }
.order-form label { display: inline-flex; align-items: center; gap: var(--yj-space-2); }
.order-form input { width: 6em; min-height: var(--yj-control-height-sm); padding-inline: var(--yj-space-2); font-variant-numeric: tabular-nums; }
.contact-history { font-size: var(--yj-font-size-caption); }
.contact-history summary { width: fit-content; display: flex; align-items: center; gap: var(--yj-space-1); cursor: pointer; color: var(--yj-color-text-secondary); list-style: none; }
.contact-history summary::-webkit-details-marker { display: none; }
.contact-history[open] summary :deep(svg) { transform: rotate(180deg); }
.contact-history small { font-size: inherit; }
.contact-history ol { display: grid; gap: var(--yj-space-1); padding: 0; margin: var(--yj-space-2) 0 0; list-style: none; }
.contact-history li { display: grid; grid-template-columns: 6em minmax(0,1fr); gap: var(--yj-space-2); }
.contact-history li > span { font-variant-numeric: tabular-nums; }
.contact-history p { white-space: pre-wrap; overflow-wrap: anywhere; margin: var(--yj-space-1) 0; color: var(--yj-color-text-secondary); }
.contact-detail :is(textarea, input, select):focus-visible { outline: none; border-color: var(--yj-color-focus-ring); }
.contact-detail :is(button, summary):focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: 2px; }
</style>
