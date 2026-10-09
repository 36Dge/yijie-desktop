<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NButton, NSwitch } from "naive-ui";
import { skillFailureMessage, type ManagedSkillProjection } from "../../domain/skill-marketplace";
import { skillCardIcon } from "../../icons/skill-icons";
import ChatResourcePanel from "./ChatResourcePanel.vue";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  entries: readonly ManagedSkillProjection[];
  canManage: boolean;
  disabled: boolean;
  loading: boolean;
  error: string | null;
  operations: Readonly<Record<string, string>>;
  operationErrors: Readonly<Record<string, string>>;
}>();
const emit = defineEmits<{ close: []; manage: []; refresh: []; "enabled-change": [id: string, enabled: boolean] }>();
const query = ref("");
const installed = computed(() => props.entries.filter(entry => entry.installationStatus === "installed"));
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return installed.value.filter(entry => `${entry.displayName} ${entry.description} ${entry.runtimeName}`.toLocaleLowerCase().includes(search));
});
function status(entry: ManagedSkillProjection): string {
  if (props.operations[entry.id]) return "正在同步…";
  return props.operationErrors[entry.id] ?? skillFailureMessage(entry.failureCode) ??
    (entry.enabled && !entry.runtimeVisible ? "等待同步" : "");
}
function setEnabled(entry: ManagedSkillProjection, value: boolean): void {
  if (props.disabled || !props.canManage || props.operations[entry.id]) return;
  emit("enabled-change", entry.id, value);
}
function manage(): void { emit("close"); emit("manage"); }
watch(() => props.disabled, disabled => { if (disabled) emit("close"); });
onMounted(() => emit("refresh"));
</script>

<template>
  <ChatResourcePanel title="技能" v-model:query="query" :loading="loading" @manage="manage">
    <p v-if="loading" class="skill-menu__notice" role="status">正在读取技能状态…</p>
    <div v-if="error" class="skill-menu__notice" role="alert"><p>{{ error }}</p><NButton size="small" :disabled="loading" @click="$emit('refresh')">重试</NButton></div>
    <p v-if="!canManage" class="skill-menu__notice">当前账号没有管理技能的权限。</p>
    <ul v-if="filtered.length" class="skill-menu__list" aria-label="已安装的技能">
      <li v-for="entry in filtered" :key="entry.id" :aria-busy="Boolean(operations[entry.id])">
        <YjIcon :name="skillCardIcon(entry)" size="md" />
        <span class="skill-menu__copy"><span :title="entry.displayName">{{ entry.displayName }}</span><span v-if="status(entry)" class="skill-menu__status" :class="{ 'skill-menu__status--error': operationErrors[entry.id] || skillFailureMessage(entry.failureCode) }" :role="operationErrors[entry.id] ? 'alert' : undefined">{{ status(entry) }}</span></span>
        <NSwitch size="small" :value="entry.enabled" :loading="Boolean(operations[entry.id])" :disabled="disabled || !canManage || Boolean(operations[entry.id])" :aria-disabled="disabled || !canManage || Boolean(operations[entry.id])" :aria-label="`${entry.enabled ? '停用' : '启用'} ${entry.displayName}`" @update:value="setEnabled(entry, $event)" />
      </li>
    </ul>
    <div v-else-if="!loading && !error" class="skill-menu__empty"><span>{{ installed.length ? '没有找到匹配的技能' : '还没有安装技能' }}</span><NButton v-if="query" quaternary @click="query = ''">清空搜索</NButton></div>
  </ChatResourcePanel>
</template>

<style scoped>
.skill-menu__notice { margin: 0; padding: var(--yj-space-2) var(--yj-space-4); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.skill-menu__notice p { margin: 0 0 var(--yj-space-2); }
.skill-menu__list { list-style: none; padding: var(--yj-space-1) var(--yj-space-3); margin: 0; }
.skill-menu__list li { display: flex; align-items: center; gap: var(--yj-space-2); min-height: var(--yj-control-height-lg); padding: var(--yj-space-2) 0; }
.skill-menu__copy { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: var(--yj-space-1); font-size: var(--yj-font-size-body); }
.skill-menu__copy > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-menu__status { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); overflow-wrap: anywhere; }
.skill-menu__status--error { color: var(--yj-color-semantic-error-ink); }
.skill-menu__empty { display: flex; flex-direction: column; align-items: center; gap: var(--yj-space-3); padding: var(--yj-space-5) var(--yj-space-3); text-align: center; }
.skill-menu__empty > span { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
</style>
