<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NButton } from "naive-ui";
import { skillFailureMessage, type ManagedSkillProjection } from "../../domain/skill-marketplace";
import { skillCardArtwork } from "../../icons/skill-artwork";
import { matchingChatSkills, skillSelectionIssue } from "../../domain/chat-skills";
import ChatResourceOption from "./ChatResourceOption.vue";
import ChatResourcePanel from "./ChatResourcePanel.vue";

const props = defineProps<{
  entries: readonly ManagedSkillProjection[];
  selectedIds?: readonly string[];
  disabled: boolean;
  loading: boolean;
  refreshing?: boolean;
  error: string | null;
  operations: Readonly<Record<string, string>>;
  operationErrors: Readonly<Record<string, string>>;
}>();
const emit = defineEmits<{ close: [reason?: "selection"]; manage: []; refresh: []; select: [id: string] }>();
const query = ref("");
const enabled = computed(() => props.entries.filter(entry => entry.installationStatus === "installed" && entry.enabled));
const filtered = computed(() => matchingChatSkills(enabled.value, query.value));
function status(entry: ManagedSkillProjection): string {
  if (props.operations[entry.id]) return "正在同步…";
  return props.operationErrors[entry.id] ?? skillFailureMessage(entry.failureCode) ??
    (!entry.runtimeVisible ? "等待同步" : "");
}
function selected(entry: ManagedSkillProjection): boolean { return props.selectedIds?.includes(entry.id) ?? false; }
function unavailable(entry: ManagedSkillProjection): boolean { return props.disabled || Boolean(props.operations[entry.id]) || (!selected(entry) && skillSelectionIssue(entry) !== null); }
function select(entry: ManagedSkillProjection): void {
  if (unavailable(entry)) return;
  emit("select", entry.id);
  emit("close", "selection");
}
function manage(): void { emit("close"); emit("manage"); }
watch(() => props.disabled, disabled => { if (disabled) emit("close"); });
onMounted(() => emit("refresh"));
</script>

<template>
  <ChatResourcePanel class="skill-menu" title="技能" v-model:query="query" :loading="loading || refreshing" @manage="manage">
    <p v-if="loading" class="skill-menu__notice" role="status">正在读取技能状态…</p>
    <p v-else-if="refreshing" class="skill-menu__refresh-status" role="status">正在更新技能状态…</p>
    <div v-if="error" class="skill-menu__notice" role="alert"><p>{{ error }}</p><NButton size="small" :disabled="loading || refreshing" @click="$emit('refresh')">重试</NButton></div>
    <ul v-if="filtered.length" class="skill-menu__list" aria-label="已启用的技能">
      <li v-for="entry in filtered" :key="entry.id" :aria-busy="Boolean(operations[entry.id])">
        <ChatResourceOption :name="entry.displayName" :selected="selected(entry)" :disabled="unavailable(entry)" @click="select(entry)">
          <template #icon><img class="skill-menu__icon" :src="skillCardArtwork(entry)" alt="" aria-hidden="true" draggable="false" /></template>
          <span v-if="status(entry)" class="skill-menu__status" :class="{ 'skill-menu__status--error': operationErrors[entry.id] || skillFailureMessage(entry.failureCode) }" :role="operationErrors[entry.id] ? 'alert' : undefined">{{ status(entry) }}</span>
        </ChatResourceOption>
      </li>
    </ul>
    <div v-else-if="!loading && !error" class="skill-menu__empty"><span>{{ enabled.length ? '没有找到匹配的技能' : '暂无已安装且启用的技能' }}</span><NButton v-if="query" quaternary @click="query = ''">清空搜索</NButton></div>
  </ChatResourcePanel>
</template>

<style scoped>
.skill-menu__refresh-status { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; margin: -1px; clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
.skill-menu__icon { display: block; width: var(--yj-space-6); height: var(--yj-space-6); flex: none; object-fit: cover; border-radius: var(--yj-radius-sm); }
.skill-menu__notice { margin: 0; padding: var(--yj-space-2) var(--yj-space-4); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.skill-menu__notice p { margin: 0 0 var(--yj-space-2); }
.skill-menu__list { list-style: none; padding: var(--yj-space-1) var(--yj-space-2); margin: 0; }
.skill-menu__status { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); overflow-wrap: anywhere; }
.skill-menu__status--error { color: var(--yj-color-semantic-error-ink); }
.skill-menu__empty { display: flex; flex-direction: column; align-items: center; gap: var(--yj-space-3); padding: var(--yj-space-5) var(--yj-space-3); text-align: center; }
.skill-menu__empty > span { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
</style>
