import { demoFastLocalProfileEnabled } from "./local-profile";

export function isSkillMarketplaceUiEnabled(
  environment: unknown,
  profile: unknown,
): boolean {
  return environment === "local" && profile === "demo_fast";
}

export const skillMarketplaceUiEnabled = demoFastLocalProfileEnabled;
