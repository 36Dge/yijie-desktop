import { describe, expect, it } from "vitest";
import { iconRegistry } from "./registry";

describe("iconRegistry", () => {
  it("exposes only the semantic icons required by the app shell and chat features", () => {
    expect(Object.keys(iconRegistry).sort()).toEqual([
      "arrowRight",
      "assistant",
      "backToBottom",
      "check",
      "chevronDown",
      "chevronRight",
      "collapseSidebar",
      "copy",
      "dismiss",
      "download",
      "edit",
      "expandSidebar",
      "file",
      "fileImage",
      "folder",
      "folderOpen",
      "gridView",
      "image",
      "knowledge",
      "listView",
      "message",
      "more",
      "newTask",
      "pending",
      "pin",
      "pinOff",
      "plugin",
      "plus",
      "refresh",
      "scanSearch",
      "scheduledTask",
      "send",
      "settings",
      "shield",
      "skillContent",
      "skillOperations",
      "skillResearch",
      "skillSourcing",
      "skillTraffic",
      "stop",
      "store",
      "taskHistory",
      "trash",
      "user",
      "video",
      "warning",
      "workflow",
      "workspace",
      "zoomIn",
      "zoomOut",
    ]);
  });

  it("maps every semantic name to a renderable component", () => {
    expect(Object.values(iconRegistry).every((icon) => typeof icon === "function")).toBe(true);
  });
});
