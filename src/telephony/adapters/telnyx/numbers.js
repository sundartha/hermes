// Telnyx-Adapter: NumberProvisioning (searchNumbers/orderNumber/configureNumber/
// releaseNumber) ueber die Telnyx-v2-REST-API. Loest ECHTES Geld aus (orderNumber)
// -> nur ueber die gegatete Onboarding-Route + config.maxNumbers-Notbremse erreichbar.
// Kein SDK: fetch + JSON (Bearer). API-Key NIE in Fehlermeldungen leaken (Regel 4).
//
// Verifiziert gegen die Telnyx-Doku (2026-06-15), live UNBESTAETIGT (mit dem Owner
// live fixen, falls Felder abweichen):
//   search:    GET  /v2/available_phone_numbers?filter[country_code]=..&filter[features][]=voice
//   order:     POST /v2/number_orders  {phone_numbers:[{phone_number}]}  (Idempotency-Key-Header)
//   configure: PATCH /v2/phone_numbers/{id}/voice  {connection_id}
//   release:   DELETE /v2/phone_numbers/{id}
import { config } from "../../../config.js";

const AVAILABLE_PATH = "/v2/available_phone_numbers";
const ORDERS_PATH = "/v2/number_orders";
const NUMBERS_PATH = "/v2/phone_numbers";
const DEFAULT_SEARCH_LIMIT = 1;

function authHeaders(extra = {}) {
  if (!config.telnyxApiKey) throw new Error("Telnyx NumberProvisioning: TELNYX_API_KEY fehlt");
  return { Authorization: `Bearer ${config.telnyxApiKey}`, "Content-Type": "application/json", ...extra };
}

function assertOk(res, op) {
  if (!res.ok) throw new Error(`Telnyx ${op} fehlgeschlagen: HTTP ${res.status}`);
}

const url = (path) => config.telnyxApiBase + path;

/** @type {import("../../ports.js").NumberProvisioning} */
export const telnyxNumberProvisioning = {
  async searchNumbers({ countryCode, type, limit = DEFAULT_SEARCH_LIMIT }) {
    const q = new URLSearchParams();
    q.set("filter[country_code]", countryCode);
    q.append("filter[features][]", "voice");
    q.set("filter[limit]", String(limit));
    if (type) q.set("filter[phone_number_type]", type);
    const res = await fetch(`${url(AVAILABLE_PATH)}?${q}`, { headers: authHeaders() });
    assertOk(res, "searchNumbers");
    const json = await res.json().catch(() => ({}));
    return (json.data || []).map((d) => ({ e164: d.phone_number }));
  },

  async orderNumber({ e164, idempotencyKey }) {
    // Idempotency-Key (number-id-basiert): Retry kauft nie doppelt (Telnyx-Header).
    const headers = authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
    const res = await fetch(url(ORDERS_PATH), {
      method: "POST",
      headers,
      body: JSON.stringify({ phone_numbers: [{ phone_number: e164 }] }),
    });
    assertOk(res, "orderNumber");
    const json = await res.json().catch(() => ({}));
    const ordered = (json.data?.phone_numbers || [])[0] || {};
    return { e164: ordered.phone_number || e164, providerNumberId: ordered.id || null };
  },

  async configureNumber({ providerNumberId, connectionId }) {
    const res = await fetch(`${url(NUMBERS_PATH)}/${providerNumberId}/voice`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ connection_id: connectionId }),
    });
    assertOk(res, "configureNumber");
  },

  async releaseNumber(providerNumberId) {
    const res = await fetch(`${url(NUMBERS_PATH)}/${providerNumberId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assertOk(res, "releaseNumber");
  },
};
