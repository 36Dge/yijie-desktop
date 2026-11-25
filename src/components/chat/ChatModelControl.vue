<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NPopover } from "naive-ui";
import type { Catalog, ProfileId } from "../../api/chat-model-client";
import { CHAT_COMPOSER_DEFAULT_PROFILE } from "../../domain/chat-composer-draft";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";
import YjTooltip from "../yijie/YjTooltip.vue";

const props = defineProps<{
  catalog: Catalog | null;
  profile: ProfileId | null;
  disabled: boolean;
  disabledReason?: string;
  loading: boolean;
  saving: boolean;
}>();
const emit = defineEmits<{ select: [id: ProfileId] }>();
const overlay = ref<HTMLElement | null>(null);
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const presentation: Record<ProfileId, { label: string; icon: YjIconName; triggerLabel?: string }> = {
  "kimi-k3-max-v1": { label: "Kimi-K3", icon: "modelKimi" },
  "kimi-k3-1-pro-high-v1": { label: "Kimi K3.1 Pro", icon: "modelKimi" },
  "kimi-k3-1-pro-max-v1": { label: "Kimi K3.1 Pro", icon: "modelKimi", triggerLabel: "Kimi K3.1 Pro · max" },
  "minimax-m3-high-v1": { label: "MiniMax-M3", icon: "modelMiniMax" },
};
// Display-only placeholders deliberately have no runtime profile IDs or handlers.
const upcomingModels: readonly { label: string; icon: YjIconName }[] = [
  { label: "Deepseek-V4-Pro", icon: "modelDeepSeek" },
  { label: "GLM-5.4", icon: "modelGlm" },
];
const upcomingHint = "即将支持";
const selected = computed(() => props.profile ? presentation[props.profile] : null);
const busyLabel = computed(() => props.saving ? "正在切换模型…" : props.loading ? "模型加载中" : "");
const label = computed(() => selected.value?.triggerLabel ?? selected.value?.label ?? (busyLabel.value || "模型待识别"));
const retired = computed(() => props.catalog?.schema_version === 2 && props.profile === "kimi-k3-max-v1");
// The max profile stays visible on a conversation that was opened with it.
const modelOptions = computed(() => {
  const visible = props.catalog?.models.filter(
    entry => entry.profile.profile_id !== "kimi-k3-1-pro-max-v1" || entry.profile.profile_id === props.profile,
  ) ?? [];
  return visible.sort((left, right) =>
    Number(right.profile.profile_id === CHAT_COMPOSER_DEFAULT_PROFILE) -
    Number(left.profile.profile_id === CHAT_COMPOSER_DEFAULT_PROFILE));
});
const selectedAvailability = computed(() => props.catalog?.models.find((entry) => entry.profile.profile_id === props.profile));
const unavailable = computed(() => selectedAvailability.value?.available === false);
function unavailableLabel(reason?: string): string {
  if (reason === "activation_required") return "模型暂未启用";
  if (reason === "runtime_unavailable") return "模型暂不可用";
  return "模型未配置";
}
const blocked = computed(() => props.disabled || props.loading || props.saving);
watch(blocked, (value) => { if (value) open.value = false; });
watch(open, async (value) => {
  await nextTick();
  if (value && open.value) {
    (menu.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)')
      ?? menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
  } else if (!value && !blocked.value) trigger.value?.focus({ preventScroll: true });
});
function choose(id: ProfileId): void {
  if (blocked.value) return;
  open.value = false;
  emit("select", id);
}
function key(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === "Escape") { open.value = false; return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = [...menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? []];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
  items[next]?.focus({ preventScroll: true });
}
</script>

<template>
  <Teleport to="body"><div ref="overlay" class="model-overlay chat-control-overlay" /></Teleport>
  <NPopover :to="overlay ?? false" v-model:show="open" trigger="click" placement="top-end" :show-arrow="false" :disabled="blocked" raw>
    <template #trigger>
      <span class="chat-control-anchor">
        <button ref="trigger" class="model-trigger yj-control yj-control--pill" type="button"
          :disabled="blocked" :aria-busy="!!busyLabel || undefined"
          :aria-label="`选择对话模型，当前 ${label}${retired ? '（已退役）' : ''}`"
          :aria-description="busyLabel || (disabled ? disabledReason : undefined)"
          :aria-expanded="open" aria-haspopup="menu"
          @keydown.stop @keydown.down.prevent="open = !blocked" @keydown.esc="open = false">
          <span class="model-brand model-trigger-brand" :class="{ 'is-kimi': selected?.icon === 'modelKimi' }">
            <YjIcon :name="selected?.icon ?? 'assistant'" size="sm" />
          </span>
          <span class="model-trigger-label">{{ label }}<small v-if="retired" class="model-retired">已退役</small></span>
          <YjIcon class="yj-control__chevron" :name="busyLabel ? 'pending' : 'chevronDown'" size="xs" tone="muted" />
        </button>
      </span>
    </template>
    <div ref="menu" class="model-menu chat-control-menu" role="menu" aria-label="对话模型" @keydown="key">
      <button v-for="entry in modelOptions" :key="entry.profile.profile_id" class="chat-control-option" type="button" role="menuitemradio" :aria-checked="entry.profile.profile_id === profile" :disabled="!entry.available" @click="choose(entry.profile.profile_id)">
        <span class="model-brand" :class="{ 'is-kimi': presentation[entry.profile.profile_id].icon === 'modelKimi' }"><YjIcon :name="presentation[entry.profile.profile_id].icon" size="sm" /></span>
        <span class="model-option-label">{{ presentation[entry.profile.profile_id].label }}</span>
        <span v-if="!entry.available" class="model-option-status">{{ unavailableLabel(entry.reason) }}</span>
      </button>
      <span v-if="!catalog?.models.length" class="model-menu-empty">暂无可用模型</span>
      <YjTooltip v-for="entry in upcomingModels" :key="entry.label" :text="upcomingHint" placement="right" to="body" :keep-alive-on-hover="false">
        <span class="model-upcoming-option">
          <button class="chat-control-option" type="button" role="menuitemradio" :aria-checked="false" :aria-label="`${entry.label}，${upcomingHint}`" disabled>
            <span class="model-brand"><YjIcon :name="entry.icon" size="sm" /></span>
            <span class="model-option-label">{{ entry.label }}</span>
          </button>
        </span>
      </YjTooltip>
    </div>
  </NPopover>
  <span class="model-status" role="status">{{ busyLabel || (unavailable ? unavailableLabel(selectedAvailability?.reason) : '') }}</span>
</template>

<style scoped>
.model-trigger {
  width: var(--chat-composer-control-width, auto);
  flex: none;
  gap: var(--yj-space-1);
  padding-inline: var(--chat-composer-control-padding, var(--yj-space-2));
  border: 0;
  background: transparent;
  color: var(--yj-color-text-primary);
  font-weight: var(--yj-font-weight-regular);
  cursor: pointer;
}
.model-trigger-label,
.model-trigger > .yj-control__chevron { display: var(--chat-composer-control-label-display, inline-flex); }
.model-trigger-label {
  inline-size: var(--yj-layout-model-label-width);
  align-items: center;
  gap: var(--yj-space-1);
}
.model-retired { font-size: var(--yj-font-size-caption); }
.model-trigger:hover:not(:disabled),
.model-trigger[aria-expanded="true"] { background: var(--yj-color-control-hover); }
.model-trigger:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.model-trigger:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.model-trigger[aria-busy="true"] { color: var(--yj-color-text-primary); cursor: progress; }
.model-trigger:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-focus-ring-width);
}
.model-brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--yj-space-4);
  height: var(--yj-space-4);
  border-radius: var(--yj-radius-xs);
  color: inherit;
}
.model-brand .yj-icon { color: inherit; }
.model-brand.is-kimi {
  background: var(--yj-color-model-kimi-bg);
  color: var(--yj-color-model-kimi-ink);
}
.model-menu {
  width: min(var(--yj-layout-model-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-10)));
}
.model-option-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.model-menu [aria-checked="true"] .model-option-label { font-weight: var(--yj-font-weight-semibold); }
.model-option-status { font-size: var(--yj-font-size-caption); }
.model-upcoming-option { display: block; }
.model-upcoming-option > button { pointer-events: none; }
.model-menu-empty { display: block; padding: var(--yj-space-3); color: var(--yj-color-text-secondary); }
.model-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
