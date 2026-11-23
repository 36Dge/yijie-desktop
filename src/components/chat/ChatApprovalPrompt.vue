<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import type { NativeApprovalOption } from "../../api/runtime-permission-client";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";
import ChatApprovalActions from "./ChatApprovalActions.vue";

const props = defineProps<{
  source: string; icon: YjIconName; question: string;
  disabled: boolean; submitting: boolean; commandPrefix?: readonly string[];
  nativeChoices?: readonly NativeApprovalOption[];
  persistOptions?: readonly ("session" | "always")[];
}>();
const emit = defineEmits<{ native: [id: string]; once: []; reject: []; similar: []; persist: [scope: "session" | "always"] }>();
const card = ref<HTMLElement | null>(null);
const actions = ref<InstanceType<typeof ChatApprovalActions> | null>(null);
const id = useId();

const choices = computed<readonly NativeApprovalOption[]>(() => {
  if (props.nativeChoices) return props.nativeChoices;
  const offered: NativeApprovalOption[] = [
    { id: "once", kind: "allow_once", label: "允许一次" },
    { id: "reject", kind: "decline", label: "拒绝" },
  ];
  if (props.commandPrefix?.length) {
    const detail = props.commandPrefix.map(arg => /^[\p{L}\p{N}_./:=@%+,-]+$/u.test(arg) ? arg : JSON.stringify(arg)).join(" ");
    offered.push({ id: "similar", kind: "command_prefix", label: "允许相似命令", detail });
  }
  for (const scope of props.persistOptions ?? []) {
    offered.push({ id: scope, kind: "allow_scope", label: scope === "session" ? "本会话允许此工具" : "始终允许此工具" });
  }
  return offered;
});

function select(choice: string) {
  if (props.disabled || props.submitting) return;
  if (props.nativeChoices) { emit("native", choice); return; }
  switch (choice) {
    case "once": emit("once"); break;
    case "reject": emit("reject"); break;
    case "similar": emit("similar"); break;
    case "session": case "always": emit("persist", choice); break;
  }
}
onMounted(() => {
  if (document.activeElement === document.body) card.value?.focus({ preventScroll: true });
});
</script>

<template>
  <article ref="card" class="approval-prompt" tabindex="0" role="group" :aria-labelledby="id" :aria-busy="submitting" @keydown="actions?.cardKeys($event)">
    <div class="approval-prompt__body">
      <header><YjIcon :name="icon" size="sm" tone="muted" /><span>{{ source }}</span><slot name="context" /></header>
      <strong :id="id" class="approval-prompt__question yj-selectable-text">{{ question }}</strong>
      <div class="approval-prompt__detail yj-selectable-text"><slot /></div>
    </div>
    <ChatApprovalActions ref="actions" :choices="choices" :disabled="disabled" :submitting="submitting" @select="select">
      <template #extra-action><slot name="extra-action" /></template>
    </ChatApprovalActions>
  </article>
</template>

<style scoped>
.approval-prompt { box-sizing:border-box; width:100%; min-width:0; display:grid; gap:var(--yj-space-4); padding:var(--yj-space-4); border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-xl); background:var(--yj-color-bg-card); color:var(--yj-color-text-primary); }
.approval-prompt__body { min-width:0; max-height:min(32vh, var(--yj-layout-chat-activity-max-height)); overflow:auto; }
header { display:flex; align-items:center; gap:var(--yj-space-2); color:var(--yj-color-text-tertiary); font-size:var(--yj-font-size-caption); }
.approval-prompt__question { display:block; margin-block-start:var(--yj-space-2); font-size:var(--yj-font-size-body); font-weight:var(--yj-font-weight-semibold); overflow-wrap:anywhere; white-space:pre-wrap; }
.approval-prompt__detail { margin-block-start:var(--yj-space-3); color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-code); overflow-wrap:anywhere; }
.approval-prompt__detail :deep(pre) { margin:0; font:inherit; font-family:var(--yj-font-family-mono); white-space:pre-wrap; overflow-wrap:anywhere; }
.approval-prompt:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:var(--yj-space-1); }
</style>
