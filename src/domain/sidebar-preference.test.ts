import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_MODE,
  SIDEBAR_PREFERENCE_STORAGE_KEY,
  readSidebarMode,
  writeSidebarMode,
  type SidebarPreferenceStorage,
} from "./sidebar-preference";

class MemoryStorage implements SidebarPreferenceStorage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
}

describe("sidebar preference v1", () => {
  it("PREF-001 defaults to expanded when the key is absent", () => {
    expect(readSidebarMode(new MemoryStorage())).toBe(DEFAULT_SIDEBAR_MODE);
    expect(DEFAULT_SIDEBAR_MODE).toBe("expanded");
  });

  it("PREF-002 writes and reads the expanded value", () => {
    const storage = new MemoryStorage();

    writeSidebarMode(storage, "expanded");

    expect(readSidebarMode(storage)).toBe("expanded");
  });

  it("PREF-003 writes and reads the collapsed value", () => {
    const storage = new MemoryStorage();

    writeSidebarMode(storage, "collapsed");

    expect(readSidebarMode(storage)).toBe("collapsed");
  });

  it.each(["", "compact", " collapsed ", "{broken-json"])(
    "PREF-004 falls back for an unknown or corrupt value: %j",
    (storedValue) => {
      const storage = new MemoryStorage();
      storage.values.set(SIDEBAR_PREFERENCE_STORAGE_KEY, storedValue);

      expect(readSidebarMode(storage)).toBe(DEFAULT_SIDEBAR_MODE);
    },
  );

  it("PREF-005 writes only the dedicated v1 key so older builds can ignore it", () => {
    const storage = new MemoryStorage();
    storage.values.set("legacy.preference", "unchanged");

    writeSidebarMode(storage, "collapsed");

    expect(storage.writes).toEqual([
      {
        key: "yijie.desktop.ui.sidebar.v1",
        value: "collapsed",
      },
    ]);
    expect(storage.values.get("legacy.preference")).toBe("unchanged");
  });

  it("PREF-006 contains storage read and write failures", () => {
    const unavailableStorage: SidebarPreferenceStorage = {
      getItem() {
        throw new Error("synthetic read failure");
      },
      setItem() {
        throw new Error("synthetic write failure");
      },
    };

    expect(readSidebarMode(unavailableStorage)).toBe(DEFAULT_SIDEBAR_MODE);
    expect(() => writeSidebarMode(unavailableStorage, "collapsed")).not.toThrow();
  });
});
