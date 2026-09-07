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
      <button ref="triggerElement" class="permission-trigger" :class="{ 'is-full': state?.mode === 'full' }" type="button" :disabled="disabled" :aria-label="`权限审批：${state ? selected.label : '读取中'}`" aria-haspopup="menu" :aria-expanded="open" :title="disabled ? '任务运行、等待审批或同步期间不能切换权限' : '更改当前任务的权限审批模式'" @keydown.down.prevent="open = !disabled" @keydown.esc="open = false">
        <YjIcon :name="selected.icon" size="sm" />
        <span>{{ saving ? '正在保存' : state ? selected.label : '读取权限' }}</span>
      </button>
    </template>
    <div ref="menuElement" class="permission-menu" role="menu" aria-label="权限审批" @keydown="navigate" @keydown.esc.stop.prevent="open = false">
      <button v-for="option in options" :key="option.mode" type="button" role="menuitemradio" :aria-checked="state?.mode === option.mode" :class="{ 'is-full': option.mode === 'full' }" @click="choose(option.mode)">
        <YjIcon :name="option.icon" size="lg" />
        <span class="permission-option-copy"><strong>{{ option.label }}</strong><span>{{ option.description }}</span></span>
        <YjIcon v-if="state?.mode === option.mode" name="permissionCheck" size="lg" />
      </button>
    </div>
  </NPopover>
  <NModal v-model:show="confirm" :mask-closable="true">
    <NCard class="permission-confirm" title="开启完全访问权限" role="dialog" aria-modal="true" aria-label="开启完全访问权限" :bordered="false">
      <p>此任务将可以访问互联网、修改项目外的文件并运行命令，无需逐次请求批准。</p>
      <div class="permission-confirm-actions"><button type="button" @click="confirm = false">取消</button><button type="button" class="is-full" @click="approveFull">确认开启</button></div>
    </NCard>
  </NModal>
</template>

<style scoped>
.permission-trigger { display:inline-flex; align-items:center; gap:var(--yj-space-2); border:0; border-radius:var(--yj-radius-full); padding:var(--yj-space-2) var(--yj-space-3); background:var(--yj-color-control-hover); color:var(--yj-color-text-secondary); font:inherit; cursor:pointer; white-space:nowrap; }
.permission-trigger:disabled { opacity:.6; cursor:default; }
.is-full { color:var(--yj-color-semantic-warning-ink) !important; }
.permission-menu { width:min(520px,calc(100vw - 40px)); padding:var(--yj-space-2); background:var(--yj-color-bg-elevated); border:1px solid var(--yj-color-border-default); border-radius:var(--yj-radius-xl); box-shadow:var(--yj-shadow-popover); }
.permission-menu button { display:flex; align-items:center; gap:var(--yj-space-3); width:100%; padding:var(--yj-space-3); border:0; border-radius:var(--yj-radius-lg); text-align:left; color:var(--yj-color-text-primary); background:transparent; font:inherit; cursor:pointer; }
.permission-menu button:hover { background:var(--yj-color-control-hover); }
.permission-option-copy { display:grid; flex:1; min-width:0; gap:var(--yj-space-1); }
.permission-option-copy strong { font-weight:600; }
.permission-option-copy > span { color:var(--yj-color-text-tertiary); font-size:var(--yj-font-size-caption); line-height:1.5; }
.is-full .permission-option-copy > span { color:inherit; }
.permission-confirm { width:min(460px,calc(100vw - 40px)); }
.permission-confirm-actions { display:flex; justify-content:flex-end; gap:var(--yj-space-3); margin-top:var(--yj-space-5); }
.permission-confirm-actions button { font:inherit; border:1px solid var(--yj-color-border-default); border-radius:var(--yj-radius-md); padding:var(--yj-space-2) var(--yj-space-4); background:var(--yj-color-bg-card); cursor:pointer; }
button:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:2px; }
</style>
