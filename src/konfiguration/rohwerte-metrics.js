export function metricsRohwerte(umgebung) {
  const { env, boolEnv } = umgebung;
  return {
    metricsEnabled: boolEnv("METRICS_ENABLED", env.METRICS_ENABLED, { fallback: false }),
    logRequestId: boolEnv("LOG_REQUEST_ID", env.LOG_REQUEST_ID, { fallback: false }),
  };
}
