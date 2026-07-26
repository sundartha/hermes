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

// response: statisches Antwort-Objekt ODER ein per-URL-Responder (url, opts) => Antwort.
// orderNumber macht jetzt ZWEI Calls (POST order + GET resolve), deshalb der Responder.
function stubFetch(response) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    const r = typeof response === "function" ? response(url, opts) : response;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json ?? {},
      // assertOk liest im Fehlerfall res.text() (single-use Stream). Ohne explizites
      // text faellt der Stub auf den JSON-Body zurueck -> Bestandstests unveraendert.
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
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

// Routet POST /v2/number_orders -> Order-Sub-Resource (id ord_sub_1, vom Adapter ignoriert);
// jeden anderen (GET /v2/phone_numbers?filter...) -> die phone_number-Ressource (id num_abc,
// = das providerNumberId, das release/voice brauchen). Eine Quelle fuer beide orderNumber-Tests.
const orderResponder = (url) =>
  url.includes("/v2/number_orders")
    ? { json: { data: { phone_numbers: [{ id: "ord_sub_1", phone_number: "+4915112340001" }] } } }
    : { json: { data: [{ id: "num_abc", phone_number: "+4915112340001" }] } };

// DID-08 (Buchhaltung, 06-nummern-provisioning.md): die Haelfte "der Order-Body traegt
// KEIN Regulatory-/Bundle-Feld" ist woertlich die deepEqual-Assertion dieses Tests -
// kein zweiter Test (G5). Die zweite Haelfte (Fehlerpfad ohne Differenzierung) steht
// als eigener 422-Block weiter unten.
test("orderNumber: connection_id im Order-Body + Idempotency-Key -> {e164, providerNumberId via resolve}", async () => {
  const calls = stubFetch(orderResponder);
  const res = await prov.orderNumber({
    e164: "+4915112340001",
    connectionId: "conn_1",
    idempotencyKey: "order_x",
  });
  // providerNumberId kommt aus dem resolve-GET (num_abc), NICHT aus der Order-Antwort (ord_sub_1).
  assert.deepEqual(res, { e164: "+4915112340001", providerNumberId: "num_abc" });
  // POST: connection_id im Body (Voice-Routing in EINEM Schritt) + Idempotency-Key-Header.
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${API_BASE}/v2/number_orders`);
  assert.equal(calls[0].headers["Idempotency-Key"], "order_x");
  assert.deepEqual(JSON.parse(calls[0].body), {
    phone_numbers: [{ phone_number: "+4915112340001" }],
    connection_id: "conn_1",
  });
  // resolve: GET /v2/phone_numbers?filter[phone_number]=...
  assert.equal(calls[1].method, "GET");
  assert.ok(calls[1].url.startsWith(`${API_BASE}/v2/phone_numbers?`));
  assert.match(decodeURIComponent(calls[1].url), /filter\[phone_number\]=\+4915112340001/);
});

test("orderNumber ohne connectionId: KEIN connection_id im Order-Body", async () => {
  const calls = stubFetch(orderResponder);
  const res = await prov.orderNumber({ e164: "+4915112340001", idempotencyKey: "order_x" });
  assert.equal(res.providerNumberId, "num_abc");
  // Grenzfall (G3/T5): ohne connectionId bleibt der Body schlank (nur phone_numbers).
  assert.deepEqual(JSON.parse(calls[0].body), {
    phone_numbers: [{ phone_number: "+4915112340001" }],
  });
});

test("releaseNumber: DELETE /v2/phone_numbers/{id}", async () => {
  const calls = stubFetch({ json: {} });
  await prov.releaseNumber("num_abc");
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url, `${API_BASE}/v2/phone_numbers/num_abc`);
});

// tenant-prolif-d release-reconcile unterscheidet 404 (Nummer bei Telnyx bereits weg ->
// Konvergenz/Erfolg) von echten Fehlern NUR ueber err.providerStatus. Ohne diesen Test
// kann ein kaputter attachStatus-Spread in numbers.js unbemerkt bleiben (siehe
// release-reconcile.js providerReleaseOrGone) - Kunden-DID-Verlust-Risiko bei falscher
// Klassifikation.
test("releaseNumber 404: err.providerStatus=404 (Reconciler wertet als Konvergenz)", async () => {
  stubFetch({ ok: false, status: 404 });
  await assert.rejects(
    () => prov.releaseNumber("num_abc"),
    (err) => {
      assert.equal(err.providerStatus, 404);
      assert.match(err.message, /HTTP 404/);
      return true;
    },
  );
});

test("releaseNumber 500: err.providerStatus=500 (Reconciler wertet als echten Fehler, Retry)", async () => {
  stubFetch({ ok: false, status: 500 });
  await assert.rejects(
    () => prov.releaseNumber("num_abc"),
    (err) => {
      assert.equal(err.providerStatus, 500);
      assert.match(err.message, /HTTP 500/);
      return true;
    },
  );
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
  const saved = config.telephony.telnyxApiKey;
  config.telephony.telnyxApiKey = "";
  try {
    await assert.rejects(() => prov.searchNumbers({ countryCode: "DE" }), /TELNYX_API_KEY fehlt/);
    await assert.rejects(() => prov.orderNumber({ e164: "+49" }), /TELNYX_API_KEY fehlt/);
    await assert.rejects(() => prov.releaseNumber("x"), /TELNYX_API_KEY fehlt/);
  } finally {
    config.telephony.telnyxApiKey = saved;
  }
});

test("registry.numberProvisioning: telnyx -> Adapter, unbekannt -> wirft (fail-closed)", () => {
  assert.equal(numberProvisioning(PROVIDER.TELNYX), prov);
  assert.equal(numberProvisioning(), prov, "Default telnyx");
  assert.throws(() => numberProvisioning(PROVIDER.TWILIO), /nicht unterstuetzt/);
});

const PAYMENT_402_BODY = JSON.stringify({
  errors: [{ code: "10015", title: "Payment required", detail: "Account balance too low" }],
});

test("orderNumber 402: Telnyx errors[].code/title/detail landen in der Meldung (Diagnose)", async () => {
  stubFetch({ ok: false, status: 402, text: PAYMENT_402_BODY });
  await assert.rejects(
    () => prov.orderNumber({ e164: "+4915112340001", connectionId: "conn_1" }),
    (err) => {
      assert.match(err.message, /HTTP 402/);
      assert.match(err.message, /10015/);
      assert.match(err.message, /Payment required/);
      assert.match(err.message, /Account balance too low/);
      return true;
    },
  );
});

test("orderNumber 402: weder API-Key noch Telefonnummer (PII) in der Meldung (Regel 4)", async () => {
  stubFetch({ ok: false, status: 402, text: PAYMENT_402_BODY });
  await assert.rejects(
    () => prov.orderNumber({ e164: "+4915112340001", connectionId: "conn_1" }),
    (err) => {
      assert.ok(!err.message.includes(API_KEY), "API-Key darf nicht leaken");
      assert.ok(!err.message.includes("+4915112340001"), "Telefonnummer (PII) darf nicht leaken");
      return true;
    },
  );
});

test("orderNumber 402 mit kaputtem/leerem Body: Fallback auf status-only, throw bleibt", async () => {
  stubFetch({ ok: false, status: 402, text: "<html>upstream error</html>" });
  await assert.rejects(
    () => prov.orderNumber({ e164: "+4915112340001" }),
    (err) => {
      assert.match(err.message, /Telnyx orderNumber fehlgeschlagen: HTTP 402/);
      assert.ok(!err.message.includes("("), "kein Detail-Block bei unparsbarem Body");
      assert.ok(!err.message.includes("upstream error"), "kein Rohtext-Dump (Leak-Schutz)");
      return true;
    },
  );
  stubFetch({ ok: false, status: 402, text: "" });
  await assert.rejects(
    () => prov.orderNumber({ e164: "+4915112340001" }),
    /Telnyx orderNumber fehlgeschlagen: HTTP 402$/,
  );
});

const REGULATORY_422_BODY = JSON.stringify({
  errors: [{ code: "10009", title: "Regulatory requirements not met" }],
});

// DID-08: eine Regulatory-Ablehnung (der reale Grund, warum ein US-/GB-Kauf scheitert)
// ist beim Kauf NICHT strukturiert unterscheidbar: orderNumber ruft assertTelnyxOk OHNE
// attachStatus (anders als releaseNumber, das den 404-Konvergenzfall braucht). Ein
// Aufrufer kann "Papierkram fehlt" nicht von "Provider kaputt" trennen, ohne den
// Meldungstext zu regexen - und der Text ist kein Vertrag.
test("DID-08 (Charakterisierung, gruen) - eine 422-Regulatory-Ablehnung traegt keinen providerStatus", async () => {
  stubFetch({ ok: false, status: 422, text: REGULATORY_422_BODY });
  await assert.rejects(
    () => prov.orderNumber({ e164: "+12025550123", connectionId: "conn_1" }),
    (err) => {
      assert.match(err.message, /HTTP 422/);
      assert.equal(err.providerStatus, undefined, "kein strukturierter Status am Kauf-Fehler");
      assert.equal(err.providerCode, "10009", "nur der rohe Telnyx-Code ist maschinenlesbar");
      return true;
    },
  );
});

// DID-09, Gegenprobe: die Luecke liegt in der TABELLE, nicht im Adapter - gibt jemand
// einen type mit, reicht der Adapter ihn korrekt durch.
test("DID-09 (Mechanismus, gruen) - searchNumbers setzt filter[phone_number_type] genau dann, wenn ein type kommt", async () => {
  const mitTyp = stubFetch({ json: { data: [] } });
  await prov.searchNumbers({ countryCode: "US", type: "local" });
  assert.match(decodeURIComponent(mitTyp[0].url), /filter\[phone_number_type\]=local/);

  const ohneTyp = stubFetch({ json: { data: [] } });
  await prov.searchNumbers({ countryCode: "US" });
  assert.doesNotMatch(decodeURIComponent(ohneTyp[0].url), /filter\[phone_number_type\]/);
});
