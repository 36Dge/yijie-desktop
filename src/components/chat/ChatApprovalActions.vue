<script setup lang="ts">
import { NPopover } from "naive-ui";
import { computed, nextTick, ref, useId, watch } from "vue";
import type { NativeApprovalOption } from "../../api/runtime-permission-client";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{ choices: readonly NativeApprovalOption[]; disabled: boolean; submitting?: boolean }>();
const emit = defineEmits<{ select: [id: string] }>();
const primary = computed(() => props.choices.find(choice => choice.kind === "allow_once"));
const secondary = computed(() => props.choices.filter(choice =>
  choice.kind === "decline" || choice.kind === "cancel" || choice.kind === "deny_rule" || (!!primary.value && !choice.kind)));
const menuChoices = computed(() => [
  ...(primary.value ? [primary.value] : []),
  ...props.choices.filter(choice => choice !== primary.value && !secondary.value.includes(choice)),
]);
const escapeChoice = computed(() => secondary.value.find(choice => choice.kind === "cancel")
  ?? secondary.value.find(choice => choice.kind === "decline"));
const multiplePrefixes = computed(() => menuChoices.value.filter(choice => choice.kind === "command_prefix").length > 1);
const blocked = computed(() => props.disabled || !!props.submitting);
const overlay = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const open = ref(false);
const explained = ref<string>();
const menuId = useId();

function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) void nextTick(() => trigger.value?.focus({ preventScroll: true }));
}

function choose(choice: NativeApprovalOption) {
  if (blocked.value || !props.choices.includes(choice)) return;
  close();
  emit("select", choice.id);
}

// The callback can be refreshed while a user is reading its scope. Keep focus
// on identical offers, and dismiss a menu whose choices actually changed.
watch([blocked, () => JSON.stringify(props.choices)], () => close(), { flush: "sync" });
watch(open, () => { explained.value = undefined; });
watch(menu, el => {
  if (open.value) el?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
}, { flush: "post" });

function cardKeys(event: KeyboardEvent) {
  if (blocked.value || event.defaultPrevented || event.repeat || event.isComposing || event.altKey
    || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === "Escape" && (open.value || escapeChoice.value)) {
    event.preventDefault(); event.stopPropagation();
    if (open.value) close(true);
    else if (escapeChoice.value) choose(escapeChoice.value);
  } else if (event.key === "Enter" && event.target === event.currentTarget && primary.value) {
    event.preventDefault();
    choose(primary.value);
  }
}
defineExpose({ cardKeys });

function menuKeys(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault(); event.stopPropagation(); close(true); return;
  }
  const items = [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  const target = event.target as HTMLElement;
  const row = target.closest(".approval-menu__row");
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    const selector = event.key === "ArrowRight" ? ".approval-menu__info" : '[role="menuitem"]';
    const next = row?.querySelector<HTMLButtonElement>(selector);
    if (next) { event.preventDefault(); next.focus(); }
    return;
  }
  if (event.key === "Tab") {
    if (row) {
      const next = (!event.shiftKey && target.matches('[role="menuitem"]'))
        ? row.querySelector<HTMLButtonElement>(".approval-menu__info")
        : event.shiftKey && target.matches(".approval-menu__info")
          ? row.querySelector<HTMLButtonElement>('[role="menuitem"]') : null;
      if (next) { event.preventDefault(); next.focus(); return; }
    }
    trigger.value?.focus({ preventScroll: true });
    close();
    return;
  }
  if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const active = items.findIndex(item => item === target || item === row?.querySelector('[role="menuitem"]'));
  const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
    (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[index]?.focus();
}
</script>

<template>
  <Teleport v-if="menuChoices.length" to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <footer class="approval-actions" role="group" aria-label="审批操作">
    <slot name="extra-action" />
    <button v-for="choice in secondary" :key="choice.id" type="button" :data-choice="choice.id"
      class="approval-actions__secondary chat-approval-card__button" :disabled="blocked" :aria-keyshortcuts="choice === escapeChoice ? 'Escape' : undefined"
      @click="choose(choice)">
      {{ choice.label }}<kbd v-if="choice === escapeChoice" aria-hidden="true" data-key="Esc" />
    </button>
    <div v-if="menuChoices.length" class="approval-actions__split">
      <button v-if="primary" type="button" class="approval-actions__primary chat-approval-card__button" :data-choice="primary.id" :disabled="blocked"
        aria-keyshortcuts="Enter" @click="choose(primary)">{{ submitting ? "正在提交" : primary.label }}<kbd aria-hidden="true" data-key="↵" /></button>
      <NPopover v-model:show="open" :to="overlay ?? false" trigger="click" placement="top-end" :disabled="blocked" :show-arrow="false" raw>
        <template #trigger>
          <button ref="trigger" type="button" class="approval-actions__arrow"
            :aria-label="primary ? '更多允许选项' : '选择审批选项'" aria-haspopup="menu" :aria-expanded="open"
            :aria-controls="open ? menuId : undefined" :disabled="blocked" @keydown.down.prevent.stop="open = true">
            <span v-if="!primary">选择审批选项</span><YjIcon name="chevronDown" size="xs" />
          </button>
        </template>
        <div :id="menuId" ref="menu" class="chat-control-menu approval-menu" role="menu" :aria-label="primary ? '允许选项' : '审批选项'" @keydown="menuKeys">
          <div v-for="(choice, index) in menuChoices" :key="choice.id" class="approval-menu__row" role="none">
            <button type="button" role="menuitem" :disabled="blocked" :data-choice="choice.id"
              :aria-describedby="choice.detail && (explained === choice.id || multiplePrefixes) ? menuId + '-scope-' + index : undefined"
              @click="choose(choice)">{{ choice.kind === "command_prefix" && choice.detail ? "允许相似命令" : choice.label }}</button>
            <button v-if="choice.kind === 'command_prefix' && choice.detail" class="approval-menu__info"
              type="button" tabindex="-1" :disabled="blocked" aria-label="查看相似命令的授权范围"
              :aria-expanded="explained === choice.id" :aria-controls="menuId + '-scope-' + index"
              @click="explained = explained === choice.id ? undefined : choice.id"><YjIcon name="info" size="xs" /></button>
            <small v-if="choice.detail" v-show="explained === choice.id || multiplePrefixes" :id="menuId + '-scope-' + index">
              命令前缀 <code>{{ choice.detail }}</code><template v-if="explained === choice.id"><br>Codex 会记住这个前缀，用于以后匹配的命令。</template>
            </small>
          </div>
        </div>
      </NPopover>
    </div>
  </footer>
</template>

<style scoped>
.approval-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:var(--yj-space-2); min-width:0; }
.approval-actions button, .approval-menu button, :slotted(.approval-secondary) { font:inherit; cursor:pointer; }
.approval-actions__secondary, .approval-actions__primary, .approval-actions__arrow, :slotted(.approval-secondary) {
  display:inline-flex; align-items:center; justify-content:center; gap:var(--yj-space-2); min-height:var(--yj-control-height-sm);
  max-width:100%; padding:0 var(--yj-space-3); overflow-wrap:anywhere; border-radius:var(--yj-radius-full);
}
.approval-actions__secondary, :slotted(.approval-secondary) { background:var(--yj-color-bg-card); color:var(--yj-color-text-primary); border:var(--yj-border-width) solid var(--yj-color-border-default); }
.approval-actions__split { display:inline-flex; align-items:stretch; max-width:100%; border-radius:var(--yj-radius-full); background:var(--yj-color-text-primary); color:var(--yj-color-bg-page); }
.approval-actions__primary, .approval-actions__arrow { color:inherit; background:transparent; border:0; }
.approval-actions__primary { border-start-end-radius:0; border-end-end-radius:0; padding-inline-end:var(--yj-space-2); }
.approval-actions__primary + .approval-actions__arrow { border-inline-start:var(--yj-border-width) solid color-mix(in srgb, currentColor 16%, transparent); border-start-start-radius:0; border-end-start-radius:0; }
.approval-actions__arrow { flex-shrink:0; padding-inline:var(--yj-space-2); }
.approval-actions__arrow :deep(svg) { color:inherit; }
.approval-actions__split button:hover:enabled, .approval-actions__arrow[aria-expanded="true"] { background:color-mix(in srgb, currentColor 15%, transparent); }
.approval-actions__secondary:hover:enabled, :slotted(.approval-secondary:hover:enabled), .approval-menu button:hover:enabled, .approval-menu button:focus-visible { background:var(--yj-color-control-hover); }
kbd { border-radius:var(--yj-radius-sm); padding:0 var(--yj-space-1); font:inherit; font-size:var(--yj-font-size-caption); background:color-mix(in srgb, currentColor 12%, transparent); }
kbd::before { content:attr(data-key); }
.approval-actions button:disabled, :slotted(.approval-secondary:disabled) { color:var(--yj-color-text-disabled); background:var(--yj-color-control-disabled-bg); cursor:default; }
.approval-actions button:focus-visible, .approval-menu button:focus-visible, :slotted(.approval-secondary:focus-visible) { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
.approval-menu { width:max-content; min-width:var(--yj-layout-chat-context-menu-width); max-width:min(85vw, var(--yj-layout-chat-workspace-control-max)); max-height:40vh; overflow:auto; padding:var(--yj-space-1); color:var(--yj-color-text-primary); }
.approval-menu button { width:100%; min-width:0; padding:var(--yj-space-2) var(--yj-space-3); border:0; border-radius:var(--yj-radius-md); color:inherit; text-align:start; background:transparent; overflow-wrap:anywhere; }
.approval-menu__row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; }
.approval-menu .approval-menu__info { display:grid; place-items:center; width:var(--yj-control-height-sm); height:var(--yj-control-height-sm); padding:0; color:var(--yj-color-text-secondary); }
.approval-menu small { grid-column:1/-1; padding:0 var(--yj-space-3) var(--yj-space-2); color:var(--yj-color-text-secondary); overflow-wrap:anywhere; font-size:var(--yj-font-size-caption); }
.approval-menu code { font-family:var(--yj-font-family-mono); white-space:pre-wrap; }
</style>
