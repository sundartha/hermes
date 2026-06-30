// Telnyx-Adapter: NumberProvisioning (searchNumbers/orderNumber/releaseNumber)
// ueber die Telnyx-v2-REST-API. Loest ECHTES Geld aus (orderNumber)
// -> nur ueber die gegatete Onboarding-Route + config.maxNumbers-Notbremse erreichbar.
// Kein SDK: fetch + JSON (Bearer). API-Key NIE in Fehlermeldungen leaken (Regel 4).
//
// Verifiziert gegen die Telnyx-Doku (2026-06-15), live UNBESTAETIGT (mit dem Owner
// live fixen, falls Felder abweichen):
//   search:    GET  /v2/available_phone_numbers?filter[country_code]=..&filter[features][]=voice
//   order:     POST /v2/number_orders  {phone_numbers:[{phone_number}], connection_id}  (Idempotency-Key-Header)
//              -> connection_id im Order-Body setzt das Voice-Routing in EINEM Schritt
//                 (kein separater configure-PATCH; die Order ist async-pending).
//   resolve:   GET  /v2/phone_numbers?filter[phone_number]=<e164>  (poll bis Ressourcen-id da)
//   release:   DELETE /v2/phone_numbers/{id}
import { config } from "../../../config.js";

const AVAILABLE_PATH = "/v2/available_phone_numbers";
const ORDERS_PATH = "/v2/number_orders";
const NUMBERS_PATH = "/v2/phone_numbers";
const DEFAULT_SEARCH_LIMIT = 1;
// Max-Laenge je Telnyx-detail-Feld in der Fehlermeldung: begrenzt das Log-Volumen eines
// unerwartet grossen detail-Strings (kein Raw-Body-Dump). Interner Log-Hygiene-Bound, kein
// Operator-Tuning-Knopf -> modul-lokale Konstante wie die Poll-Konstanten, nicht config.js.
const ERROR_DETAIL_MAX_LEN = 200;

// Telnyx-number_orders ist async (status pending): die phone_number-Ressource erscheint
// erst Sekunden nach der Bestellung. Kurzer, gedeckelter Poll, bis die Ressource (mit id)
// sichtbar ist - DIESE id (nicht die Order-Sub-Resource-id) brauchen release/voice. Bleibt
// sie aus -> Fehler MIT Kontext (Order pending), OHNE Nummer (PII) oder API-Key (Regel 4) zu
// leaken; der Worker loggt den Throw -> Owner-Reconcile-Runbook.
const RESOURCE_POLL_ATTEMPTS = 8;
const RESOURCE_POLL_INTERVAL_MS = 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeaders(extra = {}) {
  if (!config.telnyxApiKey) throw new Error("Telnyx NumberProvisioning: TELNYX_API_KEY fehlt");
  return {
    Authorization: `Bearer ${config.telnyxApiKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// Liest den Telnyx-Fehler-Envelope NON-DESTRUKTIV (nur im !ok-Zweig; der Erfolgspfad liest
// weiter res.json()) und extrahiert STRIKT allowlisted code/title/detail. Raw-Body und
// unbekannte Felder werden NIE durchgereicht (Regel 4: kein Key-/PII-Dump); detail wird auf
// ERROR_DETAIL_MAX_LEN gekuerzt. Fehlt/kaputt der Body -> "" (assertOk faellt auf status-only
// zurueck, der throw passiert immer).
async function telnyxErrorDetail(res) {
  let raw;
  try {
    raw = await res.text();
  } catch {
    return "";
  }
  if (!raw) return "";
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return ""; // kein JSON -> kein Rohtext-Dump (Leak-Schutz)
  }
  const errors = Array.isArray(body && body.errors) ? body.errors : [];
  return errors
    .map((e) => {
      if (!e) return "";
      const head = [e.code != null ? String(e.code) : "", e.title].filter(Boolean).join(" ");
      const detail = e.detail ? String(e.detail).slice(0, ERROR_DETAIL_MAX_LEN) : "";
      return [head, detail].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ");
}

async function assertOk(res, op) {
  if (res.ok) return;
  const detail = await telnyxErrorDetail(res);
  throw new Error(`Telnyx ${op} fehlgeschlagen: HTTP ${res.status}${detail ? ` [${detail}]` : ""}`);
}

const url = (path) => config.telnyxApiBase + path;

// Loest die phone_number-Ressourcen-id (release/voice) per gedeckeltem Poll auf, da
// die Order async-pending ist (s.o.). Liefert die id oder wirft MIT Kontext (kein
// PII-/Key-Leak, Regel 4).
async function resolveNumberId(e164) {
  for (let attempt = 0; attempt < RESOURCE_POLL_ATTEMPTS; attempt++) {
    const q = new URLSearchParams();
    q.set("filter[phone_number]", e164);
    const res = await fetch(`${url(NUMBERS_PATH)}?${q}`, { headers: authHeaders() });
    await assertOk(res, "resolveNumberId");
    const json = await res.json().catch(() => ({}));
    const data = json.data || [];
    const id = (data.find((d) => d.phone_number === e164) || data[0] || {}).id;
    if (id) return id;
    if (attempt < RESOURCE_POLL_ATTEMPTS - 1) await sleep(RESOURCE_POLL_INTERVAL_MS);
  }
  throw new Error("Telnyx orderNumber: phone_number-Ressource nicht aufloesbar (Order async pending)");
}

/** @type {import("../../ports.js").NumberProvisioning} */
export const telnyxNumberProvisioning = {
  async searchNumbers({ countryCode, type, limit = DEFAULT_SEARCH_LIMIT }) {
    const q = new URLSearchParams();
    q.set("filter[country_code]", countryCode);
    q.append("filter[features][]", "voice");
    q.set("filter[limit]", String(limit));
    if (type) q.set("filter[phone_number_type]", type);
    const res = await fetch(`${url(AVAILABLE_PATH)}?${q}`, { headers: authHeaders() });
    await assertOk(res, "searchNumbers");
    const json = await res.json().catch(() => ({}));
    return (json.data || []).map((d) => ({ e164: d.phone_number }));
  },

  // connection_id wandert in den Order-Body (Voice-Routing in EINEM Schritt): Telnyx wendet
  // es auf alle Nummern der Order an -> kein separater configure-PATCH (der auf der async-
  // pending Order eine 404 warf). providerNumberId kommt NICHT aus der Order-Antwort (das ist
  // die Order-Sub-Resource-id), sondern aus resolveNumberId -> damit releaseNumber spaeter greift.
  // Idempotency-Key (number-id-basiert): Retry kauft nie doppelt (Telnyx-Header).
  async orderNumber({ e164, connectionId, idempotencyKey }) {
    const headers = authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
    const body = { phone_numbers: [{ phone_number: e164 }] };
    if (connectionId) body.connection_id = connectionId;
    const res = await fetch(url(ORDERS_PATH), { method: "POST", headers, body: JSON.stringify(body) });
    await assertOk(res, "orderNumber");
    const json = await res.json().catch(() => ({}));
    const orderedE164 = (json.data?.phone_numbers || [])[0]?.phone_number || e164;
    const providerNumberId = await resolveNumberId(orderedE164);
    return { e164: orderedE164, providerNumberId };
  },

  async releaseNumber(providerNumberId) {
    const res = await fetch(`${url(NUMBERS_PATH)}/${providerNumberId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    await assertOk(res, "releaseNumber");
  },
};
