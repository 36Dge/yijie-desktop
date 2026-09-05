import { feat136ExecutionUiEnabled } from "./feat136-execution-ui-config";

export function isFeat137ApprovalUiEnabled(
  _environment: unknown,
  _profile: unknown,
  _explicitEnabled: unknown,
  _feat136Enabled: boolean,
): boolean {
  void [_environment, _profile, _explicitEnabled, _feat136Enabled];
  // Owner permanently terminated FEAT-137 without acceptance on 2026-09-05.
  // Keep historical readers, but no environment value can reactivate the UI.
  return false;
}

export const feat137ApprovalUiEnabled = isFeat137ApprovalUiEnabled(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
  import.meta.env.VITE_YIJIE_FEAT137_APPROVAL_ENABLED,
  feat136ExecutionUiEnabled,
);
