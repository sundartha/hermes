// OUTBOUND-E4 (E-6/F4): der rein LESENDE Telnyx-Read-Port des Drift-Waechters. Sechs GETs,
// KEIN Schreibzugriff (Nur-Lese-Pin: test/outbound-drift-kern.test.js#K-14 grept diese
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
// EINE Geld-Parsing-Quelle (G5): derselbe strenge, string-basierte Parser wie
// numbers.js#providerPriceOf statt einer zweiten, eigenen Money-Konversion hier.
import { parseDecimalToMicroCents } from "./cost-parse.js";

const NUMBERS_PATH = "/v2/phone_numbers";
const VERIFIED_NUMBERS_PATH = "/v2/verified_numbers";
const FQDN_CONNECTIONS_PATH = "/v2/fqdn_connections/";
const FQDNS_PATH = "/v2/fqdns";
const OUTBOUND_VOICE_PROFILES_PATH = "/v2/outbound_voice_profiles/";
const BALANCE_PATH = "/v2/balance";

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

  // Pruefung 4 (Ausweichpfad): die LISTE, nie der Einzelabruf (der liefert bei leerer
  // Liste 404 - keine Positiv-Kontrolle, Plan E-6).
  async listVerifiedNumbers() {
    const json = await getJson(VERIFIED_NUMBERS_PATH, "listVerifiedNumbers");
    const e164s = (json.data || []).map((eintrag) => eintrag.phone_number).filter(Boolean);
    return { e164s };
  },

  // Pruefung 2.
  async getFqdnConnection(connectionId) {
    const json = await getJson(FQDN_CONNECTIONS_PATH + encodeURIComponent(connectionId), "getFqdnConnection");
    const daten = json.data || {};
    return { active: daten.active === true, aniOverride: daten.outbound?.ani_override || null };
  },

  // Pruefung 6. connection_id kommt aus telnyxJson() bereits praezisionssicher als String
  // (19-stellige IDs, s. http.js).
  async listFqdns() {
    const json = await getJson(FQDNS_PATH, "listFqdns");
    const connectionIds = (json.data || []).map((eintrag) => String(eintrag.connection_id));
    return { connectionIds };
  },

  // Pruefung 7.
  async getOutboundVoiceProfile(profileId) {
    const json = await getJson(OUTBOUND_VOICE_PROFILES_PATH + encodeURIComponent(profileId), "getOutboundVoiceProfile");
    const daten = json.data || {};
    return { enabled: daten.enabled === true, whitelistedDestinations: daten.whitelisted_destinations || [] };
  },

  // Pruefung 8. Nur der Kontostand - der 24h-Verbrauch ist keine Anbieter-Abfrage
  // (kommt aus dem Store, s. outbound-config-probe.js#holeBalance).
  async getBalance() {
    const json = await getJson(BALANCE_PATH, "getBalance");
    const daten = json.data || json;
    // Telnyx liefert available_credit als Dezimalstring der Konto-Waehrung (z.B.
    // "3.09"). Nicht parsebar -> null (der Kern behandelt das als unbekannt, NIE als
    // 0 Guthaben - eine still zu 0 gewordene Zahl saehe aus wie eine echte Messung).
    return { availableCreditMicroCents: parseDecimalToMicroCents(String(daten.available_credit ?? "")) };
  },
};
