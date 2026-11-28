import type { ChatProject, ChatSession } from "./chat-ipc";
import type { TaskDirectoryPreference } from "./task-directory-preference";
import { applySessionOrder, type SessionOrders } from "./sidebar-session-order";
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
  return creationTimeMs(b) - creationTimeMs(a) || b.sessionId.localeCompare(a.sessionId);
}

export interface ChatHistoryProjectGroup {
  readonly projectId: string;
  readonly project: ChatProject | null;
  readonly label: string;
  readonly pinnedAt: number | null;
  /** Includes tasks displayed in the pinned section. */
  readonly hasSessions: boolean;
  readonly sessions: readonly ChatSession[];
}

export interface ChatSidebarHistory {
  readonly groups: readonly ChatHistoryProjectGroup[];
  readonly pinnedSessions: readonly ChatSession[];
  readonly otherSessions: readonly ChatSession[];
}

export function buildChatSidebarHistory(
  projects: readonly ChatProject[],
  sessions: readonly ChatSession[],
  taskDirectoryPreferences: readonly TaskDirectoryPreference[] = [],
  sessionOrders: SessionOrders = {},
): ChatSidebarHistory {
  const grouped = new Map<string, ChatSession[]>();
  const pinnedSessions: ChatSession[] = [];
  const removedProjectSessions: ChatSession[] = [];
  const projectlessSessions: ChatSession[] = [];
  const availableProjectIds = new Set(projects.map((project) => project.projectId));
  const directoryPreferences = new Map(taskDirectoryPreferences.map((entry) => [entry.projectId, entry]));
  for (const session of sessions) {
    let members: ChatSession[];
    if (session.projectId === null) {
      members = projectlessSessions;
    } else if (!session.projectAvailable
      || (!availableProjectIds.has(session.projectId) && directoryPreferences.get(session.projectId)?.removed)) {
      members = removedProjectSessions;
    } else {
      members = grouped.get(session.projectId) ?? [];
      grouped.set(session.projectId, members);
    }
    if (session.pinnedAt !== null) pinnedSessions.push(session);
    else members.push(session);
  }

  pinnedSessions.sort((a, b) => comparePins(a, b) || compareTasksByCreation(a, b));
  for (const [projectId, members] of grouped) {
    grouped.set(projectId, applySessionOrder(members.sort(compareTasksByCreation), sessionOrders[projectId]));
  }
  projectlessSessions.sort(compareTasksByCreation);
  removedProjectSessions.sort(compareTasksByCreation);

  const groups: ChatHistoryProjectGroup[] = projects.map((project) => ({
    projectId: project.projectId,
    project,
    label: project.safeName,
    pinnedAt: project.pinnedAt,
    hasSessions: grouped.has(project.projectId),
    sessions: grouped.get(project.projectId) ?? [],
  }));
  // Managed task directories can be available without appearing in the project picker.
  for (const [projectId, groupSessions] of grouped) {
    if (!availableProjectIds.has(projectId)) {
      groups.push({
        projectId, project: null, label: "任务目录",
        pinnedAt: directoryPreferences.get(projectId)?.pinnedAt ?? null,
        hasSessions: true, sessions: groupSessions,
      });
    }
  }
  // Stable sorting preserves the native order of unpinned groups and pin-time ties.
  groups.sort(comparePins);
  return {
    groups,
    pinnedSessions: applySessionOrder(pinnedSessions, sessionOrders.pinned),
    otherSessions: applySessionOrder([...projectlessSessions, ...removedProjectSessions], sessionOrders.other),
  };
}
