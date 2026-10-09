<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NPopover, NTooltip } from "naive-ui";
import type { Catalog, ProfileId } from "../../api/chat-model-client";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  catalog: Catalog | null;
  profile: ProfileId | null;
  disabled: boolean;
  disabledReason?: string;
  loading: boolean;
  saving: boolean;
  error: string;
}>();
const emit = defineEmits<{ select: [id: ProfileId]; retry: [] }>();
const overlay = ref<HTMLElement | null>(null);
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const presentation: Record<ProfileId, { label: string; icon: YjIconName }> = {
  "kimi-k3-max-v1": { label: "Kimi-K3", icon: "modelKimi" },
  "minimax-m3-high-v1": { label: "MiniMax-M3", icon: "modelMiniMax" },
};
// Display-only placeholders deliberately have no runtime profile IDs or handlers.
const upcomingModels: readonly { label: string; icon: YjIconName }[] = [
  { label: "Deepseek-V4-Pro", icon: "modelDeepSeek" },
  { label: "GLM-5.3", icon: "modelGlm" },
];
const selected = computed(() => props.profile ? presentation[props.profile] : null);
const label = computed(() => props.saving ? "正在切换模型…" : props.loading ? "模型加载中" : selected.value?.label ?? "模型待识别");
const unavailable = computed(() => props.catalog?.models.find((entry) => entry.profile.profile_id === props.profile)?.available === false);
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
      <button ref="trigger" class="model-trigger yj-control yj-control--pill" type="button" :disabled="blocked" :aria-label="`选择对话模型，当前 ${label}`" :aria-expanded="open" aria-haspopup="menu" :title="disabled ? (disabledReason ?? '当前任务结束后可切换模型') : unavailable ? '模型未配置，请选择可用模型' : label" @keydown.stop @keydown.down.prevent="open = !blocked" @keydown.esc="open = false">
        <span v-if="selected" class="model-brand model-trigger-brand" :class="{ 'is-kimi': selected.icon === 'modelKimi' }"><YjIcon :name="selected.icon" size="sm" /></span>
        <span>{{ label }}</span>
        <YjIcon class="yj-control__chevron" name="chevronDown" size="xs" tone="muted" />
      </button>
    </template>
    <div ref="menu" class="model-menu chat-control-menu" role="menu" aria-label="对话模型" @keydown="key">
      <button v-for="entry in catalog?.models ?? []" :key="entry.profile.profile_id" class="chat-control-option" type="button" role="menuitemradio" :aria-checked="entry.profile.profile_id === profile" :disabled="!entry.available" @click="choose(entry.profile.profile_id)">
        <span class="model-brand" :class="{ 'is-kimi': presentation[entry.profile.profile_id].icon === 'modelKimi' }"><YjIcon :name="presentation[entry.profile.profile_id].icon" size="sm" /></span>
        <span class="model-option-label">{{ presentation[entry.profile.profile_id].label }}</span>
        <span v-if="!entry.available" class="model-option-status">模型未配置</span>
      </button>
      <span v-if="!catalog?.models.length" class="model-menu-empty">暂无可用模型</span>
      <NTooltip v-for="entry in upcomingModels" :key="entry.label" :to="overlay ?? false" placement="top" :show-arrow="false" :style="{ zoom: 'var(--yj-ui-scale, 1)' }">
        <template #trigger>
          <span class="model-coming-soon">
            <button class="chat-control-option" type="button" role="menuitemradio" :aria-checked="false" :aria-label="`${entry.label}，即将支持`" disabled>
              <span class="model-brand"><YjIcon :name="entry.icon" size="sm" /></span>
              <span class="model-option-label">{{ entry.label }}</span>
            </button>
          </span>
        </template>
        即将支持
      </NTooltip>
    </div>
  </NPopover>
  <button v-if="error" class="model-retry yj-control" type="button" :disabled="saving || disabled" :title="error" aria-label="重试模型操作" @click="emit('retry')">重试</button>
  <span class="sr-only" role="status">{{ error || (unavailable ? '模型未配置' : '') }}</span>
</template>

<style scoped>
.model-trigger {
  gap: var(--yj-space-1);
  padding-inline: var(--yj-space-2);
  border: 0;
  background: transparent;
  color: var(--yj-color-text-primary);
  font-weight: var(--yj-font-weight-regular);
  cursor: pointer;
}
.model-trigger:hover:not(:disabled),
.model-trigger[aria-expanded="true"] { background: var(--yj-color-control-hover); }
.model-trigger:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.model-trigger:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.model-trigger:focus-visible,
.model-retry:focus-visible {
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
.model-trigger-brand { border-radius: var(--yj-radius-full); }
.model-menu {
  width: min(var(--yj-layout-model-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-10)));
}
.model-option-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.model-menu [aria-checked="true"] .model-option-label { font-weight: var(--yj-font-weight-semibold); }
.model-option-status { font-size: var(--yj-font-size-caption); }
.model-coming-soon { display: block; cursor: not-allowed; }
/* Let the wrapper receive hover events even in browsers that suppress them on disabled buttons. */
.model-coming-soon button { pointer-events: none; }
.model-menu-empty { display: block; padding: var(--yj-space-3); color: var(--yj-color-text-secondary); }
.model-retry { color: var(--yj-color-semantic-warning-ink); }
</style>
