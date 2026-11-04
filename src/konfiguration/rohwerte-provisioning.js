import { trimmedUpper } from "./umgebung.js";
import { MS_PER_DAY } from "./zeitspannen.js";

export function provisioningRohwerte(umgebung) {
  const { env, numEnv, boolEnv } = umgebung;
  return {
    ownerNumberSeed: env.OWNER_NUMBER_SEED || "",
    ownerNumberProvider: (env.OWNER_NUMBER_PROVIDER || "").toLowerCase(),

    bootstrapE164: env.BOOTSTRAP_E164 || "",
    bootstrapProvider: env.BOOTSTRAP_PROVIDER || "",

    platformAniE164: (env.PLATFORM_ANI_E164 || "").trim(),

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
      numEnv("RELEASE_GRACE_DAYS", env.RELEASE_GRACE_DAYS, { fallback: 0, min: 0 }) * MS_PER_DAY,

    provisioningCountry: env.PROVISIONING_COUNTRY || "DE",
    forceNumberCountry: trimmedUpper(env.FORCE_NUMBER_COUNTRY),
    geoEnabled: boolEnv("GEO_ENABLED", env.GEO_ENABLED, { fallback: false }),
    geoDbPath: env.GEO_DB_PATH || "",
    worldDefaultLanguageEnabled: boolEnv(
      "WORLD_DEFAULT_LANGUAGE_ENABLED",
      env.WORLD_DEFAULT_LANGUAGE_ENABLED,
      { fallback: false },
    ),
  };
}
