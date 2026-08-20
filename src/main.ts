import { invoke } from "@tauri-apps/api/core";

const root = document.querySelector("#app");
const featureDriverEnabled = import.meta.env.VITE_FEAT126_S10_DRIVER === "true";
const feat128S7bRuntimeEnabled = import.meta.env.VITE_FEAT128_S7B_RUNTIME === "true";

if (featureDriverEnabled && feat128S7bRuntimeEnabled) {
  throw new Error("test_driver_conflict");
} else if (feat128S7bRuntimeEnabled) {
  if (root === null) throw new Error("application_root_missing");
  void import("./feat128/s7b-runtime-harness").then(({ mountFeat128S7bRuntimeHarness }) =>
    mountFeat128S7bRuntimeHarness(root),
  );
} else if (featureDriverEnabled) {
  if (root === null) {
    void invoke("feat126_s10_driver_fail_closed", {
      failureClass: "driver_frontend_startup_invalid",
    }).catch(() => window.close());
  } else {
    void import("./feat126/s10b-driver").then(({ mountFeat126S10Driver }) =>
      mountFeat126S10Driver(root),
    ).catch(async () => {
      try {
        await invoke("feat126_s10_driver_fail_closed", {
          failureClass: "driver_frontend_startup_invalid",
        });
      } catch {
        window.close();
      }
    });
  }
} else {
  if (root === null) throw new Error("application_root_missing");
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
