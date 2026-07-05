export interface RuntimeHealth {
  runtime: string;
  status: "ok" | "degraded";
}

export async function getRuntimeHealth(): Promise<RuntimeHealth> {
  return {
    runtime: "desktop-sidecar",
    status: "ok",
  };
}
