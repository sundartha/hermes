import { MS_PER_DAY, MS_PER_MINUTE } from "../utils/timer.ts";
import type { umgebungMit } from "./umgebung.ts";

type NumEnv = ReturnType<typeof umgebungMit>["numEnv"];

function geldWacheIntervallMs(raw: string | undefined, numEnv: NumEnv): number {
  return numEnv("BUDGET_WATCHDOG_INTERVAL_MS", raw, {
    fallback: 15000,
    min: 0,
    max: 600000,
  });
}

export function rohwerteFristen(
  env: {
    FRISTEN_TAKT_MS?: string | undefined;
    FRISTEN_LIMIT_JE_MANDANT?: string | undefined;
    BUDGET_WATCHDOG_INTERVAL_MS?: string | undefined;
  },
  { numEnv }: Pick<ReturnType<typeof umgebungMit>, "numEnv">,
): { fristenTaktMs: number; fristenLimitJeMandant: number } {
  const takt = numEnv("FRISTEN_TAKT_MS", env.FRISTEN_TAKT_MS, {
    fallback: 15000,
    min: 1,
    max: 15000,
  });
  const geldWacheMs = geldWacheIntervallMs(env.BUDGET_WATCHDOG_INTERVAL_MS, numEnv);
  return {
    fristenTaktMs: geldWacheMs > 0 ? Math.min(takt, geldWacheMs) : takt,
    fristenLimitJeMandant: numEnv("FRISTEN_LIMIT_JE_MANDANT", env.FRISTEN_LIMIT_JE_MANDANT, {
      fallback: 20,
      min: 1,
      max: 1000,
    }),
  };
}

export function rohwerteSafety(
  env: {
    OUTBOUND_FROZEN?: string | undefined;
    ALLOWED_COUNTRY_CODES?: string | undefined;
    MAX_CALLS_PER_HOUR?: string | undefined;
    PER_TARGET_CALL_CAP?: string | undefined;
    PER_TARGET_WINDOW_MS?: string | undefined;
    CAP_FAREWELL_LEAD_MS?: string | undefined;
    RESERVE_RELEASE_GRACE_MS?: string | undefined;
    BUDGET_WATCHDOG_INTERVAL_MS?: string | undefined;
    RATE_LIMIT_PER_MIN?: string | undefined;
    SERVER_INSTANCES?: string | undefined;
    CSRF_ENFORCE?: string | undefined;
    MCP_ALLOWED_ORIGINS?: string | undefined;
    MCP_ORIGIN_ENFORCE?: string | undefined;
    SKIP_TWILIO_SIGNATURE_CHECK?: string | undefined;
    FAKE_ORIGINATE?: string | undefined;
  },
  { boolEnv, csvEnv, numEnv, textEnv }: Pick<ReturnType<typeof umgebungMit>, "boolEnv" | "csvEnv" | "numEnv" | "textEnv">,
): {
  outboundFrozen: boolean;
  allowedCountryCodes: string[];
  maxCallsPerHour: number;
  perTargetCallCap: number;
  perTargetWindowMs: number;
  capFarewellLeadMs: number;
  reserveReleaseGraceMs: number;
  budgetWatchdogIntervalMs: number;
  rateLimitPerMin: number;
  serverInstanzen: number;
  csrfEnforce: boolean;
  mcpAllowedOrigins: string[];
  mcpOriginEnforce: boolean;
  skipTwilioSignatureCheck: boolean;
  fakeOriginate: boolean;
} {
  return {
    outboundFrozen: boolEnv("OUTBOUND_FROZEN", env.OUTBOUND_FROZEN, { fallback: false }),
    allowedCountryCodes: csvEnv(textEnv(env.ALLOWED_COUNTRY_CODES, "+49,+33,+44")),
    maxCallsPerHour: numEnv("MAX_CALLS_PER_HOUR", env.MAX_CALLS_PER_HOUR, {
      fallback: 6,
      min: 0,
    }),
    perTargetCallCap: numEnv("PER_TARGET_CALL_CAP", env.PER_TARGET_CALL_CAP, {
      fallback: 3,
      min: 0,
    }),
    perTargetWindowMs: numEnv("PER_TARGET_WINDOW_MS", env.PER_TARGET_WINDOW_MS, {
      fallback: MS_PER_DAY,
      min: 1,
    }),
    capFarewellLeadMs: numEnv("CAP_FAREWELL_LEAD_MS", env.CAP_FAREWELL_LEAD_MS, {
      fallback: 20000,
      min: 0,
      max: MS_PER_MINUTE,
    }),
    reserveReleaseGraceMs: numEnv("RESERVE_RELEASE_GRACE_MS", env.RESERVE_RELEASE_GRACE_MS, {
      fallback: 15000,
      min: 0,
    }),
    budgetWatchdogIntervalMs: geldWacheIntervallMs(env.BUDGET_WATCHDOG_INTERVAL_MS, numEnv),
    rateLimitPerMin: numEnv("RATE_LIMIT_PER_MIN", env.RATE_LIMIT_PER_MIN, {
      fallback: 120,
      min: 0,
    }),
    serverInstanzen: numEnv("SERVER_INSTANCES", env.SERVER_INSTANCES, { fallback: 1, min: 1 }),
    csrfEnforce: boolEnv("CSRF_ENFORCE", env.CSRF_ENFORCE, { fallback: true }),
    mcpAllowedOrigins: csvEnv(env.MCP_ALLOWED_ORIGINS),
    mcpOriginEnforce: boolEnv("MCP_ORIGIN_ENFORCE", env.MCP_ORIGIN_ENFORCE, {
      fallback: true,
    }),
    skipTwilioSignatureCheck: boolEnv(
      "SKIP_TWILIO_SIGNATURE_CHECK",
      env.SKIP_TWILIO_SIGNATURE_CHECK,
      { fallback: false },
    ),
    fakeOriginate: boolEnv("FAKE_ORIGINATE", env.FAKE_ORIGINATE, { fallback: false }),
  };
}
