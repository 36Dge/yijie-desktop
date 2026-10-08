import { describe, expect, it } from "vitest";
import { connectorViews } from "./market-connectors-ui";
import { connectorPrimaryAction, connectorSwitchDisabled } from "./connector-ui";
import type { CatalogEntry, Installation, Operation, Snapshot } from "./market-connectors.generated";

export const catalogEntry: CatalogEntry = { serviceId: "synthetic-service", serverName: "synthetic-service", displayName: "合成连接器", categoryId: "productivity", categoryLabel: "效率工具", description: "仅用于普通组件验证。", iconAssetId: "cue", transport: "http", authMode: "oauth", availability: "available", blockerCodes: [] };
export const installation: Installation = { installationId: "019c1a00-0000-7000-8000-000000000002", serviceId: catalogEntry.serviceId, revision: 1, generation: 1, status: "installed", desiredEnabled: false, effectiveEnabled: false, configurationStatus: "configured", authorizationStatus: "authorized", connectionStatus: "disconnected" };
export function connectorSnapshot(items: Installation[] = []): Snapshot { return { catalogRevision: 1, catalog: [catalogEntry], installations: items, capabilities: ["connector.read", "connector.manage", "connector.credentials.manage", "connector.use"], executionAvailable: false }; }

describe("connector presentation projection", () => {
  it("never turns desired state or a cached ready connection into selectable execution", () => {
    const [desired] = connectorViews(connectorSnapshot([{ ...installation, desiredEnabled: true }]));
    expect(desired?.enabled).toBe(false); expect(desired?.selectable).toBe(false);
    const ready = connectorSnapshot([{ ...installation, desiredEnabled: true, effectiveEnabled: true, connectionStatus: "ready" }]);
    expect(connectorViews(ready)[0]?.selectable).toBe(false);
    ready.executionAvailable = true;
    expect(connectorViews(ready)[0]?.selectable).toBe(true);
  });
  it("offers explicit enable after a saved connection loses current readiness", () => {
    const data = connectorSnapshot([{ ...installation, desiredEnabled: true, effectiveEnabled: false }]);
    const view = connectorViews(data)[0]!;
    expect(view).toMatchObject({ enabled: false, selectable: false, status: { label: "连接待恢复" }, actions: ["uninstall", "disable", "enable"] });
    expect(connectorPrimaryAction(view)?.action).toBe("enable");
    expect(view.actions).not.toContain("authorize");
    data.capabilities = ["connector.read", "connector.use"];
    expect(connectorViews(data)[0]?.actions).not.toContain("enable");
  });
  it("describes pending enable without requesting OAuth while its fresh observation is unavailable", () => {
    const receipt: Operation = { operationId: "019c1a00-0000-7000-8000-000000000004", installationId: installation.installationId, serviceId: installation.serviceId, action: "enable", status: "pending", revision: 2, cancellable: true };
    const data = connectorSnapshot([{ ...installation, configurationStatus: "unknown", authorizationStatus: "required", activeOperation: receipt }]);
    data.catalog = [{ ...catalogEntry, authorizationAvailable: true }];
    expect(connectorViews(data)[0]).toMatchObject({
      configurationLabel: "正在检查连接与支持工具，请等待本次启用结果。",
      status: { label: "正在启用", tone: "neutral" },
      busy: true, enabled: false, selectable: false, actions: ["retry", "cancel"],
    });
  });
  it("does not offer activation for unverified provider onboarding", () => {
    const data = connectorSnapshot([installation]);
    data.catalog = [{ ...catalogEntry, availability: "blocked", blockerCodes: ["provider_onboarding_required"] }];
    expect(connectorViews(data)[0]).toMatchObject({ actions: ["uninstall"], selectable: false, explanation: "此服务的接入条件尚未完成，暂时不能连接。" });
  });
  it("keeps deferred services visible without installation or stale selection", () => {
    const data = connectorSnapshot();
    data.catalog = [{ ...catalogEntry, availability: "blocked", authorizationAvailable: false, blockerCodes: ["provider_onboarding_required"] }];
    expect(connectorViews(data)[0]).toMatchObject({ actions: [], status: { label: "接入待完成" }, enabled: false, selectable: false });
    data.installations = [{ ...installation, effectiveEnabled: true, desiredEnabled: true, connectionStatus: "ready" }];
    data.executionAvailable = true;
    expect(connectorViews(data)[0]).toMatchObject({ actions: ["uninstall", "disable"], status: { label: "接入待完成" }, enabled: false, selectable: false });
  });
  it("offers Native-supported OAuth independently of tool qualification", () => {
    const data = connectorSnapshot([{ ...installation, configurationStatus: "unconfigured", authorizationStatus: "required" }]);
    data.catalog = [{ ...catalogEntry, authorizationAvailable: true, availability: "unverified", blockerCodes: ["provider_onboarding_required"] }];
    const item = connectorViews(data)[0]!;
    expect(item.actions).toEqual(["uninstall", "authorize"]);
    expect(connectorPrimaryAction(item)).toEqual({ action: "authorize", label: "授权连接" });
    expect(connectorSwitchDisabled(item, true)).toBe(true);
    expect(item.selectable).toBe(false); expect(item.enabled).toBe(false);
    expect(item.explanation).toContain("可先完成账户授权");
  });
  it("does not infer an OAuth adapter from catalog authMode or a missing capability", () => {
    const data = connectorSnapshot([{ ...installation, configurationStatus: "configured", authorizationStatus: "required" }]);
    expect(connectorViews(data)[0]?.actions).toEqual(["uninstall"]);
    data.catalog = [{ ...catalogEntry, authorizationAvailable: true, availability: "unverified" }];
    data.capabilities = ["connector.read", "connector.manage"];
    expect(connectorViews(data)[0]?.actions).toEqual(["uninstall"]);
  });
  it("keeps authorized but unqualified tools disabled", () => {
    const data = connectorSnapshot([{ ...installation, errorCode: "provider_onboarding_required" }]);
    data.catalog = [{ ...catalogEntry, authorizationAvailable: true, availability: "unverified", blockerCodes: ["provider_onboarding_required"] }];
    expect(connectorViews(data)[0]).toMatchObject({ actions: ["uninstall"], selectable: false, enabled: false, status: { label: "已授权，工具待验证" } });
  });
  it.each([
    ["authorize", "正在授权，请在浏览器中完成"],
    ["configure", "正在连接"],
  ] as const)("presents a pending %s as progress while keeping query and cancellation", (action, label) => {
    const receipt: Operation = { operationId: "019c1a00-0000-7000-8000-000000000004", installationId: installation.installationId, serviceId: installation.serviceId, action, status: "pending", revision: 2, cancellable: true };
    const data = connectorSnapshot([{ ...installation, activeOperation: receipt }]);
    expect(connectorViews(data)[0]).toMatchObject({ busy: true, status: { label, tone: "neutral" }, actions: ["retry", "cancel", "reopen"], selectable: false });
    data.installations = [{ ...installation, activeOperation: { ...receipt, status: "unknown" } }];
    expect(connectorViews(data)[0]?.status).toEqual({ label: "操作结果待确认", tone: "warning" });
  });
  it("keeps credential and installation permissions separate", () => {
    const data = connectorSnapshot([{ ...installation, configurationStatus: "unconfigured" }]);
    data.capabilities = ["connector.read", "connector.credentials.manage"];
    expect(connectorViews(data)[0]?.actions).toEqual(["configure"]);
  });
});
