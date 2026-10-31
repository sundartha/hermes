const CONSULT_WAIT_MAX_MS = 60_000;
const CONSULT_OPEN_MAX_MS = 300_000;
const EL_CONSULT_STAGE_MAX_MS = 55_000;

export function tenancyRohwerte(umgebung) {
  const { env, numEnv, boolEnv } = umgebung;
  return {
    multiTenant: boolEnv("MULTI_TENANT", env.MULTI_TENANT, { fallback: false }),
    mcpUiEnabled: boolEnv("MCP_UI_ENABLED", env.MCP_UI_ENABLED, { fallback: true }),
    assistantContextEnabled: boolEnv("ASSISTANT_CONTEXT_ENABLED", env.ASSISTANT_CONTEXT_ENABLED, {
      fallback: true,
    }),
    precallBriefingEnabled: boolEnv("PRECALL_BRIEFING_ENABLED", env.PRECALL_BRIEFING_ENABLED, {
      fallback: false,
    }),
    consultEnabled: boolEnv("CONSULT_ENABLED", env.CONSULT_ENABLED, { fallback: false }),
    inCallConsultEnabled: boolEnv("IN_CALL_CONSULT_ENABLED", env.IN_CALL_CONSULT_ENABLED, {
      fallback: false,
    }),
    consultWaitMs: numEnv("CONSULT_WAIT_MS", env.CONSULT_WAIT_MS, {
      fallback: 4000,
      min: 0,
      max: CONSULT_WAIT_MAX_MS,
    }),
    consultOpenMs: numEnv("CONSULT_OPEN_MS", env.CONSULT_OPEN_MS, {
      fallback: 47000,
      min: 0,
      max: CONSULT_OPEN_MAX_MS,
    }),
    elConsultDeliveryMs: numEnv("EL_CONSULT_DELIVERY_MS", env.EL_CONSULT_DELIVERY_MS, {
      fallback: 5000,
      min: 0,
      max: EL_CONSULT_STAGE_MAX_MS,
    }),
    elConsultAckMs: numEnv("EL_CONSULT_ACK_MS", env.EL_CONSULT_ACK_MS, {
      fallback: 5000,
      min: 0,
      max: EL_CONSULT_STAGE_MAX_MS,
    }),
    elConsultAnswerMs: numEnv("EL_CONSULT_ANSWER_MS", env.EL_CONSULT_ANSWER_MS, {
      fallback: 30000,
      min: 0,
      max: EL_CONSULT_STAGE_MAX_MS,
    }),
    selfServiceEnabled: boolEnv("SELF_SERVICE_ENABLED", env.SELF_SERVICE_ENABLED, {
      fallback: false,
    }),
    profilesSeed: env.PROFILES_JSON || "",
  };
}
