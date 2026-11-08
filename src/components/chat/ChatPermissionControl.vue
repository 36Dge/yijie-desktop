<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { NCheckbox, NModal, NPopover } from "naive-ui";
import type { ChatPermissionState, PermissionMode } from "../../api/runtime-permission-client";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{ state: ChatPermissionState | null; disabled: boolean; saving: boolean }>();
const emit = defineEmits<{ select: [mode: PermissionMode, confirmFullAccess: boolean] }>();
const open = ref(false);
const confirm = ref(false);
const riskAcknowledged = ref(false);
const overlay = ref<HTMLElement | null>(null);
const confirmationOverlay = ref<HTMLElement | null>(null);
const confirmationId = useId();
const triggerElement = ref<HTMLButtonElement | null>(null);
const menuElement = ref<HTMLElement | null>(null);
const cancelElement = ref<HTMLButtonElement | null>(null);
const options: { mode: PermissionMode; label: string; description: string; icon: YjIconName }[] = [
  { mode: "ask", label: "请求批准", description: "编辑外部文件和使用互联网时始终询问", icon: "permissionHand" },
  { mode: "auto", label: "帮我批准", description: "仅对检测到的风险操作请求批准", icon: "shield" },
  { mode: "full", label: "完全访问权限", description: "可不受限制地访问互联网和你电脑上的任何文件", icon: "permissionAlert" },
];
const selected = computed(() => options.find((o) => o.mode === props.state?.mode) ?? options[0]!);
const blocked = computed(() => props.disabled || props.saving || !props.state || props.state.busy);
const canApproveFull = computed(() => confirm.value && riskAcknowledged.value && !blocked.value);
const fullAccessCapabilities: { title: string; description: string; icon: YjIconName }[] = [
  { title: "文件操作", description: "读取、创建、修改、上传或删除此计算机上任意位置的文件", icon: "folder" },
  { title: "终端命令", description: "运行命令、安装软件和更改系统设置", icon: "terminal" },
  { title: "访问互联网", description: "访问网站、发送数据并使用已启用的连接器", icon: "globe" },
];
const acknowledgementTheme = {
  sizeMedium: "var(--yj-space-4)",
  borderRadius: "var(--yj-radius-xs)",
  border: "var(--yj-border-width) solid var(--yj-color-border-default)",
  borderFocus: "var(--yj-border-width) solid var(--yj-color-focus-ring)",
  borderChecked: "var(--yj-border-width) solid var(--yj-color-on-brand)",
  color: "var(--yj-color-bg-elevated)",
  colorChecked: "var(--yj-color-brand-primary)",
  checkMarkColor: "var(--yj-color-on-brand)",
  textColor: "var(--yj-color-text-primary)",
  fontSizeMedium: "var(--yj-font-size-body)",
  labelPadding: "0 0 0 var(--yj-space-2)",
  boxShadowFocus: "var(--yj-shadow-control-focus)",
};
watch(blocked, (value) => { if (value) { open.value = false; confirm.value = false; } });
watch(confirm, (value) => {
  riskAcknowledged.value = false;
  if (value) void nextTick(focusConfirmation);
}, { flush: "sync" });
watch(open, async (value) => {
  await nextTick();
  if (value && open.value) menuElement.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  else if (!value && !blocked.value && !confirm.value) triggerElement.value?.focus({ preventScroll: true });
});
function choose(mode: PermissionMode): void {
  if (blocked.value) return;
  open.value = false;
  if (mode === "full") { confirm.value = true; return; }
  emit("select", mode, false);
}
function approveFull(): void {
  if (!canApproveFull.value) return;
  confirm.value = false;
  emit("select", "full", true);
}
function focusConfirmation(preserveExisting = false): void {
  if (!confirm.value || !cancelElement.value) return;
  const cancel = cancelElement.value;
  const dialog = cancel.closest<HTMLElement>(".permission-confirm");
  if (!dialog) return;
  if (preserveExisting && dialog.contains(document.activeElement)) return;
  const bounds = dialog.getBoundingClientRect();
  const cancelBounds = cancel.getBoundingClientRect();
  // A zoomed or short viewport can put the footer below the fold. Keep the
  // initial safe action visible without scrolling past the risk description.
  const target = cancelBounds.bottom <= bounds.bottom && cancelBounds.top >= bounds.top
    ? cancel : dialog.querySelector<HTMLButtonElement>(".permission-confirm-close");
  target?.focus({ preventScroll: true });
}
function restoreTriggerFocus(): void {
  if (!blocked.value && !confirm.value) triggerElement.value?.focus({ preventScroll: true });
}
function navigate(event: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next]?.focus({ preventScroll: true });
}
</script>

<template>
  <Teleport to="body">
    <div ref="overlay" class="chat-control-overlay" />
    <div ref="confirmationOverlay" class="permission-confirm-overlay" />
  </Teleport>
  <NPopover :to="overlay ?? false" v-model:show="open" trigger="click" placement="top-start" :disabled="blocked" :show-arrow="false" raw>
    <template #trigger>
      <span class="chat-control-anchor">
        <button ref="triggerElement" class="permission-trigger yj-control yj-control--pill" :class="{ 'is-full': state?.mode === 'full' }" type="button" :disabled="blocked" :aria-label="`权限审批：${state ? selected.label : '读取中'}`" aria-haspopup="menu" :aria-expanded="open" @keydown.down.prevent="open = !blocked" @keydown.esc="open = false">
          <span class="permission-trigger-icon"><YjIcon :name="selected.icon" size="sm" :stroke-width="1.5" /></span>
          <span class="permission-trigger-label">{{ saving ? '正在保存' : state ? selected.label : '读取权限' }}</span>
          <YjIcon class="yj-control__chevron" name="chevronDown" size="xs" tone="muted" />
        </button>
      </span>
    </template>
    <div ref="menuElement" class="permission-menu chat-control-menu" role="menu" aria-label="权限审批" @keydown="navigate" @keydown.esc.stop.prevent="open = false">
      <button v-for="option in options" :key="option.mode" class="chat-control-option" type="button" role="menuitemradio" :aria-checked="state?.mode === option.mode" :class="{ 'is-full': option.mode === 'full' }" @click="choose(option.mode)">
        <YjIcon :name="option.icon" size="sm" :stroke-width="1.5" :tone="option.mode === 'full' ? 'warning' : 'default'" />
        <span class="permission-option-copy"><span class="permission-option-label">{{ option.label }}</span><span class="permission-option-description">{{ option.description }}</span></span>
        <span class="permission-option-check" aria-hidden="true"><YjIcon v-if="state?.mode === option.mode" name="permissionCheck" size="xs" :stroke-width="1.5" /></span>
      </button>
    </div>
  </NPopover>
  <!-- Naive UI's focus trap locates a DIV root; role=dialog supplies its semantics. -->
  <NModal v-model:show="confirm" :to="confirmationOverlay ?? 'body'" :mask-closable="true" transform-origin="center" @after-enter="focusConfirmation(true)" @after-leave="restoreTriggerFocus">
    <div class="permission-confirm" role="dialog" aria-modal="true" :aria-labelledby="`${confirmationId}-title`" :aria-describedby="`${confirmationId}-description`">
      <header class="permission-confirm-header">
        <YjIcon class="permission-confirm-risk" name="permissionAlert" size="lg" :stroke-width="1.75" />
        <h2 :id="`${confirmationId}-title`">确认允许完全访问?</h2>
        <button class="permission-confirm-close" type="button" aria-label="关闭完全访问确认" @click="confirm = false"><YjIcon name="dismiss" size="sm" /></button>
      </header>
      <div class="permission-confirm-body">
        <p :id="`${confirmationId}-description`" class="permission-confirm-description">开启完全访问后，所有任务将减少确认步骤并直接操作您的电脑，请谨慎操作。包括以下内容：</p>
        <ul class="permission-confirm-capabilities" aria-label="完全访问权限说明">
          <li v-for="capability in fullAccessCapabilities" :key="capability.title">
            <YjIcon :name="capability.icon" size="sm" :stroke-width="1.5" />
            <div><h3>{{ capability.title }}</h3><p>{{ capability.description }}</p></div>
          </li>
        </ul>
        <NCheckbox v-model:checked="riskAcknowledged" class="permission-confirm-acknowledgement" :disabled="blocked" :theme-overrides="acknowledgementTheme">我已了解风险，并对自己的数据安全负责</NCheckbox>
        <div class="permission-confirm-actions">
          <button ref="cancelElement" class="permission-confirm-cancel" type="button" @click="confirm = false">取消</button>
          <button class="permission-confirm-primary" type="button" :disabled="!canApproveFull" @click="approveFull">允许完全访问</button>
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.permission-trigger {
  width: var(--chat-composer-control-width, auto);
  flex: none;
  padding-inline: var(--chat-composer-control-padding, var(--yj-space-3));
  border: 0;
  background: transparent;
  color: var(--yj-color-text-primary);
  cursor: pointer;
}
.permission-trigger-label,
.permission-trigger > .yj-control__chevron { display: var(--chat-composer-control-label-display, inline-flex); }
.permission-trigger-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--yj-space-4);
  height: var(--yj-space-4);
  color: inherit;
}
.permission-trigger-icon .yj-icon { color: inherit; }
.permission-trigger:hover:not(:disabled),
.permission-trigger[aria-expanded="true"] { background: var(--yj-color-control-hover); }
.permission-trigger:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.permission-trigger.is-full { color: var(--yj-color-semantic-warning-ink); }
.permission-trigger:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.permission-trigger:disabled > .yj-icon { color: inherit; }
.permission-menu {
  width: min(var(--yj-layout-permission-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-10)));
}
.permission-menu .chat-control-option[aria-checked="true"]:not(:hover):not(:active) { background: transparent; }
.permission-option-copy { display: grid; gap: var(--yj-space-1); flex: 1; min-width: 0; }
.permission-option-label { font-weight: var(--yj-font-weight-regular); }
.permission-option-description {
  color: color-mix(in srgb, var(--yj-color-text-tertiary) 75%, var(--yj-color-text-secondary));
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.permission-menu button:active .permission-option-description { color: var(--yj-color-text-secondary); }
.permission-menu .is-full .permission-option-label { color: var(--yj-color-semantic-warning-ink); }
.permission-option-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--yj-space-4);
  height: var(--yj-space-4);
  border-radius: var(--yj-radius-full);
}
[aria-checked="true"] .permission-option-check { background: var(--yj-color-brand-primary); }
.permission-option-check .yj-icon { color: var(--yj-color-on-brand); }
.permission-confirm-overlay :deep(.n-modal-mask) {
  background: var(--yj-color-full-access-overlay);
}
.permission-confirm {
  box-sizing: border-box;
  width: min(var(--yj-layout-full-access-confirm-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-10)));
  max-height: calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8));
  overflow-y: auto;
  margin: auto;
  padding: var(--yj-space-6);
  border: 0;
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-elevated);
  color: var(--yj-color-text-primary);
  box-shadow: var(--yj-shadow-modal);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}
.permission-confirm-header {
  display: grid;
  grid-template-columns: var(--yj-space-5) minmax(0, 1fr) var(--yj-space-6);
  align-items: center;
  gap: var(--yj-space-2);
}
.permission-confirm-header h2 {
  margin: 0;
  font-size: var(--yj-font-size-card-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-card-title);
}
.permission-confirm-header .permission-confirm-risk { color: var(--yj-color-full-access-risk); }
.permission-confirm-close {
  display: grid;
  place-items: center;
  width: var(--yj-space-6);
  height: var(--yj-space-6);
  padding: 0;
  border: 0;
  border-radius: var(--yj-radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.permission-confirm-close:hover { background: var(--yj-color-control-hover); }
.permission-confirm-body {
  margin-top: var(--yj-space-5);
  margin-inline-start: calc(var(--yj-space-5) + var(--yj-space-2));
}
.permission-confirm-description { margin: 0; color: var(--yj-color-text-secondary); }
.permission-confirm-capabilities {
  display: grid;
  gap: var(--yj-space-2);
  margin: var(--yj-space-3) 0 0;
  padding: var(--yj-space-4);
  border-radius: var(--yj-radius-xl);
  background: var(--yj-color-full-access-panel);
  list-style: none;
}
.permission-confirm-capabilities li {
  display: grid;
  grid-template-columns: var(--yj-space-4) minmax(0, 1fr);
  align-items: start;
  gap: var(--yj-space-2);
}
.permission-confirm-capabilities li > .yj-icon { margin-top: calc(var(--yj-space-1) / 2); color: var(--yj-color-text-secondary); }
.permission-confirm-capabilities h3 {
  margin: 0;
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-control-line-height);
  font-weight: var(--yj-font-weight-regular);
}
.permission-confirm-capabilities p {
  margin: var(--yj-space-1) 0 0;
  color: var(--yj-color-chat-timing);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-control-line-height);
  overflow-wrap: anywhere;
}
.permission-confirm-acknowledgement { display: flex; margin-top: var(--yj-space-5); }
.permission-confirm-acknowledgement :deep(.n-checkbox__label) { line-height: var(--yj-line-height-body); }
.permission-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--yj-space-3);
  margin-top: var(--yj-space-5);
}
.permission-confirm-actions button {
  box-sizing: border-box;
  height: var(--yj-control-height-sm);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-elevated);
  color: var(--yj-color-text-primary);
  font: inherit;
  font-weight: var(--yj-font-weight-medium);
  cursor: pointer;
}
.permission-confirm-cancel { min-width: calc(var(--yj-space-16) + var(--yj-space-1)); padding: 0 var(--yj-space-4); }
.permission-confirm-cancel:hover { background: var(--yj-color-control-hover); }
.permission-confirm-cancel:active { background: var(--yj-color-control-pressed); }
.permission-confirm-actions .permission-confirm-primary {
  padding: 0 var(--yj-space-3);
  border: 0;
  background: var(--yj-color-full-access-action);
  color: var(--yj-color-text-on-danger);
}
.permission-confirm-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--yj-color-full-access-action) 92%, black); }
.permission-confirm-primary:active:not(:disabled) { background: color-mix(in srgb, var(--yj-color-full-access-action) 84%, black); }
.permission-confirm-actions .permission-confirm-primary:disabled { background: var(--yj-color-full-access-action-disabled); cursor: not-allowed; }
button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-focus-ring-width); }
</style>
