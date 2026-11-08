<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import type { UserInputAnswers, UserInputRequest } from "../../api/user-input-client";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{ request: UserInputRequest; disabled: boolean; submitting: boolean; revalidating?: boolean }>();
const emit = defineEmits<{ answer: [answers: UserInputAnswers]; interact: [] }>();
const id = useId();
const page = ref(0), reveal = ref(false), now = ref(Date.now());
const draft = ref<Record<string, string>>(Object.create(null));
const selected = ref<Record<string, string>>(Object.create(null));
const question = computed(() => props.request.questions[page.value]);
const pending = computed(() => props.request.state === "pending");
const blocked = computed(() => props.disabled || props.submitting || props.revalidating || !pending.value);
const text = computed({ get: () => question.value ? draft.value[question.value.id] ?? "" : "", set: value => {
  if (!question.value || blocked.value) return;
  draft.value[question.value.id] = value; delete selected.value[question.value.id]; emit("interact");
} });
const hasAnswer = computed(() => !!question.value && Boolean(text.value.trim() || selected.value[question.value.id]));
const last = computed(() => page.value === props.request.questions.length - 1);
const remaining = computed(() => props.request.deadline_at && !props.request.timeout_paused ? Math.max(0, Math.ceil((Date.parse(props.request.deadline_at) - now.value) / 1000)) : null);
const interval = setInterval(() => { now.value = Date.now(); }, 1000);
function clear() { draft.value = Object.create(null); selected.value = Object.create(null); reveal.value = false; }
watch(() => props.request.request_id, () => { clear(); page.value = 0; }, { flush: "sync" });
watch([pending, () => props.submitting], ([isPending, sending]) => { if (!isPending || sending) clear(); }, { flush: "sync" });
watch([() => props.disabled, () => props.revalidating], ([disabled, checking]) => { if (disabled || checking) reveal.value = false; }, { flush: "sync" });
onBeforeUnmount(() => { clearInterval(interval); clear(); });
function choose(value: string) { if (!question.value || blocked.value) return; selected.value[question.value.id] = value; delete draft.value[question.value.id]; emit("interact"); }
function navigate(index: number) { if (blocked.value || index < 0 || index >= props.request.questions.length) return; page.value = index; reveal.value = false; emit("interact"); }
function submit(skipAll = false) {
  if (blocked.value) return;
  const answers: UserInputAnswers = Object.create(null);
  if (!skipAll) for (const q of props.request.questions) { const value = draft.value[q.id] || selected.value[q.id]; answers[q.id] = { answers: value ? [value] : [] }; }
  clear(); emit("answer", answers);
}
function next(skip = false) {
  if (!question.value || blocked.value || (!skip && !hasAnswer.value)) return;
  if (skip) { delete draft.value[question.value.id]; delete selected.value[question.value.id]; }
  if (last.value) submit(); else navigate(page.value + 1);
}
function keys(event: KeyboardEvent) {
  if (blocked.value || event.defaultPrevented || event.isComposing || event.repeat) return;
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); next(); }
  if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !event.ctrlKey && !event.metaKey && /^[1-9]$/.test(event.key)) {
    const option = question.value?.options?.[Number(event.key) - 1]; if (option) { event.preventDefault(); event.stopPropagation(); choose(option.label); }
  }
}
</script>

<template>
  <section class="user-input" :aria-labelledby="`${id}-title`" :aria-busy="submitting || request.state === 'submitting'" @keydown="keys">
    <header>
      <YjIcon name="info" size="sm" tone="muted" /><span :id="`${id}-title`">问题</span>
      <nav v-if="request.questions.length > 1" aria-label="问题切换">
        <button type="button" class="icon-button previous" aria-label="上一题" :disabled="blocked || page === 0" @click="navigate(page - 1)"><YjIcon name="chevronRight" /></button>
        <span aria-live="polite">{{ page + 1 }} / {{ request.questions.length }}</span>
        <button type="button" class="icon-button" aria-label="下一题" :disabled="blocked || last" @click="navigate(page + 1)"><YjIcon name="chevronRight" /></button>
      </nav>
      <button type="button" class="icon-button close" aria-label="关闭并跳过本组问题" :disabled="blocked" @click="submit(true)"><YjIcon name="dismiss" /></button>
    </header>
    <div v-if="question && !revalidating" class="user-input__body">
      <h3 :id="`${id}-question`" class="yj-selectable-text">{{ question.question }}</h3>
      <div v-if="question.options?.length" class="user-input__options" role="group" :aria-labelledby="`${id}-question`">
        <button v-for="(option, index) in question.options" :key="option.label" type="button" class="user-input__option" :aria-pressed="selected[question.id] === option.label" :disabled="blocked" @click="choose(option.label)">
          <span class="user-input__number" aria-hidden="true">{{ index + 1 }}</span>
          <span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
          <YjIcon v-if="selected[question.id] === option.label" name="checkmark" size="sm" />
        </button>
      </div>
      <div v-if="!question.options?.length || question.isOther" class="user-input__field">
        <label class="user-input__label" :for="`${id}-answer`">{{ question.options?.length ? "或自行撰写回复" : "回复" }}</label>
        <div v-if="question.isSecret" class="user-input__secret">
          <input :id="`${id}-answer`" v-model="text" :type="reveal ? 'text' : 'password'" :disabled="blocked" maxlength="8192" autocomplete="off" autocapitalize="off" :spellcheck="false" :aria-describedby="`${id}-privacy`" @focus="emit('interact')" />
          <button type="button" :disabled="blocked" :aria-pressed="reveal" @click="reveal = !reveal; emit('interact')">{{ reveal ? "隐藏" : "显示" }}</button>
        </div>
        <textarea v-else :id="`${id}-answer`" v-model="text" :disabled="blocked" rows="2" maxlength="8192" placeholder="回复…" @focus="emit('interact')" />
        <p v-if="question.isSecret" :id="`${id}-privacy`" class="user-input__hint">回答会提供给模型，并保留在原生会话中。遮罩仅隐藏屏幕上的内容；平台授权请使用连接器设置。</p>
      </div>
    </div>
    <footer>
      <span class="user-input__hint" role="status">
        <template v-if="submitting || request.state === 'submitting'">正在确认回答送达…</template>
        <template v-else-if="revalidating">正在重新确认问题，回答尚未发送</template>
        <template v-else-if="disabled">连接或权限暂不可用</template>
        <template v-else-if="remaining !== null">{{ remaining > 0 ? `${remaining} 秒后按未回答继续` : '正在确认超时状态…' }}</template>
        <template v-else-if="request.timeout_paused">已暂停自动跳过</template>
        <template v-else>等待你的回答</template>
      </span>
      <button type="button" class="secondary" :disabled="blocked" @click="next(true)">跳过</button>
      <button type="button" class="primary" :disabled="blocked || !hasAnswer" @click="next()">{{ last ? "发送" : "下一步" }}</button>
    </footer>
  </section>
</template>

<style scoped>
.user-input { box-sizing:border-box; width:min(100%, var(--yj-layout-chat-composer-max)); min-width:0; padding:var(--yj-space-4); margin-block-end:var(--yj-space-2); border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-xl); color:var(--yj-color-text-primary); background:var(--yj-color-bg-card); }
header, nav, footer, .user-input__secret { display:flex; align-items:center; gap:var(--yj-space-2); }
header { color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-body); }
nav { margin-inline-start:auto; }
.close { margin-inline-start:auto; }
nav + .close { margin-inline-start:var(--yj-space-2); }
button { font:inherit; cursor:pointer; }
.icon-button { display:grid; place-items:center; width:var(--yj-control-height-sm); height:var(--yj-control-height-sm); border:0; border-radius:var(--yj-radius-md); background:transparent; color:inherit; padding:0; flex-shrink:0; }
.previous :deep(svg) { transform:rotate(180deg); }
.icon-button:hover:enabled, .secondary:hover:enabled, .user-input__option:hover:enabled { background:var(--yj-color-control-hover); }
button:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
.user-input__body { max-height: min(36vh, var(--yj-layout-chat-activity-max-height)); overflow:auto; padding-block:var(--yj-space-3); }
h3 { margin:0 0 var(--yj-space-3); font-size:var(--yj-font-size-body); font-weight:var(--yj-font-weight-semibold); line-height:var(--yj-line-height-body); white-space:pre-wrap; overflow-wrap:anywhere; }
.user-input__options { display:grid; gap:var(--yj-space-2); margin-block-end:var(--yj-space-3); }
.user-input__option { display:flex; align-items:center; gap:var(--yj-space-3); width:100%; padding:var(--yj-space-2); border:var(--yj-border-width) solid transparent; border-radius:var(--yj-radius-md); background:transparent; color:inherit; text-align:start; }
.user-input__option[aria-pressed="true"] { border-color:var(--yj-color-border-default); background:var(--yj-color-control-pressed); }
.user-input__option > span:nth-child(2) { flex:1; min-width:0; overflow-wrap:anywhere; }
.user-input__option strong { font-weight:var(--yj-font-weight-medium); }
.user-input__option small { display:block; color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-caption); margin-block-start:var(--yj-space-1); }
.user-input__number { display:grid; place-items:center; min-width:var(--yj-space-6); height:var(--yj-space-6); background:var(--yj-color-control-hover); border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-sm); color:var(--yj-color-text-secondary); }
.user-input__label { display:block; font-size:var(--yj-font-size-caption); color:var(--yj-color-text-secondary); margin-block-end:var(--yj-space-2); }
textarea, input { box-sizing:border-box; width:100%; min-width:0; border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-md); background:var(--yj-color-bg-card); color:var(--yj-color-text-primary); padding:var(--yj-space-3); font:inherit; resize:vertical; }
textarea { max-height:20vh; }
textarea:focus, input:focus { outline:0; border-color:var(--yj-color-focus-ring); }
.user-input__secret button { flex-shrink:0; border:0; background:transparent; color:var(--yj-color-text-primary); padding:var(--yj-space-2); border-radius:var(--yj-radius-sm); }
.user-input__hint { font-size:var(--yj-font-size-caption); color:var(--yj-color-text-secondary); line-height:var(--yj-line-height-body); overflow-wrap:anywhere; }
p.user-input__hint { margin-block:var(--yj-space-2) 0; }
footer { padding-block-start:var(--yj-space-2); }
footer > span { margin-inline-end:auto; min-width:0; }
footer > button { flex-shrink:0; min-height:var(--yj-control-height-sm); padding:0 var(--yj-space-3); border-radius:var(--yj-radius-full); }
.secondary { border:var(--yj-border-width) solid var(--yj-color-border-default); color:var(--yj-color-text-primary); background:var(--yj-color-bg-card); }
.primary { border:var(--yj-border-width) solid transparent; background:var(--yj-color-text-primary); color:var(--yj-color-bg-page); }
.primary:hover:enabled { opacity:0.85; }
button:disabled, textarea:disabled, input:disabled { cursor:default; color:var(--yj-color-text-disabled); }
.primary:disabled { background:var(--yj-color-control-disabled-bg); }
</style>
