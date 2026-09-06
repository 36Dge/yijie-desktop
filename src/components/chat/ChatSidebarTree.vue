<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NCard, NDropdown, NInput, NModal, type DropdownOption } from "naive-ui";
import { useRouter } from "vue-router";
import type { ChatProject, ChatSession } from "../../domain/chat-ipc";
import { turnStatusLabel } from "../../domain/chat-ui";
import { useChatStore } from "../../stores/chat.store";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{
  currentPath: string;
}>();

const chatStore = useChatStore();
const router = useRouter();
const expandedProjectIds = ref<ReadonlySet<string>>(new Set());
const renameSession = ref<ChatSession | null>(null);
const deleteSession = ref<ChatSession | null>(null);
const removeProjectTarget = ref<ChatProject | null>(null);
const renameValue = ref("");
const actionPending = ref(false);
const actionError = ref<string | null>(null);
let lastDialogTrigger: HTMLElement | null = null;
let knownProjectIds = new Set<string>();

interface ChatHistoryProjectGroup {
  readonly projectId: string;
  readonly project: ChatProject | null;
  readonly label: string;
  readonly sessions: readonly ChatSession[];
}

const historyGroups = computed<readonly ChatHistoryProjectGroup[]>(() => {
  const grouped = new Map<string, ChatSession[]>();
  for (const session of chatStore.sessions) {
    const group = grouped.get(session.projectId) ?? [];
    group.push(session);
    grouped.set(session.projectId, group);
  }
  const availableProjectIds = new Set(chatStore.projects.map((project) => project.projectId));
  const availableGroups = chatStore.projects.map((project) => ({
    projectId: project.projectId,
    project,
    label: project.safeName,
    sessions: grouped.get(project.projectId) ?? [],
  }));
  const removedGroups = [...grouped.entries()]
    .filter(([projectId]) => !availableProjectIds.has(projectId))
    .map(([projectId, sessions]) => ({
      projectId,
      project: null,
      label: "项目已移除",
      sessions,
    }));
  return [...availableGroups, ...removedGroups];
});
const treeLoading = computed(() => chatStore.phase === "binding" || chatStore.phase === "loading");
const treeError = computed(() => {
  if (chatStore.phase === "permission-denied" && !chatStore.hasAction("read_sessions")) {
    return "无权读取任务记录";
  }
  if (chatStore.phase === "resync-required") return "任务记录需要重新同步，请稍后重试";
  if (chatStore.phase === "unavailable" && historyGroups.value.length === 0) {
    return "任务记录暂不可用，请稍后重试";
  }
  if (chatStore.phase === "unavailable") return "任务记录更新失败，已显示上次读取内容";
  return null;
});

watch(
  historyGroups,
  (groups) => {
    const currentProjectIds = new Set(groups.map((group) => group.projectId));
    const nextExpanded = new Set(
      [...expandedProjectIds.value].filter((projectId) => currentProjectIds.has(projectId)),
    );
    for (const projectId of currentProjectIds) {
      if (!knownProjectIds.has(projectId)) nextExpanded.add(projectId);
    }
    knownProjectIds = currentProjectIds;
    expandedProjectIds.value = nextExpanded;
  },
  { immediate: true },
);

watch(
  () => chatStore.context?.allowedActions,
  () => {
    let revoked = false;
    if (renameSession.value && !chatStore.hasAction("rename_session")) {
      renameSession.value = null;
      revoked = true;
    }
    if (deleteSession.value && !chatStore.hasAction("delete_session")) {
      deleteSession.value = null;
      revoked = true;
    }
    if (removeProjectTarget.value && !chatStore.hasAction("remove_project")) {
      removeProjectTarget.value = null;
      revoked = true;
    }
    if (!revoked) return;
    actionError.value = "操作权限已更新，请重新打开菜单";
    void restoreDialogTrigger();
  },
);

function toggleProject(projectId: string): void {
  const next = new Set(expandedProjectIds.value);
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  expandedProjectIds.value = next;
}

function projectMenuOptions(project: ChatProject): DropdownOption[] {
  const options: DropdownOption[] = [];
  if (chatStore.hasAction("pin_project")) {
    options.push({ label: project.pinnedAt === null ? "置顶项目" : "取消置顶", key: "pin" });
  }
  if (chatStore.hasAction("remove_project")) {
    if (options.length > 0) options.push({ type: "divider", key: "divider" });
    options.push({ label: "移除", key: "remove" });
  }
  return options;
}

function sessionMenuOptions(session: ChatSession): DropdownOption[] {
  const options: DropdownOption[] = [];
  if (chatStore.hasAction("rename_session")) options.push({ label: "重命名", key: "rename" });
  if (chatStore.hasAction("pin_session")) {
    options.push({ label: session.pinnedAt === null ? "置顶" : "取消置顶", key: "pin" });
  }
  if (chatStore.hasAction("delete_session")) {
    if (options.length > 0) options.push({ type: "divider", key: "divider" });
    options.push({ label: "永久删除", key: "delete" });
  }
  return options;
}

async function openSession(session: ChatSession): Promise<void> {
  actionError.value = null;
  await router.push(`/chat/${session.sessionId}`);
}

async function ensureSelected(session: ChatSession): Promise<void> {
  if (chatStore.selectedSessionId !== session.sessionId) await chatStore.selectSession(session.sessionId);
}

function rememberTrigger(event: MouseEvent): void {
  lastDialogTrigger = event.currentTarget as HTMLElement;
}

async function restoreDialogTrigger(): Promise<void> {
  await nextTick();
  lastDialogTrigger?.focus();
  lastDialogTrigger = null;
}

async function handleProjectAction(project: ChatProject, key: string): Promise<void> {
  actionError.value = null;
  if (key === "pin") {
    actionPending.value = true;
    try {
      await chatStore.setProjectPinned(project.projectId, project.pinnedAt === null);
    } catch {
      actionError.value = "项目状态更新失败，请稍后重试";
    } finally {
      actionPending.value = false;
    }
  } else if (key === "remove") {
    removeProjectTarget.value = project;
  }
}

async function handleSessionAction(session: ChatSession, key: string): Promise<void> {
  actionError.value = null;
  if (key === "rename") {
    renameSession.value = session;
    renameValue.value = session.title;
    return;
  }
  if (key === "delete") {
    deleteSession.value = session;
    return;
  }
  if (key === "pin") {
    actionPending.value = true;
    try {
      await ensureSelected(session);
      await chatStore.setSelectedPinned(session.pinnedAt === null);
    } catch {
      actionError.value = "任务置顶状态更新失败，请稍后重试";
    } finally {
      actionPending.value = false;
    }
  }
}

function validRename(value: string): boolean {
  const length = Array.from(value.trim()).length;
  return length > 0 && length <= 40;
}

async function confirmRename(): Promise<void> {
  const session = renameSession.value;
  const title = renameValue.value.trim();
  if (!session || !validRename(title)) return;
  actionPending.value = true;
  actionError.value = null;
  try {
    await ensureSelected(session);
    await chatStore.renameSelected(title);
    renameSession.value = null;
    await restoreDialogTrigger();
  } catch {
    actionError.value = "任务重命名失败，请稍后重试";
  } finally {
    actionPending.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  const session = deleteSession.value;
  if (!session) return;
  actionPending.value = true;
  actionError.value = null;
  try {
    await ensureSelected(session);
    await chatStore.deleteSelected();
    deleteSession.value = null;
    await restoreDialogTrigger();
  } catch {
    actionError.value = "永久删除未能启动，请稍后重试";
  } finally {
    actionPending.value = false;
  }
}

async function confirmRemoveProject(): Promise<void> {
  const project = removeProjectTarget.value;
  if (!project) return;
  actionPending.value = true;
  actionError.value = null;
  try {
    await chatStore.removeProject(project.projectId);
    removeProjectTarget.value = null;
    await restoreDialogTrigger();
  } catch {
    actionError.value = "项目移除失败，请稍后重试";
  } finally {
    actionPending.value = false;
  }
}
</script>

<template>
  <section class="chat-tree" aria-label="任务记录：项目与对话" :aria-busy="treeLoading">
    <p v-if="actionError" class="chat-tree__error" role="alert">{{ actionError }}</p>
    <p v-if="treeError" class="chat-tree__error" role="alert">{{ treeError }}</p>
    <p v-if="treeLoading" class="chat-tree__state" role="status">
      正在读取本地任务…
    </p>
    <p v-else-if="historyGroups.length === 0 && !treeError" class="chat-tree__state">暂无任务记录</p>

    <ul v-else-if="historyGroups.length > 0" class="chat-tree__projects">
      <li v-for="group in historyGroups" :key="group.projectId" class="chat-tree__project">
        <div class="chat-tree__project-row">
          <button
            class="chat-tree__expand"
            type="button"
            :aria-expanded="expandedProjectIds.has(group.projectId)"
            :aria-label="`${expandedProjectIds.has(group.projectId) ? '折叠' : '展开'}项目 ${group.label}`"
            @click="toggleProject(group.projectId)"
          >
            <YjIcon :name="expandedProjectIds.has(group.projectId) ? 'chevronDown' : 'chevronRight'" size="xs" />
          </button>
          <YjIcon :name="expandedProjectIds.has(group.projectId) ? 'folderOpen' : 'folder'" size="sm" tone="muted" />
          <span class="chat-tree__project-name" :title="group.label">{{ group.label }}</span>
          <YjIcon v-if="group.project?.pinnedAt !== null && group.project?.pinnedAt !== undefined" name="pin" size="xs" tone="muted" />
          <n-dropdown
            v-if="group.project && projectMenuOptions(group.project).length > 0"
            trigger="click"
            placement="bottom-end"
            :options="projectMenuOptions(group.project)"
            :disabled="actionPending"
            @select="handleProjectAction(group.project, String($event))"
          >
            <button
              class="chat-tree__more"
              type="button"
              :aria-label="`项目 ${group.label} 的操作菜单`"
              @click.stop="rememberTrigger"
            >
              <YjIcon name="more" size="sm" />
            </button>
          </n-dropdown>
        </div>

        <ul v-if="expandedProjectIds.has(group.projectId)" class="chat-tree__sessions">
          <li v-for="session in group.sessions" :key="session.sessionId" class="chat-tree__session">
            <button
              class="chat-tree__session-link"
              :class="{ 'chat-tree__session-link--active': currentPath === `/chat/${session.sessionId}` }"
              type="button"
              :aria-current="currentPath === `/chat/${session.sessionId}` ? 'page' : undefined"
              @click="openSession(session)"
            >
              <span class="chat-tree__session-title">{{ session.title }}</span>
              <span v-if="session.latestTurnStatus" class="chat-tree__session-status">
                {{ turnStatusLabel(session.latestTurnStatus) }}
              </span>
            </button>
            <YjIcon v-if="session.pinnedAt !== null" name="pin" size="xs" tone="muted" />
            <n-dropdown
              v-if="currentPath === `/chat/${session.sessionId}` && sessionMenuOptions(session).length > 0"
              trigger="click"
              placement="bottom-end"
              :options="sessionMenuOptions(session)"
              :disabled="actionPending"
              @select="handleSessionAction(session, String($event))"
            >
              <button
                class="chat-tree__more chat-tree__more--session"
                type="button"
                :aria-label="`任务 ${session.title} 的操作菜单`"
                @click.stop="rememberTrigger"
              >
                <YjIcon name="more" size="sm" />
              </button>
            </n-dropdown>
          </li>
          <li v-if="group.sessions.length === 0" class="chat-tree__empty-session">暂无对话</li>
        </ul>
      </li>
    </ul>

    <button
      v-if="chatStore.sessionsCursor"
      class="chat-tree__load-more"
      type="button"
      :disabled="actionPending"
      @click="chatStore.loadMoreSessions"
    >加载更多任务</button>

    <n-modal
      :show="renameSession !== null"
      :mask-closable="false"
      @update:show="!$event && (renameSession = null, restoreDialogTrigger())"
    >
      <n-card class="chat-tree__dialog" title="重命名任务" role="dialog" aria-modal="true" :bordered="false">
        <p class="chat-tree__dialog-copy">标题只保存在本机，用于识别当前任务。</p>
        <n-input v-model:value="renameValue" autofocus maxlength="80" @keydown.enter.prevent="confirmRename" />
        <p v-if="renameValue && !validRename(renameValue)" class="chat-tree__dialog-error">请输入 1–40 个字符</p>
        <div class="chat-tree__dialog-actions">
          <button class="chat-tree__dialog-button" type="button" @click="renameSession = null; restoreDialogTrigger()">取消</button>
          <button class="chat-tree__dialog-button chat-tree__dialog-button--primary" type="button" :disabled="!validRename(renameValue) || actionPending" @click="confirmRename">保存</button>
        </div>
      </n-card>
    </n-modal>

    <n-modal
      :show="deleteSession !== null"
      :mask-closable="false"
      @update:show="!$event && (deleteSession = null, restoreDialogTrigger())"
    >
      <n-card class="chat-tree__dialog" title="永久删除任务？" role="alertdialog" aria-modal="true" :bordered="false">
        <p class="chat-tree__dialog-copy">
          将删除“{{ deleteSession?.title }}”的本地对话，并启动 Host 与 Runtime 清理。此操作不能撤销。
        </p>
        <div class="chat-tree__dialog-actions">
          <button class="chat-tree__dialog-button" type="button" @click="deleteSession = null; restoreDialogTrigger()">取消</button>
          <button class="chat-tree__dialog-button chat-tree__dialog-button--danger" type="button" :disabled="actionPending" @click="confirmDelete">永久删除</button>
        </div>
      </n-card>
    </n-modal>

    <n-modal
      :show="removeProjectTarget !== null"
      :mask-closable="false"
      @update:show="!$event && (removeProjectTarget = null, restoreDialogTrigger())"
    >
      <n-card class="chat-tree__dialog" title="移除聊天项目？" role="alertdialog" aria-modal="true" :bordered="false">
        <p class="chat-tree__dialog-copy">
          只会移除“{{ removeProjectTarget?.safeName }}”的本地项目引用，不会删除文件或历史任务。
        </p>
        <div class="chat-tree__dialog-actions">
          <button class="chat-tree__dialog-button" type="button" @click="removeProjectTarget = null; restoreDialogTrigger()">取消</button>
          <button class="chat-tree__dialog-button chat-tree__dialog-button--danger" type="button" :disabled="actionPending" @click="confirmRemoveProject">移除</button>
        </div>
      </n-card>
    </n-modal>
  </section>
</template>

<style scoped>
.chat-tree {
  min-height: 0;
  flex: 1;
  padding: var(--yj-space-1) var(--yj-space-1) var(--yj-space-2) var(--yj-layout-chat-sidebar-indent);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}

.chat-tree__projects,
.chat-tree__sessions {
  padding: 0;
  margin: 0;
  list-style: none;
}

.chat-tree__project + .chat-tree__project { margin-top: var(--yj-space-1); }

.chat-tree__project-row,
.chat-tree__session {
  display: flex;
  min-width: 0;
  min-height: var(--yj-space-8);
  align-items: center;
  gap: var(--yj-space-1);
  border-radius: var(--yj-radius-md);
}

.chat-tree__project-row:hover,
.chat-tree__session:hover { background: var(--yj-color-bg-subtle); }

.chat-tree__expand,
.chat-tree__more {
  display: inline-flex;
  width: var(--yj-space-8);
  height: var(--yj-space-8);
  flex: 0 0 var(--yj-space-8);
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-icon-muted);
  background: transparent;
}

.chat-tree__more { margin-left: auto; opacity: 0; }
.chat-tree__project-row:hover .chat-tree__more,
.chat-tree__session:hover .chat-tree__more,
.chat-tree__more:focus-visible { opacity: 1; }

.chat-tree__expand:hover,
.chat-tree__more:hover { color: var(--yj-color-text-primary); background: var(--yj-color-bg-card); }
.chat-tree__expand:focus-visible,
.chat-tree__more:focus-visible,
.chat-tree__session-link:focus-visible,
.chat-tree__load-more:focus-visible,
.chat-tree__dialog-button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }

.chat-tree__project-name {
  min-width: 0;
  flex: 1;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-tree__sessions { padding: var(--yj-space-1) 0 var(--yj-space-2) var(--yj-space-6); }
.chat-tree__session { padding-left: var(--yj-space-1); }

.chat-tree__session-link {
  display: flex;
  min-width: 0;
  min-height: var(--yj-space-8);
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-2);
  padding: var(--yj-space-1) var(--yj-space-2);
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-text-primary);
  background: transparent;
  text-align: left;
}

.chat-tree__session-link--active { color: var(--yj-color-text-primary); background: var(--yj-color-bg-nav);
  box-shadow: inset 3px 0 0 var(--yj-color-brand-primary);
}

.chat-tree__session-link:hover { background: var(--yj-color-control-hover); }
.chat-tree__session-link:active { background: var(--yj-color-control-pressed); }
.chat-tree__session-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-tree__session-status { flex: none; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }

.chat-tree__state,
.chat-tree__empty-session,
.chat-tree__error {
  margin: var(--yj-space-2);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-tree__error { color: var(--yj-color-semantic-error-ink); }
.chat-tree__load-more {
  width: 100%;
  padding: var(--yj-space-2);
  border: 0;
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-tertiary);
  background: transparent;
  font-size: var(--yj-font-size-caption);
}
.chat-tree__load-more:hover { background: var(--yj-color-bg-subtle); }

.chat-tree__dialog { width: min(440px, calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-12))); }
.chat-tree__dialog-copy { margin: 0 0 var(--yj-space-4); color: var(--yj-color-text-body); line-height: var(--yj-line-height-body); }
.chat-tree__dialog-error { margin: var(--yj-space-2) 0 0; color: var(--yj-color-semantic-error-ink); font-size: var(--yj-font-size-caption); }
.chat-tree__dialog-actions { display: flex; justify-content: flex-end; gap: var(--yj-space-2); margin-top: var(--yj-space-5); }
.chat-tree__dialog-button {
  min-height: var(--yj-space-10);
  padding: var(--yj-space-2) var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}
.chat-tree__dialog-button--primary { border-color: var(--yj-color-brand-primary); color: var(--yj-color-text-on-accent); background: var(--yj-color-brand-primary); }
.chat-tree__dialog-button--primary:hover:not(:disabled) { background: var(--yj-color-brand-hover); }
.chat-tree__dialog-button--primary:active:not(:disabled) { background: var(--yj-color-brand-active); }
.chat-tree__dialog-button--danger { border-color: var(--yj-color-error); color: var(--yj-color-text-on-danger); background: var(--yj-color-error); }

@media (prefers-reduced-motion: reduce) {
  .chat-tree__more { transition: none; }
}
</style>
