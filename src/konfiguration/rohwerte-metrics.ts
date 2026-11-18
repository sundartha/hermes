import type { umgebungMit } from "./umgebung.ts";

export function rohwerteMetrics(
  env: { METRICS_ENABLED?: string | undefined; LOG_REQUEST_ID?: string | undefined },
  { boolEnv }: Pick<ReturnType<typeof umgebungMit>, "boolEnv">,
): { metricsEnabled: boolean; logRequestId: boolean } {
  return {
    metricsEnabled: boolEnv("METRICS_ENABLED", env.METRICS_ENABLED, { fallback: false }),
    logRequestId: boolEnv("LOG_REQUEST_ID", env.LOG_REQUEST_ID, { fallback: false }),
  };
}
