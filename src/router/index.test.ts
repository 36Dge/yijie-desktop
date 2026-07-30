import { createMemoryHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import {
  APP_ROUTE_RECORDS,
  createAppRouter,
  focusRouteHeading,
  syncRouteTitle,
} from "./index";

describe("app router", () => {
  it("ROUTE-001 redirects the root route to /chat", async () => {
    const router = createAppRouter(createMemoryHistory());

    await router.push("/");
    await router.isReady();

    expect(router.currentRoute.value.path).toBe("/chat");
    expect(router.currentRoute.value.name).toBe("chat");
  });

  it.each([
    ["/chat", "chat"],
    ["/tasks", "tasks"],
    ["/settings", "settings"],
  ])("ROUTE-002 resolves the direct entry %s", async (path, name) => {
    const router = createAppRouter(createMemoryHistory());

    await router.push(path);
    await router.isReady();

    expect(router.currentRoute.value.path).toBe(path);
    expect(router.currentRoute.value.name).toBe(name);
  });

  it("ROUTE-003 exposes no route for disabled business modules", () => {
    expect(APP_ROUTE_RECORDS.map((route) => route.path)).toEqual([
      "/",
      "/chat",
      "/tasks",
      "/settings",
    ]);
    expect(APP_ROUTE_RECORDS.map((route) => route.path)).not.toEqual(
      expect.arrayContaining(["/store", "/workspace", "/scheduled-tasks", "/plugins", "/knowledge"]),
    );
  });

  it("ROUTE-004 keeps route names, navigation keys, and document titles aligned", () => {
    expect(
      APP_ROUTE_RECORDS.filter((route) => route.path !== "/").map((route) => ({
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
        path: "/tasks",
        name: "tasks",
        navKey: "taskHistory",
        documentTitle: "任务记录 · 易界 AI",
      },
      {
        path: "/settings",
        name: "settings",
        navKey: "settings",
        documentTitle: "设置 · 易界 AI",
      },
    ]);
  });

  it("ROUTE-005 synchronizes the title and focuses the route heading", () => {
    const focus = vi.fn();
    const heading = { focus, tabIndex: 0 };
    const routeDocument = {
      title: "",
      querySelector: vi.fn(() => heading),
    } as unknown as Document;

    syncRouteTitle({ documentTitle: "任务记录 · 易界 AI" }, routeDocument);
    focusRouteHeading(routeDocument);

    expect(routeDocument.title).toBe("任务记录 · 易界 AI");
    expect(routeDocument.querySelector).toHaveBeenCalledWith("main h1");
    expect(heading.tabIndex).toBe(-1);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
