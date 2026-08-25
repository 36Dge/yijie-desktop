import { demoFastLocalProfileEnabled } from "./local-profile";

const ENABLED_VALUE = "true";
const LOCAL_ENVIRONMENT = "local";

export function isLocalWhitelistLoginEnabled(
  value: unknown,
  environment: unknown,
): boolean {
  return value === ENABLED_VALUE && environment === LOCAL_ENVIRONMENT;
}

export const localWhitelistLoginEnabled = isLocalWhitelistLoginEnabled(
  import.meta.env.VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED,
  import.meta.env.VITE_YIJIE_ENV,
) && !demoFastLocalProfileEnabled;
