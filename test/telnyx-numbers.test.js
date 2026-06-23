// Telnyx-NumberProvisioning-Adapter (search/order/configure/release). Rein offline:
// global.fetch gestubbt. Telnyx-Config VOR dem Import gesetzt (dotenv ueberschreibt
// gesetzte Vars nicht) -> echte .env beeinflusst den Test nicht (Key-Leak-Schutz).
// Kein pglite/Server hier (eigene Datei).
import { test } from "node:test";
import assert from "node:assert/strict";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;

const { telnyxNumberProvisioning: prov } =
  await import("../src/telephony/adapters/telnyx/numbers.js");
const { numberProvisioning } = await import("../src/telephony/registry.js");
const { PROVIDER } = await import("../src/store/defaults.js");
const { config } = await import("../src/config.js");

function stubFetch(response) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
    };
  };
  return calls;
}

test("searchNumbers: GET available_phone_numbers mit country/voice-Filter -> e164-Liste", async () => {
  const calls = stubFetch({
    json: { data: [{ phone_number: "+4915112340001" }, { phone_number: "+4915112340002" }] },
  });
  const res = await prov.searchNumbers({ countryCode: "DE", limit: 2 });
  assert.deepEqual(res, [{ e164: "+4915112340001" }, { e164: "+4915112340002" }]);
  assert.equal(calls[0].method, "GET");
  assert.ok(calls[0].url.startsWith(`${API_BASE}/v2/available_phone_numbers?`));
  assert.match(decodeURIComponent(calls[0].url), /filter\[country_code\]=DE/);
  assert.match(decodeURIComponent(calls[0].url), /filter\[features\]\[\]=voice/);
  assert.equal(calls[0].headers.Authorization, `Bearer ${API_KEY}`);
});

test("orderNumber: POST number_orders mit Idempotency-Key -> {e164, providerNumberId}", async () => {
  const calls = stubFetch({
    json: { data: { phone_numbers: [{ id: "num_abc", phone_number: "+4915112340001" }] } },
  });
  const res = await prov.orderNumber({ e164: "+4915112340001", idempotencyKey: "order_x" });
  assert.deepEqual(res, { e164: "+4915112340001", providerNumberId: "num_abc" });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${API_BASE}/v2/number_orders`);
  assert.equal(calls[0].headers["Idempotency-Key"], "order_x");
  assert.deepEqual(JSON.parse(calls[0].body), {
    phone_numbers: [{ phone_number: "+4915112340001" }],
  });
});

test("configureNumber: PATCH /v2/phone_numbers/{id}/voice mit connection_id", async () => {
  const calls = stubFetch({ json: {} });
  await prov.configureNumber({ providerNumberId: "num_abc", connectionId: "conn_1" });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url, `${API_BASE}/v2/phone_numbers/num_abc/voice`);
  assert.deepEqual(JSON.parse(calls[0].body), { connection_id: "conn_1" });
});

test("releaseNumber: DELETE /v2/phone_numbers/{id}", async () => {
  const calls = stubFetch({ json: {} });
  await prov.releaseNumber("num_abc");
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url, `${API_BASE}/v2/phone_numbers/num_abc`);
});

test("orderNumber: HTTP-Fehler wirft MIT Status, OHNE API-Key (Regel 4)", async () => {
  stubFetch({ ok: false, status: 402 });
  await assert.rejects(
    () => prov.orderNumber({ e164: "+4915112340001" }),
    (err) => {
      assert.match(err.message, /HTTP 402/);
      assert.ok(!err.message.includes(API_KEY));
      return true;
    },
  );
});

test("fail-closed: ohne TELNYX_API_KEY wirft jede Methode (kein Live-Call)", async () => {
  stubFetch({ json: { data: [] } });
  const saved = config.telnyxApiKey;
  config.telnyxApiKey = "";
  try {
    await assert.rejects(() => prov.searchNumbers({ countryCode: "DE" }), /TELNYX_API_KEY fehlt/);
    await assert.rejects(() => prov.orderNumber({ e164: "+49" }), /TELNYX_API_KEY fehlt/);
    await assert.rejects(() => prov.releaseNumber("x"), /TELNYX_API_KEY fehlt/);
  } finally {
    config.telnyxApiKey = saved;
  }
});

test("registry.numberProvisioning: telnyx -> Adapter, unbekannt -> wirft (fail-closed)", () => {
  assert.equal(numberProvisioning(PROVIDER.TELNYX), prov);
  assert.equal(numberProvisioning(), prov, "Default telnyx");
  assert.throws(() => numberProvisioning(PROVIDER.TWILIO), /nicht unterstuetzt/);
});
