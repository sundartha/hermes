import type { umgebungMit } from "./umgebung.ts";

export const TELNYX_API_BASE_STANDARD = "https://api.telnyx.com";

export function rohwerteTelephony(
  env: {
    TELNYX_API_KEY?: string | undefined;
    TELNYX_PUBLIC_KEY?: string | undefined;
    TELNYX_API_BASE?: string | undefined;
    TELNYX_CONNECTION_ID?: string | undefined;
    TELNYX_CALL_CONTROL_APP_ID?: string | undefined;
    TELNYX_ACCOUNT_SID?: string | undefined;
    MACHINE_DETECTION_ENABLED?: string | undefined;
    MACHINE_DETECTION_TIMEOUT_S?: string | undefined;
  },
  {
    boolEnv,
    numEnv,
    stripTrailingSlash,
    textEnv,
  }: Pick<ReturnType<typeof umgebungMit>, "boolEnv" | "numEnv" | "stripTrailingSlash" | "textEnv">,
) {
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
