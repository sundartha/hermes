export const TELNYX_API_BASE_STANDARD = "https://api.telnyx.com";

export function rohwerteTelephony(env, { boolEnv, numEnv, stripTrailingSlash, textEnv }) {
  return {
    telnyxApiKey: env.TELNYX_API_KEY ?? "",
    telnyxPublicKey: env.TELNYX_PUBLIC_KEY ?? "",
    telnyxApiBase: stripTrailingSlash(textEnv(env.TELNYX_API_BASE, TELNYX_API_BASE_STANDARD)),
    telnyxConnectionId: env.TELNYX_CONNECTION_ID ?? "",
    telnyxCallControlAppId: (env.TELNYX_CALL_CONTROL_APP_ID ?? "").trim(),
    telnyxAccountSid: env.TELNYX_ACCOUNT_SID ?? "",
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
