import { invoke } from "@tauri-apps/api/core";
import {
  demoFastLocalProfileEnabled,
  shouldResetDemoFastStartupPath,
} from "./authorization/local-profile";

const root = document.querySelector("#app");
const featureDriverEnabled = import.meta.env.VITE_FEAT126_S10_DRIVER === "true";
const feat128S7bRuntimeEnabled = import.meta.env.VITE_FEAT128_S7B_RUNTIME === "true";
const feat128S10dRuntimeEnabled = import.meta.env.VITE_FEAT128_S10D_RUNTIME === "true";

if ([featureDriverEnabled, feat128S7bRuntimeEnabled, feat128S10dRuntimeEnabled].filter(Boolean).length > 1) {
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
    if (shouldResetDemoFastStartupPath(demoFastLocalProfileEnabled, window.location.pathname)) {
      window.history.replaceState(window.history.state, "", "/");
    }
    const [{ createApp }, { createPinia }, { default: App }, { router }] = await Promise.all([
      import("vue"),
      import("pinia"),
      import("./App.vue"),
      import("./router"),
      import("./styles/main.css"),
    ]);
    const app = createApp(App).use(createPinia()).use(router);
    await router.isReady();
    if (demoFastLocalProfileEnabled && router.currentRoute.value.path !== "/chat") {
      await router.replace("/chat");
    }
    app.mount(root);
    if (feat128S10dRuntimeEnabled) {
      const { runFeat128S10dRuntimeController } = await import("./feat128/s10d-runtime-controller");
      await runFeat128S10dRuntimeController();
    }
  })();
}
