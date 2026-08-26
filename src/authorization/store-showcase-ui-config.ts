import { isDemoFastLocalProfile } from "./local-profile";

export function isStoreShowcaseUiEnabled(
  environment: unknown,
  profile: unknown,
): boolean {
  return isDemoFastLocalProfile(environment, profile);
}

export const storeShowcaseUiEnabled = isStoreShowcaseUiEnabled(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
);
