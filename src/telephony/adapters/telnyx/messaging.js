import { config } from "../../../config.js";
import { assertTelnyxOk } from "./errors.js";

const MESSAGES_PATH = "/v2/messages";

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
    });
    await assertTelnyxOk(res, "sendSms");
  },
};
