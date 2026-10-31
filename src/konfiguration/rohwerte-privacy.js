export function privacyRohwerte(umgebung) {
  const { env, numEnv } = umgebung;
  return {
    retentionDays: numEnv("RETENTION_DAYS", env.RETENTION_DAYS, { fallback: 30, min: 0 }),
    diagnosticRetentionDays: numEnv("DIAGNOSTIC_RETENTION_DAYS", env.DIAGNOSTIC_RETENTION_DAYS, {
      fallback: 7,
      min: 0,
    }),
    evidenceRetentionDays: numEnv("EVIDENCE_RETENTION_DAYS", env.EVIDENCE_RETENTION_DAYS, {
      fallback: 0,
      min: 0,
    }),
  };
}
