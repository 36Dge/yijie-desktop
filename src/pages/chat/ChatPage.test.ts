// @vitest-environment happy-dom

import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_NEW_DRAFT_TARGET,
  ChatClientError,
  chatSessionDraftTarget,
  type ChatAttachment,
  type ChatAttachmentImportEvent,
  type ChatHistoryPage,
  type ChatProject,
  type ChatSession,
} from "../../domain/chat-ipc";
import {
  createConversationState,
  hydrateConversationState,
  reconcileConversationSnapshot,
} from "../../domain/conversation-state";
import { hydrateConversationApprovalState } from "../../domain/conversation-approval";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import { historyPageToConversationSnapshot } from "../../api/chat-conversation-adapter";
import {
  useChatStore,
  type ChatSubmissionResult,
} from "../../stores/chat.store";
import { useArtifactStore } from "../../stores/artifact.store";
import ChatArtifactList from "../../components/chat/ChatArtifactList.vue";
import ChatTimeline from "../../components/chat/ChatTimeline.vue";
import ChatComposer from "../../components/chat/ChatComposer.vue";
import { chatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import { chatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import { chatArtifactFileNativeClient } from "../../api/chat-artifact-file-native-client";
import { chatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
import { LEGACY_CHAT_TIMELINE_ROLLBACK_KEY } from "../../authorization/chat-timeline-ui-config";
import ChatPage from "./ChatPage.vue";

type MockDragDropPayload =
  | { type: "enter" | "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "leave" };

const dragDropMock = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: MockDragDropPayload }) => void),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: async (handler: typeof dragDropMock.handler) => {
      dragDropMock.handler = handler;
      return dragDropMock.unlisten;
    },
  }),
}));

const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";
const TURN_ID = "019c1a00-0000-7000-8000-000000000003";

function acceptedSubmission(
  sessionId = SESSION_ID,
  draftTarget = CHAT_NEW_DRAFT_TARGET,
  turnId = TURN_ID,
): ChatSubmissionResult {
  return Object.freeze({
    status: "local_durable_accepted",
    draftTarget,
    sessionId,
    turnId,
    operationId: "019c1a00-0000-7000-8000-000000000020",
  });
}

const PROJECT: ChatProject = {
  projectId: PROJECT_ID,
  safeName: "Synthetic Workspace",
  pinnedAt: null,
  lastUsedAt: 1,
  available: true,
};

const SECOND_PROJECT: ChatProject = {
  projectId: "019c1a00-0000-7000-8000-000000000009",
  safeName: "Second Synthetic Workspace",
  pinnedAt: null,
  lastUsedAt: 2,
  available: true,
};

const SESSION: ChatSession = {
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  title: "本地合成任务",
  titleSource: "fallback",
  pinnedAt: null,
  lastActivityAt: 3,
  latestTurnStatus: "completed",
  projectAvailable: true,
};

const READY_ATTACHMENT: ChatAttachment = {
  attachmentId: "019c1a00-0000-7000-8000-000000000010",
  type: "file",
  name: "synthetic-brief.pdf",
  mediaType: "application/pdf",
  sizeBytes: 4096,
  status: "ready",
  expiresAt: 2_000_000_000,
};

const HISTORY: ChatHistoryPage = {
  turns: [{
    turnId: TURN_ID,
    status: "completed",
    terminalAt: 3,
    reasoningStatus: "complete",
    reasoningReasonCode: null,
    messages: [
      {
        messageId: "019c1a00-0000-7000-8000-000000000004",
        role: "user",
        content: "检查标题",
        contentBlocks: [
          { type: "text", text: "检查标题" },
          { ...READY_ATTACHMENT, status: "bound" },
        ],
        status: "complete",
        ordinal: 1,
        createdAt: 1,
      },
      { messageId: "019c1a00-0000-7000-8000-000000000005", role: "assistant", content: "标题检查完成", status: "complete", ordinal: 2, createdAt: 2 },
    ],
    reasoning: [{ itemOrdinal: 0, status: "complete", reasonCode: null, totalBytes: 12, partCount: 1, finalizedAtMs: 2 }],
  }],
  nextCursor: null,
};

const HISTORY_WITHOUT_REASONING: ChatHistoryPage = Object.freeze({
  turns: Object.freeze([Object.freeze({
    ...HISTORY.turns[0],
    reasoning: Object.freeze([]),
  })]),
  nextCursor: null,
});

function setHistoryProjection(
  store: ReturnType<typeof useChatStore>,
  history: ChatHistoryPage,
): void {
  store.history = history;
  store.conversationState = reconcileConversationSnapshot(
    createConversationState(),
    historyPageToConversationSnapshot(SESSION_ID, history),
  );
}

function historyWithAcceptedTurn(
  turnId: string,
  status: "queued" | "failed" | "interrupted",
  input: string,
): ChatHistoryPage {
  return Object.freeze({
    turns: Object.freeze([
      ...HISTORY.turns,
      Object.freeze({
        turnId,
        status,
        terminalAt: status === "queued" ? null : 4,
        reasoningStatus: status === "queued" ? "pending" : "unavailable",
        reasoningReasonCode: status === "interrupted" ? "turn_interrupted" : null,
        messages: Object.freeze([Object.freeze({
          messageId: "019c1a00-0000-7000-8000-000000000021",
          role: "user" as const,
          content: input,
          contentBlocks: Object.freeze([
            Object.freeze({ type: "text" as const, text: input }),
            Object.freeze({ ...READY_ATTACHMENT, status: "bound" as const }),
          ]),
          status: "committed",
          ordinal: 0,
          createdAt: 4,
        })]),
        reasoning: Object.freeze([]),
        artifacts: Object.freeze([]),
      }),
    ]),
    nextCursor: null,
  });
}

async function mountPage(
  path: string,
  active = false,
  activeHistory: ChatHistoryPage = HISTORY,
  legacyTimelineRollback = false,
) {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useChatStore(pinia);
  store.phase = active ? "ready" : "ready";
  store.context = {
    contextId: "019c1a00-0000-7000-8000-000000000006",
    expiresAtEpochSeconds: 2_000_000_000,
    allowedActions: [
      "read_sessions", "create_session", "submit_turn", "rename_session", "pin_session",
      "interrupt_turn", "delete_session", "read_projects", "use_project", "pin_project",
      "remove_project", "read_cleanup",
    ],
  };
  store.projects = [PROJECT];
  store.sessions = active ? [SESSION] : [];
  store.selectedSessionId = active ? SESSION_ID : null;
  store.draftTarget = active ? chatSessionDraftTarget(SESSION_ID) : CHAT_NEW_DRAFT_TARGET;
  store.draftTargetReady = true;
  if (active) setHistoryProjection(store, activeHistory);
  else store.history = null;
  store.localReadiness = {
    lifecycle: "ready", host: "ready", runtime: "ready", storage: "ready",
    canSend: true, issueCode: null, retryable: false, recovery: "none",
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: ChatPage },
      { path: "/chat/:sessionId", component: ChatPage },
      { path: "/settings", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(ChatPage, {
    attachTo: document.body,
    global: {
      plugins: [pinia, router],
      provide: { [LEGACY_CHAT_TIMELINE_ROLLBACK_KEY as symbol]: legacyTimelineRollback },
    },
  });
  await flushPromises();
  return { wrapper, store, router, pinia };
}

afterEach(() => {
  dragDropMock.handler = null;
  dragDropMock.unlisten.mockClear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FEAT-126 ChatPage", () => {
  it("keeps the last committed conversation visible while metadata resyncs", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);

    store.phase = "resyncing";
    await flushPromises();

    expect(wrapper.text()).toContain("标题检查完成");
    expect(wrapper.text()).not.toContain("正在读取本地对话");

    store.history = null;
    await flushPromises();
    expect(wrapper.text()).toContain("标题检查完成");
    expect(wrapper.text()).not.toContain("正在读取本地对话");
  });

  it("uses the FEAT-132 Timeline exclusively when the projection is complete", async () => {
    const writeText = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { wrapper } = await mountPage(
      `/chat/${SESSION_ID}`,
      true,
      HISTORY_WITHOUT_REASONING,
    );

    expect(wrapper.findComponent(ChatTimeline).exists()).toBe(true);
    expect(wrapper.find(".chat-turn").exists()).toBe(false);
    expect(wrapper.text()).toContain("检查标题");
    expect(wrapper.text()).toContain("标题检查完成");
    expect(wrapper.findAll(".chat-message__attachment")).toHaveLength(1);
    expect(wrapper.text()).toContain("synthetic-brief.pdf");
    expect(wrapper.text()).toContain("文件 · 4 KB");

    const textCopyActions = wrapper.findAll('[aria-label="复制文本"]');
    expect(textCopyActions).toHaveLength(2);
    await textCopyActions[1]!.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("标题检查完成");
    expect(wrapper.text()).toContain("已复制");
  });

  it("projects approval lifecycle, keeps the exact gate closed, and wires only typed decisions", async () => {
    const { wrapper, store } = await mountPage(
      `/chat/${SESSION_ID}`,
      true,
      HISTORY_WITHOUT_REASONING,
    );
    const source = Object.freeze({
      sourceEventId: "13700000-0000-4000-8000-000000000041",
      sourceSequence: "41",
      sourceOccurredAt: "2026-08-30T14:28:00Z",
    });
    store.conversationState = hydrateConversationState({
      threads: [{ threadId: SESSION_ID, status: "active" }],
      turns: [{
        threadId: SESSION_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "in_progress",
        terminalStatus: null,
      }],
      items: [{
        threadId: SESSION_ID,
        turnId: TURN_ID,
        itemId: "command-feat-137-page",
        ordinal: 1,
        kind: "command",
        status: "streaming",
        execution: {
          kind: "command",
          status: "running",
          startedSource: source,
          lastSource: source,
          commandSummary: {
            text: "Inspect repository status",
            truncated: false,
            truncationReason: null,
          },
          cwd: { kind: "workspace_root", segments: [] },
          liveOutput: null,
          output: null,
          durationMs: null,
          exitCode: null,
          error: null,
        },
        contentBlocks: [],
      }],
    });
    store.conversationApprovalState = hydrateConversationApprovalState({
      schemaVersion: 1,
      approvals: [{
        approvalRequestId: "13700000-0000-4000-8000-000000000042",
        threadId: SESSION_ID,
        turnId: TURN_ID,
        itemId: "command-feat-137-page",
        revision: 1,
        status: "pending",
        actionId: "git_repository_check",
        workspaceScope: "current_workspace",
        decisions: { primary: "accept_once", secondary: "cancel_current_turn" },
        requestedAt: "2026-08-30T14:28:00Z",
        expiresAt: "2026-08-30T14:30:00Z",
        resolvedAt: null,
        decisionId: null,
        decision: null,
        outcome: null,
        source,
      }],
    });
    await flushPromises();

    const timeline = wrapper.getComponent(ChatTimeline);
    expect(timeline.props("canDecideApprovals")).toBe(false);
    expect(timeline.props("timeline").turns[0]?.items[0]?.approval).toMatchObject({
      approvalRequestId: "13700000-0000-4000-8000-000000000042",
      authority: "historical",
    });
    expect(wrapper.get(".chat-approval-card__status").text()).toContain("连接已中断");
    expect(wrapper.findAll(".chat-approval-card__button")
      .every((button) => button.attributes("disabled") !== undefined)).toBe(true);

    const decideApproval = vi.spyOn(store, "decideApproval").mockResolvedValue("ignored");
    timeline.vm.$emit("approval-decision", {
      itemIdentity: "timeline-command-feat-137-page",
      threadId: SESSION_ID,
      turnId: TURN_ID,
      itemId: "command-feat-137-page",
      approvalRequestId: "13700000-0000-4000-8000-000000000042",
      decision: "accept_once",
    });
    await flushPromises();
    expect(decideApproval).toHaveBeenCalledOnce();
    expect(decideApproval).toHaveBeenCalledWith({
      itemIdentity: "timeline-command-feat-137-page",
      threadId: SESSION_ID,
      turnId: TURN_ID,
      itemId: "command-feat-137-page",
      approvalRequestId: "13700000-0000-4000-8000-000000000042",
      decision: "accept_once",
    });
  });

  it("publishes a streaming burst and follows new content at most once per frame", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextHandle = 1;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((handle: number) => {
      callbacks.delete(handle);
    }));
    const { wrapper, store } = await mountPage(
      `/chat/${SESSION_ID}`,
      true,
      HISTORY_WITHOUT_REASONING,
    );
    const scroller = wrapper.get<HTMLElement>(".chat-workspace__conversation").element;
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "scrollTo", { configurable: true, value: scrollTo });

    store.phase = "streaming";
    for (let revision = 1; revision <= 100; revision += 1) {
      store.conversationState = {
        ...store.conversationState,
        diagnostics: Object.freeze(Array.from(
          { length: Math.min(revision, 64) },
          () => Object.freeze({ code: "unsupported_event" as const }),
        )),
      };
    }
    await flushPromises();

    expect(callbacks.size).toBe(1);
    expect(scrollTo).not.toHaveBeenCalled();
    const frameCallbacks = [...callbacks.values()];
    callbacks.clear();
    frameCallbacks.forEach((callback) => callback(16));
    await flushPromises();
    await flushPromises();

    expect(scrollTo).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("标题检查完成");
  });

  it("replaces a queued presentation frame when the selected session changes", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextHandle = 1;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((handle: number) => {
      callbacks.delete(handle);
    }));
    const { wrapper, store } = await mountPage(
      `/chat/${SESSION_ID}`,
      true,
      HISTORY_WITHOUT_REASONING,
    );
    const secondSessionId = "019c1a00-0000-7000-8000-000000000020";
    const secondTurnId = "019c1a00-0000-7000-8000-000000000021";
    store.phase = "streaming";
    store.conversationState = { ...store.conversationState };
    expect(callbacks.size).toBe(1);

    store.sessions = [SESSION, {
      ...SESSION,
      sessionId: secondSessionId,
      title: "第二个本地任务",
    }];
    store.conversationState = hydrateConversationState({
      threads: [
        { threadId: SESSION_ID, status: "ready" },
        { threadId: secondSessionId, status: "ready" },
      ],
      turns: [{
        threadId: secondSessionId,
        turnId: secondTurnId,
        ordinal: 0,
        status: "completed",
        terminalStatus: "completed",
      }],
      items: [{
        threadId: secondSessionId,
        turnId: secondTurnId,
        itemId: "second-final",
        ordinal: 1,
        kind: "assistant_message",
        status: "completed",
        agentMessagePhase: "final_answer",
        contentBlocks: [{ blockIndex: 0, type: "text", text: "第二个会话的回答" }],
      }],
    });
    store.selectedSessionId = secondSessionId;
    await flushPromises();

    expect(callbacks.size).toBe(0);
    expect(wrapper.text()).toContain("第二个本地任务");
    expect(wrapper.text()).toContain("第二个会话的回答");
    expect(wrapper.text()).not.toContain("标题检查完成");
  });

  it("injects exact fenced-code copy without giving Timeline clipboard authority", async () => {
    const writeText = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const code = "const answer = 42;";
    const codeHistory: ChatHistoryPage = Object.freeze({
      turns: Object.freeze([Object.freeze({
        ...HISTORY_WITHOUT_REASONING.turns[0],
        messages: Object.freeze([
          HISTORY_WITHOUT_REASONING.turns[0].messages[0],
          Object.freeze({
            ...HISTORY_WITHOUT_REASONING.turns[0].messages[1],
            content: `答案如下：\n\n\`\`\`ts\n${code}\n\`\`\``,
          }),
        ]),
      })]),
      nextCursor: null,
    });
    const { wrapper } = await mountPage(`/chat/${SESSION_ID}`, true, codeHistory);

    expect(wrapper.findComponent(ChatTimeline).exists()).toBe(true);
    const codeCopy = wrapper.get('[aria-label="复制代码"]');
    await codeCopy.trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(code);
    expect(wrapper.get("pre code").text()).toBe(code);
    expect(wrapper.find("script").exists()).toBe(false);
  });

  it("does not switch the renderer when metadata-only reasoning enters the projection", async () => {
    const { wrapper, store } = await mountPage(
      `/chat/${SESSION_ID}`,
      true,
      HISTORY_WITHOUT_REASONING,
    );
    const timelineElement = wrapper.getComponent(ChatTimeline).element;
    const loadReasoning = vi.spyOn(store, "loadReasoning");

    setHistoryProjection(store, HISTORY);
    await flushPromises();

    expect(wrapper.getComponent(ChatTimeline).element).toBe(timelineElement);
    expect(wrapper.find(".chat-turn").exists()).toBe(false);
    expect(wrapper.text()).toContain("过程记录");
    expect(wrapper.text()).toContain("此过程仅包含状态元数据；详情未进入当前对话投影。");
    expect(wrapper.text()).toContain("标题检查完成");
    expect(loadReasoning).not.toHaveBeenCalled();
  });

  it("does not enter the legacy renderer when the default selector has no Thread", async () => {
    const { wrapper, store } = await mountPage(
      `/chat/${SESSION_ID}`,
      true,
      HISTORY_WITHOUT_REASONING,
    );

    store.conversationState = createConversationState();
    await flushPromises();

    expect(wrapper.findComponent(ChatTimeline).exists()).toBe(false);
    expect(wrapper.find(".chat-turn").exists()).toBe(false);
    expect(wrapper.text()).toContain("正在同步对话状态");
    expect(wrapper.text()).not.toContain("模型推理记录");
  });

  it("does not treat an active empty reasoning Item as historical authority loss", async () => {
    const { wrapper, store } = await mountPage(
      `/chat/${SESSION_ID}`,
      true,
      HISTORY_WITHOUT_REASONING,
    );
    store.conversationState = hydrateConversationState({
      threads: [{ threadId: SESSION_ID, status: "active" }],
      turns: [{
        threadId: SESSION_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "in_progress",
        terminalStatus: null,
      }],
      items: [{
        threadId: SESSION_ID,
        turnId: TURN_ID,
        itemId: `${TURN_ID}:reasoning:0`,
        ordinal: 100,
        kind: "reasoning",
        status: "streaming",
        contentBlocks: [],
      }],
    });
    await flushPromises();

    expect(wrapper.findComponent(ChatTimeline).exists()).toBe(true);
    expect(wrapper.find(".chat-turn").exists()).toBe(false);
    expect(wrapper.text()).toContain("过程记录");
    expect(wrapper.text()).toContain("本轮正在处理中");
    expect(wrapper.text()).not.toContain("仅包含状态元数据");
  });

  it("presents deterministic Chat permission denial without hiding confirmed history", async () => {
    const { wrapper, store } = await mountPage(
      `/chat/${SESSION_ID}`,
      true,
      HISTORY_WITHOUT_REASONING,
    );
    store.controlPlane = {
      sessionId: SESSION_ID,
      state: "denied",
      issueCode: "chat_capability_denied",
      retryable: false,
      recovery: "none",
    };
    await flushPromises();

    const denied = wrapper.get(".chat-workspace__permission-denied");
    expect(denied.text()).toContain("当前工作区权限不足");
    expect(denied.text()).toContain("已经确认的对话内容仍会保留显示");
    expect(denied.find("button").exists()).toBe(false);
    expect(wrapper.findComponent(ChatTimeline).exists()).toBe(true);
    expect(wrapper.text()).toContain("标题检查完成");

    store.controlPlane = null;
    store.context = {
      contextId: store.context!.contextId,
      expiresAtEpochSeconds: 2_000_000_000,
      allowedActions: ["submit_turn", "read_projects"],
    };
    await flushPromises();
    expect(wrapper.get(".chat-workspace__permission-denied").text())
      .toContain("当前工作区权限不足");
    expect(wrapper.text()).toContain("标题检查完成");
  });

  it("renders an empty-text assistant turn with trusted Artifact identity and all typed clients", async () => {
    const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
    const artifacts = useArtifactStore(pinia);
    const artifactHistory: ChatHistoryPage = Object.freeze({
      turns: Object.freeze([Object.freeze({
        ...HISTORY.turns[0],
        reasoning: Object.freeze([]),
        messages: Object.freeze([
          HISTORY.turns[0].messages[0],
          Object.freeze({ ...HISTORY.turns[0].messages[1], content: "" }),
        ]),
        artifacts: Object.freeze([Object.freeze({
          artifactId: "019c1a00-0000-7000-8000-000000000021",
          kind: "file" as const,
          provenance: "synthetic" as const,
          status: "announced" as const,
          ordinal: 0,
          progressStage: null,
          progressPercent: null,
          displayName: "safe-metadata.txt",
          mediaType: null,
          sizeBytes: null,
          localCommittedAt: null,
          expiresAt: null,
          hasPoster: false,
          errorCode: null,
          retryable: null,
        })]),
      })]),
      nextCursor: null,
    });
    artifacts.replaceAuthority({
      authorizationRevision: 7,
      contextId: store.context!.contextId,
      tenantId: "019c1a00-0000-7000-8000-000000000022",
      sessionId: SESSION_ID,
    });
    artifacts.ingestHistoryV3(artifacts.captureAuthority(), artifactHistory);
    setHistoryProjection(store, artifactHistory);
    await flushPromises();

    expect(wrapper.findComponent(ChatTimeline).exists()).toBe(true);
    expect(wrapper.find(".chat-turn").exists()).toBe(false);
    expect(wrapper.findAll(".chat-message__attachment")).toHaveLength(1);
    expect(wrapper.findAllComponents(ChatArtifactList)).toHaveLength(1);
    const list = wrapper.getComponent(ChatArtifactList);
    expect(list.props("contextId")).toBe(store.context!.contextId);
    expect(list.props("nativeClient")).toBe(chatArtifactNativeClient);
    expect(list.props("videoNativeClient")).toBe(chatArtifactVideoNativeClient);
    expect(list.props("fileNativeClient")).toBe(chatArtifactFileNativeClient);
    expect(list.props("reportNativeClient")).toBe(chatArtifactReportNativeClient);
    expect(wrapper.text()).toContain("safe-metadata.txt");
    expect(wrapper.find(".artifact-list").exists()).toBe(true);
    expect(JSON.stringify(store.$state)).not.toMatch(/bytes|base64|digest|hostHref|absolutePath|token|requestId/);
    const results = await axe.run(wrapper.element, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.filter((violation) =>
      violation.impact === "serious" || violation.impact === "critical",
    )).toEqual([]);

    artifacts.replaceAuthority({
      authorizationRevision: 8,
      contextId: "019c1a00-0000-7000-8000-000000000099",
      tenantId: "019c1a00-0000-7000-8000-000000000022",
      sessionId: SESSION_ID,
    });
    await flushPromises();
    expect(wrapper.findComponent(ChatArtifactList).exists()).toBe(false);
    expect(wrapper.text()).toContain("safe-metadata.txt");
  });

  it("creates exactly one session from the real composer and routes only after success", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    const createSession = vi.spyOn(store, "createSessionWithResult")
      .mockResolvedValue(acceptedSubmission());
    await wrapper.get("textarea").setValue("检查标题");
    (wrapper.get("textarea").element as HTMLTextAreaElement).focus();
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith(PROJECT_ID, "检查标题");
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
    expect(document.activeElement).toBe(wrapper.get("textarea").element);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="添加图片或文件"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/模型选择|推理强度|语音输入/);
  });

  it("uses the same-route recovery action to clear a deleted task and re-enable the new composer", async () => {
    const { wrapper, store } = await mountPage("/chat");
    store.phase = "unavailable";
    store.selectedSessionId = SESSION_ID;
    store.draftTarget = chatSessionDraftTarget(SESSION_ID);
    store.draftTargetReady = false;
    store.attachmentErrorCode = "chat_resource_not_found";
    store.lastErrorCode = "chat_resource_not_found";
    const clearSelectedSession = vi.spyOn(store, "clearSelectedSession").mockImplementation(async () => {
      store.selectedSessionId = null;
      store.draftTarget = CHAT_NEW_DRAFT_TARGET;
      store.draftTargetReady = true;
      store.attachmentErrorCode = null;
      store.lastErrorCode = null;
      store.phase = "ready";
    });
    await flushPromises();

    expect(wrapper.text()).toContain("任务不可用");
    expect(wrapper.text()).toContain("附件处理失败");
    await wrapper.get(".chat-notice__action").trigger("click");
    await flushPromises();

    expect(clearSelectedSession).toHaveBeenCalledOnce();
    expect(wrapper.text()).not.toContain("任务不可用");
    expect(wrapper.text()).not.toContain("附件处理失败");
    expect(wrapper.get('[aria-label="添加图片或文件"]').attributes("disabled")).toBeUndefined();
    await wrapper.get("textarea").setValue("重新开始任务");
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeUndefined();
  });

  it("uses the project strip as the native project selection entry", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    const pickProject = vi.spyOn(store, "pickProject").mockImplementation(async () => {
      store.projects = [PROJECT, SECOND_PROJECT];
      return SECOND_PROJECT;
    });
    const createSession = vi.spyOn(store, "createSessionWithResult")
      .mockResolvedValue(acceptedSubmission());
    expect(wrapper.get(".chat-composer__project").text()).toBe("Synthetic Workspace");
    expect(wrapper.find("select").exists()).toBe(false);
    await wrapper.get(".chat-composer__project--button").trigger("click");
    await flushPromises();
    expect(pickProject).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".chat-composer__project").text()).toBe("Second Synthetic Workspace");

    await wrapper.get("textarea").setValue("使用新项目");
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    expect(createSession).toHaveBeenCalledWith(SECOND_PROJECT.projectId, "使用新项目");
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
  });

  it("keeps input and displays stable recovery copy when create fails", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    vi.spyOn(store, "createSessionWithResult")
      .mockRejectedValue(new Error("synthetic raw error /private/path"));
    await wrapper.get("textarea").setValue("保留这段输入");
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();

    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("保留这段输入");
    expect(router.currentRoute.value.path).toBe("/chat");
    expect(wrapper.text()).toContain("本地服务暂时繁忙");
    expect(wrapper.text()).not.toContain("/private/path");
  });

  it("routes the stable retry action to failed draft recovery before reopening the composer", async () => {
    const { wrapper, store } = await mountPage("/chat");
    const retryDraftRecovery = vi.spyOn(store, "retryDraftRecovery").mockImplementation(async () => {
      store.draftTargetReady = true;
      store.lastErrorCode = null;
      store.phase = "ready";
      return true;
    });
    store.draftTargetReady = false;
    store.lastErrorCode = "chat_temporarily_unavailable";
    store.phase = "unavailable";
    await flushPromises();

    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[aria-label="添加图片或文件"]').attributes("disabled")).toBeDefined();
    await wrapper.get(".chat-notice__action").trigger("click");
    await flushPromises();

    expect(retryDraftRecovery).toHaveBeenCalledOnce();
    expect(wrapper.get('[aria-label="添加图片或文件"]').attributes("disabled")).toBeUndefined();
  });

  it("uses the legacy renderer only through the explicit rollback boundary", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true, HISTORY, true);
    expect(wrapper.findComponent(ChatTimeline).exists()).toBe(false);
    expect(wrapper.find(".chat-turn").exists()).toBe(true);
    expect(wrapper.text()).toContain("检查标题");
    expect(wrapper.text()).toContain("标题检查完成");
    expect(wrapper.text()).toContain("synthetic-brief.pdf");
    expect(wrapper.text()).toContain("文件 · 4 KB");
    expect(wrapper.text()).toContain("模型推理记录");
    expect(wrapper.find('[aria-label="复制"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label*="赞"]').exists()).toBe(false);

    store.phase = "streaming";
    store.liveReasoning = [{ itemOrdinal: 0, contentIndex: 0, text: "<script>not executable</script>" }];
    store.liveAssistantText = "正在生成的回答";
    await flushPromises();
    expect(wrapper.text()).toContain("<script>not executable</script>");
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find('[aria-label="停止生成"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="模型回答，正在生成"]').exists()).toBe(true);
    expect(wrapper.find(".chat-message__streaming").exists()).toBe(true);

    store.phase = "ready";
    await flushPromises();
    expect(wrapper.find('[aria-label="模型回答"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="模型回答，正在生成"]').exists()).toBe(false);
    expect(wrapper.find(".chat-message__streaming").exists()).toBe(false);
  });

  it("selects through the unified plus entry and permits an attachment-only task", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    vi.spyOn(store, "pickAttachments").mockImplementation(async () => {
      store.draftAttachments = [READY_ATTACHMENT];
      return [READY_ATTACHMENT];
    });
    const createSession = vi.spyOn(store, "createSessionWithResult")
      .mockResolvedValue(acceptedSubmission());

    await wrapper.get('[aria-label="添加图片或文件"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("synthetic-brief.pdf");
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeUndefined();
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();

    expect(createSession).toHaveBeenCalledWith(PROJECT_ID, "");
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
  });

  it("projects native attachment progress into the real composer", async () => {
    const { wrapper, store } = await mountPage("/chat");
    store.attachmentImporting = true;
    store.attachmentImportAttempt = {
      schemaVersion: 2,
      contextId: store.context!.contextId,
      operationId: "019c1a00-0000-7000-8000-000000000011",
      sequence: "3",
      stage: "indexing",
      itemCount: 3,
      issue: null,
    } satisfies ChatAttachmentImportEvent;
    await flushPromises();

    expect(wrapper.text()).toContain("3 个附件 · 正在建立索引");
    expect(wrapper.get('[aria-label="添加图片或文件"]').attributes("disabled")).toBeDefined();
  });

  it("keeps attachment rejection guidance local to the composer", async () => {
    const { wrapper, store } = await mountPage("/chat");
    vi.spyOn(store, "pickAttachments").mockImplementation(async () => {
      store.attachmentErrorCode = "archive_unsupported";
      throw new ChatClientError({
        schemaVersion: 2,
        code: "chat_request_invalid",
        retryable: false,
        recovery: "fix_request",
        attachmentIssue: "archive_unsupported",
      });
    });

    await wrapper.get('[aria-label="添加图片或文件"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("暂不支持压缩包，请先解压后选择文件");
    expect(wrapper.text()).not.toContain("请检查文本长度后重试");
  });

  it("disables the plus entry and ignores dropped paths when sending becomes unavailable", async () => {
    const { wrapper, store } = await mountPage("/chat");
    const pickAttachments = vi.spyOn(store, "pickAttachments");
    const importAttachmentPaths = vi.spyOn(store, "importAttachmentPaths");

    vi.spyOn(wrapper.get(".chat-composer").element, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300, x: 100, y: 100,
      toJSON: () => ({}),
    });
    dragDropMock.handler?.({ payload: { type: "enter", paths: [], position: { x: 400, y: 300 } } });
    await flushPromises();
    expect(wrapper.find(".chat-composer__drop-overlay").exists()).toBe(true);

    store.localReadiness = {
      lifecycle: "blocked", host: "unavailable", runtime: "unavailable", storage: "ready",
      canSend: false, issueCode: "chat_host_unavailable", retryable: true, recovery: "start_or_retry",
    };
    await flushPromises();

    const addButton = wrapper.get('[aria-label="添加图片或文件"]');
    expect(addButton.attributes("disabled")).toBeDefined();
    expect(wrapper.find(".chat-composer__drop-overlay").exists()).toBe(false);
    await addButton.trigger("click");
    dragDropMock.handler?.({
      payload: { type: "drop", paths: ["/private/synthetic.pdf"], position: { x: 400, y: 300 } },
    });
    await flushPromises();
    expect(pickAttachments).not.toHaveBeenCalled();
    expect(importAttachmentPaths).not.toHaveBeenCalled();
  });

  it("keeps the plus entry and native drop path disabled during a local submission", async () => {
    const { wrapper, store } = await mountPage("/chat");
    let resolveCreate!: (result: ChatSubmissionResult) => void;
    const pendingCreate = new Promise<ChatSubmissionResult>((resolve) => { resolveCreate = resolve; });
    vi.spyOn(store, "createSessionWithResult").mockReturnValue(pendingCreate);
    const importAttachmentPaths = vi.spyOn(store, "importAttachmentPaths");
    vi.spyOn(wrapper.get(".chat-composer").element, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300, x: 100, y: 100,
      toJSON: () => ({}),
    });

    await wrapper.get("textarea").setValue("pending local submit");
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[aria-label="添加图片或文件"]').attributes("disabled")).toBeDefined();
    dragDropMock.handler?.({ payload: { type: "enter", paths: [], position: { x: 400, y: 300 } } });
    dragDropMock.handler?.({
      payload: { type: "drop", paths: ["/private/during-submit.pdf"], position: { x: 400, y: 300 } },
    });
    await flushPromises();
    expect(wrapper.find(".chat-composer__drop-overlay").exists()).toBe(false);
    expect(importAttachmentPaths).not.toHaveBeenCalled();

    resolveCreate({ status: "not_accepted" });
    await flushPromises();
  });

  it("keeps a reply draft when the store does not locally accept it", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    const submitTurn = vi.spyOn(store, "submitTurnWithResult")
      .mockResolvedValue({ status: "not_accepted" });

    await wrapper.get("textarea").setValue("不能丢失的回复");
    await wrapper.getComponent(ChatComposer).vm.$emit("submit");
    await flushPromises();

    expect(submitTurn).toHaveBeenCalledWith("不能丢失的回复");
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value)
      .toBe("不能丢失的回复");
    expect(wrapper.text()).toContain("本地服务尚未就绪");
  });

  it("isolates text drafts while switching between session targets", async () => {
    const sessionB = "019c1a00-0000-7000-8000-000000000011";
    const { wrapper, router } = await mountPage(`/chat/${SESSION_ID}`, true);

    await wrapper.get("textarea").setValue("会话 A 草稿");
    await router.push(`/chat/${sessionB}`);
    await flushPromises();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("");

    await wrapper.get("textarea").setValue("会话 B 草稿");
    await router.push(`/chat/${SESSION_ID}`);
    await flushPromises();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("会话 A 草稿");

    await router.push(`/chat/${sessionB}`);
    await flushPromises();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("会话 B 草稿");
  });

  it("keeps a draft through the first context bind and clears it across authority changes", async () => {
    const { wrapper, store } = await mountPage("/chat");
    const boundContext = store.context!;
    store.context = null;
    await flushPromises();

    await wrapper.get("textarea").setValue("绑定前草稿");
    store.context = boundContext;
    await flushPromises();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("绑定前草稿");

    store.context = {
      ...boundContext,
      contextId: "019c1a00-0000-7000-8000-000000000099",
    };
    await flushPromises();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("");
  });

  it("does not clear another target when a late accepted submit resolves after navigation", async () => {
    const sessionB = "019c1a00-0000-7000-8000-000000000011";
    const { wrapper, store, router } = await mountPage(`/chat/${SESSION_ID}`, true);
    let resolveSubmit!: (result: ChatSubmissionResult) => void;
    const pendingSubmit = new Promise<ChatSubmissionResult>((resolve) => { resolveSubmit = resolve; });
    vi.spyOn(store, "submitTurnWithResult").mockReturnValue(pendingSubmit);

    await wrapper.get("textarea").setValue("会话 A 在途草稿");
    await wrapper.getComponent(ChatComposer).vm.$emit("submit");
    await router.push(`/chat/${sessionB}`);
    await flushPromises();
    wrapper.getComponent(ChatComposer).vm.$emit("update:modelValue", "会话 B 草稿");
    await flushPromises();

    resolveSubmit(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)));
    await flushPromises();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("会话 B 草稿");

    await router.push(`/chat/${SESSION_ID}`);
    await flushPromises();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("会话 A 在途草稿");
  });

  it("coalesces duplicate submit events while the first intent is pending", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    let resolveSubmit!: (result: ChatSubmissionResult) => void;
    const pendingSubmit = new Promise<ChatSubmissionResult>((resolve) => { resolveSubmit = resolve; });
    const submitTurn = vi.spyOn(store, "submitTurnWithResult").mockReturnValue(pendingSubmit);

    await wrapper.get("textarea").setValue("只提交一次");
    wrapper.getComponent(ChatComposer).vm.$emit("submit");
    wrapper.getComponent(ChatComposer).vm.$emit("submit");
    await Promise.resolve();

    expect(submitTurn).toHaveBeenCalledOnce();
    resolveSubmit(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)));
    await flushPromises();
  });

  it("restores the textarea focus and clamps selection after local durable acceptance", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    let resolveSubmit!: (result: ChatSubmissionResult) => void;
    const pendingSubmit = new Promise<ChatSubmissionResult>((resolve) => { resolveSubmit = resolve; });
    vi.spyOn(store, "submitTurnWithResult").mockReturnValue(pendingSubmit);
    const textarea = wrapper.get("textarea").element as HTMLTextAreaElement;
    await wrapper.get("textarea").setValue("提交后继续输入");
    textarea.focus();
    textarea.setSelectionRange(2, 6);

    wrapper.getComponent(ChatComposer).vm.$emit("submit");
    await flushPromises();
    textarea.blur();
    resolveSubmit(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)));
    await flushPromises();

    expect(textarea.value).toBe("");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(0);
  });

  it.each(["failed", "interrupted"] as const)(
    "keeps one accepted user identity and never restores its drafts after %s",
    async (terminalStatus) => {
      const acceptedTurnId = "019c1a00-0000-7000-8000-000000000022";
      const input = `提交后 ${terminalStatus}`;
      const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
      store.draftAttachments = Object.freeze([READY_ATTACHMENT]);
      vi.spyOn(store, "submitTurnWithResult").mockImplementation(async () => {
        store.draftAttachments = Object.freeze([]);
        setHistoryProjection(store, historyWithAcceptedTurn(acceptedTurnId, "queued", input));
        return acceptedSubmission(
          SESSION_ID,
          chatSessionDraftTarget(SESSION_ID),
          acceptedTurnId,
        );
      });

      await wrapper.get("textarea").setValue(input);
      wrapper.getComponent(ChatComposer).vm.$emit("submit");
      await flushPromises();

      const queuedTimeline = selectConversationTimeline(store.conversationState, SESSION_ID)!;
      const queuedTurn = queuedTimeline.turns.find((turn) => turn.turnId === acceptedTurnId)!;
      const queuedUsers = queuedTurn.items.filter((item) => item.presentation === "user_message");
      expect(queuedTurn.domainStatus).toBe("queued");
      expect(queuedUsers).toHaveLength(1);
      expect(wrapper.text()).toContain(input);
      expect(wrapper.text()).toContain("等待处理");
      expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("");
      expect(store.draftAttachments).toEqual([]);

      setHistoryProjection(
        store,
        historyWithAcceptedTurn(acceptedTurnId, terminalStatus, input),
      );
      await flushPromises();

      const terminalTimeline = selectConversationTimeline(store.conversationState, SESSION_ID)!;
      const terminalTurn = terminalTimeline.turns.find((turn) => turn.turnId === acceptedTurnId)!;
      const terminalUsers = terminalTurn.items.filter((item) => item.presentation === "user_message");
      expect(terminalUsers).toHaveLength(1);
      expect(terminalUsers[0]?.identity).toBe(queuedUsers[0]?.identity);
      expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("");
      expect(store.draftAttachments).toEqual([]);
    },
  );

  it("keeps text and attachments after a current operation mismatch", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    store.draftAttachments = Object.freeze([READY_ATTACHMENT]);
    vi.spyOn(store, "submitTurnWithResult").mockRejectedValue(new ChatClientError({
      schemaVersion: 2,
      code: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    }));

    await wrapper.get("textarea").setValue("必须保留的内容");
    wrapper.getComponent(ChatComposer).vm.$emit("submit");
    await flushPromises();

    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value)
      .toBe("必须保留的内容");
    expect(store.draftAttachments).toEqual([READY_ATTACHMENT]);
    expect(wrapper.text()).toContain("synthetic-brief.pdf");
    expect(wrapper.text()).toContain("本地组件状态不一致");
  });

  it("restores focus and the original selection after a non-accepted submit", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    let resolveSubmit!: (result: ChatSubmissionResult) => void;
    const pendingSubmit = new Promise<ChatSubmissionResult>((resolve) => { resolveSubmit = resolve; });
    vi.spyOn(store, "submitTurnWithResult").mockReturnValue(pendingSubmit);
    const textarea = wrapper.get("textarea").element as HTMLTextAreaElement;
    await wrapper.get("textarea").setValue("失败后保留选择");
    textarea.focus();
    textarea.setSelectionRange(2, 5, "backward");

    wrapper.getComponent(ChatComposer).vm.$emit("submit");
    await flushPromises();
    textarea.blur();
    resolveSubmit({ status: "not_accepted" });
    await flushPromises();

    expect(textarea.value).toBe("失败后保留选择");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(5);
    expect(textarea.selectionDirection).toBe("backward");
  });

  it("does not steal focus when the user moves to another control during submit", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    let resolveSubmit!: (result: ChatSubmissionResult) => void;
    const pendingSubmit = new Promise<ChatSubmissionResult>((resolve) => { resolveSubmit = resolve; });
    vi.spyOn(store, "submitTurnWithResult").mockReturnValue(pendingSubmit);
    const textarea = wrapper.get("textarea").element as HTMLTextAreaElement;
    await wrapper.get("textarea").setValue("不要抢焦点");
    textarea.focus();

    wrapper.getComponent(ChatComposer).vm.$emit("submit");
    await flushPromises();
    const external = document.createElement("button");
    document.body.append(external);
    external.focus();
    resolveSubmit(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)));
    await flushPromises();

    expect(document.activeElement).toBe(external);
  });

  it("preserves an active conversation selection when submit settles", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    let resolveSubmit!: (result: ChatSubmissionResult) => void;
    const pendingSubmit = new Promise<ChatSubmissionResult>((resolve) => { resolveSubmit = resolve; });
    vi.spyOn(store, "submitTurnWithResult").mockReturnValue(pendingSubmit);
    const textarea = wrapper.get("textarea").element as HTMLTextAreaElement;
    await wrapper.get("textarea").setValue("保留正文选择");
    textarea.focus();

    wrapper.getComponent(ChatComposer).vm.$emit("submit");
    await flushPromises();
    const conversation = wrapper.get(".chat-workspace__conversation").element;
    const paragraph = conversation.querySelector(".chat-safe-content__paragraph");
    expect(paragraph).not.toBeNull();
    textarea.blur();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.isCollapsed).toBe(false);
    expect(conversation.contains(selection.anchorNode)).toBe(true);
    expect(document.activeElement).toBe(document.body);

    resolveSubmit(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)));
    await flushPromises();

    expect(selection.isCollapsed).toBe(false);
    expect(selection.rangeCount).toBe(1);
    expect(document.activeElement).toBe(document.body);
    selection.removeAllRanges();
  });

  it("accepts native drops only inside the composer logical bounds", async () => {
    const { wrapper, store } = await mountPage("/chat");
    const importAttachmentPaths = vi.spyOn(store, "importAttachmentPaths").mockResolvedValue([]);
    vi.spyOn(wrapper.get(".chat-composer").element, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300, x: 100, y: 100,
      toJSON: () => ({}),
    });

    dragDropMock.handler?.({ payload: { type: "over", position: { x: 80, y: 80 } } });
    await flushPromises();
    expect(wrapper.find(".chat-composer__drop-overlay").exists()).toBe(false);
    dragDropMock.handler?.({
      payload: { type: "drop", paths: ["/private/outside.pdf"], position: { x: 80, y: 80 } },
    });
    await flushPromises();
    expect(importAttachmentPaths).not.toHaveBeenCalled();

    dragDropMock.handler?.({ payload: { type: "over", position: { x: 400, y: 300 } } });
    await flushPromises();
    expect(wrapper.find(".chat-composer__drop-overlay").exists()).toBe(true);
    dragDropMock.handler?.({
      payload: { type: "drop", paths: ["/private/inside.pdf"], position: { x: 400, y: 300 } },
    });
    await flushPromises();
    expect(importAttachmentPaths).toHaveBeenCalledWith(["/private/inside.pdf"]);
    expect(wrapper.find(".chat-composer__drop-overlay").exists()).toBe(false);
  });

  it("holds the attachment entry closed without the relevant create permission", async () => {
    const { wrapper, store } = await mountPage("/chat");
    store.context = {
      contextId: store.context?.contextId ?? "019c1a00-0000-7000-8000-000000000006",
      expiresAtEpochSeconds: 2_000_000_000,
      allowedActions: ["read_sessions", "read_projects"],
    };
    await flushPromises();

    expect(wrapper.get('[aria-label="添加图片或文件"]').attributes("disabled")).toBeDefined();
    dragDropMock.handler?.({
      payload: { type: "drop", paths: ["/private/denied.pdf"], position: { x: 400, y: 300 } },
    });
    await flushPromises();
    expect(store.draftAttachments).toEqual([]);
  });

  it("opens the read-only permission policy without exposing writable approval", async () => {
    const { wrapper } = await mountPage("/chat");
    await wrapper.get(".chat-composer__permission").trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("只读访问 · 禁止写入");
    expect(document.body.textContent).toContain("不能在页面中提升权限");
    expect(document.body.textContent).not.toContain("允许写入");
  });

  it("projects cleanup pending instead of removing the session optimistically", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    store.cleanupStatus = {
      operationId: "019c1a00-0000-7000-8000-000000000007",
      desktopState: "complete",
      hostState: "pending",
      runtimeState: "pending",
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    };
    await flushPromises();
    expect(wrapper.text()).toContain("正在永久删除任务");
    expect(wrapper.text()).not.toContain("任务已永久删除");
  });
});
