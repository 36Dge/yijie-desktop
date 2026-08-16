import { invoke } from "@tauri-apps/api/core";

export type NativeAuthStatus = "disabled" | "signed_out" | "signed_in";

type NativeAuthOperation = "login" | "local-whitelist-login" | "logout" | "status";
type NativeAuthInvoker = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface LocalWhitelistCredentials {
  username: string;
  password: string;
}

export interface NativeAuthClient {
  login(): Promise<"signed_in">;
  localWhitelistLogin(credentials: LocalWhitelistCredentials): Promise<"signed_in">;
  logout(): Promise<"signed_out">;
  status(): Promise<NativeAuthStatus>;
}

export class NativeAuthClientError extends Error {
  constructor(readonly operation: NativeAuthOperation) {
    super(`native-auth-${operation}-failed`);
    this.name = "NativeAuthClientError";
  }
}

async function tauriInvoker(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  return invoke<unknown>(command, args);
}

function isNativeAuthStatus(value: unknown): value is NativeAuthStatus {
  return value === "disabled" || value === "signed_out" || value === "signed_in";
}

export function createNativeAuthClient(
  nativeInvoke: NativeAuthInvoker = tauriInvoker,
): NativeAuthClient {
  async function run(
    operation: NativeAuthOperation,
    args?: Record<string, unknown>,
  ): Promise<NativeAuthStatus> {
    try {
      const command = operation === "local-whitelist-login"
        ? "native_auth_local_whitelist_login"
        : `native_auth_${operation}`;
      const response = args === undefined
        ? await nativeInvoke(command)
        : await nativeInvoke(command, args);
      if (!isNativeAuthStatus(response)) {
        throw new NativeAuthClientError(operation);
      }
      return response;
    } catch (error: unknown) {
      if (error instanceof NativeAuthClientError) {
        throw error;
      }
      throw new NativeAuthClientError(operation);
    }
  }

  return {
    async login() {
      const status = await run("login");
      if (status !== "signed_in") {
        throw new NativeAuthClientError("login");
      }
      return status;
    },
    async localWhitelistLogin(credentials) {
      const status = await run("local-whitelist-login", {
        request: {
          username: credentials.username,
          password: credentials.password,
        },
      });
      if (status !== "signed_in") {
        throw new NativeAuthClientError("local-whitelist-login");
      }
      return status;
    },
    async logout() {
      const status = await run("logout");
      if (status !== "signed_out") {
        throw new NativeAuthClientError("logout");
      }
      return status;
    },
    async status() {
      return run("status");
    },
  };
}

export const nativeAuthClient = createNativeAuthClient();
