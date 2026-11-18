import { MS_PER_DAY } from "../utils/timer.ts";
import type { umgebungMit } from "./umgebung.ts";

export function rohwerteProvisioning(
  env: {
    OWNER_NUMBER_SEED?: string | undefined;
    OWNER_NUMBER_PROVIDER?: string | undefined;
    BOOTSTRAP_E164?: string | undefined;
    BOOTSTRAP_PROVIDER?: string | undefined;
    MAX_NUMBERS?: string | undefined;
    MAX_NUMBERS_PER_TENANT?: string | undefined;
    PROVISIONING_ENABLED?: string | undefined;
    PROVISIONING_REDRIVE_MAX_AGE_MS?: string | undefined;
    PROVISIONING_RETRY_MAX_ATTEMPTS?: string | undefined;
    PROVISIONING_RETRY_MIN_INTERVAL_MS?: string | undefined;
    RELEASE_GRACE_DAYS?: string | undefined;
    PROVISIONING_COUNTRY?: string | undefined;
    GEO_ENABLED?: string | undefined;
    GEO_DB_PATH?: string | undefined;
    WORLD_DEFAULT_LANGUAGE_ENABLED?: string | undefined;
  },
  {
    boolEnv,
    numEnv,
    textEnv,
  }: Pick<ReturnType<typeof umgebungMit>, "boolEnv" | "numEnv" | "textEnv">,
): {
  ownerNumberSeed: string;
  ownerNumberProvider: string;
  bootstrapE164: string;
  bootstrapProvider: string;
  maxNumbers: number | undefined;
  maxNumbersPerTenant: number | undefined;
  provisioningEnabled: boolean;
  provisioningRedriveMaxAgeMs: number | undefined;
  provisioningRetryMaxAttempts: number | undefined;
  provisioningRetryMinIntervalMs: number | undefined;
  releaseGraceMs: number;
  provisioningCountry: string;
  geoEnabled: boolean;
  geoDbPath: string;
  worldDefaultLanguageEnabled: boolean;
} {
  return {
    ownerNumberSeed: env.OWNER_NUMBER_SEED ?? "",
    ownerNumberProvider: (env.OWNER_NUMBER_PROVIDER ?? "").toLowerCase(),
    bootstrapE164: env.BOOTSTRAP_E164 ?? "",
    bootstrapProvider: env.BOOTSTRAP_PROVIDER ?? "",
    maxNumbers: numEnv("MAX_NUMBERS", env.MAX_NUMBERS, { fallback: 5, min: 0 }),
    maxNumbersPerTenant: numEnv("MAX_NUMBERS_PER_TENANT", env.MAX_NUMBERS_PER_TENANT, {
      fallback: 1,
      min: 0,
    }),
    provisioningEnabled: boolEnv("PROVISIONING_ENABLED", env.PROVISIONING_ENABLED, {
      fallback: false,
    }),
    provisioningRedriveMaxAgeMs: numEnv(
      "PROVISIONING_REDRIVE_MAX_AGE_MS",
      env.PROVISIONING_REDRIVE_MAX_AGE_MS,
      { fallback: 0, min: 0, max: MS_PER_DAY - 1 },
    ),
    provisioningRetryMaxAttempts: numEnv(
      "PROVISIONING_RETRY_MAX_ATTEMPTS",
      env.PROVISIONING_RETRY_MAX_ATTEMPTS,
      { fallback: 3, min: 0 },
    ),
    provisioningRetryMinIntervalMs: numEnv(
      "PROVISIONING_RETRY_MIN_INTERVAL_MS",
      env.PROVISIONING_RETRY_MIN_INTERVAL_MS,
      { fallback: MS_PER_DAY, min: 0 },
    ),
    releaseGraceMs:
      (numEnv("RELEASE_GRACE_DAYS", env.RELEASE_GRACE_DAYS, { fallback: 0, min: 0 }) ?? 0) *
      MS_PER_DAY,
    provisioningCountry: textEnv(env.PROVISIONING_COUNTRY, "DE"),
    geoEnabled: boolEnv("GEO_ENABLED", env.GEO_ENABLED, { fallback: false }),
    geoDbPath: env.GEO_DB_PATH ?? "",
    worldDefaultLanguageEnabled: boolEnv(
      "WORLD_DEFAULT_LANGUAGE_ENABLED",
      env.WORLD_DEFAULT_LANGUAGE_ENABLED,
      { fallback: false },
    ),
  };
}
