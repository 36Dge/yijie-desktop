import { describe, expect, it } from "vitest";
import { APP_NAVIGATION, resolveAppNavigation } from "./app-nav";

describe("app navigation", () => {
  it("NAV-001 keeps the approved task, business, and bottom navigation order", () => {
    const resolved = resolveAppNavigation(APP_NAVIGATION);

    expect(resolved.map((entry) => entry.key)).toEqual([
      "newTask",
      "taskHistory",
      "businessDivider",
      "store",
      "workspace",
      "scheduledTask",
      "plugin",
      "knowledge",
      "settings",
    ]);
    expect(
      resolved.filter((entry) => entry.kind === "item").map((entry) => entry.label),
    ).toEqual([
      "新建任务",
      "任务记录",
      "我的店铺",
      "工作台",
      "定时任务",
      "插件",
      "资料库",
      "设置",
    ]);
  });

  it("NAV-002 exposes only the three implemented routes", () => {
    const resolvedItems = resolveAppNavigation(APP_NAVIGATION).filter(
      (entry) => entry.kind === "item",
    );

    expect(
      resolvedItems
        .filter((item) => !item.disabled)
        .map((item) => ({ key: item.key, to: item.to })),
    ).toEqual([
      { key: "newTask", to: "/chat" },
      { key: "taskHistory", to: "/tasks" },
      { key: "settings", to: "/settings" },
    ]);
    expect(resolvedItems.filter((item) => item.disabled).every((item) => !("to" in item))).toBe(
      true,
    );
  });

  it("NAV-003 removes hidden items before rendering", () => {
    const resolved = resolveAppNavigation(APP_NAVIGATION, {
      plugin: false,
      store: false,
    });

    expect(resolved.map((entry) => entry.key)).not.toContain("plugin");
    expect(resolved.map((entry) => entry.key)).not.toContain("store");
  });

  it("NAV-004 removes a divider when its entire following group is hidden", () => {
    const resolved = resolveAppNavigation(APP_NAVIGATION, {
      knowledge: false,
      plugin: false,
      scheduledTask: false,
      store: false,
      workspace: false,
    });

    expect(resolved.map((entry) => entry.key)).toEqual(["newTask", "taskHistory", "settings"]);
  });

  it("NAV-005 uses unique stable keys", () => {
    const keys = APP_NAVIGATION.map((entry) => entry.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
