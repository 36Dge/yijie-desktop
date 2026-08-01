import { nextTick, type Component } from "vue";
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type RouteMeta,
  type RouteRecordRaw,
  type RouterHistory,
} from "vue-router";
import {
  requiredCapabilityForPath,
  resolveRootRoute,
  type PermissionPolicySnapshot,
} from "../authorization/app-permission-policy";
import { authoritativePermissionUiEnabled } from "../authorization/permission-ui-config";
import type { KnownCapability } from "../domain/permissions";
import { usePermissionStore } from "../stores/permission.store";

const RootRoutePage: Component = { render: () => null };

export interface AppPageLoaders {
  chat: () => Promise<Component>;
  tasks: () => Promise<Component>;
  settings: () => Promise<Component>;
  accessDenied: () => Promise<Component>;
}

const APP_PAGE_LOADERS: AppPageLoaders = {
  chat: async () => (await import("../pages/chat/ChatPage.vue")).default,
  tasks: async () => (await import("../pages/tasks/TasksPage.vue")).default,
  settings: async () => (await import("../pages/settings/SettingsPage.vue")).default,
  accessDenied: async () => (await import("../pages/access/AccessDeniedPage.vue")).default,
};

export interface RouterPermissionBoundary {
  readonly enabled: boolean;
  readonly ready: boolean;
  ensureInitialized(): Promise<void>;
  hasCapability(capability: KnownCapability): boolean;
}

const productionPermissionBoundary: RouterPermissionBoundary = {
  get enabled() {
    return authoritativePermissionUiEnabled;
  },
  get ready() {
    return usePermissionStore().isReady;
  },
  async ensureInitialized() {
    await usePermissionStore().ensureInitialized();
  },
  hasCapability(capability) {
    return usePermissionStore().hasCapability(capability);
  },
};

function policySnapshot(boundary: RouterPermissionBoundary): PermissionPolicySnapshot {
  return {
    enabled: boundary.enabled,
    ready: boundary.ready,
    hasCapability: (capability) => boundary.hasCapability(capability),
  };
}

export function createAppRouteRecords(
  pageLoaders: AppPageLoaders = APP_PAGE_LOADERS,
): readonly RouteRecordRaw[] {
  return [
    {
      path: "/",
      name: "root",
      component: RootRoutePage,
      meta: { documentTitle: "易界 AI" },
    },
    {
      path: "/chat",
      name: "chat",
      component: pageLoaders.chat,
      meta: {
        navKey: "newTask",
        documentTitle: "新建任务 · 易界 AI",
      },
    },
    {
      path: "/tasks",
      name: "tasks",
      component: pageLoaders.tasks,
      meta: {
        navKey: "taskHistory",
        documentTitle: "任务记录 · 易界 AI",
      },
    },
    {
      path: "/settings",
      name: "settings",
      component: pageLoaders.settings,
      meta: {
        navKey: "settings",
        documentTitle: "设置 · 易界 AI",
      },
    },
    {
      path: "/access-denied",
      name: "access-denied",
      component: pageLoaders.accessDenied,
      meta: { documentTitle: "无权访问 · 易界 AI" },
    },
  ];
}

export const APP_ROUTE_RECORDS = createAppRouteRecords();

export function syncRouteTitle(routeMeta: RouteMeta, routeDocument: Document): void {
  if (typeof routeMeta.documentTitle === "string") {
    routeDocument.title = routeMeta.documentTitle;
  }
}

export function focusRouteHeading(routeDocument: Document): void {
  const heading = routeDocument.querySelector<HTMLElement>("main h1");

  if (!heading) {
    return;
  }

  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

export function createAppRouter(
  history: RouterHistory,
  permissionBoundary: RouterPermissionBoundary = productionPermissionBoundary,
  pageLoaders: AppPageLoaders = APP_PAGE_LOADERS,
) {
  const appRouter = createRouter({
    history,
    routes: createAppRouteRecords(pageLoaders),
  });

  appRouter.beforeEach(async (route) => {
    if (route.path === "/") {
      if (permissionBoundary.enabled) {
        await permissionBoundary.ensureInitialized();
      }
      return resolveRootRoute(policySnapshot(permissionBoundary));
    }

    const requiredCapability = requiredCapabilityForPath(route.path);
    if (requiredCapability === null) {
      return true;
    }
    if (!permissionBoundary.enabled) {
      return { path: "/settings", replace: true };
    }

    await permissionBoundary.ensureInitialized();
    if (!permissionBoundary.ready) {
      return { path: "/settings", replace: true };
    }
    if (!permissionBoundary.hasCapability(requiredCapability)) {
      return {
        path: "/access-denied",
        query: { from: route.path },
        replace: true,
      };
    }
    return true;
  });

  appRouter.afterEach((route) => {
    if (typeof document === "undefined") {
      return;
    }

    syncRouteTitle(route.meta, document);
    void nextTick(() => focusRouteHeading(document));
  });

  return appRouter;
}

const defaultHistory =
  typeof window === "undefined" ? createMemoryHistory() : createWebHistory();

export const router = createAppRouter(defaultHistory);
