// OUTBOUND-E4 (E-6/F4): der rein LESENDE Telnyx-Read-Port des Drift-Waechters. Sechs GETs,
// Datei auf eine schreibende HTTP-Verb-Angabe). Teilt sich authHeaders/url/telnyxJson mit
// numbers.js (http.js, G5) statt eines zweiten Telnyx-Clients (Plan E-6, ausdruecklich
// verworfen: "src/telephony/outbound-config-reader.js entfaellt ersatzlos").
//
// Jede Methode projiziert die rohe Telnyx-Antwort SOFORT auf unser eigenes Vokabular -
// der Aufrufer (outbound-config-probe.js) sieht nie ein Telnyx-Feld direkt. Fehler wirft
// assertTelnyxOk MIT providerStatus (ohne includeDetail: kein Nummern-Echo im Log,
// Plan 4.4) - die Klassifizierung in einen unknown-Grund (http_404/http_429/...) passiert
// im Probe, nicht hier.
import { assertTelnyxOk } from "./errors.js";
import { telnyxAuthHeaders as authHeaders, telnyxUrl as url, telnyxJson } from "./http.js";

const NUMBERS_PATH = "/v2/phone_numbers";

async function getJson(path, op) {
  const res = await fetch(url(path), { headers: authHeaders() });
  await assertTelnyxOk(res, op);
  return telnyxJson(res);
}

/** @type {import("../../ports.js").ProviderConfigRead} */
export const telnyxConfigRead = {
  // Pruefung 3 (ANI-Kontoeigentum) UND Pruefung 9 (Alarm-Absender-Kontoeigentum) teilen
  // sich diese EINE Methode (dieselbe Frage: "gehoert diese E.164 dem Konto?").
  async findPhoneNumber(e164) {
    const query = new URLSearchParams();
    query.set("filter[phone_number]", e164);
    const json = await getJson(`${NUMBERS_PATH}?${query}`, "findPhoneNumber");
    const treffer = (json.data || []).map((eintrag) => ({ e164: eintrag.phone_number, status: eintrag.status }));
    return { treffer };
  },
};
