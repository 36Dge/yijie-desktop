import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL,
  CHAT_EVENT_CHANNEL,
  CHAT_CONTROL_PLANE_EVENT_CHANNEL,
  CHAT_IPC_SCHEMA_VERSION,
  CHAT_IPC_V2_SCHEMA_VERSION,
  CHAT_IPC_V3_SCHEMA_VERSION,
  ChatClientError,
  ChatContractError,
  parseBoundContextResponse,
  parseAttachmentListResponse,
  parseAttachmentImportEvent,
  parseCancelledResponse,
  parseChatIpcError,
  parseChatProjectionEvent,
  parseCleanupResponse,
  parseControlPlaneEvent,
  parseCreatedTurnResponse,
  parseCreatedTurnResponseV2,
  parseHistoryPageResponse,
  parseHistoryPageResponseV2,
  parseHistoryPageResponseV3,
  parseLocalReadinessResponse,
  parseOperationResponse,
  parseOperationResponseV2,
  parseOptionalCleanupResponse,
  parseOptionalProjectResponse,
  parseProjectListResponse,
  parseProjectResponse,
  parseReasoningResponse,
  parseResyncResponse,
  parseResyncResponseV2,
  parseSessionPageResponse,
  parseSessionControlPlaneResponse,
  parseSubscriptionResponse,
  type BoundChatContext,
  type ChatAttachment,
  type ChatAttachmentImportEvent,
  type ChatCleanupStatus,
  type ChatControlPlaneEvent,
  type ChatCreatedTurn,
  type ChatDraftTarget,
  type ChatHistoryPage,
  type ChatLocalReadiness,
  type ChatProjectionEvent,
  type ChatProject,
  type ChatReasoningItem,
  type ChatResyncProjection,
  type ChatSessionPage,
  type ChatSessionControlPlane,
  type ChatTurnContentBlock,
} from "../domain/chat-ipc";

type InvokeFn = (command: string, arguments_?: Record<string, unknown>) => Promise<unknown>;
type ListenFn = (
  channel: string,
  handler: (payload: unknown) => void,
) => Promise<UnlistenFn>;

export interface ChatClientTransport {
  readonly invoke: InvokeFn;
  readonly listen: ListenFn;
}

export interface ChatClient {
  bindContext(tenantSelector: string): Promise<BoundChatContext>;
  listProjects(contextId: string, signal?: AbortSignal): Promise<readonly ChatProject[]>;
  pickProject(contextId: string, operationId: string): Promise<ChatProject | null>;
  revalidateProject(contextId: string, projectId: string, operationId: string): Promise<ChatProject>;
  setProjectPinned(contextId: string, projectId: string, pinned: boolean, operationId: string): Promise<string>;
  removeProject(contextId: string, projectId: string, operationId: string): Promise<string>;
  createSession(contextId: string, projectId: string, input: string, operationId: string): Promise<ChatCreatedTurn>;
  submitTurn(contextId: string, sessionId: string, input: string, operationId: string): Promise<ChatCreatedTurn>;
  pickAttachments(contextId: string, draftTarget: ChatDraftTarget, remainingCapacity: number, operationId: string): Promise<readonly ChatAttachment[]>;
  importAttachments(contextId: string, draftTarget: ChatDraftTarget, paths: readonly string[], remainingCapacity: number, operationId: string): Promise<readonly ChatAttachment[]>;
  listDraftAttachments(contextId: string, draftTarget: ChatDraftTarget, signal?: AbortSignal): Promise<readonly ChatAttachment[]>;
  removeAttachment(contextId: string, draftTarget: ChatDraftTarget, attachmentId: string, operationId: string): Promise<string>;
  createSessionV2(
    contextId: string,
    projectId: string,
    contentBlocks: readonly ChatTurnContentBlock[],
    operationId: string,
  ): Promise<ChatCreatedTurn>;
  submitTurnV2(
    contextId: string,
    sessionId: string,
    contentBlocks: readonly ChatTurnContentBlock[],
    operationId: string,
  ): Promise<ChatCreatedTurn>;
  listSessions(contextId: string, cursor?: string, limit?: number, signal?: AbortSignal): Promise<ChatSessionPage>;
  loadHistory(contextId: string, sessionId: string, cursor?: string, limit?: number, signal?: AbortSignal): Promise<ChatHistoryPage>;
  loadHistoryV2(contextId: string, sessionId: string, cursor?: string, limit?: number, signal?: AbortSignal): Promise<ChatHistoryPage>;
  loadHistoryV3(contextId: string, sessionId: string, cursor?: string, limit?: number, signal?: AbortSignal): Promise<ChatHistoryPage>;
  loadReasoning(contextId: string, turnId: string, signal?: AbortSignal): Promise<readonly ChatReasoningItem[]>;
  renameSession(contextId: string, sessionId: string, title: string, operationId: string): Promise<string>;
  setSessionPinned(contextId: string, sessionId: string, pinned: boolean, operationId: string): Promise<string>;
  interruptTurn(contextId: string, sessionId: string, operationId: string): Promise<ChatCreatedTurn>;
  deleteSession(contextId: string, sessionId: string, operationId: string): Promise<ChatCleanupStatus>;
  getCleanupStatus(contextId: string, operationId: string, signal?: AbortSignal): Promise<ChatCleanupStatus | null>;
  getSessionControlPlane(contextId: string, sessionId: string, signal?: AbortSignal): Promise<ChatSessionControlPlane>;
  getLocalReadiness(contextId: string, signal?: AbortSignal): Promise<ChatLocalReadiness>;
  requestLocalRecovery(contextId: string, operationId: string): Promise<ChatLocalReadiness>;
  subscribeSession(contextId: string, sessionId: string): Promise<string>;
  resyncSession(contextId: string, sessionId: string, limit?: number, signal?: AbortSignal): Promise<ChatResyncProjection>;
  resyncSessionV2(contextId: string, sessionId: string, limit?: number, signal?: AbortSignal): Promise<ChatResyncProjection>;
  unsubscribeSession(contextId: string, subscriptionId: string): Promise<boolean>;
  cancelRequest(contextId: string, targetRequestId: string): Promise<boolean>;
  onEvent(
    handler: (event: ChatProjectionEvent) => void,
    onInvalid?: () => void,
  ): Promise<UnlistenFn>;
  onControlPlaneEvent(
    handler: (event: ChatControlPlaneEvent) => void,
    onInvalid?: () => void,
  ): Promise<UnlistenFn>;
  onAttachmentImportEvent(
    handler: (event: ChatAttachmentImportEvent) => void,
    onInvalid?: () => void,
  ): Promise<UnlistenFn>;
}

const productionTransport: ChatClientTransport = {
  invoke: (command, arguments_) => invoke<unknown>(command, arguments_),
  listen: (channel, handler) => listen<unknown>(channel, (event) => handler(event.payload)),
};

function requestId(): string {
  return crypto.randomUUID().toLowerCase();
}

function operationEnvelope(contextId: string, payload: Record<string, unknown>, id = requestId()) {
  const compactPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
  return {
    id,
    request: {
      schemaVersion: CHAT_IPC_SCHEMA_VERSION,
      requestId: id,
      contextId,
      payload: compactPayload,
    },
  };
}

function operationEnvelopeV2(contextId: string, payload: Record<string, unknown>, id = requestId()) {
  const compactPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
  return {
    id,
    request: {
      schemaVersion: CHAT_IPC_V2_SCHEMA_VERSION,
      requestId: id,
      contextId,
      payload: compactPayload,
    },
  };
}

function operationEnvelopeV3(contextId: string, payload: Record<string, unknown>, id = requestId()) {
  const compactPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
  return {
    id,
    request: {
      schemaVersion: CHAT_IPC_V3_SCHEMA_VERSION,
      requestId: id,
      contextId,
      payload: compactPayload,
    },
  };
}

function mapFailure(error: unknown): never {
  if (error instanceof ChatClientError) throw error;
  try {
    throw new ChatClientError(parseChatIpcError(error));
  } catch (contractError: unknown) {
    if (contractError instanceof ChatClientError) throw contractError;
    throw new ChatClientError({
      schemaVersion: 1,
      code: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    });
  }
}

export function createChatClient(transport: ChatClientTransport = productionTransport): ChatClient {
  async function run<T>(command: string, request: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
    try {
      return parse(await transport.invoke(command, { request }));
    } catch (error: unknown) {
      mapFailure(error);
    }
  }

  async function runRead<T>(
    command: string,
    contextId: string,
    payload: Record<string, unknown>,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const envelope = operationEnvelope(contextId, payload);
    if (signal?.aborted) {
      throw new ChatClientError({ schemaVersion: 1, code: "chat_request_cancelled", retryable: false, recovery: "none" });
    }
    let abortHandler: (() => void) | undefined;
    if (signal) {
      abortHandler = () => {
        const cancellation = operationEnvelope(contextId, { targetRequestId: envelope.id });
        void transport.invoke("chat_cancel_request_v1", { request: cancellation.request });
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    try {
      const value = await run(command, envelope.request, parse);
      if (signal?.aborted) {
        throw new ChatClientError({ schemaVersion: 1, code: "chat_request_cancelled", retryable: false, recovery: "none" });
      }
      return value;
    } finally {
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    }
  }

  async function runReadV2<T>(
    command: string,
    contextId: string,
    payload: Record<string, unknown>,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const envelope = operationEnvelopeV2(contextId, payload);
    if (signal?.aborted) {
      throw new ChatClientError({ schemaVersion: 2, code: "chat_request_cancelled", retryable: false, recovery: "none" });
    }
    let abortHandler: (() => void) | undefined;
    if (signal) {
      abortHandler = () => {
        const cancellation = operationEnvelope(contextId, { targetRequestId: envelope.id });
        void transport.invoke("chat_cancel_request_v1", { request: cancellation.request });
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    try {
      const value = await run(command, envelope.request, parse);
      if (signal?.aborted) {
        throw new ChatClientError({ schemaVersion: 2, code: "chat_request_cancelled", retryable: false, recovery: "none" });
      }
      return value;
    } finally {
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    }
  }

  async function runReadV3<T>(
    command: string,
    contextId: string,
    payload: Record<string, unknown>,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const envelope = operationEnvelopeV3(contextId, payload);
    if (signal?.aborted) {
      throw new ChatClientError({ schemaVersion: 3, code: "chat_request_cancelled", retryable: false, recovery: "none" });
    }
    let abortHandler: (() => void) | undefined;
    if (signal) {
      abortHandler = () => {
        const cancellation = operationEnvelope(contextId, { targetRequestId: envelope.id });
        void transport.invoke("chat_cancel_request_v1", { request: cancellation.request });
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    try {
      const value = await run(command, envelope.request, parse);
      if (signal?.aborted) {
        throw new ChatClientError({ schemaVersion: 3, code: "chat_request_cancelled", retryable: false, recovery: "none" });
      }
      return value;
    } finally {
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    }
  }

  return {
    bindContext(tenantSelector) {
      const id = requestId();
      return run(
        "chat_bind_context_v1",
        { schemaVersion: 1, requestId: id, payload: { tenantSelector } },
        parseBoundContextResponse,
      );
    },
    listProjects: (contextId, signal) => runRead("chat_list_projects_v1", contextId, {}, parseProjectListResponse, signal),
    pickProject(contextId, operationId) {
      const envelope = operationEnvelope(contextId, { operationId });
      return run("chat_pick_project_v1", envelope.request, parseOptionalProjectResponse);
    },
    revalidateProject(contextId, projectId, operationId) {
      const envelope = operationEnvelope(contextId, { projectId, operationId });
      return run("chat_revalidate_project_v1", envelope.request, parseProjectResponse);
    },
    setProjectPinned(contextId, projectId, pinned, operationId) {
      const envelope = operationEnvelope(contextId, { projectId, pinned, operationId });
      return run("chat_set_project_pinned_v1", envelope.request, parseOperationResponse);
    },
    removeProject(contextId, projectId, operationId) {
      const envelope = operationEnvelope(contextId, { projectId, operationId });
      return run("chat_remove_project_v1", envelope.request, parseOperationResponse);
    },
    createSession(contextId, projectId, input, operationId) {
      const envelope = operationEnvelope(contextId, { projectId, input, operationId });
      return run("chat_create_session_v1", envelope.request, parseCreatedTurnResponse);
    },
    submitTurn(contextId, sessionId, input, operationId) {
      const envelope = operationEnvelope(contextId, { sessionId, input, operationId });
      return run("chat_submit_turn_v1", envelope.request, parseCreatedTurnResponse);
    },
    pickAttachments(contextId, draftTarget, remainingCapacity, operationId) {
      const envelope = operationEnvelopeV2(contextId, { draftTarget, operationId, remainingCapacity });
      return run("chat_pick_attachments_v2", envelope.request, parseAttachmentListResponse);
    },
    importAttachments(contextId, draftTarget, paths, remainingCapacity, operationId) {
      const envelope = operationEnvelopeV2(contextId, { paths: [...paths], draftTarget, operationId, remainingCapacity });
      return run("chat_import_attachments_v2", envelope.request, parseAttachmentListResponse);
    },
    listDraftAttachments: (contextId, draftTarget, signal) =>
      runReadV2(
        "chat_list_draft_attachments_v2",
        contextId,
        { draftTarget },
        parseAttachmentListResponse,
        signal,
      ),
    removeAttachment(contextId, draftTarget, attachmentId, operationId) {
      const envelope = operationEnvelopeV2(contextId, { attachmentId, draftTarget, operationId });
      return run("chat_remove_attachment_v2", envelope.request, parseOperationResponseV2);
    },
    createSessionV2(contextId, projectId, contentBlocks, operationId) {
      const envelope = operationEnvelopeV2(contextId, { projectId, contentBlocks, operationId });
      return run("chat_create_session_v2", envelope.request, parseCreatedTurnResponseV2);
    },
    submitTurnV2(contextId, sessionId, contentBlocks, operationId) {
      const envelope = operationEnvelopeV2(contextId, { sessionId, contentBlocks, operationId });
      return run("chat_submit_turn_v2", envelope.request, parseCreatedTurnResponseV2);
    },
    listSessions: (contextId, cursor, limit, signal) =>
      runRead("chat_list_sessions_v1", contextId, { cursor, limit }, parseSessionPageResponse, signal),
    loadHistory: (contextId, sessionId, cursor, limit, signal) =>
      runRead("chat_load_history_v1", contextId, { sessionId, cursor, limit }, parseHistoryPageResponse, signal),
    loadHistoryV2: (contextId, sessionId, cursor, limit, signal) =>
      runReadV2("chat_load_history_v2", contextId, { sessionId, cursor, limit }, parseHistoryPageResponseV2, signal),
    loadHistoryV3: (contextId, sessionId, cursor, limit, signal) =>
      runReadV3("chat_load_history_v3", contextId, { sessionId, cursor, limit }, parseHistoryPageResponseV3, signal),
    loadReasoning: (contextId, turnId, signal) =>
      runRead("chat_load_reasoning_v1", contextId, { turnId }, parseReasoningResponse, signal),
    renameSession(contextId, sessionId, title, operationId) {
      const envelope = operationEnvelope(contextId, { sessionId, title, operationId });
      return run("chat_rename_session_v1", envelope.request, parseOperationResponse);
    },
    setSessionPinned(contextId, sessionId, pinned, operationId) {
      const envelope = operationEnvelope(contextId, { sessionId, pinned, operationId });
      return run("chat_set_session_pinned_v1", envelope.request, parseOperationResponse);
    },
    interruptTurn(contextId, sessionId, operationId) {
      const envelope = operationEnvelope(contextId, { sessionId, operationId });
      return run("chat_interrupt_turn_v1", envelope.request, parseCreatedTurnResponse);
    },
    deleteSession(contextId, sessionId, operationId) {
      const envelope = operationEnvelope(contextId, { sessionId, operationId });
      return run("chat_delete_session_v1", envelope.request, parseCleanupResponse);
    },
    getCleanupStatus: (contextId, operationId, signal) =>
      runRead("chat_get_cleanup_status_v1", contextId, { operationId }, parseOptionalCleanupResponse, signal),
    getSessionControlPlane: (contextId, sessionId, signal) =>
      runRead(
        "chat_get_session_control_plane_v1",
        contextId,
        { sessionId },
        parseSessionControlPlaneResponse,
        signal,
      ),
    getLocalReadiness: (contextId, signal) =>
      runRead("chat_get_local_readiness_v1", contextId, {}, parseLocalReadinessResponse, signal),
    requestLocalRecovery(contextId, operationId) {
      const envelope = operationEnvelope(contextId, { operationId, intent: "start_or_retry" });
      return run("chat_request_local_recovery_v1", envelope.request, parseLocalReadinessResponse);
    },
    subscribeSession(contextId, sessionId) {
      const envelope = operationEnvelope(contextId, { sessionId });
      return run("chat_subscribe_session_v1", envelope.request, parseSubscriptionResponse);
    },
    resyncSession: (contextId, sessionId, limit, signal) =>
      runRead("chat_resync_session_v1", contextId, { sessionId, cursor: undefined, limit }, parseResyncResponse, signal),
    resyncSessionV2: (contextId, sessionId, limit, signal) =>
      runReadV2("chat_resync_session_v2", contextId, { sessionId, cursor: undefined, limit }, parseResyncResponseV2, signal),
    unsubscribeSession(contextId, subscriptionId) {
      const envelope = operationEnvelope(contextId, { subscriptionId });
      return run("chat_unsubscribe_session_v1", envelope.request, parseCancelledResponse);
    },
    cancelRequest(contextId, targetRequestId) {
      const envelope = operationEnvelope(contextId, { targetRequestId });
      return run("chat_cancel_request_v1", envelope.request, parseCancelledResponse);
    },
    async onEvent(handler, onInvalid) {
      return transport.listen(CHAT_EVENT_CHANNEL, (payload) => {
        try {
          handler(parseChatProjectionEvent(payload));
        } catch (error: unknown) {
          if (!(error instanceof ChatContractError)) throw error;
          onInvalid?.();
        }
      });
    },
    async onControlPlaneEvent(handler, onInvalid) {
      return transport.listen(CHAT_CONTROL_PLANE_EVENT_CHANNEL, (payload) => {
        try {
          handler(parseControlPlaneEvent(payload));
        } catch (error: unknown) {
          if (!(error instanceof ChatContractError)) throw error;
          onInvalid?.();
        }
      });
    },
    async onAttachmentImportEvent(handler, onInvalid) {
      return transport.listen(CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL, (payload) => {
        try {
          handler(parseAttachmentImportEvent(payload));
        } catch (error: unknown) {
          if (!(error instanceof ChatContractError)) throw error;
          onInvalid?.();
        }
      });
    },
  };
}

export const chatClient = createChatClient();
