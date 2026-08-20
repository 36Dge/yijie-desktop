import { describe, expect, it } from "vitest";
import { iconRegistry } from "./registry";

describe("iconRegistry", () => {
  it("exposes only the semantic icons required by the app shell and chat features", () => {
    expect(Object.keys(iconRegistry).sort()).toEqual([
      "assistant",
      "backToBottom",
      "check",
      "chevronDown",
      "chevronRight",
      "collapseSidebar",
      "dismiss",
      "download",
      "edit",
      "expandSidebar",
      "file",
      "folder",
      "folderOpen",
      "image",
      "knowledge",
      "more",
      "newTask",
      "pending",
      "pin",
      "pinOff",
      "plugin",
      "plus",
      "refresh",
      "scheduledTask",
      "send",
      "settings",
      "shield",
      "stop",
      "store",
      "taskHistory",
      "trash",
      "user",
      "warning",
      "workspace",
      "zoomIn",
      "zoomOut",
    ]);
  });

  it("maps every semantic name to a renderable component", () => {
    expect(Object.values(iconRegistry).every((icon) => typeof icon === "function")).toBe(true);
  });
});
