import { defineComponent } from "vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import type { KnownCapability } from "../domain/permissions";
import {
  APP_ROUTE_RECORDS,
  createAppRouteRecords,
  createAppRouter,
  focusRouteHeading,
  syncRouteTitle,
  type AppPageLoaders,
  type RouterPermissionBoundary,
} from "./index";

function boundary(
  capabilities: readonly KnownCapability[],
  options: { enabled?: boolean; ready?: boolean } = {},
): RouterPermissionBoundary {
  return {
    enabled: options.enabled ?? true,
    ready: options.ready ?? true,
    ensureInitialized: vi.fn(async () => undefined),
    hasCapability: (capability) => capabilities.includes(capability),
  };
}

function pageLoaders(): { loaders: AppPageLoaders; chat: ReturnType<typeof vi.fn> } {
  const page = defineComponent({ template: "<h1>test page</h1>" });
  const chat = vi.fn(async () => page);
  return {
    chat,
    loaders: {
      chat,
      plugins: async () => page,
      settings: async () => page,
      accessDenied: async () => page,
    },
  };
}

describe("app router", () => {
  it.each([
    [["task.create", "task.read"] as const, "/chat", "chat"],
    [["task.read"] as const, "/settings", "settings"],
    [[] as const, "/settings", "settings"],
  ])("ROUTE-001 resolves the root policy for %j", async (capabilities, path, name) => {
    const router = createAppRouter(createMemoryHistory(), boundary(capabilities), undefined, true);

    await router.push("/");
    await router.isReady();

    expect(router.currentRoute.value.path).toBe(path);
    expect(router.currentRoute.value.name).toBe(name);
  });

  it("ROUTE-002 keeps the default-off build on Settings core", async () => {
    const { loaders, chat } = pageLoaders();
    const router = createAppRouter(
      createMemoryHistory(),
      boundary(["task.create", "task.read"]),
      loaders,
      false,
    );

    await router.push("/");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/settings");

    await router.push("/chat");
    expect(router.currentRoute.value.path).toBe("/settings");
    expect(chat).not.toHaveBeenCalled();
  });

  it("ROUTE-003 gives a session deep link task.read capability and never task.create", async () => {
    const router = createAppRouter(createMemoryHistory(), boundary(["task.read"]), undefined, true);
    const sessionId = "019c1a00-0000-7000-8000-000000000005";
    await router.push(`/chat/${sessionId}`);
    await router.isReady();
    expect(router.currentRoute.value.name).toBe("chat-session");
  });

  it.each([
    ["/chat", "chat", ["task.create"] as const],
    ["/settings", "settings", [] as const],
  ])("ROUTE-003 resolves the allowed direct entry %s", async (path, name, capabilities) => {
    const router = createAppRouter(createMemoryHistory(), boundary(capabilities), undefined, true);

    await router.push(path);
    await router.isReady();

    expect(router.currentRoute.value.path).toBe(path);
    expect(router.currentRoute.value.name).toBe(name);
  });

  it("ROUTE-004 redirects a denied deep link before its business page is instantiated", async () => {
    const { loaders, chat } = pageLoaders();
    const router = createAppRouter(createMemoryHistory(), boundary(["task.read"]), loaders, true);

    await router.push("/chat");
    await router.isReady();

    expect(router.currentRoute.value.path).toBe("/access-denied");
    expect(router.currentRoute.value.query).toEqual({ from: "/chat" });
    expect(chat).not.toHaveBeenCalled();
  });

  it("ROUTE-005 routes non-ready permission state to recovery without loading business pages", async () => {
    const { loaders, chat } = pageLoaders();
    const router = createAppRouter(
      createMemoryHistory(),
      boundary(["task.create"], { ready: false }),
      loaders,
      true,
    );

    await router.push("/chat");
    await router.isReady();

    expect(router.currentRoute.value.path).toBe("/settings");
    expect(chat).not.toHaveBeenCalled();
  });

  it("ROUTE-006 exposes no route for unpublished business modules", () => {
    expect(APP_ROUTE_RECORDS.map((route) => route.path)).toEqual([
      "/",
      "/settings",
      "/access-denied",
    ]);
    expect(APP_ROUTE_RECORDS.map((route) => route.path)).not.toEqual(
      expect.arrayContaining(["/tasks", "/store", "/workspace", "/scheduled-tasks", "/plugins", "/knowledge"]),
    );
  });

  it("FEAT-129 protects the local Skill marketplace with plugin.read", async () => {
    const allowed = createAppRouter(
      createMemoryHistory(),
      boundary(["plugin.read"]),
      undefined,
      true,
      true,
    );
    await allowed.push("/plugins");
    await allowed.isReady();
    expect(allowed.currentRoute.value.name).toBe("plugins");

    const denied = createAppRouter(
      createMemoryHistory(),
      boundary(["plugin.manage"]),
      undefined,
      true,
      true,
    );
    await denied.push("/plugins");
    await denied.isReady();
    expect(denied.currentRoute.value.path).toBe("/access-denied");
  });

  it("FEAT-129 keeps /plugins closed outside the exact local feature profile", async () => {
    const router = createAppRouter(
      createMemoryHistory(),
      boundary(["plugin.read"]),
      undefined,
      true,
      false,
    );
    await router.push("/plugins");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/settings");
  });

  it("ROUTE-007 keeps route names, navigation keys, and document titles aligned", () => {
    expect(
      createAppRouteRecords(undefined, true).filter((route) => route.path !== "/").map((route) => ({
        path: route.path,
        name: route.name,
        navKey: route.meta?.navKey,
        documentTitle: route.meta?.documentTitle,
      })),
    ).toEqual([
      {
        path: "/chat",
        name: "chat",
        navKey: "newTask",
        documentTitle: "新建任务 · 易界 AI",
      },
      {
        path: "/chat/:sessionId",
        name: "chat-session",
        navKey: "newTask",
        documentTitle: "任务对话 · 易界 AI",
      },
      {
        path: "/settings",
        name: "settings",
        navKey: "settings",
        documentTitle: "设置 · 易界 AI",
      },
      {
        path: "/access-denied",
        name: "access-denied",
        navKey: undefined,
        documentTitle: "无权访问 · 易界 AI",
      },
    ]);
  });

  it("FEAT-129 registers the local marketplace title and navigation key", () => {
    expect(createAppRouteRecords(undefined, true, true).find((route) => route.path === "/plugins"))
      .toMatchObject({
        name: "plugins",
        meta: { navKey: "plugin", documentTitle: "Skill 广场 · 易界 AI" },
      });
  });

  it("ROUTE-008 synchronizes the title and focuses the route heading", () => {
    const focus = vi.fn();
    const heading = { focus, tabIndex: 0 };
    const routeDocument = {
      title: "",
      querySelector: vi.fn(() => heading),
    } as unknown as Document;

    syncRouteTitle({ documentTitle: "任务对话 · 易界 AI" }, routeDocument);
    focusRouteHeading(routeDocument);

    expect(routeDocument.title).toBe("任务对话 · 易界 AI");
    expect(routeDocument.querySelector).toHaveBeenCalledWith("main h1");
    expect(heading.tabIndex).toBe(-1);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
