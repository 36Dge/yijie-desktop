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

const sessionsByProject = computed(() => {
  const grouped = new Map<string, ChatSession[]>();
  for (const session of chatStore.sessions) {
    const group = grouped.get(session.projectId) ?? [];
    group.push(session);
    grouped.set(session.projectId, group);
  }
  return grouped;
});

watch(
  () => chatStore.projects,
  (projects) => {
    if (expandedProjectIds.value.size > 0) return;
    expandedProjectIds.value = new Set(projects.map((project) => project.projectId));
  },
  { immediate: true },
);

function projectSessions(projectId: string): readonly ChatSession[] {
  return sessionsByProject.value.get(projectId) ?? [];
}

function toggleProject(projectId: string): void {
  const next = new Set(expandedProjectIds.value);
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  expandedProjectIds.value = next;
}

function projectMenuOptions(project: ChatProject): DropdownOption[] {
  return [
    { label: project.pinnedAt === null ? "置顶项目" : "取消置顶", key: "pin" },
    { type: "divider", key: "divider" },
    { label: "移除", key: "remove" },
  ];
}

function sessionMenuOptions(session: ChatSession): DropdownOption[] {
  return [
    { label: "重命名", key: "rename" },
    { label: session.pinnedAt === null ? "置顶" : "取消置顶", key: "pin" },
    { type: "divider", key: "divider" },
    { label: "永久删除", key: "delete" },
  ];
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
  <section class="chat-tree" aria-label="聊天项目与最近任务">
    <p v-if="actionError" class="chat-tree__error" role="alert">{{ actionError }}</p>
    <p v-if="chatStore.phase === 'binding' || chatStore.phase === 'loading'" class="chat-tree__state" role="status">
      正在读取本地任务…
    </p>
    <p v-else-if="chatStore.projects.length === 0" class="chat-tree__state">尚未添加聊天项目</p>

    <ul v-else class="chat-tree__projects">
      <li v-for="project in chatStore.projects" :key="project.projectId" class="chat-tree__project">
        <div class="chat-tree__project-row">
          <button
            class="chat-tree__expand"
            type="button"
            :aria-expanded="expandedProjectIds.has(project.projectId)"
            :aria-label="`${expandedProjectIds.has(project.projectId) ? '折叠' : '展开'}项目 ${project.safeName}`"
            @click="toggleProject(project.projectId)"
          >
            <YjIcon :name="expandedProjectIds.has(project.projectId) ? 'chevronDown' : 'chevronRight'" size="xs" />
          </button>
          <YjIcon :name="expandedProjectIds.has(project.projectId) ? 'folderOpen' : 'folder'" size="sm" tone="muted" />
          <span class="chat-tree__project-name" :title="project.safeName">{{ project.safeName }}</span>
          <YjIcon v-if="project.pinnedAt !== null" name="pin" size="xs" tone="muted" />
          <n-dropdown
            trigger="click"
            placement="bottom-end"
            :options="projectMenuOptions(project)"
            :disabled="actionPending"
            @select="handleProjectAction(project, String($event))"
          >
            <button
              class="chat-tree__more"
              type="button"
              :aria-label="`项目 ${project.safeName} 的操作菜单`"
              @click.stop="rememberTrigger"
            >
              <YjIcon name="more" size="sm" />
            </button>
          </n-dropdown>
        </div>

        <ul v-if="expandedProjectIds.has(project.projectId)" class="chat-tree__sessions">
          <li v-for="session in projectSessions(project.projectId)" :key="session.sessionId" class="chat-tree__session">
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
          <li v-if="projectSessions(project.projectId).length === 0" class="chat-tree__empty-session">暂无任务</li>
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
  padding: var(--yj-space-1) 0 var(--yj-space-2) var(--yj-layout-chat-sidebar-indent);
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
.chat-tree__dialog-button:focus-visible { outline: var(--yj-space-1) solid var(--yj-color-brand-border); outline-offset: var(--yj-space-1); }

.chat-tree__project-name {
  min-width: 0;
  flex: 1;
  color: var(--yj-color-text-secondary);
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
  color: var(--yj-color-text-secondary);
  background: transparent;
  text-align: left;
}

.chat-tree__session-link--active { color: var(--yj-color-brand-text); background: var(--yj-color-brand-soft); }
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

.chat-tree__error { color: var(--yj-color-error); }
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

.chat-tree__dialog { width: min(440px, calc(100vw - var(--yj-space-12))); }
.chat-tree__dialog-copy { margin: 0 0 var(--yj-space-4); color: var(--yj-color-text-secondary); line-height: var(--yj-line-height-body); }
.chat-tree__dialog-error { margin: var(--yj-space-2) 0 0; color: var(--yj-color-error); font-size: var(--yj-font-size-caption); }
.chat-tree__dialog-actions { display: flex; justify-content: flex-end; gap: var(--yj-space-2); margin-top: var(--yj-space-5); }
.chat-tree__dialog-button {
  min-height: var(--yj-space-10);
  padding: var(--yj-space-2) var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}
.chat-tree__dialog-button--primary { border-color: var(--yj-color-brand-active); color: var(--yj-color-text-on-accent); background: var(--yj-color-brand-active); }
.chat-tree__dialog-button--danger { border-color: var(--yj-color-error); color: var(--yj-color-text-on-danger); background: var(--yj-color-error); }

@media (prefers-reduced-motion: reduce) {
  .chat-tree__more { transition: none; }
}
</style>
