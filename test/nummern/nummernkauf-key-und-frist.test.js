import { test } from "node:test";
import assert from "node:assert/strict";

import { mitKurzerFrist, antwortetNie } from "../gemeinsam/kurze-antwortfrist.mjs";
import { jsonSpeicherImDatenordner } from "../gemeinsam/json-speicher-im-datenordner.js";
import { fakeBilling, withFetch } from "../helpers.js";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-kauf-key-frist";

const { numberProvisioning } = await import("../../src/telephony/registry.js");
const { handleProvisionJob } = await import("../../src/worker/provisioning.js");
const { speicher } = await jsonSpeicherImDatenordner("kauf-key-frist-");
const { NUMBER_STATUS } = speicher;

const E164 = "+12025550100";
const HTTP_OK = 200;
const KAUF_FRIST_MS = 30_000;
const ARGS = { countryCode: "US", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };

function antwort(body) {
  return Promise.resolve({ ok: true, status: HTTP_OK, headers: new Headers(), json: async () => body, text: async () => "" });
}

function telnyxKaufHaengt() {
  const bestellungen = [];
  const fetchImpl = (url, init = {}) => {
    const pfad = String(url);
    if (pfad.includes("/v2/available_phone_numbers")) return antwort({ data: [{ phone_number: E164 }] });
    if (pfad.includes("/v2/number_orders")) {
      bestellungen.push(init);
      return antwortetNie(url, init);
    }
    return antwort({ data: [{ id: "pn_1", phone_number: E164 }] });
  };
  return { fetchImpl, bestellungen };
}

test("orderNumber ohne idempotencyKey wirft vor jeder HTTP-Anfrage", async () => {
  const anfragen = [];
  await withFetch(
    (url) => {
      anfragen.push(String(url));
      return antwort({});
    },
    async () => {
      await assert.rejects(numberProvisioning().orderNumber({ e164: E164 }), /idempotencyKey/);
      await assert.rejects(numberProvisioning().orderNumber({ e164: E164, idempotencyKey: "" }), /idempotencyKey/);
    },
  );
  assert.deepEqual(anfragen, []);
});

test("Kauf ohne Antwort: Frist 30 s, Idempotency-Key im Request, Ausgang unbekannt -> NummerGekauftIdOffen, ein Kauf", async () => {
  const telnyx = telnyxKaufHaengt();
  let fehler;
  const fristen = await mitKurzerFrist(() =>
    withFetch(telnyx.fetchImpl, async () => {
      fehler = await numberProvisioning()
        .orderNumber({ e164: E164, idempotencyKey: "order_num_7" })
        .catch((err) => err);
    }),
  );
  assert.deepEqual(fristen, [KAUF_FRIST_MS]);
  assert.equal(fehler.name, "NummerGekauftIdOffen");
  assert.equal(fehler.e164, E164);
  assert.equal(fehler.cause.name, "TimeoutError");
  assert.equal(telnyx.bestellungen.length, 1);
  const [bestellung] = telnyx.bestellungen;
  assert.equal(bestellung.method, "POST");
  assert.equal(bestellung.headers["Idempotency-Key"], "order_num_7");
});

test("Auftrag: Kauf ohne Antwort -> Status provisioning, Hold bleibt, kein zweiter Kauf beim erneuten Auftrag", async () => {
  const state = speicher.load();
  state.tenants.push({ id: "t_user1", status: "active" });
  speicher.setTenantStripe("t_user1", { customerId: "cus_1", paymentMethodId: "pm_1", paymentMethodType: "card" });
  state.numbers.push({
    id: "num_kauf",
    e164: null,
    tenantId: "t_user1",
    provider: "telnyx",
    country: "US",
    language: "en",
    status: NUMBER_STATUS.REQUESTED,
    providerNumberId: null,
    paymentIntentId: null,
  });
  const billing = fakeBilling();
  const telnyx = telnyxKaufHaengt();
  const logger = { log: () => {}, warn: () => {} };
  const deps = { provisioner: numberProvisioning(), billing, logger };
  const job = { payload: { numberId: "num_kauf" } };
  let fehler;
  await mitKurzerFrist(() =>
    withFetch(telnyx.fetchImpl, async () => {
      fehler = await handleProvisionJob(state, job, deps, ARGS).catch((err) => err);
      await handleProvisionJob(state, job, deps, ARGS);
    }),
  );
  assert.equal(fehler.name, "NummerGekauftIdOffen");
  assert.equal(state.numbers.find((n) => n.id === "num_kauf").status, NUMBER_STATUS.PROVISIONING);
  assert.ok(!billing.log.some((eintrag) => eintrag[0] === "cancelHold"));
  assert.equal(telnyx.bestellungen.length, 1);
  const [bestellung] = telnyx.bestellungen;
  assert.equal(bestellung.headers["Idempotency-Key"], "order_num_kauf");
});
