const ENABLED_VALUE = "true";

export function isAuthoritativePermissionUiEnabled(value: unknown): boolean {
  return value === ENABLED_VALUE;
}

export const authoritativePermissionUiEnabled = isAuthoritativePermissionUiEnabled(
  import.meta.env.VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED,
);
