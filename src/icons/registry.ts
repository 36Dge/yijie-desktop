import type { Component } from "vue";
import {
  CalendarClock,
  LayoutDashboard,
  LibraryBig,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  SquarePen,
  Store,
} from "@lucide/vue";

export const iconRegistry = {
  collapseSidebar: PanelLeftClose,
  expandSidebar: PanelLeftOpen,
  knowledge: LibraryBig,
  newTask: SquarePen,
  plugin: Plug,
  scheduledTask: CalendarClock,
  settings: Settings,
  store: Store,
  taskHistory: ListTodo,
  workspace: LayoutDashboard,
} as const satisfies Record<string, Component>;

export type YjIconName = keyof typeof iconRegistry;
