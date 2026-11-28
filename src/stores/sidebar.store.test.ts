import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SIDEBAR_PREFERENCE_STORAGE_KEY,
  type SidebarPreferenceStorage,
} from "../domain/sidebar-preference";
import { useSidebarStore } from "./sidebar.store";
import { TASK_DIRECTORY_PREFERENCE_STORAGE_KEY } from "../domain/task-directory-preference";
import { buildChatSidebarHistory } from "../domain/chat-sidebar-history";
import type { ChatSession } from "../domain/chat-ipc";
import { PROJECT_SESSION_ORDER_KEY, SECTION_SESSION_ORDER_KEY } from "../domain/sidebar-session-order";

class RecordingStorage implements SidebarPreferenceStorage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];
  reads = 0;

  getItem(key: string): string | null {
    this.reads += 1;
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
}

describe("sidebar store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("hydrates the default expanded mode once", () => {
    const storage = new RecordingStorage();
    const store = useSidebarStore();

    store.hydrate(storage);
    store.hydrate(storage);

    expect(store.mode).toBe("expanded");
    expect(store.isCollapsed).toBe(false);
    expect(store.isHydrated).toBe(true);
    expect(storage.reads).toBe(4);
  });

  it("restores collapsed and persists the next toggle", () => {
    const storage = new RecordingStorage();
    storage.values.set(SIDEBAR_PREFERENCE_STORAGE_KEY, "collapsed");
    const store = useSidebarStore();

    store.hydrate(storage);
    store.toggle();

    expect(store.mode).toBe("expanded");
    expect(storage.writes).toEqual([
      {
        key: SIDEBAR_PREFERENCE_STORAGE_KEY,
        value: "expanded",
      },
    ]);
  });

  it("keeps the in-memory toggle when persistence fails", () => {
    const storage: SidebarPreferenceStorage = {
      getItem: () => "expanded",
      setItem() {
        throw new Error("synthetic write failure");
      },
    };
    const store = useSidebarStore();

    store.hydrate(storage);

    expect(() => store.toggle()).not.toThrow();
    expect(store.mode).toBe("collapsed");
  });

  it("uses the default without storage access", () => {
    const store = useSidebarStore();

    store.hydrate();
    store.toggle();

    expect(store.mode).toBe("collapsed");
    expect(store.isHydrated).toBe(true);
  });

  it("persists directory pinning and removal across store recreation without overwriting the sidebar mode", () => {
    const storage = new RecordingStorage();
    storage.values.set(SIDEBAR_PREFERENCE_STORAGE_KEY, "collapsed");
    const id = "019c1a00-0000-7000-8000-000000000001";
    const store = useSidebarStore();
    store.hydrate(storage);
    store.setTaskDirectoryPinned(id, true);
    const firstPin = store.taskDirectoryPreferences[0]!.pinnedAt;
    expect(firstPin).not.toBeNull();
    store.setTaskDirectoryPinned(id, true);
    expect(store.taskDirectoryPreferences[0]!.pinnedAt).toBe(firstPin);
    const reopened = useSidebarStore(createPinia());
    reopened.hydrate(storage);
    expect(reopened.taskDirectoryPreferences).toEqual(store.taskDirectoryPreferences);
    reopened.setTaskDirectoryPinned(id, false);
    expect(reopened.taskDirectoryPreferences).toEqual([]);
    reopened.removeTaskDirectory(id);
    const again = useSidebarStore(createPinia());
    again.hydrate(storage);
    expect(again.taskDirectoryPreferences).toEqual([{ projectId: id, pinnedAt: null, removed: true }]);
    expect(storage.values.get(SIDEBAR_PREFERENCE_STORAGE_KEY)).toBe("collapsed");
    expect(storage.writes.every((write) => write.key === TASK_DIRECTORY_PREFERENCE_STORAGE_KEY)).toBe(true);
  });

  it("preserves an unsupported preference version and does not pretend an unavailable preference was saved", () => {
    const storage = new RecordingStorage();
    const raw = JSON.stringify({ schemaVersion: 2, entries: [] });
    storage.values.set(TASK_DIRECTORY_PREFERENCE_STORAGE_KEY, raw);
    const store = useSidebarStore();
    store.hydrate(storage);
    expect(() => store.removeTaskDirectory("019c1a00-0000-7000-8000-000000000001")).toThrow();
    expect(storage.values.get(TASK_DIRECTORY_PREFERENCE_STORAGE_KEY)).toBe(raw);
    expect(store.taskDirectoryPreferences).toEqual([]);
  });

  it("keeps directory preferences unchanged if a normal storage adapter rejects a save", () => {
    const store = useSidebarStore();
    store.hydrate({ getItem: () => null, setItem: () => { throw new Error("storage unavailable"); } });
    expect(() => store.setTaskDirectoryPinned("019c1a00-0000-7000-8000-000000000001", true)).toThrow();
    expect(store.taskDirectoryPreferences).toEqual([]);
  });

  it("restores manual project order across new tasks, partial pages, pinning and store recreation", () => {
    const storage = new RecordingStorage();
    const store = useSidebarStore();
    store.hydrate(storage);
    const projectId = "019c1a00-0000-7000-8000-000000000010";
    const rows: ChatSession[] = [4, 3, 2, 1].map(i => ({
      projectId, sessionId: `019c1a00-0000-7000-8000-00000000000${i}`, projectAvailable: true,
      pinnedAt: null, lastActivityAt: i, latestTurnStatus: "completed", title: String(i), titleSource: "user",
    }));
    const [fresh, a, b, c] = rows;
    const history = (list: ChatSession[], sidebar = store) => buildChatSidebarHistory([], list, [], sidebar.sessionOrders);
    store.moveSession(projectId, history([a, b, c]), c.sessionId, a.sessionId, "before");
    const reopened = useSidebarStore(createPinia());
    reopened.hydrate(storage);
    expect(history([c, b, fresh, a], reopened).groups[0]!.sessions).toEqual([fresh, c, a, b]);
    expect(history([fresh, c, { ...a, pinnedAt: 1 }, b], reopened).groups[0]!.sessions).toEqual([fresh, c, b]);

    reopened.moveSession(projectId, history([b, c], reopened), c.sessionId, b.sessionId, "after");
    expect(history(rows, reopened).groups[0]!.sessions).toEqual([fresh, a, b, c]);
    expect(storage.writes.every(write => write.key === PROJECT_SESSION_ORDER_KEY)).toBe(true);
  });

  it.each(["projects", "sections"] as const)("preserves unknown %s preferences and can still sort the other kind of list", kind => {
    const storage = new RecordingStorage();
    const key = kind === "projects" ? PROJECT_SESSION_ORDER_KEY : SECTION_SESSION_ORDER_KEY;
    const raw = JSON.stringify({ schemaVersion: 2, [kind]: {} });
    storage.values.set(key, raw);
    const store = useSidebarStore();
    store.hydrate(storage);
    const projectId = "019c1a00-0000-7000-8000-000000000010";
    const row: ChatSession = { projectId, sessionId: projectId, projectAvailable: true, pinnedAt: null,
      title: "普通任务", titleSource: "user", lastActivityAt: 1, latestTurnStatus: "completed" };
    const other = { ...row, sessionId: "019c1a00-0000-7000-8000-000000000011" };
    const sortProject = () => store.moveSession(projectId, buildChatSidebarHistory([], [row, other]), row.sessionId, other.sessionId, "after");
    const pinned = [row, other].map(task => ({ ...task, pinnedAt: 1 }));
    const sortPinned = () => store.moveSession("pinned", buildChatSidebarHistory([], pinned), row.sessionId, other.sessionId, "before");
    expect(kind === "projects" ? sortProject : sortPinned).toThrow();
    expect(storage.writes).toEqual([]);
    expect(store.sessionOrders).toEqual({});
    (kind === "projects" ? sortPinned : sortProject)();
    expect(storage.writes).toHaveLength(1);
    expect(storage.values.get(key)).toBe(raw);
  });

  it("restores pinned and other orders independently of existing project preferences and task membership", () => {
    const storage = new RecordingStorage();
    const id = (suffix: number) => `019c1a00-0000-7000-8000-${String(suffix).padStart(12, "0")}`;
    const project = id(10), removedDirectory = id(11);
    const row = (n: number, projectId: string | null, pinnedAt: number | null = null): ChatSession => ({
      sessionId: id(n), projectId, pinnedAt, projectAvailable: true, title: String(n),
      titleSource: "user", latestTurnStatus: "completed", lastActivityAt: n,
    });
    const savedProject = JSON.stringify({ schemaVersion: 1, projects: { [project]: [id(1), id(3), id(2)] } });
    storage.values.set(PROJECT_SESSION_ORDER_KEY, savedProject);
    const store = useSidebarStore();
    store.hydrate(storage);
    store.removeTaskDirectory(removedDirectory);
    const rows = [row(1, project), row(2, project), row(3, project, 1), row(4, null, 2), row(5, null), row(6, removedDirectory)];
    const history = (list: ChatSession[], sidebar = store) =>
      buildChatSidebarHistory([], list, sidebar.taskDirectoryPreferences, sidebar.sessionOrders);
    const snapshot = history(rows);
    expect(snapshot.pinnedSessions.map(task => task.sessionId)).toEqual([id(4), id(3)]);
    expect(snapshot.otherSessions.map(task => task.sessionId)).toEqual([id(5), id(6)]);
    expect(() => store.moveSession("other", snapshot, id(1), id(5), "before")).toThrow();
    expect(() => store.moveSession("pinned", snapshot, id(3), id(5), "after")).toThrow();
    expect(storage.values.has(SECTION_SESSION_ORDER_KEY)).toBe(false);
    store.moveSession("pinned", snapshot, id(3), id(4), "before");
    store.moveSession("other", history(rows), id(6), id(5), "before");
    expect(storage.values.get(PROJECT_SESSION_ORDER_KEY)).toBe(savedProject);

    const reopened = useSidebarStore(createPinia());
    reopened.hydrate(storage);
    const result = history([...rows].reverse().concat(row(7, null, 3), row(8, null)), reopened);
    expect(result.groups[0].sessions.map(task => task.sessionId)).toEqual([id(1), id(2)]);
    expect(result.pinnedSessions.map(task => task.sessionId)).toEqual([id(7), id(3), id(4)]);
    expect(result.pinnedSessions.map(task => [task.projectId, task.pinnedAt])).toEqual([[null, 3], [project, 1], [null, 2]]);
    expect(result.otherSessions.map(task => task.sessionId)).toEqual([id(8), id(6), id(5)]);
    const unpinned = history(rows.map(task => task.sessionId === id(3) ? { ...task, pinnedAt: null } : task), reopened);
    expect(unpinned.pinnedSessions.map(task => task.sessionId)).toEqual([id(4)]);
    expect(unpinned.groups[0].sessions.map(task => task.sessionId)).toEqual([id(1), id(3), id(2)]);
  });
});
