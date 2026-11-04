import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionNumber } from "../src/onboarding.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  findNumber,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1" };

function seedRequested() {
  const s = makeDefaultState();
  registerTenant(s, "t_user1");
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  return { s, numberId: number.id };
}

test("happy path: search -> order -> active mit e164 + providerNumberId (kein configure)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const result = await provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.equal(result.e164, "+4915799990001");
  assert.equal(result.providerNumberId, "num_ext_1");
  assert.deepEqual(prov.log, ["search:DE", `order:+4915799990001:order_${numberId}`]);
  assert.ok(!prov.log.some((l) => l.startsWith("configure")), "kein configure-Aufruf");
  assert.equal(prov.orderCalls.at(-1).connectionId, "conn_1");
  assert.ok(s.numberAssignments.find((a) => a.numberId === numberId && !a.releasedAt));
});

test("search liefert nichts -> failed, KEIN Order, KEIN Release (kein Geld)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({
    async searchNumbers() {
      return [];
    },
  });
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS }),
    /keine kaufbare Nummer/,
  );
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  assert.ok(!prov.log.includes("release:num_ext_1"));
  assert.equal(s.numberAssignments.length, 0);
});

test("order wirft -> failed, KEIN Release (Kauf nicht zustande gekommen)", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner({
    async orderNumber() {
      throw new Error("HTTP 402");
    },
  });
  await assert.rejects(
    () => provisionNumber(s, { provisioner: prov }, { numberId, ...ARGS }),
    /HTTP 402/,
  );
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED);
  assert.ok(!prov.log.some((l) => l.startsWith("release")));
});

const FESTER_HOLD_CENTS = 500;
const HUNDERT_CENT_IN_MIKROCENT = 100_000_000;
const ZWEIHUNDERT_CENT_IN_MIKROCENT = 200_000_000;

function seedMitKarte() {
  const seeded = seedRequested();
  const tenant = seeded.s.tenants.find((eintrag) => eintrag.id === "t_user1");
  tenant.stripeCustomerId = "cus_1";
  tenant.stripePaymentMethodId = "pm_1";
  tenant.stripePaymentMethodType = "card";
  return seeded;
}

async function kaufeMitAnbieterpreis(price) {
  const { s, numberId } = seedMitKarte();
  const prov = fakeProvisioner({
    async searchNumbers() {
      return [{ e164: "+4915799990001", price }];
    },
  });
  const billing = fakeBilling();
  const result = await provisionNumber(
    s,
    { provisioner: prov, billing },
    { numberId, ...ARGS, holdAmountCents: FESTER_HOLD_CENTS, currency: "eur" },
  );
  const hold = billing.log.find(([art]) => art === "placeHold")[1];
  const capture = billing.log.find(([art]) => art === "captureHold");
  return { result, holdCents: hold.amountCents, captureCents: capture[2] };
}

test("[NIE1] Anbieterpreis in der Abrechnungswaehrung: Hold aus den Einrichtungskosten, Monatskosten aus dem Anbieterpreis", async () => {
  const { result, holdCents, captureCents } = await kaufeMitAnbieterpreis({
    currency: "USD",
    upfrontMicroCents: HUNDERT_CENT_IN_MIKROCENT,
    monthlyMicroCents: ZWEIHUNDERT_CENT_IN_MIKROCENT,
  });
  assert.equal(holdCents, 92);
  assert.equal(captureCents, 92);
  assert.equal(result.monthlyCostCents, 184);
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
});

test("[NIE1] Anbieterpreis in fremder Waehrung: fester Hold und keine Monatskosten", async () => {
  const { result, holdCents, captureCents } = await kaufeMitAnbieterpreis({
    currency: "EUR",
    upfrontMicroCents: HUNDERT_CENT_IN_MIKROCENT,
    monthlyMicroCents: ZWEIHUNDERT_CENT_IN_MIKROCENT,
  });
  assert.equal(holdCents, FESTER_HOLD_CENTS);
  assert.equal(captureCents, FESTER_HOLD_CENTS);
  assert.equal(result.monthlyCostCents, undefined);
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
});

test("Anbieterpreis mit gebrochenen Mikrocent: fester Hold und keine Monatskosten", async () => {
  const { result, holdCents } = await kaufeMitAnbieterpreis({
    currency: "USD",
    upfrontMicroCents: HUNDERT_CENT_IN_MIKROCENT + 0.5,
    monthlyMicroCents: ZWEIHUNDERT_CENT_IN_MIKROCENT + 0.5,
  });
  assert.equal(holdCents, FESTER_HOLD_CENTS);
  assert.equal(result.monthlyCostCents, undefined);
});

test("Anbieterpreis ohne Einrichtungskosten: fester Hold, Monatskosten aus dem Anbieterpreis", async () => {
  const { result, holdCents } = await kaufeMitAnbieterpreis({
    currency: "USD",
    upfrontMicroCents: 0,
    monthlyMicroCents: ZWEIHUNDERT_CENT_IN_MIKROCENT,
  });
  assert.equal(holdCents, FESTER_HOLD_CENTS);
  assert.equal(result.monthlyCostCents, 184);
});

function seedHintergrundkaufOhneSuchtabellenLand() {
  const { s, numberId } = seedRequested();
  const tenant = s.tenants.find((eintrag) => eintrag.id === "t_user1");
  tenant.status = TENANT_STATUS.ACTIVE;
  tenant.kycLevel = KYC_LEVEL.ID_VERIFIED;
  findNumber(s, numberId).country = "XX";
  s.provisioningJobs = [
    {
      id: "job_bg",
      numberId,
      tenantId: "t_user1",
      kind: PROVISION_NUMBER_JOB,
      status: PROVISIONING_JOB_STATUS.QUEUED,
      idempotencyKey: `provision_${numberId}`,
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    },
  ];
  return { s, numberId };
}

test("Hintergrundkauf eines Landes ohne Suchtabellen-Eintrag sucht in US und bestellt mit der Verbindung aus der Konfiguration", async () => {
  const telnyx = await startTelnyxProvisioningMock();
  const { s, numberId } = seedHintergrundkaufOhneSuchtabellenLand();
  const srv = await startServer({
    seed: s,
    env: {
      PROVISIONING_ENABLED: "true",
      PROVISIONING_COUNTRY: "DE",
      PROVISIONING_REDRIVE_MAX_AGE_MS: "3600000",
      TELNYX_API_KEY: "KEYtest",
      TELNYX_CONNECTION_ID: "conn_hintergrund",
      TELNYX_API_BASE: telnyx.url,
      MAX_NUMBERS: "10",
    },
  });
  try {
    const store = await waitForStoreState(srv, (state) =>
      state.numbers.some((n) => n.id === numberId && n.status === NUMBER_STATUS.ACTIVE),
    );
    assert.equal(store.numbers.find((n) => n.id === numberId).status, NUMBER_STATUS.ACTIVE);
    const suche = telnyx.requests.find((r) => r.path.startsWith("/v2/available_phone_numbers"));
    assert.equal(new URL(suche.path, telnyx.url).searchParams.get("filter[country_code]"), "US");
    const bestellung = telnyx.requests.find((r) => r.path === "/v2/number_orders");
    assert.equal(JSON.parse(bestellung.body).connection_id, "conn_hintergrund");
  } finally {
    await srv.stop();
    await telnyx.close();
  }
});

import {
  TENANT_STATUS,
  KYC_LEVEL,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
} from "../src/store/defaults.js";
import {
  fakeBilling,
  startServer,
  startTelnyxProvisioningMock,
  waitForStoreState,
} from "./helpers.js";
