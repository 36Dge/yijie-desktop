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

function comparePins(a: { pinnedAt: number | null }, b: { pinnedAt: number | null }): number {
  return (b.pinnedAt ?? -1) - (a.pinnedAt ?? -1);
}

/** Keep the store in native page order when merging scheduled session updates. */
export function compareSidebarSessions(a: ChatSession, b: ChatSession): number {
  return comparePins(a, b) || b.lastActivityAt - a.lastActivityAt || b.sessionId.localeCompare(a.sessionId);
}

function creationTimeMs(session: ChatSession): number {
  // Native allocates UUIDv7 at creation, including for managed tasks. Its first
  // 48 bits are Unix milliseconds. Older ID formats only expose activity seconds.
  const timestamp = /^([\da-f]{8})-([\da-f]{4})-7/i.exec(session.sessionId);
  return timestamp ? Number.parseInt(timestamp[1] + timestamp[2], 16) : session.lastActivityAt * 1000;
}

function compareTasksByCreation(a: ChatSession, b: ChatSession): number {
  return comparePins(a, b) || creationTimeMs(b) - creationTimeMs(a) || b.sessionId.localeCompare(a.sessionId);
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

  for (const members of grouped.values()) members.sort(compareTasksByCreation);
  projectlessSessions.sort(compareTasksByCreation);
  removedProjectSessions.sort(compareTasksByCreation);

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
  groups.sort(comparePins);
  return { groups, removedProjectSessions, projectlessSessions };
}
