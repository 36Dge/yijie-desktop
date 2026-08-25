import { describe, expect, it } from "vitest";
import type { KnownCapability } from "../domain/permissions";
import {
  canRenderProtectedPath,
  requiredCapabilityForPath,
  resolveNavigationVisibility,
  resolveRootRoute,
} from "./app-permission-policy";

function snapshot(
  capabilities: readonly KnownCapability[],
  overrides: { enabled?: boolean; ready?: boolean } = {},
) {
  return {
    enabled: overrides.enabled ?? true,
    ready: overrides.ready ?? true,
    hasCapability: (capability: KnownCapability) => capabilities.includes(capability),
  };
}

describe("app permission policy", () => {
  it("POLICY-001 emits a total deny-by-default navigation projection", () => {
    expect(resolveNavigationVisibility(snapshot([], { enabled: false }))).toEqual({
      newTask: false,
      taskHistory: false,
      store: false,
      workspace: false,
      scheduledTask: false,
      plugin: false,
      knowledge: false,
      settings: true,
    });
    expect(resolveNavigationVisibility(snapshot([], { ready: false }))).toEqual(
      resolveNavigationVisibility(snapshot([], { enabled: false })),
    );
  });

  it("POLICY-002 maps every published and unpublished module to its exact capability", () => {
    expect(
      resolveNavigationVisibility(
        snapshot(["task.create", "store.read", "schedule.read", "knowledge.read"]),
      ),
    ).toEqual({
      newTask: true,
      taskHistory: false,
      store: true,
      workspace: false,
      scheduledTask: true,
      plugin: false,
      knowledge: true,
      settings: true,
    });
  });

  it("FEAT-129 separates plugin navigation/read access from plugin management", () => {
    const readOnly = snapshot(["plugin.read"]);
    const manageOnly = snapshot(["plugin.manage"]);

    expect(resolveNavigationVisibility(readOnly).plugin).toBe(true);
    expect(requiredCapabilityForPath("/plugins")).toBe("plugin.read");
    expect(canRenderProtectedPath("/plugins", readOnly)).toBe(true);
    expect(canRenderProtectedPath("/plugins", manageOnly)).toBe(false);
    expect(canRenderProtectedPath("/plugins", {
      ...readOnly,
      skillMarketplaceUiEnabled: false,
    })).toBe(false);
  });

  it.each([
    [["task.create", "task.read"] as const, "/chat"],
    [["task.read"] as const, "/settings"],
    [[] as const, "/settings"],
  ])("POLICY-003 resolves root priority for %j", (capabilities, expected) => {
    expect(resolveRootRoute(snapshot(capabilities))).toBe(expected);
  });

  it("POLICY-004 keeps settings public inside the authenticated shell and protects task routes", () => {
    const readOnly = snapshot(["task.read"]);

    expect(requiredCapabilityForPath("/settings")).toBeNull();
    expect(requiredCapabilityForPath("/chat")).toBe("task.create");
    expect(requiredCapabilityForPath("/tasks")).toBeNull();
    expect(canRenderProtectedPath("/settings", readOnly)).toBe(true);
    expect(canRenderProtectedPath("/chat", readOnly)).toBe(false);
  });
});
