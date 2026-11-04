import { DEFAULT_STT_PROFILE } from "../telephony/stt-profile.js";
import { csvEnv, stripTrailingSlash } from "./umgebung.js";

export const VOICE_ENGINE = Object.freeze({ BUDGET: "budget" });

function elevenLabsZugang(env) {
  return {
    apiKey: (env.ELEVENLABS_API_KEY || "").trim(),
    apiBase: stripTrailingSlash((env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").trim()),
  };
}

function playTtsRohwerte(umgebung, zugang) {
  const { env, numEnv, boolEnv } = umgebung;
  return {
    enabled: boolEnv("ELEVENLABS_PLAY_TTS_ENABLED", env.ELEVENLABS_PLAY_TTS_ENABLED, {
      fallback: false,
    }),
    apiKey: zugang.apiKey,
    voiceId: (env.ELEVENLABS_VOICE_ID || "").trim(),
    model: (env.ELEVENLABS_MODEL || "eleven_v3_conversational").trim(),
    apiBase: zugang.apiBase,
    outputFormat: (env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128").trim(),
    synthTimeoutMs: numEnv("ELEVENLABS_SYNTH_TIMEOUT_MS", env.ELEVENLABS_SYNTH_TIMEOUT_MS, {
      fallback: 2000,
      min: 500,
      max: 10000,
    }),
    synthTotalTimeoutMs: numEnv(
      "ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS",
      env.ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS,
      { fallback: 10000, min: 1000, max: 30000 },
    ),
    tokenTtlMs: numEnv("ELEVENLABS_TTS_TOKEN_TTL_MS", env.ELEVENLABS_TTS_TOKEN_TTL_MS, {
      fallback: 60000,
      min: 5000,
      max: 600000,
    }),
  };
}

function outboundRohwerte(umgebung, zugang) {
  const { env, numEnv, boolEnv, enumEnv } = umgebung;
  return {
    enabled: boolEnv("ELEVENLABS_OUTBOUND_ENABLED", env.ELEVENLABS_OUTBOUND_ENABLED, {
      fallback: false,
    }),
    agentId: (env.ELEVENLABS_AGENT_ID || "").trim(),
    agentPhoneNumberId: (env.ELEVENLABS_AGENT_PHONE_NUMBER_ID || "").trim(),
    numberRegistrationEnabled: boolEnv(
      "ELEVENLABS_NUMBER_REGISTRATION_ENABLED",
      env.ELEVENLABS_NUMBER_REGISTRATION_ENABLED,
      { fallback: false },
    ),
    resultPollMs: numEnv("ELEVENLABS_RESULT_POLL_MS", env.ELEVENLABS_RESULT_POLL_MS, {
      fallback: 5000,
      min: 100,
      max: 60000,
    }),
    apiKey: zugang.apiKey,
    apiBase: zugang.apiBase,
    openingLineLlm: boolEnv(
      "ELEVENLABS_OPENING_LINE_LLM_ENABLED",
      env.ELEVENLABS_OPENING_LINE_LLM_ENABLED,
      { fallback: true },
    ),
    environment: enumEnv("ELEVENLABS_ENVIRONMENT", env.ELEVENLABS_ENVIRONMENT, {
      allowed: ["production", "staging"],
      fallback: "production",
    }),
  };
}

function gespraechRohwerte(umgebung) {
  const { env, numEnv, boolEnv } = umgebung;
  return {
    sttProfile: (env.STT_PROFILE || DEFAULT_STT_PROFILE).trim(),
    sttSpeechTimeoutSec: numEnv("STT_SPEECH_TIMEOUT_SEC", env.STT_SPEECH_TIMEOUT_SEC, {
      fallback: 2,
      min: 1,
    }),
    maxEmptyTurns: numEnv("MAX_EMPTY_TURNS", env.MAX_EMPTY_TURNS, { fallback: 3, min: 2 }),
    callerSubstanceMinLen: numEnv("CALLER_SUBSTANCE_MIN_LEN", env.CALLER_SUBSTANCE_MIN_LEN, {
      fallback: 2,
      min: 1,
    }),
    sendSmsSummary: boolEnv("SEND_SMS_SUMMARY", env.SEND_SMS_SUMMARY, { fallback: true }),
    dailySmsCap: numEnv("DAILY_SMS_CAP", env.DAILY_SMS_CAP, { fallback: 20, min: 0 }),
    thinkingSignalEnabled: boolEnv("THINKING_SIGNAL_ENABLED", env.THINKING_SIGNAL_ENABLED, {
      fallback: false,
    }),
    toolFollowUpEnabled: boolEnv("TOOL_FOLLOW_UP_ENABLED", env.TOOL_FOLLOW_UP_ENABLED, {
      fallback: false,
    }),
  };
}

function eigentuemerRohwerte(umgebung) {
  const { env, boolEnv } = umgebung;
  return {
    ownerSelfCallEnabled: boolEnv("OWNER_SELF_CALL_ENABLED", env.OWNER_SELF_CALL_ENABLED, {
      fallback: false,
    }),
    ownerSelfCallTenantIds: csvEnv(env.OWNER_SELF_CALL_TENANT_IDS),
    inboundOwnerGreetingEnabled: boolEnv(
      "INBOUND_OWNER_GREETING_ENABLED",
      env.INBOUND_OWNER_GREETING_ENABLED,
      { fallback: false },
    ),
    inboundOwnerGreetingTenantIds: csvEnv(env.INBOUND_OWNER_GREETING_TENANT_IDS),
  };
}

export function voiceRohwerte(umgebung) {
  const { env, boolEnv } = umgebung;
  const zugang = elevenLabsZugang(env);
  return {
    voiceEngine: VOICE_ENGINE.BUDGET,
    elevenLabsPlayTts: playTtsRohwerte(umgebung, zugang),
    elevenLabsToolToken: (env.ELEVENLABS_TOOL_TOKEN || "").trim(),
    elevenLabsTenantTokenRequired: boolEnv(
      "ELEVENLABS_TENANT_TOKEN_REQUIRED",
      env.ELEVENLABS_TENANT_TOKEN_REQUIRED,
      { fallback: false },
    ),
    elevenLabsOutbound: outboundRohwerte(umgebung, zugang),
    ...gespraechRohwerte(umgebung),
    ...eigentuemerRohwerte(umgebung),
  };
}
