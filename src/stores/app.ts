import { defineStore } from "pinia";

export const useAppStore = defineStore("app", {
  state: () => ({
    productName: "易界 AI",
    runtimeMode: "desktop-sidecar",
    currentTaskId: "",
  }),
  actions: {
    selectTask(taskId: string) {
      this.currentTaskId = taskId;
    },
  },
});
