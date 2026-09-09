<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NCard, NModal } from "naive-ui";
import { useRoute, useRouter } from "vue-router";
import ChatPermissionControl from "../../components/chat/ChatPermissionControl.vue";
import RuntimeApprovalList from "../../components/chat/RuntimeApprovalList.vue";
import { useRuntimePermissions } from "../../composables/useRuntimePermissions";
import ChatComposer from "../../components/chat/ChatComposer.vue";
import type { ChatApprovalDecisionChange } from "../../components/chat/ChatCommandItem.vue";
import ChatArtifactList from "../../components/chat/ChatArtifactList.vue";
import ChatCopyAction from "../../components/chat/ChatCopyAction.vue";
import ChatReasoningDisclosure from "../../components/chat/ChatReasoningDisclosure.vue";
import ChatTimeline from "../../components/chat/ChatTimeline.vue";
import YjIcon from "../../components/yijie/YjIcon.vue";
import { useChatScroll } from "../../composables/useChatScroll";
import type {
  ChatDraftTarget,
  ChatHistoryTurn,
  ChatReasoningItem,
} from "../../domain/chat-ipc";
import { ChatClientError } from "../../domain/chat-ipc";
import {
  chatComposerDraftKey,
  chatComposerDraftValue,
  clearChatComposerDraft,
  createChatComposerDrafts,
  updateChatComposerDraft,
} from "../../domain/chat-composer-draft";
import type {
  ChatComposerFocusSnapshot,
  ChatComposerHandle,
  ChatComposerSubmissionState,
} from "../../domain/chat-composer";
import {
  selectConversationTimeline,
  type ConversationTimelineArtifactReferenceContentBlock,
  type ConversationTimelineAttachmentReferenceContentBlock,
  type ConversationTimelineItemViewModel,
} from "../../domain/conversation-timeline";
import { copyableTimelineItemText } from "../../domain/conversation-timeline-copy";
import { feat137ApprovalUiEnabled } from "../../authorization/feat137-approval-ui-config";
import type { ConversationView } from "../../domain/conversation-view";
import {
  browserFrameProjectionScheduler,
  createFrameBatchedProjection,
} from "../../domain/frame-batched-projection";
import {
  cleanupNotice,
  errorNotice,
  readinessNotice,
  sortHistoryTurns,
  turnStatusLabel,
} from "../../domain/chat-ui";
import { useChatStore } from "../../stores/chat.store";
import { useArtifactStore } from "../../stores/artifact.store";
import { chatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import { chatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import { chatArtifactFileNativeClient } from "../../api/chat-artifact-file-native-client";
import { chatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
import { browserChatClipboardAdapter } from "../../api/chat-clipboard-adapter";

import { CHAT_AUTHORITY_RETRY_KEY } from "../../authorization/chat-authority-recovery";

const route = useRoute();
const router = useRouter();
const chatStore = useChatStore();
const artifactStore = useArtifactStore();

const retryChatAuthority = inject(CHAT_AUTHORITY_RETRY_KEY, async () => false);
const composerDrafts = shallowRef(createChatComposerDrafts());
const routeSessionId = computed(() => typeof route.params.sessionId === "string"
  ? route.params.sessionId
  : null);
const composerDraftTargetKey = computed(() => chatComposerDraftKey(routeSessionId.value));
const prompt = computed({
  get: () => chatComposerDraftValue(composerDrafts.value, composerDraftTargetKey.value),
  set: (value: string) => {
    composerDrafts.value = updateChatComposerDraft(
      composerDrafts.value,
      composerDraftTargetKey.value,
      value,
    );
  },
});
const selectedProjectId = ref<string | null>(null);
const submitting = ref(false);
const composer = ref<ChatComposerHandle | null>(null);
const composerSubmissionState = computed<ChatComposerSubmissionState>(() => {
  if (chatStore.submissionState !== "idle") return chatStore.submissionState;
  return submitting.value ? "submitting" : "idle";
});
const actionErrorCode = ref<string | null>(null);
const transientNotice = ref<string | null>(null);
const permissionDialogOpen = ref(false);
const dragActive = ref(false);
const reasoningItems = ref<Readonly<Record<string, readonly ChatReasoningItem[]>>>({});
const reasoningLoading = ref<ReadonlySet<string>>(new Set());
const reasoningFailed = ref<ReadonlySet<string>>(new Set());
const conversationScroller = ref<HTMLElement | null>(null);
const renderedConversationView = shallowRef(chatStore.conversationState);
let dragDropUnlisten: UnlistenFn | null = null;
let dragDropDisposed = false;
const {
  showBottomButton,
  update: updateScrollPosition,
  scrollToBottom,
  followNewContent,
  preservePositionWhile,
} = useChatScroll(conversationScroller);

const isSessionRoute = computed(() => routeSessionId.value !== null);
const selectedSession = computed(() => chatStore.sessions.find((session) =>
  session.sessionId === chatStore.selectedSessionId,
) ?? null);
const activeProject = computed(() => chatStore.projects.find((project) =>
  project.projectId === selectedSession.value?.projectId,
) ?? null);
const displayTurns = computed(() => sortHistoryTurns(chatStore.history?.turns ?? []));
function timelineSelectionActive(): boolean {
  const scroller = conversationScroller.value;
  const selection = document.getSelection();
  if (scroller === null || selection === null || selection.isCollapsed) return false;
  return selection.anchorNode !== null && selection.focusNode !== null &&
    scroller.contains(selection.anchorNode) && scroller.contains(selection.focusNode);
}

const timelineFrameProjection = createFrameBatchedProjection(
  (state: ConversationView) => { renderedConversationView.value = state; },
  browserFrameProjectionScheduler(),
  () => !timelineSelectionActive(),
);
const conversationTimeline = computed(() => {
  const sessionId = chatStore.selectedSessionId;
  return sessionId === null
    ? null
    : selectConversationTimeline(
        renderedConversationView.value,
        sessionId,
        chatStore.conversationApprovalState,
        { protectApprovalProcessContent: feat137ApprovalUiEnabled, liveTurnId: chatStore.nativeLiveTurnId },
      );
});
const readiness = computed(() => readinessNotice(chatStore.localReadiness));
const cleanup = computed(() => cleanupNotice(chatStore.cleanupStatus));
const stableError = computed(() => errorNotice(
  actionErrorCode.value ?? (
    chatStore.selectedAccessMode === "history-only"
      ? chatStore.lastErrorCode
      : chatStore.controlPlane?.issueCode ?? chatStore.lastErrorCode
  ),
));
const isStreaming = computed(() => chatStore.phase === "streaming");
const runtimePermissionsEnabled = import.meta.env.VITE_YIJIE_RUNTIME_PERMISSIONS_ENABLED === "true" && import.meta.env.VITE_YIJIE_ENV === "local" && import.meta.env.VITE_YIJIE_LOCAL_PROFILE === "demo_fast";
const permissions = useRuntimePermissions(
  () => runtimePermissionsEnabled ? chatStore.context?.contextId ?? null : null,
  () => chatStore.selectedSessionId,
  () => isStreaming.value || composerSubmissionState.value !== "idle",
);
const permissionCanSend = computed(() => !runtimePermissionsEnabled || (permissions.ready.value && !permissions.saving.value && !permissions.deciding.value && !permissions.approvals.value.some((r) => r.status === "pending")));

const isHistoryLoading = computed(() =>
  isSessionRoute.value &&
  chatStore.history === null &&
  ["binding", "loading", "binding-pending", "resyncing", "ready"].includes(chatStore.phase),
);
const canRecoverReadiness = computed(() => readiness.value.actionLabel !== null);
const attachmentInteractionAllowed = computed(() =>
  chatStore.canAttach && composerSubmissionState.value === "idle" && !isStreaming.value,
);
const permissionDenied = computed(() =>
  chatStore.lastErrorCode === "chat_capability_denied" ||
  (chatStore.controlPlane?.state === "denied" &&
    chatStore.controlPlane.issueCode === "chat_capability_denied") ||
  (chatStore.context !== null && !chatStore.hasAction(
    isSessionRoute.value ? "read_sessions" : "create_session",
  )),
);
const statusAnnouncement = computed(() => {
  if (chatStore.phase === "binding-pending") return "正在建立安全任务连接";
  if (chatStore.phase === "resyncing") return "正在同步任务历史";
  if (isStreaming.value) return "模型正在生成回答";
  if (chatStore.liveTurnStatus) return turnStatusLabel(chatStore.liveTurnStatus);
  return "";
});

watch(
  [
    () => chatStore.conversationState,
    () => chatStore.phase,
  ],
  ([state, currentPhase]) => {
    timelineFrameProjection.push(
      state,
      currentPhase === "streaming" || timelineSelectionActive(),
    );
  },
  { flush: "sync" },
);

function flushTimelineAfterSelection(): void {
  if (!timelineSelectionActive()) timelineFrameProjection.flush();
}

watch(
  () => chatStore.projects,
  (projects) => {
    if (selectedProjectId.value && projects.some((project) => project.projectId === selectedProjectId.value && project.available)) return;
    selectedProjectId.value = projects.find((project) => project.available)?.projectId ?? null;
  },
  { immediate: true },
);

watch(
  () => chatStore.context?.contextId ?? null,
  (contextId, previousContextId) => {
    if (contextId === previousContextId) return;
    if (previousContextId === null && contextId !== null) return;
    composerDrafts.value = createChatComposerDrafts();
  },
);

watch(
  () => chatStore.selectedSessionId,
  () => {
    // Replace any presentation frame queued for the previous session. The
    // native view remains synchronous; only its DOM projection
    // is frame-batched.
    timelineFrameProjection.push(chatStore.conversationState, false);
    reasoningItems.value = {};
    reasoningLoading.value = new Set();
    reasoningFailed.value = new Set();
    actionErrorCode.value = null;
    transientNotice.value = null;
    if (selectedSession.value) selectedProjectId.value = selectedSession.value.projectId;
    void nextTick(() => scrollToBottom());
  },
);

watch(
  attachmentInteractionAllowed,
  (allowed) => {
    if (!allowed) dragActive.value = false;
  },
);

const presentedConversationChange = computed(() => [renderedConversationView.value, chatStore.conversationApprovalState]);

watch(
  presentedConversationChange,
  () => { void followNewContent(); },
  { flush: "post" },
);

function captureError(error: unknown): void {
  actionErrorCode.value = error instanceof ChatClientError
    ? error.shape.code
    : "chat_temporarily_unavailable";
}

function decideApproval(change: ChatApprovalDecisionChange): void {
  void chatStore.decideApproval(change);
}

async function pickAttachments(): Promise<void> {
  if (!attachmentInteractionAllowed.value) return;
  actionErrorCode.value = null;
  transientNotice.value = null;
  try {
    await chatStore.pickAttachments();
  } catch {
    return;
  }
}

async function importDroppedAttachments(paths: readonly string[]): Promise<void> {
  if (!attachmentInteractionAllowed.value || paths.length === 0) return;
  actionErrorCode.value = null;
  transientNotice.value = null;
  try {
    await chatStore.importAttachmentPaths(paths);
  } catch {
    return;
  }
}

function composerContainsPhysicalPosition(position: { x: number; y: number }): boolean {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  const composer = document.querySelector<HTMLElement>(".chat-composer");
  if (!composer) return false;
  const bounds = composer.getBoundingClientRect();
  // Wry reports macOS drag positions in the WebView's AppKit point coordinates.
  return position.x >= bounds.left && position.x <= bounds.right &&
    position.y >= bounds.top && position.y <= bounds.bottom;
}

async function removeAttachment(attachmentId: string): Promise<void> {
  actionErrorCode.value = null;
  try {
    await chatStore.removeDraftAttachment(attachmentId);
  } catch {
    return;
  }
}

function dismissAttachmentImport(operationId: string): void {
  chatStore.dismissAttachmentImportAttempt(operationId);
}

async function pickProject(): Promise<void> {
  actionErrorCode.value = null;
  transientNotice.value = null;
  try {
    const project = await chatStore.pickProject();
    if (project) selectedProjectId.value = project.projectId;
  } catch (error: unknown) {
    captureError(error);
  }
}

async function submit(): Promise<void> {
  if (submitting.value || !permissionCanSend.value) return;
  const focusSnapshot: ChatComposerFocusSnapshot | null = composer.value?.captureInputFocus() ?? null;
  submitting.value = true;
  actionErrorCode.value = null;
  transientNotice.value = null;
  const draftTargetAtStart = composerDraftTargetKey.value;
  let focusRestoreTarget = draftTargetAtStart;
  const input = prompt.value.trim();
  try {
    if (isSessionRoute.value) {
      const result = await chatStore.submitTurnWithResult(input);
      if (result.status !== "local_durable_accepted") {
        actionErrorCode.value = chatStore.lastErrorCode ?? "chat_host_not_ready";
        return;
      }
      if (
        chatComposerDraftKeyFromTarget(result.draftTarget) !== draftTargetAtStart ||
        composerDraftTargetKey.value !== draftTargetAtStart
      ) return;
      composerDrafts.value = clearChatComposerDraft(composerDrafts.value, draftTargetAtStart);
      await nextTick();
      scrollToBottom();
      return;
    }
    if (!selectedProjectId.value) {
      actionErrorCode.value = "chat_project_invalid";
      return;
    }
    const result = await chatStore.createSessionWithResult(selectedProjectId.value, input);
    if (result.status !== "local_durable_accepted") {
      actionErrorCode.value = chatStore.lastErrorCode ?? "chat_host_not_ready";
      return;
    }
    if (
      chatComposerDraftKeyFromTarget(result.draftTarget) !== draftTargetAtStart ||
      composerDraftTargetKey.value !== draftTargetAtStart
    ) return;
    composerDrafts.value = clearChatComposerDraft(composerDrafts.value, draftTargetAtStart);
    await router.push(`/chat/${result.sessionId}`);
    focusRestoreTarget = chatComposerDraftKey(result.sessionId);
  } catch (error: unknown) {
    captureError(error);
  } finally {
    submitting.value = false;
    await nextTick();
    if (
      focusSnapshot !== null &&
      composerDraftTargetKey.value === focusRestoreTarget &&
      !timelineSelectionActive()
    ) composer.value?.restoreInputFocus(focusSnapshot);
  }
}

function chatComposerDraftKeyFromTarget(target: ChatDraftTarget) {
  return chatComposerDraftKey(target.type === "session" ? target.sessionId : null);
}

async function interrupt(): Promise<void> {
  actionErrorCode.value = null;
  try {
    await chatStore.interruptSelected();
  } catch (error: unknown) {
    captureError(error);
  }
}

async function recoverReadiness(): Promise<void> {
  actionErrorCode.value = null;
  transientNotice.value = null;
  try {
    const recovery = chatStore.localReadiness?.recovery;
    if (recovery === "start_or_retry" || recovery === "retry") await chatStore.requestLocalRecovery();
    else await chatStore.refreshLocalReadiness();
  } catch (error: unknown) {
    captureError(error);
  }
}

async function handleStableErrorAction(): Promise<void> {
  const code = actionErrorCode.value ?? chatStore.lastErrorCode;
  if (code === "chat_resource_not_found") {
    if (route.path !== "/chat") return void router.replace("/chat");
    await chatStore.clearSelectedSession();
    return;
  }
  if (code === "chat_project_invalid") return void pickProject();
  if (code === "chat_context_invalid" || code === "chat_unauthenticated") return void router.replace("/settings");
  if (chatStore.context === null && chatStore.lastBindFailureStage !== null) {
    actionErrorCode.value = null;
    transientNotice.value = null;
    await retryChatAuthority();
    return;
  }
  if (chatStore.selectedSessionId !== null && chatStore.selectedAccessMode === null) {
    await chatStore.selectSession(chatStore.selectedSessionId);
    return;
  }
  if (chatStore.selectedAccessMode === "history-only") {
    if (code === "chat_cleanup_incomplete") await chatStore.refreshSelectedCleanup();
    else await chatStore.resyncSelected();
    return;
  }
  if (!chatStore.draftTargetReady) {
    await chatStore.retryDraftRecovery();
    return;
  }
  if (code === "chat_protocol_error" || code === "chat_cursor_invalid" || code === "chat_conflict") {
    await chatStore.resyncSelected();
    return;
  }
  if (code === "chat_cleanup_incomplete") {
    await chatStore.refreshSelectedCleanup();
    return;
  }
  await recoverReadiness();
}

async function loadReasoning(turn: ChatHistoryTurn): Promise<void> {
  if (reasoningLoading.value.has(turn.turnId) || reasoningItems.value[turn.turnId]) return;
  reasoningLoading.value = new Set([...reasoningLoading.value, turn.turnId]);
  const selectedAtStart = chatStore.selectedSessionId;
  try {
    const items = await chatStore.loadReasoning(turn.turnId);
    if (chatStore.selectedSessionId !== selectedAtStart) return;
    reasoningItems.value = Object.freeze({ ...reasoningItems.value, [turn.turnId]: items });
    reasoningFailed.value = new Set([...reasoningFailed.value].filter((id) => id !== turn.turnId));
  } catch {
    reasoningFailed.value = new Set([...reasoningFailed.value, turn.turnId]);
  } finally {
    reasoningLoading.value = new Set([...reasoningLoading.value].filter((id) => id !== turn.turnId));
  }
}

async function loadOlderHistory(): Promise<void> {
  actionErrorCode.value = null;
  try {
    await preservePositionWhile(() => chatStore.loadOlderHistory());
  } catch (error: unknown) {
    captureError(error);
  }
}

async function refreshCleanup(): Promise<void> {
  try {
    await chatStore.refreshSelectedCleanup();
  } catch (error: unknown) {
    captureError(error);
  }
}

function showUnsupportedInput(message: string): void {
  transientNotice.value = message;
}




function attachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timelineAttachmentStatus(
  attachment: ConversationTimelineAttachmentReferenceContentBlock,
): string {
  if (attachment.status === "expired") return "已过期";
  if (attachment.status === "error_terminal") return "处理失败";
  return attachment.kind === "image" ? "图片" : "文件";
}

function itemCopyText(item: ConversationTimelineItemViewModel): string {
  return copyableTimelineItemText(item) ?? "";
}

function artifactsForTimelineReference(
  item: ConversationTimelineItemViewModel,
  block: ConversationTimelineArtifactReferenceContentBlock,
) {
  const authority = artifactStore.authority;
  const context = chatStore.context;
  const selectedSessionId = chatStore.selectedSessionId;
  if (
    authority === null ||
    context === null ||
    selectedSessionId === null ||
    authority.contextId !== context.contextId ||
    authority.sessionId !== selectedSessionId ||
    item.threadId !== selectedSessionId
  ) return Object.freeze([]);
  return artifactStore.artifactsForTurn(item.threadId, item.turnId)
    .filter((artifact) => artifact.artifactId === block.artifactId);
}

async function installDragDropListener(): Promise<void> {
  try {
    const currentWindow = getCurrentWindow();
    const unlisten = await currentWindow.onDragDropEvent((event) => {
      if (!attachmentInteractionAllowed.value) {
        dragActive.value = false;
        return;
      }
      if (event.payload.type === "enter" || event.payload.type === "over") {
        dragActive.value = composerContainsPhysicalPosition(event.payload.position);
        return;
      }
      dragActive.value = false;
      if (event.payload.type === "drop" && composerContainsPhysicalPosition(event.payload.position)) {
        void importDroppedAttachments(event.payload.paths);
      }
    });
    if (dragDropDisposed) unlisten();
    else dragDropUnlisten = unlisten;
  } catch {
    dragActive.value = false;
  }
}

onMounted(() => {
  dragDropDisposed = false;
  updateScrollPosition();
  void installDragDropListener();
  document.addEventListener("selectionchange", flushTimelineAfterSelection);
  if (isSessionRoute.value) void nextTick(() => scrollToBottom());
});

onBeforeUnmount(() => {
  dragDropDisposed = true;
  dragDropUnlisten?.();
  dragDropUnlisten = null;
  document.removeEventListener("selectionchange", flushTimelineAfterSelection);
  timelineFrameProjection.dispose();
  void chatStore.deactivatePageSession();
});
</script>

<template>
  <section v-if="!isSessionRoute" class="chat-entry" aria-labelledby="new-task-title">
    <div class="chat-entry__content">
      <h1 id="new-task-title" class="chat-entry__heading">易界AI</h1>
      <p id="new-task-subtitle" class="chat-entry__subtitle">选择本地项目，用一句话开始任务。</p>

      <div v-if="stableError" class="chat-notice" :class="`chat-notice--${stableError.tone}`" role="alert">
        <YjIcon :name="stableError.tone === 'error' ? 'warning' : 'pending'" size="lg" :tone="stableError.tone === 'error' ? 'error' : 'warning'" />
        <div class="chat-notice__copy">
          <strong>{{ stableError.title }}</strong>
          <span>{{ stableError.detail }}</span>
        </div>
        <button v-if="stableError.actionLabel" class="chat-notice__action yj-control" type="button" @click="handleStableErrorAction">
          {{ stableError.actionLabel }}
        </button>
      </div>
      <p v-if="transientNotice" class="chat-entry__unsupported" role="alert">{{ transientNotice }}</p>

      <p v-if="runtimePermissionsEnabled && permissions.error.value" class="chat-workspace__composer-error" role="alert">{{ permissions.error.value }} <button type="button" @click="permissions.refresh">重试</button></p>
      <ChatComposer
        ref="composer"
        v-model="prompt"
        mode="new"
        :projects="chatStore.projects"
        :selected-project-id="selectedProjectId"
        :readiness="readiness"
        :can-send="chatStore.canSend && permissionCanSend"
        :can-attach="attachmentInteractionAllowed"
        :submission-state="composerSubmissionState"
        :streaming="false"
        :recovery-available="canRecoverReadiness"
        :attachments="chatStore.draftAttachments"
        :attachment-import-attempt="chatStore.attachmentImportAttempt"
        :attachment-importing="chatStore.attachmentImporting"
        :attachment-error-code="chatStore.attachmentErrorCode"
        :drag-active="dragActive"
        @pick-project="pickProject"
        @pick-attachments="pickAttachments"
        @remove-attachment="removeAttachment"
        @dismiss-attachment-import="dismissAttachmentImport"
        @show-permission="permissionDialogOpen = true"
        @submit="submit"
        @recover="recoverReadiness"
        @unsupported-input="showUnsupportedInput"
      >
        <template v-if="runtimePermissionsEnabled" #permission-control>
          <ChatPermissionControl :state="permissions.state.value" :disabled="!permissions.ready.value || permissions.busy.value" :saving="permissions.saving.value" @select="permissions.setMode" />
        </template>
      </ChatComposer>
    </div>
  </section>

  <section v-else class="chat-workspace" aria-labelledby="active-chat-title">
    <header class="chat-workspace__header">
      <div class="chat-workspace__heading-copy">
        <h1 id="active-chat-title" class="chat-workspace__title">
          {{ selectedSession?.title ?? (isHistoryLoading ? "正在读取任务" : "任务对话") }}
        </h1>
        <p class="chat-workspace__meta">
          <span><YjIcon name="folder" size="xs" tone="muted" />{{ activeProject?.safeName ?? "本地项目" }}</span>
          <span v-if="chatStore.liveTurnStatus"><YjIcon name="pending" size="xs" tone="muted" />{{ turnStatusLabel(chatStore.liveTurnStatus) }}</span>
        </p>
      </div>
      <div class="chat-workspace__header-status" :class="`chat-workspace__header-status--${readiness.tone}`">
        {{ readiness.title }}
      </div>
    </header>

    <div class="chat-workspace__conversation-wrap">
      <div
        ref="conversationScroller"
        class="chat-workspace__conversation"
        tabindex="-1"
        aria-label="任务对话记录"
        :aria-busy="isHistoryLoading || chatStore.phase === 'binding-pending' || chatStore.phase === 'resyncing'"
        @scroll="updateScrollPosition"
      >
        <div class="chat-workspace__column">
          <button
            v-if="chatStore.history?.nextCursor"
            class="chat-workspace__load-history"
            type="button"
            @click="loadOlderHistory"
          >读取更早的对话</button>

          <div
            v-if="permissionDenied"
            class="chat-notice chat-notice--error chat-workspace__permission-denied"
            role="alert"
          >
            <YjIcon name="warning" size="lg" tone="error" />
            <div class="chat-notice__copy">
              <strong>当前工作区权限不足</strong>
              <span>此页面暂不可用；已经确认的对话内容仍会保留显示。</span>
            </div>
          </div>

          <ChatTimeline
            v-if="conversationTimeline"
            :timeline="conversationTimeline"
            :can-decide-approvals="chatStore.canDecideApprovals"
            :approval-authority-revision="chatStore.approvalAuthorityRevision"
            :approval-transients="chatStore.approvalTransients"
            @approval-decision="decideApproval"
          >
            <template #legacy-records="{ turnId }">
              <template v-for="turn in displayTurns.filter(t => t.turnId === turnId && (!('projectionAuthority' in t) || t.projectionAuthority === 'legacy'))" :key="turn.turnId">
                <ChatReasoningDisclosure v-if="turn.reasoning.length > 0" :disclosure-id="`legacy-reasoning-${turn.turnId}`" :metadata="turn.reasoning" :items="reasoningItems[turn.turnId] ?? []" :loading="reasoningLoading.has(turn.turnId)" @load="loadReasoning(turn)" />
                <p v-if="reasoningFailed.has(turn.turnId)" role="alert">旧版推理记录读取失败，请重新展开后再试。</p>
              </template>
            </template>
            <template #item-actions="{ item }">
              <ChatCopyAction
                v-if="itemCopyText(item)"
                :adapter="browserChatClipboardAdapter"
                :text="itemCopyText(item)"
              />
            </template>
            <template #code-actions="{ text }">
              <ChatCopyAction
                :adapter="browserChatClipboardAdapter"
                :text="text"
                kind="code"
              />
            </template>
            <template #attachment-reference="{ block }">
              <div
                class="chat-message__attachment"
                :class="{ 'chat-message__attachment--expired': block.status === 'expired' }"
              >
                <span class="chat-message__attachment-icon" aria-hidden="true">
                  <YjIcon :name="block.kind === 'image' ? 'image' : 'file'" size="sm" />
                </span>
                <span class="chat-message__attachment-copy">
                  <strong :title="block.name">{{ block.name }}</strong>
                  <span>{{ timelineAttachmentStatus(block) }} · {{ attachmentSize(block.sizeBytes) }}</span>
                </span>
              </div>
            </template>
            <template #artifact-reference="{ item, block }">
              <template
                v-for="artifacts in [artifactsForTimelineReference(item, block)]"
                :key="artifacts[0]?.artifactId ?? block.identity"
              >
                <ChatArtifactList
                  v-if="chatStore.context && artifacts.length > 0"
                  :artifacts="artifacts"
                  :context-id="chatStore.context.contextId"
                  :native-client="chatArtifactNativeClient"
                  :video-native-client="chatArtifactVideoNativeClient"
                  :file-native-client="chatArtifactFileNativeClient"
                  :report-native-client="chatArtifactReportNativeClient"
                />
                <span v-else class="chat-timeline__artifact-fallback">
                  <YjIcon name="file" size="sm" tone="muted" />
                  {{ block.label ?? "生成内容" }}
                </span>
              </template>
            </template>
          </ChatTimeline>

          <template v-else>
            <div v-if="isHistoryLoading" class="chat-empty" role="status">
              <span class="chat-empty__loader" aria-hidden="true" />
              <strong>正在读取本地对话</strong>
              <span>只会加载当前任务的对话记录。</span>
            </div>

            <div v-else-if="stableError && !permissionDenied" class="chat-notice chat-notice--error" role="alert">
              <YjIcon name="warning" size="lg" tone="error" />
              <div class="chat-notice__copy">
                <strong>{{ stableError.title }}</strong>
                <span>{{ stableError.detail }}</span>
              </div>
              <button v-if="stableError.actionLabel" class="chat-notice__action yj-control" type="button" @click="handleStableErrorAction">
                {{ stableError.actionLabel }}
              </button>
            </div>

            <div v-else class="chat-empty" role="status">
              <YjIcon name="assistant" size="xl" tone="muted" />
              <strong>{{ chatStore.selectedSessionId ? "正在同步对话状态" : "对话正在准备" }}</strong>
              <span>{{ chatStore.selectedSessionId ? "已确认内容会在领域状态就绪后显示。" : "选择本地项目并输入任务，内容会按轮次显示在这里。" }}</span>
            </div>
          </template>

          <div v-if="cleanup" class="chat-notice" :class="`chat-notice--${cleanup.tone}`" role="status">
            <YjIcon :name="cleanup.tone === 'error' ? 'warning' : 'pending'" size="lg" :tone="cleanup.tone === 'error' ? 'error' : 'warning'" />
            <div class="chat-notice__copy">
              <strong>{{ cleanup.title }}</strong>
              <span>{{ cleanup.detail }}</span>
            </div>
            <button v-if="cleanup.actionLabel" class="chat-notice__action yj-control" type="button" @click="refreshCleanup">{{ cleanup.actionLabel }}</button>
          </div>
          <RuntimeApprovalList v-if="runtimePermissionsEnabled" :requests="permissions.approvals.value" :deciding="permissions.deciding.value" :connected="permissions.approvalsConnected.value" @decision="permissions.decide" />
        </div>
      </div>

      <button
        v-if="showBottomButton"
        class="chat-workspace__bottom-button"
        type="button"
        aria-label="滚动到对话底部"
        title="滚动到对话底部"
        @click="scrollToBottom(true)"
      >
        <YjIcon name="backToBottom" size="lg" />
      </button>
    </div>

    <footer class="chat-workspace__composer">
      <p
        v-if="chatStore.selectedAccessMode === 'history-only'"
        class="chat-workspace__composer-note"
        role="status"
      >此任务仅保留本地历史记录，当前无法继续发送。</p>
      <p v-if="stableError && !permissionDenied" class="chat-workspace__composer-error" role="alert">
        <strong>{{ stableError.title }}</strong> {{ stableError.detail }}
        <button v-if="stableError.actionLabel" type="button" @click="handleStableErrorAction">{{ stableError.actionLabel }}</button>
      </p>
      <p v-if="transientNotice" class="chat-workspace__composer-error" role="alert">{{ transientNotice }}</p>
      <p v-if="runtimePermissionsEnabled && permissions.error.value" class="chat-workspace__composer-error" role="alert">{{ permissions.error.value }} <button type="button" @click="permissions.refresh">重试</button></p>
      <ChatComposer
        ref="composer"
        v-model="prompt"
        mode="reply"
        :projects="chatStore.projects"
        :selected-project-id="selectedSession?.projectId ?? null"
        :active-project-name="activeProject?.safeName"
        :readiness="readiness"
        :can-send="chatStore.canSend && permissionCanSend"
        :can-attach="attachmentInteractionAllowed"
        :submission-state="composerSubmissionState"
        :streaming="isStreaming"
        :recovery-available="canRecoverReadiness"
          :attachments="chatStore.draftAttachments"
          :attachment-import-attempt="chatStore.attachmentImportAttempt"
          :attachment-importing="chatStore.attachmentImporting"
        :attachment-error-code="chatStore.attachmentErrorCode"
        :drag-active="dragActive"
        @pick-project="pickProject"
        @pick-attachments="pickAttachments"
        @remove-attachment="removeAttachment"
        @dismiss-attachment-import="dismissAttachmentImport"
        @show-permission="permissionDialogOpen = true"
        @submit="submit"
        @interrupt="interrupt"
        @recover="recoverReadiness"
        @unsupported-input="showUnsupportedInput"
      >
        <template v-if="runtimePermissionsEnabled" #permission-control>
          <ChatPermissionControl :state="permissions.state.value" :disabled="!permissions.ready.value || permissions.busy.value" :saving="permissions.saving.value" @select="permissions.setMode" />
        </template>
      </ChatComposer>
    </footer>
    <div class="sr-only" aria-live="polite">{{ statusAnnouncement }}</div>
  </section>

  <n-modal v-model:show="permissionDialogOpen" :mask-closable="true">
    <n-card class="permission-dialog" title="权限审批" role="dialog" aria-modal="true" :bordered="false">
      <div class="permission-dialog__status">
        <YjIcon name="shield" size="xl" tone="primary" />
        <div>
          <strong>只读访问 · 禁止写入</strong>
          <p>当前任务只能读取所选项目中的内容，不允许修改项目文件。</p>
        </div>
      </div>
      <dl class="permission-dialog__list">
        <div><dt>文件访问</dt><dd>只读</dd></div>
        <div><dt>写入与执行</dt><dd>拒绝</dd></div>
        <div><dt>审批策略</dt><dd>固定禁止提升权限</dd></div>
      </dl>
      <p class="permission-dialog__note">本入口只展示已生效策略，不能在页面中提升权限。</p>
      <div class="permission-dialog__actions">
        <button type="button" class="yj-control yj-control--regular" @click="permissionDialogOpen = false">知道了</button>
      </div>
    </n-card>
  </n-modal>
</template>

<style scoped>
.chat-entry {
  display: grid;
  width: 100%;
  min-height: 100%;
  padding: var(--yj-space-8);
  background: var(--yj-color-bg-page);
}

.chat-entry__content {
  display: flex;
  width: min(100%, var(--yj-layout-form-max));
  flex-direction: column;
  align-items: center;
  align-self: start;
  margin: var(--yj-layout-chat-entry-top-offset) auto 0;
}

.chat-entry__heading,
.chat-workspace__title {
  margin: 0;
  color: var(--yj-color-text-primary);
  font-weight: var(--yj-font-weight-semibold);
}

.chat-entry__heading { font-size: var(--yj-font-size-display); line-height: var(--yj-line-height-display); }
.chat-entry__subtitle { margin: var(--yj-space-3) 0 var(--yj-space-8); color: var(--yj-color-text-body); font-size: var(--yj-font-size-body); }
.chat-entry__unsupported { width: min(100%, var(--yj-layout-chat-composer-max)); margin: 0 0 var(--yj-space-3); color: var(--yj-color-semantic-error-ink); font-size: var(--yj-font-size-caption); }

.chat-workspace {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  min-height: min(var(--yj-layout-window-min-height), var(--yj-ui-viewport-height, 100vh));
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  background: var(--yj-color-bg-page);
}

.chat-workspace__header {
  display: flex;
  min-height: var(--yj-space-16);
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-4);
  padding: var(--yj-space-3) var(--yj-space-8);
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
  background: color-mix(in srgb, var(--yj-color-bg-page) 92%, transparent);
}

.chat-workspace__heading-copy { min-width: 0; }
.chat-workspace__title { font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-workspace__meta { display: flex; gap: var(--yj-space-4); margin: var(--yj-space-1) 0 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.chat-workspace__meta span { display: inline-flex; align-items: center; gap: var(--yj-space-1); }

.chat-workspace__header-status {
  flex: none;
  padding: var(--yj-space-1) var(--yj-space-3);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-subtle);
  font-size: var(--yj-font-size-caption);
}
.chat-workspace__header-status--success { color: var(--yj-color-text-primary); background: var(--yj-color-success-soft); }
.chat-workspace__header-status--warning { color: var(--yj-color-text-primary); background: var(--yj-color-warning-soft); }
.chat-workspace__header-status--error { color: var(--yj-color-text-primary); background: var(--yj-color-error-soft); }

.chat-workspace__conversation-wrap { position: relative; min-height: 0; }
.chat-workspace__conversation { width: 100%; height: 100%; overflow-y: auto; overscroll-behavior: contain; scroll-padding-block: var(--yj-space-8); }
.chat-workspace__conversation:focus { outline: none; }
.chat-workspace__column { display: flex; width: min(100%, var(--yj-layout-chat-column-max)); min-height: 100%; flex-direction: column; gap: var(--yj-space-5); padding: var(--yj-space-8); margin-inline: auto; }

.chat-workspace__load-history {
  align-self: center;
  padding: var(--yj-space-2) var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-card);
  font-size: var(--yj-font-size-caption);
}

.chat-turn { display: flex; flex-direction: column; gap: var(--yj-space-4); }

.chat-message { display: grid; max-width: 88%; gap: var(--yj-space-2); }
.chat-message--user { align-self: flex-end; justify-items: end; }
.chat-message--assistant { align-self: stretch; max-width: 100%; }
.chat-message__label { display: inline-flex; align-items: center; gap: var(--yj-space-1); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-semibold); }
.chat-message__blocks { display: grid; max-width: 100%; gap: var(--yj-space-2); justify-items: end; }
.chat-message__body { color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); line-height: 1.72; overflow-wrap: anywhere; white-space: pre-wrap; }
.chat-message--user .chat-message__body { padding: var(--yj-space-3) var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg) var(--yj-radius-lg) var(--yj-radius-xs) var(--yj-radius-lg); background: var(--yj-color-bg-card); }
.chat-message--assistant .chat-message__body { padding: 0 var(--yj-space-1); }
.chat-message__attachment {
  display: grid;
  width: min(360px, 100%);
  min-width: 0;
  grid-template-columns: var(--yj-space-10) minmax(0, 1fr);
  align-items: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}
.chat-message__attachment--expired { border-color: var(--yj-color-border-default); color: var(--yj-color-text-secondary); background: var(--yj-color-bg-subtle); }
.chat-message__attachment-icon { display: inline-flex; width: var(--yj-space-10); height: var(--yj-space-10); align-items: center; justify-content: center; border-radius: var(--yj-radius-sm); background: var(--yj-color-bg-card); }
.chat-message__attachment-copy { display: flex; min-width: 0; flex-direction: column; }
.chat-message__attachment-copy strong { overflow: hidden; font-size: var(--yj-font-size-caption); text-overflow: ellipsis; white-space: nowrap; }
.chat-message__attachment-copy span { overflow: hidden; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); text-overflow: ellipsis; white-space: nowrap; }
.chat-timeline__artifact-fallback { display: inline-flex; min-width: 0; align-items: center; gap: var(--yj-space-2); color: var(--yj-color-text-secondary); }
.chat-message__time { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.chat-message__streaming { width: var(--yj-space-2); height: var(--yj-space-4); margin-left: var(--yj-space-1); border-radius: var(--yj-radius-xs); background: var(--yj-color-agent-running); animation: chat-caret 1s step-end infinite; }

.chat-turn__terminal,
.chat-turn__reasoning-error { margin: 0; color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); }
.chat-turn__terminal--error,
.chat-turn__reasoning-error { color: var(--yj-color-semantic-error-ink); }

.chat-streaming { display: flex; align-items: center; gap: var(--yj-space-2); color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); }
.chat-empty { display: flex; min-height: 240px; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: var(--yj-space-2); color: var(--yj-color-text-tertiary); text-align: center; }
.chat-empty strong { color: var(--yj-color-text-primary); font-size: var(--yj-font-size-card-title); }
.chat-empty__loader { width: var(--yj-space-5); height: var(--yj-space-5); border: var(--yj-space-1) solid var(--yj-color-border-default); border-top-color: var(--yj-color-icon-default); border-radius: var(--yj-radius-full); animation: chat-spin var(--yj-motion-slow) linear infinite; }

.chat-workspace__bottom-button {
  position: absolute;
  right: 50%;
  bottom: var(--yj-space-4);
  display: inline-flex;
  width: var(--yj-space-10);
  height: var(--yj-space-10);
  align-items: center;
  justify-content: center;
  padding: 0;
  transform: translateX(50%);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-elevated);
  box-shadow: none;
}
.chat-workspace__bottom-button:hover { border-color: var(--yj-color-border-control-hover); background: var(--yj-color-control-hover); }
.chat-workspace__bottom-button:focus-visible,
.chat-workspace__load-history:focus-visible,
.chat-notice__action:focus-visible,
.permission-dialog button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }

.chat-workspace__composer { z-index: 1; display: flex; flex-direction: column; align-items: center; padding: var(--yj-space-3) var(--yj-space-8) var(--yj-space-5); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); background: linear-gradient(to bottom, color-mix(in srgb, var(--yj-color-bg-page) 82%, transparent), var(--yj-color-bg-page) 24%); }
.chat-workspace__composer-note { width: min(100%, var(--yj-layout-chat-composer-max)); margin: 0 0 var(--yj-space-2); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.chat-workspace__composer-error { width: min(100%, var(--yj-layout-chat-composer-max)); margin: 0 0 var(--yj-space-2); color: var(--yj-color-semantic-error-ink); font-size: var(--yj-font-size-caption); }
.chat-workspace__composer-error button { padding: 0; border: 0; color: inherit; background: transparent; font-weight: var(--yj-font-weight-semibold); text-decoration: underline; }

.chat-notice { display: flex; width: min(100%, var(--yj-layout-chat-column-max)); align-items: center; gap: var(--yj-space-3); padding: var(--yj-space-3) var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); margin: 0 auto var(--yj-space-4); color: var(--yj-color-text-secondary); background: var(--yj-color-bg-card); }
.chat-notice--warning { border-color: color-mix(in srgb, var(--yj-color-warning) 32%, transparent); background: var(--yj-color-warning-soft); }
.chat-notice--error { border-color: color-mix(in srgb, var(--yj-color-error) 32%, transparent); background: var(--yj-color-error-soft); }
.chat-notice--success { border-color: color-mix(in srgb, var(--yj-color-success) 32%, transparent); background: var(--yj-color-success-soft); }
.chat-notice__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.chat-notice__copy strong { color: var(--yj-color-text-primary); }
.chat-notice__copy span { font-size: var(--yj-font-size-caption); }
.chat-notice__action { flex: none; border: var(--yj-border-width) solid var(--yj-color-border-default); color: var(--yj-color-text-primary); background: var(--yj-color-bg-card); }

.permission-dialog { width: min(480px, calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-12))); }
.permission-dialog__status { display: flex; gap: var(--yj-space-3); color: var(--yj-color-text-primary); }
.permission-dialog__status p { margin: var(--yj-space-1) 0 0; color: var(--yj-color-text-body); }
.permission-dialog__list { display: grid; gap: var(--yj-space-2); margin: var(--yj-space-5) 0; }
.permission-dialog__list div { display: flex; justify-content: space-between; gap: var(--yj-space-4); padding: var(--yj-space-2) 0; border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.permission-dialog__list dt { color: var(--yj-color-text-secondary); }
.permission-dialog__list dd { margin: 0; color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-semibold); }
.permission-dialog__note { color: var(--yj-color-text-body); font-size: var(--yj-font-size-caption); }
.permission-dialog__actions { display: flex; justify-content: flex-end; margin-top: var(--yj-space-5); }
.permission-dialog__actions button { border: 0; color: var(--yj-color-text-on-accent); background: var(--yj-color-brand-primary); }
.permission-dialog__actions button:hover { background: var(--yj-color-brand-hover); }
.permission-dialog__actions button:active { background: var(--yj-color-brand-active); }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; margin: -1px; clip: rect(0 0 0 0); overflow: hidden; white-space: nowrap; }

@keyframes chat-spin { to { transform: rotate(360deg); } }
@keyframes chat-caret { 50% { opacity: 0; } }

@media (max-width: 1280px) {
  .chat-workspace__header,
  .chat-workspace__column,
  .chat-workspace__composer { padding-inline: var(--yj-space-6); }
}

@media (prefers-reduced-motion: reduce) {
  .chat-empty__loader,
  .chat-message__streaming { animation: none; }
}
</style>
