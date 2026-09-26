import type { ChatProject, ChatSession } from "./chat-ipc";

export interface ChatHistoryProjectGroup {
  readonly projectId: string;
  readonly project: ChatProject | null;
  readonly label: string;
  readonly sessions: readonly ChatSession[];
}

export function buildChatSidebarHistory(
  projects: readonly ChatProject[],
  sessions: readonly ChatSession[],
): { groups: readonly ChatHistoryProjectGroup[]; removedProjectSessions: readonly ChatSession[] } {
  const grouped = new Map<string, ChatSession[]>();
  const removedProjectSessions: ChatSession[] = [];
  for (const session of sessions) {
    if (!session.projectAvailable) {
      removedProjectSessions.push(session);
      continue;
    }
    const group = grouped.get(session.projectId) ?? [];
    group.push(session);
    grouped.set(session.projectId, group);
  }

  const availableProjectIds = new Set(projects.map((project) => project.projectId));
  const groups: ChatHistoryProjectGroup[] = projects.map((project) => ({
    projectId: project.projectId,
    project,
    label: project.safeName,
    sessions: grouped.get(project.projectId) ?? [],
  }));
  // Managed task directories can be available without appearing in the project picker.
  for (const [projectId, groupSessions] of grouped) {
    if (!availableProjectIds.has(projectId)) {
      groups.push({ projectId, project: null, label: "任务目录", sessions: groupSessions });
    }
  }
  // Preserve the authoritative session order within the final, flat history section.
  return { groups, removedProjectSessions };
}
