import { isDemoFastLocalProfile } from "./local-profile";

const EXPLICITLY_ENABLED = "true";

export function isFeat134StreamingUiEnabled(
  environment: unknown,
  profile: unknown,
  explicitEnabled: unknown,
): boolean {
  return explicitEnabled === EXPLICITLY_ENABLED &&
    isDemoFastLocalProfile(environment, profile);
}

export const feat134StreamingUiEnabled = isFeat134StreamingUiEnabled(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
  import.meta.env.VITE_YIJIE_FEAT134_STREAMING_ENABLED,
);
