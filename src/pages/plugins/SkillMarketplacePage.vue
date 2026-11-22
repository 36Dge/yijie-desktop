<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  NAlert,
  NButton,
  NCard,
  NModal,
  NSkeleton,
  useMessage,
} from "naive-ui";
import { nativeSkillFailureMessage } from "../../domain/native-skill-marketplace";
import { skillNativeClient } from "../../api/skill-native-client";
import { usePermissionStore } from "../../stores/permission.store";
import {
  skillNativeFailureMessage,
  useSkillStore,
} from "../../stores/skill.store";
import SkillCard from "../../components/skills/SkillCard.vue";
import YjEmpty from "../../components/yijie/YjEmpty.vue";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjRefreshButton from "../../components/yijie/YjRefreshButton.vue";
import YjSection from "../../components/yijie/YjSection.vue";
import ExtensionImportButton from "./ExtensionImportButton.vue";
import SkillImportDialog from "./SkillImportDialog.vue";

const props = withDefaults(defineProps<{ title?: string; embedded?: boolean; active?: boolean; query?: string }>(), { title: "Skill 广场", embedded: false, active: true, query: "" });

const permissionStore = usePermissionStore();
const skillStore = useSkillStore();
const message = useMessage();
const importDialogOpen = ref(false);
const uninstallTargetId = ref<string | null>(null);
let uninstallTrigger: HTMLElement | null = null;
let unlistenDirectoryChanged: UnlistenFn | null = null;
let pageUnmounted = false;

const acceptanceEnvironment = import.meta.env.VITE_YIJIE_FEAT174_ACCEPTANCE === "true";
const canManage = computed(() => permissionStore.hasCapability("plugin.manage"));
const canImport = computed(() => skillStore.canImport && canManage.value);
const rescanDisabled = computed(() => skillStore.phase === "loading" || Object.keys(skillStore.operations).length > 0);
const importDisabled = computed(() => skillStore.phase === "loading" || skillStore.importing);
const visibleCategories = computed(() => {
  const keyword = props.query.trim().toLocaleLowerCase();
  if (!keyword) return skillStore.categories;
  return skillStore.categories.map(category => ({
    ...category,
    skills: category.skills.filter(skill =>
      [skill.displayName, skill.description, category.label, skill.runtimeName, skill.id]
        .some(field => field.toLocaleLowerCase().includes(keyword)),
    ),
  })).filter(category => category.skills.length > 0);
});
const visibleSkillCount = computed(() => {
  if (skillStore.phase !== "ready" && skillStore.phase !== "empty") return null;
  return visibleCategories.value.reduce((total, category) => total + category.skills.length, 0);
});
// A toggle already has a progress indicator on its card. Keep the cancel
// action there too, so a routine receipt doesn't move the switch under the pointer.
const pendingCardToggles = computed(() => {
  const ids = new Map<string, string>();
  if (skillStore.phase !== "ready" || !canManage.value) return ids;
  for (const operation of skillStore.pendingOperations) {
    const action = skillStore.operations[operation.skill_id];
    if (operation.state !== "pending" || operation.error_code || (action !== "enable" && action !== "disable")) continue;
    if (visibleCategories.value.some(category => category.skills.some(skill => skill.id === operation.skill_id && skill.installationStatus === "installed"))) {
      ids.set(operation.skill_id, operation.operation_id);
    }
  }
  return ids;
});
const pendingNotices = computed(() => skillStore.pendingOperations.filter(
  operation => pendingCardToggles.value.get(operation.skill_id) !== operation.operation_id,
));
const uninstallTarget = computed(() =>
  skillStore.skills.find((skill) => skill.id === uninstallTargetId.value) ?? null,
);
const uninstallPending = computed(() =>
  uninstallTargetId.value !== null &&
  skillStore.operations[uninstallTargetId.value] === "uninstall",
);
const refreshFailure = computed(() =>
  skillStore.readFailureMessage ?? (skillStore.lastFailure === null ? null : skillNativeFailureMessage(skillStore.lastFailure)),
);

async function loadPage(): Promise<void> {
  await skillStore.open(canManage.value);
}

async function retry(): Promise<void> {
  if (!props.active) return;
  await skillStore.refresh(canManage.value, "user_retry");
}

defineExpose({
  rescan: retry,
  refreshing: computed(() => skillStore.refreshing),
  rescanDisabled,
  canImport,
  importDisabled,
  openImportDialog,
});

function openImportDialog(): void {
  if (!props.active || !canImport.value || importDisabled.value) return;
  skillStore.importError = null;
  importDialogOpen.value = true;
}

function closeImportDialog(): void {
  importDialogOpen.value = false;
  skillStore.importError = null;
}

function imported(): void {
  closeImportDialog();
  message.success("技能已导入并安装。已有技能会保留原启停状态。", { duration: 3000 });
}

async function handleInstall(skillId: string): Promise<void> {
  if (!props.active || !canManage.value) return;
  const installed = await skillStore.install(skillId);
  if (installed) message.success("Skill 已安装并默认启用。", { duration: 3000 });
  else message.error(skillStore.operationErrors[skillId] ?? "Skill 安装未完成，请稍后重试。");
}

async function handleEnabledChange(skillId: string, enabled: boolean): Promise<void> {
  if (!props.active || !canManage.value) return;
  const updated = await skillStore.setEnabled(skillId, enabled);
  if (!updated) message.error(skillStore.operationErrors[skillId] ?? "Skill 状态更新失败，请稍后重试。");
  else if (skillStore.skills.find(skill => skill.id === skillId)?.enabled === enabled) {
    message.success(enabled ? "Skill 已启用。" : "Skill 已停用。");
  }
}

function requestUninstall(skillId: string, trigger: HTMLElement): void {
  if (!props.active || !canManage.value) return;
  skillStore.clearOperationError(skillId);
  uninstallTrigger = trigger;
  uninstallTargetId.value = skillId;
}

async function restoreUninstallTrigger(): Promise<void> {
  await nextTick();
  uninstallTrigger?.focus();
  uninstallTrigger = null;
}

async function closeUninstallDialog(): Promise<void> {
  if (uninstallPending.value) return;
  uninstallTargetId.value = null;
  await restoreUninstallTrigger();
}

async function confirmUninstall(): Promise<void> {
  if (!props.active) return;
  const target = uninstallTarget.value;
  if (target === null || !canManage.value) return;
  const uninstalled = await skillStore.uninstall(target.id);
  if (!uninstalled) {
    message.error(skillStore.operationErrors[target.id] ?? "Skill 卸载失败，请稍后重试。");
    return;
  }
  uninstallTargetId.value = null;
  message.success("Skill 已卸载。内置资源仍可用于重新安装。");
  await restoreUninstallTrigger();
}

function handleWindowFocus(): void {
  if (!props.active) return;
  if (skillStore.phase === "idle" || skillStore.phase === "loading") return;
  void skillStore.refresh(canManage.value, "window_resume");
}

async function subscribeDirectoryChanges(): Promise<void> {
  try {
    const unlisten = await skillNativeClient.subscribeDirectoryChanged(() => {
      if (pageUnmounted || !props.active) return;
      void skillStore.refresh(canManage.value, "directory_changed");
    });
    if (pageUnmounted) {
      unlisten();
      return;
    }
    unlistenDirectoryChanged = unlisten;
  } catch {
    // Window focus and explicit rescans remain the bounded recovery path.
  }
}

watch(canManage, (allowed, previous) => {
  if (!allowed && previous) {
    closeImportDialog();
    void closeUninstallDialog();
  }
  if (props.active && allowed !== previous && skillStore.phase !== "idle") {
    void skillStore.refresh(allowed, "user_retry");
  }
});

watch(() => props.active, (active) => {
  if (active) void loadPage();
  else { closeImportDialog(); uninstallTargetId.value = null; uninstallTrigger = null; }
});

onMounted(() => {
  pageUnmounted = false;
  window.addEventListener("focus", handleWindowFocus);
  void subscribeDirectoryChanges();
  if (props.active) void loadPage();
});

onBeforeUnmount(() => {
  pageUnmounted = true;
  window.removeEventListener("focus", handleWindowFocus);
  unlistenDirectoryChanged?.();
  unlistenDirectoryChanged = null;
});
</script>

<template>
  <component :is="embedded ? 'section' : YjPage" :width="embedded ? undefined : 'full'" class="skill-marketplace">
    <YjPageHeader
      v-if="!embedded"
      :title="title"
      description="发现、离线安装和管理跨境电商 Skill。只有已安装且已启用的 Skill 才会向模型开放。"
    >
      <template #actions>
        <YjRefreshButton :loading="skillStore.refreshing" :disabled="rescanDisabled" @refresh="retry" />
        <ExtensionImportButton v-if="canImport" kind="skills" :disabled="importDisabled" @import-skill="openImportDialog" />
      </template>
    </YjPageHeader>

    <slot />
    <n-alert v-if="acceptanceEnvironment" type="info" :bordered="false">独立技能验收环境：操作使用单独的数据，不改变日常技能和聊天。</n-alert>

    <div v-if="visibleSkillCount !== null" class="skill-marketplace__summary">
      <span class="skill-marketplace__count">{{ visibleSkillCount }} 个技能</span>
      <p v-if="embedded" class="skill-marketplace__hint">在对话中选择已启用的技能，再发送消息开始任务。</p>
    </div>
    <n-alert v-if="skillStore.notice" type="info" :bordered="false">{{ skillStore.notice }}</n-alert>
    <n-alert v-if="skillStore.importError && !importDialogOpen" type="warning" :bordered="false" role="alert">{{ skillStore.importError }}</n-alert>
    <n-alert v-for="operation in pendingNotices" :key="operation.operation_id" type="info" :bordered="false" role="status">
      {{ operation.error_code ? nativeSkillFailureMessage(operation.error_code) : operation.state === 'needs_attention' ? '技能操作需要检查，来源和旧数据已保留。' : '正在确认技能操作。已有任务结束后会继续处理。' }}
      <n-button v-if="canManage" size="small" @click="skillStore.cancelOperation(operation.operation_id)">取消操作</n-button>
    </n-alert>

    <n-alert v-if="!canManage && skillStore.phase === 'ready'" type="info" :bordered="false">
      当前仅可查看 Skill；安装、启停和卸载需要插件管理权限。
    </n-alert>
    <n-alert
      v-if="refreshFailure && (skillStore.phase === 'ready' || skillStore.phase === 'empty')"
      type="warning"
      :bordered="false"
      role="alert"
    >
      {{ refreshFailure }} 已显示上次成功读取的本地状态。
    </n-alert>

    <div
      v-if="skillStore.phase === 'idle' || skillStore.phase === 'loading'"
      class="skill-marketplace__loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p>正在读取内置清单并扫描本地 Skill…</p>
      <div class="skill-marketplace__grid" aria-hidden="true">
        <n-card v-for="index in 3" :key="index" :bordered="false">
          <n-skeleton text :repeat="3" />
        </n-card>
      </div>
    </div>

    <YjEmpty
      v-else-if="skillStore.phase === 'permission-denied'"
      title="无权访问 Skill 广场"
      description="当前本地身份没有插件浏览权限。请重新打开本地 Demo，或联系管理员检查权限配置。"
      icon="shield"
      role="alert"
    />

    <YjEmpty
      v-else-if="skillStore.phase === 'incompatible'"
      title="Skill 数据版本不兼容"
      description="当前客户端无法安全识别本地 Skill 状态。请升级客户端后刷新数据。"
      icon="warning"
      role="alert"
    />

    <YjEmpty
      v-else-if="skillStore.phase === 'unavailable'"
      title="本地 Skill 服务暂不可用"
      :description="refreshFailure ?? '请确认易界本地服务已启动，再点击右上角的刷新按钮。'"
      icon="warning"
      role="alert"
    />

    <YjEmpty
      v-else-if="skillStore.phase === 'empty'"
      title="当前客户端没有可展示的 Skill"
      description="本地安装包未包含已审核的 Skill。升级客户端后可点击右上角的刷新按钮更新清单。"
    />

    <YjEmpty
      v-else-if="visibleCategories.length === 0"
      title="未找到匹配技能"
      description="试试其他关键词，或清空搜索查看全部技能。"
      icon="search"
    />

    <div v-else class="skill-marketplace__categories" aria-live="polite">
      <YjSection
        v-for="category in visibleCategories"
        :key="category.key"
        :title="category.label"
        :count="category.skills.length"
      >
        <ul v-if="category.skills.length > 0" class="skill-marketplace__grid">
          <li v-for="skill in category.skills" :key="skill.id">
            <SkillCard
              :skill="skill"
              :can-manage="canManage"
              :operation="skillStore.operations[skill.id]"
              :operation-error="skillStore.operationErrors[skill.id]"
              :pending-toggle-id="pendingCardToggles.get(skill.id)"
              @install="handleInstall"
              @enabled-change="handleEnabledChange"
              @uninstall="requestUninstall"
              @cancel-operation="skillStore.cancelOperation"
            />
          </li>
        </ul>
        <p v-else class="skill-marketplace__category-empty">
          {{ category.key === "personal" ? "还没有导入技能。" : "本分类暂无已审核的 Skill。" }}
        </p>
      </YjSection>
    </div>

    <SkillImportDialog
      v-if="canImport && active"
      :show="importDialogOpen"
      @close="closeImportDialog"
      @installed="imported"
    />
    <n-modal
      :show="uninstallTarget !== null"
      :mask-closable="false"
      @update:show="!$event && closeUninstallDialog()"
    >
      <n-card
        class="skill-marketplace__dialog"
        title="卸载此技能"
        role="alertdialog"
        aria-modal="true"
        :bordered="false"
        closable
        @close="closeUninstallDialog"
      >
        <p class="skill-marketplace__dialog-copy">
          卸载后需要重新安装才能使用。
        </p>
        <p
          v-if="uninstallTarget && skillStore.operationErrors[uninstallTarget.id]"
          class="skill-marketplace__dialog-error"
          role="alert"
        >
          {{ skillStore.operationErrors[uninstallTarget.id] }}
        </p>
        <div class="skill-marketplace__dialog-actions">
          <n-button :disabled="uninstallPending" autofocus @click="closeUninstallDialog">
            取消
          </n-button>
          <n-button type="error" :loading="uninstallPending" @click="confirmUninstall">
            确认
          </n-button>
        </div>
      </n-card>
    </n-modal>
  </component>
</template>

<style scoped>
.skill-marketplace__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--yj-space-2) var(--yj-space-4);
  padding: var(--yj-space-1) var(--yj-space-1) 0;
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.skill-marketplace__count { color: var(--yj-color-text-secondary); }
.skill-marketplace__hint { margin: 0; color: var(--yj-color-text-tertiary); }

.skill-marketplace {
  display: grid;
  align-content: start;
  gap: var(--yj-space-6);
}

.skill-marketplace__loading,
.skill-marketplace__categories {
  display: grid;
  gap: var(--yj-space-8);
}

.skill-marketplace__loading > p,
.skill-marketplace__category-empty,
.skill-marketplace__dialog-copy,
.skill-marketplace__dialog-error {
  margin: var(--yj-space-0);
}

.skill-marketplace__loading > p,
.skill-marketplace__category-empty {
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.skill-marketplace__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: var(--yj-space-0);
  margin: var(--yj-space-0);
  gap: var(--yj-space-4);
  list-style: none;
}

.skill-marketplace__grid > li {
  display: grid;
  min-width: 0;
}

.skill-marketplace__category-empty {
  padding: var(--yj-space-5);
  border: var(--yj-border-width) dashed var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
}

.skill-marketplace__dialog {
  width: min(calc(var(--yj-space-16) * 7), calc(100vw - var(--yj-space-12)));
}

.skill-marketplace__dialog-copy {
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.skill-marketplace__dialog-error {
  margin-top: var(--yj-space-3);
  color: var(--yj-color-semantic-error-ink);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.skill-marketplace__dialog-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--yj-space-5);
  gap: var(--yj-space-2);
}
</style>
