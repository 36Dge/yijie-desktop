import { invoke } from "@tauri-apps/api/core";

const root = document.querySelector("#app");
if (root === null) throw new Error("application_root_missing");

if (import.meta.env.VITE_FEAT126_S10_DRIVER === "true") {
  void import("./feat126/s10b-driver").then(({ mountFeat126S10Driver }) =>
    mountFeat126S10Driver(root),
  ).catch(async () => {
    try {
      await invoke("feat126_s10_driver_fail_closed");
    } catch {
      window.close();
    }
  });
} else {
  void (async () => {
    const [{ createApp }, { createPinia }, { default: App }, { router }] = await Promise.all([
      import("vue"),
      import("pinia"),
      import("./App.vue"),
      import("./router"),
      import("./styles/main.css"),
    ]);
    createApp(App).use(createPinia()).use(router).mount(root);
  })();
}
