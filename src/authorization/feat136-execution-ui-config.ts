import { feat134StreamingUiEnabled } from "./feat134-streaming-ui-config";
import { isDemoFastLocalProfile } from "./local-profile";

const EXPLICITLY_ENABLED = "true";

export function isFeat136ExecutionUiEnabled(
  environment: unknown,
  profile: unknown,
  explicitEnabled: unknown,
  feat134Enabled: boolean,
): boolean {
  return feat134Enabled &&
    explicitEnabled === EXPLICITLY_ENABLED &&
    isDemoFastLocalProfile(environment, profile);
}

export const feat136ExecutionUiEnabled = isFeat136ExecutionUiEnabled(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
  import.meta.env.VITE_YIJIE_FEAT136_EXECUTION_ENABLED,
  feat134StreamingUiEnabled,
);
