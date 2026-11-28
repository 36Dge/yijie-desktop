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

  it("keeps all removed-directory history in creation order, including sessions on a later page", () => {
    const sessions = [session("managed-new", managed), session("removed-user", other, false), session("managed-old", managed), session("projectless", null)]
      .map((row, index) => ({ ...row, lastActivityAt: 40 - index }));
    const before = JSON.stringify(sessions);
    const preferences = [{ projectId: managed, pinnedAt: null, removed: true }];
    const first = buildChatSidebarHistory(projects, sessions.slice(0, 2), preferences);
    const afterPaging = buildChatSidebarHistory(projects, sessions, preferences);
    expect(first.groups.map((entry) => entry.projectId)).toEqual([user]);
    expect(afterPaging.groups.map((entry) => entry.projectId)).toEqual([user]);
    expect(afterPaging.otherSessions.map((entry) => entry.sessionId)).toEqual(["projectless", "managed-new", "removed-user", "managed-old"]);
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
    expect(result.otherSessions).toEqual([]);
  });

  it("collects pins across task origins by pin time and sorts the remaining sections by creation", () => {
    const old = { ...session("00000000-03e8-7000-8000-000000000001", managed), pinnedAt: 10, lastActivityAt: 99 };
    const newer = session("00000000-0bb8-7000-8000-000000000001", managed);
    const sameMillisecond = session("00000000-0bb8-7000-8000-000000000002", managed);
    const latest = session("00000000-0fa0-7000-8000-000000000001", null);
    const legacy = { ...session("00000000-0000-4000-8000-000000000001", null), lastActivityAt: 2 };
    const pinned = { ...session("00000000-0001-7000-8000-000000000001", null), pinnedAt: 30 };
    const removed = { ...session("removed", other, false), pinnedAt: 0 };
    const projectPin = { ...session("00000000-03e8-7000-8000-000000000002", user), pinnedAt: 10 };
    const rows = [old, legacy, newer, pinned, sameMillisecond, latest, removed, projectPin];
    for (const input of [rows, [...rows].reverse()]) {
      const history = buildChatSidebarHistory(projects, input);
      expect(history.groups.map(group => group.projectId)).toEqual([user, managed]);
      expect(history.pinnedSessions).toEqual([pinned, projectPin, old, removed]);
      expect(history.groups[0]).toMatchObject({ hasSessions: true, sessions: [] });
      expect(history.groups[1]?.sessions).toEqual([sameMillisecond, newer]);
      expect(history.otherSessions).toEqual([latest, legacy]);
    }
  });

  it("keeps a managed folder with only a pinned task and restores the task according to current directory preferences", () => {
    const row = session("managed-task", managed);
    const pinned = { ...row, pinnedAt: 5 };
    const history = buildChatSidebarHistory([], [pinned]);
    expect(history.groups).toMatchObject([{ projectId: managed, hasSessions: true, sessions: [] }]);
    expect(history.pinnedSessions).toEqual([pinned]);

    const preferences = [{ projectId: managed, pinnedAt: null, removed: true }];
    expect(buildChatSidebarHistory([], [pinned], preferences)).toMatchObject({ groups: [], pinnedSessions: [pinned], otherSessions: [] });
    expect(buildChatSidebarHistory([], [row], preferences)).toMatchObject({ groups: [], pinnedSessions: [], otherSessions: [row] });
  });
});
