import axe from "axe-core";
import type { AxeResults } from "axe-core";
import { createApp } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import type {
  ChatAttachment,
  ChatHistoryPage,
  ChatProject,
  ChatSession,
} from "../../../src/domain/chat-ipc";
import {
  CHAT_NEW_DRAFT_TARGET,
  chatSessionDraftTarget,
} from "../../../src/domain/chat-ipc";
import ChatPage from "../../../src/pages/chat/ChatPage.vue";
import { useChatStore } from "../../../src/stores/chat.store";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import VisualHarness from "../feat-126-s8b/VisualHarness.vue";
import DragOverlayFixture from "./DragOverlayFixture.vue";

const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";
const query = new URLSearchParams(window.location.search);
const dark = query.get("theme") === "dark";
const view = query.get("view") ?? "ready-file";
document.documentElement.dataset.theme = dark ? "dark" : "light";

const projects: readonly ChatProject[] = Object.freeze([{
  projectId: PROJECT_ID,
  safeName: "Local Design Workspace",
  pinnedAt: 1,
  lastUsedAt: 9,
  available: true,
}]);

const sessions: readonly ChatSession[] = Object.freeze([{
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  title: "核对多模态附件上下文",
  titleSource: "model",
  pinnedAt: 2,
  lastActivityAt: 9,
  latestTurnStatus: "completed",
  projectAvailable: true,
}]);

const readyFile: ChatAttachment = Object.freeze({
  attachmentId: "019c1a00-0000-7000-8000-000000000010",
  type: "file",
  name: "FEAT-127-local-verification.pdf",
  mediaType: "application/pdf",
  sizeBytes: 482_304,
  status: "ready",
  expiresAt: 1_786_387_200,
});

const readyImage: ChatAttachment = Object.freeze({
  attachmentId: "019c1a00-0000-7000-8000-000000000011",
  type: "image",
  name: "composer-plus-reference.png",
  mediaType: "image/png",
  sizeBytes: 1_284_096,
  status: "ready",
  expiresAt: 1_786_387_200,
});

const expiredHistory: ChatHistoryPage = Object.freeze({
  turns: Object.freeze([{
    turnId: "019c1a00-0000-7000-8000-000000000012",
    status: "completed",
    terminalAt: 1_785_000_003,
    reasoningStatus: "complete",
    reasoningReasonCode: null,
    messages: Object.freeze([{
      messageId: "019c1a00-0000-7000-8000-000000000013",
      role: "user",
      content: "请根据附件整理本地验收结论。",
      contentBlocks: Object.freeze([
        { type: "text", text: "请根据附件整理本地验收结论。" },
        {
          attachmentId: "019c1a00-0000-7000-8000-000000000014",
          type: "file",
          name: "synthetic-local-evidence.pdf",
          mediaType: "application/pdf",
          sizeBytes: 720_896,
          status: "expired",
          expiresAt: 1_784_900_000,
        },
      ]),
      status: "complete",
      ordinal: 1,
      createdAt: 1_785_000_002,
    }, {
      messageId: "019c1a00-0000-7000-8000-000000000015",
      role: "assistant",
      content: "已完成本地验收结论整理。",
      contentBlocks: Object.freeze([{ type: "text", text: "已完成本地验收结论整理。" }]),
      status: "complete",
      ordinal: 2,
      createdAt: 1_785_000_003,
    }]),
    reasoning: Object.freeze([]),
  }]),
  nextCursor: null,
});

const pinia = createPinia();
setActivePinia(pinia);
const store = useChatStore(pinia);
store.phase = "ready";
store.context = Object.freeze({
  contextId: "019c1a00-0000-7000-8000-000000000016",
  expiresAtEpochSeconds: 2_000_000_000,
  allowedActions: Object.freeze([
    "read_sessions", "create_session", "submit_turn", "rename_session", "pin_session",
    "interrupt_turn", "delete_session", "read_projects", "use_project", "pin_project",
    "remove_project", "read_cleanup",
  ]),
});
store.projects = projects;
store.sessions = sessions;
store.localReadiness = Object.freeze({
  lifecycle: "ready",
  host: "ready",
  runtime: "ready",
  storage: "ready",
  canSend: true,
  issueCode: null,
  retryable: false,
  recovery: "none",
});

if (view === "expired-history") {
  store.selectedSessionId = SESSION_ID;
  store.draftTarget = chatSessionDraftTarget(SESSION_ID);
  store.draftTargetReady = true;
  store.history = expiredHistory;
  store.controlPlane = Object.freeze({
    sessionId: SESSION_ID,
    state: "bound",
    issueCode: null,
    retryable: false,
    recovery: "none",
  });
} else {
  store.draftTarget = CHAT_NEW_DRAFT_TARGET;
  store.draftTargetReady = true;
  if (view === "ready-image") {
    store.draftAttachments = Object.freeze([readyImage]);
  } else if (view === "draft-queue") {
    store.draftAttachments = Object.freeze([readyFile, readyImage]);
  } else if (view !== "drag-overlay") {
    store.draftAttachments = Object.freeze([readyFile]);
  }
}

store.loadOlderHistory = async () => undefined;
store.revalidateProject = async (projectId) => projects.find((project) => project.projectId === projectId) ?? null;
store.pickProject = async () => projects[0] ?? null;
store.interruptSelected = async () => undefined;

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/chat", component: ChatPage },
    { path: "/chat/:sessionId", component: ChatPage },
    { path: "/fixture/drag-overlay", component: DragOverlayFixture },
    { path: "/settings", component: { template: "<div>设置</div>" } },
  ],
});
const target = view === "expired-history"
  ? `/chat/${SESSION_ID}`
  : view === "drag-overlay"
    ? "/fixture/drag-overlay"
    : "/chat";
await router.push(target);
await router.isReady();

declare global {
  interface Window {
    __FEAT127_RUN_AXE__: () => Promise<AxeResults>;
  }
}

window.__FEAT127_RUN_AXE__ = () => axe.run(document, {
  rules: { region: { enabled: false } },
});

createApp(VisualHarness, { dark }).use(pinia).use(router).mount("#app");

const axeEvidence = document.createElement("script");
axeEvidence.id = "feat127-axe-results";
axeEvidence.type = "application/json";
document.body.append(axeEvidence);
void window.__FEAT127_RUN_AXE__().then((results) => {
  axeEvidence.textContent = JSON.stringify({
    violations: results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    })),
  });
  axeEvidence.dataset.ready = "true";
});
