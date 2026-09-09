<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NCard, NModal, NPopover } from "naive-ui";
import type { ChatPermissionState, PermissionMode } from "../../api/runtime-permission-client";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{ state: ChatPermissionState | null; disabled: boolean; saving: boolean }>();
const emit = defineEmits<{ select: [mode: PermissionMode, confirmFullAccess: boolean] }>();
const open = ref(false);
const confirm = ref(false);
const triggerElement = ref<HTMLButtonElement | null>(null);
const menuElement = ref<HTMLElement | null>(null);
const options: { mode: PermissionMode; label: string; description: string; icon: YjIconName }[] = [
  { mode: "ask", label: "请求批准", description: "编辑外部文件和使用互联网时始终询问", icon: "permissionHand" },
  { mode: "auto", label: "帮我批准", description: "仅对检测到的风险操作请求批准", icon: "shield" },
  { mode: "full", label: "完全访问权限", description: "可不受限制地访问互联网和你电脑上的任何文件", icon: "permissionAlert" },
];
const selected = computed(() => options.find((o) => o.mode === props.state?.mode) ?? options[0]!);
watch(() => props.disabled, (value) => { if (value) { open.value = false; confirm.value = false; } });
watch(open, async (value) => {
  await nextTick();
  if (value && open.value) menuElement.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  else if (!value && !props.disabled) triggerElement.value?.focus();
});
function choose(mode: PermissionMode): void {
  if (props.disabled || !props.state) return;
  open.value = false;
  if (mode === "full" && !props.state.fullAccessConfirmed) { confirm.value = true; return; }
  emit("select", mode, false);
}
function approveFull(): void { if (!props.disabled) { confirm.value = false; emit("select", "full", true); } }
function navigate(event: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
</script>

<template>
  <NPopover v-model:show="open" trigger="click" placement="top-start" :disabled="disabled" :show-arrow="false" raw>
    <template #trigger>
      <button ref="triggerElement" class="permission-trigger yj-control yj-control--pill" :class="{ 'is-full': state?.mode === 'full' }" type="button" :disabled="disabled" :aria-label="`权限审批：${state ? selected.label : '读取中'}`" aria-haspopup="menu" :aria-expanded="open" :title="disabled ? '任务运行、等待审批或同步期间不能切换权限' : '更改当前任务的权限审批模式'" @keydown.down.prevent="open = !disabled" @keydown.esc="open = false">
        <span class="permission-trigger-icon"><YjIcon :name="selected.icon" size="sm" /></span>
        <span>{{ saving ? '正在保存' : state ? selected.label : '读取权限' }}</span>
      </button>
    </template>
    <div ref="menuElement" class="permission-menu" role="menu" aria-label="权限审批" @keydown="navigate" @keydown.esc.stop.prevent="open = false">
      <button v-for="option in options" :key="option.mode" type="button" role="menuitemradio" :aria-checked="state?.mode === option.mode" :class="{ 'is-full': option.mode === 'full' }" @click="choose(option.mode)">
        <YjIcon :name="option.icon" size="md" :tone="option.mode === 'full' ? 'warning' : 'default'" />
        <span class="permission-option-copy"><strong>{{ option.label }}</strong><span>{{ option.description }}</span></span>
        <span class="permission-option-check" aria-hidden="true"><YjIcon v-if="state?.mode === option.mode" name="permissionCheck" size="xs" /></span>
      </button>
    </div>
  </NPopover>
  <NModal v-model:show="confirm" :mask-closable="true">
    <NCard class="permission-confirm" title="开启完全访问权限" role="dialog" aria-modal="true" aria-label="开启完全访问权限" :bordered="false">
      <p>此任务将可以访问互联网、修改项目外的文件并运行命令，无需逐次请求批准。</p>
      <div class="permission-confirm-actions"><button type="button" class="yj-control yj-control--regular" @click="confirm = false">取消</button><button type="button" class="permission-confirm-primary yj-control yj-control--regular" @click="approveFull">确认开启</button></div>
    </NCard>
  </NModal>
</template>

<style scoped>
.permission-trigger {
  padding-inline-start: var(--yj-space-1);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  background: var(--yj-color-bg-card);
  color: var(--yj-color-text-primary);
  cursor: pointer;
}
.permission-trigger-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--yj-space-6);
  height: var(--yj-space-6);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-brand-primary);
  color: var(--yj-color-on-brand);
}
.permission-trigger-icon .yj-icon { color: inherit; }
.permission-trigger:hover:not(:disabled) { background: var(--yj-color-control-hover); }
.permission-trigger:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.permission-trigger[aria-expanded="true"]:not(.is-full) {
  background: var(--yj-color-brand-primary);
  border-color: var(--yj-color-brand-primary);
  color: var(--yj-color-on-brand);
}
.permission-trigger.is-full { color: var(--yj-color-semantic-warning-ink); }
.permission-trigger.is-full .permission-trigger-icon {
  background: var(--yj-color-warning-soft);
  color: var(--yj-color-semantic-warning-ink);
}
.permission-trigger:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.permission-trigger:disabled .permission-trigger-icon {
  background: var(--yj-color-control-disabled-bg);
  color: var(--yj-color-text-disabled);
}
.permission-menu {
  width: min(var(--yj-layout-permission-menu-width), calc(100vw - var(--yj-space-10)));
  padding: var(--yj-space-2);
  background: var(--yj-color-bg-elevated);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
  box-shadow: var(--yj-shadow-popover);
}
.permission-menu button {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  width: 100%;
  padding: var(--yj-space-2);
  border: 0;
  border-radius: var(--yj-radius-md);
  text-align: left;
  color: var(--yj-color-text-primary);
  background: transparent;
  font: inherit;
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  cursor: pointer;
}
.permission-menu button:hover,
.permission-menu button[aria-checked="true"] { background: var(--yj-color-control-hover); }
.permission-menu button:active { background: var(--yj-color-control-pressed); }
.permission-option-copy { display: grid; flex: 1; min-width: 0; }
.permission-option-copy strong { font-weight: var(--yj-font-weight-semibold); }
.permission-option-copy > span {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.permission-menu .is-full strong { color: var(--yj-color-semantic-warning-ink); }
.permission-option-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--yj-space-5);
  height: var(--yj-space-5);
  border-radius: var(--yj-radius-full);
}
[aria-checked="true"] .permission-option-check { background: var(--yj-color-brand-primary); }
.permission-option-check .yj-icon { color: var(--yj-color-on-brand); }
.permission-confirm { width: min(var(--yj-layout-permission-confirm-width), calc(100vw - var(--yj-space-10))); }
.permission-confirm p { margin: 0; color: var(--yj-color-text-body); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.permission-confirm-actions { display: flex; justify-content: flex-end; gap: var(--yj-space-2); margin-top: var(--yj-space-5); }
.permission-confirm-actions button { border: var(--yj-border-width) solid var(--yj-color-border-default); color: var(--yj-color-text-primary); background: var(--yj-color-bg-card); cursor: pointer; }
.permission-confirm-actions button:hover { background: var(--yj-color-control-hover); }
.permission-confirm-actions button:active { background: var(--yj-color-control-pressed); }
.permission-confirm-actions .permission-confirm-primary { border-color: var(--yj-color-brand-primary); background: var(--yj-color-brand-primary); color: var(--yj-color-on-brand); }
.permission-confirm-actions .permission-confirm-primary:hover { border-color: var(--yj-color-brand-hover); background: var(--yj-color-brand-hover); }
.permission-confirm-actions .permission-confirm-primary:active { border-color: var(--yj-color-brand-active); background: var(--yj-color-brand-active); }
button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-focus-ring-width); }
</style>
