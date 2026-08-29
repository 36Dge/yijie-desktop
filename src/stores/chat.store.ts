import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  chatClient,
  type ChatClient,
  type ChatInvalidEventScope,
} from "../api/chat-client";
import { feat134StreamingUiEnabled } from "../authorization/feat134-streaming-ui-config";
import {
  conversationMessageItemId,
  conversationReasoningItemOrdinal,
  historyPageToConversationSnapshot,
  projectionEventToConversation,
} from "../api/chat-conversation-adapter";
import {
  chatArtifactLiveClient,
  type ChatArtifactLiveClient,
} from "../api/chat-artifact-live-client";
import type { ChatArtifactLiveEvent } from "../domain/chat-artifact-live";
import type {
  BoundChatContext,
  ChatAllowedAction,
  ChatAttachment,
  ChatAttachmentImportEvent,
  ChatCleanupStatus,
  ChatControlPlaneEvent,
  ChatDraftTarget,
  ChatHistoryPage,
  ChatHistoryPageV4,
  ChatLocalReadiness,
  ChatProjectionEvent,
  ChatProjectionEventV4,
  ChatProject,
  ChatReasoningItem,
  ChatResyncProjection,
  ChatResyncProjectionV4,
  ChatSession,
  ChatSessionControlPlane,
  ChatTurnContentBlock,
} from "../domain/chat-ipc";
import {
  CHAT_NEW_DRAFT_TARGET,
  ChatClientError,
  chatSessionDraftTarget,
} from "../domain/chat-ipc";
import {
  appendOlderConversationSnapshot,
  createConversationState,
  reconcileConversationSnapshot,
  reduceConversationEvent,
  selectConversationItem,
  selectConversationTurn,
  type ConversationItem,
  type ConversationState,
} from "../domain/conversation-state";
import {
  useArtifactStore,
  type ArtifactAuthority,
  type ArtifactAuthorityToken,
} from "./artifact.store";
import { usePermissionStore } from "./permission.store";

const STORE_ID = "chat-conversation";
const MAX_LIVE_ASSISTANT_BYTES = 1024 * 1024;
const MAX_LIVE_REASONING_BYTES = 256 * 1024;
const MAX_SEEN_ARTIFACT_EVENT_IDS = 256;
const MAX_BUFFERED_PROJECTION_EVENTS = 64;
const MAX_BUFFERED_PROJECTION_BYTES = 4 * 1024 * 1024;
const MAX_BUFFERED_ARTIFACT_EVENTS = 64;
const CLEANUP_POLL_INTERVAL_MS = 1_000;
const CLEANUP_POLL_MAX_ATTEMPTS = 120;
export const CHAT_DRAFT_ATTACHMENT_LIMIT = 10;
export const CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS = 220;
const ATTACHMENT_IMPORT_TRANSITIONS = {
  queued: ["importing"],
  importing: ["parsing", "error_terminal"],
  parsing: ["indexing", "error_terminal"],
  indexing: ["ready", "error_terminal"],
  ready: [],
  error_terminal: [],
} as const satisfies Readonly<Record<
  ChatAttachmentImportEvent["stage"],
  readonly ChatAttachmentImportEvent["stage"][]
>>;
const ATTACHMENT_IMPORT_SUCCESS_STAGES = Object.freeze([
  "queued",
  "importing",
  "parsing",
  "indexing",
  "ready",
] as const);

type ActiveAttachmentImport = {
  readonly contextId: string;
  readonly operationId: string;
  readonly draftEpoch: number;
  readonly expectedItemCount: number | null;
  lastSequence: bigint;
  acceptedEvent: ChatAttachmentImportEvent | null;
  readonly displayQueue: ChatAttachmentImportEvent[];
  displayTimer: ReturnType<typeof setTimeout> | null;
  commandSettled: boolean;
};

function validAttachmentImportTransition(
  previous: ChatAttachmentImportEvent["stage"],
  next: ChatAttachmentImportEvent["stage"],
): boolean {
  const allowed = ATTACHMENT_IMPORT_TRANSITIONS[previous] as readonly ChatAttachmentImportEvent["stage"][];
  return allowed.includes(next);
}

export type ChatViewPhase =
  | "idle"
  | "binding"
  | "loading"
  | "ready"
  | "streaming"
  | "resyncing"
  | "resync-required"
  | "permission-denied"
  | "signed-out"
  | "unavailable";

function boundedValueStorageBytes(value: unknown, remaining: number): number {
  if (remaining <= 0 || value === null || value === undefined) return 0;
  if (typeof value === "string") return Math.min(remaining, value.length * 2);
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return Math.min(remaining, 16);
  }
  if (Array.isArray(value)) {
    let total = Math.min(remaining, 16);
    for (const item of value) {
      const size = boundedValueStorageBytes(item, remaining - total);
      total += size;
      if (total >= remaining) break;
    }
    return total;
  }
  if (typeof value !== "object") return 0;
  let total = Math.min(remaining, 32);
  for (const [key, item] of Object.entries(value)) {
    total += Math.min(remaining - total, key.length * 2 + 8);
    total += boundedValueStorageBytes(item, remaining - total);
    if (total >= remaining) break;
  }
  return total;
}

function bufferedProjectionEventBytes(event: ChatProjectionAuthorityEvent): number {
  return boundedValueStorageBytes(event, MAX_BUFFERED_PROJECTION_BYTES + 1);
}

export type ChatBindFailureStage =
  | "event_listener"
  | "context"
  | "projects"
  | "sessions"
  | "readiness"
  | "draft_attachments";

export interface LiveReasoningPart {
  readonly itemOrdinal: number;
  readonly contentIndex: number;
  readonly text: string;
}

export type DeleteDisposition = Readonly<{
  kind: "cleanup_pending" | "navigate";
  deletedSessionId: string;
  nextSessionId: string | null;
  path: "/chat" | `/chat/${string}`;
}>;

export interface ChatArtifactStoreBoundary {
  replaceAuthority(authority: ArtifactAuthority): void;
  clearAuthority(): void;
  captureAuthority(): ArtifactAuthorityToken | null;
  ingestHistoryV3(token: ArtifactAuthorityToken | null, history: ChatHistoryPage): boolean;
}

export interface ChatArtifactAuthoritySource {
  readonly authorizationRevision: number;
  readonly tenantId: string;
}

export interface ChatArtifactIntegration {
  readonly liveClient: ChatArtifactLiveClient;
  readonly store: ChatArtifactStoreBoundary;
  readonly authority: () => ChatArtifactAuthoritySource | null;
}

type ArtifactEventDisposition = "ignore" | "refresh" | "resync";
type ChatHistoryAuthority = ChatHistoryPage | ChatHistoryPageV4;
type ChatProjectionAuthorityEvent = ChatProjectionEvent | ChatProjectionEventV4;
type ChatResyncAuthority = ChatResyncProjection | ChatResyncProjectionV4;

function isHistoryV4(history: ChatHistoryAuthority): history is ChatHistoryPageV4 {
  return "sessionNotices" in history;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function operationId(): string {
  return crypto.randomUUID().toLowerCase();
}

function phaseForError(error: unknown): ChatViewPhase {
  if (!(error instanceof ChatClientError)) return "unavailable";
  switch (error.shape.code) {
    case "chat_unauthenticated":
      return "signed-out";
    case "chat_capability_denied":
      return "permission-denied";
    case "chat_context_invalid":
    case "chat_cursor_invalid":
    case "chat_protocol_error":
      return "resync-required";
    default:
      return "unavailable";
  }
}

function projectInvalidError(): ChatClientError {
  return new ChatClientError({
    schemaVersion: 1,
    code: "chat_project_invalid",
    retryable: false,
    recovery: "reselect_project",
  });
}

export function createChatStoreDefinition(
  client: ChatClient,
  storeId = STORE_ID,
  artifactIntegrationFactory?: () => ChatArtifactIntegration,
  streamingV4Enabled = feat134StreamingUiEnabled,
) {
  return defineStore(storeId, () => {
    const artifactIntegration = artifactIntegrationFactory?.() ?? null;
    const phase = ref<ChatViewPhase>("idle");
    const context = shallowRef<BoundChatContext | null>(null);
    const projects = shallowRef<readonly ChatProject[]>(Object.freeze([]));
    const sessions = shallowRef<readonly ChatSession[]>(Object.freeze([]));
    const sessionsCursor = ref<string | null>(null);
    const selectedSessionId = ref<string | null>(null);
    const history = shallowRef<ChatHistoryAuthority | null>(null);
    const conversationState = shallowRef<ConversationState>(createConversationState());
    const liveAssistantText = ref("");
    const liveReasoning = shallowRef<readonly LiveReasoningPart[]>(Object.freeze([]));
    const liveTurnStatus = ref<string | null>(null);
    const cleanupStatus = shallowRef<ChatCleanupStatus | null>(null);
    const controlPlane = shallowRef<ChatSessionControlPlane | null>(null);
    const localReadiness = shallowRef<ChatLocalReadiness | null>(null);
    const draftTarget = shallowRef<ChatDraftTarget | null>(null);
    const draftTargetReady = ref(false);
    const draftAttachments = shallowRef<readonly ChatAttachment[]>(Object.freeze([]));
    const attachmentImportAttempt = shallowRef<ChatAttachmentImportEvent | null>(null);
    const attachmentImporting = ref(false);
    const attachmentErrorCode = ref<string | null>(null);
    const deleteDisposition = shallowRef<DeleteDisposition | null>(null);
    const lastErrorCode = ref<string | null>(null);
    const lastBindFailureStage = ref<ChatBindFailureStage | null>(null);
    const isReady = computed(() => phase.value === "ready" || phase.value === "streaming");
    const hasSendPermission = computed(() => context.value?.allowedActions.includes(
      selectedSessionId.value === null ? "create_session" : "submit_turn",
    ) === true);
    const canSend = computed(() =>
      phase.value === "ready" &&
      draftTargetReady.value &&
      hasSendPermission.value &&
      localReadiness.value?.canSend === true &&
      (selectedSessionId.value === null || controlPlane.value?.state === "bound"),
    );
    const canAttach = computed(() =>
      canSend.value &&
      draftTarget.value !== null &&
      (
        (draftTarget.value.type === "new" && hasAction("create_session")) ||
        (
          draftTarget.value.type === "session" &&
          draftTarget.value.sessionId === selectedSessionId.value &&
          hasAction("submit_turn")
        )
      ) &&
      !attachmentImporting.value &&
      attachmentImportAttempt.value === null &&
      draftAttachments.value.length < CHAT_DRAFT_ATTACHMENT_LIMIT,
    );
    const draftAttachmentsReady = computed(() =>
      draftTargetReady.value &&
      !attachmentImporting.value &&
      draftAttachments.value.length > 0 &&
      draftAttachments.value.every((attachment) => attachment.status === "ready"),
    );

    let selectionEpoch = 0;
    let authorityEpoch = 0;
    let listenerEpoch = 0;
    let subscriptionId: string | null = null;
    let eventUnlisten: UnlistenFn | null = null;
    let eventListenerPromise: Promise<void> | null = null;
    let sessionListenerEpoch = 0;
    let artifactEventUnlisten: UnlistenFn | null = null;
    let artifactEventListenerPromise: Promise<void> | null = null;
    let controlPlaneUnlisten: UnlistenFn | null = null;
    let controlPlaneListenerPromise: Promise<void> | null = null;
    let attachmentImportUnlisten: UnlistenFn | null = null;
    let attachmentImportListenerPromise: Promise<void> | null = null;
    let controlPlaneSequence: bigint | null = null;
    let activeRead: AbortController | null = null;
    let contextExpiryTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupPollTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupPollEpoch = 0;
    let resyncPromise: Promise<void> | null = null;
    let resyncTrailingRequested = false;
    let artifactRefreshPromise: Promise<void> | null = null;
    let artifactRefreshTrailingRequested = false;
    let draftEpoch = 0;
    let activeAttachmentImport: ActiveAttachmentImport | null = null;
    let pendingSubmission: Readonly<{ key: string; operationId: string }> | null = null;
    let bufferingEvents = false;
    let bufferedEvents: ChatProjectionAuthorityEvent[] = [];
    let bufferedEventBytes = 0;
    let bufferedEventsOverflowed = false;
    let bufferingArtifactEvents = false;
    let bufferedArtifactEvents: ChatArtifactLiveEvent[] = [];
    let bufferedArtifactEventsOverflowed = false;
    let artifactExpectedSequence = 0n;
    let artifactAuthorityToken: ArtifactAuthorityToken | null = null;
    const seenArtifactEventIds = new Set<string>();
    const seenArtifactEventOrder: string[] = [];

    function hasAction(action: ChatAllowedAction): boolean {
      return context.value?.allowedActions.includes(action) ?? false;
    }

    function submissionOperation(key: string): string {
      if (pendingSubmission?.key === key) return pendingSubmission.operationId;
      const next = operationId();
      pendingSubmission = Object.freeze({ key, operationId: next });
      return next;
    }

    function submissionKey(
      kind: "create" | "submit",
      targetId: string,
      input: string,
      blocks: readonly ChatTurnContentBlock[],
    ): string {
      return JSON.stringify({ kind, targetId, input: input.trim(), blocks });
    }

    function clearSubmissionAttempt(): void {
      pendingSubmission = null;
    }

    function rememberArtifactEvent(eventId: string): void {
      seenArtifactEventIds.add(eventId);
      seenArtifactEventOrder.push(eventId);
      while (seenArtifactEventOrder.length > MAX_SEEN_ARTIFACT_EVENT_IDS) {
        const oldest = seenArtifactEventOrder.shift();
        if (oldest) seenArtifactEventIds.delete(oldest);
      }
    }

    function resetArtifactStream(): void {
      artifactExpectedSequence = 0n;
      seenArtifactEventIds.clear();
      seenArtifactEventOrder.length = 0;
      bufferedArtifactEvents = [];
      bufferedArtifactEventsOverflowed = false;
    }

    function resetProjectionBuffer(): void {
      bufferedEvents = [];
      bufferedEventBytes = 0;
      bufferedEventsOverflowed = false;
    }

    function clearExpiryTimer(): void {
      if (contextExpiryTimer !== null) {
        clearTimeout(contextExpiryTimer);
        contextExpiryTimer = null;
      }
    }

    function clearCleanupPoll(): void {
      cleanupPollEpoch += 1;
      if (cleanupPollTimer !== null) {
        clearTimeout(cleanupPollTimer);
        cleanupPollTimer = null;
      }
    }

    function clearSelection(): void {
      selectionEpoch += 1;
      clearCleanupPoll();
      activeRead?.abort();
      activeRead = null;
      selectedSessionId.value = null;
      history.value = null;
      conversationState.value = createConversationState();
      liveAssistantText.value = "";
      liveReasoning.value = Object.freeze([]);
      liveTurnStatus.value = null;
      cleanupStatus.value = null;
      controlPlane.value = null;
      controlPlaneSequence = null;
      deleteDisposition.value = null;
      subscriptionId = null;
      resetProjectionBuffer();
      bufferingEvents = false;
      bufferingArtifactEvents = false;
      resetArtifactStream();
      artifactAuthorityToken = null;
      artifactIntegration?.store.clearAuthority();
      resyncPromise = null;
      resyncTrailingRequested = false;
      artifactRefreshPromise = null;
      artifactRefreshTrailingRequested = false;
    }

    function dropDraftReferences(): void {
      draftEpoch += 1;
      draftAttachments.value = Object.freeze([]);
      attachmentImportAttempt.value = null;
      const displayTimer = activeAttachmentImport?.displayTimer;
      if (displayTimer !== null && displayTimer !== undefined) {
        clearTimeout(displayTimer);
      }
      activeAttachmentImport = null;
      attachmentImporting.value = false;
      attachmentErrorCode.value = null;
      clearSubmissionAttempt();
    }

    function clearDraftTargetState(): void {
      dropDraftReferences();
      draftTarget.value = null;
      draftTargetReady.value = false;
    }

    async function removePersistedDrafts(
      contextId: string,
      target: ChatDraftTarget,
      attachments: readonly ChatAttachment[],
    ): Promise<void> {
      await Promise.allSettled(attachments.map((attachment) =>
        client.removeAttachment(contextId, target, attachment.attachmentId, operationId()),
      ));
    }

    function discardDraftAttachments(): void {
      const contextId = context.value?.contextId;
      const target = draftTarget.value;
      const attachments = draftAttachments.value;
      dropDraftReferences();
      if (contextId && target && attachments.length > 0) {
        void removePersistedDrafts(contextId, target, attachments);
      }
    }

    function sameDraftTarget(left: ChatDraftTarget | null, right: ChatDraftTarget): boolean {
      return left?.type === right.type && (
        right.type === "new" || (left.type === "session" && left.sessionId === right.sessionId)
      );
    }

    async function switchDraftTarget(nextTarget: ChatDraftTarget): Promise<void> {
      const bound = context.value;
      if (!bound || (sameDraftTarget(draftTarget.value, nextTarget) && draftTargetReady.value)) return;

      dropDraftReferences();
      draftTarget.value = nextTarget;
      draftTargetReady.value = false;
      const epoch = draftEpoch;
      attachmentImporting.value = true;

      try {
        const attachments = await client.listDraftAttachments(bound.contextId, nextTarget);
        if (
          context.value?.contextId !== bound.contextId ||
          draftEpoch !== epoch ||
          !sameDraftTarget(draftTarget.value, nextTarget)
        ) return;
        const attachmentIds = new Set(attachments.map((attachment) => attachment.attachmentId));
        if (
          attachments.length > CHAT_DRAFT_ATTACHMENT_LIMIT ||
          attachmentIds.size !== attachments.length ||
          attachments.some((attachment) => attachment.status !== "ready")
        ) {
          throw new ChatClientError({
            schemaVersion: 2,
            code: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          });
        }
        draftAttachments.value = Object.freeze([...attachments]);
        draftTargetReady.value = true;
      } catch (error: unknown) {
        if (
          context.value?.contextId === bound.contextId &&
          draftEpoch === epoch &&
          sameDraftTarget(draftTarget.value, nextTarget)
        ) {
          attachmentErrorCode.value = error instanceof ChatClientError
            ? error.shape.attachmentIssue ?? error.shape.code
            : "chat_temporarily_unavailable";
          throw error;
        }
      } finally {
        if (
          context.value?.contextId === bound.contextId &&
          draftEpoch === epoch &&
          sameDraftTarget(draftTarget.value, nextTarget)
        ) {
          attachmentImporting.value = false;
        }
      }
    }

    function clearAuthority(nextPhase: ChatViewPhase): void {
      authorityEpoch += 1;
      const oldContext = context.value?.contextId;
      const oldSubscription = subscriptionId;
      clearSelection();
      dropDraftReferences();
      draftTarget.value = null;
      draftTargetReady.value = false;
      clearExpiryTimer();
      context.value = null;
      projects.value = Object.freeze([]);
      sessions.value = Object.freeze([]);
      sessionsCursor.value = null;
      localReadiness.value = null;
      phase.value = nextPhase;
      if (oldContext && oldSubscription) {
        void client.unsubscribeSession(oldContext, oldSubscription).catch(() => undefined);
      }
    }

    function scheduleContextExpiry(bound: BoundChatContext): void {
      clearExpiryTimer();
      const delay = Math.max(0, bound.expiresAtEpochSeconds * 1000 - Date.now());
      contextExpiryTimer = setTimeout(() => {
        if (context.value?.contextId === bound.contextId) {
          clearAuthority("resync-required");
        }
      }, delay);
    }

    function startRead(): { epoch: number; controller: AbortController } {
      activeRead?.abort();
      const controller = new AbortController();
      activeRead = controller;
      return { epoch: selectionEpoch, controller };
    }

    function isCurrent(epoch: number, controller: AbortController, sessionId?: string): boolean {
      return (
        epoch === selectionEpoch &&
        activeRead === controller &&
        !controller.signal.aborted &&
        (sessionId === undefined || selectedSessionId.value === sessionId)
      );
    }

    async function ensureEventListener(): Promise<void> {
      if (eventUnlisten !== null) return;
      if (eventListenerPromise !== null) return eventListenerPromise;
      const generation = sessionListenerEpoch;
      const pending = (streamingV4Enabled
        ? client.onEventV4((event) => handleEvent(event), handleInvalidEvent)
        : client.onEvent((event) => handleEvent(event), handleInvalidEvent))
        .then((unlisten) => {
          if (generation !== sessionListenerEpoch) {
            unlisten();
          } else if (eventUnlisten === null) {
            eventUnlisten = unlisten;
          } else {
            unlisten();
          }
        })
        .finally(() => {
          if (eventListenerPromise === pending) eventListenerPromise = null;
        });
      eventListenerPromise = pending;
      return pending;
    }

    async function ensureArtifactEventListener(): Promise<void> {
      if (artifactIntegration === null || artifactEventUnlisten !== null) return;
      if (artifactEventListenerPromise !== null) return artifactEventListenerPromise;
      const generation = sessionListenerEpoch;
      const pending = artifactIntegration.liveClient.listen(handleArtifactEvent, requestResync)
        .then((unlisten) => {
          if (generation !== sessionListenerEpoch) {
            unlisten();
          } else if (artifactEventUnlisten === null) {
            artifactEventUnlisten = unlisten;
          } else {
            unlisten();
          }
        })
        .finally(() => {
          if (artifactEventListenerPromise === pending) artifactEventListenerPromise = null;
        });
      artifactEventListenerPromise = pending;
      return pending;
    }

    function releaseSessionListeners(): void {
      sessionListenerEpoch += 1;
      eventUnlisten?.();
      eventUnlisten = null;
      artifactEventUnlisten?.();
      artifactEventUnlisten = null;
    }

    async function ensureSessionEventListeners(): Promise<void> {
      await Promise.all([ensureEventListener(), ensureArtifactEventListener()]);
      if (eventUnlisten !== null && (artifactIntegration === null || artifactEventUnlisten !== null)) {
        return;
      }
      await Promise.all([ensureEventListener(), ensureArtifactEventListener()]);
      if (eventUnlisten === null || (artifactIntegration !== null && artifactEventUnlisten === null)) {
        throw new Error("chat-session-listener-unavailable");
      }
    }

    async function ensureControlPlaneListener(): Promise<void> {
      if (controlPlaneUnlisten !== null) return;
      if (controlPlaneListenerPromise !== null) return controlPlaneListenerPromise;
      const generation = listenerEpoch;
      const pending = client.onControlPlaneEvent(handleControlPlaneEvent, requestControlPlaneResync)
        .then((unlisten) => {
          if (generation !== listenerEpoch) {
            unlisten();
          } else if (controlPlaneUnlisten === null) {
            controlPlaneUnlisten = unlisten;
          } else {
            unlisten();
          }
        })
        .finally(() => {
          if (controlPlaneListenerPromise === pending) controlPlaneListenerPromise = null;
        });
      controlPlaneListenerPromise = pending;
      return pending;
    }

    async function ensureAttachmentImportListener(): Promise<void> {
      if (attachmentImportUnlisten !== null) return;
      if (attachmentImportListenerPromise !== null) return attachmentImportListenerPromise;
      const generation = listenerEpoch;
      const pending = client.onAttachmentImportEvent(handleAttachmentImportEvent)
        .then((unlisten) => {
          if (generation !== listenerEpoch) {
            unlisten();
          } else if (attachmentImportUnlisten === null) {
            attachmentImportUnlisten = unlisten;
          } else {
            unlisten();
          }
        })
        .finally(() => {
          if (attachmentImportListenerPromise === pending) attachmentImportListenerPromise = null;
        });
      attachmentImportListenerPromise = pending;
      return pending;
    }

    function finishSettledAttachmentDisplay(active: ActiveAttachmentImport): void {
      if (
        activeAttachmentImport !== active ||
        !active.commandSettled ||
        active.displayTimer !== null ||
        active.displayQueue.length > 0
      ) return;
      const displayed = attachmentImportAttempt.value;
      if (displayed?.operationId !== active.operationId) return;
      if (displayed.stage === "ready") attachmentImportAttempt.value = null;
      if (displayed.stage === "ready" || displayed.stage === "error_terminal") {
        activeAttachmentImport = null;
      }
    }

    function displayNextAttachmentImportEvent(active: ActiveAttachmentImport): void {
      if (activeAttachmentImport !== active || active.displayTimer !== null) return;
      const next = active.displayQueue.shift();
      if (!next) {
        finishSettledAttachmentDisplay(active);
        return;
      }
      attachmentImportAttempt.value = next;
      if (next.stage === "error_terminal") {
        attachmentErrorCode.value = next.issue;
        finishSettledAttachmentDisplay(active);
        return;
      }
      active.displayTimer = setTimeout(() => {
        active.displayTimer = null;
        if (activeAttachmentImport !== active) return;
        if (active.displayQueue.length > 0) {
          displayNextAttachmentImportEvent(active);
        } else {
          finishSettledAttachmentDisplay(active);
        }
      }, CHAT_ATTACHMENT_IMPORT_STAGE_MIN_MS);
    }

    function acceptAttachmentImportEvent(
      active: ActiveAttachmentImport,
      event: ChatAttachmentImportEvent,
    ): void {
      active.lastSequence = BigInt(event.sequence);
      active.acceptedEvent = event;
      active.displayQueue.push(event);
      displayNextAttachmentImportEvent(active);
    }

    function syntheticAttachmentImportEvent(
      active: ActiveAttachmentImport,
      stage: ChatAttachmentImportEvent["stage"],
      itemCount: number,
      issue: ChatAttachmentImportEvent["issue"] = null,
    ): ChatAttachmentImportEvent {
      return Object.freeze({
        schemaVersion: 2,
        contextId: active.contextId,
        operationId: active.operationId,
        sequence: (active.lastSequence + 1n).toString(),
        stage,
        itemCount,
        issue,
      });
    }

    function completeAttachmentImportSuccess(
      active: ActiveAttachmentImport,
      itemCount: number,
    ): boolean {
      const current = active.acceptedEvent?.stage ?? null;
      if (current === "error_terminal") return false;
      const currentIndex = current === null
        ? -1
        : ATTACHMENT_IMPORT_SUCCESS_STAGES.indexOf(current as "queued" | "importing" | "parsing" | "indexing" | "ready");
      if (current !== null && currentIndex === -1) return false;
      for (const stage of ATTACHMENT_IMPORT_SUCCESS_STAGES.slice(currentIndex + 1)) {
        acceptAttachmentImportEvent(active, syntheticAttachmentImportEvent(active, stage, itemCount));
      }
      return true;
    }

    function completeAttachmentImportFailure(
      active: ActiveAttachmentImport,
      itemCount: number,
      issue: Exclude<ChatAttachmentImportEvent["issue"], null>,
    ): void {
      const current = active.acceptedEvent?.stage ?? null;
      if (current === "error_terminal") return;
      if (current === "ready") {
        acceptAttachmentImportEvent(
          active,
          syntheticAttachmentImportEvent(active, "error_terminal", itemCount, issue),
        );
        return;
      }
      const failureStage = issue === "parse_failed"
        ? "parsing"
        : issue === "unavailable"
          ? "indexing"
          : "importing";
      const failureStageIndex = ATTACHMENT_IMPORT_SUCCESS_STAGES.indexOf(failureStage);
      const currentIndex = current === null
        ? -1
        : ATTACHMENT_IMPORT_SUCCESS_STAGES.indexOf(current as "queued" | "importing" | "parsing" | "indexing");
      for (const stage of ATTACHMENT_IMPORT_SUCCESS_STAGES.slice(
        currentIndex + 1,
        failureStageIndex + 1,
      )) {
        acceptAttachmentImportEvent(active, syntheticAttachmentImportEvent(active, stage, itemCount));
      }
      acceptAttachmentImportEvent(
        active,
        syntheticAttachmentImportEvent(active, "error_terminal", itemCount, issue),
      );
    }

    function handleAttachmentImportEvent(event: ChatAttachmentImportEvent): void {
      const active = activeAttachmentImport;
      if (
        active === null ||
        context.value?.contextId !== active.contextId ||
        event.contextId !== active.contextId ||
        event.operationId !== active.operationId ||
        draftEpoch !== active.draftEpoch
      ) {
        return;
      }
      const sequence = BigInt(event.sequence);
      if (sequence !== active.lastSequence + 1n) return;
      if (active.expectedItemCount !== null && event.itemCount !== active.expectedItemCount) return;
      const previous = active.acceptedEvent;
      if (
        previous === null
          ? event.stage !== "queued"
          : previous.operationId !== event.operationId ||
            previous.itemCount !== event.itemCount ||
            !validAttachmentImportTransition(previous.stage, event.stage)
      ) return;
      acceptAttachmentImportEvent(active, event);
    }

    function applyControlPlaneStatus(status: ChatSessionControlPlane): void {
      if (status.sessionId !== selectedSessionId.value) return;
      controlPlane.value = status;
      if (status.issueCode !== null) {
        lastErrorCode.value = status.issueCode;
      } else if (
        lastErrorCode.value !== null &&
        [
          "chat_unauthenticated",
          "chat_capability_denied",
          "chat_temporarily_unavailable",
          "chat_conflict",
          "chat_protocol_error",
        ].includes(lastErrorCode.value)
      ) {
        lastErrorCode.value = null;
      }
    }

    function handleControlPlaneEvent(event: ChatControlPlaneEvent): void {
      if (event.sessionId !== selectedSessionId.value || context.value === null) return;
      const sequence = BigInt(event.sequence);
      if (controlPlaneSequence !== null) {
        if (sequence <= controlPlaneSequence) return;
        if (sequence !== controlPlaneSequence + 1n) return requestControlPlaneResync();
      }
      controlPlaneSequence = sequence;
      applyControlPlaneStatus(event);
    }

    function requestControlPlaneResync(): void {
      controlPlaneSequence = null;
      void refreshControlPlane();
    }

    async function refreshControlPlane(): Promise<ChatSessionControlPlane | null> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId) return null;
      try {
        const status = await client.getSessionControlPlane(bound.contextId, sessionId);
        if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== sessionId) {
          return null;
        }
        applyControlPlaneStatus(status);
        return status;
      } catch (error: unknown) {
        if (context.value?.contextId === bound.contextId && selectedSessionId.value === sessionId) {
          lastErrorCode.value = error instanceof ChatClientError
            ? error.shape.code
            : "chat_protocol_error";
        }
        return null;
      }
    }

    function itemText(item: ConversationItem | null): string {
      if (item === null) return "";
      return item.contentBlocks
        .filter((block) => block.type === "text" || block.type === "code")
        .map((block) => block.text)
        .join("");
    }

    function liveProjection(
      state: ConversationState,
      threadId: string,
      turnId: string,
    ): Readonly<{
      assistantText: string;
      reasoning: readonly LiveReasoningPart[];
      turnStatus: string | null;
    }> {
      const assistantText = streamingV4Enabled
        ? Object.values(state.items)
            .filter((item) =>
              item.threadId === threadId &&
              item.turnId === turnId &&
              item.kind === "assistant_message" &&
              item.agentMessagePhase === "final_answer"
            )
            .sort((left, right) => left.ordinal - right.ordinal || left.itemId.localeCompare(right.itemId))
            .map((item) => itemText(item))
            .filter((text) => text.length > 0)
            .join("\n\n")
        : itemText(selectConversationItem(
            state,
            threadId,
            turnId,
            conversationMessageItemId(turnId, "assistant"),
          ));
      const reasoning = Object.values(state.items)
        .filter((item) => item.threadId === threadId && item.turnId === turnId && item.kind === "reasoning")
        .flatMap((item) => {
          const itemOrdinal = conversationReasoningItemOrdinal(turnId, item.itemId) ??
            (streamingV4Enabled ? item.ordinal : null);
          if (itemOrdinal === null) return [];
          return item.contentBlocks
            .filter((block) => block.type === "text" || block.type === "code")
            .map((block) => Object.freeze({
              itemOrdinal,
              contentIndex: block.blockIndex,
              text: block.text,
            }));
        })
        .sort((left, right) =>
          left.itemOrdinal - right.itemOrdinal || left.contentIndex - right.contentIndex
        );
      const turn = selectConversationTurn(state, threadId, turnId);
      const turnStatus = turn?.terminalStatus ?? (
        turn?.status === "in_progress" ? "streaming" : turn?.status ?? null
      );
      return Object.freeze({
        assistantText,
        reasoning: Object.freeze(reasoning),
        turnStatus,
      });
    }

    function compatibilityTurnStatus(
      state: ConversationState,
      threadId: string,
      turnId: string,
    ): string | null {
      const turn = selectConversationTurn(state, threadId, turnId);
      if (turn === null || turn.status === "recovery_required") return null;
      if (turn.terminalStatus !== null) return turn.terminalStatus;
      if (turn.status === "in_progress" || turn.status === "waiting_approval") return "streaming";
      return turn.status;
    }

    function syncSelectedTurnLifecycle(
      state: ConversationState,
      threadId: string,
      turnId: string,
    ): void {
      const status = compatibilityTurnStatus(state, threadId, turnId);
      if (status === null || selectedSessionId.value !== threadId) return;
      liveTurnStatus.value = status;

      const currentHistory = history.value;
      if (currentHistory?.turns.some((turn) => turn.turnId === turnId && turn.status !== status)) {
        history.value = Object.freeze({
          ...currentHistory,
          turns: Object.freeze(currentHistory.turns.map((turn) =>
            turn.turnId === turnId ? Object.freeze({ ...turn, status }) : turn
          )),
        });
      }

      const latestTurn = Object.values(state.turns)
        .filter((turn) => turn.threadId === threadId)
        .sort((left, right) => right.ordinal - left.ordinal || right.turnId.localeCompare(left.turnId))[0];
      if (latestTurn?.turnId !== turnId) return;
      if (sessions.value.some((session) =>
        session.sessionId === threadId && session.latestTurnStatus !== status
      )) {
        sessions.value = Object.freeze(sessions.value.map((session) =>
          session.sessionId === threadId
            ? Object.freeze({ ...session, latestTurnStatus: status })
            : session
        ));
      }
    }

    function syncLiveProjection(projected: ReturnType<typeof liveProjection>): boolean {
      if (
        utf8Bytes(projected.assistantText) > MAX_LIVE_ASSISTANT_BYTES ||
        projected.reasoning.reduce((total, part) => total + utf8Bytes(part.text), 0) >
          MAX_LIVE_REASONING_BYTES
      ) {
        return false;
      }
      liveAssistantText.value = projected.assistantText;
      liveReasoning.value = projected.reasoning;
      liveTurnStatus.value = projected.turnStatus;
      return true;
    }

    function handleInvalidEvent(scope?: ChatInvalidEventScope | null): void {
      if (scope !== null && scope !== undefined && (
        context.value === null ||
        scope.contextId !== context.value.contextId ||
        scope.subscriptionId !== subscriptionId ||
        scope.sessionId !== selectedSessionId.value
      )) {
        return;
      }
      requestResync();
    }

    function applyEvent(event: ChatProjectionAuthorityEvent): void {
      const bound = context.value;
      if (
        bound === null ||
        event.contextId !== bound.contextId ||
        event.subscriptionId !== subscriptionId ||
        event.sessionId !== selectedSessionId.value
      ) return;

      const adapted = projectionEventToConversation(event);
      if (adapted.kind === "context_invalidated") {
        lastErrorCode.value = "chat_context_invalid";
        clearAuthority("resync-required");
        return;
      }
      if (adapted.kind === "cleanup_state") {
        const previous = conversationState.value;
        const next = reduceConversationEvent(previous, adapted.event);
        if (next === previous) return;
        conversationState.value = next;
        if (next.syncStatus === "recovery_required") {
          requestResync();
          return;
        }
        if (event.schemaVersion === 1) void refreshCleanupFromEvent(event);
        return;
      }
      if (adapted.kind === "resync_required") {
        requestResync();
        return;
      }
      if (adapted.event.kind === "thread.notice") {
        const previous = conversationState.value;
        const next = reduceConversationEvent(previous, adapted.event);
        if (next !== previous) conversationState.value = next;
        if (next.syncStatus === "recovery_required") requestResync();
        return;
      }
      if (event.turnId === undefined) {
        requestResync();
        return;
      }

      const previous = conversationState.value;
      const next = reduceConversationEvent(previous, adapted.event);
      if (next === previous) return;
      const projected = liveProjection(next, event.sessionId, event.turnId);
      if (!syncLiveProjection(projected)) {
        requestResync();
        return;
      }
      conversationState.value = next;
      if (next.syncStatus === "recovery_required") {
        requestResync();
        return;
      }
      syncSelectedTurnLifecycle(next, event.sessionId, event.turnId);
      if (event.kind === "turn_terminal") {
        phase.value = "ready";
        void resyncSelected();
        return;
      }
      phase.value = "streaming";
    }

    function applyBufferedEvents(
      pending: readonly ChatProjectionAuthorityEvent[],
      snapshotHistory: ChatHistoryAuthority,
    ): void {
      const durableCut = isHistoryV4(snapshotHistory)
        ? BigInt(snapshotHistory.durableSequenceCut)
        : null;
      for (const event of pending) {
        const matchesAuthority = context.value !== null &&
          event.contextId === context.value.contextId &&
          event.subscriptionId === subscriptionId &&
          event.sessionId === selectedSessionId.value;
        const includedInSnapshot = matchesAuthority &&
          durableCut !== null &&
          event.schemaVersion === 4 &&
          "durableSequence" in event &&
          BigInt(event.durableSequence) <= durableCut;
        if (!includedInSnapshot) {
          applyEvent(event);
          continue;
        }

        const next = reduceConversationEvent(conversationState.value, Object.freeze({
          eventId: event.eventId,
          streamId: event.subscriptionId,
          sequence: event.projectionSequence,
          threadId: event.sessionId,
          kind: "auxiliary" as const,
        }));
        conversationState.value = next;
        if (next.syncStatus === "recovery_required") {
          requestResync();
          return;
        }
      }
    }

    function handleEvent(event: ChatProjectionAuthorityEvent): void {
      if (bufferingEvents) {
        if (event.kind === "context_invalidated") {
          applyEvent(event);
          return;
        }
        if (bufferedEventsOverflowed) {
          resyncTrailingRequested = true;
          return;
        }
        const eventBytes = bufferedProjectionEventBytes(event);
        if (bufferedEvents.length >= MAX_BUFFERED_PROJECTION_EVENTS ||
            eventBytes > MAX_BUFFERED_PROJECTION_BYTES - bufferedEventBytes) {
          resetProjectionBuffer();
          bufferedEventsOverflowed = true;
          resyncTrailingRequested = true;
          return;
        }
        bufferedEvents.push(event);
        bufferedEventBytes += eventBytes;
        return;
      }
      applyEvent(event);
    }

    function classifyArtifactEvent(event: ChatArtifactLiveEvent): ArtifactEventDisposition {
      if (
        context.value === null ||
        event.contextId !== context.value.contextId ||
        event.subscriptionId !== subscriptionId ||
        event.sessionId !== selectedSessionId.value
      ) {
        return "ignore";
      }
      if (event.kind === "context_invalidated") {
        lastErrorCode.value = "chat_context_invalid";
        clearAuthority("resync-required");
        return "ignore";
      }
      const sequence = BigInt(event.notificationSequence);
      if (sequence <= artifactExpectedSequence) {
        return seenArtifactEventIds.has(event.eventId) ? "ignore" : "resync";
      }
      if (sequence !== artifactExpectedSequence + 1n) return "resync";
      artifactExpectedSequence = sequence;
      rememberArtifactEvent(event.eventId);
      return event.kind === "artifact_changed" ? "refresh" : "resync";
    }

    function requestArtifactRefresh(): void {
      if (artifactIntegration === null) return;
      if (artifactRefreshPromise !== null) {
        artifactRefreshTrailingRequested = true;
        return;
      }
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      const activeSubscription = subscriptionId;
      const token = artifactAuthorityToken;
      if (!bound || !sessionId || !activeSubscription || token === null) return;

      const run = async (): Promise<void> => {
        try {
          const page = await client.loadHistoryV3(bound.contextId, sessionId, undefined, 20);
          if (
            context.value?.contextId !== bound.contextId ||
            selectedSessionId.value !== sessionId ||
            subscriptionId !== activeSubscription
          ) return;
          if (!artifactIntegration.store.ingestHistoryV3(token, page)) requestResync();
        } catch {
          if (
            context.value?.contextId === bound.contextId &&
            selectedSessionId.value === sessionId &&
            subscriptionId === activeSubscription
          ) requestResync();
        }
      };
      const promise = run().finally(() => {
        if (artifactRefreshPromise !== promise) return;
        artifactRefreshPromise = null;
        const runTrailing = artifactRefreshTrailingRequested &&
          context.value?.contextId === bound.contextId &&
          selectedSessionId.value === sessionId &&
          subscriptionId === activeSubscription;
        artifactRefreshTrailingRequested = false;
        if (runTrailing) requestArtifactRefresh();
      });
      artifactRefreshPromise = promise;
    }

    function handleArtifactEvent(event: ChatArtifactLiveEvent): void {
      if (
        context.value === null ||
        event.contextId !== context.value.contextId ||
        event.subscriptionId !== subscriptionId ||
        event.sessionId !== selectedSessionId.value
      ) {
        return;
      }
      if (event.kind === "context_invalidated") {
        lastErrorCode.value = "chat_context_invalid";
        clearAuthority("resync-required");
        return;
      }
      if (bufferingArtifactEvents) {
        if (bufferedArtifactEventsOverflowed) {
          resyncTrailingRequested = true;
          return;
        }
        if (bufferedArtifactEvents.length >= MAX_BUFFERED_ARTIFACT_EVENTS) {
          bufferedArtifactEvents = [];
          bufferedArtifactEventsOverflowed = true;
          resyncTrailingRequested = true;
          return;
        }
        bufferedArtifactEvents.push(event);
        return;
      }
      const disposition = classifyArtifactEvent(event);
      if (disposition === "refresh") requestArtifactRefresh();
      if (disposition === "resync") requestResync();
    }

    function requestResync(): void {
      liveAssistantText.value = "";
      liveReasoning.value = Object.freeze([]);
      liveTurnStatus.value = null;
      phase.value = "resync-required";
      void resyncSelected();
    }

    async function refreshCleanupFromEvent(event: ChatProjectionEvent): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      const activeSubscription = subscriptionId;
      const cleanupSelectionEpoch = selectionEpoch;
      if (
        event.kind !== "cleanup_state" || bound === null || sessionId === null ||
        activeSubscription === null || event.contextId !== bound.contextId ||
        event.sessionId !== sessionId || event.subscriptionId !== activeSubscription
      ) return;
      const operation = event.payload.operationId;
      if (typeof operation !== "string") return requestResync();
      const isCurrentCleanupEvent = (): boolean => (
        context.value?.contextId === bound.contextId &&
        selectionEpoch === cleanupSelectionEpoch &&
        selectedSessionId.value === sessionId &&
        subscriptionId === activeSubscription
      );
      try {
        if (cleanupStatus.value?.operationId !== operation) {
          const status = await client.getCleanupStatus(bound.contextId, operation);
          if (!isCurrentCleanupEvent()) return;
          cleanupStatus.value = status;
        }
        if (!isCurrentCleanupEvent()) return;
        await refreshSelectedCleanup();
      } catch {
        if (isCurrentCleanupEvent()) requestResync();
      }
    }

    async function bind(tenantSelector: string): Promise<void> {
      clearAuthority("binding");
      const bindEpoch = authorityEpoch;
      lastErrorCode.value = null;
      lastBindFailureStage.value = null;
      const atBindStage = async <T>(stage: ChatBindFailureStage, operation: Promise<T>): Promise<T> => {
        try {
          return await operation;
        } catch (error) {
          if (lastBindFailureStage.value === null) lastBindFailureStage.value = stage;
          throw error;
        }
      };
      try {
        await Promise.all([
          atBindStage("event_listener", ensureEventListener()),
          atBindStage("event_listener", ensureArtifactEventListener()),
          atBindStage("event_listener", ensureControlPlaneListener()),
          atBindStage("event_listener", ensureAttachmentImportListener()),
        ]);
        if (bindEpoch !== authorityEpoch) return;
        const bound = await atBindStage("context", client.bindContext(tenantSelector));
        if (bindEpoch !== authorityEpoch) return;
        context.value = bound;
        scheduleContextExpiry(bound);
        phase.value = "loading";
        const [nextProjects, nextSessions, nextReadiness] = await Promise.all([
          atBindStage("projects", client.listProjects(bound.contextId)),
          atBindStage("sessions", client.listSessions(bound.contextId)),
          atBindStage("readiness", client.getLocalReadiness(bound.contextId)),
        ]);
        if (bindEpoch !== authorityEpoch || context.value?.contextId !== bound.contextId) return;
        projects.value = nextProjects;
        sessions.value = nextSessions.sessions;
        sessionsCursor.value = nextSessions.nextCursor;
        localReadiness.value = nextReadiness;
        if (hasAction("create_session")) {
          await atBindStage("draft_attachments", switchDraftTarget(CHAT_NEW_DRAFT_TARGET));
        } else {
          clearDraftTargetState();
        }
        if (bindEpoch !== authorityEpoch || context.value?.contextId !== bound.contextId) return;
        phase.value = "ready";
      } catch (error: unknown) {
        if (bindEpoch !== authorityEpoch) return;
        if (lastBindFailureStage.value === "event_listener") releaseSessionListeners();
        lastErrorCode.value = error instanceof ChatClientError ? error.shape.code : "chat_protocol_error";
        if (lastBindFailureStage.value === "draft_attachments" && context.value !== null) {
          phase.value = phaseForError(error);
          return;
        }
        clearAuthority(phaseForError(error));
      }
    }

    function establishArtifactAuthority(sessionId: string): ArtifactAuthorityToken | null {
      if (artifactIntegration === null) return null;
      const source = artifactIntegration.authority();
      const bound = context.value;
      if (
        source === null ||
        bound === null ||
        !Number.isSafeInteger(source.authorizationRevision) ||
        source.authorizationRevision < 0
      ) {
        throw new ChatClientError({
          schemaVersion: 3,
          code: "chat_context_invalid",
          retryable: false,
          recovery: "rebind_context",
        });
      }
      artifactIntegration.store.replaceAuthority(Object.freeze({
        authorizationRevision: source.authorizationRevision,
        contextId: bound.contextId,
        tenantId: source.tenantId,
        sessionId,
      }));
      const token = artifactIntegration.store.captureAuthority();
      if (token === null) {
        throw new ChatClientError({
          schemaVersion: 3,
          code: "chat_protocol_error",
          retryable: false,
          recovery: "resync",
        });
      }
      return token;
    }

    function subscribeAuthority(contextId: string, sessionId: string): Promise<string> {
      return streamingV4Enabled
        ? client.subscribeSessionV4(contextId, sessionId)
        : client.subscribeSession(contextId, sessionId);
    }

    function resyncAuthority(
      contextId: string,
      sessionId: string,
      limit: number,
      signal: AbortSignal,
    ): Promise<ChatResyncAuthority> {
      return streamingV4Enabled
        ? client.resyncSessionV4(contextId, sessionId, limit, signal)
        : client.resyncSessionV2(contextId, sessionId, limit, signal);
    }

    function loadHistoryAuthority(
      contextId: string,
      sessionId: string,
      cursor: string | undefined,
      limit: number,
      signal?: AbortSignal,
    ): Promise<ChatHistoryAuthority> {
      if (streamingV4Enabled) {
        return client.loadHistoryV4(contextId, sessionId, cursor, limit, signal);
      }
      return artifactIntegration === null
        ? client.loadHistoryV2(contextId, sessionId, cursor, limit, signal)
        : client.loadHistoryV3(contextId, sessionId, cursor, limit, signal);
    }

    async function selectSession(sessionId: string): Promise<void> {
      const bound = context.value;
      if (!bound || !hasAction("read_sessions")) {
        phase.value = "permission-denied";
        return;
      }
      lastErrorCode.value = null;
      const targetSync = hasAction("submit_turn")
        ? switchDraftTarget(chatSessionDraftTarget(sessionId))
        : Promise.resolve();
      if (!hasAction("submit_turn")) clearDraftTargetState();
      const oldSubscription = subscriptionId;
      const oldSession = selectedSessionId.value;
      clearSelection();
      selectedSessionId.value = sessionId;
      phase.value = "resyncing";
      if (oldSubscription && oldSession) {
        void client.unsubscribeSession(bound.contextId, oldSubscription).catch(() => undefined);
      }
      const { epoch, controller } = startRead();
      resetProjectionBuffer();
      bufferingEvents = true;
      bufferingArtifactEvents = artifactIntegration !== null;
      try {
        await Promise.all([
          targetSync,
          ensureSessionEventListeners(),
        ]);
        if (!isCurrent(epoch, controller, sessionId)) return;
        artifactAuthorityToken = establishArtifactAuthority(sessionId);
        const nextSubscription = await subscribeAuthority(bound.contextId, sessionId);
        if (!isCurrent(epoch, controller, sessionId)) {
          void client.unsubscribeSession(bound.contextId, nextSubscription).catch(() => undefined);
          return;
        }
        subscriptionId = nextSubscription;
        resetArtifactStream();
        bufferingArtifactEvents = artifactIntegration !== null;
        const projection = await resyncAuthority(bound.contextId, sessionId, 20, controller.signal);
        if (!isCurrent(epoch, controller, sessionId) || subscriptionId !== nextSubscription) return;
        let authoritativeHistory: ChatHistoryAuthority = projection.history;
        let trailingArtifactRefresh = false;
        if (artifactIntegration !== null) {
          const firstHistory = await loadHistoryAuthority(
            bound.contextId,
            sessionId,
            undefined,
            20,
            controller.signal,
          );
          if (
            !isCurrent(epoch, controller, sessionId) ||
            subscriptionId !== nextSubscription ||
            !artifactIntegration.store.ingestHistoryV3(artifactAuthorityToken, firstHistory)
          ) return;
          const initiallyBuffered = bufferedArtifactEvents;
          bufferedArtifactEvents = [];
          for (const event of initiallyBuffered) {
            if (classifyArtifactEvent(event) === "resync") resyncTrailingRequested = true;
          }
          const secondHistory = await loadHistoryAuthority(
            bound.contextId,
            sessionId,
            undefined,
            20,
            controller.signal,
          );
          if (
            !isCurrent(epoch, controller, sessionId) ||
            subscriptionId !== nextSubscription ||
            !artifactIntegration.store.ingestHistoryV3(artifactAuthorityToken, secondHistory)
          ) return;
          authoritativeHistory = secondHistory;
        }
        applyResync(projection, authoritativeHistory);
        await refreshControlPlane();
        const lateNotifications = bufferedArtifactEvents;
        bufferedArtifactEvents = [];
        for (const event of lateNotifications) {
          const disposition = classifyArtifactEvent(event);
          if (disposition === "refresh") trailingArtifactRefresh = true;
          if (disposition === "resync") resyncTrailingRequested = true;
        }
        bufferingEvents = false;
        bufferingArtifactEvents = false;
        const pending = bufferedEvents;
        resetProjectionBuffer();
        activeRead = null;
        if (phase.value === "resyncing") phase.value = "ready";
        applyBufferedEvents(pending, authoritativeHistory);
        if (resyncTrailingRequested) {
          resyncTrailingRequested = false;
          requestResync();
        } else if (trailingArtifactRefresh) {
          requestArtifactRefresh();
        }
      } catch (error: unknown) {
        if (!isCurrent(epoch, controller, sessionId)) return;
        releaseSessionListeners();
        bufferingEvents = false;
        bufferingArtifactEvents = false;
        resetProjectionBuffer();
        bufferedArtifactEvents = [];
        activeRead = null;
        lastErrorCode.value = error instanceof ChatClientError ? error.shape.code : "chat_protocol_error";
        phase.value = phaseForError(error);
      }
    }

    async function clearSelectedSession(): Promise<void> {
      const bound = context.value;
      if (
        bound &&
        selectedSessionId.value === null &&
        sameDraftTarget(draftTarget.value, CHAT_NEW_DRAFT_TARGET) &&
        draftTargetReady.value
      ) {
        return;
      }
      const targetSync = bound && hasAction("create_session")
        ? switchDraftTarget(CHAT_NEW_DRAFT_TARGET)
        : Promise.resolve();
      if (bound && !hasAction("create_session")) clearDraftTargetState();
      const oldSubscription = subscriptionId;
      clearSelection();
      if (bound && oldSubscription) {
        void client.unsubscribeSession(bound.contextId, oldSubscription).catch(() => false);
      }
      if (!bound) return;
      lastErrorCode.value = null;
      phase.value = "loading";
      try {
        await targetSync;
        if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== null) return;
        phase.value = "ready";
      } catch (error: unknown) {
        if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== null) return;
        lastErrorCode.value = error instanceof ChatClientError ? error.shape.code : "chat_protocol_error";
        phase.value = phaseForError(error);
      }
    }

    async function retryDraftRecovery(): Promise<boolean> {
      const bound = context.value;
      if (!bound) return false;
      const sessionId = selectedSessionId.value;
      const requiredDraftAction = sessionId === null ? "create_session" : "submit_turn";
      if (!hasAction(requiredDraftAction)) {
        clearDraftTargetState();
        return false;
      }
      const expectedTarget = sessionId === null
        ? CHAT_NEW_DRAFT_TARGET
        : chatSessionDraftTarget(sessionId);
      if (sameDraftTarget(draftTarget.value, expectedTarget) && draftTargetReady.value) return true;

      if (sessionId !== null) {
        await selectSession(sessionId);
        return phase.value === "ready" && draftTargetReady.value;
      }

      lastErrorCode.value = null;
      phase.value = "loading";
      try {
        await switchDraftTarget(CHAT_NEW_DRAFT_TARGET);
        if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== null) return false;
        lastBindFailureStage.value = null;
        phase.value = "ready";
        return true;
      } catch (error: unknown) {
        if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== null) return false;
        lastErrorCode.value = error instanceof ChatClientError ? error.shape.code : "chat_protocol_error";
        phase.value = phaseForError(error);
        return false;
      }
    }

    function applyResync(
      projection: ChatResyncAuthority,
      authoritativeHistory: ChatHistoryAuthority = projection.history,
    ): void {
      if (projection.session.sessionId !== selectedSessionId.value) {
        throw new ChatClientError({ schemaVersion: 1, code: "chat_protocol_error", retryable: false, recovery: "resync" });
      }
      const snapshot = historyPageToConversationSnapshot(
        projection.session.sessionId,
        authoritativeHistory,
      );
      const nextConversation = reconcileConversationSnapshot(conversationState.value, snapshot);
      conversationState.value = nextConversation;
      cleanupStatus.value = projection.cleanup;
      const latestConversationTurn = Object.values(nextConversation.turns)
        .filter((turn) => turn.threadId === projection.session.sessionId)
        .sort((left, right) => right.ordinal - left.ordinal || right.turnId.localeCompare(left.turnId))[0];
      const authoritativeLatestTurnStatus = latestConversationTurn === undefined
        ? projection.session.latestTurnStatus
        : compatibilityTurnStatus(
            nextConversation,
            projection.session.sessionId,
            latestConversationTurn.turnId,
          );
      const authoritativeSession = Object.freeze({
        ...projection.session,
        latestTurnStatus: authoritativeLatestTurnStatus,
      });
      const projectedSessionIndex = sessions.value.findIndex((session) =>
        session.sessionId === projection.session.sessionId,
      );
      sessions.value = projectedSessionIndex === -1
        ? Object.freeze([authoritativeSession, ...sessions.value])
        : Object.freeze(sessions.value.map((session, index) =>
            index === projectedSessionIndex ? authoritativeSession : session,
          ));
      const projectedLiveTurn = Object.values(nextConversation.turns)
        .filter((turn) => turn.threadId === projection.session.sessionId && (
          turn.status === "in_progress" || turn.status === "queued" ||
          turn.status === "waiting_approval" || turn.status === "recovery_required"
        ))
        .sort((left, right) => right.ordinal - left.ordinal || right.turnId.localeCompare(left.turnId))[0];
      if (projectedLiveTurn !== undefined) {
        const projected = liveProjection(
          nextConversation,
          projection.session.sessionId,
          projectedLiveTurn.turnId,
        );
        if (!syncLiveProjection(projected)) {
          throw new ChatClientError({
            schemaVersion: 1,
            code: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          });
        }
      } else {
        liveAssistantText.value = "";
        liveReasoning.value = Object.freeze([]);
        liveTurnStatus.value = authoritativeLatestTurnStatus;
      }
      if (nextConversation.syncStatus === "recovery_required") {
        lastErrorCode.value = "chat_protocol_error";
        phase.value = "resync-required";
        return;
      }
      history.value = authoritativeHistory;
    }

    async function resyncSelected(): Promise<void> {
      if (resyncPromise !== null) {
        resyncTrailingRequested = true;
        return resyncPromise;
      }
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !subscriptionId) return;
      const { epoch, controller } = startRead();
      phase.value = "resyncing";
      resetProjectionBuffer();
      bufferingEvents = true;
      bufferingArtifactEvents = artifactIntegration !== null;
      const previousSubscription = subscriptionId;
      const run = async (): Promise<void> => {
        try {
          await ensureSessionEventListeners();
          artifactAuthorityToken = establishArtifactAuthority(sessionId);
          const nextSubscription = await subscribeAuthority(bound.contextId, sessionId);
          if (!isCurrent(epoch, controller, sessionId)) {
            void client.unsubscribeSession(bound.contextId, nextSubscription).catch(() => undefined);
            throw new ChatClientError({ schemaVersion: 1, code: "chat_request_cancelled", retryable: false, recovery: "none" });
          }
          subscriptionId = nextSubscription;
          resetArtifactStream();
          await client.unsubscribeSession(bound.contextId, previousSubscription).catch(() => false);
          bufferingArtifactEvents = artifactIntegration !== null;
          const projection = await resyncAuthority(
            bound.contextId,
            sessionId,
            20,
            controller.signal,
          );
          if (!isCurrent(epoch, controller, sessionId) || subscriptionId !== nextSubscription) return;
          let authoritativeHistory: ChatHistoryAuthority = projection.history;
          if (artifactIntegration !== null) {
            const page = await loadHistoryAuthority(
              bound.contextId,
              sessionId,
              undefined,
              20,
              controller.signal,
            );
            if (
              !isCurrent(epoch, controller, sessionId) ||
              subscriptionId !== nextSubscription ||
              !artifactIntegration.store.ingestHistoryV3(artifactAuthorityToken, page)
            ) return;
            authoritativeHistory = page;
          }
          applyResync(projection, authoritativeHistory);
          void refreshControlPlane();
          const pendingArtifactEvents = bufferedArtifactEvents;
          bufferedArtifactEvents = [];
          let needsTrailingArtifactRefresh = false;
          for (const event of pendingArtifactEvents) {
            const disposition = classifyArtifactEvent(event);
            if (disposition === "refresh") needsTrailingArtifactRefresh = true;
            if (disposition === "resync") resyncTrailingRequested = true;
          }
          const pending = bufferedEvents;
          resetProjectionBuffer();
          bufferingEvents = false;
          bufferingArtifactEvents = false;
          activeRead = null;
          if (phase.value === "resyncing") phase.value = "ready";
          applyBufferedEvents(pending, authoritativeHistory);
          if (needsTrailingArtifactRefresh && !resyncTrailingRequested) requestArtifactRefresh();
        } catch (error: unknown) {
          if (!isCurrent(epoch, controller, sessionId)) return;
          activeRead = null;
          bufferingEvents = false;
          bufferingArtifactEvents = false;
          resetProjectionBuffer();
          bufferedArtifactEvents = [];
          lastErrorCode.value = error instanceof ChatClientError ? error.shape.code : "chat_protocol_error";
          phase.value = phaseForError(error);
        }
      };
      const promise = run().finally(() => {
        if (resyncPromise !== promise) return;
        resyncPromise = null;
        if (
          resyncTrailingRequested &&
          context.value?.contextId === bound.contextId &&
          selectedSessionId.value === sessionId &&
          subscriptionId !== null
        ) {
          resyncTrailingRequested = false;
          void resyncSelected();
        }
      });
      resyncPromise = promise;
      return promise;
    }

    async function loadOlderHistory(): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      const cursor = history.value?.nextCursor;
      if (!bound || !sessionId || !cursor) return;
      const { epoch, controller } = startRead();
      try {
        const token = artifactAuthorityToken;
        const page = await loadHistoryAuthority(
          bound.contextId,
          sessionId,
          cursor,
          20,
          controller.signal,
        );
        if (!isCurrent(epoch, controller, sessionId)) return;
        const currentHistory = history.value;
        if (currentHistory === null) throw new ChatClientError({
          schemaVersion: streamingV4Enabled ? 4 : 1,
          code: "chat_protocol_error",
          retryable: false,
          recovery: "resync",
        });
        const turns = Object.freeze([
          ...currentHistory.turns,
          ...page.turns,
        ]);
        const mergedHistory: ChatHistoryAuthority = streamingV4Enabled
          ? isHistoryV4(currentHistory) && isHistoryV4(page)
            ? Object.freeze({
                turns,
                nextCursor: page.nextCursor,
                sessionNotices: currentHistory.sessionNotices,
                durableSequenceCut: currentHistory.durableSequenceCut,
              })
            : (() => { throw new ChatClientError({
                schemaVersion: 4,
                code: "chat_protocol_error",
                retryable: false,
                recovery: "resync",
              }); })()
          : Object.freeze({ turns, nextCursor: page.nextCursor });
        const appended = appendOlderConversationSnapshot(
          conversationState.value,
          historyPageToConversationSnapshot(sessionId, page),
        );
        if (appended.syncStatus === "recovery_required") {
          conversationState.value = appended;
          lastErrorCode.value = "chat_protocol_error";
          phase.value = "resync-required";
          activeRead = null;
          return;
        }
        if (artifactIntegration !== null && !artifactIntegration.store.ingestHistoryV3(token, page)) return;
        conversationState.value = appended;
        history.value = mergedHistory;
        activeRead = null;
      } catch (error: unknown) {
        if (!isCurrent(epoch, controller, sessionId)) return;
        activeRead = null;
        phase.value = phaseForError(error);
      }
    }

    async function loadHistoryPage(limit: number): Promise<Readonly<{
      page: ChatHistoryPage;
      cursorMonotonic: boolean;
      pagesDisjoint: boolean;
    }> | null> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !Number.isSafeInteger(limit) || limit <= 0 || limit > 50) return null;
      try {
        const page = await loadHistoryAuthority(bound.contextId, sessionId, undefined, limit);
        if (!page.nextCursor) return { page, cursorMonotonic: true, pagesDisjoint: true };
        const next = await loadHistoryAuthority(bound.contextId, sessionId, page.nextCursor, limit);
        const firstIds = new Set(page.turns.map((turn) => turn.turnId));
        const pagesDisjoint = next.turns.every((turn) => !firstIds.has(turn.turnId));
        return {
          page,
          cursorMonotonic: next.nextCursor === null || next.nextCursor !== page.nextCursor,
          pagesDisjoint,
        };
      } catch {
        return null;
      }
    }

    async function loadReasoning(turnId: string): Promise<readonly ChatReasoningItem[]> {
      const bound = context.value;
      if (!bound) return Object.freeze([]);
      const { epoch, controller } = startRead();
      try {
        const items = await client.loadReasoning(bound.contextId, turnId, controller.signal);
        if (!isCurrent(epoch, controller)) return Object.freeze([]);
        activeRead = null;
        return items;
      } catch (error: unknown) {
        if (isCurrent(epoch, controller)) {
          activeRead = null;
          phase.value = phaseForError(error);
        }
        return Object.freeze([]);
      }
    }

    async function runAttachmentImport(
      operation: (
        bound: BoundChatContext,
        target: ChatDraftTarget,
        importOperationId: string,
      ) => Promise<readonly ChatAttachment[]>,
      expectedItemCount: number | null = null,
    ): Promise<readonly ChatAttachment[]> {
      const bound = context.value;
      const target = draftTarget.value;
      if (!bound || !target || !canAttach.value) {
        if (draftAttachments.value.length >= CHAT_DRAFT_ATTACHMENT_LIMIT) {
          attachmentErrorCode.value = "chat_limit_exceeded";
        }
        return Object.freeze([]);
      }
      const epoch = draftEpoch;
      const importOperationId = operationId();
      const remainingCapacity = CHAT_DRAFT_ATTACHMENT_LIMIT - draftAttachments.value.length;
      const existingIds = new Set(draftAttachments.value.map((attachment) => attachment.attachmentId));
      attachmentImportAttempt.value = null;
      attachmentImporting.value = true;
      attachmentErrorCode.value = null;
      try {
        await ensureAttachmentImportListener();
        if (context.value?.contextId !== bound.contextId || draftEpoch !== epoch) {
          return Object.freeze([]);
        }
        activeAttachmentImport = {
          contextId: bound.contextId,
          operationId: importOperationId,
          draftEpoch: epoch,
          expectedItemCount,
          lastSequence: 0n,
          acceptedEvent: null,
          displayQueue: [],
          displayTimer: null,
          commandSettled: false,
        };
        const attachments = await operation(bound, target, importOperationId);
        if (context.value?.contextId !== bound.contextId || draftEpoch !== epoch) {
          return Object.freeze([]);
        }
        if (
          attachments.length > remainingCapacity ||
          attachments.some((attachment) => existingIds.has(attachment.attachmentId))
        ) {
          await removePersistedDrafts(
            bound.contextId,
            target,
            attachments.filter((attachment) => !existingIds.has(attachment.attachmentId)),
          );
          throw new ChatClientError({
            schemaVersion: 2,
            code: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          });
        }
        const active = activeAttachmentImport;
        if (attachments.length === 0) {
          if (active?.operationId === importOperationId) {
            active.commandSettled = true;
            if (active.acceptedEvent === null) activeAttachmentImport = null;
          }
          return Object.freeze([]);
        }
        if (
          !active ||
          active.operationId !== importOperationId ||
          (active.acceptedEvent !== null && active.acceptedEvent.itemCount !== attachments.length) ||
          !completeAttachmentImportSuccess(active, attachments.length)
        ) {
          await removePersistedDrafts(bound.contextId, target, attachments);
          throw new ChatClientError({
            schemaVersion: 2,
            code: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          });
        }
        active.commandSettled = true;
        finishSettledAttachmentDisplay(active);
        draftAttachments.value = Object.freeze([...draftAttachments.value, ...attachments]);
        clearSubmissionAttempt();
        return attachments;
      } catch (error: unknown) {
        if (context.value?.contextId === bound.contextId && draftEpoch === epoch) {
          attachmentErrorCode.value = error instanceof ChatClientError
            ? error.shape.attachmentIssue ?? error.shape.code
            : "chat_temporarily_unavailable";
          const active = activeAttachmentImport;
          if (active?.operationId === importOperationId) {
            const itemCount = active.acceptedEvent?.itemCount ?? (
              error instanceof ChatClientError
                ? error.shape.attachmentItemCount ?? expectedItemCount
                : expectedItemCount
            );
            if (itemCount !== null && itemCount >= 1 && itemCount <= CHAT_DRAFT_ATTACHMENT_LIMIT) {
              completeAttachmentImportFailure(
                active,
                itemCount,
                error instanceof ChatClientError && error.shape.attachmentIssue
                  ? error.shape.attachmentIssue
                  : "unavailable",
              );
            }
            active.commandSettled = true;
            if (active.acceptedEvent === null) activeAttachmentImport = null;
            else finishSettledAttachmentDisplay(active);
          }
        }
        throw error;
      } finally {
        if (context.value?.contextId === bound.contextId && draftEpoch === epoch) {
          attachmentImporting.value = false;
        }
      }
    }

    function pickAttachments(): Promise<readonly ChatAttachment[]> {
      const remainingCapacity = CHAT_DRAFT_ATTACHMENT_LIMIT - draftAttachments.value.length;
      return runAttachmentImport((bound, target, importOperationId) => client.pickAttachments(
        bound.contextId,
        target,
        remainingCapacity,
        importOperationId,
      ));
    }

    function importAttachmentPaths(paths: readonly string[]): Promise<readonly ChatAttachment[]> {
      if (paths.length === 0) return Promise.resolve(Object.freeze([]));
      if (paths.length > CHAT_DRAFT_ATTACHMENT_LIMIT - draftAttachments.value.length) {
        attachmentErrorCode.value = "too_many";
        return Promise.resolve(Object.freeze([]));
      }
      const remainingCapacity = CHAT_DRAFT_ATTACHMENT_LIMIT - draftAttachments.value.length;
      return runAttachmentImport((bound, target, importOperationId) => client.importAttachments(
        bound.contextId,
        target,
        paths,
        remainingCapacity,
        importOperationId,
      ), paths.length);
    }

    async function removeDraftAttachment(attachmentId: string): Promise<void> {
      const bound = context.value;
      const target = draftTarget.value;
      if (
        !bound || !target || !hasSendPermission.value ||
        !draftAttachments.value.some((attachment) => attachment.attachmentId === attachmentId)
      ) return;
      const epoch = draftEpoch;
      attachmentErrorCode.value = null;
      try {
        await client.removeAttachment(bound.contextId, target, attachmentId, operationId());
        if (context.value?.contextId !== bound.contextId || draftEpoch !== epoch) return;
        draftAttachments.value = Object.freeze(
          draftAttachments.value.filter((attachment) => attachment.attachmentId !== attachmentId),
        );
        clearSubmissionAttempt();
      } catch (error: unknown) {
        if (context.value?.contextId === bound.contextId && draftEpoch === epoch) {
          attachmentErrorCode.value = error instanceof ChatClientError
            ? error.shape.attachmentIssue ?? error.shape.code
            : "chat_temporarily_unavailable";
        }
        throw error;
      }
    }

    function dismissAttachmentImportAttempt(operationId: string): void {
      if (
        attachmentImportAttempt.value?.operationId !== operationId ||
        attachmentImportAttempt.value.stage !== "error_terminal" ||
        (
          activeAttachmentImport?.operationId === operationId &&
          !activeAttachmentImport.commandSettled
        )
      ) return;
      attachmentImportAttempt.value = null;
      attachmentErrorCode.value = null;
    }

    function turnContentBlocks(input: string): readonly ChatTurnContentBlock[] | null {
      const text = input.trim();
      if (attachmentImportAttempt.value !== null) return null;
      if (draftAttachments.value.some((attachment) => attachment.status !== "ready")) return null;
      const imageBytes = draftAttachments.value
        .filter((attachment) => attachment.type === "image")
        .reduce((total, attachment) => total + attachment.sizeBytes, 0);
      if (imageBytes > 10 * 1024 * 1024) return null;
      const blocks: ChatTurnContentBlock[] = [];
      if (text.length > 0) blocks.push(Object.freeze({ type: "text", text }));
      blocks.push(...draftAttachments.value.map((attachment) => Object.freeze({
        type: attachment.type,
        attachmentId: attachment.attachmentId,
      })));
      return blocks.length > 0 ? Object.freeze(blocks) : null;
    }

    async function createSession(projectId: string, input: string): Promise<string | null> {
      const bound = context.value;
      if (
        !bound || selectedSessionId.value !== null || !canSend.value ||
        !hasAction("create_session") || !hasAction("use_project")
      ) return null;
      const blocks = turnContentBlocks(input);
      if (blocks === null) return null;
      const attemptKey = submissionKey("create", projectId, input, blocks);
      const attemptAuthorityEpoch = authorityEpoch;
      const attemptSelectionEpoch = selectionEpoch;
      const attemptDraftEpoch = draftEpoch;
      const isCurrentCreateAuthority = (): boolean => (
        authorityEpoch === attemptAuthorityEpoch &&
        context.value?.contextId === bound.contextId &&
        selectionEpoch === attemptSelectionEpoch &&
        selectedSessionId.value === null &&
        draftEpoch === attemptDraftEpoch &&
        sameDraftTarget(draftTarget.value, CHAT_NEW_DRAFT_TARGET)
      );
      const canDispatchCreateAttempt = (): boolean => (
        isCurrentCreateAuthority() &&
        canSend.value &&
        hasAction("create_session") &&
        hasAction("use_project")
      );
      let project: ChatProject | null;
      try {
        project = await revalidateProject(projectId);
      } catch (error: unknown) {
        if (!canDispatchCreateAttempt()) return null;
        throw error;
      }
      if (project === null || !canDispatchCreateAttempt()) return null;
      if (project.projectId !== projectId || !project.available) throw projectInvalidError();
      const currentBlocks = turnContentBlocks(input);
      if (
        currentBlocks === null ||
        submissionKey("create", projectId, input, currentBlocks) !== attemptKey
      ) return null;
      const attemptOperationId = submissionOperation(attemptKey);
      const created = streamingV4Enabled || draftAttachments.value.length > 0
        ? await client.createSessionV2(bound.contextId, projectId, currentBlocks, attemptOperationId)
        : await client.createSession(bound.contextId, projectId, input, attemptOperationId);
      const settledBlocks = turnContentBlocks(input);
      if (
        !isCurrentCreateAuthority() ||
        settledBlocks === null ||
        submissionKey("create", projectId, input, settledBlocks) !== attemptKey
      ) return null;
      if (created.operationId !== attemptOperationId) {
        throw new ChatClientError({
          schemaVersion: 2,
          code: "chat_protocol_error",
          retryable: false,
          recovery: "resync",
        });
      }
      dropDraftReferences();
      try {
        await reloadSessions();
      } catch (error: unknown) {
        if (context.value?.contextId === bound.contextId) {
          lastErrorCode.value = error instanceof ChatClientError
            ? error.shape.code
            : "chat_protocol_error";
        }
      }
      if (
        authorityEpoch !== attemptAuthorityEpoch ||
        context.value?.contextId !== bound.contextId ||
        selectionEpoch !== attemptSelectionEpoch ||
        selectedSessionId.value !== null
      ) return null;
      await selectSession(created.sessionId);
      if (
        authorityEpoch !== attemptAuthorityEpoch ||
        context.value?.contextId !== bound.contextId ||
        selectedSessionId.value !== created.sessionId
      ) return null;
      return created.sessionId;
    }

    async function submitTurn(input: string): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !canSend.value || !hasAction("submit_turn")) return;
      const blocks = turnContentBlocks(input);
      if (blocks === null) return;
      const attemptKey = submissionKey("submit", sessionId, input, blocks);
      const attemptAuthorityEpoch = authorityEpoch;
      const attemptSelectionEpoch = selectionEpoch;
      const attemptDraftEpoch = draftEpoch;
      const attemptTarget = chatSessionDraftTarget(sessionId);
      const isCurrentSubmitAuthority = (): boolean => (
        authorityEpoch === attemptAuthorityEpoch &&
        context.value?.contextId === bound.contextId &&
        selectionEpoch === attemptSelectionEpoch &&
        selectedSessionId.value === sessionId &&
        draftEpoch === attemptDraftEpoch &&
        sameDraftTarget(draftTarget.value, attemptTarget)
      );
      const attemptOperationId = submissionOperation(attemptKey);
      let created;
      if (streamingV4Enabled || draftAttachments.value.length > 0) {
        created = await client.submitTurnV2(bound.contextId, sessionId, blocks, attemptOperationId);
      } else {
        created = await client.submitTurn(bound.contextId, sessionId, input, attemptOperationId);
      }
      const settledBlocks = turnContentBlocks(input);
      if (
        !isCurrentSubmitAuthority() ||
        settledBlocks === null ||
        submissionKey("submit", sessionId, input, settledBlocks) !== attemptKey
      ) return;
      if (created.operationId !== attemptOperationId) {
        throw new ChatClientError({
          schemaVersion: 2,
          code: "chat_protocol_error",
          retryable: false,
          recovery: "resync",
        });
      }
      dropDraftReferences();
      await resyncSelected();
    }

    async function reloadSessions(): Promise<void> {
      const bound = context.value;
      if (!bound) return;
      const page = await client.listSessions(bound.contextId);
      if (context.value?.contextId !== bound.contextId) return;
      sessions.value = page.sessions;
      sessionsCursor.value = page.nextCursor;
    }

    async function loadMoreSessions(): Promise<void> {
      const bound = context.value;
      const cursor = sessionsCursor.value;
      if (!bound || !cursor) return;
      const page = await client.listSessions(bound.contextId, cursor, 20);
      if (context.value?.contextId !== bound.contextId || sessionsCursor.value !== cursor) return;
      const known = new Set(sessions.value.map((session) => session.sessionId));
      sessions.value = Object.freeze([
        ...sessions.value,
        ...page.sessions.filter((session) => !known.has(session.sessionId)),
      ]);
      sessionsCursor.value = page.nextCursor;
    }

    async function refreshLocalReadiness(): Promise<ChatLocalReadiness | null> {
      const bound = context.value;
      if (!bound) return null;
      const projection = await client.getLocalReadiness(bound.contextId);
      if (context.value?.contextId !== bound.contextId) return null;
      localReadiness.value = projection;
      return projection;
    }

    async function requestLocalRecovery(): Promise<ChatLocalReadiness | null> {
      const bound = context.value;
      if (!bound) return null;
      const projection = await client.requestLocalRecovery(bound.contextId, operationId());
      if (context.value?.contextId !== bound.contextId) return null;
      localReadiness.value = projection;
      return projection;
    }

    async function renameSelected(title: string): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !hasAction("rename_session")) return;
      await client.renameSession(bound.contextId, sessionId, title, operationId());
      if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== sessionId) return;
      await reloadSessions();
    }

    async function setSelectedPinned(pinned: boolean): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !hasAction("pin_session")) return;
      await client.setSessionPinned(bound.contextId, sessionId, pinned, operationId());
      if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== sessionId) return;
      await reloadSessions();
    }

    async function interruptSelected(): Promise<boolean> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !hasAction("interrupt_turn")) return false;
      await client.interruptTurn(bound.contextId, sessionId, operationId());
      return context.value?.contextId === bound.contextId && selectedSessionId.value === sessionId;
    }

    function cleanupIsComplete(status: ChatCleanupStatus): boolean {
      return status.desktopState === "complete" && status.hostState === "complete" && status.runtimeState === "complete";
    }

    function scheduleSelectedCleanupPoll(
      bound: BoundChatContext,
      sessionId: string,
      cleanupOperationId: string,
    ): void {
      clearCleanupPoll();
      const pollEpoch = cleanupPollEpoch;
      let attempts = 0;
      const poll = async (): Promise<void> => {
        cleanupPollTimer = null;
        if (
          cleanupPollEpoch !== pollEpoch ||
          context.value?.contextId !== bound.contextId ||
          selectedSessionId.value !== sessionId ||
          cleanupStatus.value?.operationId !== cleanupOperationId
        ) return;
        try {
          const status = await client.getCleanupStatus(bound.contextId, cleanupOperationId);
          if (
            cleanupPollEpoch !== pollEpoch ||
            context.value?.contextId !== bound.contextId ||
            selectedSessionId.value !== sessionId
          ) return;
          if (status !== null) {
            cleanupStatus.value = status;
            if (cleanupIsComplete(status)) {
              clearCleanupPoll();
              await finishCompletedCleanup(bound, sessionId, status);
              return;
            }
            if (status.outcomeCode === "retry_limit_exceeded") {
              clearCleanupPoll();
              return;
            }
          }
        } catch {
          // A manual status check remains available; keep polling while this selection is current.
        }
        attempts += 1;
        if (attempts >= CLEANUP_POLL_MAX_ATTEMPTS || cleanupPollEpoch !== pollEpoch) {
          clearCleanupPoll();
          return;
        }
        cleanupPollTimer = setTimeout(() => { void poll(); }, CLEANUP_POLL_INTERVAL_MS);
      };
      cleanupPollTimer = setTimeout(() => { void poll(); }, CLEANUP_POLL_INTERVAL_MS);
    }

    async function finishCompletedCleanup(
      bound: BoundChatContext,
      deletedSessionId: string,
      status: ChatCleanupStatus,
    ): Promise<DeleteDisposition | null> {
      if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== deletedSessionId) {
        return null;
      }
      const oldSubscription = subscriptionId;
      if (oldSubscription) {
        await client.unsubscribeSession(bound.contextId, oldSubscription).catch(() => false);
      }
      if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== deletedSessionId) {
        return null;
      }
      clearSelection();
      const cleanupSelectionEpoch = selectionEpoch;
      const [nextProjects, nextSessions] = await Promise.all([
        client.listProjects(bound.contextId),
        client.listSessions(bound.contextId),
      ]);
      if (
        context.value?.contextId !== bound.contextId ||
        selectionEpoch !== cleanupSelectionEpoch ||
        selectedSessionId.value !== null
      ) return null;
      projects.value = nextProjects;
      sessions.value = Object.freeze(nextSessions.sessions.filter((session) => session.sessionId !== deletedSessionId));
      sessionsCursor.value = nextSessions.nextCursor;
      cleanupStatus.value = status;
      const nextSessionId = sessions.value[0]?.sessionId ?? null;
      const disposition: DeleteDisposition = Object.freeze({
        kind: "navigate",
        deletedSessionId,
        nextSessionId,
        path: nextSessionId === null ? "/chat" : `/chat/${nextSessionId}`,
      });
      deleteDisposition.value = disposition;
      return disposition;
    }

    async function deleteSelected(): Promise<DeleteDisposition | null> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !hasAction("delete_session")) return null;
      const status = await client.deleteSession(bound.contextId, sessionId, operationId());
      if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== sessionId) return null;
      cleanupStatus.value = status;
      if (cleanupIsComplete(status)) return finishCompletedCleanup(bound, sessionId, status);
      scheduleSelectedCleanupPoll(bound, sessionId, status.operationId);
      const disposition: DeleteDisposition = Object.freeze({
        kind: "cleanup_pending",
        deletedSessionId: sessionId,
        nextSessionId: null,
        path: `/chat/${sessionId}`,
      });
      deleteDisposition.value = disposition;
      return disposition;
    }

    async function refreshSelectedCleanup(): Promise<DeleteDisposition | null> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      const operation = cleanupStatus.value?.operationId;
      if (!bound || !sessionId || !operation) return null;
      const status = await client.getCleanupStatus(bound.contextId, operation);
      if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== sessionId || status === null) {
        return null;
      }
      cleanupStatus.value = status;
      if (cleanupIsComplete(status)) return finishCompletedCleanup(bound, sessionId, status);
      if (status.outcomeCode !== "retry_limit_exceeded") {
        scheduleSelectedCleanupPoll(bound, sessionId, status.operationId);
      }
      return deleteDisposition.value;
    }

    async function pickProject(): Promise<ChatProject | null> {
      const bound = context.value;
      if (!bound || !hasAction("use_project")) return null;
      const selected = await client.pickProject(bound.contextId, operationId());
      if (context.value?.contextId !== bound.contextId) return null;
      const nextProjects = await client.listProjects(bound.contextId);
      if (context.value?.contextId !== bound.contextId) return null;
      projects.value = nextProjects;
      return selected;
    }

    async function revalidateProject(projectId: string): Promise<ChatProject | null> {
      const bound = context.value;
      if (!bound || !hasAction("use_project")) return null;
      const project = await client.revalidateProject(bound.contextId, projectId, operationId());
      if (context.value?.contextId !== bound.contextId) return null;
      projects.value = Object.freeze(projects.value.map((entry) => entry.projectId === project.projectId ? project : entry));
      return project;
    }

    async function setProjectPinned(projectId: string, pinned: boolean): Promise<void> {
      const bound = context.value;
      if (!bound || !hasAction("pin_project")) return;
      await client.setProjectPinned(bound.contextId, projectId, pinned, operationId());
      if (context.value?.contextId !== bound.contextId) return;
      const nextProjects = await client.listProjects(bound.contextId);
      if (context.value?.contextId !== bound.contextId) return;
      projects.value = nextProjects;
    }

    async function removeProject(projectId: string): Promise<void> {
      const bound = context.value;
      if (!bound || !hasAction("remove_project")) return;
      await client.removeProject(bound.contextId, projectId, operationId());
      if (context.value?.contextId !== bound.contextId) return;
      const [nextProjects, nextSessions] = await Promise.all([
        client.listProjects(bound.contextId),
        client.listSessions(bound.contextId),
      ]);
      if (context.value?.contextId !== bound.contextId) return;
      projects.value = nextProjects;
      sessions.value = nextSessions.sessions;
      sessionsCursor.value = nextSessions.nextCursor;
    }

    function clearForLogout(): void {
      clearAuthority("signed-out");
    }

    async function deactivatePageSession(): Promise<void> {
      await clearSelectedSession();
      releaseSessionListeners();
    }

    async function dispose(): Promise<void> {
      const pendingResync = resyncPromise;
      clearAuthority("idle");
      listenerEpoch += 1;
      releaseSessionListeners();
      controlPlaneUnlisten?.();
      controlPlaneUnlisten = null;
      attachmentImportUnlisten?.();
      attachmentImportUnlisten = null;
      await pendingResync?.catch(() => undefined);
      releaseSessionListeners();
    }

    return {
      phase,
      context,
      projects,
      sessions,
      sessionsCursor,
      selectedSessionId,
      history,
      conversationState,
      liveAssistantText,
      liveReasoning,
      liveTurnStatus,
      cleanupStatus,
      controlPlane,
      localReadiness,
      draftTarget,
      draftTargetReady,
      draftAttachments,
      attachmentImportAttempt,
      attachmentImporting,
      attachmentErrorCode,
      deleteDisposition,
      lastErrorCode,
      lastBindFailureStage,
      isReady,
      canSend,
      canAttach,
      draftAttachmentsReady,
      hasAction,
      bind,
      selectSession,
      clearSelectedSession,
      retryDraftRecovery,
      resyncSelected,
      loadOlderHistory,
      loadHistoryPage,
      loadReasoning,
      pickAttachments,
      importAttachmentPaths,
      removeDraftAttachment,
      dismissAttachmentImportAttempt,
      discardDraftAttachments,
      createSession,
      submitTurn,
      reloadSessions,
      loadMoreSessions,
      refreshLocalReadiness,
      requestLocalRecovery,
      renameSelected,
      setSelectedPinned,
      interruptSelected,
      deleteSelected,
      refreshSelectedCleanup,
      refreshControlPlane,
      pickProject,
      revalidateProject,
      setProjectPinned,
      removeProject,
      clearForLogout,
      deactivatePageSession,
      dispose,
    };
  });
}

export const useChatStore = createChatStoreDefinition(chatClient, STORE_ID, () => {
  const permissionStore = usePermissionStore();
  return {
    liveClient: chatArtifactLiveClient,
    store: useArtifactStore(),
    authority: () => {
      if (
        !permissionStore.isReady ||
        permissionStore.selectedTenantId === null ||
        permissionStore.authorizationRevision === null
      ) return null;
      return Object.freeze({
        authorizationRevision: permissionStore.authorizationRevision,
        tenantId: permissionStore.selectedTenantId,
      });
    },
  };
});
