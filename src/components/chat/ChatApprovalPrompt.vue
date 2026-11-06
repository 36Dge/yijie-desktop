<script setup lang="ts">
import { NPopover } from "naive-ui";
import { computed, nextTick, onMounted, ref, useId, watch } from "vue";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  source: string; icon: YjIconName; question: string;
  disabled: boolean; submitting: boolean; commandPrefix?: readonly string[];
}>();
const emit = defineEmits<{ once: []; reject: []; similar: [] }>();
const card = ref<HTMLElement | null>(null);
const overlay = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const open = ref(false);
const explain = ref(false);
const id = useId();
// Display argv boundaries; this string is never used in a decision.
const prefixLabel = computed(() => props.commandPrefix?.map(arg =>
  /^[\p{L}\p{N}_./:=@%+,-]+$/u.test(arg) ? arg : JSON.stringify(arg)).join(" "));
const blocked = computed(() => props.disabled || props.submitting);
watch([blocked, prefixLabel], () => { open.value = false; });
watch(open, () => { explain.value = false; });
onMounted(() => {
  if (document.activeElement === document.body) card.value?.focus({ preventScroll: true });
});
function closeMenu(restore = false) {
  open.value = false;
  if (restore) void nextTick(() => trigger.value?.focus({ preventScroll: true }));
}
function select(action: "once" | "reject" | "similar") {
  if (blocked.value || (action === "similar" && !prefixLabel.value)) return;
  closeMenu();
  if (action === "similar") emit("similar");
  else if (action === "once") emit("once");
  else emit("reject");
}
function keys(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === "Escape") {
    event.preventDefault(); event.stopPropagation();
    if (open.value) closeMenu(true);
    else select("reject");
  } else if (event.key === "Enter" && event.target === card.value) {
    event.preventDefault(); select("once");
  }
}
function menuKeys(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
  if (event.key === "ArrowRight") { event.preventDefault(); menu.value?.querySelector<HTMLButtonElement>(".approval-menu__info")?.focus(); return; }
  if (event.key === "ArrowLeft") { event.preventDefault(); menu.value?.querySelector<HTMLButtonElement>(".approval-menu__similar")?.focus(); return; }
  if (event.key === "Tab") {
    const info = menu.value?.querySelector<HTMLButtonElement>(".approval-menu__info");
    if (!event.shiftKey && document.activeElement !== info) { event.preventDefault(); info?.focus(); return; }
    trigger.value?.focus({ preventScroll: true }); closeMenu(); return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
    (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
watch(menu, el => { if (el && open.value) el.querySelector("button")?.focus({ preventScroll: true }); }, { flush: "post" });
</script>

<template>
  <Teleport v-if="prefixLabel" to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <article ref="card" class="approval-prompt" tabindex="0" role="group" :aria-labelledby="id" :aria-busy="submitting" @keydown="keys">
    <div class="approval-prompt__body">
      <header><YjIcon :name="icon" size="sm" tone="muted" /><span>{{ source }}</span><slot name="context" /></header>
      <strong :id="id" class="approval-prompt__question yj-selectable-text">{{ question }}</strong>
      <div class="approval-prompt__detail yj-selectable-text"><slot /></div>
    </div>
    <footer>
      <slot name="extra-action" />
      <button type="button" class="approval-prompt__reject" :disabled="blocked" aria-keyshortcuts="Escape" @click="select('reject')">拒绝 <kbd aria-hidden="true">Esc</kbd></button>
      <div class="approval-prompt__split">
        <button type="button" class="approval-prompt__once" :disabled="blocked" aria-keyshortcuts="Enter" @click="select('once')">{{ submitting ? "正在提交" : "允许一次" }} <kbd aria-hidden="true">↵</kbd></button>
        <NPopover v-if="prefixLabel" :to="overlay ?? false" v-model:show="open" trigger="click" placement="top-end" :disabled="blocked" :show-arrow="false" raw>
          <template #trigger>
            <button ref="trigger" type="button" class="approval-prompt__arrow" aria-label="更多允许选项" aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? id + '-menu' : undefined" :disabled="blocked" @keydown.down.prevent="open = true">
              <YjIcon name="chevronDown" size="xs" />
            </button>
          </template>
          <div :id="id + '-menu'" ref="menu" class="chat-control-menu approval-menu" role="menu" aria-label="允许选项" @keydown="menuKeys">
            <button type="button" role="menuitem" @click="select('once')">允许一次</button>
            <div class="approval-menu__row">
              <button type="button" role="menuitem" class="approval-menu__similar" :aria-describedby="id + '-scope'" @click="select('similar')">允许类似命令</button>
              <button class="approval-menu__info" type="button" aria-label="了解类似命令的授权范围" :aria-expanded="explain" @click="explain = !explain"><YjIcon name="info" size="xs" tone="muted" /></button>
              <small :id="id + '-scope'">以后允许此前缀：<code>{{ prefixLabel }}</code><template v-if="explain"><br>重新打开易界后，这项授权仍然有效。</template></small>
            </div>
          </div>
        </NPopover>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.approval-prompt { box-sizing:border-box; width:100%; min-width:0; display:grid; gap:var(--yj-space-4); padding:var(--yj-space-4); border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-xl); background:var(--yj-color-bg-card); color:var(--yj-color-text-primary); }
.approval-prompt__body { min-width:0; max-height: min(32vh, var(--yj-layout-chat-activity-max-height)); overflow:auto; }
header, footer, .approval-prompt__split, .approval-prompt button { display:flex; align-items:center; gap:var(--yj-space-2); }
header { color:var(--yj-color-text-tertiary); font-size:var(--yj-font-size-caption); }
.approval-prompt__question { display:block; margin-block-start:var(--yj-space-2); font-size:var(--yj-font-size-body); font-weight:var(--yj-font-weight-semibold); overflow-wrap:anywhere; white-space:pre-wrap; }
.approval-prompt__detail { margin-block-start:var(--yj-space-3); color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-code); overflow-wrap:anywhere; }
.approval-prompt__detail :deep(pre), .approval-menu code { margin:0; font:inherit; font-family:var(--yj-font-family-mono); white-space:pre-wrap; overflow-wrap:anywhere; }
footer { justify-content:flex-end; flex-wrap:wrap; }
.approval-prompt button, .approval-menu button { font:inherit; cursor:pointer; }
.approval-prompt__reject, .approval-prompt__split, :slotted(.approval-secondary) { border-radius:var(--yj-radius-full); }
.approval-prompt__reject, :slotted(.approval-secondary) { background:var(--yj-color-bg-card); color:var(--yj-color-text-primary); border:var(--yj-border-width) solid var(--yj-color-border-default); padding:0 var(--yj-space-3); min-height:var(--yj-control-height-sm); }
.approval-prompt__split { gap:0; background:var(--yj-color-text-primary); color:var(--yj-color-bg-page); }
.approval-prompt__once, .approval-prompt__arrow { min-height:var(--yj-control-height-sm); color:inherit; background:transparent; border:0; border-radius:inherit; padding:0 var(--yj-space-3); }
.approval-prompt__split:has(.approval-prompt__arrow) .approval-prompt__once { border-start-end-radius:0; border-end-end-radius:0; padding-inline-end:var(--yj-space-2); }
.approval-prompt__arrow { padding-inline:var(--yj-space-2); border-start-start-radius:0; border-end-start-radius:0; }
.approval-prompt__arrow :deep(svg) { color:inherit; }
.approval-prompt__split button:hover:enabled, .approval-prompt__arrow[aria-expanded="true"] { background:color-mix(in srgb, currentColor 15%, transparent); }
.approval-prompt__reject:hover:enabled, :slotted(.approval-secondary:hover:enabled), .approval-menu button:hover, .approval-menu button:focus-visible { background:var(--yj-color-control-hover); }
kbd { border-radius:var(--yj-radius-sm); padding:0 var(--yj-space-1); font:inherit; font-size:var(--yj-font-size-caption); background:color-mix(in srgb, currentColor 12%, transparent); }
.approval-prompt button:disabled, :slotted(.approval-secondary:disabled) { color:var(--yj-color-text-disabled); background:var(--yj-color-control-disabled-bg); cursor:default; }
.approval-prompt:focus-visible, .approval-prompt button:focus-visible, .approval-menu button:focus-visible, :slotted(.approval-secondary:focus-visible) { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
.approval-menu { width:max-content; min-width:var(--yj-layout-chat-context-menu-width); max-width:min(80vw, var(--yj-layout-chat-workspace-control-max)); max-height:40vh; overflow:auto; padding:var(--yj-space-1); color:var(--yj-color-text-primary); }
.approval-menu button { display:block; width:100%; padding:var(--yj-space-2) var(--yj-space-3); border:0; border-radius:var(--yj-radius-md); color:inherit; text-align:start; background:transparent; }
.approval-menu__row { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:center; }
.approval-menu .approval-menu__info { display:grid; place-items:center; width:var(--yj-control-height-sm); height:var(--yj-control-height-sm); padding:0; }
.approval-menu small { grid-column:1/-1; padding:0 var(--yj-space-3) var(--yj-space-2); color:var(--yj-color-text-secondary); overflow-wrap:anywhere; font-size:var(--yj-font-size-caption); }
</style>
