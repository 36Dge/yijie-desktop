import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SIDEBAR_PREFERENCE_STORAGE_KEY,
  type SidebarPreferenceStorage,
} from "../domain/sidebar-preference";
import { useSidebarStore } from "./sidebar.store";

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
    expect(storage.reads).toBe(1);
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
});
