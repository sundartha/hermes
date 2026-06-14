// Telnyx-Adapter: Messaging (sendSms) via REST (POST /v2/messages, Bearer + JSON).
// Kein SDK/client.js noetig: Base-URL + Key direkt aus config (kein Lazy-Init-
// Antipattern, P15). global fetch ist eingebaut (Node) - keine neue Dependency.
// Der Port spricht "body"; Telnyx erwartet "text" (Mapping hier).
import { config } from "../../../config.js";

const MESSAGES_PATH = "/v2/messages";

/** @type {import("../../ports.js").Messaging} */
export const telnyxMessaging = {
  async sendSms({ from, to, body }) {
    if (!config.telnyxApiKey) throw new Error("Telnyx sendSms: TELNYX_API_KEY fehlt");
    const res = await fetch(config.telnyxApiBase + MESSAGES_PATH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.telnyxApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, text: body }),
    });
    if (!res.ok) {
      // Kontext werfen (P8), aber NIE den API-Key in die Meldung leaken (Regel 4).
      throw new Error(`Telnyx sendSms fehlgeschlagen: HTTP ${res.status}`);
    }
  },
};
