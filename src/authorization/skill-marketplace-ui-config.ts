import { isDemoFastLocalProfile } from "./local-profile";

const EXPLICITLY_ENABLED = "true";

export function isSkillMarketplaceUiEnabled(
  environment: unknown,
  profile: unknown,
  explicitEnabled?: unknown,
): boolean {
  return (
    isDemoFastLocalProfile(environment, profile) ||
    explicitEnabled === EXPLICITLY_ENABLED
  );
}

export const skillMarketplaceUiEnabled = isSkillMarketplaceUiEnabled(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
  import.meta.env.VITE_YIJIE_SKILL_MARKETPLACE_UI_ENABLED,
);
