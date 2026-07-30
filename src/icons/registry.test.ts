import { describe, expect, it } from "vitest";
import { iconRegistry } from "./registry";

describe("iconRegistry", () => {
  it("exposes only the semantic icons required by the FEAT-124 app shell", () => {
    expect(Object.keys(iconRegistry).sort()).toEqual([
      "collapseSidebar",
      "expandSidebar",
      "knowledge",
      "newTask",
      "plugin",
      "scheduledTask",
      "settings",
      "store",
      "taskHistory",
      "workspace",
    ]);
  });

  it("maps every semantic name to a renderable component", () => {
    expect(Object.values(iconRegistry).every((icon) => typeof icon === "function")).toBe(true);
  });
});
