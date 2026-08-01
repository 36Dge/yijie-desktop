import { describe, expect, it, vi } from "vitest";
import { createNativeAuthClient, NativeAuthClientError } from "./native-auth-client";

describe("native auth client", () => {
  it("AUTH-UI-001 exposes only fixed native auth operations", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "native_auth_logout" ? "signed_out" : "signed_in",
    );
    const client = createNativeAuthClient(invoke);

    await expect(client.login()).resolves.toBe("signed_in");
    await expect(client.logout()).resolves.toBe("signed_out");
    await expect(client.status()).resolves.toBe("signed_in");
    expect(invoke.mock.calls).toEqual([
      ["native_auth_login"],
      ["native_auth_logout"],
      ["native_auth_status"],
    ]);
  });

  it.each([
    ["login", "signed_out"],
    ["logout", "signed_in"],
    ["status", { accessToken: "must-not-cross-ipc" }],
  ] as const)("AUTH-UI-002 rejects invalid %s responses", async (operation, response) => {
    const client = createNativeAuthClient(async () => response);

    await expect(client[operation]()).rejects.toBeInstanceOf(NativeAuthClientError);
  });

  it("AUTH-UI-003 normalizes native failures without reflecting their contents", async () => {
    const client = createNativeAuthClient(async () => {
      throw { accessToken: "secret", detail: "provider detail" };
    });

    await expect(client.login()).rejects.toMatchObject({
      message: "native-auth-login-failed",
    });
  });
});
