import { config } from "../../../config.js";
import { assertTelnyxOk } from "./errors.js";

const MESSAGES_PATH = "/v2/messages";
const SMS_SENDEN_FRIST_MS = 10_000;

export const telnyxMessaging = {
  async sendSms({ from, to, body }) {
    if (!config.telephony.telnyxApiKey) throw new Error("Telnyx sendSms: TELNYX_API_KEY fehlt");
    const res = await fetch(config.telephony.telnyxApiBase + MESSAGES_PATH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.telephony.telnyxApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, text: body }),
      signal: AbortSignal.timeout(SMS_SENDEN_FRIST_MS),
    });
    await assertTelnyxOk(res, "sendSms");
  },
};
