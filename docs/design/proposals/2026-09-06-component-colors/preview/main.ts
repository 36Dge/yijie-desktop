import { createApp, defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import type { ChatHistoryPage, ChatProject, ChatSession } from "@src/domain/chat-ipc";
import { createConversationState, reconcileConversationSnapshot } from "@src/domain/conversation-state";
import { historyPageToConversationSnapshot } from "@src/api/chat-conversation-adapter";
import { skillNativeClient } from "@src/api/skill-native-client";
import { parseSkillCatalogSnapshot, type SkillCatalogSnapshot, type ManagedSkillProjection } from "@src/domain/skill-marketplace";
import { useChatStore, type ChatSubmissionResult } from "@src/stores/chat.store";
import { usePermissionStore } from "@src/stores/permission.store";
import { useSidebarStore } from "@src/stores/sidebar.store";
import { useSkillStore } from "@src/stores/skill.store";
import ChatPage from "@src/pages/chat/ChatPage.vue";
import StorePage from "@src/pages/store/StorePage.vue";
import SkillMarketplacePage from "@src/pages/plugins/SkillMarketplacePage.vue";
import "@src/styles/variables.css";
import "@src/styles/main.css";
import "./candidate-tokens.css";
import "./page-candidate.css";
import PageHarness from "./PageHarness.vue";
import StateAtlas from "./StateAtlas.vue";
import { nativePreviewDiagnostics } from "./tauri-stub";

// This entry is isolated from src/main.ts. It does not bootstrap the native app,
// authenticate, start a backend, read seller data, or persist preferences.
const query = new URLSearchParams(window.location.search);
const theme = query.get("theme") === "dark" ? "dark" : "light";
const variant = query.get("variant") === "current" ? "current" : "candidate";
const requestedPage = query.get("page") ?? "chat";
const page = ["chat", "store", "plugins", "atlas"].includes(requestedPage) ? requestedPage : "chat";
const requestedState = query.get("state") ?? "ready";
const state = ["ready", "loading", "empty", "error", "denied"].includes(requestedState) ? requestedState : "ready";
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.palette = variant;
document.documentElement.dataset.preview = "component-colors";

const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const PROJECT_SECOND_ID = "019c1a00-0000-7000-8000-000000000010";
const FIXTURE_TIME = 1_788_652_800_000;
const memoryActions: string[] = [];
const projects: readonly ChatProject[] = Object.freeze([
  { projectId: PROJECT_ID, safeName: "yijie", pinnedAt: 1, lastUsedAt: 9, available: true },
  { projectId: PROJECT_SECOND_ID, safeName: "店铺运营样例", pinnedAt: null, lastUsedAt: 4, available: true },
]);
const titles = ["商品详情页优化建议", "整理经营周报", "分析广告投放表现", "市场机会与选品分析", "制作商品图片方案", "梳理上新工作计划"];
const sessions: readonly ChatSession[] = Object.freeze(titles.map((title, index) => ({
  sessionId: `019c1a00-0000-7000-8000-${String(index + 20).padStart(12, "0")}`,
  projectId: index < 3 ? PROJECT_ID : PROJECT_SECOND_ID,
  title,
  titleSource: "model" as const,
  pinnedAt: null,
  lastActivityAt: FIXTURE_TIME - index * 1000,
  latestTurnStatus: "completed" as const,
  projectAvailable: true,
})));

const pinia = createPinia();
setActivePinia(pinia);
const permission = usePermissionStore(pinia);
permission.phase = "ready";
permission.selectedTenantId = PROJECT_ID;
permission.tenants = [{ tenantId: PROJECT_ID, displayName: "配色预览 · 合成工作空间" }];
permission.authorizationRevision = 42;
permission.expiresAt = "2099-01-01T00:00:00Z";
permission.capabilities = ["task.create", "task.read", "store.read", "workspace.use", "plugin.read", "plugin.manage"];
permission.hasCapability = (capability) => permission.capabilities.includes(capability);
// No storage object is supplied: the real shell keeps its collapse behavior in memory.
useSidebarStore(pinia).hydrate();

const chat = useChatStore(pinia);
chat.phase = "ready";
chat.context = {
  contextId: "019c1a00-0000-7000-8000-000000000008",
  expiresAtEpochSeconds: 2_000_000_000,
  allowedActions: ["read_sessions", "create_session", "submit_turn", "read_projects", "use_project"],
};
chat.projects = projects;
chat.sessions = sessions;
chat.selectedSessionId = null;
chat.history = null;
chat.draftTarget = { type: "new" };
chat.draftTargetReady = true;
chat.localReadiness = {
  lifecycle: "ready", host: "ready", runtime: "ready", storage: "ready",
  canSend: true, issueCode: null, retryable: false, recovery: "none",
};

let nextSession = 100;
const previewHistory = new Map<string, ChatHistoryPage>();
function makeHistory(input: string): ChatHistoryPage {
  return {
    turns: [{
      turnId: "019c1a00-0000-7000-8000-000000000200", status: "completed",
      terminalAt: FIXTURE_TIME + 1000, reasoningStatus: "complete", reasoningReasonCode: null,
      messages: [
        { messageId: "019c1a00-0000-7000-8000-000000000201", role: "user", content: input, status: "complete", ordinal: 1, createdAt: FIXTURE_TIME },
        { messageId: "019c1a00-0000-7000-8000-000000000202", role: "assistant", content: "这是隔离配色样张中的合成回复。未调用模型、经营工具或本地文件，刷新预览后恢复初始样例。", status: "complete", ordinal: 2, createdAt: FIXTURE_TIME + 1000 },
      ],
      reasoning: [],
    }],
    nextCursor: null,
  };
}

function selectPreviewSession(sessionId: string): void {
  const history = previewHistory.get(sessionId) ?? makeHistory("查看本地合成任务样例。");
  chat.selectedSessionId = sessionId;
  chat.selectedAccessMode = "live";
  chat.history = history;
  chat.phase = "ready";
  chat.draftTarget = { type: "session", sessionId };
  chat.draftTargetReady = true;
  chat.conversationState = reconcileConversationSnapshot(createConversationState(), historyPageToConversationSnapshot(sessionId, history));
}

// Only the isolated Pinia instance is substituted. Production store files stay intact.
chat.bind = async () => undefined;
chat.selectSession = async (sessionId) => selectPreviewSession(sessionId);
chat.clearSelectedSession = async () => {
  chat.selectedSessionId = null;
  chat.selectedAccessMode = null;
  chat.history = null;
  chat.conversationState = createConversationState();
  chat.draftTarget = { type: "new" };
  chat.draftTargetReady = true;
};
chat.deactivatePageSession = async () => undefined;
chat.loadReasoning = async () => [];
chat.loadOlderHistory = async () => undefined;
chat.loadMoreSessions = async () => undefined;
chat.reloadSessions = async () => undefined;
chat.resyncSelected = async () => undefined;
chat.refreshSelectedCleanup = async () => null;
chat.refreshControlPlane = async () => null;
chat.refreshLocalReadiness = async () => chat.localReadiness;
chat.requestLocalRecovery = async () => chat.localReadiness;
chat.retryDraftRecovery = async () => true;
chat.revalidateProject = async (projectId) => projects.find((project) => project.projectId === projectId) ?? null;
chat.pickProject = async () => { memoryActions.push("project:pick-synthetic"); return projects[0] ?? null; };
chat.pickAttachments = async () => { memoryActions.push("attachment:picker-omitted"); return []; };
chat.importAttachmentPaths = async () => [];
chat.interruptSelected = async () => false;
chat.createSessionWithResult = async (projectId, input): Promise<ChatSubmissionResult> => {
  const sessionId = `019c1a00-0000-7000-8000-${String(nextSession++).padStart(12, "0")}`;
  chat.sessions = [{ sessionId, projectId, title: input.slice(0, 30), titleSource: "fallback", pinnedAt: null, lastActivityAt: FIXTURE_TIME, latestTurnStatus: "completed", projectAvailable: true }, ...chat.sessions];
  previewHistory.set(sessionId, makeHistory(input));
  memoryActions.push("chat:create-synthetic");
  return { status: "local_durable_accepted", draftTarget: { type: "new" }, sessionId, turnId: "019c1a00-0000-7000-8000-000000000200", operationId: "019c1a00-0000-7000-8000-000000000203" };
};
chat.createSession = async (projectId, input) => {
  const result = await chat.createSessionWithResult(projectId, input);
  return result.status === "local_durable_accepted" ? result.sessionId : null;
};
chat.submitTurnWithResult = async (input): Promise<ChatSubmissionResult> => {
  const sessionId = chat.selectedSessionId;
  if (!sessionId) return { status: "not_accepted" };
  previewHistory.set(sessionId, makeHistory(input));
  selectPreviewSession(sessionId);
  memoryActions.push("chat:reply-synthetic");
  return { status: "local_durable_accepted", draftTarget: { type: "session", sessionId }, sessionId, turnId: "019c1a00-0000-7000-8000-000000000200", operationId: "019c1a00-0000-7000-8000-000000000203" };
};
chat.submitTurn = async (input) => { await chat.submitTurnWithResult(input); };

const categoryFixtures = [
  { category: "sourcing-selection", icon: "skillSourcing", names: ["选品机会分析", "供应商对比建议", "商品潜力评估"] },
  { category: "market-research", icon: "skillResearch", names: ["目标市场分析", "竞品经营观察", "消费需求研究"] },
  { category: "content-marketing", icon: "skillContent", names: ["跨境营销文案", "Listing 内容优化", "品牌内容计划"] },
  { category: "traffic-advertising", icon: "skillTraffic", names: ["广告效果分析", "关键词投放建议", "流量增长计划"] },
  { category: "store-operations", icon: "skillOperations", names: ["店铺经营诊断", "库存情况梳理", "经营周报整理"] },
];
let catalog: SkillCatalogSnapshot = parseSkillCatalogSnapshot({
  schemaVersion: 1,
  scannedAt: "2026-09-06T00:00:00Z",
  skills: categoryFixtures.flatMap(({ category, icon, names }, categoryIndex) => names.map((displayName, index) => ({
    id: `yijie.${category}.preview-${index}`, runtimeName: `preview-${categoryIndex}-${index}`, category, order: index,
    displayName, description: "整理关键经营信息，提供清晰的分析方向与行动建议。此处使用固定合成样例。",
    version: "0.1.0", iconKey: icon, riskLevel: index === 2 ? "medium" : "low", riskReasons: ["执行前请核对业务事实。"],
    sourceType: "internal", licenseExpression: "LicenseRef-YiJie-Local-Development-Only",
    executionMode: "model-only", networkAccess: "none", filesystemAccess: "none", requiredTools: [],
    catalogStatus: "installable", maintenanceStatus: "maintained", capabilityReadiness: "ready",
    installationStatus: index === 0 ? "installed" : "not_installed", enabled: index === 0, runtimeVisible: index === 0, failureCode: "",
  }))),
});
function updateSkill(id: string, patch: Partial<ManagedSkillProjection>): SkillCatalogSnapshot {
  catalog = { ...catalog, skills: catalog.skills.map((skill) => skill.id === id ? { ...skill, ...patch } : skill) };
  return catalog;
}
// Retain the actual Skill store's state transitions, with an in-memory client boundary.
skillNativeClient.list = async () => catalog;
skillNativeClient.scan = async () => { memoryActions.push("skills:scan-synthetic"); return catalog; };
skillNativeClient.install = async (id) => {
  memoryActions.push("skills:install-synthetic");
  return updateSkill(id, { installationStatus: "installed", enabled: true, runtimeVisible: true });
};
skillNativeClient.setEnabled = async (id, enabled) => {
  memoryActions.push("skills:toggle-synthetic");
  return updateSkill(id, { enabled, runtimeVisible: enabled });
};
skillNativeClient.uninstall = async (id) => {
  memoryActions.push("skills:uninstall-synthetic");
  return updateSkill(id, { installationStatus: "not_installed", enabled: false, runtimeVisible: false });
};
skillNativeClient.subscribeDirectoryChanged = async () => () => undefined;
const skills = useSkillStore(pinia);
skills.skills = catalog.skills;
skills.phase = "ready";
skills.scannedAt = catalog.scannedAt;
if (state !== "ready") {
  // These are passive UI projections, not injected backend/native failures.
  const applySkillScenario = () => {
    skills.skills = [];
    skills.phase = state === "error" ? "unavailable" : state === "denied" ? "permission-denied" : state === "loading" ? "loading" : "empty";
    skills.lastFailure = state === "error" ? "unavailable" : state === "denied" ? "permission-denied" : null;
  };
  applySkillScenario();
  skills.open = async () => applySkillScenario();
}

const OutsidePreview = defineComponent({
  render: () => h("section", { class: "yj-page" }, [
    h("h1", "本轮未包含此页面"),
    h("p", "本次只评审新建任务、我的店铺、Skill 广场及组件状态图谱。请从预览导航返回。"),
  ]),
});
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: "/chat", component: ChatPage },
  { path: "/chat/:sessionId", component: ChatPage },
  { path: "/store", component: StorePage },
  { path: "/plugins", component: SkillMarketplacePage },
  { path: "/atlas", component: StateAtlas },
  { path: "/:pathMatch(.*)*", component: OutsidePreview },
] });
router.beforeEach(async (to) => {
  if (typeof to.params.sessionId === "string") selectPreviewSession(to.params.sessionId);
  else if (to.path === "/chat") await chat.clearSelectedSession();
});
await router.push(`/${page}`);
await router.isReady();
if (page === "chat") {
  if (state === "empty") {
    chat.projects = [];
    chat.sessions = [];
  } else if (state === "loading") {
    chat.phase = "binding";
    chat.localReadiness = {
      lifecycle: "starting", host: "starting", runtime: "starting", storage: "ready",
      canSend: false, issueCode: "chat_host_starting", retryable: false, recovery: "none",
    };
  } else if (state === "error") {
    chat.phase = "unavailable";
    chat.lastErrorCode = "chat_temporarily_unavailable";
  } else if (state === "denied") {
    chat.phase = "permission-denied";
    chat.lastErrorCode = "chat_capability_denied";
    chat.context = { ...chat.context!, allowedActions: ["read_sessions", "read_projects"] };
  }
}

const previewApi = {
  page, variant, theme, state, memoryActions, native: nativePreviewDiagnostics,
  setAppearance: (appearance: { theme?: "light" | "dark"; variant?: "current" | "candidate" }) => {
    window.dispatchEvent(new CustomEvent("component-color-preview-appearance", { detail: appearance }));
  },
};
Object.assign(window, { __COMPONENT_COLOR_PREVIEW__: previewApi });
createApp(PageHarness, { theme, variant }).use(pinia).use(router).mount("#app");
