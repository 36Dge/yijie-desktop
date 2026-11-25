import type { ChatProject, ChatSession } from "./chat-ipc";
import type { TaskDirectoryPreference } from "./task-directory-preference";
import type { RunRecord } from "../api/generated/scheduled-task-ipc-v2.gen";

export function isChatSessionRunning(status: ChatSession["latestTurnStatus"]): boolean {
  return status === "streaming" || status === "inProgress";
}

export const scheduledSidebarLabels = {
  created: "已新建", running: "执行中", stopping: "停止中", completed: "已结束",
  failed: "执行失败", interrupted: "已停止", cancelled: "已取消", attention: "需处理", unknown: "待确认",
} as const;
export type ScheduledSidebarState = keyof typeof scheduledSidebarLabels;

export function scheduledSidebarState(record: RunRecord, turnStatus: string): ScheduledSidebarState {
  if (record.run.native_outcome !== "unobserved") return record.run.native_outcome;
  if (record.run.delivery_state === "cancelled") return "cancelled";
  if (turnStatus === "completed" || turnStatus === "failed" || turnStatus === "interrupted") return turnStatus;
  if (record.attention === "needs_attention") return "attention";
  if (record.run.delivery_state === "uncertain" || record.run.delivery_state === "terminal") return "unknown";
  if (turnStatus === "stopping") return "stopping";
  if (isChatSessionRunning(turnStatus) || record.timing.duration === "in_progress") return "running";
  return turnStatus === "queued" ? "created" : "unknown";
}

/** Native session list order, including user-pinned rows and equal activity timestamps. */
export function compareSidebarSessions(a: ChatSession, b: ChatSession): number {
  if (a.pinnedAt !== b.pinnedAt) return a.pinnedAt === null ? 1 : b.pinnedAt === null ? -1 : b.pinnedAt - a.pinnedAt;
  return b.lastActivityAt - a.lastActivityAt || b.sessionId.localeCompare(a.sessionId);
}

export interface ChatHistoryProjectGroup {
  readonly projectId: string;
  readonly project: ChatProject | null;
  readonly label: string;
  readonly pinnedAt: number | null;
  readonly sessions: readonly ChatSession[];
}

export function buildChatSidebarHistory(
  projects: readonly ChatProject[],
  sessions: readonly ChatSession[],
  taskDirectoryPreferences: readonly TaskDirectoryPreference[] = [],
): { groups: readonly ChatHistoryProjectGroup[]; removedProjectSessions: readonly ChatSession[]; projectlessSessions: readonly ChatSession[] } {
  const grouped = new Map<string, ChatSession[]>();
  const removedProjectSessions: ChatSession[] = [];
  const projectlessSessions: ChatSession[] = [];
  const availableProjectIds = new Set(projects.map((project) => project.projectId));
  const directoryPreferences = new Map(taskDirectoryPreferences.map((entry) => [entry.projectId, entry]));
  for (const session of sessions) {
    if (session.projectId === null) {
      projectlessSessions.push(session);
      continue;
    }
    if (!session.projectAvailable
      || (!availableProjectIds.has(session.projectId) && directoryPreferences.get(session.projectId)?.removed)) {
      removedProjectSessions.push(session);
      continue;
    }
    const group = grouped.get(session.projectId) ?? [];
    group.push(session);
    grouped.set(session.projectId, group);
  }

  const groups: ChatHistoryProjectGroup[] = projects.map((project) => ({
    projectId: project.projectId,
    project,
    label: project.safeName,
    pinnedAt: project.pinnedAt,
    sessions: grouped.get(project.projectId) ?? [],
  }));
  // Managed task directories can be available without appearing in the project picker.
  for (const [projectId, groupSessions] of grouped) {
    if (!availableProjectIds.has(projectId)) {
      groups.push({ projectId, project: null, label: "任务目录", pinnedAt: directoryPreferences.get(projectId)?.pinnedAt ?? null, sessions: groupSessions });
    }
  }
  // Stable sorting preserves the native order of unpinned groups and pin-time ties.
  groups.sort((a, b) => a.pinnedAt === null ? (b.pinnedAt === null ? 0 : 1)
    : b.pinnedAt === null ? -1 : b.pinnedAt - a.pinnedAt);
  // Sidebar removal never changes native availability or the authoritative session order.
  return { groups, removedProjectSessions, projectlessSessions };
}
