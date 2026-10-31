import { csvEnv } from "./umgebung.js";
import { MS_PER_DAY } from "./zeitspannen.js";

export function safetyRohwerte(umgebung) {
  const { env, numEnv, boolEnv } = umgebung;
  return {
    outboundFrozen: boolEnv("OUTBOUND_FROZEN", env.OUTBOUND_FROZEN, { fallback: false }),
    allowedCountryCodes: csvEnv(env.ALLOWED_COUNTRY_CODES || "+49,+33,+44"),
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
      max: 60000,
    }),
    reserveReleaseGraceMs: numEnv("RESERVE_RELEASE_GRACE_MS", env.RESERVE_RELEASE_GRACE_MS, {
      fallback: 15000,
      min: 0,
    }),
    budgetWatchdogIntervalMs: numEnv(
      "BUDGET_WATCHDOG_INTERVAL_MS",
      env.BUDGET_WATCHDOG_INTERVAL_MS,
      {
        fallback: 15000,
        min: 0,
        max: 600000,
      },
    ),
    rateLimitPerMin: numEnv("RATE_LIMIT_PER_MIN", env.RATE_LIMIT_PER_MIN, {
      fallback: 120,
      min: 0,
    }),
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
    fakeOriginateElevenlabs: boolEnv("FAKE_ORIGINATE_ELEVENLABS", env.FAKE_ORIGINATE_ELEVENLABS, {
      fallback: false,
    }),
    outboundAniGateEnabled: boolEnv("OUTBOUND_ANI_GATE_ENABLED", env.OUTBOUND_ANI_GATE_ENABLED, {
      fallback: false,
    }),
    outboundAniGateMaxAgeMs: numEnv(
      "OUTBOUND_ANI_GATE_MAX_AGE_MS",
      env.OUTBOUND_ANI_GATE_MAX_AGE_MS,
      {
        fallback: 900000,
        min: 0,
      },
    ),
  };
}
