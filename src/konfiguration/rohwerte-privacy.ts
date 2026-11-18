import type { umgebungMit } from "./umgebung.ts";

export function rohwertePrivacy(
  env: {
    RETENTION_DAYS?: string | undefined;
    DIAGNOSTIC_RETENTION_DAYS?: string | undefined;
    EVIDENCE_RETENTION_DAYS?: string | undefined;
  },
  { numEnv }: Pick<ReturnType<typeof umgebungMit>, "numEnv">,
): { retentionDays: number | undefined; diagnosticRetentionDays: number | undefined; evidenceRetentionDays: number | undefined } {
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
