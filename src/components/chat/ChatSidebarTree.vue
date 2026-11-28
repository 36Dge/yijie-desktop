<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { NCard, NDropdown, NInput, NModal, type DropdownOption } from "naive-ui";
import { isNavigationFailure, NavigationFailureType, useRouter } from "vue-router";
import type { ChatSession } from "../../domain/chat-ipc";
import { buildChatSidebarHistory, type ChatHistoryProjectGroup } from "../../domain/chat-sidebar-history";
import { isTaskSection, type MovePlacement } from "../../domain/sidebar-session-order";
import { useChatStore } from "../../stores/chat.store";
import { useSidebarStore } from "../../stores/sidebar.store";
import { useChatReadingStore } from "../../stores/chat-reading.store";
import { useChatComposerDraftStore } from "../../stores/chat-composer-drafts.store";
import YjIcon from "../yijie/YjIcon.vue";
import YjTooltip from "../yijie/YjTooltip.vue";
import ChatSidebarSessionRow from "./ChatSidebarSessionRow.vue";
import { useSidebarSessionDrag } from "./useSidebarSessionDrag";

const props = withDefaults(defineProps<{
  currentPath: string;
  visible?: boolean;
}>(), { visible: true });

const chatStore = useChatStore();
const sidebarStore = useSidebarStore();
const readingStore = useChatReadingStore();
const composerDrafts = useChatComposerDraftStore();
const router = useRouter();
const expandedProjectIds = ref<ReadonlySet<string>>(new Set());
const renameSession = ref<ChatSession | null>(null);
const deleteSession = ref<ChatSession | null>(null);
const deleteDialogTitleId = useId();
const deleteDialogCopyId = useId();
const deleteTitleLimit = 20;
const deleteTitlePreview = computed(() => {
  const title = deleteSession.value?.title ?? "";
  if (title.length <= deleteTitleLimit) return title;
  const characters = typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter().segment(title), part => part.segment)
    : Array.from(title);
  return characters.length > deleteTitleLimit ? characters.slice(0, deleteTitleLimit).join("") + "…" : title;
});
const removeProjectTarget = ref<ChatHistoryProjectGroup | null>(null);
const moveBlocked = ref(false);
const moveWarning = ref({ title: "", message: "" });
const moveDialogTitleId = useId();
const moveDialogCopyId = useId();
const projectMenuId = ref<string | null>(null);
const activeSessionMenuId = ref<string | null>(null);
const projectMenuX = ref(0);
const projectMenuY = ref(0);
const tree = ref<HTMLElement | null>(null);
const menuOverlay = ref<HTMLElement | null>(null);
const renameValue = ref("");
const actionPending = ref(false);
const actionError = ref<string | null>(null);
let lastDialogTrigger: HTMLElement | null = null;
let knownProjectIds = new Set<string>();
const revealedScheduledTurns = new Map<string, string>();

watch(() => chatStore.sessions, sessions => readingStore.observeSessions(sessions), { immediate: true, flush: "sync" });

watch(() => props.visible && chatStore.hasBackgroundTurns && chatStore.hasAction("read_sessions") ? chatStore.context?.contextId : null,
  (contextId, _, onCleanup) => {
    if (!contextId) return;
    const controller = new AbortController();
    const interval = 3_000;
    let timer = setTimeout(refresh, interval);
    async function refresh() {
      try {
        if (!document.hidden) await chatStore.refreshBackgroundTurnStatuses(controller.signal);
      } catch { /* Keep the last observed state until the next list read succeeds. */ }
      if (!controller.signal.aborted) timer = setTimeout(refresh, interval);
    }
    onCleanup(() => { clearTimeout(timer); controller.abort(); });
  }, { immediate: true });

const history = computed(() => buildChatSidebarHistory(
  chatStore.projects, chatStore.sessions, sidebarStore.taskDirectoryPreferences, sidebarStore.sessionOrders,
));
const historyGroups = computed(() => history.value.groups);
const historySections = computed(() => {
  const { groups, pinnedSessions, otherSessions } = history.value;
  return [
    { key: "pinned", label: "置顶", sessions: pinnedSessions },
    { key: "projects", label: "项目", groups },
    { key: "other", label: "其他任务", sessions: otherSessions },
  ].filter(section => section.groups?.length || section.sessions?.length);
});
interface SessionPosition {
  group: string;
  sessions: readonly ChatSession[];
  index: number;
}
const positions = computed(() => {
  const entries = new Map<string, SessionPosition>();
  function indexList(group: string, sessions: readonly ChatSession[]) {
    sessions.forEach((row, index) => entries.set(row.sessionId, { group, sessions, index }));
  }
  for (const section of historySections.value) {
    if (section.sessions) indexList(section.key, section.sessions);
    for (const group of section.groups ?? []) indexList(group.projectId, group.sessions);
  }
  return entries;
});
const canReorder = computed(() => props.visible && chatStore.hasAction("pin_session")
  && !actionPending.value && !chatStore.taskListLoading && !moveBlocked.value);
const drag = useSidebarSessionDrag(tree, canReorder, (from, to) => {
  const position = positions.value.get(from.sessionId);
  if (!position || position.group !== from.group) return;
  if (to.sessionId && positions.value.get(to.sessionId)?.group !== to.group) return;
  if (from.group !== to.group) {
    moveWarning.value = blockedMoveWarning(from.group, to.group);
    moveBlocked.value = true;
    return;
  }
  const anchor = to.sessionId ?? position.sessions[0]?.sessionId;
  if (anchor) moveSession(position.group, from.sessionId, anchor, to.placement);
});
function blockedMoveWarning(from: string, to: string) {
  if (!isTaskSection(from) && !isTaskSection(to)) {
    return { title: "暂不支持跨项目移动", message: "请在同一个项目内上下移动对话。" };
  }
  const title = "暂不支持跨分类移动";
  if (to === "pinned") return { title, message: "要添加置顶标签，请右键对话并选择“置顶”。" };
  if (from === "pinned") return { title, message: "要移除置顶标签，请右键对话并选择“取消置顶”。对话将按原归属显示。" };
  return { title, message: "请在对话当前所在的分类内调整顺序。" };
}
const { source: dragSource, target: dragTarget } = drag;
const insertion = computed(() => dragSource.value && dragTarget.value?.group === dragSource.value.group
  && dragTarget.value.sessionId !== dragSource.value.sessionId ? dragTarget.value : null);
watch(() => props.visible ? Array.from(chatStore.scheduledSidebar) : [], markers => {
  if (!props.visible) return;
  const rows = new Map(chatStore.sessions.map(row => [row.sessionId, row]));
  for (const id of revealedScheduledTurns.keys()) if (!rows.has(id)) revealedScheduledTurns.delete(id);
  for (const [id, marker] of markers) {
    if ((marker.state !== "created" && marker.state !== "running") || revealedScheduledTurns.get(id) === marker.turnId) continue;
    revealedScheduledTurns.set(id, marker.turnId);
    const session = rows.get(id);
    if (session?.pinnedAt !== null) continue;
    const group = session.projectId;
    if (group && !expandedProjectIds.value.has(group) && historyGroups.value.some(item => item.projectId === group)) {
      expandedProjectIds.value = new Set([...expandedProjectIds.value, group]);
    }
  }
}, { immediate: true, flush: "post" });
const treeError = computed(() => {
  if (chatStore.phase === "permission-denied" && !chatStore.hasAction("read_sessions")) {
    return "无权读取任务记录";
  }
  if (chatStore.phase === "resync-required") return "任务记录需要重新同步，请稍后重试";
  if (chatStore.phase === "unavailable" && !historySections.value.length) {
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

watch([() => props.currentPath, () => chatStore.context?.allowedActions, actionPending], () => {
  drag.cancel();
  projectMenuId.value = null;
  activeSessionMenuId.value = null;
  if (readingStore.latestRequest && props.currentPath !== `/chat/${readingStore.latestRequest.sessionId}`) readingStore.cancelLatest();
});
watch(() => chatStore.context?.contextId, () => {
  drag.cancel();
  moveBlocked.value = false;
  revealedScheduledTurns.clear();
  projectMenuId.value = null;
  activeSessionMenuId.value = null;
  removeProjectTarget.value = null;
  readingStore.cancelLatest();
});

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

async function startProjectTask(projectId: string): Promise<void> {
  const contextId = chatStore.context?.contextId;
  const available = () => chatStore.hasAction("create_session") && chatStore.hasAction("use_project")
    && chatStore.projects.some(project => project.projectId === projectId && project.available);
  if (!contextId || actionPending.value || !available()) return;
  actionPending.value = true;
  actionError.value = null;
  try {
    const result = await router.push("/chat");
    const newTaskRoute = router.currentRoute.value;
    if ((result && !isNavigationFailure(result, NavigationFailureType.duplicated)) || newTaskRoute.fullPath !== "/chat") return;
    if (chatStore.context?.contextId !== contextId || !available()) return;
    await chatStore.clearSelectedSession();
    if (router.currentRoute.value !== newTaskRoute || chatStore.selectedSessionId !== null || chatStore.context?.contextId !== contextId || !available()) return;
    expandedProjectIds.value = new Set([...expandedProjectIds.value, projectId]);
    composerDrafts.newWorkspaceTask = { contextId, projectId };
  } catch {
    actionError.value = "新任务暂时无法打开，请稍后重试";
  } finally {
    actionPending.value = false;
  }
}

function projectMenuOptions(project: ChatHistoryProjectGroup): DropdownOption[] {
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

function openProjectMenu(group: ChatHistoryProjectGroup, event: MouseEvent | KeyboardEvent): void {
  if (actionPending.value || projectMenuOptions(group).length === 0) return;
  event.preventDefault();
  activeSessionMenuId.value = null;
  const element = event.currentTarget as HTMLElement;
  const trigger = element instanceof HTMLButtonElement ? element : element.querySelector<HTMLButtonElement>("button");
  if (!trigger) return;
  const bounds = trigger.getBoundingClientRect();
  const pointer = event instanceof MouseEvent && event.type === "contextmenu";
  projectMenuX.value = pointer ? event.clientX : bounds.right;
  projectMenuY.value = pointer ? event.clientY : bounds.bottom;
  trigger.focus({ preventScroll: true });
  lastDialogTrigger = trigger;
  projectMenuId.value = group.projectId;
}

function projectKeydown(group: ChatHistoryProjectGroup, event: KeyboardEvent): void {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    openProjectMenu(group, event);
  } else if (projectMenuId.value === group.projectId) {
    if (event.key === "Enter" || event.key === " ") event.preventDefault();
    if (event.key === "Tab" || event.key === "Escape") projectMenuId.value = null;
  }
}

function sessionMenuOptions(session: ChatSession): DropdownOption[] {
  const options: DropdownOption[] = [];
  if (chatStore.hasAction("rename_session")) options.push({ label: "重命名", key: "rename" });
  if (chatStore.hasAction("pin_session")) {
    options.push({ label: session.pinnedAt === null ? "置顶" : "取消置顶", key: "pin" });
    const position = positions.value.get(session.sessionId);
    if (position && position.sessions.length > 1) {
      options.push(
        { label: "上移", key: "move-up", disabled: position.index === 0 },
        { label: "下移", key: "move-down", disabled: position.index === position.sessions.length - 1 },
      );
    }
  }
  if (chatStore.hasAction("delete_session")) {
    if (options.length > 0) options.push({ type: "divider", key: "divider" });
    options.push({ label: "永久删除", key: "delete" });
  }
  return options;
}

function moveSession(group: string, sourceId: string, targetId: string, placement: MovePlacement): void {
  if (!canReorder.value || sourceId === targetId) return;
  actionError.value = null;
  const focused = document.activeElement;
  try {
    sidebarStore.moveSession(group, history.value, sourceId, targetId, placement);
    if (focused instanceof HTMLButtonElement && focused.dataset.sessionId === sourceId) {
      void nextTick(() => { if (document.activeElement === document.body) focused.focus({ preventScroll: true }); });
    }
  } catch {
    actionError.value = "任务顺序保存失败，请稍后重试";
  }
}

async function openSession(session: ChatSession): Promise<void> {
  actionError.value = null;
  const path = `/chat/${session.sessionId}`;
  const result = await router.push(path);
  if (result && !isNavigationFailure(result, NavigationFailureType.duplicated)) return;
  if (router.currentRoute.value.path !== path) return;
  readingStore.requestLatest(chatStore.sessions.find(entry => entry.sessionId === session.sessionId) ?? session);
}

async function ensureSelected(session: ChatSession): Promise<void> {
  const changed = chatStore.selectedSessionId !== session.sessionId;
  const path = `/chat/${session.sessionId}`;
  const result = await router.push(path);
  if ((result && !isNavigationFailure(result, NavigationFailureType.duplicated)) || router.currentRoute.value.path !== path) throw new Error("task-navigation-cancelled");
  if (changed || chatStore.selectedSessionId !== session.sessionId) await chatStore.selectSession(session.sessionId);
  if (chatStore.selectedSessionId !== session.sessionId || router.currentRoute.value.path !== path) throw new Error("task-selection-changed");
}

function rememberTrigger(event: MouseEvent | KeyboardEvent, sessionId: string): void {
  const element = event.currentTarget as HTMLElement;
  lastDialogTrigger = element instanceof HTMLButtonElement ? element : element.querySelector<HTMLButtonElement>(".chat-tree__session-link");
  projectMenuId.value = null;
  activeSessionMenuId.value = sessionId;
}

async function restoreDialogTrigger(): Promise<void> {
  await nextTick();
  lastDialogTrigger?.focus();
  lastDialogTrigger = null;
}

async function handleProjectAction(target: ChatHistoryProjectGroup, key: string): Promise<void> {
  projectMenuId.value = null;
  const project = historyGroups.value.find((group) => group.projectId === target.projectId);
  if (!project || actionPending.value || !projectMenuOptions(project).some((option) => option.key === key)) return;
  actionError.value = null;
  if (key === "pin") {
    actionPending.value = true;
    try {
      if (project.project) await chatStore.setProjectPinned(project.projectId, project.pinnedAt === null);
      else sidebarStore.setTaskDirectoryPinned(project.projectId, project.pinnedAt === null);
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
  if (actionPending.value || !chatStore.sessions.some(entry => entry.sessionId === session.sessionId)
    || !sessionMenuOptions(session).some(option => option.key === key && !option.disabled)) return;
  actionError.value = null;
  if (key === "move-up" || key === "move-down") {
    const position = positions.value.get(session.sessionId);
    if (!position) return;
    const up = key === "move-up";
    const adjacent = position.sessions[position.index + (up ? -1 : 1)];
    if (adjacent) moveSession(position.group, session.sessionId, adjacent.sessionId, up ? "before" : "after");
    return;
  }
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
    const trigger = lastDialogTrigger;
    try {
      await chatStore.setSessionPinned(session.sessionId, session.pinnedAt === null);
    } catch {
      actionError.value = "任务置顶状态更新失败，请稍后重试";
      return;
    } finally {
      actionPending.value = false;
    }
    await nextTick();
    if (trigger?.dataset.sessionId === session.sessionId && !trigger.isConnected && document.activeElement === document.body) {
      const row = tree.value?.querySelector<HTMLButtonElement>(`[data-session-id="${CSS.escape(session.sessionId)}"]`);
      if (row) row.focus();
      else if (session.projectId) {
        tree.value?.querySelector<HTMLButtonElement>(`[data-project-id="${CSS.escape(session.projectId)}"]`)?.focus();
      }
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
    await chatStore.renameSession(session.sessionId, title);
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
  if (!project || actionPending.value || !chatStore.hasAction("remove_project")) return;
  const current = historyGroups.value.find((group) => group.projectId === project.projectId);
  if (!current) { removeProjectTarget.value = null; return; }
  actionPending.value = true;
  actionError.value = null;
  try {
    if (current.project) await chatStore.removeProject(project.projectId);
    else sidebarStore.removeTaskDirectory(project.projectId);
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
  <Teleport to="body"><div ref="menuOverlay" class="chat-control-overlay" /></Teleport>
  <section ref="tree" class="chat-tree" aria-label="任务：项目与对话" :aria-busy="chatStore.taskListLoading"
    :class="{ 'chat-tree--moving': dragSource, 'chat-tree--blocked': dragSource && dragTarget && dragSource.group !== dragTarget.group }"
    @pointerdown="drag.start" @pointermove="drag.move" @pointerup="drag.end"
    @pointercancel="drag.cancelPointer" @keydown.esc="drag.cancel" @click.capture="drag.captureClick">
    <p v-if="actionError" class="chat-tree__error" role="alert">{{ actionError }}</p>
    <p v-if="treeError" class="chat-tree__error" role="alert">{{ treeError }}</p>
    <p v-if="chatStore.taskListLoading" class="chat-tree__state" role="status">
      正在读取本地任务…
    </p>
    <p v-else-if="!historySections.length && !treeError" class="chat-tree__state">暂无任务记录</p>

    <template v-else>
      <template v-for="section in historySections" :key="section.key">
        <h3 v-if="history.pinnedSessions.length" class="chat-tree__section-title" :data-task-section="section.key"
          :data-drop-placement="insertion?.group === section.key && !insertion.sessionId ? 'after' : undefined">{{ section.label }}</h3>
        <ul class="chat-tree__list" :aria-label="section.label" :data-task-section="section.key">
          <li v-for="group in section.groups" :key="group.projectId" class="chat-tree__project" :data-project-group="group.projectId">
            <div class="chat-tree__project-row" :data-drop-placement="insertion?.group === group.projectId && !insertion.sessionId ? 'after' : undefined" @contextmenu="openProjectMenu(group, $event)">
              <button
                class="chat-tree__project-toggle"
                type="button"
                :data-project-id="group.projectId"
                :aria-expanded="expandedProjectIds.has(group.projectId)"
                :aria-label="`${expandedProjectIds.has(group.projectId) ? '折叠' : '展开'}项目 ${group.label}`"
                :aria-haspopup="projectMenuOptions(group).length ? 'menu' : undefined"
                :aria-keyshortcuts="projectMenuOptions(group).length ? 'Shift+F10' : undefined"
                @click="toggleProject(group.projectId)"
                @keydown="projectKeydown(group, $event)"
              >
                <YjIcon :name="expandedProjectIds.has(group.projectId) ? 'folderOpen' : 'folder'" tone="muted" :stroke-width="1.5" />
                <span class="chat-tree__project-name" >{{ group.label }}</span>
                <YjIcon v-if="group.pinnedAt !== null" name="pin" size="xs" tone="muted" />
              </button>
              <n-dropdown
                v-if="projectMenuOptions(group).length > 0"
                :to="menuOverlay ?? false"
                :style="{ zoom: 'var(--yj-ui-scale, 1)', width: 'min(var(--yj-layout-chat-context-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8)))' }"
                trigger="manual"
                placement="bottom-end"
                :show="projectMenuId === group.projectId"
                :x="projectMenuX"
                :y="projectMenuY"
                :options="projectMenuOptions(group)"
                :disabled="actionPending"
                @update:show="!$event && (projectMenuId = null)"
                @clickoutside="projectMenuId = null"
                @select="handleProjectAction(group, String($event))"
              />
              <div class="chat-tree__project-actions" :class="{ 'chat-tree__project-actions--open': projectMenuId === group.projectId }">
                <button
                  v-if="projectMenuOptions(group).length > 0"
                  class="chat-tree__more"
                  type="button"
                  :aria-label="`项目 ${group.label} 的操作菜单`"
                  aria-haspopup="menu"
                  :aria-expanded="projectMenuId === group.projectId"
                  :disabled="actionPending"
                  @click.stop="openProjectMenu(group, $event)"
                  @keydown="projectKeydown(group, $event)"
                >
                  <YjIcon name="more" size="sm" tone="muted" :stroke-width="1.5" />
                </button>
                <YjTooltip v-if="group.project && chatStore.hasAction('create_session') && chatStore.hasAction('use_project')" text="新建任务" placement="top" to="body">
                  <button
                    class="chat-tree__new-task"
                    type="button"
                    :aria-label="`在工作空间 ${group.label} 中新建任务`"
                    :disabled="actionPending || !group.project.available"
                    @click.stop="startProjectTask(group.projectId)"
                  ><YjIcon name="newTask" size="xs" tone="muted" :stroke-width="1.5" /></button>
                </YjTooltip>
              </div>
            </div>

            <ul v-if="expandedProjectIds.has(group.projectId)" class="chat-tree__sessions">
              <ChatSidebarSessionRow
                v-for="session in group.sessions"
                :key="session.sessionId"
                :data-drop-placement="insertion?.sessionId === session.sessionId ? insertion.placement : undefined"
                :session="session"
                :scheduled-state="chatStore.scheduledSidebar.get(session.sessionId)?.state"
                :completion-unread="readingStore.hasUnreadCompletion(session)"
                :current-path="currentPath"
                :options="sessionMenuOptions(session)"
                :action-pending="actionPending"
                :active-menu-id="activeSessionMenuId"
                :menu-target="menuOverlay ?? false"
                @open="openSession"
                @action="handleSessionAction"
                @remember-trigger="rememberTrigger($event, session.sessionId)"
              />
              <li v-if="!group.hasSessions" class="chat-tree__empty-session">暂无对话</li>
            </ul>
          </li>
          <ChatSidebarSessionRow
            v-for="session in section.sessions"
            :key="session.sessionId"
            :data-drop-placement="insertion?.sessionId === session.sessionId ? insertion.placement : undefined"
            :session="session"
            :scheduled-state="chatStore.scheduledSidebar.get(session.sessionId)?.state"
            :completion-unread="readingStore.hasUnreadCompletion(session)"
            :current-path="currentPath"
            :options="sessionMenuOptions(session)"
            :action-pending="actionPending"
            :active-menu-id="activeSessionMenuId"
            :menu-target="menuOverlay ?? false"
            @open="openSession"
            @action="handleSessionAction"
            @remember-trigger="rememberTrigger($event, session.sessionId)"
          />
        </ul>
      </template>
    </template>

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
          <button class="chat-tree__dialog-button yj-control yj-control--regular" type="button" @click="renameSession = null; restoreDialogTrigger()">取消</button>
          <button class="chat-tree__dialog-button chat-tree__dialog-button--primary yj-control yj-control--regular" type="button" :disabled="!validRename(renameValue) || actionPending" @click="confirmRename">保存</button>
        </div>
      </n-card>
    </n-modal>

    <n-modal
      :show="deleteSession !== null"
      :mask-closable="false"
      @update:show="!$event && (deleteSession = null, restoreDialogTrigger())"
    >
      <n-card class="chat-tree__dialog chat-tree__dialog--delete" role="alertdialog" aria-modal="true" :aria-labelledby="deleteDialogTitleId" :aria-describedby="deleteDialogCopyId" :bordered="false">
        <template #header><span :id="deleteDialogTitleId" class="chat-tree__delete-title">永久删除任务？</span></template>
        <p :id="deleteDialogCopyId" class="chat-tree__dialog-copy">
          将删除“{{ deleteTitlePreview }}”的本地对话。此操作不能撤销。
        </p>
        <div class="chat-tree__dialog-actions">
          <button class="chat-tree__dialog-button yj-control yj-control--regular" type="button" @click="deleteSession = null; restoreDialogTrigger()">取消</button>
          <button class="chat-tree__dialog-button chat-tree__dialog-button--danger yj-control yj-control--regular" type="button" :disabled="actionPending" @click="confirmDelete">永久删除</button>
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
          <template v-if="removeProjectTarget?.project">只会移除“{{ removeProjectTarget.label }}”的本地项目引用，不会删除文件或历史任务。</template>
          <template v-else>只会移除侧栏中的“任务目录”分组，不会删除文件或历史任务，也不会停止定时任务。</template>
          已置顶的任务保留在“置顶”中，其余历史任务将归入“其他任务”。
        </p>
        <div class="chat-tree__dialog-actions">
          <button class="chat-tree__dialog-button yj-control yj-control--regular" type="button" @click="removeProjectTarget = null; restoreDialogTrigger()">取消</button>
          <button class="chat-tree__dialog-button chat-tree__dialog-button--danger yj-control yj-control--regular" type="button" :disabled="actionPending" @click="confirmRemoveProject">移除</button>
        </div>
      </n-card>
    </n-modal>
    <n-modal v-model:show="moveBlocked">
      <n-card class="chat-tree__dialog" role="alertdialog" aria-modal="true" :aria-labelledby="moveDialogTitleId" :aria-describedby="moveDialogCopyId" :bordered="false">
        <template #header><span :id="moveDialogTitleId">{{ moveWarning.title }}</span></template>
        <p :id="moveDialogCopyId" class="chat-tree__dialog-copy">{{ moveWarning.message }}</p>
        <div class="chat-tree__dialog-actions">
          <button type="button" class="chat-tree__dialog-button chat-tree__dialog-button--primary yj-control yj-control--regular" @click="moveBlocked = false">知道了</button>
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

.chat-tree__list,
.chat-tree__sessions {
  padding: 0;
  margin: 0;
  list-style: none;
}

.chat-tree__project + .chat-tree__project { margin-top: var(--yj-space-1); }

.chat-tree--moving,
.chat-tree--moving :deep(button) { cursor: grabbing; }
.chat-tree--blocked,
.chat-tree--blocked :deep(button) { cursor: not-allowed; }
.chat-tree [data-drop-placement] { position: relative; }
.chat-tree [data-drop-placement]::after {
  position: absolute;
  inset-inline: var(--yj-space-2);
  height: var(--yj-focus-ring-width);
  border-radius: var(--yj-radius-sm);
  background: var(--yj-color-focus-ring);
  content: "";
  pointer-events: none;
}
.chat-tree [data-drop-placement="before"]::after { top: 0; }
.chat-tree [data-drop-placement="after"]::after { bottom: 0; }

.chat-tree__section-title {
  margin: 0;
  padding: var(--yj-space-1) var(--yj-space-3);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-medium);
  line-height: var(--yj-line-height-caption);
}

.chat-tree__list + .chat-tree__section-title { margin-top: var(--yj-space-3); }

.chat-tree__project-row {
  display: flex;
  min-width: 0;
  min-height: var(--yj-space-8);
  align-items: center;
  gap: var(--yj-space-1);
  border-radius: var(--yj-radius-md);
}

.chat-tree__project-row:hover { background: var(--yj-color-bg-subtle); }

.chat-tree__project-toggle {
  display: flex;
  min-width: 0;
  min-height: var(--yj-space-8);
  flex: 1;
  align-items: center;
  gap: var(--yj-space-3);
  padding: var(--yj-space-1) var(--yj-space-3);
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-text-primary);
  background: transparent;
  text-align: left;
}

.chat-tree__more,
.chat-tree__new-task {
  display: inline-flex;
  width: var(--yj-space-6);
  height: var(--yj-space-6);
  flex: 0 0 var(--yj-space-6);
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-icon-muted);
  background: transparent;
}

.chat-tree__project-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--yj-space-1);
  margin-inline-end: var(--yj-space-2);
  opacity: 0;
  pointer-events: none;
}
.chat-tree__project-row:hover .chat-tree__project-actions,
.chat-tree__project-row:focus-within .chat-tree__project-actions,
.chat-tree__project-actions--open { opacity: 1; pointer-events: auto; }
.chat-tree__new-task:disabled { cursor: not-allowed; }
.chat-tree__new-task:disabled :deep(.yj-icon) { color: var(--yj-color-text-disabled); }
@media (hover: none) { .chat-tree__project-actions { opacity: 1; pointer-events: auto; } }

.chat-tree__project-toggle:hover,
.chat-tree__more:hover,
.chat-tree__new-task:not(:disabled):hover { color: var(--yj-color-text-primary); background: var(--yj-color-bg-card); }
.chat-tree__project-toggle:focus-visible,
.chat-tree__more:focus-visible,
.chat-tree__load-more:focus-visible,
.chat-tree__dialog-button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.chat-tree__new-task:focus,
.chat-tree__new-task:focus-visible { outline: none; box-shadow: none; }

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
.chat-tree__sessions:empty { display: none; }

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
.chat-tree__dialog--delete { max-width: var(--yj-layout-chat-delete-confirm-width); overflow-wrap: anywhere; }
.chat-tree__delete-title { font-size: var(--yj-font-size-section-title); font-weight: var(--yj-font-weight-semibold); }
.chat-tree__dialog-copy { margin: 0 0 var(--yj-space-4); color: var(--yj-color-text-body); line-height: var(--yj-line-height-body); }
.chat-tree__dialog-error { margin: var(--yj-space-2) 0 0; color: var(--yj-color-semantic-error-ink); font-size: var(--yj-font-size-caption); }
.chat-tree__dialog-actions { display: flex; justify-content: flex-end; gap: var(--yj-space-2); margin-top: var(--yj-space-5); }
.chat-tree__dialog-button {
  border: var(--yj-border-width) solid var(--yj-color-border-default);
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
