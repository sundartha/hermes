import { test } from "node:test";
import assert from "node:assert/strict";

import { mitKurzerFrist, antwortetNie } from "../gemeinsam/kurze-antwortfrist.mjs";
import { fakeBilling, withFetch } from "../helpers.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  findNumber,
  setTenantStripe,
} from "../../src/store/state-ops.js";
import { NUMBER_STATUS } from "../../src/store/defaults.js";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-gekauft-id-offen";

const { numberProvisioning } = await import("../../src/telephony/registry.js");
const { provisionNumber } = await import("../../src/onboarding.js");
const { handleProvisionJob } = await import("../../src/worker/provisioning.js");
const { requestNumberForPaidTenant } = await import("../../src/billing/provision-trigger.js");

const E164 = "+12025550100";
const HTTP_OK = 200;
const HTTP_SERVER_FEHLER = 500;
const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "US", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };

function antwort(status, body) {
  return Promise.resolve({
    ok: status < 400,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function telnyxMitBestellung(bestellung) {
  const bestellungen = [];
  const fetchImpl = (url, init = {}) => {
    const pfad = String(url);
    if (pfad.includes("/v2/available_phone_numbers")) return antwort(HTTP_OK, { data: [{ phone_number: E164 }] });
    if (pfad.includes("/v2/number_orders")) {
      bestellungen.push(init.method);
      return bestellung();
    }
    return antwortetNie(url, init);
  };
  return { fetchImpl, bestellungen };
}

function bestellungOk() {
  return antwort(HTTP_OK, { data: { phone_numbers: [{ phone_number: E164 }] } });
}

function bestellungAbgelehnt() {
  return antwort(HTTP_SERVER_FEHLER, { errors: [{ code: "x", title: "kaputt" }] });
}

function seedRequested() {
  const state = makeDefaultState();
  registerTenant(state, "t_user1");
  setTenantStripe(state, "t_user1", { customerId: "cus_1", paymentMethodId: "pm_1", paymentMethodType: "card" });
  const { number } = requestNumber(state, { tenantId: "t_user1", ...CAPS });
  return { state, numberId: number.id };
}

async function provisioniere(telnyx, { state, numberId }, billing) {
  const logs = [];
  const logger = { log: () => {}, warn: (msg) => logs.push(msg) };
  let fehler;
  await mitKurzerFrist(() =>
    withFetch(telnyx.fetchImpl, async () => {
      try {
        await provisionNumber(state, { provisioner: numberProvisioning(), billing, logger }, { numberId, ...ARGS });
      } catch (err) {
        fehler = err;
      }
    }),
  );
  return { fehler, logs };
}

test("orderNumber: Kauf ok, Nummern-ID nicht aufloesbar -> NummerGekauftIdOffen mit e164, genau ein Kauf", async () => {
  const telnyx = telnyxMitBestellung(bestellungOk);
  let fehler;
  await mitKurzerFrist(() =>
    withFetch(telnyx.fetchImpl, async () => {
      fehler = await numberProvisioning()
        .orderNumber({ e164: E164, idempotencyKey: "order_x" })
        .catch((err) => err);
    }),
  );
  assert.equal(fehler.name, "NummerGekauftIdOffen");
  assert.equal(fehler.e164, E164);
  assert.match(fehler.message, /Nummer gekauft, Nummern-ID offen/);
  assert.equal(fehler.cause.name, "TimeoutError");
  assert.equal(telnyx.bestellungen.length, 1);
  assert.ok(!String(fehler.message).includes("KEYtest-gekauft-id-offen"));
});

test("provisionNumber: gekauft, ID offen -> Status provisioning, Hold bleibt, sichtbarer Fehler mit Nummer-ID und e164", async () => {
  const seed = seedRequested();
  const billing = fakeBilling();
  const telnyx = telnyxMitBestellung(bestellungOk);
  const { fehler, logs } = await provisioniere(telnyx, seed, billing);

  assert.equal(fehler.name, "NummerGekauftIdOffen");
  assert.equal(findNumber(seed.state, seed.numberId).status, NUMBER_STATUS.PROVISIONING);
  assert.ok(!billing.log.some((eintrag) => eintrag[0] === "cancelHold"));
  assert.ok(logs.some((zeile) => zeile.includes(seed.numberId) && zeile.includes(E164) && zeile.includes("Hold bleibt")));
  assert.ok(!logs.some((zeile) => zeile.includes("KEYtest-gekauft-id-offen")));
});

test("zweiter Antrag desselben Mandanten und erneuter Auftrag loesen keinen zweiten Kauf aus", async () => {
  const seed = seedRequested();
  const telnyx = telnyxMitBestellung(bestellungOk);
  await provisioniere(telnyx, seed, fakeBilling());

  const zweiter = requestNumberForPaidTenant(seed.state, { tenantId: "t_user1", ...CAPS });
  assert.deepEqual(zweiter, { ok: false, reason: "already_provisioned" });

  const ergebnis = await handleProvisionJob(
    seed.state,
    { payload: { numberId: seed.numberId } },
    { provisioner: numberProvisioning() },
    ARGS,
  );
  assert.deepEqual(ergebnis, { skipped: true, status: NUMBER_STATUS.PROVISIONING });
  assert.equal(telnyx.bestellungen.length, 1);
});

test("provisionNumber: abgelehnter Kauf bleibt ein Kauffehler -> failed, Hold freigegeben", async () => {
  const seed = seedRequested();
  const billing = fakeBilling();
  const telnyx = telnyxMitBestellung(bestellungAbgelehnt);
  const { fehler } = await provisioniere(telnyx, seed, billing);

  assert.notEqual(fehler.name, "NummerGekauftIdOffen");
  assert.match(fehler.message, /500/, fehler.message);
  assert.equal(findNumber(seed.state, seed.numberId).status, NUMBER_STATUS.FAILED);
  assert.ok(billing.log.some((eintrag) => eintrag[0] === "cancelHold"));
});
