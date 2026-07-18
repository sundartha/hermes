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
import { assertTelnyxOk } from "./errors.js";

const AVAILABLE_PATH = "/v2/available_phone_numbers";
const ORDERS_PATH = "/v2/number_orders";
const NUMBERS_PATH = "/v2/phone_numbers";
const DEFAULT_SEARCH_LIMIT = 1;
// Telnyx-detail im Fehler MIT loggen (402-Diagnose: "Account balance too low" steht im
// detail, nicht im title). Bewusst akzeptiertes, dokumentiertes Restrisiko: ein nicht-402-
// Fehler (z.B. 422 Validierung) kann die Telnyx-Inventarnummer ins Server-Log echoen
// (allowlisted Felder, auf 200 gekuerzt, kein Raw-Body/Key) -> PLAN-SECURITY.md.
const INCLUDE_TELNYX_DETAIL = { includeDetail: true };

// Telnyx-number_orders ist async (status pending): die phone_number-Ressource erscheint
// erst Sekunden nach der Bestellung. Kurzer, gedeckelter Poll, bis die Ressource (mit id)
// sichtbar ist - DIESE id (nicht die Order-Sub-Resource-id) brauchen release/voice. Bleibt
// sie aus -> Fehler MIT Kontext (Order pending), OHNE Nummer (PII) oder API-Key (Regel 4) zu
// leaken; der Worker loggt den Throw -> Owner-Reconcile-Runbook.
const RESOURCE_POLL_ATTEMPTS = 8;
const RESOURCE_POLL_INTERVAL_MS = 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeaders(extra = {}) {
  if (!config.telephony.telnyxApiKey)
    throw new Error("Telnyx NumberProvisioning: TELNYX_API_KEY fehlt");
  return {
    Authorization: `Bearer ${config.telephony.telnyxApiKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

const url = (path) => config.telephony.telnyxApiBase + path;

// Loest die phone_number-Ressourcen-id (release/voice) per gedeckeltem Poll auf, da
// die Order async-pending ist (s.o.). Liefert die id oder wirft MIT Kontext (kein
// PII-/Key-Leak, Regel 4).
async function resolveNumberId(e164) {
  for (let attempt = 0; attempt < RESOURCE_POLL_ATTEMPTS; attempt++) {
    const q = new URLSearchParams();
    q.set("filter[phone_number]", e164);
    const res = await fetch(`${url(NUMBERS_PATH)}?${q}`, { headers: authHeaders() });
    await assertTelnyxOk(res, "resolveNumberId", INCLUDE_TELNYX_DETAIL);
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
    await assertTelnyxOk(res, "searchNumbers", INCLUDE_TELNYX_DETAIL);
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
    await assertTelnyxOk(res, "orderNumber", INCLUDE_TELNYX_DETAIL);
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
    // attachStatus: der tenant-prolif-d-Release-Reconciler unterscheidet 404 (Nummer bei
    // Telnyx bereits weg -> als Erfolg werten, Idempotenz/Konvergenz) von echten Fehlern.
    // Additiv fuer die Onboarding-Rollback-Callsite (deren catch ignoriert providerStatus).
    await assertTelnyxOk(res, "releaseNumber", { ...INCLUDE_TELNYX_DETAIL, attachStatus: true });
  },
};
