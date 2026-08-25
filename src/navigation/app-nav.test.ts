import { describe, expect, it } from "vitest";
import { APP_NAVIGATION, resolveAppNavigation } from "./app-nav";

describe("app navigation", () => {
  it("NAV-001 keeps the approved task, business, and bottom navigation order", () => {
    const resolved = resolveAppNavigation(APP_NAVIGATION);

    expect(resolved.map((entry) => entry.key)).toEqual([
      "newTask",
      "store",
      "workspace",
      "scheduledTask",
      "plugin",
      "knowledge",
      "taskHistory",
      "settings",
    ]);
    expect(resolved.map((entry) => entry.label)).toEqual([
      "新建任务",
      "我的店铺",
      "工作台",
      "定时任务",
      "插件",
      "资料库",
      "任务记录",
      "设置",
    ]);
  });

  it("NAV-002 exposes only implemented routes and keeps task history non-navigable", () => {
    const resolvedItems = resolveAppNavigation(APP_NAVIGATION).filter(
      (entry) => entry.kind === "item",
    );

    expect(
      resolvedItems
        .filter((item) => !item.disabled)
        .map((item) => ({ key: item.key, to: item.to })),
    ).toEqual([
      { key: "newTask", to: "/chat" },
      { key: "plugin", to: "/plugins" },
      { key: "settings", to: "/settings" },
    ]);
    expect(resolvedItems.filter((item) => item.disabled).every((item) => !("to" in item))).toBe(
      true,
    );
    const taskHistory = resolveAppNavigation(APP_NAVIGATION).find((entry) => entry.key === "taskHistory");
    expect(taskHistory).toMatchObject({ kind: "section", label: "任务记录" });
    expect(taskHistory && "to" in taskHistory).toBe(false);
    expect(taskHistory && "disabled" in taskHistory).toBe(false);
  });

  it("NAV-003 removes hidden items before rendering", () => {
    const resolved = resolveAppNavigation(APP_NAVIGATION, {
      plugin: false,
      store: false,
    });

    expect(resolved.map((entry) => entry.key)).not.toContain("plugin");
    expect(resolved.map((entry) => entry.key)).not.toContain("store");
  });

  it("NAV-004 keeps the task history section after hidden business modules", () => {
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
