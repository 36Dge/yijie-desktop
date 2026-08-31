import { feat136ExecutionUiEnabled } from "./feat136-execution-ui-config";
import { isDemoFastLocalProfile } from "./local-profile";

const EXPLICITLY_ENABLED = "true";

export function isFeat137ApprovalUiEnabled(
  environment: unknown,
  profile: unknown,
  explicitEnabled: unknown,
  feat136Enabled: boolean,
): boolean {
  return feat136Enabled &&
    explicitEnabled === EXPLICITLY_ENABLED &&
    isDemoFastLocalProfile(environment, profile);
}

export const feat137ApprovalUiEnabled = isFeat137ApprovalUiEnabled(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
  import.meta.env.VITE_YIJIE_FEAT137_APPROVAL_ENABLED,
  feat136ExecutionUiEnabled,
);
