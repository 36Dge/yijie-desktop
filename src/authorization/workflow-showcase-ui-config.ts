import { isDemoFastLocalProfile } from "./local-profile";

export function isWorkflowShowcaseUiEnabled(
  environment: unknown,
  profile: unknown,
): boolean {
  return isDemoFastLocalProfile(environment, profile);
}

export const workflowShowcaseUiEnabled = isWorkflowShowcaseUiEnabled(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
);
