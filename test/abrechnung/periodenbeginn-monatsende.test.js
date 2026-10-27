import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, PLAN_PRICE_BOOT_ENV } from "../helpers.js";
import { findPlan } from "../../src/plans.js";
import { periodStartFromEnd } from "../../src/billing/period.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const ZIEL = "+4915112345678";
const TENANT = "tenant-monatsende";
const LOGIN = "sub-monatsende";
const NUMMER = "+4915110000077";
const BOOTSTRAP_TENANT = "owner";
const SPRACHMINUTE = "voice_minute";
const STARTER_MINUTEN = findPlan("starter").includedMinutes;
const ANBIETERSTART_OFFLINE = 500;
const MS_JE_SEKUNDE = 1000;

const PAY_ENV = {
  MULTI_TENANT: "true",
  ALLOWED_NUMBERS: ZIEL,
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  STRIPE_API_BASE: "http://127.0.0.1:9",
  NUMBER_SETUP_FEE_CENTS: "500",
  ...PLAN_PRICE_BOOT_ENV,
};

const sekunden = (iso) => Date.parse(iso) / MS_JE_SEKUNDE;

const sprachminuten = (occurredAt) => ({
  id: `ue_${TENANT}_${occurredAt}`,
  tenantId: TENANT,
  callId: null,
  kind: SPRACHMINUTE,
  quantity: STARTER_MINUTEN,
  costCents: 0,
  occurredAt,
  stripeMeterSent: false,
});

function abrechnungsStand({ abo, usageEvents = [] }) {
  const s = seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT, status: "active" },
      {
        id: TENANT,
        status: "active",
        idpSubject: LOGIN,
        ownerName: "Mara",
        kycLevel: "card",
        stripePlanSlug: "starter",
        ...abo,
      },
    ],
    numbers: [
      {
        id: "num_monatsende",
        e164: NUMMER,
        tenantId: TENANT,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
    profiles: { [TENANT]: { maxCallsPerHour: null } },
  });
  s.usageEvents = usageEvents;
  return s;
}

async function anrufStarten(seed) {
  const srv = await startServer({ env: PAY_ENV, seed });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Identity": LOGIN },
      body: JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren" }),
    });
    return { status: res.status, body: await res.text() };
  } finally {
    await srv.stop();
  }
}

const ENDE_ZU_BEGINN = [
  ["2027-03-29T00:00:00.000Z", "2027-02-28T00:00:00.000Z"],
  ["2027-03-30T00:00:00.000Z", "2027-02-28T00:00:00.000Z"],
  ["2027-03-31T00:00:00.000Z", "2027-02-28T00:00:00.000Z"],
  ["2028-03-31T00:00:00.000Z", "2028-02-29T00:00:00.000Z"],
  ["2028-03-30T00:00:00.000Z", "2028-02-29T00:00:00.000Z"],
  ["2027-12-31T00:00:00.000Z", "2027-11-30T00:00:00.000Z"],
  ["2027-01-31T00:00:00.000Z", "2026-12-31T00:00:00.000Z"],
  ["2027-05-31T00:00:00.000Z", "2027-04-30T00:00:00.000Z"],
  ["2027-07-15T00:00:00.000Z", "2027-06-15T00:00:00.000Z"],
];

test("periodStartFromEnd: Beginn ist derselbe Tag im Vormonat, hoechstens dessen Letzter", () => {
  for (const [ende, beginn] of ENDE_ZU_BEGINN) {
    assert.equal(periodStartFromEnd(sekunden(ende)).toISOString(), beginn, `Ende ${ende}`);
  }
});

test("periodStartFromEnd rechnet in UTC, auch unter TZ=Europe/Berlin", () => {
  const vorher = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    const beginnMs = periodStartFromEnd(sekunden("2027-03-31T23:30:00.000Z")).getTime();
    assert.ok(beginnMs <= Date.parse("2027-02-28T23:30:00.000Z"), "Beginn nicht spaeter als 28.02. 23:30Z");
    assert.ok(beginnMs >= Date.parse("2027-02-28T00:00:00.000Z"), "Beginn nicht frueher als 28.02. 00:00Z");
  } finally {
    if (vorher === undefined) delete process.env.TZ;
    else process.env.TZ = vorher;
  }
});

test("Ende am Monatsletzten ohne Beginn: Minuten vom 01.03. sperren den Anruf (402 Plan-Minuten)", async () => {
  const { status, body } = await anrufStarten(
    abrechnungsStand({
      abo: { stripeCurrentPeriodEnd: sekunden("2027-03-31T00:00:00.000Z") },
      usageEvents: [sprachminuten("2027-03-01T00:00:00.000Z")],
    }),
  );
  assert.equal(status, 402, "Minuten ab Periodenbeginn zählen nicht");
  assert.match(body, /Plan-Minuten/, "Minuten-Meldung");
});

test("Ende in der Monatsmitte ohne Beginn: Minuten vom 15.06. sperren, vom 14.06. nicht", async () => {
  const abo = { stripeCurrentPeriodEnd: sekunden("2027-07-15T00:00:00.000Z") };
  const amBeginn = await anrufStarten(
    abrechnungsStand({ abo, usageEvents: [sprachminuten("2027-06-15T00:00:00.000Z")] }),
  );
  assert.equal(amBeginn.status, 402, "Minuten am Periodenbeginn zaehlen");
  assert.match(amBeginn.body, /Plan-Minuten/, "Minuten-Meldung");

  const davor = await anrufStarten(
    abrechnungsStand({ abo, usageEvents: [sprachminuten("2027-06-14T00:00:00.000Z")] }),
  );
  assert.equal(davor.status, ANBIETERSTART_OFFLINE, "Minuten vor dem Beginn zaehlen nicht -> Anbieterstart");
});

test("gespeicherter Beginn hat Vorrang, auch wenn das Ende auf einen Monatsletzten faellt", async () => {
  const abo = {
    stripeCurrentPeriodStart: sekunden("2027-03-10T00:00:00.000Z"),
    stripeCurrentPeriodEnd: sekunden("2027-03-31T00:00:00.000Z"),
  };
  const { status } = await anrufStarten(
    abrechnungsStand({ abo, usageEvents: [sprachminuten("2027-03-05T00:00:00.000Z")] }),
  );
  assert.equal(status, ANBIETERSTART_OFFLINE, "Minuten vor dem gespeicherten Beginn zaehlen nicht");
});

test("Abo ohne Periodenbeginn und ohne Periodenende sperrt fail-closed (402 Plan-Minuten)", async () => {
  const { status, body } = await anrufStarten(abrechnungsStand({ abo: {} }));
  assert.equal(status, 402, "ohne Periodenanker gesperrt");
  assert.match(body, /Plan-Minuten/, "Minuten-Meldung");
});

test("Ende am Monatsletzten ohne Beginn und ohne Sprachminuten erreicht den Anbieterstart", async () => {
  const { status } = await anrufStarten(
    abrechnungsStand({ abo: { stripeCurrentPeriodEnd: sekunden("2027-03-31T00:00:00.000Z") } }),
  );
  assert.equal(status, ANBIETERSTART_OFFLINE, "freies Kontingent -> Anbieterstart");
});
