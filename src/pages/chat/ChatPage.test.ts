// @vitest-environment happy-dom
import { chatRenderMeasurements, setChatRenderMeasurementEnabled } from "../../domain/chat-render-performance";
import ChatAttachmentChip from "../../components/chat/ChatAttachmentChip.vue";
import { createExpertNativeClient, expertNativeClient } from "../../api/expert-native-client";
import { expertDisplay, expertEntry, expertSnapshot } from "../../test/expert-fixture";
import { usePermissionStore } from "../../stores/permission.store";
import { useChatComposerDraftStore } from "../../stores/chat-composer-drafts.store";
import { useChatReadingStore } from "../../stores/chat-reading.store";
import { useChatExpertsStore } from "../../stores/chat-experts.store";
import { useExpertsStore } from "../../stores/experts.store";
import { defineComponent, h } from "vue";
import { RouterView } from "vue-router";

import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import axe from "axe-core";
import { createPinia,setActivePinia } from "pinia";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createMemoryHistory,createRouter } from "vue-router";
import { documentPreviewClient } from "../../api/chat-document-preview-client";
import { chatArtifactFileNativeClient } from "../../api/chat-artifact-file-native-client";
import { chatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import { chatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
import { chatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import { historyPageToConversationSnapshot } from "../../api/chat-conversation-adapter";
import type { NativeItem } from "../../api/generated/native-conversation-private.gen";
import { traceItem } from "../../domain/conversation-activity-fixtures";
import { runtimePermissionClient } from "../../api/runtime-permission-client";
import { userInputClient } from "../../api/user-input-client";
import { CHAT_AUTHORITY_RETRY_KEY } from "../../authorization/chat-authority-recovery";
import ChatArtifactList from "../../components/chat/ChatArtifactList.vue";
import ChatComposer from "../../components/chat/ChatComposer.vue";
import ChatShopControl from "../../components/chat/ChatShopControl.vue";
import { skillNativeClient } from "../../api/skill-native-client";
import { useSkillStore } from "../../stores/skill.store";
import { installedSkill } from "../../test/skill-fixture";
import { PREVIEW_SHOPS, SHOP_PREVIEW_TIMING } from "../../domain/chat-shop-preview";
import ChatWorkspaceControl from "../../components/chat/ChatWorkspaceControl.vue";
import ChatSidebarTree from "../../components/chat/ChatSidebarTree.vue";
import { chatWorkspaceClient } from "../../api/chat-workspace-client";
import ChatModelControl from "../../components/chat/ChatModelControl.vue";
import { chatModelClient, chatModelsEnabled, kimiK31Candidate, parseModelCatalog, type ModelState } from "../../api/chat-model-client";
import { modelDefinitions } from "../../domain/chat-models.generated";
import { modelDefinitions as currentModelDefinitions } from "../../domain/chat-models-v2.generated";
import ChatTimeline from "../../components/chat/ChatTimeline.vue";
import {
CHAT_NEW_DRAFT_TARGET,
ChatClientError,
chatSessionDraftTarget,
type ChatArtifact,
type ChatAttachment,
type ChatAttachmentImportEvent,
type ChatHistoryPage,
type ChatProject,
type ChatSession,
} from "../../domain/chat-ipc";
import { hydrateConversationApprovalState } from "../../domain/conversation-approval";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import {
composeConversationView,
emptyConversationView,
viewFromLegacySnapshot
} from "../../domain/conversation-view";
import { useArtifactStore } from "../../stores/artifact.store";
import {
useChatStore,
type ChatSubmissionResult,
} from "../../stores/chat.store";
import ChatPage from "./ChatPage.vue";
import { chatClient } from "../../api/chat-client";

vi.mock("naive-ui", async original => ({
  ...await original<typeof import("naive-ui")>(),
  useMessage: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const promptBoundary = vi.hoisted(() => ({ invoke: null as null | ((command: string, args: unknown) => Promise<unknown>) }));
vi.mock("@tauri-apps/api/core", async original => {
  const actual = await original<typeof import("@tauri-apps/api/core")>();
  return { ...actual, invoke: (command: string, args: unknown) => promptBoundary.invoke
    ? promptBoundary.invoke(command, args) : actual.invoke(command, args as Record<string, unknown>) };
});

const expertFlag = vi.hoisted(() => ({ enabled: false }));
vi.mock("../../authorization/experts-ui-config", () => ({ get expertsUiEnabled() { return expertFlag.enabled; } }));
const skillFlag = vi.hoisted(() => ({ enabled: false }));
vi.mock("../../authorization/skill-marketplace-ui-config", async (original) => {
  const actual = await original<typeof import("../../authorization/skill-marketplace-ui-config")>();
  return { ...actual, get skillMarketplaceUiEnabled() { return skillFlag.enabled || actual.skillMarketplaceUiEnabled; } };
});

type MockDragDropPayload =
  | { type: "enter" | "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "leave" };

const dragDropMock = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: MockDragDropPayload }) => void),
  unlisten: vi.fn(),
  windowListener: vi.fn(async () => () => undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: dragDropMock.windowListener,
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: typeof dragDropMock.handler) => {
      dragDropMock.handler = handler;
      return dragDropMock.unlisten;
    },
  }),
}));

const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";
const TURN_ID = "019c1a00-0000-7000-8000-000000000003";
const kimiProfile = kimiK31Candidate ? "kimi-k3-1-pro-high-v1" : "kimi-k3-max-v1";
const newChatProfile = "minimax-m3-high-v1";
const sessionModel = { profileId: "minimax-m3-high-v1", revision: 3, state: "ready" } as const;
const newTaskModelArgs = chatModelsEnabled ? [{ profileId: newChatProfile, expectedRevision: 0 }] : [];
const replyModelArgs = chatModelsEnabled ? [{ profileId: sessionModel.profileId, expectedRevision: sessionModel.revision }] : [];

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
  store.conversationState = viewFromLegacySnapshot(
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

const mountedPages: VueWrapper[] = [];

async function mountPage(
  path: string,
  active = false,
  activeHistory: ChatHistoryPage = HISTORY,
  retryChatAuthority: () => Promise<boolean> = async () => false,
  throughRouter = false,
  stubs: Record<string, boolean> = {},
) {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const pinia = createPinia();
  setActivePinia(pinia);
  if (expertFlag.enabled) {
    const permission = usePermissionStore(pinia);
    vi.spyOn(permission, "hasCapability").mockImplementation(capability => permission.capabilities.includes(capability));
    permission.selectedTenantId = PROJECT_ID; permission.capabilities = ["task.read", "task.create", "plugin.read", "plugin.manage"]; permission.phase = "ready";
    vi.spyOn(expertNativeClient, "snapshot").mockResolvedValue({ ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true });
    vi.spyOn(expertNativeClient, "binding").mockResolvedValue({ sessionId: SESSION_ID, managed: true, bindingRevision: 1, expert: expertDisplay, state: "ready" });
  }
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
  store.selectedAccessMode = active ? "live" : null;
  store.selectedSessionPurpose = active ? "ordinary" : null;
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
      { path: "/plugins", component: { template: "<div>扩展</div>" } },
      { path: "/scheduled-tasks", component: { template: "<div>管理页</div>" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(throughRouter ? defineComponent({ render: () => h(RouterView) }) : ChatPage, {
    attachTo: document.body,
    global: {
      stubs,
      plugins: [pinia, router],
      provide: {
        [CHAT_AUTHORITY_RETRY_KEY as symbol]: retryChatAuthority,
      },
    },
  });
  mountedPages.push(wrapper);
  await flushPromises();
  return { wrapper, store, router, pinia };
}

beforeEach(() => {
  if (!chatModelsEnabled) return;
  const profiles = kimiK31Candidate ? currentModelDefinitions : modelDefinitions;
  vi.spyOn(chatModelClient, "catalog").mockResolvedValue(parseModelCatalog({
    schema_version: kimiK31Candidate ? 2 : 1,
    default_profile: kimiProfile,
    models: profiles.map(profile => ({ profile, available: true, reason: "ready" })),
  }));
  vi.spyOn(chatModelClient, "state").mockResolvedValue(sessionModel);
});

afterEach(() => {
  // Unmount while native reads and animation frames still belong to this test.
  for (const page of mountedPages.splice(0)) {
    if (page.exists()) page.unmount();
  }
  promptBoundary.invoke = null;
  expertFlag.enabled = false;
  skillFlag.enabled = false;
  vi.useRealTimers();
  dragDropMock.handler = null;
  dragDropMock.unlisten.mockClear();
  dragDropMock.windowListener.mockClear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.skipIf(!process.env.YIJIE_PROMPT_BOUNDARY_SETUP)("selected skill continuous Native Host Runtime boundary", async () => {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { join, basename } = await import("node:path");
  const setupFile = process.env.YIJIE_PROMPT_BOUNDARY_SETUP!;
  const setup = JSON.parse(readFileSync(setupFile, "utf8"));
  expect(basename(setup.root)).toMatch(/^feat164-native-boundary-/);
  expect(setupFile).toBe(join(setup.root, "boundary.json"));
  expect(setup.prompt_skill).toBe(true);
  expect(chatModelsEnabled && kimiK31Candidate).toBe(true);
  vi.stubEnv("VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED", "true");
  skillFlag.enabled = true;
  const skill = { ...installedSkill, id: "yijie.fixture.model-only", runtimeName: "yijie-fixture-model-only", displayName: "合成模型技能" };
  vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "2026-11-04T00:00:00Z", skills: [skill] });
  const { wrapper, store, pinia } = await mountPage("/chat");
  const skills = useSkillStore(pinia); skills.skills = [skill]; skills.phase = "ready";
  vi.spyOn(skills, "open").mockResolvedValue();
  const submit = vi.spyOn(store, "createSessionWithResult"); // call through the real store
  let requests = 0;
  promptBoundary.invoke = async (command, args) => {
    if (command !== "chat_model_submit_v1") throw new Error("unrelated UI read is outside the headless submission boundary");
    requests += 1;
    expect(requests).toBe(1);
    const request = (args as { request: unknown }).request;
    writeFileSync(join(setup.root, "renderer-request.json"), JSON.stringify(request), { flag: "wx", mode: 0o600 });
    // Reuse the existing explicit Native boundary. No App, real keys or shell;
    // the child exits normally and writes the actual durable Native receipt.
    const out = execFileSync("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--features", "kimi-k31-pro-candidate", "--lib", "chat::feat164_boundary_tests::feat164_native_host_boundary", "--", "--exact", "--ignored", "--test-threads=1", "--nocapture"], {
      encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, YIJIE_FEAT164_BOUNDARY_SETUP: setupFile },
    });
    writeFileSync(join(setup.root, "native-prepare.log"), out, { mode: 0o600 });
    expect(out).toContain("PROMPT_SKILL_NATIVE_PASS prepare");
    return JSON.parse(readFileSync(join(setup.root, "renderer-response.json"), "utf8"));
  };
  await wrapper.get('[aria-label="可添加文件、技能、连接器"]').trigger("click");
  await flushPromises();
  const menu = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === "技能");
  expect(menu).toBeDefined(); await new DOMWrapper(menu!).trigger("click"); await flushPromises();
  const choice = document.querySelector<HTMLElement>('[aria-label="已启用的技能"] [role="checkbox"]');
  expect(choice).not.toBeNull(); await new DOMWrapper(choice!).trigger("click"); await flushPromises();
  expect(useChatComposerDraftStore(pinia).skillSelection("new").map(s => s.id)).toEqual([skill.id]);
  const editor = wrapper.get('[contenteditable="true"]');
  editor.element.append(document.createTextNode("请简短说明六乘七。"));
  await editor.trigger("input");
  await wrapper.get('[aria-label="发送任务"]').trigger("click");
  await flushPromises();
  expect(submit).toHaveBeenCalledOnce();
  const result = await submit.mock.results[0]!.value;
  expect(result.status).toBe("local_durable_accepted");
  expect(requests).toBe(1);
  expect(useChatComposerDraftStore(pinia).skillSelection("new")).toEqual([]);
  writeFileSync(join(setup.root, "renderer-accepted.json"), JSON.stringify(result), { mode: 0o600 });
  wrapper.unmount();
  console.log("PROMPT_SKILL_RENDERER_PASS: actual picker/page/store/client -> production Rust decoder/storage -> Host -> Runtime; OS WebView not exercised");
}, 300_000);

it("locates the exact requested local turn without sending or substituting the latest turn", async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
  const { wrapper, store, router } = await mountPage(`/chat/${SESSION_ID}?turn=${TURN_ID}`, true);
  await flushPromises();
  expect(wrapper.text()).toContain("已定位本次运行对应的轮次");
  expect(wrapper.find(`[data-turn-id="${TURN_ID}"]`).exists()).toBe(true);
  expect(document.activeElement).toBe(wrapper.get(`[data-turn-id="${TURN_ID}"]`).element);
  expect(scroll).not.toHaveBeenCalled();
  const submit = vi.spyOn(store, "submitTurn");
  await router.push(`/chat/${SESSION_ID}?turn=019c1a00-0000-7000-8000-000000009999`);
  await flushPromises();
  expect(wrapper.text()).toContain("没有使用最新轮次替代");
  expect(submit).not.toHaveBeenCalled();
  wrapper.unmount();
});

describe("FEAT-126 ChatPage", () => {
  it.skipIf(!kimiK31Candidate).for([
    {name: "杭州旅游介绍.md", destination: "file:///Users/example/Desktop/杭州旅游介绍.md", path: "/Users/example/Desktop/杭州旅游介绍.md"},
    {name: "南京3天行程.html", destination: "./南京3天行程.html", path: "南京3天行程.html"},
  ])("opens the linked output from a saved answer in the ordinary chat sidebar ($name)", async ({name, destination, path}) => {
    const answer = `已完成文档。\n\n**[打开 / 下载《${name}》](${destination})**` +
      (path.startsWith("/") ? `\n\n路径：\`${path}\`` : "");
    const turn = HISTORY_WITHOUT_REASONING.turns[0]!;
    const history = {turns: [{...turn, messages: turn.messages.map(message =>
      message.role === "assistant" ? {...message, content: answer} : message)}], nextCursor: null};
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(924);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 336, 600));
    const native = vi.spyOn(documentPreviewClient, "run").mockImplementation(async (_context, action) => ({
      status: action.action === "locate" ? "located" : action.action === "open" ? "ready" : "closed",
      viewId: action.viewId, position: null,
      ...(action.action === "locate" && {path: path.startsWith("/") ? path : "/work/" + path}),
      document: action.action === "open" ? {kind:"text", revision:"a".repeat(64), expiresAt:Math.floor(Date.now()/1000)+600,
        sections:[],section:0,offset:0,nextOffset:null,previousOffset:null,partial:false,notice:null} : null,
    }));
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true, history);
    expect(wrapper.find(".chat-artifact-document-card").exists()).toBe(false);
    const link = wrapper.get(".chat-file-link");
    expect(link.text()).toBe(`《${name}》`);
    const source = {kind:"messageFile", sessionId:SESSION_ID,turnId:TURN_ID,itemId:`${TURN_ID}:assistant:0`,reference:path};
    expect(native).not.toHaveBeenCalled();
    expect(wrapper.find('[role="tab"][aria-selected="true"]').exists()).toBe(false);
    await link.trigger("click"); await flushPromises();
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe(name);
    expect(native).toHaveBeenCalledWith(store.context!.contextId, expect.objectContaining({
      action:"open", source,
    }));
  });

  it.skipIf(!kimiK31Candidate)("shows one card per registered document ID alongside ordinary links, including cached history", async () => {
    const title = "苏州与杭州简单对比";
    const answer = `已生成文档。\n\n[打开文档](</work/易界 temp/${title}.html>)\n\n参考 [城市资料](./资料.pdf)。`;
    const turn = HISTORY_WITHOUT_REASONING.turns[0]!;
    const messages = turn.messages.map(message => message.role === "assistant" ? {...message, content: answer} : message);
    const history = {turns: [{...turn, messages}], nextCursor: null};
    const {wrapper, store, pinia} = await mountPage(`/chat/${SESSION_ID}`, true, history);
    const titles = () => wrapper.findAll(".chat-artifact-document-card__name").map(card => card.text());
    expect(titles()).toEqual([]);
    expect(wrapper.findAll(".chat-file-link").map(link => link.text())).toEqual([`《${title}.html》`, "《资料.pdf》"]);

    const file: ChatArtifact = {artifactId: "019c1a00-0000-7000-8000-000000000021", kind: "file", provenance: "provider",
      status: "ready", ordinal: 0, displayName: title, mediaType: "text/html", sizeBytes: 6010,
      localCommittedAt: 1000, expiresAt: 2_000_000_000, progressStage: null, progressPercent: null,
      hasPoster: false, errorCode: null, retryable: null};
    const artifacts = useArtifactStore(pinia);
    artifacts.replaceAuthority({authorizationRevision: 7, contextId: store.context!.contextId, tenantId: PROJECT_ID, sessionId: SESSION_ID});
    function deliver(records: ChatArtifact[]) {
      const page = {turns: [{...turn, messages, artifacts: records}], nextCursor: null};
      artifacts.ingestHistoryV3(artifacts.captureAuthority(), page);
      setHistoryProjection(store, page);
    }
    const announced: ChatArtifact = {...file, status: "announced", mediaType: null, sizeBytes: null, localCommittedAt: null, expiresAt: null};
    deliver([announced, file]);
    await flushPromises();
    expect(titles()).toEqual([title]);
    const other = {...file, artifactId: "019c1a00-0000-7000-8000-000000000022", ordinal: 1};
    deliver([file, {...announced, artifactId: other.artifactId, ordinal: other.ordinal}, other]);
    await flushPromises();
    expect(titles()).toEqual([title, title]);

    vi.spyOn(chatClient, "listDraftAttachments").mockResolvedValue([]);
    await store.clearSelectedSession();
    let resume!: () => void;
    vi.spyOn(chatClient, "getSessionPurpose").mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { resume = resolve; });
      return {sessionId: SESSION_ID, purpose: "ordinary"};
    });
    const reopening = store.selectSession(SESSION_ID);
    try {
      await flushPromises();
      expect(store.readingView.cached).toBe(true);
      expect(titles()).toEqual([title, title]);
      expect(wrapper.findAllComponents(ChatArtifactList).flatMap(list => list.props("artifacts").map(record => record.artifactId)))
        .toEqual([file.artifactId, other.artifactId]);
      expect(wrapper.findAll(".chat-file-link")).toHaveLength(2);
    } finally {
      await store.clearSelectedSession();
      resume();
      await reopening;
    }
  });

  it.skipIf(!kimiK31Candidate)("hides the duplicate preview trigger while open and restores keyboard focus after collapsing", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1028);
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    try {
      const submit = vi.spyOn(store, "submitTurn");
      await wrapper.get('[aria-label="展开右侧面板"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[aria-label="展开右侧面板"]').exists()).toBe(false);
      expect(wrapper.findAll('[aria-label="收起右侧面板"]')).toHaveLength(1);
      await wrapper.get('[aria-label="收起右侧面板"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[aria-label="收起右侧面板"]').exists()).toBe(false);
      expect(document.activeElement).toBe(wrapper.get('[aria-label="展开右侧面板"]').element);
      expect(submit).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it("anchors the latest turn for repeated sidebar clicks without resubmitting or reloading history", async () => {
    const latestId = "019c1a00-0000-7000-8000-000000000099";
    const history: ChatHistoryPage = { ...HISTORY, turns: [...HISTORY.turns, {
      ...HISTORY.turns[0]!, turnId: latestId, reasoning: [], terminalAt: 6,
      messages: [{ messageId: "019c1a00-0000-7000-8000-000000000098", role: "user", content: "最新一轮问题", status: "complete", ordinal: 3, createdAt: 5 }],
    }] };
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true, history);
    const reading = useChatReadingStore(pinia);
    const submit = vi.spyOn(store, "submitTurn");
    const reload = vi.spyOn(store, "selectSession");
    const anchor = wrapper.get(`[data-turn-id="${latestId}"]`).element as HTMLElement;
    const focus = vi.spyOn(anchor, "focus");
    scroll.mockClear();
    for (let click = 1; click <= 2; click++) {
      reading.requestLatest(SESSION);
      await flushPromises();
      expect(scroll).not.toHaveBeenCalled();
      expect(focus).toHaveBeenCalledTimes(click);
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
      expect(document.activeElement).toBe(anchor);
      expect(reading.latestRequest).toBeNull();
    }
    expect(reading.receipts[0]?.turnId).toBe(latestId);
    expect(submit).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("waits for the requested history to render before anchoring and does not substitute an older turn", async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
    focus.mockClear();
    const reading = useChatReadingStore(pinia);
    store.phase = "resyncing";
    store.history = null;
    reading.requestLatest(SESSION);
    await flushPromises();
    expect(scroll).not.toHaveBeenCalled();
    expect(focus.mock.contexts.filter(element => (element as HTMLElement).dataset.turnId)).toHaveLength(0);
    expect(reading.latestRequest).not.toBeNull();
    setHistoryProjection(store, HISTORY);
    store.phase = "ready";
    await flushPromises();
    expect(scroll).not.toHaveBeenCalled();
    expect(focus.mock.contexts.filter(element => (element as HTMLElement).dataset.turnId)
      .map(element => (element as HTMLElement).dataset.turnId)).toEqual([TURN_ID]);
    expect(document.activeElement).toBe(wrapper.get(`[data-turn-id="${TURN_ID}"]`).element);
    expect(reading.latestRequest).toBeNull();
    wrapper.unmount();
  });

  it("shows the decorative mascot only on the new-task homepage and keeps it out of a conversation", async () => {
    const { wrapper, router } = await mountPage("/chat");
    expect(wrapper.find(".home-mascot[aria-hidden=true]").exists()).toBe(true);
    expect(wrapper.get(".home-mascot").attributes("data-phase")).toBe("static"); // reduced-motion preference
    expect(wrapper.get(".home-mascot").attributes("data-frame")).toBe("-1");
    await wrapper.get("textarea").setValue("本地输入检查");
    expect(wrapper.get(".home-mascot").attributes("data-frame")).toBe("-1");
    await router.push(`/chat/${SESSION_ID}`);
    await flushPromises();
    expect(wrapper.find(".home-mascot").exists()).toBe(false);
    wrapper.unmount();
  });
  it("replays the opening after leaving a session but not on duplicate new-task navigation", async () => {
    const { wrapper, router } = await mountPage("/chat");
    let now = 0;
    let sequence = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++sequence, callback);
      return sequence;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

    await router.push(`/chat/${SESSION_ID}`);
    await flushPromises();
    expect(wrapper.find(".home-opening").exists()).toBe(false);
    await router.push("/chat");
    await flushPromises();
    expect(wrapper.get(".home-opening").attributes("data-animating")).toBe("true");

    const heading = wrapper.get<HTMLHeadingElement>("#new-task-title").element;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    now = 300;
    const afterNavigation = [...frames.values()];
    frames.clear();
    afterNavigation.forEach(callback => callback(now));
    await flushPromises();
    expect(document.activeElement).toBe(heading);
    expect(wrapper.get(".home-opening").attributes("data-animating")).toBe("true");

    now = 2200;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
    await flushPromises();
    expect(wrapper.get(".home-opening").attributes("data-animating")).toBe("false");
    await router.push("/chat");
    await flushPromises();
    expect(wrapper.get(".home-opening").attributes("data-animating")).toBe("false");
    expect(frames.size).toBe(0);

    await router.push(`/chat/${SESSION_ID}`);
    await router.push("/chat");
    await flushPromises();
    expect(wrapper.get(".home-opening").attributes("data-animating")).toBe("true");
    wrapper.get<HTMLTextAreaElement>("textarea").element.focus();
    now += 160;
    const afterInput = [...frames.values()];
    frames.clear();
    afterInput.forEach(callback => callback(now));
    await flushPromises();
    expect(wrapper.get(".home-opening").attributes("data-animating")).toBe("false");
    wrapper.unmount();
    expect(frames.size).toBe(0);
  });

  it("shows the task title without a workspace row and reserves the subtitle for scheduled drafts", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true, HISTORY, undefined, false, { ScheduledDraftPanel: true });
    store.liveTurnStatus = "completed";
    await flushPromises();
    const header = wrapper.get(".chat-workspace__header");
    expect(header.get("h1").text()).toBe(SESSION.title);
    expect(header.find(".chat-workspace__meta").exists()).toBe(false);
    expect(header.text()).not.toContain(PROJECT.safeName);
    expect(header.text()).not.toContain("已完成");
    expect(wrapper.get('.chat-workspace > .sr-only[aria-live="polite"]').text()).toBe("已完成");

    store.sessions = [{ ...SESSION, projectId: null }];
    await flushPromises();
    expect(header.find(".chat-workspace__meta").exists()).toBe(false);
    expect(header.get("h1").text()).toBe(SESSION.title);
    store.selectedSessionPurpose = "scheduled_plan_draft";
    await flushPromises();
    expect(header.get(".chat-workspace__meta").text()).toBe("定时任务草案 · 仅输入文本");
    wrapper.unmount();
  });

  it("announces Host identity binding without presenting a missing-resource failure", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);

    store.history = null;
    store.phase = "binding-pending";
    store.lastErrorCode = null;
    await flushPromises();

    expect(wrapper.get(".chat-workspace__conversation").attributes("aria-busy")).toBe("true");
    expect(wrapper.get('.chat-workspace > .sr-only[aria-live="polite"]').text())
      .toBe("正在建立安全任务连接");
    expect(wrapper.text()).not.toContain("任务不可用");
  });

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

  it("shows a visited task immediately during native revalidation without enabling submission", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    vi.spyOn(chatClient, "listDraftAttachments").mockResolvedValue([]);
    await store.clearSelectedSession();
    let reject!: (error: unknown) => void;
    vi.spyOn(chatClient, "getSessionPurpose").mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const returning = store.selectSession(SESSION_ID);
    await flushPromises();
    expect(wrapper.text()).toContain("标题检查完成");
    expect(wrapper.text()).not.toContain("正在读取本地对话");
    expect(store.readingView.cached).toBe(true);
    expect(store.canSend).toBe(false);
    reject(new ChatClientError({schemaVersion: 1, code: "chat_capability_denied", retryable: false, recovery: "none"}));
    await returning; await flushPromises();
    expect(wrapper.text()).not.toContain("标题检查完成");
    expect(wrapper.text()).toContain("当前工作区权限不足");
  });

  it.skipIf(!chatModelsEnabled)("blocks the model selector and stale selection events for history-only or denied tasks", async () => {
    const select = vi.spyOn(chatModelClient, "select");
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    await flushPromises();
    const control = wrapper.getComponent(ChatModelControl);
    expect(control.props("disabled")).toBe(false);
    store.selectedAccessMode = "history-only";
    await flushPromises();
    expect(control.props("disabled")).toBe(true);
    expect(control.props("disabledReason")).toContain("仅可查看");
    control.vm.$emit("select", kimiProfile);
    await flushPromises();
    expect(select).not.toHaveBeenCalled();
    store.selectedAccessMode = "live";
    store.context = {...store.context!, allowedActions:["read_sessions"]};
    await flushPromises();
    expect(control.props("disabled")).toBe(true);
    control.vm.$emit("select", kimiProfile);
    await flushPromises();
    expect(select).not.toHaveBeenCalled();
  });

  it.skipIf(!chatModelsEnabled || !kimiK31Candidate)("lists MiniMax first and sends a fresh draft with it while Kimi is paused", async () => {
    vi.mocked(chatModelClient.catalog).mockResolvedValue(parseModelCatalog({
      schema_version: 2,
      default_profile: "kimi-k3-1-pro-high-v1",
      models: currentModelDefinitions.map(profile => profile.provider === "kimi"
        ? { profile, available: false, reason: "activation_required" }
        : { profile, available: true, reason: "ready" }),
    }));
    const { wrapper, store } = await mountPage("/chat");
    const create = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    try {
      const composer = wrapper.getComponent(ChatComposer);
      const input = composer.get("textarea");
      const send = composer.get<HTMLButtonElement>(".chat-composer__send");
      const draft = "保留当前草稿";
      await input.setValue(draft);
      const trigger = composer.get(".model-trigger");
      expect(trigger.text()).toBe("MiniMax-M3");
      await trigger.trigger("click");
      await flushPromises();
      const menu = new DOMWrapper(document.querySelector(".model-menu")!);
      const options = menu.findAll<HTMLButtonElement>('button[role="menuitemradio"]');
      expect(options.map(option => option.get(".model-option-label").text()))
        .toEqual(["MiniMax-M3", "Kimi K3.1 Pro", "Deepseek-V4-Pro", "GLM-5.3"]);
      expect(options[0]!.attributes("aria-checked")).toBe("true");
      expect(options.map(option => option.element.disabled)).toEqual([false, true, true, true]);
      await menu.trigger("keydown", { key: "Escape" });
      expect(input.element.value).toBe(draft);
      expect(send.element.disabled).toBe(false);
      await send.trigger("click");
      await flushPromises();
      expect(create).toHaveBeenCalledExactlyOnceWith(null, draft, { profileId: "minimax-m3-high-v1", expectedRevision: 0 });
    } finally { wrapper.unmount(); }
  });

  it.skipIf(!chatModelsEnabled)("keeps the draft until an available model is selected when MiniMax is unavailable", async () => {
    const profiles = kimiK31Candidate ? currentModelDefinitions : modelDefinitions;
    vi.mocked(chatModelClient.catalog).mockResolvedValue(parseModelCatalog({
      schema_version: kimiK31Candidate ? 2 : 1,
      default_profile: kimiProfile,
      models: profiles.map(profile => profile.provider === "minimax"
        ? { profile, available: false, reason: "not_configured" }
        : { profile, available: true, reason: "ready" }),
    }));
    const { wrapper, store } = await mountPage("/chat");
    const create = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    const composer = wrapper.getComponent(ChatComposer);
    const input = composer.get("textarea");
    const send = composer.get<HTMLButtonElement>(".chat-composer__send");
    await input.setValue("保留当前草稿");
    expect(send.element.disabled).toBe(true);
    await input.trigger("keydown", { key: "Enter" });
    expect(create).not.toHaveBeenCalled();
    await composer.get(".model-trigger").trigger("click");
    await flushPromises();
    const menu = new DOMWrapper(document.querySelector(".model-menu")!);
    expect(menu.get('[aria-checked="true"]').get(".model-option-label").text()).toBe("MiniMax-M3");
    await menu.get('button:not(:disabled)').trigger("click");
    expect(input.element.value).toBe("保留当前草稿");
    expect(send.element.disabled).toBe(false);
    await send.trigger("click");
    await flushPromises();
    expect(create).toHaveBeenCalledExactlyOnceWith(null, "保留当前草稿", { profileId: kimiProfile, expectedRevision: 0 });
  });

  it.skipIf(!chatModelsEnabled || !kimiK31Candidate)("holds the model label and send button through a pending model switch", async () => {
    vi.spyOn(chatModelClient, "state").mockResolvedValue({ profileId: kimiProfile, revision: 0, state: "ready" });
    let confirm!: (result: ModelState) => void;
    vi.spyOn(chatModelClient, "select").mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    const { wrapper } = await mountPage(`/chat/${SESSION_ID}`, true);
    try {
      const composer = wrapper.getComponent(ChatComposer);
      const textarea = composer.get("textarea");
      const send = composer.get<HTMLButtonElement>(".chat-composer__send");
      const trigger = composer.get(".model-trigger");
      await textarea.setValue("继续当前草稿");
      expect(send.element.disabled).toBe(false);
      await trigger.trigger("click");
      await flushPromises();
      const menu = new DOMWrapper(document.querySelector(".model-menu")!);
      expect(menu.get('[role="menuitemradio"]').text()).toBe("MiniMax-M3");
      expect(menu.get('[aria-checked="true"]').text()).toBe("Kimi K3.1 Pro");
      await menu.findAll('button[role="menuitemradio"]').find(option => option.text() === "MiniMax-M3")!.trigger("click");
      expect(trigger.text()).toBe("Kimi K3.1 Pro");
      expect(trigger.attributes("aria-busy")).toBe("true");
      expect(send.element.disabled).toBe(true);
      expect(send.attributes("aria-busy")).toBe("true");
      send.element.click();
      await textarea.trigger("keydown", { key: "Enter" });
      expect(composer.emitted("submit")).toBeUndefined();
      await textarea.setValue("");
      expect(send.attributes("aria-busy")).toBeUndefined();
      expect(send.element.disabled).toBe(true);
      await textarea.setValue("继续当前草稿");
      confirm({ profileId: "minimax-m3-high-v1", revision: 1, state: "ready" });
      await flushPromises();
      expect(trigger.text()).toBe("MiniMax-M3");
      expect(composer.get(".chat-composer__send").element).toBe(send.element);
      expect(send.attributes("aria-busy")).toBeUndefined();
      expect(send.element.disabled).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it.skipIf(!chatModelsEnabled || !kimiK31Candidate)("keeps model recovery beside its error and waits for an explicit retry", async () => {
    const pending = { operationId: crypto.randomUUID(), profileId: "minimax-m3-high-v1" as const, expectedRevision: 1, recoveryAvailable: true };
    vi.spyOn(chatModelClient, "state").mockResolvedValue({ profileId: "kimi-k3-max-v1", revision: 1, state: "unknown", pending });
    const recover = vi.spyOn(chatModelClient, "recover").mockResolvedValue({ profileId: pending.profileId, revision: 2, state: "ready" });
    const { wrapper } = await mountPage(`/chat/${SESSION_ID}`, true);
    try {
      const retry = wrapper.get('.chat-workspace__model-notice[role="status"] button');
      expect(retry.text()).toBe("继续切换");
      expect(wrapper.get(".chat-workspace__model-notice").text()).toContain("MiniMax M3");
      expect(wrapper.get(".model-trigger").attributes("disabled")).toBeDefined();
      expect(recover).not.toHaveBeenCalled();
      await retry.trigger("click");
      await flushPromises();
      expect(recover).toHaveBeenCalledOnce();
      expect(wrapper.get(".model-trigger").text()).toBe("MiniMax-M3");
      expect(wrapper.find(".chat-workspace__model-notice").exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it.skipIf(!chatModelsEnabled)("resets the model when leaving a discarded new scheduled draft", async () => {
    const select = vi.spyOn(chatModelClient, "select");
    const {wrapper,router} = await mountPage("/chat?create=schedule", false, HISTORY, async () => false, false, {ScheduledDraftPanel: true});
    await flushPromises();
    wrapper.getComponent(ChatModelControl).vm.$emit("select", kimiProfile);
    await flushPromises();
    expect(wrapper.getComponent(ChatModelControl).props("profile")).toBe(kimiProfile);
    await router.push("/chat");
    await flushPromises();
    expect(wrapper.getComponent(ChatModelControl).props("profile")).toBe(newChatProfile);
    expect(select).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.skipIf(!kimiK31Candidate)("FEAT164 resets discarded shared plan draft to the current model without changing chat intent", async () => {
    expertFlag.enabled = true;
    const select = vi.spyOn(chatModelClient, "select");
    const {wrapper,router,pinia} = await mountPage("/chat?create=schedule", false, HISTORY, async () => false, false, {ScheduledDraftPanel: true});
    const drafts = useChatComposerDraftStore(pinia);
    drafts.newProfile = kimiProfile;
    wrapper.getComponent(ChatModelControl).vm.$emit("select", kimiProfile);
    await flushPromises();
    expect(drafts.planProfile).toBe(kimiProfile);
    await router.push("/chat"); await flushPromises();
    expect(drafts.planProfile).toBe(newChatProfile);
    expect(drafts.newProfile).toBe(kimiProfile);
    await router.push("/chat?create=schedule"); await flushPromises();
    expect(wrapper.getComponent(ChatModelControl).props("profile")).toBe(newChatProfile);
    expect(select).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows stale terminal tasks as local read-only history without a protocol error", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    store.selectedAccessMode = "history-only";
    store.controlPlane = {
      sessionId: SESSION_ID,
      state: "failed",
      issueCode: "chat_protocol_error",
      retryable: false,
      recovery: "resync",
    };
    store.lastErrorCode = null;
    await flushPromises();

    expect(wrapper.text()).toContain("标题检查完成");
    expect(wrapper.text()).toContain("此任务仅保留本地历史记录，当前无法继续发送。");
    expect(wrapper.text()).not.toContain("本地组件状态不一致");
    expect(store.canSend).toBe(false);
    expect(store.canAttach).toBe(false);
    expect(store.canDecideApprovals).toBe(false);
    expect(wrapper.getComponent(ChatComposer).props("canSend")).toBe(false);
  });

  it("routes history-only read failures to local history resync before draft recovery", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    const resyncSelected = vi.spyOn(store, "resyncSelected").mockImplementation(async () => {
      store.lastErrorCode = null;
      store.phase = "ready";
    });
    const retryDraftRecovery = vi.spyOn(store, "retryDraftRecovery");
    store.selectedAccessMode = "history-only";
    store.draftTarget = null;
    store.draftTargetReady = false;
    store.lastErrorCode = "chat_temporarily_unavailable";
    store.phase = "unavailable";
    await flushPromises();

    await wrapper.get(".chat-workspace__composer-error button").trigger("click");
    await flushPromises();

    expect(resyncSelected).toHaveBeenCalledOnce();
    expect(retryDraftRecovery).not.toHaveBeenCalled();
  });

  it("retries a failed history activation before readiness or draft recovery", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    const selectSession = vi.spyOn(store, "selectSession").mockImplementation(async () => {
      store.selectedAccessMode = "history-only";
      store.lastErrorCode = null;
      store.phase = "ready";
    });
    const retryDraftRecovery = vi.spyOn(store, "retryDraftRecovery");
    const requestLocalRecovery = vi.spyOn(store, "requestLocalRecovery");
    const refreshLocalReadiness = vi.spyOn(store, "refreshLocalReadiness");
    store.selectedAccessMode = null;
    store.lastErrorCode = "chat_temporarily_unavailable";
    store.phase = "unavailable";
    await flushPromises();

    await wrapper.get(".chat-workspace__composer-error button").trigger("click");
    await flushPromises();

    expect(selectSession).toHaveBeenCalledWith(SESSION_ID);
    expect(retryDraftRecovery).not.toHaveBeenCalled();
    expect(requestLocalRecovery).not.toHaveBeenCalled();
    expect(refreshLocalReadiness).not.toHaveBeenCalled();
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
    expect(wrapper.findAll(".chat-file-chip")).toHaveLength(1);
    expect(wrapper.text()).toContain("synthetic-brief.pdf");
    expect(wrapper.get(".chat-file-chip").attributes("aria-label")).toContain("PDF");

    const userCopy = wrapper.get('.chat-timeline-item-shell__user-meta [aria-label="复制文本"]');
    const answerCopy = wrapper.get('.chat-answer-actions [aria-label="复制"]');
    expect(wrapper.findAll(".chat-copy-action")).toHaveLength(2);
    expect(userCopy.get("svg").html()).toBe(answerCopy.get("svg").html());
    await userCopy.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith("检查标题");
    expect(wrapper.find(".chat-timeline-item-shell__user-meta .chat-copy-action__feedback").exists()).toBe(false);
    expect(userCopy.get("svg").html()).not.toBe(answerCopy.get("svg").html());
    await answerCopy.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenNthCalledWith(2, "标题检查完成");
    expect(wrapper.get(".chat-answer-actions [role='status']").text()).toContain("已复制");
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
    store.conversationState = viewFromLegacySnapshot({
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

    const advanceFrame = async (time: number) => {
      const current = [...callbacks.values()]; callbacks.clear();
      current.forEach(callback => callback(time));
      await flushPromises();
    };
    // Settle mount/layout callbacks before measuring the streaming update.
    for (let frame = 1; frame <= 3; frame++) await advanceFrame(frame * 16);
    scrollTo.mockClear();
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    let top = 0;
    const writeTop = vi.fn((value: number) => { top = value; });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => top, set: writeTop });
    setChatRenderMeasurementEnabled(true);
    store.phase = "streaming";
    for (let revision = 1; revision <= 100; revision++) {
      store.conversationState = { ...store.conversationState };
    }
    await flushPromises();
    expect(chatRenderMeasurements().timeline?.samples ?? 0).toBe(0);
    for (let frame = 4; frame <= 6; frame++) {
      const before = writeTop.mock.calls.length;
      await advanceFrame(frame * 16);
      expect(writeTop.mock.calls.length - before).toBeLessThanOrEqual(1);
    }
    expect(chatRenderMeasurements().timeline?.samples).toBe(1);
    expect(top).toBe(800);
    expect(scrollTo).not.toHaveBeenCalled(); // automatic following does not restart smooth scrolling
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
    expect(callbacks.size).toBeGreaterThan(0);

    store.sessions = [SESSION, {
      ...SESSION,
      sessionId: secondSessionId,
      title: "第二个本地任务",
    }];
    store.conversationState = viewFromLegacySnapshot({
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

    // Layout/transition frames may remain, but none can restore the old session.
    for (let frame = 1; frame <= 3; frame++) {
      const current = [...callbacks.values()]; callbacks.clear();
      current.forEach(callback => callback(frame * 16));
      await flushPromises();
    }
    expect(wrapper.text()).toContain("第二个本地任务");
    expect(wrapper.text()).toContain("第二个会话的回答");
    expect(wrapper.text()).not.toContain("标题检查完成");
  });

  it("waits for turn completion and the final text reveal after an unphased search update", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true, { turns: [], nextCursor: null }, undefined, true);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    vi.spyOn(window, "matchMedia").mockReturnValue({ ...media, matches: false });
    const items: NativeItem[] = [traceItem("user", "userMessage", { text: "请核对商品规格。" })];
    let revision = 0;
    async function publish(streamingItem: string | null = null, completed = false) {
      store.conversationState = composeConversationView({
        threads: [{ threadId: SESSION_ID, status: completed ? "ready" : "active" }], turns: [], items: [],
      }, [{
        sessionId: SESSION_ID, turnId: TURN_ID, runtimeThreadId: SESSION_ID, runtimeTurnId: TURN_ID,
        source: "native_observed", statusSource: "runtime_notification", availability: "available",
        revision: String(++revision), status: completed ? "completed" : "inProgress", terminalObserved: completed,
        items: items.map((item, ordinal) => ({
          item, ordinal, lastMethod: item.id === streamingItem ? "item/started" : "item/completed",
        })),
      }]);
      store.nativeLiveTurnId = completed ? null : TURN_ID;
      store.phase = completed ? "ready" : "streaming";
      await vi.advanceTimersByTimeAsync(48);
    }
    const search = (id: string) => traceItem(id, "webSearch", { webSearch: { action: "search", queries: ["规格"] } });
    const reasoning = (id: string) => traceItem(id, "reasoning", { summary: ["整理查询结果。"] });
    const footer = ".chat-timeline-item-shell__answer-actions, .chat-turn-output__actions";
    try {
      // The November 19 Blink turn projected three searches, each followed by reasoning.
      items.push(search("search-1"), reasoning("reason-1"));
      await publish();
      const interim = "已核对公开规格，下面给出具体建议。";
      items.push(traceItem("interim", "agentMessage", { phase: null, text: interim }));
      await publish("interim");
      await publish();
      await vi.advanceTimersByTimeAsync(2_000);
      const midRow = wrapper.get(".chat-turn-group__item--assistant_unclassified");
      expect(midRow.isVisible()).toBe(true);
      expect(midRow.get(".chat-safe-content").text()).toBe(interim);
      expect(midRow.find(".chat-stream-text__fresh").exists()).toBe(false);
      expect(midRow.find(".chat-copy-action").exists()).toBe(false);
      expect(wrapper.find(footer).exists()).toBe(false);
      expect(wrapper.get(".chat-timeline-item-shell__user-meta [aria-label='复制文本']").isVisible()).toBe(true);
      for (const item of [search("search-2"), reasoning("reason-2"), search("search-3"), reasoning("reason-3")]) {
        items.push(item);
        await publish();
        expect(wrapper.find(footer).exists()).toBe(false);
      }
      const answer = "这是核对后的最终建议。".repeat(10);
      items.push(traceItem("answer", "agentMessage", { phase: "final_answer", text: answer }));
      await publish("answer");
      await publish();
      expect(wrapper.find(footer).exists()).toBe(false);
      await publish(null, true);
      const finalRow = wrapper.get(".chat-turn-group__item--final_answer");
      expect(finalRow.get(".chat-safe-content").text().length).toBeLessThan(answer.length);
      expect(wrapper.find(footer).exists()).toBe(false);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(finalRow.get(".chat-safe-content").text()).toBe(answer);
      expect(finalRow.find(".chat-stream-text__fresh").exists()).toBe(false);
      expect(wrapper.findAll(footer)).toHaveLength(1);
      for (const label of ["复制", "点赞", "点踩"]) {
        expect(finalRow.get(`.chat-answer-actions [aria-label="${label}"]`).isVisible()).toBe(true);
      }
      await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
      const savedInterim = wrapper.get(".chat-turn-group__item--assistant_unclassified");
      expect(savedInterim.isVisible()).toBe(true);
      expect(savedInterim.find(".chat-copy-action").exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
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
    const codeCopy = wrapper.get('[aria-label="复制信息"]');
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
    expect(wrapper.find(".chat-deep-thinking").exists()).toBe(false);
    expect(wrapper.find(".chat-deep-thinking__content").exists()).toBe(false);
    expect(wrapper.text()).toContain("标题检查完成");
    expect(loadReasoning).not.toHaveBeenCalled();
  });

  it("does not enter the legacy renderer when the default selector has no Thread", async () => {
    const { wrapper, store } = await mountPage(
      `/chat/${SESSION_ID}`,
      true,
      HISTORY_WITHOUT_REASONING,
    );

    store.conversationState = emptyConversationView();
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
      { turns: [{ ...HISTORY_WITHOUT_REASONING.turns[0]!, status: "queued", terminalAt: null,
        reasoning: [], messages: [HISTORY_WITHOUT_REASONING.turns[0]!.messages[0]!] }], nextCursor: null },
    );
    // A live state needs an observed Native notification, not a legacy archive.
    store.conversationState = composeConversationView(
      { threads: [{ threadId: SESSION_ID, status: "active" }], turns: [], items: [] },
      [{ sessionId: SESSION_ID, turnId: TURN_ID, runtimeThreadId: SESSION_ID, runtimeTurnId: TURN_ID,
        source: "native_observed", revision: "1", availability: "available", status: "inProgress",
        statusSource: "runtime_notification", terminalObserved: false,
        items: [{ item: { id: `${TURN_ID}:reasoning:0`, type: "reasoning", summary: [], content: [], availability: "available" }, lastMethod: "item/started", ordinal: 0 }] }],
    );
    store.phase = "streaming";
    store.nativeLiveTurnId = TURN_ID;
    await flushPromises();

    expect(wrapper.findComponent(ChatTimeline).exists()).toBe(true);
    expect(wrapper.find(".chat-turn").exists()).toBe(false);
    expect(wrapper.getComponent(ChatTimeline).props("timeline").turns[0]).toMatchObject({ liveObserved: true, domainStatus: "in_progress", source: "native_observed", progress: { phase: "active" } });
    expect(wrapper.text()).toContain("正在思考");
    expect(wrapper.get(".chat-turn-group__timing").text()).toBe("正在思考");
    expect(wrapper.text()).not.toContain("当前进度待确认");
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

  it.each(["image", "video"] as const)("hides %s IDs in the conversation and forwards the matching user request for media naming", async kind => {
    const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true, HISTORY, async () => false, false, { ChatArtifactList: true });
    const id = "019c1a00-0000-7000-8000-000000000021";
    const request = "一瓶冰镇气泡果汁，动态飞溅摄影";
    const artifactHistory: ChatHistoryPage = {
      turns: [{ ...HISTORY.turns[0]!, reasoning: [], messages: [
        { ...HISTORY.turns[0]!.messages[0]!, content: request, contentBlocks: [{ type: "text", text: request }] },
        { ...HISTORY.turns[0]!.messages[1]!, content: `已生成并交付。\n\n产物 ID：\`${id}\`` },
      ], artifacts: [{ artifactId: id, kind, provenance: "provider", status: "ready", ordinal: 0,
        progressStage: null, progressPercent: null, displayName: kind === "image" ? "generated-image" : "生成的视频.mp4",
        mediaType: kind === "image" ? "image/jpeg" : "video/mp4", sizeBytes: 32, localCommittedAt: 1000, expiresAt: 2_000_000_000,
        hasPoster: false, errorCode: null, retryable: null,
      }] }], nextCursor: null,
    };
    const artifacts = useArtifactStore(pinia);
    artifacts.replaceAuthority({ authorizationRevision: 7, contextId: store.context!.contextId, tenantId: PROJECT_ID, sessionId: SESSION_ID });
    artifacts.ingestHistoryV3(artifacts.captureAuthority(), artifactHistory);
    setHistoryProjection(store, artifactHistory); await flushPromises();
    expect(wrapper.text()).toContain("已生成并交付。");
    expect(wrapper.text()).not.toContain("产物 ID");
    expect(wrapper.text()).not.toContain(id);
    expect(wrapper.getComponent(ChatArtifactList).props("userRequest")).toBe(request);
    expect(store.history!.turns[0]!.messages[1]!.content).toContain(id);
    expect(wrapper.getComponent(ChatArtifactList).props("artifacts")[0]!.artifactId).toBe(id);
    wrapper.unmount();
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
    expect(wrapper.findAllComponents(ChatAttachmentChip)).toHaveLength(1);
    expect(wrapper.findAllComponents(ChatArtifactList)).toHaveLength(1);
    const list = wrapper.getComponent(ChatArtifactList);
    expect(list.props("contextId")).toBe(store.context!.contextId);
    expect(list.props("nativeClient")).toBe(chatArtifactNativeClient);
    expect(list.props("videoNativeClient")).toBe(chatArtifactVideoNativeClient);
    expect(list.props("fileNativeClient")).toBe(chatArtifactFileNativeClient);
    expect(list.props("reportNativeClient")).toBe(chatArtifactReportNativeClient);
    expect(wrapper.text()).toContain("safe-metadata.txt");
    expect(wrapper.find(".artifact-list").exists()).toBe(true);
    expect(wrapper.getComponent(ChatTimeline).props("deliveredArtifactTurnIds")?.has(TURN_ID)).toBe(false);
    artifacts.applyProjection(artifacts.captureAuthority(), TURN_ID, {
      ...artifactHistory.turns[0]!.artifacts![0]!, status: "ready", mediaType: "text/plain", sizeBytes: 32,
      localCommittedAt: 1000, expiresAt: 2_000_000_000,
    });
    await flushPromises();
    expect(wrapper.getComponent(ChatTimeline).props("deliveredArtifactTurnIds")?.has(TURN_ID)).toBe(true);
    artifacts.clearAuthority(); await flushPromises();
    expect(wrapper.getComponent(ChatTimeline).props("deliveredArtifactTurnIds")?.has(TURN_ID)).toBe(false);
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
    expect(createSession).toHaveBeenCalledWith(null, "检查标题", ...newTaskModelArgs);
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
    expect(document.activeElement).toBe(wrapper.get("textarea").element);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="可添加文件、技能、连接器"]').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/模型选择|推理强度|语音输入/);
  });

  it("creates a projectless task from the real composer when no local project is selected", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    store.projects = [];
    const createSession = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    await flushPromises();
    expect(wrapper.get(".chat-composer__project").text()).toBe("选择工作空间");
    await wrapper.get("textarea").setValue("无项目任务");
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeUndefined();
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    expect(createSession).toHaveBeenCalledWith(null, "无项目任务", ...newTaskModelArgs);
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
  });

  it("does not reuse a removed history project's hidden ID when returning to a new task", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    store.sessions = [{ ...SESSION, projectId: SECOND_PROJECT.projectId, projectAvailable: false }];
    store.selectedSessionId = SESSION_ID;
    store.selectedSessionPurpose = "ordinary";
    store.selectedAccessMode = "live";
    store.draftTarget = chatSessionDraftTarget(SESSION_ID);
    await router.push(`/chat/${SESSION_ID}`);
    await flushPromises();
    await router.push("/chat");
    store.selectedSessionId = null;
    store.selectedSessionPurpose = null;
    store.selectedAccessMode = null;
    store.draftTarget = CHAT_NEW_DRAFT_TARGET;
    store.draftTargetReady = true;
    const create = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    await flushPromises();
    expect(wrapper.get(".chat-composer__project").text()).toBe("选择工作空间");
    await wrapper.get("textarea").setValue("今天周几？");
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    expect(create).toHaveBeenCalledWith(null, "今天周几？", ...newTaskModelArgs);
    expect(wrapper.text()).not.toContain("任务不可用");
    wrapper.unmount();
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
    expect(wrapper.get('[aria-label="可添加文件、技能、连接器"]').attributes("disabled")).toBeUndefined();
    await wrapper.get("textarea").setValue("重新开始任务");
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeUndefined();
  });

  it("opens the workspace menu before using the native project selection entry", async () => {
    vi.spyOn(chatWorkspaceClient, "catalog").mockResolvedValue({ rootPath: "/Users/example/Yijie/Workspaces", workspaces: [] });
    const { wrapper, store, router } = await mountPage("/chat");
    const pickProject = vi.spyOn(store, "pickProject").mockImplementation(async () => {
      store.projects = [PROJECT, SECOND_PROJECT];
      return SECOND_PROJECT;
    });
    const createSession = vi.spyOn(store, "createSessionWithResult")
      .mockResolvedValue(acceptedSubmission());
    expect(wrapper.get(".chat-composer__project").text()).toBe("选择工作空间");
    expect(wrapper.find("select").exists()).toBe(false);
    await wrapper.get(".chat-composer__project--button").trigger("click");
    await flushPromises();
    expect(pickProject).not.toHaveBeenCalled();
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.includes("打开本地文件夹"))!.click();
    await flushPromises();
    expect(pickProject).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".chat-composer__project").text()).toBe("Second Synthetic Workspace");

    await wrapper.get("textarea").setValue("使用新项目");
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    expect(createSession).toHaveBeenCalledWith(SECOND_PROJECT.projectId, "使用新项目", ...newTaskModelArgs);
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
  });

  it("keeps shop association as UI-only state without changing the submitted message", async () => {
    const { wrapper, store } = await mountPage("/chat");
    const control = wrapper.getComponent(ChatShopControl);
    const model = control.props("model");
    expect(wrapper.get('.chat-composer__leading-actions .shop-trigger').text()).toContain('关联店铺');
    vi.useFakeTimers(); model.authorize(); await vi.advanceTimersByTimeAsync(SHOP_PREVIEW_TIMING.authorization);
    model.choose(PREVIEW_SHOPS[0]!.id); model.link(); await vi.advanceTimersByTimeAsync(SHOP_PREVIEW_TIMING.linking);
    vi.useRealTimers(); await flushPromises();
    const create = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    await wrapper.get("textarea").setValue("分析最近一周的差评");
    await wrapper.get('[aria-label="发送任务"]').trigger('click'); await flushPromises();
    expect(create).toHaveBeenCalledWith(null, "分析最近一周的差评", ...newTaskModelArgs);
    expect(model.current.value?.id).toBe(PREVIEW_SHOPS[0]!.id);
    wrapper.unmount();
  });

  it.each([false, true])("submits a sidebar workspace task under that workspace (shared drafts=%s)", async shared => {
    expertFlag.enabled = shared;
    const { wrapper, store, router, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
    store.projects = [PROJECT, SECOND_PROJECT];
    vi.spyOn(store, "clearSelectedSession").mockImplementation(async () => {
      store.selectedSessionId = null;
      store.selectedAccessMode = null;
      store.selectedSessionPurpose = null;
      store.history = null;
      store.draftTarget = CHAT_NEW_DRAFT_TARGET;
      store.draftTargetReady = true;
    });
    const createSession = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    const sidebar = mount(ChatSidebarTree, {
      props: { currentPath: `/chat/${SESSION_ID}` },
      global: { plugins: [pinia, router] },
    });
    try {
      const button = sidebar.get(`[aria-label="在工作空间 ${SECOND_PROJECT.safeName} 中新建任务"]`);
      await button.trigger("click"); await flushPromises();
      expect(router.currentRoute.value.path).toBe("/chat");
      const picker = wrapper.getComponent(ChatWorkspaceControl);
      expect(picker.props("selectedProjectId")).toBe(SECOND_PROJECT.projectId);
      expect(useChatComposerDraftStore(pinia).newWorkspaceTask).toBeNull();
      expect(createSession).not.toHaveBeenCalled();
      picker.vm.$emit("select", PROJECT_ID); await flushPromises();
      store.projects = [...store.projects]; await flushPromises();
      expect(picker.props("selectedProjectId")).toBe(PROJECT_ID);
      // Repeated clicks on the same /chat route must still choose this workspace.
      await button.trigger("click"); await flushPromises();
      expect(picker.props("selectedProjectId")).toBe(SECOND_PROJECT.projectId);
      await wrapper.get("textarea").setValue("在所选工作空间开始任务");
      await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
      expect(createSession).toHaveBeenCalledOnce();
      expect(createSession).toHaveBeenCalledWith(SECOND_PROJECT.projectId, "在所选工作空间开始任务", ...newTaskModelArgs);
    } finally { sidebar.unmount(); wrapper.unmount(); }
  });

  it("automatically selects a newly created workspace for the next submission", async () => {
    const { wrapper, store } = await mountPage("/chat");
    vi.spyOn(chatWorkspaceClient, "create").mockResolvedValue({ status: "created", workspace: { project: SECOND_PROJECT, path: "/Users/example/Yijie/Workspaces/Second Synthetic Workspace" } });
    const picker = wrapper.getComponent(ChatWorkspaceControl);
    picker.vm.$emit("update:createOpen", true); await flushPromises();
    picker.vm.$emit("create", SECOND_PROJECT.safeName); await flushPromises();
    expect(picker.props("createOpen")).toBe(false);
    expect(picker.props("selectedProjectId")).toBe(SECOND_PROJECT.projectId);
    expect(store.projects).toContainEqual(SECOND_PROJECT);
    expect(wrapper.get(".workspace-trigger").attributes("data-yj-tooltip")).toBeUndefined();
    const createSession = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    await wrapper.get("textarea").setValue("使用新建空间");
    await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
    expect(createSession).toHaveBeenCalledWith(SECOND_PROJECT.projectId, "使用新建空间", ...newTaskModelArgs);
    wrapper.unmount();
  });

  it.each([
    { shared: false, state: "unavailable" }, { shared: true, state: "unavailable" },
    { shared: false, state: "removed" }, { shared: true, state: "removed" },
  ])("clears the selected workspace when it is $state and keeps the draft sendable (shared drafts=$shared)", async ({ shared, state }) => {
    expertFlag.enabled = shared;
    const { wrapper, store, pinia } = await mountPage("/chat");
    const create = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    wrapper.getComponent(ChatWorkspaceControl).vm.$emit("select", PROJECT_ID);
    await wrapper.get("textarea").setValue("无目录继续发送");
    expect(wrapper.get(".chat-composer__project").text()).toBe("Synthetic Workspace");
    store.projects = state === "removed" ? [SECOND_PROJECT] : [{ ...PROJECT, available: false }, SECOND_PROJECT];
    await flushPromises();
    expect(wrapper.get(".chat-composer__project").text()).toBe("选择工作空间");
    expect(wrapper.text()).not.toContain("所选工作空间已不可用");
    expect(useChatComposerDraftStore(pinia).workspaceId).toBeNull();
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeUndefined();
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    expect(create).toHaveBeenCalledWith(null, "无目录继续发送", ...newTaskModelArgs);
    wrapper.unmount();
  });

  it("keeps a valid shared workspace while the project list reloads", async () => {
    expertFlag.enabled = true;
    const { wrapper, store, pinia } = await mountPage("/chat");
    wrapper.getComponent(ChatWorkspaceControl).vm.$emit("select", PROJECT_ID);
    const readiness = store.localReadiness;
    store.phase = "binding";
    store.localReadiness = null;
    store.projects = [];
    await flushPromises();
    expect(useChatComposerDraftStore(pinia).workspaceId).toBe(PROJECT_ID);
    expect(wrapper.text()).not.toContain("所选工作空间已不可用");
    store.projects = [PROJECT];
    store.localReadiness = readiness;
    store.phase = "ready";
    await flushPromises();
    expect(wrapper.get(".chat-composer__project").text()).toBe("Synthetic Workspace");
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
    expect(wrapper.get('[aria-label="可添加文件、技能、连接器"]').attributes("disabled")).toBeDefined();
    await wrapper.get(".chat-notice__action").trigger("click");
    await flushPromises();

    expect(retryDraftRecovery).toHaveBeenCalledOnce();
    expect(wrapper.get('[aria-label="可添加文件、技能、连接器"]').attributes("disabled")).toBeUndefined();
  });

  it("routes a bind-stage storage retry through the authority lifecycle", async () => {
    let storeAtRetry: ReturnType<typeof useChatStore> | null = null;
    const retryChatAuthority = vi.fn(async () => {
      if (storeAtRetry !== null) {
        storeAtRetry.lastBindFailureStage = null;
        storeAtRetry.lastErrorCode = null;
        storeAtRetry.phase = "ready";
      }
      return true;
    });
    const { wrapper, store } = await mountPage(
      "/chat",
      false,
      HISTORY,
      retryChatAuthority,
    );
    storeAtRetry = store;
    const retryDraftRecovery = vi.spyOn(store, "retryDraftRecovery");
    const requestLocalRecovery = vi.spyOn(store, "requestLocalRecovery");
    const refreshLocalReadiness = vi.spyOn(store, "refreshLocalReadiness");
    store.context = null;
    store.projects = [];
    store.sessions = [];
    store.localReadiness = null;
    store.draftTarget = null;
    store.draftTargetReady = false;
    store.lastBindFailureStage = "sessions";
    store.lastErrorCode = "chat_storage_unavailable";
    store.phase = "unavailable";
    await flushPromises();

    expect(wrapper.text()).toContain("本地存储暂不可用");
    await wrapper.get(".chat-notice__action").trigger("click");
    await flushPromises();

    expect(retryChatAuthority).toHaveBeenCalledOnce();
    expect(retryDraftRecovery).not.toHaveBeenCalled();
    expect(requestLocalRecovery).not.toHaveBeenCalled();
    expect(refreshLocalReadiness).not.toHaveBeenCalled();
  });

  it("keeps old records readable in the single timeline", async () => {
    const { wrapper } = await mountPage(`/chat/${SESSION_ID}`, true, HISTORY);
    expect(wrapper.findComponent(ChatTimeline).exists()).toBe(true);
    expect(wrapper.text()).toContain("检查标题");
    expect(wrapper.text()).toContain("标题检查完成");
    expect(wrapper.text()).toContain("synthetic-brief.pdf");
    expect(wrapper.find(".chat-deep-thinking").exists()).toBe(false);
  });

  it("selects through the unified plus entry and permits an attachment-only task", async () => {
    const { wrapper, store, router } = await mountPage("/chat");
    vi.spyOn(store, "pickAttachments").mockImplementation(async () => {
      store.draftAttachments = [READY_ATTACHMENT];
      return [READY_ATTACHMENT];
    });
    const createSession = vi.spyOn(store, "createSessionWithResult")
      .mockResolvedValue(acceptedSubmission());

    await wrapper.get('[aria-label="可添加文件、技能、连接器"]').trigger("click");
    await flushPromises();
    await new DOMWrapper(document.querySelector<HTMLElement>('[role="menuitem"]')!).trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("synthetic-brief.pdf");
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeUndefined();
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();

    // Selecting an attachment does not implicitly select a workspace.
    expect(createSession).toHaveBeenCalledWith(null, "", ...newTaskModelArgs);
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
  });

  it("loads history skill labels through the read-only catalog without a scan", async () => {
    skillFlag.enabled = true;
    const list = vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "2026-10-20T00:00:00Z", skills: [installedSkill] });
    const scan = vi.spyOn(skillNativeClient, "scan").mockRejectedValue(new Error("not used"));
    const { wrapper } = await mountPage(`/chat/${SESSION_ID}`, true);
    await flushPromises();
    expect(list).toHaveBeenCalledOnce();
    expect(scan).not.toHaveBeenCalled();
    expect(wrapper.getComponent(ChatTimeline).props("skillCatalog")).toEqual([installedSkill]);
    wrapper.unmount();
  });

  it.each([false, true])("opens the skills tab from Manage Skills in the composer (reply=%s)", async (reply) => {
    expertFlag.enabled = true;
    skillFlag.enabled = true;
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "2026-10-20T00:00:00Z", skills: [installedSkill] });
    const { wrapper, router, pinia } = await mountPage(reply ? `/chat/${SESSION_ID}` : "/chat", reply);
    vi.spyOn(useSkillStore(pinia), "open").mockResolvedValue();
    await wrapper.get('[aria-label="可添加文件、技能、连接器，或选择专家"]').trigger("click");
    await flushPromises();
    const skillsItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(item => item.textContent?.trim() === "技能");
    expect(skillsItem).toBeDefined();
    await new DOMWrapper(skillsItem!).trigger("click");
    await flushPromises();
    const manage = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent?.trim() === "管理技能");
    expect(manage).toBeDefined();
    await new DOMWrapper(manage!).trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/plugins");
    expect(router.currentRoute.value.query.tab).toBe("skills");
    expect(document.querySelector('[aria-label="已启用的技能"]')).toBeNull();
    wrapper.unmount();
  });

  it.each([{reply:false,native:false},{reply:true,native:false},{reply:false,native:true},{reply:true,native:true}])("submits slash-selected skills with preserved mentions and admitted identities (%j)", async ({reply,native}) => {
    vi.stubEnv("VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED", String(native));
    skillFlag.enabled = true;
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "2026-10-20T00:00:00Z", skills: [installedSkill] });
    const { wrapper, store, pinia } = await mountPage(reply ? `/chat/${SESSION_ID}` : "/chat", reply);
    const skillStore = useSkillStore(pinia);
    skillStore.skills = [
      installedSkill,
      { ...installedSkill, id: "disabled", enabled: false, runtimeVisible: false },
      { ...installedSkill, id: "not-installed", installationStatus: "not_installed", enabled: false, runtimeVisible: false },
      { ...installedSkill, id: "syncing", runtimeVisible: false },
      { ...installedSkill, id: "updating" },
    ];
    skillStore.operations = { updating: "disable" };
    skillStore.phase = "ready";
    const refresh = vi.spyOn(skillStore, "open").mockResolvedValue();
    const target = reply ? `session:${SESSION_ID}` as const : "new";
    const drafts = useChatComposerDraftStore(pinia);
    const submit = reply
      ? vi.spyOn(store, "submitTurnWithResult").mockResolvedValue(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)))
      : vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    const input = wrapper.get("textarea");
    expect(input.attributes("placeholder")).toBe("描述你想完成的事，输入 / 调用技能");
    input.element.focus();
    await input.setValue("/");
    await flushPromises();
    expect(document.querySelectorAll('[role="listbox"] [role="option"]')).toHaveLength(1);
    await input.setValue("/文案");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(submit).not.toHaveBeenCalled();
    expect(drafts.skillSelection(target).map(skill => skill.id)).toEqual([installedSkill.id]);
    const editor = wrapper.get('[contenteditable="true"]');
    expect(drafts.texts[target] ?? "").toBe("");
    expect(editor.element).toBe(document.activeElement);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(refresh).toHaveBeenCalledExactlyOnceWith(false);
    refresh.mockClear();
    editor.element.append(document.createTextNode("根据合成资料撰写一段文案"));
    await editor.trigger("input");
    await editor.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(refresh).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[reply ? 0 : 1]).toBe("$copywriting\n\n根据合成资料撰写一段文案");
    expect(submit.mock.calls[0]?.[reply ? 4 : 5]).toEqual(native ? [{ id: installedSkill.id, version: installedSkill.version }] : undefined);
    expect(drafts.skillSelection(target)).toEqual([]);
    wrapper.unmount();
  });

  it.each([false, true])("submits a skill-only slash selection and reports confirmed tool conditions in the accepted turn (reply=%s)", async reply => {
    skillFlag.enabled = true;
    vi.stubEnv("VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED", "true");
    vi.stubEnv("VITE_YIJIE_FEAT174_NATIVE_SKILLS", "true");
    const entry = { ...installedSkill, requiredTools: ["orders"], dependencyState: "unknown" as const };
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "", skills: [entry] });
    const { wrapper, store, pinia } = await mountPage(reply ? `/chat/${SESSION_ID}` : "/chat", reply);
    const catalog = useSkillStore(pinia);
    catalog.skills = [entry]; catalog.phase = "ready";
    const refresh = vi.spyOn(catalog, "open").mockResolvedValue();
    const send = reply ? vi.spyOn(store, "submitTurnWithResult").mockResolvedValue(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)))
      : vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    const input = wrapper.get("textarea");
    await input.setValue("/文案");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
    expect(wrapper.find(".chat-turn-group__skill-tools").exists()).toBe(false);
    refresh.mockImplementation(async () => { catalog.skills = [{ ...entry, dependencyState: "needs_authorization" }]; });
    const button = wrapper.get('[aria-label="发送任务"]');
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click"); await flushPromises();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[reply ? 0 : 1]).toBe("【技能1 $copywriting】");
    expect(send.mock.calls[0]?.[reply ? 4 : 5]).toEqual([{ id: entry.id, version: entry.version }]);
    if (reply) expect(wrapper.get(`[data-turn-id="${TURN_ID}"] .chat-turn-group__skill-tools`).text()).toContain("「orders」尚未授权");
    wrapper.unmount();
  });

  it("keeps the first picker choice out of both ordinary and named follow-up bubbles in one conversation", async () => {
    skillFlag.enabled = true;
    vi.stubEnv("VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED", "true");
    vi.stubEnv("VITE_YIJIE_FEAT174_NATIVE_SKILLS", "true");
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "", skills: [installedSkill] });
    const { wrapper, store, router, pinia } = await mountPage("/chat");
    const skills = useSkillStore(pinia);
    skills.skills = [installedSkill]; skills.phase = "ready";
    vi.spyOn(skills, "open").mockResolvedValue();
    const ids = ["first-pick", "plain-reply", "named-reply"];
    const target = chatSessionDraftTarget(SESSION_ID);
    const create = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission(SESSION_ID, CHAT_NEW_DRAFT_TARGET, ids[0]));
    const reply = vi.spyOn(store, "submitTurnWithResult")
      .mockResolvedValueOnce(acceptedSubmission(SESSION_ID, target, ids[1]))
      .mockResolvedValueOnce(acceptedSubmission(SESSION_ID, target, ids[2]));

    const input = wrapper.get("textarea");
    input.element.focus();
    await input.setValue("/文案");
    await input.trigger("keydown", { key: "Enter" }); await flushPromises();
    const editor = wrapper.get('[contenteditable="true"]');
    editor.element.append(document.createTextNode("整理商品标题。"));
    await editor.trigger("input");
    await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/chat/${SESSION_ID}`);
    expect(useChatComposerDraftStore(pinia).skillSelection("new")).toEqual([]);
    store.sessions = [SESSION]; store.selectedSessionId = SESSION_ID;
    store.selectedSessionPurpose = "ordinary"; store.selectedAccessMode = "live";
    store.draftTarget = target; store.draftTargetReady = true;
    setHistoryProjection(store, { turns: [], nextCursor: null });
    await flushPromises();

    const followups = ["把上一版缩短到三句话。", `请使用${installedSkill.displayName}技能写标题。`];
    for (const text of followups) {
      expect(useChatComposerDraftStore(pinia).skillSelection(`session:${SESSION_ID}`)).toEqual([]);
      await wrapper.get("textarea").setValue(text);
      await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
    }
    expect(create).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledTimes(2);
    const inputs = [create.mock.calls[0]![1], ...reply.mock.calls.map(call => call[0])];
    const refs = [create.mock.calls[0]![5], ...reply.mock.calls.map(call => call[4])];
    const identity = [{ id: installedSkill.id, version: installedSkill.version }];
    expect(refs).toEqual([identity, undefined, identity]);
    expect(inputs.slice(1)).toEqual(followups);
    setHistoryProjection(store, { nextCursor: null, turns: inputs.map((text, i) => ({
      ...HISTORY.turns[0]!, turnId: ids[i]!, messages: [{
        messageId: ids[i]!, role: "user", status: "committed", createdAt: i + 1, ordinal: 0, content: text,
        contentBlocks: [{ type: "text", text, ...(refs[i] && { skills: refs[i] }) }],
      }],
    })) });
    await flushPromises();
    for (const [i, turnId] of ids.entries()) {
      const bubble = wrapper.get(`[data-turn-id="${turnId}"] .chat-timeline-item-shell--user`);
      expect(bubble.findAll(".chat-skill-pill").map(pill => pill.text())).toEqual(i === 0 ? [installedSkill.displayName] : []);
      if (i > 0) expect(bubble.get(".chat-safe-content__paragraph").text()).toBe(followups[i - 1]);
    }
  });

  it("inserts a picker skill at the saved caret and records its position only after acceptance", async () => {
    const storage = { getItem: () => null, setItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    skillFlag.enabled = true;
    vi.stubEnv("VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED", "true");
    vi.stubEnv("VITE_YIJIE_FEAT174_NATIVE_SKILLS", "true");
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "2026-10-20T00:00:00Z", skills: [installedSkill] });
    const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
    const skills = useSkillStore(pinia);
    skills.skills = [installedSkill]; skills.phase = "ready";
    vi.spyOn(skills, "open").mockResolvedValue();
    const submit = vi.spyOn(store, "submitTurnWithResult").mockResolvedValueOnce({ status: "not_accepted" })
      .mockResolvedValue(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)));
    const key = `yijie.desktop.ui.skill-positions.v2:${SESSION_ID}:${TURN_ID}`;
    try {
      const input = wrapper.get("textarea");
      await input.setValue("  商品📦请优化。");
      input.element.focus();
      input.element.setSelectionRange(6, 6);
      await wrapper.get(".chat-composer__add").trigger("click"); await flushPromises();
      const picker = new DOMWrapper(document.querySelector(".composer-add-menu")!);
      await picker.get('[data-resource-menu="skills"]').trigger("click"); await flushPromises();
      await picker.get('input').setValue(installedSkill.displayName);
      await picker.get('[role="checkbox"]').trigger("click"); await flushPromises();
      const editor = wrapper.get<HTMLElement>('[contenteditable="true"]');
      expect(editor.element.textContent).toBe("  商品📦" + installedSkill.displayName + "请优化。");
      expect(editor.element).toBe(document.activeElement);
      await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(editor.element.textContent).toContain(installedSkill.displayName);
      await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
      const body = "商品📦【技能1 $copywriting】请优化。";
      expect(submit.mock.calls[1]?.[0]).toBe(body);
      expect(submit.mock.calls[1]?.[4]).toEqual([{ id: installedSkill.id, version: installedSkill.version }]);
      expect(storage.setItem).toHaveBeenCalledWith(key, JSON.stringify({ length: body.length, offsets: [4], pickedCount: 1 }));
    } finally { wrapper.unmount(); }
  });

  it.skipIf(!chatModelsEnabled || !kimiK31Candidate).for([false, true])("sends two positioned skills in the model request (reply=%s)", async (reply, { task }) => {
    skillFlag.enabled = true;
    vi.stubEnv("VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED", "true");
    vi.stubEnv("VITE_YIJIE_FEAT174_NATIVE_SKILLS", "true");
    const listing = { ...installedSkill, id: "yijie.traffic-advertising.amazon-listing-expert", version: "0.0.94", runtimeName: "amazon-listing-expert", displayName: "亚马逊 Listing 专家" };
    const catalog = [listing, installedSkill];
    const [firstSkill, secondSkill] = reply ? [installedSkill, listing] as const : [listing, installedSkill] as const;
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "2026-11-20T00:00:00Z", skills: catalog });
    vi.spyOn(chatModelClient, "state").mockResolvedValue({ profileId: "kimi-k3-1-pro-max-v1", revision: 1, state: "ready" });
    const { wrapper, pinia } = await mountPage(reply ? `/chat/${SESSION_ID}` : "/chat", reply);
    const skills = useSkillStore(pinia);
    skills.skills = catalog; skills.phase = "ready";
    vi.spyOn(skills, "open").mockResolvedValue();
    const requests: { contentBlocks: unknown[]; operationId: string }[] = [];
    promptBoundary.invoke = async (command, args) => {
      if (command !== "chat_model_submit_v1") throw new Error("Unrelated native read");
      const { request } = args as { request: { requestId: string; payload: typeof requests[number] } };
      requests.push(request.payload);
      return { schemaVersion: 1, requestId: request.requestId, data: { sessionId: SESSION_ID, turnId: TURN_ID, operationId: request.payload.operationId } };
    };
    try {
      // Pick the second step first. Its position, not click order, must win.
      const input = wrapper.get("textarea");
      const beforeSlash = "先用技能对比商品卖点，\n再用技能/" + secondSkill.displayName;
      input.element.focus();
      input.element.value = beforeSlash + "写标题。";
      input.element.setSelectionRange(beforeSlash.length, beforeSlash.length);
      await input.trigger("input");
      await input.trigger("keydown", { key: "Enter" });
      await flushPromises();
      const editor = wrapper.get<HTMLElement>('[contenteditable="true"]').element;
      const offset = "先用技能".length;
      document.getSelection()!.setBaseAndExtent(editor.firstChild!, offset, editor.firstChild!, offset);
      document.dispatchEvent(new Event("selectionchange"));
      await wrapper.get(".chat-composer__add").trigger("click"); await flushPromises();
      const menu = new DOMWrapper(document.querySelector(".composer-add-menu")!);
      await menu.get('[data-resource-menu="skills"]').trigger("click"); await flushPromises();
      await menu.get("input").setValue(firstSkill.displayName);
      await menu.get('[role="checkbox"]').trigger("click"); await flushPromises();
      expect(editor.textContent).toBe(`先用技能${firstSkill.displayName}对比商品卖点，\n再用技能${secondSkill.displayName}写标题。`);
      await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.contentBlocks).toEqual([{ type: "text",
        text: reply ? "先用技能【技能1 $copywriting】对比商品卖点，\n再用技能【技能2 $amazon-listing-expert】写标题。"
          : "先用技能【技能1 $amazon-listing-expert】对比商品卖点，\n再用技能【技能2 $copywriting】写标题。",
        skills: [firstSkill, secondSkill].map(({ id, version }) => ({ id, version })),
      }]);
      Object.assign(task.meta, { submittedContentBlocks: requests[0]!.contentBlocks });
    } finally { wrapper.unmount(); }
  });

  it.each([false, true])("sends a named skill ending in 专家 as one native skill, without changing the expert (reply=%s)", async reply => {
    skillFlag.enabled = expertFlag.enabled = true;
    vi.stubEnv("VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED", "true");
    vi.stubEnv("VITE_YIJIE_FEAT174_NATIVE_SKILLS", "true");
    const skill = { ...installedSkill, runtimeName: "sales-negotiator", displayName: "销售谈判专家" };
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "", skills: [skill] });
    const { wrapper, store, pinia } = await mountPage(reply ? `/chat/${SESSION_ID}` : "/chat", reply);
    if (reply) useChatComposerDraftStore(pinia).setSkills(`session:${SESSION_ID}`, [skill]);
    const send = reply ? vi.spyOn(store, "submitTurnWithResult").mockResolvedValue(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)))
      : vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    const text = "调用销售谈判专家，给我生成一个谈判策略";
    await wrapper.get("textarea").setValue(text);
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    expect(send).toHaveBeenCalledOnce();
    const args = send.mock.calls[0]!;
    expect(args[reply ? 0 : 1]).toBe(text);
    expect(args[reply ? 4 : 5]).toEqual([{ id: skill.id, version: skill.version }]);
    expect(args[reply ? 3 : 4]).toEqual(reply ? { expectedBindingRevision: 1, expert: { expertId: expertDisplay.expertId, version: expertDisplay.version } } : undefined);
    expect(wrapper.text()).not.toContain("请从专家选择器");
    wrapper.unmount();
  });

  it.each([{reply:false, installed:false}, {reply:true, installed:true}])("shows a named unavailable skill inside the conversation and preserves the unsent draft (%j)", async ({reply,installed}) => {
    skillFlag.enabled = expertFlag.enabled = true;
    const skill = { ...installedSkill, displayName: "销售谈判专家", enabled: false, runtimeVisible: false,
      installationStatus: installed ? "installed" as const : "not_installed" as const };
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "", skills: [skill] });
    const { wrapper, store } = await mountPage(reply ? `/chat/${SESSION_ID}` : "/chat", reply);
    const send = reply ? vi.spyOn(store, "submitTurnWithResult") : vi.spyOn(store, "createSessionWithResult");
    const text = "请调用“销售谈判专家”技能，给我准备一份策略。";
    await wrapper.get("textarea").setValue(text);
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    const notice = wrapper.get('[aria-label="任务对话记录"] [aria-label="技能使用提示"]');
    expect(notice.text()).toContain(skill.displayName);
    expect(notice.text()).toContain(installed ? "已停用" : "尚未安装");
    expect(wrapper.find('footer.chat-workspace__composer [aria-label="技能使用提示"]').exists()).toBe(false);
    expect(wrapper.get("textarea").element.value).toBe(text);
    expect(wrapper.text()).not.toContain("请从专家选择器");
    expect(send).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("leaves an ordinary negotiation task to the native model without selecting a skill or expert", async () => {
    skillFlag.enabled = expertFlag.enabled = true;
    const skill = { ...installedSkill, displayName: "销售谈判专家" };
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "", skills: [skill] });
    const { wrapper, store, pinia } = await mountPage("/chat");
    const refresh = vi.spyOn(useSkillStore(pinia), "open");
    const send = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    const text = "根据双方的报价，帮我准备谈判策略";
    await wrapper.get("textarea").setValue(text);
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    expect(send).toHaveBeenCalledWith(null, text, ...newTaskModelArgs);
    expect(refresh).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("continues to bind a genuine named expert while skills are enabled", async () => {
    skillFlag.enabled = expertFlag.enabled = true;
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "", skills: [installedSkill] });
    const { wrapper, store } = await mountPage("/chat");
    const send = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
    const text = `请调用${expertDisplay.displayName}，整理资料。`;
    await wrapper.get("textarea").setValue(text);
    await wrapper.get('[aria-label="发送任务"]').trigger("click");
    await flushPromises();
    expect(send).toHaveBeenCalledWith(null, text, newTaskModelArgs[0], undefined, { expectedBindingRevision: 0, expert: { expertId: expertDisplay.expertId, version: expertDisplay.version } });
    wrapper.unmount();
  });

  it("abandons skill preflight when the draft changes and ignores a second submit while reading", async () => {
    skillFlag.enabled = expertFlag.enabled = true;
    const skill = { ...installedSkill, displayName: "销售谈判专家" };
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "", skills: [skill] });
    const { wrapper, store, pinia } = await mountPage("/chat");
    let finish!: () => void;
    const refresh = vi.spyOn(useSkillStore(pinia), "open").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const send = vi.spyOn(store, "createSessionWithResult");
    await wrapper.get("textarea").setValue("请用销售谈判专家准备草案");
    const composer = wrapper.getComponent(ChatComposer);
    composer.vm.$emit("submit");
    composer.vm.$emit("submit");
    await wrapper.get("textarea").setValue("换个问题");
    finish();
    await flushPromises();
    expect(refresh).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(wrapper.get("textarea").element.value).toBe("换个问题");
    wrapper.unmount();
  });

  it("preserves selected skills on failed sends and blocks stale selections after revalidation", async () => {
    skillFlag.enabled = true;
    vi.spyOn(skillNativeClient, "list").mockResolvedValue({ schemaVersion: 1, scannedAt: "2026-10-20T00:00:00Z", skills: [installedSkill] });
    const { wrapper, store, pinia } = await mountPage("/chat");
    const skillStore = useSkillStore(pinia); skillStore.skills = [installedSkill]; skillStore.phase = "ready";
    const refresh = vi.spyOn(skillStore, "open").mockResolvedValue();
    const drafts = useChatComposerDraftStore(pinia); drafts.setSkills("new", [installedSkill]);
    const submit = vi.spyOn(store, "createSessionWithResult").mockResolvedValue({ status: "not_accepted" });
    await wrapper.get("textarea").setValue("保留原文");
    await wrapper.getComponent(ChatComposer).vm.$emit("submit"); await flushPromises();
    expect(drafts.skillSelection("new")).toHaveLength(1);
    expect(wrapper.get("textarea").element.value).toBe("保留原文");
    submit.mockClear();
    refresh.mockImplementation(async () => { skillStore.skills = [{ ...installedSkill, enabled: false, runtimeVisible: false }]; });
    await wrapper.getComponent(ChatComposer).vm.$emit("submit"); await flushPromises();
    expect(submit).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("跨境营销文案”已停用");
    expect(drafts.skillSelection("new")).toHaveLength(1);
    wrapper.unmount();
  });

  it("keeps native attachment import busy without showing intermediate progress", async () => {
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

    expect(wrapper.getComponent(ChatComposer).props("attachmentImporting")).toBe(true);
    expect(wrapper.text()).not.toContain("正在建立索引");
    expect(wrapper.find(".chat-composer__attachment-progress").exists()).toBe(false);
    expect(wrapper.get('[aria-label="可添加文件、技能、连接器"]').attributes("disabled")).toBeDefined();
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

    await wrapper.get('[aria-label="可添加文件、技能、连接器"]').trigger("click");
    await flushPromises();
    await new DOMWrapper(document.querySelector<HTMLElement>('[role="menuitem"]')!).trigger("click");
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

    const addButton = wrapper.get('[aria-label="可添加文件、技能、连接器"]');
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

    expect(wrapper.get('[aria-label="可添加文件、技能、连接器"]').attributes("disabled")).toBeDefined();
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

    expect(submitTurn).toHaveBeenCalledWith("不能丢失的回复", ...replyModelArgs);
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value)
      .toBe("不能丢失的回复");
    expect(wrapper.text()).toContain("本地服务尚未就绪");
  });

  it("waits for an accepted reply to render before positioning its user message above the composer", async () => {
    const callbacks = new Map<number, FrameRequestCallback>(); let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    const scroller = wrapper.get<HTMLElement>(".chat-workspace__conversation").element;
    const turnId = "019c1a00-0000-7000-8000-000000000088";
    let top = 100;
    scroller.style.scrollPaddingTop = "32px"; scroller.style.scrollPaddingBottom = "80px";
    Object.defineProperties(scroller, {
      clientHeight: { value: 500 }, offsetHeight: { value: 500 },
      scrollTop: { get: () => top, set: value => { top = Number(value); } },
      scrollHeight: { get: () => 1080 + Math.max(100, Number.parseFloat(scroller.querySelector<HTMLElement>(`[data-turn-id="${turnId}"]`)?.style.minHeight ?? "") || 0) },
    });
    const rectangle = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this === scroller) return new DOMRect(0, 80, 760, 500);
      if (this.dataset.turnId === turnId) return new DOMRect(0, 80 + 1000 - top, 760, 100);
      return rectangle.call(this);
    });
    vi.spyOn(store, "submitTurnWithResult").mockResolvedValue(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID), turnId));
    const textarea = wrapper.get("textarea").element as HTMLTextAreaElement;
    await wrapper.get("textarea").setValue("新发出的消息应完整可见"); textarea.focus();
    wrapper.getComponent(ChatComposer).vm.$emit("submit"); await flushPromises();
    expect(wrapper.find(`[data-turn-id="${turnId}"]`).exists()).toBe(false);
    setHistoryProjection(store, historyWithAcceptedTurn(turnId, "queued", "新发出的消息应完整可见"));
    for (let index = 0; index < 4; index++) {
      await flushPromises();
      const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(index * 16));
    }
    await flushPromises();
    expect(wrapper.get<HTMLElement>(`[data-turn-id="${turnId}"]`).element.style.minHeight).toBe("388px");
    expect(top).toBe(968);
    expect(document.activeElement).toBe(textarea);
    wrapper.unmount();
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

  it.each(["light", "dark"])("keeps the conversation DOM, input focus and reading position across lease renewal in %s mode", async theme => {
    document.documentElement.dataset.theme = theme;
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    await wrapper.get("textarea").setValue("续期时继续输入的草稿");
    const textarea = wrapper.get("textarea").element as HTMLTextAreaElement;
    const scroller = wrapper.get(".chat-workspace__conversation").element as HTMLElement;
    const timeline = wrapper.getComponent(ChatTimeline).element;
    textarea.focus(); textarea.setSelectionRange(2, 6); scroller.scrollTop = 240;
    for (let renewal = 0; renewal < 2; renewal++) {
      store.context = { ...store.context!, expiresAtEpochSeconds: store.context!.expiresAtEpochSeconds + 300 };
      await flushPromises();
      expect(wrapper.get("textarea").element).toBe(textarea);
      expect(textarea.value).toBe("续期时继续输入的草稿");
      expect(document.activeElement).toBe(textarea);
      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 6]);
      expect(wrapper.getComponent(ChatTimeline).element).toBe(timeline);
      expect(wrapper.get(".chat-workspace__conversation").element).toBe(scroller);
      expect(scroller.scrollTop).toBe(240);
      expect(wrapper.text()).toContain("标题检查完成");
      expect(store.selectedSessionId).toBe(SESSION_ID);
    }
    wrapper.unmount();
    delete document.documentElement.dataset.theme;
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
        store.conversationState = composeConversationView(
          historyPageToConversationSnapshot(SESSION_ID, store.history!), [],
          [{ turnId: acceptedTurnId, operationId: "019c1a00-0000-7000-8000-000000000020", status: "queued" }],
        );
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

  it("accepts WebView-targeted native drops only inside the composer logical bounds", async () => {
    const { wrapper, store } = await mountPage("/chat");
    expect(dragDropMock.windowListener).not.toHaveBeenCalled();
    expect(dragDropMock.handler).not.toBeNull();
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

    expect(wrapper.get('[aria-label="可添加文件、技能、连接器"]').attributes("disabled")).toBeDefined();
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

  it.each([false, true])("opens the native permission menu in local Demo (existing task: %s)", async (active) => {
    vi.stubEnv("VITE_YIJIE_ENV", "local");
    vi.stubEnv("VITE_YIJIE_LOCAL_PROFILE", "demo_fast");
    vi.stubEnv("VITE_YIJIE_RUNTIME_PERMISSIONS_ENABLED", "true");
    const get = vi.spyOn(runtimePermissionClient, "get").mockResolvedValue({ mode: active ? "ask" : "full", busy: false, fullAccessConfirmed: false });
    vi.spyOn(runtimePermissionClient, "approvals").mockResolvedValue([]);
    const { wrapper, store } = await mountPage(active ? `/chat/${SESSION_ID}` : "/chat", active);
    try {
      await flushPromises();
      expect(get).toHaveBeenCalledWith(store.context!.contextId, active ? SESSION_ID : null);
      expect(wrapper.find(".chat-composer__permission").exists()).toBe(false);
      await wrapper.get(".permission-trigger").trigger("click");
      await flushPromises();
      const options = [...document.querySelectorAll('[role="menuitemradio"]')];
      expect(options).toHaveLength(3);
      expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(active ? ["true", "false", "false"] : ["false", "false", "true"]);
      expect(options.map((option) => option.textContent).join(" ")).toContain("帮我批准");
    } finally { wrapper.unmount(); }
  });

  it.each(["saved", "first-use", "save-failed"] as const)("submits a new full-access chat only with a native confirmation (%s)", async (scenario) => {
    vi.stubEnv("VITE_YIJIE_ENV", "local");
    vi.stubEnv("VITE_YIJIE_LOCAL_PROFILE", "demo_fast");
    vi.stubEnv("VITE_YIJIE_RUNTIME_PERMISSIONS_ENABLED", "true");
    const state = { mode: "full" as const, busy: false, fullAccessConfirmed: scenario === "saved" };
    vi.spyOn(runtimePermissionClient, "get").mockImplementation(async () => ({ ...state }));
    vi.spyOn(runtimePermissionClient, "approvals").mockResolvedValue([]);
    const save = vi.spyOn(runtimePermissionClient, "set").mockImplementation(async () => {
      if (scenario === "save-failed") throw new Error("permission save unavailable");
      state.fullAccessConfirmed = true;
      return { ...state };
    });
    const { wrapper, store } = await mountPage("/chat");
    try {
      const create = vi.spyOn(store, "createSessionWithResult").mockResolvedValue(acceptedSubmission());
      const input = wrapper.get("textarea");
      await input.setValue("整理商品清单");
      expect(wrapper.get(".permission-trigger").text()).toBe("完全访问");
      const send = wrapper.get('[aria-label="发送任务"]');
      await send.trigger("click"); await flushPromises();
      if (scenario === "saved") {
        expect(document.querySelector(".permission-confirm")).toBeNull();
        expect(save).not.toHaveBeenCalled();
      } else {
        expect(create).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        document.querySelector<HTMLButtonElement>(".permission-confirm-cancel")!.click();
        await flushPromises();
        expect(input.element.value).toBe("整理商品清单");
        expect(create).not.toHaveBeenCalled();
        await send.trigger("click"); await flushPromises();
        const allow = document.querySelector<HTMLButtonElement>(".permission-confirm-primary")!;
        expect(allow.disabled).toBe(true);
        document.querySelector<HTMLElement>(".permission-confirm-acknowledgement")!.click();
        await flushPromises();
        allow.click(); await flushPromises();
        expect(save).toHaveBeenCalledExactlyOnceWith(store.context!.contextId, null, "full", true);
      }
      expect(create).toHaveBeenCalledTimes(scenario === "save-failed" ? 0 : 1);
    } finally { wrapper.unmount(); }
  });

  it("keeps permission failures on the new control and recovers through retry", async () => {
    vi.stubEnv("VITE_YIJIE_ENV", "local");
    vi.stubEnv("VITE_YIJIE_LOCAL_PROFILE", "demo_fast");
    vi.stubEnv("VITE_YIJIE_RUNTIME_PERMISSIONS_ENABLED", "true");
    vi.spyOn(runtimePermissionClient, "get").mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValue({ mode: "ask", busy: false, fullAccessConfirmed: false });
    const { wrapper } = await mountPage("/chat");
    try {
      await flushPromises();
      expect(wrapper.find(".chat-composer__permission").exists()).toBe(false);
      expect(wrapper.get(".permission-trigger").attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain("暂时无法同步权限或审批，请重试。");
      await wrapper.get(".chat-workspace__composer-error button").trigger("click");
      await flushPromises();
      expect(wrapper.get(".permission-trigger").attributes("disabled")).toBeUndefined();
      expect(wrapper.get(".permission-trigger").text()).toBe("请求批准");
    } finally { wrapper.unmount(); }
  });

  it("silently checks deletion while retiring question reads for that session", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubEnv("VITE_YIJIE_ENV", "local");
    vi.stubEnv("VITE_YIJIE_LOCAL_PROFILE", "demo_fast");
    vi.stubEnv("VITE_YIJIE_RUNTIME_PERMISSIONS_ENABLED", "true");
    vi.stubEnv("VITE_YIJIE_INTERACTION_TOOLS", "true");
    vi.spyOn(runtimePermissionClient, "get").mockResolvedValue({ mode: "ask", busy: false, fullAccessConfirmed: false });
    vi.spyOn(runtimePermissionClient, "approvals").mockResolvedValue([]);
    let rejectRead!: (reason: Error) => void;
    const snapshot = vi.spyOn(userInputClient, "snapshot").mockRejectedValueOnce(new Error("unavailable"))
      .mockImplementation(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    const pending = {
      operationId: "019c1a00-0000-7000-8000-000000000007",
      desktopState: "complete",
      hostState: "pending",
      runtimeState: "pending",
      outcomeCode: "pending",
      lastErrorCode: null,
      requestedAt: 1,
      completedAt: null,
      expiresAt: null,
    } as const;
    let acceptDelete!: (status: typeof pending) => void;
    vi.spyOn(chatClient, "deleteSession").mockImplementation(() => new Promise(resolve => { acceptDelete = resolve; }));
    const check = vi.spyOn(chatClient, "getCleanupStatus").mockResolvedValue(pending);
    const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
    try {
      usePermissionStore(pinia).$patch({ selectedTenantId: PROJECT_ID, authorizationRevision: 1,
        expiresAt: new Date(Date.now() + 300_000).toISOString(), capabilities: ["task.read", "task.create"], phase: "ready" });
      await flushPromises();
      const error = "暂时无法同步问题或回答回执";
      expect(wrapper.text()).toContain(error);
      await wrapper.findAll("button").find(button => button.text() === "重新读取")!.trigger("click");
      expect(snapshot).toHaveBeenCalledTimes(2);

      const deleting = store.deleteSelected();
      rejectRead(new Error("session no longer available"));
      await flushPromises();
      expect(wrapper.text()).not.toContain(error);
      acceptDelete(pending);
      await deleting;
      await vi.advanceTimersByTimeAsync(3_000);
      expect(check).toHaveBeenCalledWith(store.context!.contextId, pending.operationId);
      expect(snapshot).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).not.toContain(error);
      expect(wrapper.text()).not.toContain("正在永久删除任务");
      expect(wrapper.text()).not.toContain("检查删除状态");
      expect(wrapper.text()).not.toContain("任务已永久删除");
      expect(store.selectedSessionId).toBe(SESSION_ID);
      expect(store.canSend).toBe(false);
    } finally { wrapper.unmount(); await store.dispose(); }
  });

  it("retries an already confirmed deletion after its automatic retry budget is exhausted", async () => {
    const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
    store.cleanupStatus = { operationId: "019c1a00-0000-7000-8000-000000000007",
      desktopState: "incomplete", hostState: "incomplete", runtimeState: "incomplete",
      outcomeCode: "retry_limit_exceeded", lastErrorCode: "cleanup_protocol_failure",
      requestedAt: 1, completedAt: null, expiresAt: null };
    const retry = vi.spyOn(store, "deleteSelected").mockResolvedValue(null);
    const check = vi.spyOn(store, "refreshSelectedCleanup").mockResolvedValue(null);
    await flushPromises();
    const button = wrapper.findAll("button").find(button => button.text() === "重新尝试删除");
    expect(button).toBeDefined();
    await button!.trigger("click");
    await flushPromises();
    expect(retry).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

it("FEAT-155 confirms leaving an unsent chat draft and defaults to staying", async () => {
  const {wrapper,router}=await mountPage("/chat",false,HISTORY,async()=>false,true);
  await wrapper.get("textarea").setValue("未发送的导航验证");
  const first=router.push("/scheduled-tasks"); await flushPromises();
  expect(document.body.textContent).toContain("离开当前对话？");
  const button=(label:string)=>Array.from(document.querySelectorAll("button")).find(b=>b.textContent===label)!;
  button("留在对话").click(); await first; await flushPromises();
  expect(router.currentRoute.value.path).toBe("/chat");
  expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("未发送的导航验证");
  const second=router.push("/scheduled-tasks");await flushPromises();button("放弃文字并离开").click();await second;
  expect(router.currentRoute.value.path).toBe("/scheduled-tasks");wrapper.unmount();
});

it("FEAT158 composer keeps the expert after the shop and requires explicit user content", async () => {
  expertFlag.enabled = true;
  const { wrapper, store, pinia } = await mountPage("/chat?focus=composer");
  expect(document.activeElement).toBe(wrapper.get("textarea").element);
  useChatComposerDraftStore(pinia).setExpert("new", expertDisplay); await flushPromises();
  const leading = wrapper.get(".chat-composer__leading-actions");
  expect(leading.text()).toContain(expertDisplay.displayName);
  expect(leading.find(".chat-expert-chip").exists()).toBe(true);
  expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
  await wrapper.get("textarea").setValue("普通待发送问题");
  const create = vi.spyOn(store, "createSessionWithResult").mockResolvedValue({ status: "not_accepted" });
  await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
  expect(create).toHaveBeenCalledWith(null, "普通待发送问题", newTaskModelArgs[0], undefined, { expectedBindingRevision: 0, expert: { expertId: expertDisplay.expertId, version: expertDisplay.version } });
  expect(useChatComposerDraftStore(pinia).expert("new")).toEqual(expertDisplay);
  wrapper.unmount();
});

it("FEAT158 chip details carry the exact selected expert version", async () => {
  expertFlag.enabled = true;
  const { wrapper, router, pinia } = await mountPage("/chat");
  router.addRoute({ path: "/plugins", component: { template: "<div>扩展</div>" } });
  useChatComposerDraftStore(pinia).setExpert("new", expertDisplay); await flushPromises();
  await wrapper.get('[aria-label^="查看已选专家"]').trigger("click"); await flushPromises();
  expect(router.currentRoute.value.query).toEqual({ tab: "experts", from: "/chat", expert: expertDisplay.expertId, expertVersion: expertDisplay.version });
  expect(useChatComposerDraftStore(pinia).expert("new")).toEqual(expertDisplay);
  wrapper.unmount();
});

it.each(["new", "existing"] as const)("inline expert picker applies the %s selection without navigation or sending", async target => {
  expertFlag.enabled = true;
  const active = target === "existing", path = active ? `/chat/${SESSION_ID}` : "/chat";
  const { wrapper, router, pinia } = await mountPage(path, active);
  const chosen = { ...expertDisplay, expertId: "second-expert", displayName: "第二位专家" };
  const entry = { ...expertEntry, display: chosen, state: "ready" as const };
  const snapshot = { ...expertSnapshot(entry), executionAvailable: true };
  useExpertsStore(pinia).snapshot = snapshot;
  vi.spyOn(expertNativeClient, "snapshot").mockResolvedValue(snapshot);
  const binding = vi.spyOn(expertNativeClient, "setBinding").mockImplementation(async (_ctx, payload) => ({
    binding: { sessionId: SESSION_ID, managed: true, bindingRevision: 2, expert: chosen, state: "ready" },
    operation: { ...payload, requestedExpert: chosen, bindingRevision: 2, state: "succeeded" },
  }));
  const submit = vi.spyOn(expertNativeClient, "submit");
  await wrapper.get("textarea").setValue("保留当前正文");
  const open = async () => {
    await wrapper.get('[aria-label="可添加文件、技能、连接器，或选择专家"]').trigger("click");
    await flushPromises();
    await new DOMWrapper(document.querySelector<HTMLElement>('[data-resource-menu="experts"]')!).trigger("mouseenter");
    await flushPromises();
  };
  await open();
  await new DOMWrapper(document.querySelector<HTMLElement>('.expert-menu [role="radio"]')!).trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.path).toBe(path);
  expect(wrapper.get("textarea").element.value).toBe("保留当前正文");
  expect(wrapper.get(".chat-expert-chip").text()).toContain("第二位专家");
  expect(wrapper.get('[aria-label="可添加文件、技能、连接器，或选择专家"]').attributes("aria-expanded")).toBe("false");
  if (active) {
    expect(binding).toHaveBeenCalledTimes(1);
    expect(useChatExpertsStore(pinia).bindings[SESSION_ID]?.expert).toEqual(chosen);
  } else {
    expect(binding).not.toHaveBeenCalled();
    expect(useChatComposerDraftStore(pinia).expert("new")).toEqual(chosen);
  }
  expect(submit).not.toHaveBeenCalled();
  await open();
  expect(document.querySelector('.expert-menu [aria-checked="true"]')?.textContent).toContain("第二位专家");
  wrapper.unmount();
});

it("FEAT158 retained binding uses its Native checked version when the market only lists a newer card", async () => {
  expertFlag.enabled = true;
  const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
  useExpertsStore(pinia).snapshot = { ...expertSnapshot({ ...expertEntry, display: { ...expertDisplay, version: "9.0.0" }, state: "ready" }), executionAvailable: true };
  await wrapper.get("textarea").setValue("继续使用历史专家");
  const submit = vi.spyOn(store, "submitTurnWithResult").mockResolvedValue({ status: "not_accepted" });
  await flushPromises();
  expect(wrapper.text()).not.toContain("所选专家资源或执行环境暂不可用");
  await wrapper.get('[aria-label="发送任务"]').trigger("click");
  expect(submit).toHaveBeenCalledWith("继续使用历史专家", replyModelArgs[0], undefined, { expectedBindingRevision: 1, expert: { expertId: expertDisplay.expertId, version: expertDisplay.version } });
  expect(useChatExpertsStore(pinia).bindings[SESSION_ID]?.expert).toEqual(expertDisplay);
  wrapper.unmount();
});

it.each(["resource", "execution"])("FEAT158 retained binding still blocks when Native reports unavailable %s", async (unavailable) => {
  expertFlag.enabled = true;
  const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
  const experts = useExpertsStore(pinia), bindings = useChatExpertsStore(pinia);
  await vi.waitFor(() => {
    expect(bindings.bindings[SESSION_ID]?.state).toBe("ready");
    expect(bindings.busy.has(SESSION_ID)).toBe(false);
  });
  // Drive the authoritative read instead of racing initialization with a
  // direct store assignment while the Native fixture still reports ready.
  vi.mocked(expertNativeClient.snapshot).mockResolvedValue({ ...expertSnapshot({ ...expertEntry, display: { ...expertDisplay, version: "9.0.0" }, state: "ready" }), executionAvailable: unavailable !== "execution" });
  if (unavailable === "resource") vi.mocked(expertNativeClient.binding).mockResolvedValue({ sessionId: SESSION_ID, managed: true, bindingRevision: 1, expert: expertDisplay, state: "unavailable", errorCode: "resource_unavailable" });
  await experts.refresh();
  await bindings.refresh(SESSION_ID);
  await wrapper.get("textarea").setValue("不能借用新版资源");
  const submit = vi.spyOn(store, "submitTurnWithResult");
  await flushPromises();
  expect(bindings.bindings[SESSION_ID]?.state).toBe(unavailable === "resource" ? "unavailable" : "ready");
  expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
  expect(submit).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("FEAT158 an unbound draft cannot borrow readiness from another expert version", async () => {
  expertFlag.enabled = true;
  const { wrapper, store, pinia } = await mountPage("/chat");
  useExpertsStore(pinia).snapshot = { ...expertSnapshot({ ...expertEntry, display: { ...expertDisplay, version: "9.0.0" }, state: "ready" }), executionAvailable: true };
  useChatComposerDraftStore(pinia).setExpert("new", expertDisplay);
  await wrapper.get("textarea").setValue("旧版草稿尚未确认绑定");
  const create = vi.spyOn(store, "createSessionWithResult");
  await flushPromises();
  expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
  expect(create).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("FEAT158 removes a session expert only on the Native receipt and uses explicit null afterwards", async () => {
  expertFlag.enabled = true;
  const { wrapper, store, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
  await wrapper.get("textarea").setValue("保留当前文字");
  const binding = vi.spyOn(expertNativeClient, "setBinding").mockImplementation(async (_ctx, payload) => ({
    binding: { sessionId: SESSION_ID, managed: true, bindingRevision: 2, expert: null, state: "none" },
    operation: { operationId: payload.operationId, sessionId: SESSION_ID, expectedBindingRevision: 1, bindingRevision: 2, requestedExpert: null, state: "succeeded" },
  }));
  await wrapper.get('[aria-label="移除专家"]').trigger("click"); await flushPromises();
  expect(binding).toHaveBeenCalledTimes(1); expect(wrapper.find(".chat-expert-chip").exists()).toBe(false);
  expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("保留当前文字");
  const submit = vi.spyOn(store, "submitTurnWithResult").mockResolvedValue({ status: "not_accepted" });
  await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
  expect(submit).toHaveBeenCalledWith("保留当前文字", replyModelArgs[0], undefined, { expectedBindingRevision: 2, expert: null });
  const acknowledged = vi.spyOn(useChatExpertsStore(pinia), "acknowledgeSubmission");
  submit.mockResolvedValue(acceptedSubmission(SESSION_ID, chatSessionDraftTarget(SESSION_ID)));
  await wrapper.get('[aria-label="发送任务"]').trigger("click"); await flushPromises();
  expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("");
  expect(acknowledged).toHaveBeenCalledWith("019c1a00-0000-7000-8000-000000000020");
  expect(useChatExpertsStore(pinia).bindings[SESSION_ID]?.bindingRevision).toBe(2); wrapper.unmount();
});

it("FEAT158 binding recovery is an explicit original-operation command without sending content", async () => {
  expertFlag.enabled = true;
  const { wrapper, pinia } = await mountPage(`/chat/${SESSION_ID}`, true);
  const store = useChatExpertsStore(pinia), operation = "019c1a00-0000-7000-8000-000000000088";
  store.bindings = { [SESSION_ID]: { sessionId: SESSION_ID, managed: true, bindingRevision: 1, expert: expertDisplay, state: "unknown", operationId: operation } };
  store.pending = { [SESSION_ID]: { operationId: operation, sessionId: SESSION_ID, expectedBindingRevision: 1, expert: null } };
  await wrapper.get("textarea").setValue("恢复前保留的草稿");
  const transport = vi.fn(async (_command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: {
    binding: { sessionId: SESSION_ID, managed: true, bindingRevision: 2, expert: null, state: "none" },
    operation: { operationId: operation, sessionId: SESSION_ID, expectedBindingRevision: 1, bindingRevision: 2, requestedExpert: null, state: "succeeded" },
  } }));
  const client = createExpertNativeClient(transport);
  const recover = vi.spyOn(expertNativeClient, "recoverBinding").mockImplementation(client.recoverBinding);
  const select = vi.spyOn(expertNativeClient, "setBinding"), submit = vi.spyOn(expertNativeClient, "submit");
  try {
    await flushPromises();
    expect(wrapper.text()).toContain("恢复会重新应用原选择，不发送消息");
    await wrapper.findAll("button").find(button => button.text() === "恢复原操作")!.trigger("click"); await flushPromises();
    expect(transport.mock.calls.map(call => call[0])).toEqual(["chat_expert_binding_recover_v1"]);
    expect(transport.mock.calls[0]![1].request.payload).toEqual({ sessionId: SESSION_ID, operationId: operation });
    expect(store.pending[SESSION_ID]).toBeUndefined();
    expect(store.bindings[SESSION_ID]).toMatchObject({ bindingRevision: 2, expert: null, state: "none" });
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("恢复前保留的草稿");
    expect(select).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  } finally { recover.mockRestore(); select.mockRestore(); submit.mockRestore(); wrapper.unmount(); }
});

it("FEAT158 uncertain accepted submission offers only an original-status read", async () => {
  expertFlag.enabled = true;
  const { wrapper, store } = await mountPage(`/chat/${SESSION_ID}`, true);
  store.conversationState = composeConversationView({
    threads: [{ threadId: SESSION_ID, status: "active" }],
    turns: [{ threadId: SESSION_ID, turnId: TURN_ID, ordinal: 0, status: "queued", terminalStatus: null }],
    items: [],
  }, [], [{ turnId: TURN_ID, operationId: "019c1a00-0000-7000-8000-000000000088", status: "uncertain" }]);
  const read = vi.spyOn(store, "resyncSelected").mockResolvedValue();
  const submit = vi.spyOn(store, "submitTurnWithResult");
  await flushPromises();
  expect(wrapper.text()).toContain("原提交结果尚未确认，请勿重复发送");
  await wrapper.findAll("button").find(button => button.text() === "重新读取原提交")!.trigger("click");
  expect(read).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
  wrapper.unmount();
});
