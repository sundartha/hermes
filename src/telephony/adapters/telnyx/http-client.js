// AL-P2b-Fix1 (S2-1): EIN geteilter Telnyx-HTTP-Baustein fuer die Betriebs-/Mess-Skripte
// (scripts/al-p2-spike-driver.mjs, scripts/telnyx-call-latency.mjs,
// scripts/telnyx-assistant-provision.mjs). Vor diesem Fix bauten alle drei Skripte
// unabhaengig voneinander denselben Bearer-Header + fetch + assertTelnyxOk +
// {data}-Envelope-Unwrap nach (G5-Verstoss, dritte Kopie desselben Musters). Kein
// Verhaltensunterschied zu den drei Vorlagen: der GET-only-Fall (kein body, path statt
// url) ist eine Teilmenge von method+path/url+body - siehe Review-Fund S2-1.
//
// Bewusst NICHT src/telephony/adapters/telnyx/voice.js/numbers.js angefasst: die
// Produktions-Adapter senden teils Form-encoded Bodies (FORM_HEADERS_TYPE) und liegen
// ausserhalb des hier behobenen Fundes - Scope bleibt die drei Skripte.
import { config } from "../../../config.js";
import { assertTelnyxOk } from "./errors.js";

// Bearer-Header + Content-Type. EINE Stelle (G5) statt drei Kopien in den Skripten.
export function telnyxHeaders() {
  return {
    Authorization: `Bearer ${config.telephony.telnyxApiKey}`,
    "Content-Type": "application/json",
  };
}

// EINE Fetch-/Fehlerstelle (G5) fuer alle drei Skripte: assertTelnyxOk als einziger
// Fehler-Parser, {data}-Envelope-Unwrap. `path` wird gegen telnyxApiBase aufgeloest,
// `url` (falls gesetzt) unveraendert verwendet - scripts/telnyx-assistant-provision.mjs
// braucht beim Update eine ID-tragende URL, die anderen beiden nur einen Pfad. `op`
// bleibt Aufrufer-Sache (Fehlermeldungen wie "fetchAssistant"/"spikeDriver GET ..." sind
// je Skript aussagekraeftig benannt, kein generisches Label).
export async function telnyxRequest({ method = "GET", path, url, body, op }) {
  const target = url ?? `${config.telephony.telnyxApiBase}${path}`;
  const res = await fetch(target, {
    method,
    headers: telnyxHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await assertTelnyxOk(res, op, { attachStatus: true });
  const json = await res.json().catch(() => ({}));
  return json.data ?? json;
}
