import axe from "axe-core";
import type { AxeResults } from "axe-core";
import { createApp } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import type {
  ChatHistoryPage,
  ChatProject,
  ChatReasoningItem,
  ChatSession,
} from "../../../src/domain/chat-ipc";
import ChatPage from "../../../src/pages/chat/ChatPage.vue";
import { useChatStore } from "../../../src/stores/chat.store";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import VisualHarness from "./VisualHarness.vue";

const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";
const dark = new URLSearchParams(window.location.search).get("theme") === "dark";
const view = new URLSearchParams(window.location.search).get("view") ?? "active";
document.documentElement.dataset.theme = dark ? "dark" : "light";

const projects: readonly ChatProject[] = Object.freeze([
  { projectId: PROJECT_ID, safeName: "project", pinnedAt: 1, lastUsedAt: 9, available: true },
  { projectId: "019c1a00-0000-7000-8000-000000000010", safeName: "Local Design Workspace", pinnedAt: null, lastUsedAt: 4, available: true },
]);

const sessions: readonly ChatSession[] = Object.freeze([
  { sessionId: SESSION_ID, projectId: PROJECT_ID, title: "完善 FEAT-126 对话界面", titleSource: "model", pinnedAt: 2, lastActivityAt: 9, latestTurnStatus: "streaming", projectAvailable: true },
  { sessionId: "019c1a00-0000-7000-8000-000000000003", projectId: PROJECT_ID, title: "核对本地删除边界", titleSource: "model", pinnedAt: null, lastActivityAt: 8, latestTurnStatus: "completed", projectAvailable: true },
  { sessionId: "019c1a00-0000-7000-8000-000000000004", projectId: PROJECT_ID, title: "验证数据库迁移", titleSource: "renamed", pinnedAt: null, lastActivityAt: 7, latestTurnStatus: "completed", projectAvailable: true },
]);

const history: ChatHistoryPage = Object.freeze({
  turns: Object.freeze([{
    turnId: "019c1a00-0000-7000-8000-000000000005",
    status: "completed",
    terminalAt: 7,
    reasoningStatus: "complete",
    reasoningReasonCode: null,
    messages: Object.freeze([
      { messageId: "019c1a00-0000-7000-8000-000000000006", role: "user", content: "检查新建任务、推理展开和历史恢复是否符合本地交付范围。", status: "complete", ordinal: 1, createdAt: 1_780_000_000_000 },
      { messageId: "019c1a00-0000-7000-8000-000000000007", role: "assistant", content: "已按固定 fixture 完成界面投影检查。正文与推理均保持纯文本，不会执行 Markdown 或 HTML。", status: "complete", ordinal: 2, createdAt: 1_780_000_030_000 },
    ]),
    reasoning: Object.freeze([{ itemOrdinal: 0, status: "complete", reasonCode: null, totalBytes: 105, partCount: 1, finalizedAtMs: 1_780_000_025_000 }]),
  }]),
  nextCursor: "opaque-older-page",
});

const reasoning: readonly ChatReasoningItem[] = Object.freeze([{
  itemOrdinal: 0,
  status: "complete",
  reasonCode: null,
  totalBytes: 105,
  parts: Object.freeze([{ contentIndex: 0, text: "先验证授权边界，再检查流式聚合、滚动阈值与无障碍语义。所有内容都来自固定的合成 fixture。" }]),
}]);

const pinia = createPinia();
setActivePinia(pinia);
const store = useChatStore(pinia);
store.phase = view === "active" ? "streaming" : "ready";
store.context = {
  contextId: "019c1a00-0000-7000-8000-000000000008",
  expiresAtEpochSeconds: 2_000_000_000,
  allowedActions: [
    "read_sessions", "create_session", "submit_turn", "rename_session", "pin_session",
    "interrupt_turn", "delete_session", "read_projects", "use_project", "pin_project",
    "remove_project", "read_cleanup",
  ],
};
store.projects = projects;
store.sessions = sessions;
store.selectedSessionId = view === "active" ? SESSION_ID : null;
store.history = view === "active" ? history : null;
store.liveAssistantText = view === "active" ? "正在核对 reduced-motion 与键盘焦点行为。" : "";
store.liveReasoning = view === "active"
  ? [{ itemOrdinal: 1, contentIndex: 0, text: "检查当前滚动位置，仅在用户仍跟随底部时自动滚动。" }]
  : [];
store.liveTurnStatus = view === "active" ? "streaming" : null;
store.localReadiness = {
  lifecycle: "ready",
  host: "ready",
  runtime: "ready",
  storage: "ready",
  canSend: true,
  issueCode: null,
  retryable: false,
  recovery: "none",
};

// Fixed synthetic actions stay in this test-only harness and never enter the production bundle.
store.loadReasoning = async () => reasoning;
store.loadOlderHistory = async () => undefined;
store.revalidateProject = async (projectId) => projects.find((project) => project.projectId === projectId) ?? null;
store.pickProject = async () => projects[0] ?? null;
store.interruptSelected = async () => undefined;

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/chat", component: ChatPage },
    { path: "/chat/:sessionId", component: ChatPage },
    { path: "/tasks", component: { template: "<div>任务记录</div>" } },
    { path: "/settings", component: { template: "<div>设置</div>" } },
  ],
});
await router.push(view === "active" ? `/chat/${SESSION_ID}` : "/chat");
await router.isReady();

declare global {
  interface Window {
    __FEAT126_RUN_AXE__: () => Promise<AxeResults>;
  }
}

window.__FEAT126_RUN_AXE__ = () => axe.run(document, {
  rules: { region: { enabled: false } },
});

createApp(VisualHarness, { dark }).use(pinia).use(router).mount("#app");
