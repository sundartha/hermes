import { DEFAULT_STT_PROFILE } from "../telephony/stt-profile.js";
import { MS_PER_MINUTE } from "../utils/timer.js";

const ELEVENLABS_API_BASE_STANDARD = "https://api.elevenlabs.io";

function elevenLabsZugang(env, { stripTrailingSlash }) {
  return {
    apiKey: (env.ELEVENLABS_API_KEY || "").trim(),
    apiBase: stripTrailingSlash(
      (env.ELEVENLABS_API_BASE || ELEVENLABS_API_BASE_STANDARD).trim(),
    ),
  };
}

function playTts(env, { boolEnv, numEnv }, zugang) {
  return {
    enabled: boolEnv("ELEVENLABS_PLAY_TTS_ENABLED", env.ELEVENLABS_PLAY_TTS_ENABLED, {
      fallback: false,
    }),
    apiKey: zugang.apiKey,
    voiceId: (env.ELEVENLABS_VOICE_ID || "").trim(),
    model: (env.ELEVENLABS_MODEL || "eleven_v4_turbo").trim(),
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
      fallback: MS_PER_MINUTE,
      min: 5000,
      max: 600000,
    }),
  };
}

function ausgehend(env, { boolEnv, enumEnv, numEnv }, zugang) {
  return {
    enabled: boolEnv("ELEVENLABS_OUTBOUND_ENABLED", env.ELEVENLABS_OUTBOUND_ENABLED, {
      fallback: false,
    }),
    agentId: (env.ELEVENLABS_AGENT_ID || "").trim(),
    ueberTelnyx: boolEnv("ELEVENLABS_OUTBOUND_UEBER_TELNYX", env.ELEVENLABS_OUTBOUND_UEBER_TELNYX, {
      fallback: false,
    }),
    vorspann: boolEnv("ELEVENLABS_OUTBOUND_VORSPANN", env.ELEVENLABS_OUTBOUND_VORSPANN, {
      fallback: false,
    }),
    numberRegistrationEnabled: boolEnv(
      "ELEVENLABS_NUMBER_REGISTRATION_ENABLED",
      env.ELEVENLABS_NUMBER_REGISTRATION_ENABLED,
      { fallback: false },
    ),
    resultPollMs: numEnv("ELEVENLABS_RESULT_POLL_MS", env.ELEVENLABS_RESULT_POLL_MS, {
      fallback: 5000,
      min: 100,
      max: MS_PER_MINUTE,
    }),
    vorspannWiedergabeFristMs: numEnv("VORSPANN_WIEDERGABE_FRIST_MS", env.VORSPANN_WIEDERGABE_FRIST_MS, {
      fallback: 20000,
      min: 100,
      max: 120000,
    }),
    bridgeStartDeadlineMs: numEnv("EL_BRIDGE_START_DEADLINE_MS", env.EL_BRIDGE_START_DEADLINE_MS, {
      fallback: 30000,
      min: 100,
      max: 120000,
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
    erwarteterMedienweg:
      env.ELEVENLABS_ERWARTETER_MEDIENWEG === undefined
        ? "livekit"
        : enumEnv("ELEVENLABS_ERWARTETER_MEDIENWEG", env.ELEVENLABS_ERWARTETER_MEDIENWEG.trim(), {
            allowed: ["livekit", "sipgo"],
            fallback: "",
          }),
  };
}

export function rohwerteVoice(env, helfer) {
  const zugang = elevenLabsZugang(env, helfer);
  const { boolEnv, csvEnv, numEnv } = helfer;
  return {
    elevenLabsPlayTts: playTts(env, helfer, zugang),
    elevenLabsToolToken: (env.ELEVENLABS_TOOL_TOKEN || "").trim(),
    elevenLabsTenantTokenRequired: boolEnv(
      "ELEVENLABS_TENANT_TOKEN_REQUIRED",
      env.ELEVENLABS_TENANT_TOKEN_REQUIRED,
      { fallback: false },
    ),
    elevenLabsOutbound: ausgehend(env, helfer, zugang),
    sendSmsSummary: boolEnv("SEND_SMS_SUMMARY", env.SEND_SMS_SUMMARY, { fallback: true }),
    dailySmsCap: numEnv("DAILY_SMS_CAP", env.DAILY_SMS_CAP, { fallback: 20, min: 0 }),
    sttSpeechTimeoutSec: numEnv("STT_SPEECH_TIMEOUT_SEC", env.STT_SPEECH_TIMEOUT_SEC, {
      fallback: 2,
      min: 1,
    }),
    maxEmptyTurns: numEnv("MAX_EMPTY_TURNS", env.MAX_EMPTY_TURNS, { fallback: 3, min: 2 }),
    callerSubstanceMinLen: numEnv("CALLER_SUBSTANCE_MIN_LEN", env.CALLER_SUBSTANCE_MIN_LEN, {
      fallback: 2,
      min: 1,
    }),
    thinkingSignalEnabled: boolEnv("THINKING_SIGNAL_ENABLED", env.THINKING_SIGNAL_ENABLED, {
      fallback: false,
    }),
    toolFollowUpEnabled: boolEnv("TOOL_FOLLOW_UP_ENABLED", env.TOOL_FOLLOW_UP_ENABLED, {
      fallback: false,
    }),
    ownerSelfCallEnabled: boolEnv(
      "OWNER_SELF_CALL_ENABLED",
      env.OWNER_SELF_CALL_ENABLED,
      { fallback: false },
    ),
    ownerSelfCallTenantIds: csvEnv(env.OWNER_SELF_CALL_TENANT_IDS),
    inboundOwnerGreetingEnabled: boolEnv(
      "INBOUND_OWNER_GREETING_ENABLED",
      env.INBOUND_OWNER_GREETING_ENABLED,
      { fallback: false },
    ),
    inboundOwnerGreetingTenantIds: csvEnv(env.INBOUND_OWNER_GREETING_TENANT_IDS),
    sttProfile: (env.STT_PROFILE || DEFAULT_STT_PROFILE).trim(),
  };
}
