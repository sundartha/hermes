// Twilio-Adapter: Messaging (sendSms). Reines Verschieben von messages.create.
import { twilioClient } from "./client.js";

/** @type {import("../../ports.js").Messaging} */
export const twilioMessaging = {
  // SMS senden. Parameter (from/to/body) 1:1 wie bisher in server.js:353.
  async sendSms(params) {
    await twilioClient().messages.create(params);
  },
};
