import { describe, expect, it } from "vitest";
import { buildChatSidebarHistory } from "./chat-sidebar-history";
import type { ChatProject, ChatSession } from "./chat-ipc";

const user = "019c1a00-0000-7000-8000-000000000001";
const managed = "019c1a00-0000-7000-8000-000000000002";
const other = "019c1a00-0000-7000-8000-000000000003";
const projects: ChatProject[] = [{ projectId: user, safeName: "User project", pinnedAt: 20, lastUsedAt: 10, available: true }];
function session(id: string, projectId: string | null, available = true): ChatSession {
  return { sessionId: id, projectId, title: id, titleSource: "fallback", pinnedAt: null, lastActivityAt: 10, latestTurnStatus: "completed", projectAvailable: available };
}

describe("sidebar directory preferences", () => {
  it("orders managed and ordinary pins together while preserving unpinned group order", () => {
    const history = buildChatSidebarHistory(projects, [session("first", managed), session("second", other)], [
      { projectId: managed, pinnedAt: 30, removed: false },
    ]);
    expect(history.groups.map((entry) => entry.projectId)).toEqual([managed, user, other]);
    expect(history.groups[0]?.project).toBeNull();
    expect(history.groups[0]?.pinnedAt).toBe(30);
  });

  it("keeps all removed-directory history in native order, including sessions on a later page", () => {
    const sessions = [session("managed-new", managed), session("removed-user", other, false), session("managed-old", managed), session("projectless", null)];
    const before = JSON.stringify(sessions);
    const preferences = [{ projectId: managed, pinnedAt: null, removed: true }];
    const first = buildChatSidebarHistory(projects, sessions.slice(0, 2), preferences);
    const afterPaging = buildChatSidebarHistory(projects, sessions, preferences);
    expect(first.groups.map((entry) => entry.projectId)).toEqual([user]);
    expect(afterPaging.groups.map((entry) => entry.projectId)).toEqual([user]);
    expect(afterPaging.removedProjectSessions.map((entry) => entry.sessionId)).toEqual(["managed-new", "removed-user", "managed-old"]);
    expect(afterPaging.projectlessSessions.map((entry) => entry.sessionId)).toEqual(["projectless"]);
    expect(JSON.stringify(sessions)).toBe(before);
    expect(sessions[0]?.projectAvailable).toBe(true);
  });

  it("does not apply managed-only preferences to native picker projects or unrelated IDs", () => {
    const result = buildChatSidebarHistory(projects, [session("user", user), session("managed", managed)], [
      { projectId: user, pinnedAt: null, removed: true },
      { projectId: other, pinnedAt: 99, removed: false },
    ]);
    expect(result.groups.map((entry) => entry.projectId)).toEqual([user, managed]);
    expect(result.groups[0]?.pinnedAt).toBe(20);
    expect(result.removedProjectSessions).toEqual([]);
  });
});
