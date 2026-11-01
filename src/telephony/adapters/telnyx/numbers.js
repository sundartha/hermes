import { assertTelnyxOk } from "./errors.js";
import { parseDecimalToMicroCents } from "./cost-parse.js";
import { telnyxAuthHeaders as authHeaders, telnyxUrl as url } from "./http.js";

const AVAILABLE_PATH = "/v2/available_phone_numbers";
const ORDERS_PATH = "/v2/number_orders";
const NUMBERS_PATH = "/v2/phone_numbers";
const DEFAULT_SEARCH_LIMIT = 1;
const INCLUDE_TELNYX_DETAIL = { includeDetail: true };

const RESOURCE_POLL_ATTEMPTS = 8;
const RESOURCE_POLL_INTERVAL_MS = 1000;
const NUMMERN_LESEN_FRIST_MS = 10_000;
const NUMMER_FREIGEBEN_FRIST_MS = 15_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveNumberId(e164) {
  for (let attempt = 0; attempt < RESOURCE_POLL_ATTEMPTS; attempt++) {
    const query = new URLSearchParams();
    query.set("filter[phone_number]", e164);
    const res = await fetch(`${url(NUMBERS_PATH)}?${query}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(NUMMERN_LESEN_FRIST_MS),
    });
    await assertTelnyxOk(res, "resolveNumberId", INCLUDE_TELNYX_DETAIL);
    const json = await res.json().catch(() => ({}));
    const data = json.data || [];
    const id = (data.find((d) => d.phone_number === e164) || data[0] || {}).id;
    if (id) return id;
    if (attempt < RESOURCE_POLL_ATTEMPTS - 1) await sleep(RESOURCE_POLL_INTERVAL_MS);
  }
  throw new Error("Telnyx orderNumber: phone_number-Ressource nicht aufloesbar (Order async pending)");
}

function providerPriceOf(costInformation) {
  if (!costInformation) return null;
  const currency = String(costInformation.currency || "").trim().toUpperCase();
  const upfrontMicroCents = parseDecimalToMicroCents(costInformation.upfront_cost);
  const monthlyMicroCents = parseDecimalToMicroCents(costInformation.monthly_cost);
  if (!currency || upfrontMicroCents === null || monthlyMicroCents === null) return null;
  return { upfrontMicroCents, monthlyMicroCents, currency };
}

export const telnyxNumberProvisioning = {
  async searchNumbers({ countryCode, type, limit = DEFAULT_SEARCH_LIMIT }) {
    const query = new URLSearchParams();
    query.set("filter[country_code]", countryCode);
    query.append("filter[features][]", "voice");
    query.set("filter[limit]", String(limit));
    if (type) query.set("filter[phone_number_type]", type);
    const res = await fetch(`${url(AVAILABLE_PATH)}?${query}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(NUMMERN_LESEN_FRIST_MS),
    });
    await assertTelnyxOk(res, "searchNumbers", INCLUDE_TELNYX_DETAIL);
    const json = await res.json().catch(() => ({}));
    return (json.data || []).map((d) => {
      const available = { e164: d.phone_number };
      const price = providerPriceOf(d.cost_information);
      if (price) available.price = price;
      return available;
    });
  },

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
      signal: AbortSignal.timeout(NUMMER_FREIGEBEN_FRIST_MS),
    });
    await assertTelnyxOk(res, "releaseNumber", { ...INCLUDE_TELNYX_DETAIL, attachStatus: true });
  },
};
