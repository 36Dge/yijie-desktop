import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import type { ChatClient } from "../api/chat-client";
import { createChatStoreDefinition, useChatStore } from "../stores/chat.store";
import {
  classifyFeat126DriverFailure,
  createFeat126DriverTransport,
  failClosedFeat126DriverOnce,
  runFeat126S10Driver,
  type DriverInvoke,
  type S10BPiniaDriverStore,
} from "./s10b-driver";

const PROJECT_ID = "019fbd88-cbc3-7bf1-934d-7b05cd693f99";

describe("FEAT-126 S10BO2 driver", () => {
  beforeEach(() => vi.stubEnv("VITE_FEAT126_S10_DRIVER", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("executes the closed login, project, bind, recovery and abort flow", async () => {
    const order: string[] = [];
    const driverInvoke: DriverInvoke = async (command) => {
      order.push(command);
      if (command === "feat126_s10_driver_login") {
        return { schemaVersion: 1, status: "signed_in", flow: "authorization_code", pkceMethod: "S256" };
      }
      if (command === "feat126_s10_driver_register_project") {
        return { schemaVersion: 1, projectId: PROJECT_ID, capability: "local_only" };
      }
      if (command === "feat126_s10_driver_wait_abort") return { kind: "abort" };
      return undefined;
    };
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind(selector) {
        order.push(`bind:${selector}`);
      },
      async revalidateProject(projectId) {
        order.push(`revalidate:${projectId}`);
        return { projectId, available: true };
      },
      async requestLocalRecovery() {
        order.push("requestLocalRecovery");
        return { lifecycle: "ready", host: "ready", runtime: "ready", storage: "ready", canSend: true };
      },
      async dispose() {},
    };

    await expect(runFeat126S10Driver(store, driverInvoke)).resolves.toEqual({ projectId: PROJECT_ID });
    expect(order).toEqual([
      "feat126_s10_driver_startup_stage",
      "feat126_s10_driver_login",
      "feat126_s10_driver_register_project",
      "bind:feat126-driver-owned-authority",
      `revalidate:${PROJECT_ID}`,
      "requestLocalRecovery",
      "feat126_s10_driver_component_ready",
      "feat126_s10_driver_wait_abort",
    ]);
  });

  it("never forwards a tenant selector through the trusted bind command", async () => {
    const calls: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    const transport = createFeat126DriverTransport(async (command, arguments_) => {
      calls.push([command, arguments_]);
      return { schemaVersion: 1 };
    });
    await transport.invoke("chat_bind_context_v1", {
      request: {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        payload: { tenantSelector: "feat126-driver-owned-authority" },
      },
    });
    expect(calls).toEqual([["feat126_s10_driver_bind", undefined]]);
    await expect(transport.invoke("chat_bind_context_v1", {
      request: {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        payload: { tenantSelector: "12500000-0000-4000-8000-100000000001" },
      },
    })).rejects.toThrow("driver_bind_request_invalid");
  });

  it("maps only the closed startup projection commands", async () => {
    const calls: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    const transport = createFeat126DriverTransport(async (command, arguments_) => {
      calls.push([command, arguments_]);
      return { schemaVersion: 1 };
    });
    const request = { schemaVersion: 1, requestId: crypto.randomUUID(), contextId: crypto.randomUUID(), payload: {} };
    await transport.invoke("chat_list_projects_v1", { request });
    expect(calls).toEqual([["feat126_s10_driver_list_projects", { request }]]);
    await expect(transport.invoke("chat_create_session_v1", { request }))
      .rejects.toThrow("driver_command_forbidden");
    await expect(transport.invoke("chat_submit_turn_v1", { request }))
      .rejects.toThrow("driver_command_forbidden");
    await expect(transport.invoke("chat_delete_session_v1", { request }))
      .rejects.toThrow("driver_command_forbidden");
  });

  it("does not subscribe the feature WebView to arbitrary application events", async () => {
    const transport = createFeat126DriverTransport();
    await expect(transport.listen("unreviewed.event", () => undefined))
      .rejects.toThrow("driver_event_channel_forbidden");
    await expect(transport.listen("yijie.chat.event.v1", () => undefined)).resolves.toEqual(expect.any(Function));
  });

  it("fails before ready emission when project or readiness evidence is not exact", async () => {
    const calls: string[] = [];
    const driverInvoke: DriverInvoke = async (command) => {
      calls.push(command);
      if (command === "feat126_s10_driver_login") {
        return { schemaVersion: 1, status: "signed_in", flow: "authorization_code", pkceMethod: "S256" };
      }
      if (command === "feat126_s10_driver_register_project") {
        return { schemaVersion: 1, projectId: PROJECT_ID, capability: "local_only" };
      }
      return undefined;
    };
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() {},
      async revalidateProject(projectId) {
        return { projectId, available: true };
      },
      async requestLocalRecovery() {
        return { lifecycle: "blocked", host: "unavailable", runtime: "unavailable", storage: "ready", canSend: false };
      },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, driverInvoke)).rejects.toThrow("driver_readiness_failed");
    expect(calls).not.toContain("feat126_s10_driver_component_ready");
  });

  it("projects only closed startup leaves and never forwards an unknown error", () => {
    expect(classifyFeat126DriverFailure(new Error("driver_readiness_failed")))
      .toBe("driver_readiness_failed");
    expect(classifyFeat126DriverFailure(new Error("token=must-not-cross-the-boundary")))
      .toBe("driver_frontend_startup_invalid");
    expect(classifyFeat126DriverFailure("driver_login_failed"))
      .toBe("driver_frontend_startup_invalid");
  });

  it("attempts fail-closed exactly once and closes locally when IPC is unavailable", async () => {
    const calls: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    let closeCount = 0;
    await failClosedFeat126DriverOnce(
      "driver_frontend_startup_invalid",
      async (command, arguments_) => {
        calls.push([command, arguments_]);
        throw new Error("untrusted IPC detail");
      },
      () => { closeCount += 1; },
    );
    expect(calls).toEqual([[
      "feat126_s10_driver_fail_closed",
      { failureClass: "driver_frontend_startup_invalid" },
    ]]);
    expect(closeCount).toBe(1);
  });

  it("preserves the first failing startup stage and does not continue toward ready", async () => {
    const calls: string[] = [];
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() { calls.push("bind"); },
      async revalidateProject() { calls.push("revalidate"); return null; },
      async requestLocalRecovery() { calls.push("recovery"); return null; },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async (command) => {
      calls.push(command);
      throw new Error("untrusted native detail");
    })).rejects.toThrow("driver_frontend_startup_invalid");
    expect(calls).toEqual(["feat126_s10_driver_startup_stage"]);
  });

  it("binds the first frontend IPC to the exact content-free bootstrap stage", async () => {
    const calls: Array<readonly [string, Record<string, unknown> | undefined]> = [];
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() {},
      async revalidateProject() { return null; },
      async requestLocalRecovery() { return null; },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async (command, arguments_) => {
      calls.push([command, arguments_]);
      throw new Error("closed");
    })).rejects.toThrow("driver_frontend_startup_invalid");
    expect(calls).toEqual([[
      "feat126_s10_driver_startup_stage",
      { stage: "frontend_bootstrap" },
    ]]);
  });

  it("classifies component-ready emission failure before waiting for abort", async () => {
    const calls: string[] = [];
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() {},
      async revalidateProject(projectId) { return { projectId, available: true }; },
      async requestLocalRecovery() {
        return { lifecycle: "ready", host: "ready", runtime: "ready", storage: "ready", canSend: true };
      },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async (command) => {
      calls.push(command);
      if (command === "feat126_s10_driver_login") {
        return { schemaVersion: 1, status: "signed_in", flow: "authorization_code", pkceMethod: "S256" };
      }
      if (command === "feat126_s10_driver_register_project") {
        return { schemaVersion: 1, projectId: PROJECT_ID, capability: "local_only" };
      }
      if (command === "feat126_s10_driver_component_ready") throw new Error("write failed");
      return undefined;
    })).rejects.toThrow("driver_ready_emit_failed");
    expect(calls).not.toContain("feat126_s10_driver_wait_abort");
  });

  it("rejects unknown fields in native driver projections", async () => {
    const store: S10BPiniaDriverStore = {
      phase: "ready",
      context: { allowedActions: ["use_project"] },
      async bind() {},
      async revalidateProject() { return null; },
      async requestLocalRecovery() { return null; },
      async dispose() {},
    };
    await expect(runFeat126S10Driver(store, async () => ({
      schemaVersion: 1,
      status: "signed_in",
      flow: "authorization_code",
      pkceMethod: "S256",
      bearer: "forbidden",
    }))).rejects.toThrow("driver_login_projection_invalid");
  });

  it("pre-installs the trusted client under the production Pinia store id", () => {
    const pinia = createPinia();
    const useDriverStore = createChatStoreDefinition({} as ChatClient);
    const driverStore = useDriverStore(pinia);
    expect(useChatStore(pinia)).toBe(driverStore);
  });
});
