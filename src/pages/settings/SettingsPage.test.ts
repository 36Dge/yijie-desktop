// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "019c0123-4567-7abc-8123-456789abcdef";
const TENANT_B = "019c0123-4567-7abc-8123-456789abcdee";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function mountEnabledSettings() {
  vi.stubEnv("VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED", "true");
  const pinia = createPinia();
  setActivePinia(pinia);
  const [{ default: SettingsPage }, { usePermissionStore }] = await Promise.all([
    import("./SettingsPage.vue"),
    import("../../stores/permission.store"),
  ]);
  const store = usePermissionStore(pinia);
  return {
    store,
    mountPage: () => mount(SettingsPage, { global: { plugins: [pinia] } }),
  };
}

describe("Settings permission recovery", () => {
  it("SETTINGS-001 renders zero-tenant recovery without a protected module", async () => {
    const { store, mountPage } = await mountEnabledSettings();
    store.phase = "recovery";
    store.tenants = [];
    const wrapper = mountPage();

    expect(wrapper.get('[role="status"]').text()).toContain("暂无可用租户");
    expect(wrapper.text()).toContain("登录或更换账户");
    expect(wrapper.text()).not.toContain("新建任务");
  });

  it("SETTINGS-002 exposes every discovered tenant as an explicit accessible choice", async () => {
    const { store, mountPage } = await mountEnabledSettings();
    store.phase = "tenant-selection-required";
    store.tenants = [
      { tenantId: TENANT_A, displayName: "Synthetic US Tenant" },
      { tenantId: TENANT_B, displayName: "Synthetic EU Tenant" },
    ];
    const wrapper = mountPage();

    expect(wrapper.get("fieldset").attributes("aria-disabled")).toBeUndefined();
    expect(wrapper.findAll(".tenant-selector__option").map((item) => item.text())).toEqual([
      "Synthetic US Tenant",
      "Synthetic EU Tenant",
    ]);
    expect(wrapper.findAll('.tenant-selector__option[aria-pressed="false"]')).toHaveLength(2);
  });

  it("SETTINGS-003 reports the current tenant and authorization revision", async () => {
    const { store, mountPage } = await mountEnabledSettings();
    store.phase = "ready";
    store.tenants = [{ tenantId: TENANT_A, displayName: "Synthetic US Tenant" }];
    store.selectedTenantId = TENANT_A;
    store.authorizationRevision = 42;
    store.expiresAt = "2026-08-01T12:05:00.000Z";
    const wrapper = mountPage();

    expect(wrapper.text()).toContain("权限已就绪");
    expect(wrapper.text()).toContain("Synthetic US Tenant");
    expect(wrapper.text()).toContain("42");
    expect(wrapper.text()).toContain("2026-08-01T12:05:00.000Z");
  });
});
