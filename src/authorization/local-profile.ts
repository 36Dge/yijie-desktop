const LOCAL_ENVIRONMENT = "local";
const DEMO_FAST_PROFILE = "demo_fast";

export function isDemoFastLocalProfile(
  environment: unknown,
  profile: unknown,
): boolean {
  return environment === LOCAL_ENVIRONMENT && profile === DEMO_FAST_PROFILE;
}

export function shouldResetDemoFastStartupPath(
  enabled: boolean,
  pathname: string,
): boolean {
  return enabled && pathname !== "/";
}

export const demoFastLocalProfileEnabled = isDemoFastLocalProfile(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
);
