<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NButton, NCard, NInput, NModal, NPopover, NTooltip } from "naive-ui";
import { workspaceNameError, type ChatWorkspace } from "../../domain/chat-workspace";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  entries: readonly ChatWorkspace[];
  selectedProjectId: string | null;
  disabled: boolean;
  loading: boolean;
  error: string;
  rootPath: string;
  createOpen: boolean;
  creating: boolean;
  createError: string;
}>();
const emit = defineEmits<{
  refresh: []; select: [projectId: string | null]; "open-local": [];
  "update:createOpen": [open: boolean]; create: [name: string];
}>();
const open = ref(false), query = ref(""), name = ref(""), attempted = ref(false);
const overlay = ref<HTMLElement | null>(null), trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null), nameInput = ref<InstanceType<typeof NInput> | null>(null);
const selected = computed(() => props.entries.find(entry => entry.project.projectId === props.selectedProjectId));
const filtered = computed(() => props.entries.filter(entry => entry.project.safeName.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const localError = computed(() => attempted.value ? workspaceNameError(name.value) : "");
const triggerLabel = computed(() => selected.value ? `更换工作空间，当前工作空间 ${selected.value.project.safeName}` : "选择工作空间");
watch(open, async value => {
  if (value) { query.value = ""; emit("refresh"); }
  else { await nextTick(); if (!props.disabled && !props.createOpen) trigger.value?.focus({ preventScroll: true }); }
});
watch(() => props.disabled, value => { if (value) open.value = false; });
watch(() => props.createOpen, async value => {
  if (value) { open.value = false; name.value = ""; attempted.value = false; await nextTick(); nameInput.value?.focus(); }
  else { await nextTick(); trigger.value?.focus({ preventScroll: true }); }
});
function choose(id: string | null) { if (props.disabled) return; emit("select", id); open.value = false; }
function create() { attempted.value = true; if (!props.creating && !workspaceNameError(name.value)) emit("create", name.value); }
function navigate(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); open.value = false; return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  if ((event.target as HTMLElement).tagName === "INPUT" && ["Home", "End"].includes(event.key)) return;
  const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)') ?? [])];
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index < 0 ? (event.key === "ArrowUp" ? buttons.length - 1 : 0) : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next]?.focus({ preventScroll: true });
}
async function openByKeyboard() { if (props.disabled) return; open.value = true; await nextTick(); menu.value?.querySelector<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)')?.focus(); }
</script>

<template>
  <Teleport to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <NPopover v-model:show="open" :to="overlay ?? false" trigger="click" placement="top-start" :disabled="disabled" :show-arrow="false" raw>
    <template #trigger>
      <button ref="trigger" class="workspace-trigger chat-composer__project chat-composer__project--button yj-control" type="button" :disabled="disabled" :aria-label="triggerLabel" :title="selected?.path ?? triggerLabel" aria-haspopup="menu" :aria-expanded="open" @keydown.down.prevent="openByKeyboard" @keydown.esc="open = false">
        <YjIcon name="folder" size="sm" :stroke-width="1.5" />
        <span class="workspace-name">{{ selected?.project.safeName ?? '选择工作空间' }}</span>
        <YjIcon name="chevronDown" size="xs" tone="muted" />
      </button>
    </template>
    <div ref="menu" class="workspace-menu chat-control-menu" role="menu" aria-label="选择工作空间" :aria-busy="loading" @keydown="navigate">
      <div class="workspace-search"><NInput v-model:value="query" :input-props="{ 'aria-label': '搜索工作空间' }" placeholder="搜索工作空间" clearable /></div>
      <div class="workspace-list">
        <NTooltip v-for="entry in filtered" :key="entry.project.projectId" :to="overlay ?? false" placement="right" :delay="300">
          <template #trigger>
            <button class="chat-control-option" type="button" role="menuitemradio" :aria-checked="selectedProjectId === entry.project.projectId" :disabled="!entry.project.available" :title="entry.path ?? '工作空间暂不可用'" @click="choose(entry.project.projectId)">
              <YjIcon name="folder" size="sm" :stroke-width="1.5" />
              <span class="workspace-name">{{ entry.project.safeName }}</span>
              <YjIcon v-if="selectedProjectId === entry.project.projectId" name="permissionCheck" size="sm" :stroke-width="1.5" />
            </button>
          </template>
          <span class="workspace-path">{{ entry.path ?? (loading ? '正在读取路径…' : '工作空间路径暂不可用') }}</span>
        </NTooltip>
        <p v-if="!filtered.length" class="workspace-hint">{{ query ? '没有匹配的工作空间' : loading ? '正在读取工作空间…' : '暂无已保存的工作空间' }}</p>
      </div>
      <p v-if="error" class="workspace-error" role="alert">{{ error }} <button type="button" @click="emit('refresh')">重试</button></p>
      <div class="workspace-menu-actions">
        <button class="chat-control-option" type="button" role="menuitem" @click="open = false; emit('update:createOpen', true)"><YjIcon name="plus" size="sm" :stroke-width="1.5" />新建工作空间</button>
        <button class="chat-control-option" type="button" role="menuitem" @click="open = false; emit('open-local')"><YjIcon name="folderOpen" size="sm" :stroke-width="1.5" />打开本地文件夹</button>
        <button v-if="selectedProjectId" class="chat-control-option" type="button" role="menuitem" @click="choose(null)"><YjIcon name="dismiss" size="sm" :stroke-width="1.5" />不使用工作空间</button>
      </div>
    </div>
  </NPopover>
  <NModal :show="createOpen" :mask-closable="!creating" :close-on-esc="!creating" @update:show="emit('update:createOpen', $event)">
    <NCard class="workspace-create" title="新建工作空间" role="dialog" aria-modal="true" aria-label="新建工作空间" :bordered="false">
      <template #header-extra><button class="workspace-close" type="button" aria-label="关闭新建工作空间" :disabled="creating" @click="emit('update:createOpen', false)"><YjIcon name="dismiss" size="md" :stroke-width="1.5" /></button></template>
      <form @submit.prevent="create">
        <p class="workspace-create-description">输入工作空间名称，将在本地创建同名文件夹。</p>
        <label for="workspace-name-input">工作空间名称</label>
        <NInput ref="nameInput" v-model:value="name" :input-props="{ id: 'workspace-name-input', 'aria-describedby': 'workspace-name-help', 'aria-invalid': !!localError || !!createError }" placeholder="例如：市场调研" :disabled="creating" :status="localError || createError ? 'error' : undefined" clearable />
        <p id="workspace-name-help" class="workspace-location">保存位置：<span>{{ rootPath }}</span></p>
        <p v-if="localError || createError" class="workspace-create-error" role="alert">{{ localError || createError }}</p>
        <div class="workspace-create-actions"><NButton :disabled="creating" @click="emit('update:createOpen', false)">取消</NButton><NButton type="primary" attr-type="submit" :loading="creating" :disabled="creating || !name.trim()">{{ creating ? '正在创建' : '确认' }}</NButton></div>
      </form>
    </NCard>
  </NModal>
</template>

<style scoped>
.workspace-trigger { min-width: 0; max-width: min(100%, var(--yj-layout-chat-workspace-control-max)); flex: 0 1 auto; border: 0; color: var(--yj-color-text-primary); background: transparent; cursor: pointer; }
.workspace-trigger > .yj-icon { color: inherit; }
.workspace-trigger:hover:not(:disabled), .workspace-trigger[aria-expanded="true"] { background: var(--yj-color-control-hover); }
.workspace-trigger:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.workspace-trigger:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.workspace-trigger:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.workspace-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.workspace-menu { width: min(var(--yj-layout-workspace-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-10))); }
.workspace-search { padding: var(--yj-space-1) var(--yj-space-1) var(--yj-space-2); }
.workspace-list { max-height: min(var(--yj-layout-workspace-list-max), calc(var(--yj-ui-viewport-height, 100vh) * 0.3)); overflow-y: auto; }
.workspace-menu .chat-control-option { padding: var(--yj-space-2) var(--yj-space-3); }
.workspace-menu-actions { margin-top: var(--yj-space-2); padding-top: var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-default); }
.workspace-hint, .workspace-error { margin: 0; padding: var(--yj-space-2) var(--yj-space-3); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.workspace-error button { padding: 0; border: 0; background: transparent; color: var(--yj-color-text-primary); cursor: pointer; text-decoration: underline; }
.workspace-path { display: inline-block; max-width: min(var(--yj-layout-chat-workspace-control-max), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-10))); overflow-wrap: anywhere; pointer-events: auto; zoom: var(--yj-ui-scale, 1); }
.workspace-create { width: min(var(--yj-layout-workspace-create-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-10))); }
.workspace-close { display: inline-flex; align-items: center; justify-content: center; width: var(--yj-space-8); height: var(--yj-space-8); border: 0; border-radius: var(--yj-radius-md); background: transparent; color: var(--yj-color-text-primary); cursor: pointer; }
.workspace-close:hover:not(:disabled) { background: var(--yj-color-control-hover); }
.workspace-close:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.workspace-close .yj-icon { color: inherit; }
.workspace-close:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); }
.workspace-create-description { margin: 0 0 var(--yj-space-5); color: var(--yj-color-text-body); }
.workspace-create label { display: block; margin-bottom: var(--yj-space-2); color: var(--yj-color-text-primary); }
.workspace-location { margin: var(--yj-space-2) 0 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); overflow-wrap: anywhere; }
.workspace-create-error { margin: var(--yj-space-3) 0 0; color: var(--yj-color-semantic-error-ink); font-size: var(--yj-font-size-body); }
.workspace-create-actions { display: flex; justify-content: flex-end; gap: var(--yj-space-2); margin-top: var(--yj-space-6); }
</style>
