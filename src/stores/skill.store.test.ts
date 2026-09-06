import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SkillNativeClientError,
  type SkillNativeClient,
} from "../api/skill-native-client";
import {
  parseSkillCatalogSnapshot,
  type SkillCatalogSnapshot,
} from "../domain/skill-marketplace";
import { createSkillStoreDefinition } from "./skill.store";

const SKILL_ID = "yijie.content-marketing.copywriting";
let storeSequence = 0;

function snapshot(
  overrides: Record<string, unknown> = {},
): SkillCatalogSnapshot {
  return parseSkillCatalogSnapshot({
    schemaVersion: 1,
    scannedAt: "2026-08-25T08:00:00Z",
    skills: [{
      id: SKILL_ID,
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
    }],
  });
}

function client(overrides: Partial<SkillNativeClient> = {}): SkillNativeClient {
  const initial = snapshot();
  return {
    list: vi.fn(async () => initial),
    scan: vi.fn(async () => initial),
    install: vi.fn(async () => snapshot({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    })),
    setEnabled: vi.fn(async (_skillId, enabled) => snapshot({
      installationStatus: "installed",
      enabled,
      runtimeVisible: enabled,
    })),
    uninstall: vi.fn(async () => initial),
    subscribeDirectoryChanged: vi.fn(async () => () => undefined),
    ...overrides,
  };
}

function createStore(nativeClient: SkillNativeClient) {
  const useStore = createSkillStoreDefinition(
    nativeClient,
    `skills-test-${storeSequence++}`,
  );
  return useStore();
}

describe("Skill store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("scans on a manageable page open and only lists for read-only access", async () => {
    const manageableClient = client();
    const manageableStore = createStore(manageableClient);
    await manageableStore.open(true);

    expect(manageableClient.scan).toHaveBeenCalledWith("page_open", expect.any(AbortSignal));
    expect(manageableClient.list).not.toHaveBeenCalled();
    expect(manageableStore.phase).toBe("ready");
    expect(manageableStore.categories.map((category) => category.skills.length)).toEqual([
      0, 0, 1, 0, 0,
    ]);

    const readOnlyClient = client();
    const readOnlyStore = createStore(readOnlyClient);
    await readOnlyStore.open(false);

    expect(readOnlyClient.list).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(readOnlyClient.scan).not.toHaveBeenCalled();
  });

  it("converges every mutation from the native snapshot and blocks duplicate work", async () => {
    let resolveInstall: ((value: SkillCatalogSnapshot) => void) | undefined;
    const install = vi.fn(
      () => new Promise<SkillCatalogSnapshot>((resolve) => { resolveInstall = resolve; }),
    );
    const nativeClient = client({ install });
    const store = createStore(nativeClient);
    await store.open(true);

    const first = store.install(SKILL_ID);
    const duplicate = store.install(SKILL_ID);
    expect(store.operations[SKILL_ID]).toBe("install");
    expect(await duplicate).toBe(false);
    expect(install).toHaveBeenCalledTimes(1);

    resolveInstall?.(snapshot({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    }));
    expect(await first).toBe(true);
    expect(store.operations[SKILL_ID]).toBeUndefined();
    expect(store.skills[0]).toMatchObject({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    });

    expect(await store.setEnabled(SKILL_ID, false)).toBe(true);
    expect(store.skills[0]).toMatchObject({ enabled: false, runtimeVisible: false });
    expect(await store.uninstall(SKILL_ID)).toBe(true);
    expect(store.skills[0]?.installationStatus).toBe("not_installed");
  });

  it("opens the live catalog when a scan is busy instead of declaring the service unavailable", async () => {
    const nativeClient = client({
      scan: vi.fn(async () => { throw new SkillNativeClientError("busy"); }),
    });
    const store = createStore(nativeClient);
    await store.open(true);
    expect(nativeClient.list).toHaveBeenCalledOnce();
    expect(store.phase).toBe("ready");
    expect(store.skills).toHaveLength(1);
    expect(store.lastFailure).toBeNull();
    await store.refresh(true, "window_resume");
    expect(nativeClient.list).toHaveBeenCalledTimes(2);
    expect(store.phase).toBe("ready");
  });

  it("preserves a real read failure after a busy scan and never bypasses permissions", async () => {
    const nativeClient = client({
      scan: vi.fn(async () => { throw new SkillNativeClientError("busy"); }),
      list: vi.fn(async () => { throw new SkillNativeClientError("permission-denied"); }),
    });
    const store = createStore(nativeClient);
    await store.open(true);
    expect(store.phase).toBe("permission-denied");
    expect(store.skills).toEqual([]);
    expect(store.lastFailure).toBe("permission-denied");
  });

  it("keeps the last valid catalog while a refresh is unavailable", async () => {
    const scan = vi.fn()
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(new SkillNativeClientError("unavailable"));
    const store = createStore(client({ scan }));
    await store.open(true);
    await store.refresh(true, "window_resume");

    expect(store.phase).toBe("ready");
    expect(store.skills).toHaveLength(1);
    expect(store.lastFailure).toBe("unavailable");
  });

  it("clears an interrupted refresh when a native mutation takes ownership", async () => {
    const scan = vi.fn()
      .mockResolvedValueOnce(snapshot())
      .mockImplementationOnce((_reason: string, signal?: AbortSignal) =>
        new Promise<SkillCatalogSnapshot>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new SkillNativeClientError("aborted"));
          }, { once: true });
        })
      );
    const store = createStore(client({ scan }));
    await store.open(true);

    const refresh = store.refresh(true, "window_resume");
    await Promise.resolve();
    expect(store.refreshing).toBe(true);

    await store.install(SKILL_ID);
    await refresh;

    expect(store.refreshing).toBe(false);
    expect(store.skills[0]).toMatchObject({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
    });
  });

  it.each([
    ["permission-denied", "permission-denied"],
    ["incompatible", "incompatible"],
    ["unavailable", "unavailable"],
  ] as const)("fails closed into %s before a first valid projection", async (kind, phase) => {
    const store = createStore(client({
      scan: vi.fn(async () => { throw new SkillNativeClientError(kind); }),
    }));

    await store.open(true);

    expect(store.phase).toBe(phase);
    expect(store.skills).toEqual([]);
  });

  it("surfaces a safe per-card error without losing the installed projection", async () => {
    const store = createStore(client({
      setEnabled: vi.fn(async () => {
        throw { message: "private host response" };
      }),
    }));
    await store.open(true);
    store.$patch({
      skills: snapshot({
        installationStatus: "installed",
        enabled: true,
        runtimeVisible: true,
      }).skills,
    });

    expect(await store.setEnabled(SKILL_ID, false)).toBe(false);
    expect(store.skills[0]).toMatchObject({ enabled: true, runtimeVisible: true });
    expect(store.operationErrors[SKILL_ID]).toContain("本地 Skill 服务暂不可用");
    expect(store.operationErrors[SKILL_ID]).not.toContain("private host response");
  });

  it("keeps an install retry through window reconciliation and clears it after success", async () => {
    const initial = snapshot();
    const scan = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial);
    const install = vi.fn()
      .mockRejectedValueOnce(new SkillNativeClientError("bundle-invalid"))
      .mockResolvedValueOnce(snapshot({
        installationStatus: "installed",
        enabled: true,
        runtimeVisible: true,
      }));
    const store = createStore(client({ scan, install }));
    await store.open(true);

    expect(await store.install(SKILL_ID)).toBe(false);
    expect(store.operationErrors[SKILL_ID]).toContain("完整性或路径安全校验");

    await store.refresh(true, "window_resume");
    expect(scan).toHaveBeenLastCalledWith("window_resume", expect.any(AbortSignal));
    expect(store.skills[0]?.installationStatus).toBe("not_installed");
    expect(store.operationErrors[SKILL_ID]).toContain("完整性或路径安全校验");

    expect(await store.install(SKILL_ID)).toBe(true);
    expect(store.skills[0]?.installationStatus).toBe("installed");
    expect(store.operationErrors[SKILL_ID]).toBeUndefined();
  });

  it("drops stale operation errors when a read no longer exposes an install retry", async () => {
    const scan = vi.fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({
        installationStatus: "installed",
        enabled: true,
        runtimeVisible: true,
      }));
    const store = createStore(client({
      scan,
      install: vi.fn(async () => { throw new SkillNativeClientError("bundle-invalid"); }),
    }));
    await store.open(true);
    expect(await store.install(SKILL_ID)).toBe(false);
    expect(store.operationErrors[SKILL_ID]).toBeDefined();

    await store.refresh(true, "directory_changed");
    expect(store.skills[0]?.installationStatus).toBe("installed");
    expect(store.operationErrors[SKILL_ID]).toBeUndefined();
  });
});
