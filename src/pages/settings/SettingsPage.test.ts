// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "019c0123-4567-7abc-8123-456789abcdef";
const TENANT_B = "019c0123-4567-7abc-8123-456789abcdee";
const localWhitelistLoginMock = vi.hoisted(() => vi.fn(async () => "signed_in"));

vi.mock("../../api/native-auth-client", () => ({
  nativeAuthClient: {
    login: vi.fn(async () => "signed_in"),
    localWhitelistLogin: localWhitelistLoginMock,
    logout: vi.fn(async () => "signed_out"),
    status: vi.fn(async () => "signed_out"),
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
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

async function mountLocalWhitelistSettings() {
  vi.stubEnv("VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED", "false");
  vi.stubEnv("VITE_YIJIE_ENV", "local");
  vi.stubEnv("VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED", "true");
  const pinia = createPinia();
  setActivePinia(pinia);
  const { default: SettingsPage } = await import("./SettingsPage.vue");
  return mount(SettingsPage, { global: { plugins: [pinia] } });
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

describe("Settings local whitelist login", () => {
  it("SETTINGS-004 renders blank account and masked password fields", async () => {
    const wrapper = await mountLocalWhitelistSettings();

    expect(wrapper.get("#local-login-username").attributes("value")).toBeUndefined();
    expect(wrapper.get("#local-login-password").attributes("type")).toBe("password");
    expect((wrapper.get("#local-login-password").element as HTMLInputElement).value).toBe("");
    expect(wrapper.text()).toContain("登录或更换账户");
  });

  it("SETTINGS-005 keeps validation next to empty fields", async () => {
    const wrapper = await mountLocalWhitelistSettings();

    await wrapper.get(".local-login-form").trigger("submit");

    expect(wrapper.get("#local-login-username-error").text()).toContain("请输入");
    expect(wrapper.get("#local-login-password-error").text()).toContain("请输入");
    expect(localWhitelistLoginMock).not.toHaveBeenCalled();
  });

  it("SETTINGS-006 submits through the dedicated client and clears both fields", async () => {
    const wrapper = await mountLocalWhitelistSettings();
    await wrapper.get("#local-login-username").setValue("local-test-user");
    await wrapper.get("#local-login-password").setValue("local-test-password");

    await wrapper.get(".local-login-form").trigger("submit");
    await flushPromises();

    expect(localWhitelistLoginMock).toHaveBeenCalledWith({
      username: "local-test-user",
      password: "local-test-password",
    });
    expect((wrapper.get("#local-login-username").element as HTMLInputElement).value).toBe("");
    expect((wrapper.get("#local-login-password").element as HTMLInputElement).value).toBe("");
  });

  it("SETTINGS-007 clears fields before the native request settles", async () => {
    let resolveLogin: ((value: "signed_in") => void) | undefined;
    localWhitelistLoginMock.mockImplementationOnce(
      () => new Promise<"signed_in">((resolve) => { resolveLogin = resolve; }),
    );
    const wrapper = await mountLocalWhitelistSettings();
    await wrapper.get("#local-login-username").setValue("local-test-user");
    await wrapper.get("#local-login-password").setValue("local-test-password");

    const submitted = wrapper.get(".local-login-form").trigger("submit");
    await Promise.resolve();
    expect((wrapper.get("#local-login-username").element as HTMLInputElement).value).toBe("");
    expect((wrapper.get("#local-login-password").element as HTMLInputElement).value).toBe("");

    resolveLogin?.("signed_in");
    await submitted;
    await flushPromises();
  });
});
