import { describe, expect, it, vi } from "vitest";
import {
  createSkillNativeClient,
  SKILL_DIRECTORY_CHANGED_EVENT_CHANNEL,
  SkillNativeClientError,
} from "./skill-native-client";

function skillWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "yijie.content-marketing.copywriting",
    runtimeName: "copywriting",
    category: "content-marketing",
    order: 0,
    displayName: "跨境营销文案",
    description: "根据已确认的商品事实和受众生成跨境营销文案。",
    version: "0.1.0",
    iconKey: "edit",
    riskLevel: "medium",
    riskReasons: ["营销文案可能包含未经证实的声明。"],
    sourceType: "internal",
    licenseExpression: "LicenseRef-YiJie-Local-Development-Only",
    executionMode: "model-only",
    networkAccess: "none",
    filesystemAccess: "none",
    requiredTools: [],
    catalogStatus: "installable",
    maintenanceStatus: "maintained",
    capabilityReadiness: "ready",
    installationStatus: "not_installed",
    enabled: false,
    runtimeVisible: false,
    failureCode: "",
    ...overrides,
  };
}

function snapshotWire(
  skills: unknown[] = [skillWire()],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    scannedAt: "2026-08-25T08:00:00Z",
    skills,
    ...overrides,
  };
}

describe("Skill native client", () => {
  it("uses only the five bounded commands and never sends native paths or digests", async () => {
    const calls: Array<{ command: string; arguments_?: Record<string, unknown> }> = [];
    const invoke = vi.fn(async (command: string, arguments_?: Record<string, unknown>) => {
      calls.push({ command, arguments_ });
      return snapshotWire();
    });
    const client = createSkillNativeClient(invoke);

    await client.list();
    await client.scan("page_open");
    await client.install("yijie.content-marketing.copywriting");
    await client.setEnabled("yijie.content-marketing.copywriting", false);
    await client.uninstall("yijie.content-marketing.copywriting");

    expect(calls).toEqual([
      { command: "skills_list_v1", arguments_: undefined },
      { command: "skills_scan_v1", arguments_: { reason: "page_open" } },
      {
        command: "skills_install_v1",
        arguments_: { skillId: "yijie.content-marketing.copywriting" },
      },
      {
        command: "skills_set_enabled_v1",
        arguments_: { skillId: "yijie.content-marketing.copywriting", enabled: false },
      },
      {
        command: "skills_uninstall_v1",
        arguments_: { skillId: "yijie.content-marketing.copywriting" },
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/path|root|digest|sha256|bearer|token/i);
  });

  it("rejects a sensitive native projection before it reaches page state", async () => {
    const client = createSkillNativeClient(async () =>
      snapshotWire([skillWire()], { catalogRevision: "a".repeat(64) }),
    );

    await expect(client.list()).rejects.toMatchObject({
      name: "SkillNativeClientError",
      kind: "incompatible",
    });
  });

  it("consumes the 0.5.1 blocked reason without accepting private metadata", async () => {
    const client = createSkillNativeClient(async () => snapshotWire([
      skillWire({
        catalogStatus: "blocked",
        catalogBlockedReason: "security_review_pending",
        capabilityReadiness: "blocked",
      }),
    ]));

    await expect(client.list()).resolves.toMatchObject({
      skills: [{
        catalogStatus: "blocked",
        catalogBlockedReason: "security_review_pending",
      }],
    });
  });

  it("accepts only the content-free directory-change event payload", async () => {
    let receive: (payload: unknown) => void = () => {
      throw new Error("native listener was not registered");
    };
    const unlisten = vi.fn();
    const nativeListen = vi.fn(async (_channel: string, handler: (payload: unknown) => void) => {
      receive = handler;
      return unlisten;
    });
    const client = createSkillNativeClient(async () => snapshotWire(), nativeListen);
    const changed = vi.fn();

    const stop = await client.subscribeDirectoryChanged(changed);
    expect(nativeListen).toHaveBeenCalledWith(
      SKILL_DIRECTORY_CHANGED_EVENT_CHANNEL,
      expect.any(Function),
    );
    for (const payload of [
      null,
      {},
      { schemaVersion: 2 },
      { schemaVersion: 1, path: "/private/skills" },
      { schemaVersion: 1, skillId: "private" },
    ]) {
      receive(payload);
    }
    expect(changed).not.toHaveBeenCalled();

    receive({ schemaVersion: 1 });
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unauthorized", "unauthorized"],
    ["capability_denied", "permission-denied"],
    ["skill_busy", "busy"],
    ["archive_unsafe", "bundle-invalid"],
    ["skill_marketplace_disabled", "bundle-invalid"],
    ["skill_resource_unavailable", "bundle-invalid"],
    ["skill_owner_credential_unavailable", "unauthorized"],
    ["skill_host_configuration_invalid", "unavailable"],
    ["skill_host_unavailable", "unavailable"],
    ["skill_contract_mismatch", "incompatible"],
    ["runtime_unavailable", "unavailable"],
  ] as const)("maps native %s without exposing its message", async (code, kind) => {
    const client = createSkillNativeClient(async () => {
      throw { code, message: "private native detail" };
    });

    const operation = client.list();
    await expect(operation).rejects.toMatchObject({ name: "SkillNativeClientError", kind });
    await operation.catch((error: unknown) => {
      expect((error as Error).message).not.toContain("private native detail");
    });
  });

  it("does not invoke native work for invalid IDs or an already aborted read", async () => {
    const invoke = vi.fn(async () => snapshotWire());
    const client = createSkillNativeClient(invoke);
    const controller = new AbortController();
    controller.abort();

    await expect(client.list(controller.signal)).rejects.toBeInstanceOf(SkillNativeClientError);
    await expect(client.install("../escape")).rejects.toMatchObject({ kind: "incompatible" });
    await expect(client.scan("future_reason" as "page_open")).rejects.toMatchObject({
      kind: "incompatible",
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
