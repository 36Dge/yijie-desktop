import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SIDEBAR_PREFERENCE_STORAGE_KEY,
  type SidebarPreferenceStorage,
} from "../domain/sidebar-preference";
import { useSidebarStore } from "./sidebar.store";
import { TASK_DIRECTORY_PREFERENCE_STORAGE_KEY } from "../domain/task-directory-preference";

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
    expect(storage.reads).toBe(2);
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
});
