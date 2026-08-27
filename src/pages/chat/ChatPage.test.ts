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
import { useChatStore } from "../../stores/chat.store";
import { useArtifactStore } from "../../stores/artifact.store";
import ChatArtifactList from "../../components/chat/ChatArtifactList.vue";
import { chatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import { chatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import { chatArtifactFileNativeClient } from "../../api/chat-artifact-file-native-client";
import { chatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
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

async function mountPage(path: string, active = false) {
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
  store.history = active ? HISTORY : null;
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
  const wrapper = mount(ChatPage, { attachTo: document.body, global: { plugins: [pinia, router] } });
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
    expect(wrapper.text()).toContain("正在读取本地对话");
  });

  it("renders an empty-text assistant turn with trusted Artifact identity and all typed clients", async () => {
    const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
    const artifacts = useArtifactStore(pinia);
    const artifactHistory: ChatHistoryPage = Object.freeze({
      turns: Object.freeze([Object.freeze({
        ...HISTORY.turns[0],
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
    store.history = artifactHistory;
    await flushPromises();

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
  });

  it("creates exactly one session from the real composer and routes only after success", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    const createSession = vi.spyOn(store, "createSession").mockResolvedValue(SESSION_ID);
    await wrapper.get("textarea").setValue("检查标题");
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith(PROJECT_ID, "检查标题");
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
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
    const createSession = vi.spyOn(store, "createSession").mockResolvedValue(SESSION_ID);
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
    vi.spyOn(store, "createSession").mockRejectedValue(new Error("synthetic raw error /private/path"));
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

  it("renders historical and streaming assistant/raw reasoning as literal selectable text", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
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
    const createSession = vi.spyOn(store, "createSession").mockResolvedValue(SESSION_ID);

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
    let resolveCreate!: (sessionId: string | null) => void;
    const pendingCreate = new Promise<string | null>((resolve) => { resolveCreate = resolve; });
    vi.spyOn(store, "createSession").mockReturnValue(pendingCreate);
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

    resolveCreate(null);
    await flushPromises();
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
