import { isDemoFastLocalProfile } from "./local-profile";

export const workflowLocalUiEnabled = isDemoFastLocalProfile(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
) && import.meta.env.VITE_YIJIE_WORKFLOW_ENABLED === "true";
