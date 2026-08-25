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
import type { SkillCategory } from "../../domain/skill-marketplace";
import { skillNativeClient } from "../../api/skill-native-client";
import type { YjIconName } from "../../icons/registry";
import { usePermissionStore } from "../../stores/permission.store";
import {
  skillNativeFailureMessage,
  useSkillStore,
} from "../../stores/skill.store";
import SkillCard from "../../components/skills/SkillCard.vue";
import YjEmpty from "../../components/yijie/YjEmpty.vue";
import YjIcon from "../../components/yijie/YjIcon.vue";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjSection from "../../components/yijie/YjSection.vue";

const CATEGORY_ICONS = {
  "sourcing-selection": "skillSourcing",
  "market-research": "skillResearch",
  "content-marketing": "skillContent",
  "traffic-advertising": "skillTraffic",
  "store-operations": "skillOperations",
} as const satisfies Readonly<Record<SkillCategory, YjIconName>>;

const permissionStore = usePermissionStore();
const skillStore = useSkillStore();
const message = useMessage();
const uninstallTargetId = ref<string | null>(null);
let uninstallTrigger: HTMLElement | null = null;
let unlistenDirectoryChanged: UnlistenFn | null = null;
let pageUnmounted = false;

const canManage = computed(() => permissionStore.hasCapability("plugin.manage"));
const uninstallTarget = computed(() =>
  skillStore.skills.find((skill) => skill.id === uninstallTargetId.value) ?? null,
);
const uninstallPending = computed(() =>
  uninstallTargetId.value !== null &&
  skillStore.operations[uninstallTargetId.value] === "uninstall",
);
const refreshFailure = computed(() =>
  skillStore.lastFailure === null ? null : skillNativeFailureMessage(skillStore.lastFailure),
);

async function loadPage(): Promise<void> {
  await skillStore.open(canManage.value);
}

async function retry(): Promise<void> {
  await skillStore.refresh(canManage.value, "user_retry");
}

async function handleInstall(skillId: string): Promise<void> {
  if (!canManage.value) return;
  const installed = await skillStore.install(skillId);
  if (installed) message.success("Skill 已安装并默认启用。", { duration: 3000 });
  else message.error(skillStore.operationErrors[skillId] ?? "Skill 安装未完成，请稍后重试。");
}

async function handleEnabledChange(skillId: string, enabled: boolean): Promise<void> {
  if (!canManage.value) return;
  const updated = await skillStore.setEnabled(skillId, enabled);
  if (updated) message.success(enabled ? "Skill 已启用。" : "Skill 已停用。");
  else message.error(skillStore.operationErrors[skillId] ?? "Skill 状态更新失败，请稍后重试。");
}

function requestUninstall(skillId: string, trigger: HTMLElement): void {
  if (!canManage.value) return;
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
  if (skillStore.phase === "idle" || skillStore.phase === "loading") return;
  void skillStore.refresh(canManage.value, "window_resume");
}

async function subscribeDirectoryChanges(): Promise<void> {
  try {
    const unlisten = await skillNativeClient.subscribeDirectoryChanged(() => {
      if (pageUnmounted) return;
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
  if (!allowed && previous) void closeUninstallDialog();
  if (allowed !== previous && skillStore.phase !== "idle") {
    void skillStore.refresh(allowed, "user_retry");
  }
});

onMounted(() => {
  pageUnmounted = false;
  window.addEventListener("focus", handleWindowFocus);
  void subscribeDirectoryChanges();
  void loadPage();
});

onBeforeUnmount(() => {
  pageUnmounted = true;
  window.removeEventListener("focus", handleWindowFocus);
  unlistenDirectoryChanged?.();
  unlistenDirectoryChanged = null;
});
</script>

<template>
  <YjPage width="full" class="skill-marketplace">
    <YjPageHeader
      title="Skill 广场"
      description="发现、离线安装和管理跨境电商 Skill。只有已安装且已启用的 Skill 才会向模型开放。"
    >
      <template #actions>
        <n-button
          secondary
          :loading="skillStore.refreshing"
          :disabled="skillStore.phase === 'loading' || Object.keys(skillStore.operations).length > 0"
          aria-label="重新扫描本地 Skill"
          @click="retry"
        >
          <template #icon><YjIcon name="refresh" /></template>
          重新扫描
        </n-button>
      </template>
    </YjPageHeader>

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
      description="当前客户端无法安全识别本地 Skill 状态。请升级客户端后重新扫描。"
      icon="warning"
      role="alert"
    >
      <template #actions>
        <n-button secondary @click="retry">重新扫描</n-button>
      </template>
    </YjEmpty>

    <YjEmpty
      v-else-if="skillStore.phase === 'unavailable'"
      title="本地 Skill 服务暂不可用"
      :description="refreshFailure ?? '请确认易界本地服务已启动，然后重新扫描。'"
      icon="warning"
      role="alert"
    >
      <template #actions>
        <n-button type="primary" @click="retry">重新扫描</n-button>
      </template>
    </YjEmpty>

    <YjEmpty
      v-else-if="skillStore.phase === 'empty'"
      title="当前客户端没有可展示的 Skill"
      description="本地安装包未包含已审核的 Skill。升级客户端后可重新扫描内置清单。"
    >
      <template #actions>
        <n-button secondary @click="retry">重新扫描</n-button>
      </template>
    </YjEmpty>

    <div v-else class="skill-marketplace__categories" aria-live="polite">
      <YjSection
        v-for="category in skillStore.categories"
        :key="category.key"
        :title="category.label"
        :count="category.skills.length"
        :icon="CATEGORY_ICONS[category.key]"
      >
        <ul v-if="category.skills.length > 0" class="skill-marketplace__grid">
          <li v-for="skill in category.skills" :key="skill.id">
            <SkillCard
              :skill="skill"
              :can-manage="canManage"
              :operation="skillStore.operations[skill.id]"
              :operation-error="skillStore.operationErrors[skill.id]"
              @install="handleInstall"
              @enabled-change="handleEnabledChange"
              @uninstall="requestUninstall"
            />
          </li>
        </ul>
        <p v-else class="skill-marketplace__category-empty">
          本分类暂无已审核的 Skill。
        </p>
      </YjSection>
    </div>

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
  </YjPage>
</template>

<style scoped>
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
  color: var(--yj-color-text-secondary);
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
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.skill-marketplace__dialog-error {
  margin-top: var(--yj-space-3);
  color: var(--yj-color-error);
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
