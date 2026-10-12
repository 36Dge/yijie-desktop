/** Candidate UI gate only. Native must separately qualify all execution capabilities. */
export function isExpertsUiEnabled(environment: unknown, profile: unknown, enabled: unknown): boolean {
  return environment === "local" && profile === "demo_fast" && enabled === "true";
}

export const expertsUiEnabled = isExpertsUiEnabled(
  import.meta.env.VITE_YIJIE_ENV,
  import.meta.env.VITE_YIJIE_LOCAL_PROFILE,
  import.meta.env.VITE_YIJIE_EXPERTS_ENABLED,
);
