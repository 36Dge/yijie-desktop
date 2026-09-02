import { computed, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  chatClient,
  type ChatClient,
  type ChatInvalidEventScope,
} from "../api/chat-client";
import { feat134StreamingUiEnabled } from "../authorization/feat134-streaming-ui-config";
import { feat136ExecutionUiEnabled } from "../authorization/feat136-execution-ui-config";
import { feat137ApprovalUiEnabled } from "../authorization/feat137-approval-ui-config";
import {
  conversationMessageItemId,
  conversationReasoningItemOrdinal,
  historyPageToConversationSnapshot,
  historyPageV5ToConversationSnapshot,
  projectionEventToConversation,
} from "../api/chat-conversation-adapter";
import {
  approvalDecisionResultV6ToDomain,
  createApprovalDecisionIntentV6,
  historyPageV6ToApprovalEvents,
  historyPageV6ToConversationSnapshot,
  projectionEventV6ToDomain,
} from "../api/chat-approval-adapter";
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
  ChatApprovalErrorCodeV6,
  ChatApprovalDecisionV6,
  ChatCleanupStatus,
  ChatControlPlaneEvent,
  ChatDraftTarget,
  ChatHistoryPage,
  ChatHistoryTurn,
  ChatHistoryTurnV4,
  ChatHistoryPageV4,
  ChatHistoryPageV5,
  ChatHistoryPageV6,
  ChatLocalReadiness,
  ChatMessageContentBlock,
  ChatProjectionEvent,
  ChatProjectionEventV4,
  ChatProjectionEventV5,
  ChatProjectionEventV6,
  ChatProject,
  ChatReasoningItem,
  ChatResyncProjection,
  ChatResyncProjectionV4,
  ChatResyncProjectionV5,
  ChatResyncProjectionV6,
  ChatPendingApprovalSnapshotV6,
  ChatSession,
  ChatSessionControlPlane,
  ChatTurnContentBlock,
} from "../domain/chat-ipc";
import {
  createConversationApprovalState,
  disconnectConversationApprovals,
  reconcileConversationApprovalSnapshot,
  reduceConversationApprovalEvent,
  requireConversationApprovalReconciliation,
  revokeExpiredConversationApprovalAuthority,
  type ConversationApprovalState,
} from "../domain/conversation-approval";
import { parseStrictRfc3339EpochNanoseconds } from "../domain/rfc3339";
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
import type { ChatComposerSubmissionState } from "../domain/chat-composer";
import { CHAT_INPUT_MAX_BYTES } from "../domain/chat-ui";
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
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const CLEANUP_POLL_INTERVAL_MS = 1_000;
const CLEANUP_POLL_MAX_ATTEMPTS = 120;
const CHAT_TERMINAL_TURN_STATUSES = new Set(["completed", "failed", "interrupted"]);
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
  | "binding-pending"
  | "resync-required"
  | "permission-denied"
  | "signed-out"
  | "unavailable";

export type ChatSelectedAccessMode = "live" | "history-only";

export type ChatSubmissionResult =
  | Readonly<{ status: "not_accepted" }>
  | Readonly<{
      status: "local_durable_accepted";
      draftTarget: ChatDraftTarget;
      sessionId: string;
      turnId: string;
      operationId: string;
    }>;

const CHAT_SUBMISSION_NOT_ACCEPTED: ChatSubmissionResult = Object.freeze({
  status: "not_accepted",
});

export type ChatApprovalTransientError = ChatApprovalErrorCodeV6 | "unknown";

export interface ChatApprovalTransientState {
  readonly phase: "idle" | "submitting" | "reconciling" | "error";
  readonly errorCode: ChatApprovalTransientError | null;
}

export interface ChatApprovalDecisionInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly approvalRequestId: string;
  readonly decision: ChatApprovalDecisionV6;
}

export type ChatApprovalDecisionDisposition =
  | "accepted"
  | "reconciling"
  | "ignored";

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
type ChatHistoryAuthority =
  ChatHistoryPage | ChatHistoryPageV4 | ChatHistoryPageV5 | ChatHistoryPageV6;
type ChatProjectionAuthorityEvent =
  ChatProjectionEvent | ChatProjectionEventV4 | ChatProjectionEventV5 | ChatProjectionEventV6;
type ChatApprovalChangedEventV6 = Extract<ChatProjectionEventV6, { kind: "approval_changed" }>;
type ChatResyncAuthority =
  ChatResyncProjection | ChatResyncProjectionV4 | ChatResyncProjectionV5 | ChatResyncProjectionV6;

type ChatSubscriptionAuthority = Readonly<{
  subscriptionId: string;
  pendingApprovalSnapshot: ChatPendingApprovalSnapshotV6 | null;
}>;

type ControlPlaneRefreshResult =
  | Readonly<{ kind: "applied"; status: ChatSessionControlPlane }>
  | Readonly<{ kind: "superseded" }>
  | Readonly<{ kind: "selection_changed" }>
  | Readonly<{ kind: "unavailable" }>;

type ChatSelectionActivationStage =
  | "control-plane"
  | "subscription"
  | "resync"
  | "projection";

type ChatHistoryOnlyHydrationResult = "applied" | "unavailable" | "superseded";

type CleanupObservationToken = Readonly<{
  generation: number;
  sequence: number;
}>;

type ChatHistoryOnlySelectionSnapshot = Readonly<{
  sessionId: string;
  history: ChatHistoryAuthority;
  conversation: ConversationState;
  approvals: ConversationApprovalState;
  approvalTransients: Readonly<Record<string, ChatApprovalTransientState | undefined>>;
  liveAssistantText: string;
  liveReasoning: readonly LiveReasoningPart[];
  liveTurnStatus: string | null;
  latestTurnStatus: ChatSession["latestTurnStatus"];
  phase: ChatViewPhase;
  lastErrorCode: string | null;
}>;

function isHistoryV4(history: ChatHistoryAuthority): history is ChatHistoryPageV4 {
  return "sessionNotices" in history && !("schemaVersion" in history);
}

function isHistoryV5(history: ChatHistoryAuthority): history is ChatHistoryPageV5 {
  return "sessionNotices" in history && "schemaVersion" in history &&
    history.schemaVersion === 5;
}

function isHistoryV6(history: ChatHistoryAuthority): history is ChatHistoryPageV6 {
  return "sessionNotices" in history && "schemaVersion" in history &&
    history.schemaVersion === 6;
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
  executionV5Enabled = feat136ExecutionUiEnabled,
  approvalV6Enabled = feat137ApprovalUiEnabled,
) {
  const streamingV5Enabled = streamingV4Enabled && executionV5Enabled;
  const streamingV6Enabled = streamingV5Enabled && approvalV6Enabled;
  return defineStore(storeId, () => {
    const artifactIntegration = artifactIntegrationFactory?.() ?? null;
    const phase = ref<ChatViewPhase>("idle");
    const context = shallowRef<BoundChatContext | null>(null);
    const projects = shallowRef<readonly ChatProject[]>(Object.freeze([]));
    const sessions = shallowRef<readonly ChatSession[]>(Object.freeze([]));
    const sessionsCursor = ref<string | null>(null);
    const selectedSessionId = ref<string | null>(null);
    const selectedAccessMode = ref<ChatSelectedAccessMode | null>(null);
    const history = shallowRef<ChatHistoryAuthority | null>(null);
    const conversationState = shallowRef<ConversationState>(createConversationState());
    const conversationApprovalState = shallowRef<ConversationApprovalState>(
      createConversationApprovalState(),
    );
    const approvalTransients = shallowRef<Readonly<
      Record<string, ChatApprovalTransientState | undefined>
    >>(Object.freeze({}));
    const approvalAuthorityRevision = ref(0);
    const liveAssistantText = ref("");
    const liveReasoning = shallowRef<readonly LiveReasoningPart[]>(Object.freeze([]));
    const liveTurnStatus = ref<string | null>(null);
    const cleanupStatus = shallowRef<ChatCleanupStatus | null>(null);
    const deleteInFlightSessionId = ref<string | null>(null);
    const controlPlane = shallowRef<ChatSessionControlPlane | null>(null);
    const localReadiness = shallowRef<ChatLocalReadiness | null>(null);
    const draftTarget = shallowRef<ChatDraftTarget | null>(null);
    const draftTargetReady = ref(false);
    const draftAttachments = shallowRef<readonly ChatAttachment[]>(Object.freeze([]));
    const attachmentImportAttempt = shallowRef<ChatAttachmentImportEvent | null>(null);
    const attachmentImporting = ref(false);
    const attachmentErrorCode = ref<string | null>(null);
    const submissionState = ref<ChatComposerSubmissionState>("idle");
    const deleteDisposition = shallowRef<DeleteDisposition | null>(null);
    const lastErrorCode = ref<string | null>(null);
    const lastBindFailureStage = ref<ChatBindFailureStage | null>(null);
    const isReady = computed(() => phase.value === "ready" || phase.value === "streaming");
    const hasSendPermission = computed(() => selectedSessionId.value === null
      ? hasAction("create_session") && hasAction("use_project")
      : hasAction("submit_turn"));
    const canSend = computed(() =>
      phase.value === "ready" &&
      draftTargetReady.value &&
      hasSendPermission.value &&
      localReadiness.value?.canSend === true &&
      (selectedSessionId.value === null || (
        deleteInFlightSessionId.value === null && cleanupStatus.value === null &&
        selectedAccessMode.value === "live" &&
        (
          controlPlane.value?.state === "bound" ||
          (!streamingV6Enabled && controlPlane.value === null)
        )
      )),
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
    const canDecideApprovals = computed(() =>
      streamingV6Enabled && context.value !== null &&
      selectedSessionId.value !== null && subscriptionId !== null &&
      selectedAccessMode.value === "live" && controlPlane.value?.state === "bound" &&
      deleteInFlightSessionId.value === null && cleanupStatus.value === null &&
      hasAction("submit_turn") &&
      conversationApprovalState.value.reconciliation === "synchronized" &&
      (phase.value === "ready" || phase.value === "streaming"),
    );

    let selectionEpoch = 0;
    let selectionIntentEpoch = 0;
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
    let approvalExpiryTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupPollTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupPollEpoch = 0;
    let cleanupObservationGeneration = 0;
    let cleanupObservationSequence = 0;
    let cleanupCommittedObservationSequence = 0;
    let resyncPromise: Promise<void> | null = null;
    let resyncTrailingRequested = false;
    let bindingPendingSessionId: string | null = null;
    let bindingActivationPromise: Promise<void> | null = null;
    let bindingActivationTrailingSessionId: string | null = null;
    let controlPlaneGapRecoveryPromise: Promise<void> | null = null;
    let controlPlaneGapRecoveryTrailingRequested = false;
    let controlPlaneObservationEpoch = 0;
    let controlPlaneGapEpoch = 0;
    let controlPlaneTrustedGapEpoch = 0;
    let controlPlaneRead: {
      readonly token: symbol;
      readonly sessionId: string;
      terminalCandidate: ChatSessionControlPlane | null;
    } | null = null;
    let terminalHistoryCandidate: ChatSessionControlPlane | null = null;
    let artifactRefreshPromise: Promise<void> | null = null;
    let artifactRefreshTrailingRequested = false;
    let draftEpoch = 0;
    let activeAttachmentImport: ActiveAttachmentImport | null = null;
    let pendingSubmission: Readonly<{ key: string; operationId: string }> | null = null;
    let activeSubmissionToken: symbol | null = null;
    let bufferingEvents = false;
    let bufferedEvents: ChatProjectionAuthorityEvent[] = [];
    let bufferedEventBytes = 0;
    let bufferedEventsOverflowed = false;
    let bufferingArtifactEvents = false;
    let bufferedArtifactEvents: ChatArtifactLiveEvent[] = [];
    let bufferedArtifactEventsOverflowed = false;
    const activeApprovalDecisionAttempts = new Map<string, symbol>();
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

    function beginSubmission(): symbol | null {
      if (submissionState.value !== "idle") return null;
      const token = Symbol("chat-submission");
      activeSubmissionToken = token;
      submissionState.value = "validating";
      return token;
    }

    function markSubmissionDispatching(token: symbol): boolean {
      if (activeSubmissionToken !== token) return false;
      submissionState.value = "submitting";
      return true;
    }

    function finishSubmission(token: symbol): void {
      if (activeSubmissionToken !== token) return;
      activeSubmissionToken = null;
      submissionState.value = "idle";
    }

    function resetSubmissionState(): void {
      activeSubmissionToken = null;
      submissionState.value = "idle";
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

    function clearApprovalExpiryTimer(): void {
      if (approvalExpiryTimer !== null) {
        clearTimeout(approvalExpiryTimer);
        approvalExpiryTimer = null;
      }
    }

    function setApprovalTransient(
      approvalRequestId: string,
      transient: ChatApprovalTransientState | null,
    ): void {
      if (transient === null) {
        if (approvalTransients.value[approvalRequestId] === undefined) return;
        const next = { ...approvalTransients.value };
        delete next[approvalRequestId];
        approvalTransients.value = Object.freeze(next);
        return;
      }
      approvalTransients.value = Object.freeze({
        ...approvalTransients.value,
        [approvalRequestId]: Object.freeze({ ...transient }),
      });
    }

    function markApprovalTransientsReconciling(): void {
      const entries = Object.entries(approvalTransients.value);
      if (entries.length === 0) return;
      approvalTransients.value = Object.freeze(Object.fromEntries(
        entries.map(([approvalRequestId, transient]) => [
          approvalRequestId,
          transient === undefined
            ? undefined
            : Object.freeze({
                phase: "reconciling" as const,
                errorCode: transient.errorCode,
              }),
        ]),
      ));
    }

    function settleApprovalTransientsAfterResync(): void {
      const retained = Object.fromEntries(Object.entries(approvalTransients.value)
        .filter(([approvalRequestId]) =>
          activeApprovalDecisionAttempts.has(approvalRequestId)));
      approvalTransients.value = Object.freeze(retained);
    }

    function failApprovalTransientsAfterResync(): void {
      const entries = Object.entries(approvalTransients.value);
      if (entries.length === 0) return;
      approvalTransients.value = Object.freeze(Object.fromEntries(
        entries.map(([approvalRequestId, transient]) => [
          approvalRequestId,
          transient === undefined || transient.phase !== "reconciling"
            ? transient
            : Object.freeze({
                phase: "error" as const,
                errorCode: transient.errorCode ?? "unknown" as const,
              }),
        ]),
      ));
    }

    function clearCleanupPoll(): void {
      cleanupPollEpoch += 1;
      if (cleanupPollTimer !== null) {
        clearTimeout(cleanupPollTimer);
        cleanupPollTimer = null;
      }
    }

    function invalidateCleanupObservations(): void {
      cleanupObservationGeneration += 1;
      cleanupCommittedObservationSequence = 0;
    }

    function startCleanupObservation(): CleanupObservationToken {
      cleanupObservationSequence += 1;
      return Object.freeze({
        generation: cleanupObservationGeneration,
        sequence: cleanupObservationSequence,
      });
    }

    function clearSelection(): void {
      selectionIntentEpoch += 1;
      selectionEpoch += 1;
      clearCleanupPoll();
      invalidateCleanupObservations();
      clearApprovalExpiryTimer();
      activeRead?.abort();
      activeRead = null;
      selectedSessionId.value = null;
      selectedAccessMode.value = null;
      history.value = null;
      conversationState.value = createConversationState();
      conversationApprovalState.value = createConversationApprovalState();
      approvalTransients.value = Object.freeze({});
      activeApprovalDecisionAttempts.clear();
      liveAssistantText.value = "";
      liveReasoning.value = Object.freeze([]);
      liveTurnStatus.value = null;
      cleanupStatus.value = null;
      deleteInFlightSessionId.value = null;
      controlPlane.value = null;
      if (!streamingV6Enabled) controlPlaneSequence = null;
      deleteDisposition.value = null;
      subscriptionId = null;
      bindingPendingSessionId = null;
      bindingActivationPromise = null;
      bindingActivationTrailingSessionId = null;
      controlPlaneGapRecoveryPromise = null;
      controlPlaneGapRecoveryTrailingRequested = false;
      controlPlaneRead = null;
      terminalHistoryCandidate = null;
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

    function revokeSelectedSessionAuthority(
      nextPhase: ChatViewPhase,
      retainedBindingSessionId: string | null = null,
    ): void {
      const revokedContextId = context.value?.contextId;
      const revokedSubscriptionId = subscriptionId;
      selectionEpoch += 1;
      activeRead?.abort();
      activeRead = null;
      selectedAccessMode.value = null;
      subscriptionId = null;
      releaseSessionListeners();
      clearApprovalExpiryTimer();
      activeApprovalDecisionAttempts.clear();
      approvalTransients.value = Object.freeze({});
      approvalAuthorityRevision.value += 1;
      conversationApprovalState.value = requireConversationApprovalReconciliation(
        conversationApprovalState.value,
      );
      bufferingEvents = false;
      bufferingArtifactEvents = false;
      resetProjectionBuffer();
      bufferedArtifactEvents = [];
      resyncPromise = null;
      resyncTrailingRequested = false;
      bindingPendingSessionId = retainedBindingSessionId;
      phase.value = nextPhase;
      if (revokedContextId && revokedSubscriptionId) {
        void client.unsubscribeSession(revokedContextId, revokedSubscriptionId)
          .catch(() => false);
      }
    }

    function revokeSelectedRealtimeAuthorityForCleanup(
      bound: BoundChatContext,
      sessionId: string,
    ): void {
      if (
        context.value?.contextId !== bound.contextId ||
        selectedSessionId.value !== sessionId
      ) return;
      const revokedSubscriptionId = subscriptionId;
      selectionEpoch += 1;
      activeRead?.abort();
      activeRead = null;
      subscriptionId = null;
      bindingPendingSessionId = null;
      bindingActivationTrailingSessionId = null;
      releaseSessionListeners();
      clearApprovalExpiryTimer();
      activeApprovalDecisionAttempts.clear();
      approvalTransients.value = Object.freeze({});
      approvalAuthorityRevision.value += 1;
      bufferingEvents = false;
      bufferingArtifactEvents = false;
      resetProjectionBuffer();
      bufferedArtifactEvents = [];
      resyncTrailingRequested = false;
      artifactRefreshTrailingRequested = false;
      if (phase.value === "resyncing") phase.value = "ready";
      if (revokedSubscriptionId !== null) {
        void client.unsubscribeSession(bound.contextId, revokedSubscriptionId)
          .catch(() => false);
      }
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
      resetSubmissionState();
      const oldContext = context.value?.contextId;
      const oldSubscription = subscriptionId;
      clearSelection();
      controlPlaneSequence = null;
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
      const pending = (streamingV6Enabled
        ? client.onEventV6((event) => handleEvent(event), handleInvalidEvent)
        : streamingV5Enabled
          ? client.onEventV5((event) => handleEvent(event), handleInvalidEvent)
        : streamingV4Enabled
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
      if (streamingV6Enabled) {
        conversationApprovalState.value = disconnectConversationApprovals(
          conversationApprovalState.value,
        );
      }
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
      const pending = client.onControlPlaneEvent(
        handleControlPlaneEvent,
        requestControlPlaneResync,
        streamingV6Enabled,
      )
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

    function applyControlPlaneStatus(
      status: ChatSessionControlPlane,
      activateFromLiveBound = false,
    ): void {
      if (status.sessionId !== selectedSessionId.value) return;
      controlPlane.value = status;
      const historyOnly = selectedAccessMode.value === "history-only";
      if (!historyOnly) {
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
      if (
        streamingV6Enabled && historyOnly && activateFromLiveBound &&
        status.state === "bound" && subscriptionId === null && cleanupStatus.value === null &&
        deleteInFlightSessionId.value === null
      ) bindingPendingSessionId = status.sessionId;
      const hasV6AuthorityToReconcile = streamingV6Enabled &&
        (bindingPendingSessionId === status.sessionId || subscriptionId !== null);
      if (hasV6AuthorityToReconcile && status.state !== "bound") {
        revokeForControlPlaneStatus(status);
      }
      if (
        streamingV6Enabled &&
        activateFromLiveBound &&
        status.state === "bound" &&
        bindingPendingSessionId === status.sessionId &&
        subscriptionId === null
      ) {
        requestBindingActivation(status.sessionId, true);
      }
    }

    function revokeForControlPlaneStatus(status: ChatSessionControlPlane): void {
      switch (status.state) {
        case "pending":
        case "binding_pending":
          revokeSelectedSessionAuthority("binding-pending", status.sessionId);
          break;
        case "retry_wait":
          revokeSelectedSessionAuthority("unavailable", status.sessionId);
          break;
        case "blocked_auth":
          revokeSelectedSessionAuthority("signed-out");
          break;
        case "denied":
          revokeSelectedSessionAuthority("permission-denied");
          break;
        case "failed":
          revokeSelectedSessionAuthority("resync-required");
          break;
        case "bound":
          break;
      }
    }

    function captureHistoryOnlySelection(
      sessionId: string,
    ): ChatHistoryOnlySelectionSnapshot | null {
      if (
        selectedSessionId.value !== sessionId ||
        selectedAccessMode.value !== "history-only" ||
        history.value === null
      ) return null;
      return Object.freeze({
        sessionId,
        history: history.value,
        conversation: conversationState.value,
        approvals: conversationApprovalState.value,
        approvalTransients: approvalTransients.value,
        liveAssistantText: liveAssistantText.value,
        liveReasoning: liveReasoning.value,
        liveTurnStatus: liveTurnStatus.value,
        latestTurnStatus: sessions.value.find((session) => session.sessionId === sessionId)
          ?.latestTurnStatus ?? null,
        phase: phase.value === "resyncing" ? "ready" : phase.value,
        lastErrorCode: lastErrorCode.value,
      });
    }

    function restoreHistoryOnlySelection(
      snapshot: ChatHistoryOnlySelectionSnapshot,
      expectedSelectionIntentEpoch: number,
      preserveBindingPending: boolean,
    ): void {
      if (
        context.value === null ||
        selectionIntentEpoch !== expectedSelectionIntentEpoch ||
        selectedSessionId.value !== snapshot.sessionId ||
        selectedAccessMode.value !== null
      ) return;
      const failedPhase = phase.value;
      const failedErrorCode = lastErrorCode.value;
      const danglingSubscription = subscriptionId;
      if (danglingSubscription !== null) {
        void client.unsubscribeSession(context.value.contextId, danglingSubscription)
          .catch(() => false);
      }
      subscriptionId = null;
      if (!preserveBindingPending) bindingPendingSessionId = null;
      releaseSessionListeners();
      activeRead?.abort();
      activeRead = null;
      clearDraftTargetState();
      selectedAccessMode.value = "history-only";
      history.value = snapshot.history;
      conversationState.value = snapshot.conversation;
      conversationApprovalState.value = snapshot.approvals;
      approvalTransients.value = snapshot.approvalTransients;
      approvalAuthorityRevision.value += 1;
      liveAssistantText.value = snapshot.liveAssistantText;
      liveReasoning.value = snapshot.liveReasoning;
      liveTurnStatus.value = snapshot.liveTurnStatus;
      sessions.value = Object.freeze(sessions.value.map((session) =>
        session.sessionId === snapshot.sessionId
          ? Object.freeze({ ...session, latestTurnStatus: snapshot.latestTurnStatus })
          : session
      ));
      bufferingEvents = false;
      bufferingArtifactEvents = false;
      resetProjectionBuffer();
      bufferedArtifactEvents = [];
      resetArtifactStream();
      resyncPromise = null;
      resyncTrailingRequested = false;
      artifactRefreshPromise = null;
      artifactRefreshTrailingRequested = false;
      try {
        artifactAuthorityToken = establishArtifactAuthority(snapshot.sessionId);
        if (
          artifactIntegration !== null &&
          !artifactIntegration.store.ingestHistoryV3(artifactAuthorityToken, snapshot.history)
        ) {
          artifactIntegration.store.clearAuthority();
          artifactAuthorityToken = null;
        }
      } catch {
        artifactIntegration?.store.clearAuthority();
        artifactAuthorityToken = null;
      }
      if (
        failedPhase === "resyncing" ||
        deleteInFlightSessionId.value === snapshot.sessionId ||
        cleanupStatus.value !== null
      ) {
        phase.value = snapshot.phase;
        lastErrorCode.value = snapshot.lastErrorCode;
      } else {
        phase.value = failedPhase;
        lastErrorCode.value = failedErrorCode;
      }
    }

    function requestBindingActivation(
      sessionId: string,
      allowLiveTrailingActivation = false,
    ): void {
      if (
        !streamingV6Enabled ||
        bindingPendingSessionId !== sessionId || selectedSessionId.value !== sessionId ||
        context.value === null || controlPlane.value?.sessionId !== sessionId ||
        controlPlane.value.state !== "bound" || cleanupStatus.value !== null ||
        deleteInFlightSessionId.value !== null
      ) return;
      if (bindingActivationPromise !== null) {
        // Only a newly accepted live bound event may supersede an activation
        // already in flight. GET/resync and explicit UI recovery never turn a
        // transport failure into an automatic retry.
        if (allowLiveTrailingActivation) {
          bindingActivationTrailingSessionId = sessionId;
        }
        return;
      }
      const expectedContextId = context.value.contextId;
      const historyOnlySnapshot = captureHistoryOnlySelection(sessionId);
      const activation = selectSessionInternal(sessionId);
      const expectedSelectionIntentEpoch = selectionIntentEpoch;
      const pending = activation
        .finally(() => {
          const preserveBindingPending = bindingActivationTrailingSessionId === sessionId &&
            controlPlane.value?.sessionId === sessionId && controlPlane.value.state === "bound" &&
            deleteInFlightSessionId.value === null && cleanupStatus.value === null;
          if (historyOnlySnapshot !== null) {
            restoreHistoryOnlySelection(
              historyOnlySnapshot,
              expectedSelectionIntentEpoch,
              preserveBindingPending,
            );
          }
          if (bindingActivationPromise !== pending) return;
          bindingActivationPromise = null;
          const queuedSessionId = bindingActivationTrailingSessionId;
          bindingActivationTrailingSessionId = null;
          if (
            queuedSessionId !== null && bindingPendingSessionId === queuedSessionId &&
            context.value?.contextId === expectedContextId &&
            selectedSessionId.value === queuedSessionId &&
            controlPlane.value?.sessionId === queuedSessionId &&
            controlPlane.value.state === "bound"
          ) requestBindingActivation(queuedSessionId);
        });
      bindingActivationPromise = pending;
    }

    function handleControlPlaneEvent(event: ChatControlPlaneEvent): void {
      if (context.value === null) return;
      // FEAT-137 consumes one Host-global control-plane sequence across
      // selections. Legacy consumers retain the original selected-session
      // cursor semantics.
      if (!streamingV6Enabled && event.sessionId !== selectedSessionId.value) return;
      const sequence = BigInt(event.sequence);
      if (controlPlaneSequence !== null) {
        if (sequence <= controlPlaneSequence) return;
        if (sequence !== controlPlaneSequence + 1n) return requestControlPlaneResync(sequence);
      }
      controlPlaneSequence = sequence;
      if (event.sessionId !== selectedSessionId.value) return;
      if (
        controlPlaneRead?.sessionId === event.sessionId &&
        isTerminalHistoryControlPlaneFailure(event)
      ) {
        controlPlaneRead.terminalCandidate = event;
        return;
      }
      if (
        terminalHistoryCandidate !== null &&
        terminalHistoryCandidate.sessionId === event.sessionId &&
        terminalHistoryCandidate.state === event.state &&
        terminalHistoryCandidate.issueCode === event.issueCode &&
        terminalHistoryCandidate.retryable === event.retryable &&
        terminalHistoryCandidate.recovery === event.recovery
      ) return;
      controlPlaneObservationEpoch += 1;
      applyControlPlaneStatus(event, true);
    }

    function requestControlPlaneResync(observedSequence: bigint | null = null): void {
      if (streamingV6Enabled) {
        controlPlaneGapEpoch += 1;
        controlPlaneSequence = observedSequence;
        if (selectedAccessMode.value === "history-only") return;
        conversationApprovalState.value = requireConversationApprovalReconciliation(
          conversationApprovalState.value,
        );
        if (subscriptionId !== null) {
          requestResync();
          return;
        }
        requestBindingActivationAfterControlPlaneGap();
        return;
      }
      controlPlaneSequence = null;
      void refreshControlPlane();
    }

    function requestBindingActivationAfterControlPlaneGap(): void {
      if (controlPlaneGapRecoveryPromise !== null) {
        // A later live sequence gap is the only source allowed to queue one
        // trailing GET. GET failure/success never retries itself.
        controlPlaneGapRecoveryTrailingRequested = true;
        return;
      }
      const expectedContextId = context.value?.contextId;
      const expectedSessionId = selectedSessionId.value;
      const expectedSelectionEpoch = selectionEpoch;
      if (expectedContextId === undefined || expectedSessionId === null) return;
      const pending = (async (): Promise<void> => {
        const result = await refreshControlPlaneGuarded();
        if (
          result.kind !== "applied" || result.status.state !== "bound" ||
          selectionEpoch !== expectedSelectionEpoch ||
          context.value?.contextId !== expectedContextId ||
          selectedSessionId.value !== expectedSessionId
        ) return;
        // The sequence gap is a fresh external observation. A successful GET may
        // therefore activate exactly once; a failed GET never schedules a retry.
        requestBindingActivation(expectedSessionId);
      })().finally(() => {
        if (controlPlaneGapRecoveryPromise !== pending) return;
        controlPlaneGapRecoveryPromise = null;
        const runTrailing = controlPlaneGapRecoveryTrailingRequested;
        controlPlaneGapRecoveryTrailingRequested = false;
        if (
          runTrailing && selectionEpoch === expectedSelectionEpoch &&
          context.value?.contextId === expectedContextId &&
          selectedSessionId.value === expectedSessionId &&
          bindingPendingSessionId === expectedSessionId && subscriptionId === null
        ) requestBindingActivationAfterControlPlaneGap();
      });
      controlPlaneGapRecoveryPromise = pending;
    }

    async function refreshControlPlaneGuarded(): Promise<ControlPlaneRefreshResult> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId) return { kind: "selection_changed" };
      const expectedSelectionEpoch = selectionEpoch;
      const expectedObservationEpoch = controlPlaneObservationEpoch;
      const expectedGapEpoch = controlPlaneGapEpoch;
      try {
        const status = await client.getSessionControlPlane(
          bound.contextId,
          sessionId,
          undefined,
          streamingV6Enabled,
        );
        if (
          selectionEpoch !== expectedSelectionEpoch ||
          context.value?.contextId !== bound.contextId ||
          selectedSessionId.value !== sessionId
        ) {
          return { kind: "selection_changed" };
        }
        if (
          streamingV6Enabled &&
          (controlPlaneObservationEpoch !== expectedObservationEpoch ||
            controlPlaneGapEpoch !== expectedGapEpoch)
        ) {
          return { kind: "superseded" };
        }
        if (status.sessionId !== sessionId) {
          lastErrorCode.value = "chat_protocol_error";
          return { kind: "unavailable" };
        }
        controlPlaneTrustedGapEpoch = expectedGapEpoch;
        applyControlPlaneStatus(status);
        return { kind: "applied", status };
      } catch (error: unknown) {
        if (
          selectionEpoch !== expectedSelectionEpoch ||
          context.value?.contextId !== bound.contextId ||
          selectedSessionId.value !== sessionId
        ) {
          return { kind: "selection_changed" };
        }
        if (
          streamingV6Enabled &&
          (controlPlaneObservationEpoch !== expectedObservationEpoch ||
            controlPlaneGapEpoch !== expectedGapEpoch)
        ) {
          return { kind: "superseded" };
        }
        if (context.value?.contextId === bound.contextId && selectedSessionId.value === sessionId) {
          lastErrorCode.value = error instanceof ChatClientError
            ? error.shape.code
            : "chat_protocol_error";
        }
        return { kind: "unavailable" };
      }
    }

    async function refreshControlPlane(): Promise<ChatSessionControlPlane | null> {
      const result = await refreshControlPlaneGuarded();
      if (result.kind === "applied") return result.status;
      if (result.kind === "superseded") return controlPlane.value;
      return null;
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

    function approvalProtocolError(): ChatClientError {
      return new ChatClientError({
        schemaVersion: 6,
        code: "chat_protocol_error",
        retryable: false,
        recovery: "resync",
      });
    }

    function selectionActivationCancelledError(): ChatClientError {
      return new ChatClientError({
        schemaVersion: 1,
        code: "chat_request_cancelled",
        retryable: false,
        recovery: "none",
      });
    }

    function assertSelectionActivationAllowed(sessionId: string): void {
      if (
        deleteInFlightSessionId.value === sessionId ||
        cleanupStatus.value !== null
      ) throw selectionActivationCancelledError();
    }

    function reduceApprovalHistory(
      state: ConversationApprovalState,
      threadId: string,
      streamId: string,
      page: ChatHistoryPageV6,
    ): ConversationApprovalState {
      return historyPageV6ToApprovalEvents(threadId, streamId, page)
        .reduce(reduceConversationApprovalEvent, state);
    }

    function reconcileApprovalAuthority(
      state: ConversationApprovalState,
      snapshot: ChatPendingApprovalSnapshotV6,
      threadId: string,
      streamId: string,
      conversation: ConversationState,
    ): ConversationApprovalState {
      return reconcileConversationApprovalSnapshot(state, snapshot, {
        nowEpochMs: Date.now(),
        expectedThreadId: threadId,
        expectedStreamId: streamId,
        hasCommandItem: (candidateThreadId, turnId, itemId) => {
          const item = selectConversationItem(
            conversation,
            candidateThreadId,
            turnId,
            itemId,
          );
          return item?.kind === "command" && item.execution?.kind === "command";
        },
      });
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

      const adapted = event.schemaVersion === 6
        ? projectionEventV6ToDomain(event)
        : projectionEventToConversation(event);
      if (adapted.kind === "approval_event") {
        const advancedConversation = reduceConversationEvent(
          conversationState.value,
          Object.freeze({
            eventId: event.eventId,
            streamId: event.subscriptionId,
            sequence: event.projectionSequence,
            threadId: event.sessionId,
            kind: "auxiliary" as const,
          }),
        );
        conversationState.value = advancedConversation;
        if (advancedConversation.syncStatus === "recovery_required") {
          conversationApprovalState.value = requireConversationApprovalReconciliation(
            conversationApprovalState.value,
          );
          requestResync();
          return;
        }
        const nextApproval = reduceConversationApprovalEvent(
          conversationApprovalState.value,
          adapted.event,
        );
        conversationApprovalState.value = nextApproval;
        if (
          nextApproval.reconciliation === "required" ||
          adapted.event.projection.status === "pending"
        ) {
          requestResync();
        }
        return;
      }
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
      const durableCut = "sessionNotices" in snapshotHistory
        ? BigInt(snapshotHistory.durableSequenceCut)
        : null;
      for (const event of pending) {
        const matchesAuthority = context.value !== null &&
          event.contextId === context.value.contextId &&
          event.subscriptionId === subscriptionId &&
          event.sessionId === selectedSessionId.value;
        const includedInSnapshot = matchesAuthority &&
          durableCut !== null &&
          (event.schemaVersion === 4 || event.schemaVersion === 5 || event.schemaVersion === 6) &&
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

    function bufferedApprovalSnapshotRaced(
      contextId: string,
      sessionId: string,
      activeSubscriptionId: string,
      snapshot: ChatPendingApprovalSnapshotV6 | null,
    ): boolean {
      const approvalEvents = bufferedEvents.filter((event): event is ChatApprovalChangedEventV6 =>
        event.schemaVersion === 6 && event.kind === "approval_changed" &&
        event.contextId === contextId && event.sessionId === sessionId &&
        event.subscriptionId === activeSubscriptionId)
        .sort((left, right) =>
          BigInt(left.projectionSequence) < BigInt(right.projectionSequence) ? -1 :
            BigInt(left.projectionSequence) > BigInt(right.projectionSequence) ? 1 : 0);
      const latest = approvalEvents[approvalEvents.length - 1];
      if (latest === undefined) return false;
      if (snapshot === null) return true;
      if (latest.payload.status === "resolved") return snapshot.pending.length !== 0;
      const pending = snapshot.pending[0];
      return snapshot.pending.length !== 1 || pending === undefined ||
        pending.approvalRequestId !== latest.payload.approvalRequestId ||
        pending.turnId !== latest.payload.turnId || pending.itemId !== latest.payload.itemId ||
        pending.actionId !== latest.payload.actionId ||
        pending.workspaceScope !== latest.payload.workspaceScope ||
        pending.requestedAt !== latest.payload.requestedAt ||
        pending.expiresAt !== latest.payload.expiresAt ||
        pending.decisions.primary !== latest.payload.decisions.primary ||
        pending.decisions.secondary !== latest.payload.decisions.secondary;
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
      const sessionId = selectedSessionId.value;
      if (
        sessionId !== null &&
        (deleteInFlightSessionId.value === sessionId || cleanupStatus.value !== null)
      ) return;
      markApprovalTransientsReconciling();
      if (streamingV6Enabled) {
        conversationApprovalState.value = requireConversationApprovalReconciliation(
          conversationApprovalState.value,
        );
      }
      liveAssistantText.value = "";
      liveReasoning.value = Object.freeze([]);
      liveTurnStatus.value = null;
      phase.value = "resync-required";
      void resyncSelected();
    }

    function scheduleApprovalExpiry(): void {
      clearApprovalExpiryTimer();
      if (!streamingV6Enabled) return;

      const current = conversationApprovalState.value;
      const checked = revokeExpiredConversationApprovalAuthority(current, Date.now());
      if (checked !== current) {
        conversationApprovalState.value = checked;
        requestResync();
        return;
      }

      let earliestExpiry: bigint | null = null;
      for (const approval of Object.values(current.approvals)) {
        if (approval.authority !== "actionable") continue;
        const expiresAt = parseStrictRfc3339EpochNanoseconds(approval.expiresAt);
        if (expiresAt !== null && (earliestExpiry === null || expiresAt < earliestExpiry)) {
          earliestExpiry = expiresAt;
        }
      }
      if (earliestExpiry === null) return;

      const expiryEpochMs = (earliestExpiry + NANOSECONDS_PER_MILLISECOND - 1n) /
        NANOSECONDS_PER_MILLISECOND;
      const remainingMs = expiryEpochMs - BigInt(Date.now());
      const delay = remainingMs <= 0n
        ? 0
        : Number(remainingMs > BigInt(MAX_TIMER_DELAY_MS)
          ? BigInt(MAX_TIMER_DELAY_MS)
          : remainingMs);
      approvalExpiryTimer = setTimeout(() => {
        approvalExpiryTimer = null;
        scheduleApprovalExpiry();
      }, delay);
    }

    watch(
      conversationApprovalState,
      scheduleApprovalExpiry,
      { flush: "sync" },
    );

    async function refreshCleanupFromEvent(event: ChatProjectionEvent): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      const activeSubscription = subscriptionId;
      const cleanupSelectionEpoch = selectionEpoch;
      const cleanupObservationGenerationAtStart = cleanupObservationGeneration;
      if (
        event.kind !== "cleanup_state" || bound === null || sessionId === null ||
        activeSubscription === null || event.contextId !== bound.contextId ||
        event.sessionId !== sessionId || event.subscriptionId !== activeSubscription ||
        deleteInFlightSessionId.value === sessionId
      ) return;
      const operation = event.payload.operationId;
      if (typeof operation !== "string") return requestResync();
      const isCurrentCleanupEvent = (): boolean => (
        context.value?.contextId === bound.contextId &&
        selectionEpoch === cleanupSelectionEpoch &&
        cleanupObservationGeneration === cleanupObservationGenerationAtStart &&
        selectedSessionId.value === sessionId &&
        subscriptionId === activeSubscription &&
        deleteInFlightSessionId.value === null
      );
      try {
        if (cleanupStatus.value?.operationId !== operation) {
          const observation = startCleanupObservation();
          const status = await client.getCleanupStatus(bound.contextId, operation);
          if (!isCurrentCleanupEvent()) return;
          commitObservedCleanupStatus(status, observation);
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

    function isAuthorityBound(): boolean {
      return context.value !== null;
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

    async function subscribeAuthority(
      contextId: string,
      sessionId: string,
    ): Promise<ChatSubscriptionAuthority> {
      if (streamingV6Enabled) {
        const subscription = await client.subscribeSessionV6(contextId, sessionId);
        return Object.freeze({
          subscriptionId: subscription.subscriptionId,
          pendingApprovalSnapshot: subscription.pendingApprovalSnapshot,
        });
      }
      const nextSubscriptionId = streamingV5Enabled
        ? await client.subscribeSessionV5(contextId, sessionId)
        : streamingV4Enabled
          ? await client.subscribeSessionV4(contextId, sessionId)
          : await client.subscribeSession(contextId, sessionId);
      return Object.freeze({
        subscriptionId: nextSubscriptionId,
        pendingApprovalSnapshot: null,
      });
    }

    function resyncAuthority(
      contextId: string,
      sessionId: string,
      activeSubscriptionId: string,
      limit: number,
      signal: AbortSignal,
    ): Promise<ChatResyncAuthority> {
      return streamingV6Enabled
        ? client.resyncSessionV6(
            contextId,
            sessionId,
            activeSubscriptionId,
            limit,
            signal,
          )
        : streamingV5Enabled
          ? client.resyncSessionV5(contextId, sessionId, limit, signal)
          : streamingV4Enabled
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
      if (streamingV6Enabled) {
        return client.loadHistoryV6(contextId, sessionId, cursor, limit, signal);
      }
      if (streamingV5Enabled) {
        return client.loadHistoryV5(contextId, sessionId, cursor, limit, signal);
      }
      if (streamingV4Enabled) {
        return client.loadHistoryV4(contextId, sessionId, cursor, limit, signal);
      }
      return artifactIntegration === null
        ? client.loadHistoryV2(contextId, sessionId, cursor, limit, signal)
        : client.loadHistoryV3(contextId, sessionId, cursor, limit, signal);
    }

    function isTerminalHistoryControlPlaneFailure(status: ChatSessionControlPlane): boolean {
      return status.state === "failed" &&
        status.issueCode === "chat_protocol_error" &&
        status.retryable === false &&
        status.recovery === "resync";
    }

    function terminalLocalHistoryStatus(
      sessionId: string,
      state: ConversationState,
    ): string | null {
      const turns = Object.values(state.turns).filter((turn) => turn.threadId === sessionId);
      const persisted = sessions.value.find((session) => session.sessionId === sessionId)
        ?.latestTurnStatus ?? null;
      // History-only requires two independent local authorities to agree: the
      // persisted session summary and every turn in the newest durable page.
      if (
        turns.length === 0 ||
        turns.some((turn) => turn.terminalStatus === null) ||
        persisted === null ||
        !CHAT_TERMINAL_TURN_STATUSES.has(persisted)
      ) return null;
      const latestTerminalStatus = turns.reduce(
        (latest, turn) => turn.ordinal > latest.ordinal ? turn : latest,
      ).terminalStatus;
      return latestTerminalStatus === persisted ? latestTerminalStatus : null;
    }

    function canFallbackFromActivationFailure(
      error: unknown,
      stage: ChatSelectionActivationStage,
    ): boolean {
      return streamingV6Enabled &&
        (stage === "subscription" || stage === "resync") &&
        error instanceof ChatClientError &&
        error.shape.schemaVersion === 6 &&
        error.shape.code === "chat_protocol_error" &&
        error.shape.retryable === false &&
        error.shape.recovery === "resync";
    }

    async function hydrateHistoryOnlySelection(
      bound: BoundChatContext,
      status: ChatSessionControlPlane,
      sessionId: string,
      epoch: number,
      controller: AbortController,
      requireTerminalHistory: boolean,
    ): Promise<ChatHistoryOnlyHydrationResult> {
      if (!streamingV6Enabled || status.sessionId !== sessionId) return "unavailable";
      const expectedObservationEpoch = controlPlaneObservationEpoch;
      const expectedGapEpoch = controlPlaneGapEpoch;
      artifactAuthorityToken = establishArtifactAuthority(sessionId);
      const token = artifactAuthorityToken;
      const page = await loadHistoryAuthority(
        bound.contextId,
        sessionId,
        undefined,
        20,
        controller.signal,
      );
      if (
        !isCurrent(epoch, controller, sessionId) ||
        controlPlaneObservationEpoch !== expectedObservationEpoch ||
        controlPlaneGapEpoch !== expectedGapEpoch
      ) return "superseded";
      if (!isHistoryV6(page)) throw approvalProtocolError();

      const nextConversation = reconcileConversationSnapshot(
        createConversationState(),
        historyPageV6ToConversationSnapshot(sessionId, page),
      );
      if (nextConversation.syncStatus === "recovery_required") {
        throw approvalProtocolError();
      }
      const snapshotTerminalStatus = terminalLocalHistoryStatus(sessionId, nextConversation);
      if (requireTerminalHistory && snapshotTerminalStatus === null) {
        return "unavailable";
      }

      const nextApproval = reduceApprovalHistory(
        createConversationApprovalState(),
        sessionId,
        sessionId,
        page,
      );
      if (nextApproval.reconciliation === "required") throw approvalProtocolError();
      if (artifactIntegration !== null && !artifactIntegration.store.ingestHistoryV3(token, page)) {
        return "unavailable";
      }
      if (
        !isCurrent(epoch, controller, sessionId) ||
        controlPlaneObservationEpoch !== expectedObservationEpoch ||
        controlPlaneGapEpoch !== expectedGapEpoch
      ) return "superseded";

      releaseSessionListeners();
      clearDraftTargetState();
      selectedAccessMode.value = "history-only";
      controlPlane.value = status;
      bindingPendingSessionId = null;
      subscriptionId = null;
      conversationState.value = nextConversation;
      conversationApprovalState.value = disconnectConversationApprovals(nextApproval);
      approvalAuthorityRevision.value += 1;
      history.value = page;
      liveAssistantText.value = "";
      liveReasoning.value = Object.freeze([]);
      liveTurnStatus.value = snapshotTerminalStatus;
      lastErrorCode.value = null;
      bufferingEvents = false;
      bufferingArtifactEvents = false;
      resetProjectionBuffer();
      bufferedArtifactEvents = [];
      activeRead = null;
      phase.value = "ready";
      return "applied";
    }

    async function selectSessionInternal(sessionId: string): Promise<void> {
      const bound = context.value;
      if (!bound || !hasAction("read_sessions")) {
        phase.value = "permission-denied";
        return;
      }
      if (
        selectedSessionId.value === sessionId &&
        (deleteInFlightSessionId.value === sessionId || cleanupStatus.value !== null)
      ) return;
      lastErrorCode.value = null;
      const canSyncDraftTarget = hasAction("submit_turn");
      // Never carry attachment names or recovery state across a selection
      // boundary. A live bound session reloads only its own draft below.
      clearDraftTargetState();
      const oldSubscription = subscriptionId;
      const oldSession = selectedSessionId.value;
      clearSelection();
      selectedSessionId.value = sessionId;
      // Establish the scoped activation intent before installing listeners or
      // issuing the first GET. A live bound edge may then supersede this read;
      // the older GET is rejected by the selection generation.
      if (streamingV6Enabled) bindingPendingSessionId = sessionId;
      phase.value = "resyncing";
      if (oldSubscription && oldSession) {
        void client.unsubscribeSession(bound.contextId, oldSubscription).catch(() => undefined);
      }
      const { epoch, controller } = startRead();
      resetProjectionBuffer();
      bufferingEvents = true;
      bufferingArtifactEvents = artifactIntegration !== null;
      let activationStage: ChatSelectionActivationStage = "control-plane";
      try {
        if (streamingV6Enabled) {
          const expectedObservationEpoch = controlPlaneObservationEpoch;
          const expectedGapEpoch = controlPlaneGapEpoch;
          const readToken = Symbol(sessionId);
          controlPlaneRead = { token: readToken, sessionId, terminalCandidate: null };
          let status: ChatSessionControlPlane;
          let readCandidate: ChatSessionControlPlane | null = null;
          try {
            status = await client.getSessionControlPlane(
              bound.contextId,
              sessionId,
              controller.signal,
              streamingV6Enabled,
            );
          } catch (error: unknown) {
            const candidate = controlPlaneRead?.token === readToken
              ? controlPlaneRead.terminalCandidate
              : null;
            if (candidate === null) throw error;
            status = candidate;
          } finally {
            if (controlPlaneRead?.token === readToken) {
              readCandidate = controlPlaneRead.terminalCandidate;
              controlPlaneRead = null;
            }
          }
          if (readCandidate !== null) status = readCandidate;
          if (
            !isCurrent(epoch, controller, sessionId) ||
            controlPlaneObservationEpoch !== expectedObservationEpoch ||
            controlPlaneGapEpoch !== expectedGapEpoch
          ) return;
          assertSelectionActivationAllowed(sessionId);
          if (status.sessionId !== sessionId) {
            throw new ChatClientError({
              schemaVersion: 1,
              code: "chat_protocol_error",
              retryable: false,
              recovery: "resync",
            });
          }
          controlPlaneTrustedGapEpoch = controlPlaneGapEpoch;
          if (isTerminalHistoryControlPlaneFailure(status)) {
            terminalHistoryCandidate = status;
            let historyOnly: ChatHistoryOnlyHydrationResult;
            try {
              historyOnly = await hydrateHistoryOnlySelection(
                bound,
                status,
                sessionId,
                epoch,
                controller,
                true,
              );
            } finally {
              if (terminalHistoryCandidate === status) terminalHistoryCandidate = null;
            }
            if (historyOnly === "applied" || historyOnly === "superseded") return;
            throw approvalProtocolError();
          }
          applyControlPlaneStatus(status);
          const currentStatus = controlPlane.value;
          if (currentStatus?.sessionId !== sessionId || currentStatus.state !== "bound") {
            bufferingEvents = false;
            bufferingArtifactEvents = false;
            resetProjectionBuffer();
            bufferedArtifactEvents = [];
            activeRead = null;
            return;
          }
        }
        await Promise.all([
          canSyncDraftTarget
            ? switchDraftTarget(chatSessionDraftTarget(sessionId))
            : Promise.resolve(),
          ensureSessionEventListeners(),
        ]);
        if (!isCurrent(epoch, controller, sessionId)) return;
        assertSelectionActivationAllowed(sessionId);
        artifactAuthorityToken = establishArtifactAuthority(sessionId);
        activationStage = "subscription";
        const nextSubscriptionAuthority = await subscribeAuthority(bound.contextId, sessionId);
        const nextSubscription = nextSubscriptionAuthority.subscriptionId;
        if (!isCurrent(epoch, controller, sessionId)) {
          void client.unsubscribeSession(bound.contextId, nextSubscription).catch(() => undefined);
          return;
        }
        subscriptionId = nextSubscription;
        assertSelectionActivationAllowed(sessionId);
        resetArtifactStream();
        bufferingArtifactEvents = artifactIntegration !== null;
        activationStage = "resync";
        const projection = await resyncAuthority(
          bound.contextId,
          sessionId,
          nextSubscription,
          20,
          controller.signal,
        );
        if (!isCurrent(epoch, controller, sessionId) || subscriptionId !== nextSubscription) return;
        assertSelectionActivationAllowed(sessionId);
        activationStage = "projection";
        const authoritativeProjection = streamingV6Enabled &&
          nextSubscriptionAuthority.pendingApprovalSnapshot !== null &&
          "pendingApprovalSnapshot" in projection
          ? Object.freeze({
              ...projection,
              pendingApprovalSnapshot: nextSubscriptionAuthority.pendingApprovalSnapshot,
            })
          : projection;
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
          assertSelectionActivationAllowed(sessionId);
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
          assertSelectionActivationAllowed(sessionId);
          authoritativeHistory = secondHistory;
        }
        const approvalSnapshotRaced = streamingV6Enabled && bufferedApprovalSnapshotRaced(
          bound.contextId,
          sessionId,
          nextSubscription,
          nextSubscriptionAuthority.pendingApprovalSnapshot,
        );
        applyResync(
          authoritativeProjection,
          authoritativeHistory,
          !approvalSnapshotRaced,
        );
        if (approvalSnapshotRaced) resyncTrailingRequested = true;
        const refreshedControlPlane = await refreshControlPlaneGuarded();
        if (!isCurrent(epoch, controller, sessionId) || subscriptionId !== nextSubscription) return;
        assertSelectionActivationAllowed(sessionId);
        if (streamingV6Enabled && refreshedControlPlane.kind === "unavailable") {
          revokeSelectedSessionAuthority("resync-required", sessionId);
          return;
        }
        if (
          streamingV6Enabled && refreshedControlPlane.kind === "applied" &&
          refreshedControlPlane.status.state !== "bound"
        ) {
          if (refreshedControlPlane.status.state === "failed") {
            revokeSelectedSessionAuthority("resync-required", sessionId);
          } else {
            revokeForControlPlaneStatus(refreshedControlPlane.status);
          }
          return;
        }
        const lateNotifications = bufferedArtifactEvents;
        bufferedArtifactEvents = [];
        for (const event of lateNotifications) {
          const disposition = classifyArtifactEvent(event);
          if (disposition === "refresh") trailingArtifactRefresh = true;
          if (disposition === "resync") resyncTrailingRequested = true;
        }
        bufferingEvents = false;
        bufferingArtifactEvents = false;
        assertSelectionActivationAllowed(sessionId);
        const pending = bufferedEvents;
        resetProjectionBuffer();
        activeRead = null;
        selectedAccessMode.value = "live";
        if (phase.value === "resyncing") phase.value = "ready";
        applyBufferedEvents(pending, authoritativeHistory);
        if (resyncTrailingRequested) {
          resyncTrailingRequested = false;
          requestResync();
        } else if (trailingArtifactRefresh) {
          requestArtifactRefresh();
        }
        bindingPendingSessionId = null;
        return;
      } catch (error: unknown) {
        if (!isCurrent(epoch, controller, sessionId)) return;
        let selectionError = error;
        const failedSubscription = subscriptionId;
        subscriptionId = null;
        if (failedSubscription !== null) {
          void client.unsubscribeSession(bound.contextId, failedSubscription).catch(() => false);
        }
        releaseSessionListeners();
        bufferingEvents = false;
        bufferingArtifactEvents = false;
        resetProjectionBuffer();
        bufferedArtifactEvents = [];
        const retainedControlPlane = controlPlane.value;
        const hasQueuedLiveActivation = bindingActivationTrailingSessionId === sessionId &&
          retainedControlPlane?.sessionId === sessionId &&
          retainedControlPlane.state === "bound";
        if (
          !hasQueuedLiveActivation &&
          retainedControlPlane?.sessionId === sessionId &&
          canFallbackFromActivationFailure(selectionError, activationStage)
        ) {
          try {
            const historyOnly = await hydrateHistoryOnlySelection(
              bound,
              retainedControlPlane,
              sessionId,
              epoch,
              controller,
              true,
            );
            if (historyOnly === "applied" || historyOnly === "superseded") return;
          } catch (fallbackError: unknown) {
            selectionError = fallbackError;
          }
        }
        if (!isCurrent(epoch, controller, sessionId)) return;
        activeRead = null;
        lastErrorCode.value = selectionError instanceof ChatClientError
          ? selectionError.shape.code
          : "chat_protocol_error";
        phase.value = phaseForError(selectionError);
        if (streamingV6Enabled) {
          conversationApprovalState.value = requireConversationApprovalReconciliation(
            conversationApprovalState.value,
          );
          bindingPendingSessionId = sessionId;
        }
        return;
      }
    }

    function selectSession(sessionId: string): Promise<void> {
      return selectSessionInternal(sessionId);
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

    function conversationSnapshotFromHistory(
      sessionId: string,
      authority: ChatHistoryAuthority,
    ) {
      if (streamingV6Enabled) {
        if (!isHistoryV6(authority)) throw approvalProtocolError();
        return historyPageV6ToConversationSnapshot(sessionId, authority);
      }
      if (!streamingV5Enabled) {
        return historyPageToConversationSnapshot(sessionId, authority);
      }
      if (!isHistoryV5(authority)) {
        throw new ChatClientError({
          schemaVersion: 5,
          code: "chat_protocol_error",
          retryable: false,
          recovery: "resync",
        });
      }
      return historyPageV5ToConversationSnapshot(sessionId, authority);
    }

    function applyResync(
      projection: ChatResyncAuthority,
      authoritativeHistory: ChatHistoryAuthority = projection.history,
      approvalSnapshotCurrent = true,
    ): void {
      if (projection.session.sessionId !== selectedSessionId.value) {
        throw new ChatClientError({ schemaVersion: 1, code: "chat_protocol_error", retryable: false, recovery: "resync" });
      }
      const snapshot = conversationSnapshotFromHistory(
        projection.session.sessionId,
        authoritativeHistory,
      );
      const nextConversation = reconcileConversationSnapshot(conversationState.value, snapshot);
      let nextApproval = streamingV6Enabled
        ? createConversationApprovalState()
        : conversationApprovalState.value;
      if (streamingV6Enabled) {
        if (
          !("pendingApprovalSnapshot" in projection) ||
          !isHistoryV6(authoritativeHistory) ||
          subscriptionId === null
        ) throw approvalProtocolError();
        nextApproval = reduceApprovalHistory(
          nextApproval,
          projection.session.sessionId,
          subscriptionId,
          authoritativeHistory,
        );
        if (nextApproval.reconciliation === "required") {
          conversationApprovalState.value = nextApproval;
          throw approvalProtocolError();
        }
        if (approvalSnapshotCurrent) {
          nextApproval = reconcileApprovalAuthority(
            nextApproval,
            projection.pendingApprovalSnapshot,
            projection.session.sessionId,
            projection.pendingApprovalSnapshot.streamId,
            nextConversation,
          );
          if (nextApproval.reconciliation === "required") {
            conversationApprovalState.value = nextApproval;
            throw approvalProtocolError();
          }
        } else {
          nextApproval = requireConversationApprovalReconciliation(nextApproval);
        }
      }
      conversationState.value = nextConversation;
      conversationApprovalState.value = nextApproval;
      if (streamingV6Enabled && nextApproval.reconciliation === "synchronized") {
        approvalAuthorityRevision.value += 1;
        settleApprovalTransientsAfterResync();
      }
      // A projection captured before a delete acknowledgement must not erase
      // the newer cleanup operation. Non-null cleanup authority is cleared only
      // by the cleanup completion path that also removes the selection.
      if (cleanupStatus.value === null) cleanupStatus.value = projection.cleanup;
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
        if (streamingV6Enabled) {
          conversationApprovalState.value = requireConversationApprovalReconciliation(
            conversationApprovalState.value,
          );
        }
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
      if (!bound || !sessionId) return;
      if (deleteInFlightSessionId.value === sessionId) return;
      if (selectedAccessMode.value === "history-only") {
        const retainedControlPlane = controlPlane.value;
        if (retainedControlPlane?.sessionId !== sessionId) return;
        const { epoch, controller } = startRead();
        phase.value = "resyncing";
        const run = async (): Promise<void> => {
          try {
            const historyOnly = await hydrateHistoryOnlySelection(
              bound,
              retainedControlPlane,
              sessionId,
              epoch,
              controller,
              true,
            );
            if (historyOnly === "unavailable") throw approvalProtocolError();
            if (historyOnly === "superseded" && isCurrent(epoch, controller, sessionId)) {
              activeRead = null;
              phase.value = "ready";
            }
          } catch (error: unknown) {
            if (!isCurrent(epoch, controller, sessionId)) return;
            activeRead = null;
            lastErrorCode.value = error instanceof ChatClientError
              ? error.shape.code
              : "chat_protocol_error";
            phase.value = phaseForError(error);
          }
        };
        const promise = run().finally(() => {
          if (resyncPromise === promise) {
            resyncPromise = null;
            resyncTrailingRequested = false;
          }
        });
        resyncPromise = promise;
        return promise;
      }
      if (cleanupStatus.value !== null) return;
      if (!subscriptionId) {
        if (streamingV6Enabled && bindingPendingSessionId === sessionId) {
          if (controlPlaneGapRecoveryPromise !== null) {
            // Reuse the live-gap read already in flight. Its failure does not
            // authorize this explicit action to retry automatically.
            await controlPlaneGapRecoveryPromise;
            return bindingActivationPromise ?? Promise.resolve();
          }
          if (
            controlPlaneTrustedGapEpoch === controlPlaneGapEpoch &&
            controlPlane.value?.sessionId === sessionId &&
            controlPlane.value.state === "bound"
          ) {
            requestBindingActivation(sessionId);
          } else {
            const refreshed = await refreshControlPlaneGuarded();
            if (refreshed.kind === "applied" && refreshed.status.state === "bound") {
              requestBindingActivation(sessionId);
            }
          }
          return bindingActivationPromise ?? Promise.resolve();
        }
        return;
      }
      if (streamingV6Enabled) {
        conversationApprovalState.value = requireConversationApprovalReconciliation(
          conversationApprovalState.value,
        );
      }
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
          const nextSubscriptionAuthority = await subscribeAuthority(bound.contextId, sessionId);
          const nextSubscription = nextSubscriptionAuthority.subscriptionId;
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
            nextSubscription,
            20,
            controller.signal,
          );
          if (!isCurrent(epoch, controller, sessionId) || subscriptionId !== nextSubscription) return;
          const authoritativeProjection = streamingV6Enabled &&
            nextSubscriptionAuthority.pendingApprovalSnapshot !== null &&
            "pendingApprovalSnapshot" in projection
            ? Object.freeze({
                ...projection,
                pendingApprovalSnapshot: nextSubscriptionAuthority.pendingApprovalSnapshot,
              })
            : projection;
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
          const approvalSnapshotRaced = streamingV6Enabled && bufferedApprovalSnapshotRaced(
            bound.contextId,
            sessionId,
            nextSubscription,
            nextSubscriptionAuthority.pendingApprovalSnapshot,
          );
          applyResync(
            authoritativeProjection,
            authoritativeHistory,
            !approvalSnapshotRaced,
          );
          if (approvalSnapshotRaced) resyncTrailingRequested = true;
          if (streamingV6Enabled) {
            const refreshedControlPlane = await refreshControlPlaneGuarded();
            if (!isCurrent(epoch, controller, sessionId) || subscriptionId !== nextSubscription) return;
            if (refreshedControlPlane.kind === "unavailable") {
              revokeSelectedSessionAuthority("resync-required", sessionId);
              return;
            }
            if (
              refreshedControlPlane.kind === "applied" &&
              refreshedControlPlane.status.state !== "bound"
            ) {
              revokeForControlPlaneStatus(refreshedControlPlane.status);
              return;
            }
          } else {
            void refreshControlPlane();
          }
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
          if (streamingV6Enabled) {
            conversationApprovalState.value = requireConversationApprovalReconciliation(
              conversationApprovalState.value,
            );
            failApprovalTransientsAfterResync();
          }
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

    function approvalDecisionError(error: unknown): ChatApprovalTransientError {
      return error instanceof ChatClientError
        ? error.shape.approvalIssue ?? "unknown"
        : "unknown";
    }

    function reconcileFailedApprovalDecision(
      approvalRequestId: string,
      errorCode: ChatApprovalTransientError,
    ): ChatApprovalDecisionDisposition {
      conversationApprovalState.value = requireConversationApprovalReconciliation(
        conversationApprovalState.value,
      );
      setApprovalTransient(approvalRequestId, {
        phase: "reconciling",
        errorCode,
      });
      requestResync();
      return "reconciling";
    }

    async function decideApproval(
      input: ChatApprovalDecisionInput,
    ): Promise<ChatApprovalDecisionDisposition> {
      if (!streamingV6Enabled) return "ignored";
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      const activeSubscription = subscriptionId;
      const attemptSelectionEpoch = selectionEpoch;
      if (bound === null || sessionId === null || activeSubscription === null ||
          sessionId !== input.threadId) {
        return "ignored";
      }
      if (activeApprovalDecisionAttempts.has(input.approvalRequestId) ||
          approvalTransients.value[input.approvalRequestId]?.phase === "submitting" ||
          approvalTransients.value[input.approvalRequestId]?.phase === "reconciling") {
        return "ignored";
      }

      const approval = conversationApprovalState.value.approvals[
        input.approvalRequestId
      ] ?? null;
      const intent = createApprovalDecisionIntentV6(approval, input);
      const expiresAt = approval === null
        ? null
        : parseStrictRfc3339EpochNanoseconds(approval.expiresAt);
      const now = BigInt(Date.now()) * NANOSECONDS_PER_MILLISECOND;
      const command = selectConversationItem(
        conversationState.value,
        sessionId,
        input.turnId,
        input.itemId,
      );
      if (!canDecideApprovals.value || intent === null || expiresAt === null ||
          now >= expiresAt || command?.kind !== "command" ||
          command.execution?.kind !== "command") {
        return reconcileFailedApprovalDecision(
          input.approvalRequestId,
          expiresAt !== null && now >= expiresAt ? "approval_expired" : "unknown",
        );
      }

      const token = Symbol("chat-approval-decision");
      activeApprovalDecisionAttempts.set(intent.approvalRequestId, token);
      setApprovalTransient(intent.approvalRequestId, {
        phase: "submitting",
        errorCode: null,
      });
      const isCurrentAttempt = (): boolean =>
        activeApprovalDecisionAttempts.get(intent.approvalRequestId) === token &&
        selectionEpoch === attemptSelectionEpoch &&
        context.value?.contextId === bound.contextId &&
        selectedSessionId.value === sessionId;

      let result;
      try {
        result = await client.decideApprovalV6(
          bound.contextId,
          intent.threadId,
          intent.turnId,
          intent.itemId,
          intent.approvalRequestId,
          intent.decision,
        );
      } catch (error: unknown) {
        if (!isCurrentAttempt()) return "ignored";
        activeApprovalDecisionAttempts.delete(intent.approvalRequestId);
        return reconcileFailedApprovalDecision(
          intent.approvalRequestId,
          approvalDecisionError(error),
        );
      }
      if (!isCurrentAttempt()) return "ignored";
      activeApprovalDecisionAttempts.delete(intent.approvalRequestId);
      const adapted = approvalDecisionResultV6ToDomain(
        conversationApprovalState.value,
        intent,
        result,
      );
      conversationApprovalState.value = adapted.state;
      if (!adapted.correlated) {
        return reconcileFailedApprovalDecision(intent.approvalRequestId, "unknown");
      }
      setApprovalTransient(intent.approvalRequestId, null);
      return "accepted";
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
          schemaVersion: streamingV6Enabled ? 6 : streamingV5Enabled ? 5 : streamingV4Enabled ? 4 : 1,
          code: "chat_protocol_error",
          retryable: false,
          recovery: "resync",
        });
        const mergedHistory: ChatHistoryAuthority = streamingV6Enabled
          ? isHistoryV6(currentHistory) && isHistoryV6(page)
            ? Object.freeze({
                schemaVersion: 6 as const,
                turns: Object.freeze([...currentHistory.turns, ...page.turns]),
                nextCursor: page.nextCursor,
                sessionNotices: currentHistory.sessionNotices,
                durableSequenceCut: currentHistory.durableSequenceCut,
                approvals: Object.freeze([...currentHistory.approvals, ...page.approvals]),
              })
            : (() => { throw approvalProtocolError(); })()
          : streamingV5Enabled
            ? isHistoryV5(currentHistory) && isHistoryV5(page)
            ? Object.freeze({
                schemaVersion: 5 as const,
                turns: Object.freeze([...currentHistory.turns, ...page.turns]),
                nextCursor: page.nextCursor,
                sessionNotices: currentHistory.sessionNotices,
                durableSequenceCut: currentHistory.durableSequenceCut,
              })
            : (() => { throw new ChatClientError({
                schemaVersion: 5,
                code: "chat_protocol_error",
                retryable: false,
                recovery: "resync",
              }); })()
            : streamingV4Enabled
              ? isHistoryV4(currentHistory) && isHistoryV4(page)
              ? Object.freeze({
                  turns: Object.freeze([...currentHistory.turns, ...page.turns]),
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
              : Object.freeze({
                  turns: Object.freeze([...currentHistory.turns, ...page.turns]),
                  nextCursor: page.nextCursor,
                });
        const appended = appendOlderConversationSnapshot(
          conversationState.value,
          conversationSnapshotFromHistory(sessionId, page),
        );
        if (appended.syncStatus === "recovery_required") {
          conversationState.value = appended;
          if (streamingV6Enabled) {
            conversationApprovalState.value = requireConversationApprovalReconciliation(
              conversationApprovalState.value,
            );
          }
          lastErrorCode.value = "chat_protocol_error";
          phase.value = "resync-required";
          activeRead = null;
          return;
        }
        if (artifactIntegration !== null && !artifactIntegration.store.ingestHistoryV3(token, page)) return;
        let appendedApproval = conversationApprovalState.value;
        if (streamingV6Enabled) {
          const approvalHistoryStreamId = subscriptionId ?? (
            selectedAccessMode.value === "history-only" ? sessionId : null
          );
          if (!isHistoryV6(page) || approvalHistoryStreamId === null) {
            throw approvalProtocolError();
          }
          appendedApproval = reduceApprovalHistory(
            appendedApproval,
            sessionId,
            approvalHistoryStreamId,
            page,
          );
          if (appendedApproval.reconciliation === "required") {
            conversationApprovalState.value = appendedApproval;
            lastErrorCode.value = "chat_protocol_error";
            phase.value = "resync-required";
            activeRead = null;
            return;
          }
        }
        conversationState.value = appended;
        conversationApprovalState.value = appendedApproval;
        history.value = mergedHistory;
        activeRead = null;
        if (selectedAccessMode.value === "history-only") {
          lastErrorCode.value = null;
          phase.value = "ready";
        }
      } catch (error: unknown) {
        if (!isCurrent(epoch, controller, sessionId)) return;
        activeRead = null;
        if (streamingV6Enabled && selectedAccessMode.value !== "history-only") {
          conversationApprovalState.value = requireConversationApprovalReconciliation(
            conversationApprovalState.value,
          );
        }
        lastErrorCode.value = error instanceof ChatClientError
          ? error.shape.code
          : "chat_protocol_error";
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
        (
          target.type === "session" && target.sessionId === selectedSessionId.value &&
          (deleteInFlightSessionId.value === target.sessionId || cleanupStatus.value !== null)
        ) ||
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
      if (utf8Bytes(input) > CHAT_INPUT_MAX_BYTES) return null;
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

    function locallyAcceptedContentBlocks(
      blocks: readonly ChatTurnContentBlock[],
      attachments: readonly ChatAttachment[],
    ): readonly ChatMessageContentBlock[] {
      const attachmentsById = new Map(attachments.map((attachment) => [
        attachment.attachmentId,
        attachment,
      ]));
      return Object.freeze(blocks.flatMap((block): readonly ChatMessageContentBlock[] => {
        if (block.type === "text") return [Object.freeze({ type: "text", text: block.text })];
        const attachment = attachmentsById.get(block.attachmentId);
        return attachment === undefined
          ? []
          : [Object.freeze({ ...attachment, status: "bound" as const })];
      }));
    }

    function projectLocallyAcceptedTurn(
      sessionId: string,
      turnId: string,
      blocks: readonly ChatTurnContentBlock[],
      attachments: readonly ChatAttachment[],
    ): void {
      const currentHistory = history.value;
      if (currentHistory?.turns.some((turn) => turn.turnId === turnId)) return;
      const contentBlocks = locallyAcceptedContentBlocks(blocks, attachments);
      const content = contentBlocks
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const queuedTurn: ChatHistoryTurn = Object.freeze({
        turnId,
        status: "queued",
        terminalAt: null,
        reasoningStatus: "pending",
        reasoningReasonCode: null,
        messages: Object.freeze([Object.freeze({
          messageId: conversationMessageItemId(turnId, "user"),
          role: "user",
          content,
          contentBlocks,
          status: "committed",
          ordinal: 0,
          createdAt: Date.now(),
        })]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
      });
      let nextHistory: ChatHistoryAuthority;
      if (streamingV6Enabled) {
        const currentV6 = currentHistory !== null && isHistoryV6(currentHistory)
          ? currentHistory
          : null;
        const queuedTurnV6: ChatHistoryTurnV4 = Object.freeze({
          ...queuedTurn,
          projectionAuthority: "legacy",
          artifacts: Object.freeze([]),
          terminalCode: null,
          timelineItems: Object.freeze([]),
          plan: null,
          notices: Object.freeze([]),
        });
        nextHistory = Object.freeze({
          schemaVersion: 6 as const,
          turns: Object.freeze([...(currentV6?.turns ?? []), queuedTurnV6]),
          nextCursor: currentV6?.nextCursor ?? null,
          sessionNotices: currentV6?.sessionNotices ?? Object.freeze([]),
          durableSequenceCut: currentV6?.durableSequenceCut ?? "0",
          approvals: currentV6?.approvals ?? Object.freeze([]),
        });
      } else if (streamingV5Enabled) {
        const currentV5 = currentHistory !== null && isHistoryV5(currentHistory)
          ? currentHistory
          : null;
        // A locally queued Turn has no durable v5 projection facts yet. Keep it
        // legacy inside the v5 response container until native resync assigns
        // an authoritative v4/v5 projection.
        const queuedTurnV5: ChatHistoryTurnV4 = Object.freeze({
          ...queuedTurn,
          projectionAuthority: "legacy",
          artifacts: Object.freeze([]),
          terminalCode: null,
          timelineItems: Object.freeze([]),
          plan: null,
          notices: Object.freeze([]),
        });
        nextHistory = Object.freeze({
          schemaVersion: 5 as const,
          turns: Object.freeze([...(currentV5?.turns ?? []), queuedTurnV5]),
          nextCursor: currentV5?.nextCursor ?? null,
          sessionNotices: currentV5?.sessionNotices ?? Object.freeze([]),
          durableSequenceCut: currentV5?.durableSequenceCut ?? "0",
        });
      } else if (streamingV4Enabled) {
        const currentV4 = currentHistory !== null && isHistoryV4(currentHistory)
          ? currentHistory
          : null;
        const queuedTurnV4: ChatHistoryTurnV4 = Object.freeze({
          ...queuedTurn,
          projectionAuthority: "legacy",
          artifacts: Object.freeze([]),
          terminalCode: null,
          timelineItems: Object.freeze([]),
          plan: null,
          notices: Object.freeze([]),
        });
        nextHistory = Object.freeze({
          turns: Object.freeze([...(currentV4?.turns ?? []), queuedTurnV4]),
          nextCursor: currentV4?.nextCursor ?? null,
          sessionNotices: currentV4?.sessionNotices ?? Object.freeze([]),
          durableSequenceCut: currentV4?.durableSequenceCut ?? "0",
        });
      } else {
        const currentLegacy = currentHistory !== null && !isHistoryV4(currentHistory)
          ? currentHistory
          : null;
        nextHistory = Object.freeze({
          turns: Object.freeze([...(currentLegacy?.turns ?? []), queuedTurn]),
          nextCursor: currentLegacy?.nextCursor ?? null,
        });
      }
      history.value = nextHistory;
      conversationState.value = reconcileConversationSnapshot(
        conversationState.value,
        conversationSnapshotFromHistory(sessionId, nextHistory),
      );
      liveTurnStatus.value = "queued";
      sessions.value = Object.freeze(sessions.value.map((session) =>
        session.sessionId === sessionId
          ? Object.freeze({ ...session, latestTurnStatus: "queued" })
          : session
      ));
    }

    async function createSessionWithResult(
      projectId: string,
      input: string,
    ): Promise<ChatSubmissionResult> {
      const bound = context.value;
      if (
        !bound || selectedSessionId.value !== null || !canSend.value ||
        !hasAction("create_session") || !hasAction("use_project")
      ) return CHAT_SUBMISSION_NOT_ACCEPTED;
      const blocks = turnContentBlocks(input);
      if (blocks === null) return CHAT_SUBMISSION_NOT_ACCEPTED;
      const submissionToken = beginSubmission();
      if (submissionToken === null) return CHAT_SUBMISSION_NOT_ACCEPTED;
      try {
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
          if (!canDispatchCreateAttempt()) return CHAT_SUBMISSION_NOT_ACCEPTED;
          throw error;
        }
        if (project === null || !canDispatchCreateAttempt()) return CHAT_SUBMISSION_NOT_ACCEPTED;
        if (project.projectId !== projectId || !project.available) throw projectInvalidError();
        const currentBlocks = turnContentBlocks(input);
        if (
          currentBlocks === null ||
          submissionKey("create", projectId, input, currentBlocks) !== attemptKey
        ) return CHAT_SUBMISSION_NOT_ACCEPTED;
        const attemptOperationId = submissionOperation(attemptKey);
        if (!markSubmissionDispatching(submissionToken)) return CHAT_SUBMISSION_NOT_ACCEPTED;
        const created = streamingV4Enabled || draftAttachments.value.length > 0
          ? await client.createSessionV2(bound.contextId, projectId, currentBlocks, attemptOperationId)
          : await client.createSession(bound.contextId, projectId, input, attemptOperationId);
        const settledBlocks = turnContentBlocks(input);
        if (
          !isCurrentCreateAuthority() ||
          settledBlocks === null ||
          submissionKey("create", projectId, input, settledBlocks) !== attemptKey
        ) return CHAT_SUBMISSION_NOT_ACCEPTED;
        if (created.operationId !== attemptOperationId) {
          throw new ChatClientError({
            schemaVersion: 2,
            code: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          });
        }
        const accepted: ChatSubmissionResult = Object.freeze({
          status: "local_durable_accepted",
          draftTarget: CHAT_NEW_DRAFT_TARGET,
          sessionId: created.sessionId,
          turnId: created.turnId,
          operationId: created.operationId,
        });
        const acceptedAttachments = draftAttachments.value;
        dropDraftReferences();
        const selection = selectSession(created.sessionId);
        projectLocallyAcceptedTurn(
          created.sessionId,
          created.turnId,
          currentBlocks,
          acceptedAttachments,
        );
        const synchronizeCreatedSession = async (): Promise<void> => {
          await selection;
          if (
            authorityEpoch !== attemptAuthorityEpoch ||
            context.value?.contextId !== bound.contextId ||
            selectedSessionId.value !== created.sessionId
          ) return;
          const page = await client.listSessions(bound.contextId);
          if (
            authorityEpoch !== attemptAuthorityEpoch ||
            context.value?.contextId !== bound.contextId ||
            selectedSessionId.value !== created.sessionId
          ) return;
          sessions.value = page.sessions;
          sessionsCursor.value = page.nextCursor;
        };
        void synchronizeCreatedSession().catch((error: unknown) => {
          if (
            authorityEpoch === attemptAuthorityEpoch &&
            context.value?.contextId === bound.contextId
          ) {
            lastErrorCode.value = error instanceof ChatClientError
              ? error.shape.code
              : "chat_protocol_error";
          }
        });
        return accepted;
      } finally {
        finishSubmission(submissionToken);
      }
    }

    async function createSession(projectId: string, input: string): Promise<string | null> {
      const result = await createSessionWithResult(projectId, input);
      return result.status === "local_durable_accepted" ? result.sessionId : null;
    }

    async function submitTurnWithResult(input: string): Promise<ChatSubmissionResult> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !canSend.value || !hasAction("submit_turn")) {
        return CHAT_SUBMISSION_NOT_ACCEPTED;
      }
      const blocks = turnContentBlocks(input);
      if (blocks === null) return CHAT_SUBMISSION_NOT_ACCEPTED;
      const submissionToken = beginSubmission();
      if (submissionToken === null) return CHAT_SUBMISSION_NOT_ACCEPTED;
      try {
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
        if (!markSubmissionDispatching(submissionToken)) return CHAT_SUBMISSION_NOT_ACCEPTED;
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
        ) return CHAT_SUBMISSION_NOT_ACCEPTED;
        if (created.operationId !== attemptOperationId) {
          throw new ChatClientError({
            schemaVersion: 2,
            code: "chat_protocol_error",
            retryable: false,
            recovery: "resync",
          });
        }
        const accepted: ChatSubmissionResult = Object.freeze({
          status: "local_durable_accepted",
          draftTarget: attemptTarget,
          sessionId: created.sessionId,
          turnId: created.turnId,
          operationId: created.operationId,
        });
        const acceptedAttachments = draftAttachments.value;
        dropDraftReferences();
        projectLocallyAcceptedTurn(sessionId, created.turnId, settledBlocks, acceptedAttachments);
        void resyncSelected().catch((error: unknown) => {
          if (
            authorityEpoch === attemptAuthorityEpoch &&
            context.value?.contextId === bound.contextId &&
            selectedSessionId.value === sessionId
          ) {
            lastErrorCode.value = error instanceof ChatClientError
              ? error.shape.code
              : "chat_protocol_error";
          }
        });
        return accepted;
      } finally {
        finishSubmission(submissionToken);
      }
    }

    async function submitTurn(input: string): Promise<void> {
      await submitTurnWithResult(input);
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
      const recoverySessionId = streamingV6Enabled ? selectedSessionId.value : null;
      if (
        recoverySessionId !== null &&
        (deleteInFlightSessionId.value === recoverySessionId || cleanupStatus.value !== null)
      ) return localReadiness.value;
      if (recoverySessionId !== null) {
        revokeSelectedSessionAuthority("resync-required");
      }
      const projection = await client.requestLocalRecovery(bound.contextId, operationId());
      if (context.value?.contextId !== bound.contextId) return null;
      localReadiness.value = projection;
      if (
        recoverySessionId !== null && selectedSessionId.value === recoverySessionId &&
        projection.lifecycle === "ready" && projection.canSend
      ) {
        await selectSessionInternal(recoverySessionId);
      } else if (recoverySessionId !== null && selectedSessionId.value === recoverySessionId) {
        await refreshControlPlane();
      }
      return projection;
    }

    async function renameSelected(title: string): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (
        !bound || !sessionId || !hasAction("rename_session") ||
        deleteInFlightSessionId.value === sessionId || cleanupStatus.value !== null
      ) return;
      await client.renameSession(bound.contextId, sessionId, title, operationId());
      if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== sessionId) return;
      await reloadSessions();
    }

    async function setSelectedPinned(pinned: boolean): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (
        !bound || !sessionId || !hasAction("pin_session") ||
        deleteInFlightSessionId.value === sessionId || cleanupStatus.value !== null
      ) return;
      await client.setSessionPinned(bound.contextId, sessionId, pinned, operationId());
      if (context.value?.contextId !== bound.contextId || selectedSessionId.value !== sessionId) return;
      await reloadSessions();
    }

    async function interruptSelected(): Promise<boolean> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (
        !bound || !sessionId || !hasAction("interrupt_turn") ||
        deleteInFlightSessionId.value === sessionId || cleanupStatus.value !== null ||
        selectedAccessMode.value !== "live" || subscriptionId === null ||
        (streamingV6Enabled && controlPlane.value?.state !== "bound")
      ) return false;
      await client.interruptTurn(bound.contextId, sessionId, operationId());
      return context.value?.contextId === bound.contextId && selectedSessionId.value === sessionId;
    }

    function cleanupIsComplete(status: ChatCleanupStatus): boolean {
      return status.desktopState === "complete" && status.hostState === "complete" && status.runtimeState === "complete";
    }

    function cleanupSurfaceRank(state: ChatCleanupStatus["desktopState"]): number {
      switch (state) {
        case "not_attempted": return 0;
        case "pending": return 1;
        case "incomplete": return 2;
        case "complete": return 3;
      }
    }

    function commitObservedCleanupStatus(
      status: ChatCleanupStatus | null,
      observation: CleanupObservationToken,
    ): boolean {
      if (
        observation.generation !== cleanupObservationGeneration ||
        observation.sequence < cleanupCommittedObservationSequence
      ) return false;
      cleanupCommittedObservationSequence = observation.sequence;
      if (status === null) return false;
      const current = cleanupStatus.value;
      if (current !== null) {
        if (
          current.operationId !== status.operationId || cleanupIsComplete(current) ||
          current.outcomeCode === "retry_limit_exceeded" || current.completedAt !== null ||
          cleanupSurfaceRank(status.desktopState) < cleanupSurfaceRank(current.desktopState) ||
          cleanupSurfaceRank(status.hostState) < cleanupSurfaceRank(current.hostState) ||
          cleanupSurfaceRank(status.runtimeState) < cleanupSurfaceRank(current.runtimeState)
        ) return false;
      }
      cleanupStatus.value = status;
      if (cleanupIsComplete(status) || status.outcomeCode === "retry_limit_exceeded") {
        clearCleanupPoll();
      }
      return true;
    }

    function scheduleSelectedCleanupPoll(
      bound: BoundChatContext,
      sessionId: string,
      cleanupOperationId: string,
    ): void {
      clearCleanupPoll();
      const pollEpoch = cleanupPollEpoch;
      const pollCleanupGeneration = cleanupObservationGeneration;
      let attempts = 0;
      const poll = async (): Promise<void> => {
        cleanupPollTimer = null;
        if (
          cleanupPollEpoch !== pollEpoch ||
          cleanupObservationGeneration !== pollCleanupGeneration ||
          context.value?.contextId !== bound.contextId ||
          selectedSessionId.value !== sessionId ||
          cleanupStatus.value?.operationId !== cleanupOperationId ||
          deleteInFlightSessionId.value !== null
        ) return;
        try {
          const observation = startCleanupObservation();
          const status = await client.getCleanupStatus(bound.contextId, cleanupOperationId);
          if (
            cleanupPollEpoch !== pollEpoch ||
            cleanupObservationGeneration !== pollCleanupGeneration ||
            context.value?.contextId !== bound.contextId ||
            selectedSessionId.value !== sessionId ||
            cleanupStatus.value?.operationId !== cleanupOperationId ||
            deleteInFlightSessionId.value !== null
          ) return;
          if (commitObservedCleanupStatus(status, observation) && status !== null) {
            if (cleanupIsComplete(status)) {
              await finishCompletedCleanup(bound, sessionId, status);
              return;
            }
            if (status.outcomeCode === "retry_limit_exceeded") {
              return;
            }
          }
          const retainedCleanup = cleanupStatus.value;
          if (retainedCleanup !== null && cleanupIsComplete(retainedCleanup)) {
            await finishCompletedCleanup(bound, sessionId, retainedCleanup);
            return;
          }
          if (retainedCleanup?.outcomeCode === "retry_limit_exceeded") return;
        } catch {
          // A manual status check remains available; keep polling while this selection is current.
        }
        attempts += 1;
        if (
          attempts >= CLEANUP_POLL_MAX_ATTEMPTS || cleanupPollEpoch !== pollEpoch ||
          cleanupObservationGeneration !== pollCleanupGeneration
        ) {
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
      if (
        !bound || !sessionId || !hasAction("delete_session") ||
        deleteInFlightSessionId.value !== null
      ) return null;
      const currentCleanup = cleanupStatus.value;
      if (currentCleanup !== null) {
        if (cleanupIsComplete(currentCleanup)) {
          return finishCompletedCleanup(bound, sessionId, currentCleanup);
        }
        if (currentCleanup.outcomeCode !== "retry_limit_exceeded") {
          scheduleSelectedCleanupPoll(bound, sessionId, currentCleanup.operationId);
          const retainedDisposition: DeleteDisposition = Object.freeze({
            kind: "cleanup_pending",
            deletedSessionId: sessionId,
            nextSessionId: null,
            path: `/chat/${sessionId}`,
          });
          deleteDisposition.value = retainedDisposition;
          return retainedDisposition;
        }
      }
      deleteInFlightSessionId.value = sessionId;
      clearCleanupPoll();
      invalidateCleanupObservations();
      try {
        const status = await client.deleteSession(bound.contextId, sessionId, operationId());
        if (
          context.value?.contextId !== bound.contextId ||
          selectedSessionId.value !== sessionId
        ) return null;
        cleanupStatus.value = status;
        revokeSelectedRealtimeAuthorityForCleanup(bound, sessionId);
        if (cleanupIsComplete(status)) return finishCompletedCleanup(bound, sessionId, status);
        if (status.outcomeCode !== "retry_limit_exceeded") {
          scheduleSelectedCleanupPoll(bound, sessionId, status.operationId);
        }
        const disposition: DeleteDisposition = Object.freeze({
          kind: "cleanup_pending",
          deletedSessionId: sessionId,
          nextSessionId: null,
          path: `/chat/${sessionId}`,
        });
        deleteDisposition.value = disposition;
        return disposition;
      } finally {
        if (deleteInFlightSessionId.value === sessionId) deleteInFlightSessionId.value = null;
      }
    }

    async function refreshSelectedCleanup(): Promise<DeleteDisposition | null> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      const operation = cleanupStatus.value?.operationId;
      if (
        !bound || !sessionId || !operation ||
        deleteInFlightSessionId.value === sessionId
      ) return null;
      const observation = startCleanupObservation();
      const status = await client.getCleanupStatus(bound.contextId, operation);
      if (
        context.value?.contextId !== bound.contextId ||
        selectedSessionId.value !== sessionId ||
        cleanupStatus.value?.operationId !== operation ||
        observation.generation !== cleanupObservationGeneration ||
        deleteInFlightSessionId.value !== null
      ) {
        return null;
      }
      commitObservedCleanupStatus(status, observation);
      if (status === null) return null;
      const retainedStatus = cleanupStatus.value;
      if (retainedStatus === null) return null;
      if (cleanupIsComplete(retainedStatus)) {
        return finishCompletedCleanup(bound, sessionId, retainedStatus);
      }
      if (retainedStatus.outcomeCode !== "retry_limit_exceeded") {
        scheduleSelectedCleanupPoll(bound, sessionId, retainedStatus.operationId);
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
      clearApprovalExpiryTimer();
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
      selectedAccessMode,
      history,
      conversationState,
      conversationApprovalState,
      approvalTransients,
      approvalAuthorityRevision,
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
      submissionState,
      deleteDisposition,
      lastErrorCode,
      lastBindFailureStage,
      isReady,
      canSend,
      canAttach,
      draftAttachmentsReady,
      canDecideApprovals,
      hasAction,
      bind,
      isAuthorityBound,
      selectSession,
      clearSelectedSession,
      retryDraftRecovery,
      resyncSelected,
      decideApproval,
      loadOlderHistory,
      loadHistoryPage,
      loadReasoning,
      pickAttachments,
      importAttachmentPaths,
      removeDraftAttachment,
      dismissAttachmentImportAttempt,
      discardDraftAttachments,
      createSessionWithResult,
      createSession,
      submitTurnWithResult,
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
