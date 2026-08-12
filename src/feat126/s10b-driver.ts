import { invoke } from "@tauri-apps/api/core";
import { createPinia } from "pinia";
import { createApp, defineComponent, h } from "vue";
import { createChatClient, type ChatClientTransport } from "../api/chat-client";
import { CHAT_CONTROL_PLANE_EVENT_CHANNEL, CHAT_EVENT_CHANNEL } from "../domain/chat-ipc";
import { createChatStoreDefinition } from "../stores/chat.store";

const TRUSTED_BIND_MARKER = "feat126-driver-owned-authority";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DRIVER_LOGIN_FAILURE_CLASSES = Object.freeze([
  "driver_login_authorization_page_failed",
  "driver_login_authorization_request_invalid",
  "driver_login_authorization_start_failed",
  "driver_login_callback_rejected",
  "driver_login_concurrent",
  "driver_login_credential_submit_failed",
  "driver_login_credentials_rejected",
  "driver_login_failed",
  "driver_login_form_invalid",
  "driver_login_runtime_invalid",
  "driver_login_secret_invalid",
  "driver_login_session_failed",
  "driver_login_storage_failed",
  "driver_login_token_exchange_failed",
] as const);
const DRIVER_FAILURE_CLASSES = Object.freeze([
  "driver_bind_failed",
  "driver_control_projection_invalid",
  "driver_frontend_startup_invalid",
  ...DRIVER_LOGIN_FAILURE_CLASSES,
  "driver_login_projection_invalid",
  "driver_project_invalid",
  "driver_project_projection_invalid",
  "driver_project_revalidation_failed",
  "driver_readiness_failed",
  "driver_ready_emit_failed",
] as const);

export type DriverFailureClass = (typeof DRIVER_FAILURE_CLASSES)[number];

type DriverLoginProjection = Readonly<{
  schemaVersion: 1;
  status: "signed_in";
  flow: "authorization_code";
  pkceMethod: "S256";
}>;

type DriverProjectProjection = Readonly<{
  schemaVersion: 1;
  projectId: string;
  capability: "local_only";
}>;

type DriverControlProjection = Readonly<{ kind: "abort" }>;

export type S10BPiniaDriverStore = Readonly<{
  readonly phase: string;
  readonly context: Readonly<{ allowedActions: readonly string[] }> | null;
  bind(tenantSelector: string): Promise<void>;
  revalidateProject(projectId: string): Promise<Readonly<{ projectId: string; available: boolean }> | null>;
  requestLocalRecovery(): Promise<Readonly<{
    lifecycle: string;
    host: string;
    runtime: string;
    storage: string;
    canSend: boolean;
  }> | null>;
  dispose(): Promise<void>;
}>;

export type DriverInvoke = (command: string, arguments_?: Record<string, unknown>) => Promise<unknown>;

const DRIVER_COMMANDS = Object.freeze({
  chat_list_projects_v1: "feat126_s10_driver_list_projects",
  chat_list_sessions_v1: "feat126_s10_driver_list_sessions",
  chat_get_local_readiness_v1: "feat126_s10_driver_get_local_readiness",
  chat_revalidate_project_v1: "feat126_s10_driver_revalidate_project",
  chat_request_local_recovery_v1: "feat126_s10_driver_request_local_recovery",
} as const);

const DriverRoot = defineComponent({
  name: "Feat126S10DriverRoot",
  render: () => h("div", { hidden: true, "data-feat126-s10-driver": "" }),
});

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object" &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function classifyFeat126DriverFailure(error: unknown): DriverFailureClass {
  const message = error instanceof Error ? error.message : "";
  return DRIVER_FAILURE_CLASSES.find((failureClass) => failureClass === message) ??
    "driver_frontend_startup_invalid";
}

export async function failClosedFeat126DriverOnce(
  failureClass: DriverFailureClass,
  driverInvoke: DriverInvoke = invoke,
  closeWindow: () => void = () => window.close(),
): Promise<void> {
  try {
    await driverInvoke("feat126_s10_driver_fail_closed", { failureClass });
  } catch {
    closeWindow();
  }
}

async function driverStage<T>(
  failureClass: DriverFailureClass,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw Object.assign(new Error(failureClass), { cause: error });
  }
}

async function driverLoginStage(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    return await operation();
  } catch (error) {
    const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "";
    const failureClass = DRIVER_LOGIN_FAILURE_CLASSES.find((candidate) => candidate === detail) ??
      "driver_login_failed";
    throw Object.assign(new Error(failureClass), { cause: error });
  }
}

function parseLogin(value: unknown): DriverLoginProjection {
  if (!exactObject(value, ["schemaVersion", "status", "flow", "pkceMethod"]) ||
    value.schemaVersion !== 1 || value.status !== "signed_in" ||
    value.flow !== "authorization_code" || value.pkceMethod !== "S256") {
    throw new Error("driver_login_projection_invalid");
  }
  return value as DriverLoginProjection;
}

function parseProject(value: unknown): DriverProjectProjection {
  if (!exactObject(value, ["schemaVersion", "projectId", "capability"]) ||
    value.schemaVersion !== 1 || value.capability !== "local_only" ||
    typeof value.projectId !== "string" || !UUID_PATTERN.test(value.projectId)) {
    throw new Error("driver_project_projection_invalid");
  }
  return value as DriverProjectProjection;
}

function parseControl(value: unknown): DriverControlProjection {
  if (!exactObject(value, ["kind"]) || value.kind !== "abort") {
    throw new Error("driver_control_projection_invalid");
  }
  return value as DriverControlProjection;
}

function trustedBindRequest(arguments_: Record<string, unknown> | undefined): boolean {
  if (!exactObject(arguments_, ["request"])) return false;
  const request = arguments_.request;
  if (!exactObject(request, ["schemaVersion", "requestId", "payload"])) return false;
  const payload = request.payload;
  return request.schemaVersion === 1 && typeof request.requestId === "string" &&
    exactObject(payload, ["tenantSelector"]) && payload.tenantSelector === TRUSTED_BIND_MARKER;
}

export function createFeat126DriverTransport(driverInvoke: DriverInvoke = invoke): ChatClientTransport {
  const transport: ChatClientTransport = {
    invoke(command: string, arguments_?: Record<string, unknown>) {
      if (command === "chat_bind_context_v1") {
        if (!trustedBindRequest(arguments_)) return Promise.reject(new Error("driver_bind_request_invalid"));
        return driverInvoke("feat126_s10_driver_bind");
      }
      const driverCommand = DRIVER_COMMANDS[command as keyof typeof DRIVER_COMMANDS];
      if (driverCommand === undefined || !exactObject(arguments_, ["request"])) {
        return Promise.reject(new Error("driver_command_forbidden"));
      }
      return driverInvoke(driverCommand, arguments_);
    },
    async listen(channel: string) {
      if (channel !== CHAT_EVENT_CHANNEL && channel !== CHAT_CONTROL_PLANE_EVENT_CHANNEL) {
        throw new Error("driver_event_channel_forbidden");
      }
      return () => undefined;
    },
  };
  return Object.freeze(transport);
}

export async function runFeat126S10Driver(
  store: S10BPiniaDriverStore,
  driverInvoke: DriverInvoke = invoke,
): Promise<Readonly<{ projectId: string }>> {
  if (import.meta.env.VITE_FEAT126_S10_DRIVER !== "true") throw new Error("driver_not_enabled");
  await driverStage("driver_frontend_startup_invalid", async () =>
    await driverInvoke("feat126_s10_driver_startup_stage", { stage: "frontend_bootstrap" }),
  );
  parseLogin(await driverLoginStage(async () => await driverInvoke("feat126_s10_driver_login")));
  const project = parseProject(await driverStage("driver_project_invalid", async () =>
    await driverInvoke("feat126_s10_driver_register_project"),
  ));
  await driverStage("driver_bind_failed", async () => await store.bind(TRUSTED_BIND_MARKER));
  if (store.context === null || store.phase !== "ready" ||
    !store.context.allowedActions.includes("use_project")) {
    throw new Error("driver_bind_failed");
  }
  const revalidated = await driverStage("driver_project_revalidation_failed", async () =>
    await store.revalidateProject(project.projectId),
  );
  if (revalidated?.projectId !== project.projectId || revalidated.available !== true) {
    throw new Error("driver_project_revalidation_failed");
  }
  const readiness = await driverStage("driver_readiness_failed", async () =>
    await store.requestLocalRecovery(),
  );
  if (readiness?.lifecycle !== "ready" || readiness.host !== "ready" ||
    readiness.runtime !== "ready" || readiness.storage !== "ready" || readiness.canSend !== true) {
    throw new Error("driver_readiness_failed");
  }
  await driverStage("driver_ready_emit_failed", async () => {
    await driverInvoke("feat126_s10_driver_component_ready");
  });
  parseControl(await driverStage("driver_control_projection_invalid", async () =>
    await driverInvoke("feat126_s10_driver_wait_abort"),
  ));
  return Object.freeze({ projectId: project.projectId });
}

export async function mountFeat126S10Driver(root: Element): Promise<void> {
  if (import.meta.env.VITE_FEAT126_S10_DRIVER !== "true") throw new Error("driver_not_enabled");
  const pinia = createPinia();
  const useDriverChatStore = createChatStoreDefinition(
    createChatClient(createFeat126DriverTransport()),
  );
  const store = useDriverChatStore(pinia);
  const application = createApp(DriverRoot).use(pinia);
  let mounted = false;
  try {
    application.mount(root);
    mounted = true;
    await Promise.resolve();
    await runFeat126S10Driver(store);
    await store.dispose();
    application.unmount();
    await invoke("feat126_s10_driver_abort_complete");
  } catch (error) {
    await store.dispose().catch(() => undefined);
    if (mounted) application.unmount();
    await failClosedFeat126DriverOnce(classifyFeat126DriverFailure(error));
  }
}
