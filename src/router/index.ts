import { nextTick } from "vue";
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type RouteMeta,
  type RouteRecordRaw,
  type RouterHistory,
} from "vue-router";
import ChatPage from "../pages/chat/ChatPage.vue";
import SettingsPage from "../pages/settings/SettingsPage.vue";
import TasksPage from "../pages/tasks/TasksPage.vue";

export const APP_ROUTE_RECORDS = [
  { path: "/", redirect: "/chat" },
  {
    path: "/chat",
    name: "chat",
    component: ChatPage,
    meta: {
      navKey: "newTask",
      documentTitle: "新建任务 · 易界 AI",
    },
  },
  {
    path: "/tasks",
    name: "tasks",
    component: TasksPage,
    meta: {
      navKey: "taskHistory",
      documentTitle: "任务记录 · 易界 AI",
    },
  },
  {
    path: "/settings",
    name: "settings",
    component: SettingsPage,
    meta: {
      navKey: "settings",
      documentTitle: "设置 · 易界 AI",
    },
  },
] as const satisfies readonly RouteRecordRaw[];

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

export function createAppRouter(history: RouterHistory) {
  const appRouter = createRouter({
    history,
    routes: APP_ROUTE_RECORDS,
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
