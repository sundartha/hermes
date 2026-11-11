export function rohwerteTelephony(env, { boolEnv, numEnv, stripTrailingSlash }) {
  return {
    telnyxApiKey: env.TELNYX_API_KEY || "",
    telnyxPublicKey: env.TELNYX_PUBLIC_KEY || "",
    telnyxApiBase: stripTrailingSlash(env.TELNYX_API_BASE || "https://api.telnyx.com"),
    telnyxConnectionId: env.TELNYX_CONNECTION_ID || "",
    telnyxCallControlAppId: (env.TELNYX_CALL_CONTROL_APP_ID || "").trim(),
    telnyxAccountSid: env.TELNYX_ACCOUNT_SID || "",
    telnyxSipTrunkUsername: (env.TELNYX_SIP_TRUNK_USERNAME || "").trim(),
    telnyxSipTrunkPassword: env.TELNYX_SIP_TRUNK_PASSWORD || "",
    machineDetection: {
      enabled: boolEnv("MACHINE_DETECTION_ENABLED", env.MACHINE_DETECTION_ENABLED, {
        fallback: false,
      }),
      timeoutS: numEnv("MACHINE_DETECTION_TIMEOUT_S", env.MACHINE_DETECTION_TIMEOUT_S, {
        fallback: 5,
        min: 3,
        max: 30,
      }),
    },
  };
}
