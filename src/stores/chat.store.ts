import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { chatClient, type ChatClient } from "../api/chat-client";
import type {
  BoundChatContext,
  ChatAllowedAction,
  ChatCleanupStatus,
  ChatControlPlaneEvent,
  ChatHistoryPage,
  ChatLocalReadiness,
  ChatProjectionEvent,
  ChatProject,
  ChatReasoningItem,
  ChatResyncProjection,
  ChatSession,
  ChatSessionControlPlane,
} from "../domain/chat-ipc";
import { ChatClientError } from "../domain/chat-ipc";

const STORE_ID = "chat-conversation";
const MAX_LIVE_ASSISTANT_BYTES = 1024 * 1024;
const MAX_LIVE_REASONING_BYTES = 256 * 1024;
const MAX_SEEN_EVENT_IDS = 256;

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

export interface LiveReasoningPart {
  readonly itemOrdinal: number;
  readonly contentIndex: number;
  readonly text: string;
}

export type DeleteDisposition = Readonly<{
  kind: "cleanup_pending" | "navigate";
  nextSessionId: string | null;
  path: "/chat" | `/chat/${string}`;
}>;

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

export function createChatStoreDefinition(client: ChatClient, storeId = STORE_ID) {
  return defineStore(storeId, () => {
    const phase = ref<ChatViewPhase>("idle");
    const context = shallowRef<BoundChatContext | null>(null);
    const projects = shallowRef<readonly ChatProject[]>(Object.freeze([]));
    const sessions = shallowRef<readonly ChatSession[]>(Object.freeze([]));
    const sessionsCursor = ref<string | null>(null);
    const selectedSessionId = ref<string | null>(null);
    const history = shallowRef<ChatHistoryPage | null>(null);
    const liveAssistantText = ref("");
    const liveReasoning = shallowRef<readonly LiveReasoningPart[]>(Object.freeze([]));
    const liveTurnStatus = ref<string | null>(null);
    const cleanupStatus = shallowRef<ChatCleanupStatus | null>(null);
    const controlPlane = shallowRef<ChatSessionControlPlane | null>(null);
    const localReadiness = shallowRef<ChatLocalReadiness | null>(null);
    const deleteDisposition = shallowRef<DeleteDisposition | null>(null);
    const lastErrorCode = ref<string | null>(null);
    const isReady = computed(() => phase.value === "ready" || phase.value === "streaming");
    const canSend = computed(() =>
      isReady.value &&
      localReadiness.value?.canSend === true &&
      (selectedSessionId.value === null || controlPlane.value?.state === "bound"),
    );

    let selectionEpoch = 0;
    let authorityEpoch = 0;
    let listenerEpoch = 0;
    let subscriptionId: string | null = null;
    let expectedSequence = 0n;
    let eventUnlisten: UnlistenFn | null = null;
    let eventListenerPromise: Promise<void> | null = null;
    let controlPlaneUnlisten: UnlistenFn | null = null;
    let controlPlaneListenerPromise: Promise<void> | null = null;
    let controlPlaneSequence: bigint | null = null;
    let activeRead: AbortController | null = null;
    let contextExpiryTimer: ReturnType<typeof setTimeout> | null = null;
    let resyncPromise: Promise<void> | null = null;
    let bufferingEvents = false;
    let bufferedEvents: ChatProjectionEvent[] = [];
    const seenEventIds = new Set<string>();
    const seenEventOrder: string[] = [];

    function hasAction(action: ChatAllowedAction): boolean {
      return context.value?.allowedActions.includes(action) ?? false;
    }

    function rememberEvent(eventId: string): void {
      seenEventIds.add(eventId);
      seenEventOrder.push(eventId);
      while (seenEventOrder.length > MAX_SEEN_EVENT_IDS) {
        const oldest = seenEventOrder.shift();
        if (oldest) seenEventIds.delete(oldest);
      }
    }

    function clearExpiryTimer(): void {
      if (contextExpiryTimer !== null) {
        clearTimeout(contextExpiryTimer);
        contextExpiryTimer = null;
      }
    }

    function clearSelection(): void {
      selectionEpoch += 1;
      activeRead?.abort();
      activeRead = null;
      selectedSessionId.value = null;
      history.value = null;
      liveAssistantText.value = "";
      liveReasoning.value = Object.freeze([]);
      liveTurnStatus.value = null;
      cleanupStatus.value = null;
      controlPlane.value = null;
      controlPlaneSequence = null;
      deleteDisposition.value = null;
      subscriptionId = null;
      expectedSequence = 0n;
      seenEventIds.clear();
      seenEventOrder.length = 0;
      bufferedEvents = [];
      bufferingEvents = false;
      resyncPromise = null;
    }

    function clearAuthority(nextPhase: ChatViewPhase): void {
      authorityEpoch += 1;
      const oldContext = context.value?.contextId;
      const oldSubscription = subscriptionId;
      clearSelection();
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
      const generation = listenerEpoch;
      const pending = client.onEvent(handleEvent, requestResync)
        .then((unlisten) => {
          if (generation !== listenerEpoch) {
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

    function reasoningKey(itemOrdinal: number, contentIndex: number): string {
      return `${itemOrdinal}:${contentIndex}`;
    }

    function applyEvent(event: ChatProjectionEvent): void {
      if (
        context.value === null ||
        event.contextId !== context.value.contextId ||
        event.subscriptionId !== subscriptionId ||
        event.sessionId !== selectedSessionId.value
      ) {
        return;
      }
      const sequence = BigInt(event.projectionSequence);
      if (sequence <= expectedSequence) {
        if (seenEventIds.has(event.eventId)) return;
        requestResync();
        return;
      }
      if (sequence !== expectedSequence + 1n) {
        requestResync();
        return;
      }
      expectedSequence = sequence;
      rememberEvent(event.eventId);
      switch (event.kind) {
        case "assistant_append": {
          const next = liveAssistantText.value + event.payload.text;
          if (utf8Bytes(next) > MAX_LIVE_ASSISTANT_BYTES) return requestResync();
          liveAssistantText.value = next;
          phase.value = "streaming";
          break;
        }
        case "reasoning_append": {
          const key = reasoningKey(event.payload.itemOrdinal, event.payload.contentIndex);
          const current = new Map(liveReasoning.value.map((part) => [reasoningKey(part.itemOrdinal, part.contentIndex), part]));
          const previous = current.get(key)?.text ?? "";
          current.set(key, Object.freeze({
            itemOrdinal: event.payload.itemOrdinal,
            contentIndex: event.payload.contentIndex,
            text: previous + event.payload.text,
          }));
          const next = [...current.values()].sort((left, right) => left.itemOrdinal - right.itemOrdinal || left.contentIndex - right.contentIndex);
          if (next.reduce((total, part) => total + utf8Bytes(part.text), 0) > MAX_LIVE_REASONING_BYTES) return requestResync();
          liveReasoning.value = Object.freeze(next);
          phase.value = "streaming";
          break;
        }
        case "turn_state":
          liveTurnStatus.value = event.payload.status;
          phase.value = "streaming";
          break;
        case "turn_terminal":
          liveTurnStatus.value = event.payload.status;
          phase.value = "ready";
          break;
        case "cleanup_state":
          void refreshCleanupFromEvent(event);
          break;
        case "resync_required":
          requestResync();
          break;
        case "context_invalidated":
          clearAuthority("resync-required");
          break;
      }
    }

    function handleEvent(event: ChatProjectionEvent): void {
      if (bufferingEvents) {
        bufferedEvents.push(event);
        if (bufferedEvents.length > 64) requestResync();
        return;
      }
      applyEvent(event);
    }

    function requestResync(): void {
      liveAssistantText.value = "";
      liveReasoning.value = Object.freeze([]);
      liveTurnStatus.value = null;
      phase.value = "resync-required";
      void resyncSelected();
    }

    async function refreshCleanupFromEvent(event: ChatProjectionEvent): Promise<void> {
      if (event.kind !== "cleanup_state" || context.value === null) return;
      const operation = event.payload.operationId;
      if (typeof operation !== "string") return requestResync();
      try {
        if (cleanupStatus.value?.operationId !== operation) {
          cleanupStatus.value = await client.getCleanupStatus(context.value.contextId, operation);
        }
        await refreshSelectedCleanup();
      } catch {
        requestResync();
      }
    }

    async function bind(tenantSelector: string): Promise<void> {
      clearAuthority("binding");
      const bindEpoch = authorityEpoch;
      lastErrorCode.value = null;
      try {
        await Promise.all([ensureEventListener(), ensureControlPlaneListener()]);
        if (bindEpoch !== authorityEpoch) return;
        const bound = await client.bindContext(tenantSelector);
        if (bindEpoch !== authorityEpoch) return;
        context.value = bound;
        scheduleContextExpiry(bound);
        phase.value = "loading";
        const [nextProjects, nextSessions, nextReadiness] = await Promise.all([
          client.listProjects(bound.contextId),
          client.listSessions(bound.contextId),
          client.getLocalReadiness(bound.contextId),
        ]);
        if (bindEpoch !== authorityEpoch || context.value?.contextId !== bound.contextId) return;
        projects.value = nextProjects;
        sessions.value = nextSessions.sessions;
        sessionsCursor.value = nextSessions.nextCursor;
        localReadiness.value = nextReadiness;
        phase.value = "ready";
      } catch (error: unknown) {
        if (bindEpoch !== authorityEpoch) return;
        lastErrorCode.value = error instanceof ChatClientError ? error.shape.code : "chat_protocol_error";
        clearAuthority(phaseForError(error));
      }
    }

    async function selectSession(sessionId: string): Promise<void> {
      const bound = context.value;
      if (!bound || !hasAction("read_sessions")) {
        phase.value = "permission-denied";
        return;
      }
      const oldSubscription = subscriptionId;
      const oldSession = selectedSessionId.value;
      clearSelection();
      selectedSessionId.value = sessionId;
      phase.value = "resyncing";
      if (oldSubscription && oldSession) {
        void client.unsubscribeSession(bound.contextId, oldSubscription).catch(() => undefined);
      }
      const { epoch, controller } = startRead();
      bufferingEvents = true;
      try {
        const nextSubscription = await client.subscribeSession(bound.contextId, sessionId);
        if (!isCurrent(epoch, controller, sessionId)) {
          void client.unsubscribeSession(bound.contextId, nextSubscription).catch(() => undefined);
          return;
        }
        subscriptionId = nextSubscription;
        const projection = await client.resyncSession(bound.contextId, sessionId, 20, controller.signal);
        if (!isCurrent(epoch, controller, sessionId) || subscriptionId !== nextSubscription) return;
        applyResync(projection);
        await refreshControlPlane();
        bufferingEvents = false;
        const pending = bufferedEvents;
        bufferedEvents = [];
        for (const event of pending) applyEvent(event);
        activeRead = null;
        if (phase.value === "resyncing") phase.value = "ready";
      } catch (error: unknown) {
        if (!isCurrent(epoch, controller, sessionId)) return;
        bufferingEvents = false;
        bufferedEvents = [];
        activeRead = null;
        lastErrorCode.value = error instanceof ChatClientError ? error.shape.code : "chat_protocol_error";
        phase.value = phaseForError(error);
      }
    }

    async function clearSelectedSession(): Promise<void> {
      const bound = context.value;
      const oldSubscription = subscriptionId;
      clearSelection();
      if (bound && oldSubscription) {
        await client.unsubscribeSession(bound.contextId, oldSubscription).catch(() => false);
      }
      if (context.value !== null) phase.value = "ready";
    }

    function applyResync(projection: ChatResyncProjection): void {
      if (projection.session.sessionId !== selectedSessionId.value) {
        throw new ChatClientError({ schemaVersion: 1, code: "chat_protocol_error", retryable: false, recovery: "resync" });
      }
      history.value = projection.history;
      cleanupStatus.value = projection.cleanup;
      sessions.value = Object.freeze(sessions.value.map((session) =>
        session.sessionId === projection.session.sessionId ? projection.session : session,
      ));
      liveAssistantText.value = "";
      liveReasoning.value = Object.freeze([]);
      liveTurnStatus.value = projection.session.latestTurnStatus;
    }

    async function resyncSelected(): Promise<void> {
      if (resyncPromise !== null) return resyncPromise;
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !subscriptionId) return;
      const { epoch, controller } = startRead();
      phase.value = "resyncing";
      bufferingEvents = true;
      const previousSubscription = subscriptionId;
      const promise = client.unsubscribeSession(bound.contextId, previousSubscription)
        .catch(() => false)
        .then(() => client.subscribeSession(bound.contextId, sessionId))
        .then((nextSubscription) => {
          if (!isCurrent(epoch, controller, sessionId)) {
            void client.unsubscribeSession(bound.contextId, nextSubscription).catch(() => undefined);
            throw new ChatClientError({ schemaVersion: 1, code: "chat_request_cancelled", retryable: false, recovery: "none" });
          }
          subscriptionId = nextSubscription;
          expectedSequence = 0n;
          seenEventIds.clear();
          seenEventOrder.length = 0;
          return client.resyncSession(bound.contextId, sessionId, 20, controller.signal)
            .then((projection) => ({ projection, nextSubscription }));
        })
        .then(({ projection, nextSubscription }) => {
          if (!isCurrent(epoch, controller, sessionId) || subscriptionId !== nextSubscription) return;
          applyResync(projection);
          void refreshControlPlane();
          const pending = bufferedEvents;
          bufferedEvents = [];
          bufferingEvents = false;
          for (const event of pending) applyEvent(event);
          activeRead = null;
          if (phase.value === "resyncing") phase.value = "ready";
        })
        .catch((error: unknown) => {
          if (!isCurrent(epoch, controller, sessionId)) return;
          activeRead = null;
          bufferingEvents = false;
          bufferedEvents = [];
          lastErrorCode.value = error instanceof ChatClientError ? error.shape.code : "chat_protocol_error";
          phase.value = phaseForError(error);
        })
        .finally(() => {
          if (resyncPromise === promise) resyncPromise = null;
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
        const page = await client.loadHistory(bound.contextId, sessionId, cursor, 20, controller.signal);
        if (!isCurrent(epoch, controller, sessionId)) return;
        const known = new Set(history.value?.turns.map((turn) => turn.turnId));
        history.value = Object.freeze({
          turns: Object.freeze([...(history.value?.turns ?? []), ...page.turns.filter((turn) => !known.has(turn.turnId))]),
          nextCursor: page.nextCursor,
        });
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
        const page = await client.loadHistory(bound.contextId, sessionId, undefined, limit);
        if (!page.nextCursor) return { page, cursorMonotonic: true, pagesDisjoint: true };
        const next = await client.loadHistory(bound.contextId, sessionId, page.nextCursor, limit);
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

    async function createSession(projectId: string, input: string): Promise<string | null> {
      const bound = context.value;
      if (!bound || !canSend.value || !hasAction("create_session") || !hasAction("use_project")) return null;
      const created = await client.createSession(bound.contextId, projectId, input, operationId());
      await reloadSessions();
      await selectSession(created.sessionId);
      return created.sessionId;
    }

    async function submitTurn(input: string): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !canSend.value || !hasAction("submit_turn")) return;
      await client.submitTurn(bound.contextId, sessionId, input, operationId());
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
      await reloadSessions();
    }

    async function setSelectedPinned(pinned: boolean): Promise<void> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !hasAction("pin_session")) return;
      await client.setSessionPinned(bound.contextId, sessionId, pinned, operationId());
      await reloadSessions();
    }

    async function interruptSelected(): Promise<boolean> {
      const bound = context.value;
      const sessionId = selectedSessionId.value;
      if (!bound || !sessionId || !hasAction("interrupt_turn")) return false;
      await client.interruptTurn(bound.contextId, sessionId, operationId());
      return true;
    }

    function cleanupIsComplete(status: ChatCleanupStatus): boolean {
      return status.desktopState === "complete" && status.hostState === "complete" && status.runtimeState === "complete";
    }

    async function finishCompletedCleanup(
      bound: BoundChatContext,
      deletedSessionId: string,
      status: ChatCleanupStatus,
    ): Promise<DeleteDisposition> {
      const oldSubscription = subscriptionId;
      if (oldSubscription) {
        await client.unsubscribeSession(bound.contextId, oldSubscription).catch(() => false);
      }
      clearSelection();
      const [nextProjects, nextSessions] = await Promise.all([
        client.listProjects(bound.contextId),
        client.listSessions(bound.contextId),
      ]);
      if (context.value?.contextId !== bound.contextId) {
        return Object.freeze({ kind: "navigate", nextSessionId: null, path: "/chat" });
      }
      projects.value = nextProjects;
      sessions.value = Object.freeze(nextSessions.sessions.filter((session) => session.sessionId !== deletedSessionId));
      sessionsCursor.value = nextSessions.nextCursor;
      cleanupStatus.value = status;
      const nextSessionId = sessions.value[0]?.sessionId ?? null;
      const disposition: DeleteDisposition = Object.freeze({
        kind: "navigate",
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
      cleanupStatus.value = status;
      if (cleanupIsComplete(status)) return finishCompletedCleanup(bound, sessionId, status);
      const disposition: DeleteDisposition = Object.freeze({
        kind: "cleanup_pending",
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
      return deleteDisposition.value;
    }

    async function pickProject(): Promise<ChatProject | null> {
      const bound = context.value;
      if (!bound || !hasAction("use_project")) return null;
      const selected = await client.pickProject(bound.contextId, operationId());
      if (context.value?.contextId !== bound.contextId) return null;
      projects.value = await client.listProjects(bound.contextId);
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
      projects.value = await client.listProjects(bound.contextId);
    }

    async function removeProject(projectId: string): Promise<void> {
      const bound = context.value;
      if (!bound || !hasAction("remove_project")) return;
      await client.removeProject(bound.contextId, projectId, operationId());
      projects.value = await client.listProjects(bound.contextId);
      await reloadSessions();
    }

    function clearForLogout(): void {
      clearAuthority("signed-out");
    }

    async function dispose(): Promise<void> {
      clearAuthority("idle");
      listenerEpoch += 1;
      eventUnlisten?.();
      eventUnlisten = null;
      controlPlaneUnlisten?.();
      controlPlaneUnlisten = null;
    }

    return {
      phase,
      context,
      projects,
      sessions,
      sessionsCursor,
      selectedSessionId,
      history,
      liveAssistantText,
      liveReasoning,
      liveTurnStatus,
      cleanupStatus,
      controlPlane,
      localReadiness,
      deleteDisposition,
      lastErrorCode,
      isReady,
      canSend,
      hasAction,
      bind,
      selectSession,
      clearSelectedSession,
      resyncSelected,
      loadOlderHistory,
      loadHistoryPage,
      loadReasoning,
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
      dispose,
    };
  });
}

export const useChatStore = createChatStoreDefinition(chatClient);
