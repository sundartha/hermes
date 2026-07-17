// Telnyx-Adapter: Messaging (sendSms) via REST (POST /v2/messages, Bearer + JSON).
// Kein SDK/client.js noetig: Base-URL + Key direkt aus config (kein Lazy-Init-
// Antipattern, P15). global fetch ist eingebaut (Node) - keine neue Dependency.
// Der Port spricht "body"; Telnyx erwartet "text" (Mapping hier).
import { config } from "../../../config.js";
import { assertTelnyxOk } from "./errors.js";

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
    // Kontext werfen (P8), aber NIE den API-Key in die Meldung leaken (Regel 4). Geteilter
    // Telnyx-Fehlerpfad (G5): allowlisted code/title reichern die Meldung an (log-only,
    // keine HTTP-Flaeche, kein Secret) - Kontrollfluss bleibt: throw genau bei !res.ok.
    await assertTelnyxOk(res, "sendSms");
  },
};
