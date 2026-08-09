import { invoke } from "@tauri-apps/api/core";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "../App.vue";
import { router } from "../router";
import { useChatStore } from "../stores/chat.store";

export type S10BDriverProjection = Readonly<{
  schema_version: 1;
  message_kind: "component_ready";
  run_id: string;
  nonce: string;
  sequence: 1;
  profile: "feat-126-s10-local-lab";
  project: Readonly<{ id: string; capability: "local_only" }>;
  authorization: Readonly<{
    flow: "authorization_code";
    method: "S256";
    code_challenge: string;
  }>;
}>;

export type S10BPiniaDriverStore = Readonly<{
  bind(tenantSelector: string): Promise<void>;
  refreshLocalReadiness(): Promise<unknown>;
  revalidateProject(projectId: string): Promise<unknown>;
}>;

// This module is intentionally not imported by App.vue or any production
// route. Vite can therefore tree-shake the test driver from normal bundles.
export const feat126S10DriverBuild =
  import.meta.env.VITE_FEAT126_S10_DRIVER === "true";

export async function runFeat126S10Driver(store: S10BPiniaDriverStore): Promise<S10BDriverProjection> {
  if (!feat126S10DriverBuild) throw new Error("driver_not_enabled");
  const projection = await invoke<S10BDriverProjection>("feat126_s10_driver_probe");
  await store.bind("synthetic");
  await store.refreshLocalReadiness();
  await store.revalidateProject(projection.project.id);
  return projection;
}

export async function mountFeat126S10Driver(root: Element): Promise<Readonly<{
  projection: S10BDriverProjection;
  unmount(): void;
}>> {
  if (!feat126S10DriverBuild) throw new Error("driver_not_enabled");
  const pinia = createPinia();
  const application = createApp(App).use(pinia).use(router);
  application.mount(root);
  const projection = await runFeat126S10Driver(useChatStore(pinia));
  return Object.freeze({ projection, unmount: () => application.unmount() });
}
