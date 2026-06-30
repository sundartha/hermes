// Telnyx-Adapter: VoiceControl (originateCall, endCall) ueber die TeXML-REST-API.
// Kein SDK/client.js: Base-URL + Key direkt aus config (kein Lazy-Init-Antipattern,
// P15). global fetch ist eingebaut (Node) - keine neue Dependency. Der Port spricht
// neutrale Felder (from/to/url/...), Telnyx erwartet Twilio-kompatible PascalCase-
// Form-Felder (Mapping hier). API-Key NIE in Fehlermeldungen leaken (Regel 4).
//
// Verifiziert gegen die Telnyx-Doku (2026-06-15), live UNBESTAETIGT (erste echte
// Telnyx-Voice-Verdrahtung -> mit dem Owner live fixen, falls die API abweicht):
//   originate: POST {base}/v2/texml/calls/{connection_id}  (form, From/To/Url/...)
//              -> Twilio-kompatible Call-Resource, sid = CallSid.
//   endCall:   POST {base}/v2/texml/Accounts/{account_sid}/Calls/{call_sid}
//              (form, Status=completed) -> beendet den Call (Twilio-kompatibel).
import { config } from "../../../config.js";
import { assertTelnyxOk } from "./errors.js";

const TEXML_BASE = "/v2/texml";
const FORM_HEADERS_TYPE = "application/x-www-form-urlencoded";

// HTTP-Fehler werfen MIT Status (P8) und - falls vorhanden - dem Telnyx-Fehlercode/-titel,
// damit der echte Ablehnungsgrund (z.B. Caller-ID nicht zugewiesen, Land im Voice-Profil
// gesperrt) im Log steht statt nacktem "HTTP 403". STRIKT allowlisted: NUR errors[].code +
// errors[].title; NIE der rohe Body/detail (koennte Auth-/Nummern-Fragmente tragen, daher
// includeDetail=false), NIE der API-Key (Regel 4/5). attachStatus haengt err.providerStatus
// an, damit der Aufrufer (server.js) die Ablehnung kategorisieren kann. Gemeinsamer Parser
// in ./errors.js (G5) - eine konsistente Telnyx-Envelope-Entscheidung im Provider-Package.
const ATTACH_STATUS = { attachStatus: true };

// Bearer-Header + Form-Content-Type. Eine Stelle (G5) statt zweimal inline.
function headers() {
  return { Authorization: `Bearer ${config.telnyxApiKey}`, "Content-Type": FORM_HEADERS_TYPE };
}

/** @type {import("../../ports.js").VoiceControl} */
export const telnyxVoice = {
  // Outbound-Call starten. connection_id (TeXML-Application) haelt die Voice-URL
  // beim Provider; From/To/Url/StatusCallback steuern den konkreten Call.
  async originateCall({ from, to, url, statusCallback, statusCallbackEvent, method, timeLimit }) {
    if (!config.telnyxApiKey) throw new Error("Telnyx originateCall: TELNYX_API_KEY fehlt");
    if (!config.telnyxConnectionId)
      throw new Error("Telnyx originateCall: TELNYX_CONNECTION_ID fehlt");
    const form = new URLSearchParams({ From: from, To: to, Url: url });
    if (statusCallback) form.set("StatusCallback", statusCallback);
    if (method) {
      form.set("UrlMethod", method);
      form.set("StatusCallbackMethod", method);
    }
    for (const ev of statusCallbackEvent || []) form.append("StatusCallbackEvent", ev);
    // Defense-in-Depth: Telnyx-Honorierung von TimeLimit ist unbestaetigt, deshalb
    // setzt server.js zusaetzlich den harten Max-Dauer-Timer (Absolute Regel). Das
    // Feld wird trotzdem mitgegeben (schadet nicht, greift falls unterstuetzt).
    if (timeLimit) form.set("TimeLimit", String(timeLimit));
    const res = await fetch(
      `${config.telnyxApiBase}${TEXML_BASE}/calls/${config.telnyxConnectionId}`,
      {
        method: "POST",
        headers: headers(),
        body: form,
      },
    );
    await assertTelnyxOk(res, "originateCall", ATTACH_STATUS);
    // Twilio-kompatible Call-Resource. Telnyx-v2 wrappt manche Antworten in {data};
    // beide Formen abdecken. sid = CallSid (Fallback call_sid).
    const json = await res.json().catch(() => ({}));
    const data = json.data || json;
    return { sid: data.sid || data.call_sid };
  },

  // Laufenden Call beenden (Twilio-kompatibel: Status=completed). Braucht den
  // account_sid (config.telnyxAccountSid) zusaetzlich zum CallSid - account-weite
  // Konstante, daher aus config statt durch den Port-Vertrag gereicht (endCall
  // bekommt nur den CallSid, byte-identisch zum Twilio-Adapter).
  async endCall(callSid) {
    if (!config.telnyxApiKey) throw new Error("Telnyx endCall: TELNYX_API_KEY fehlt");
    if (!config.telnyxAccountSid) throw new Error("Telnyx endCall: TELNYX_ACCOUNT_SID fehlt");
    const res = await fetch(
      `${config.telnyxApiBase}${TEXML_BASE}/Accounts/${config.telnyxAccountSid}/Calls/${callSid}`,
      { method: "POST", headers: headers(), body: new URLSearchParams({ Status: "completed" }) },
    );
    await assertTelnyxOk(res, "endCall", ATTACH_STATUS);
  },
};
