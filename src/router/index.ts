import { createRouter, createWebHistory } from "vue-router";
import ChatPage from "../pages/chat/ChatPage.vue";
import SettingsPage from "../pages/settings/SettingsPage.vue";
import TasksPage from "../pages/tasks/TasksPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/chat" },
    { path: "/chat", component: ChatPage },
    { path: "/tasks", component: TasksPage },
    { path: "/settings", component: SettingsPage },
  ],
});
