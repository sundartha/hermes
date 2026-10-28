import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../../src/config.js";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../../src/billing/webhook.js";
import { includedMinutesFor } from "../../src/billing/plan-caps.js";
import {
  MONEY_ACTION,
  MONEY_EVENT,
  PAYMENT_ACTION_GRACE_HOURS,
  moneyActionFor,
} from "../../src/billing/money-events.js";
import { findPlan } from "../../src/plans.js";

config.server.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-inklusivminuten-"));
const speicher = await import("../../src/store.js");

const PLAN = "starter";
const VOLLE_MINUTEN = findPlan(PLAN).includedMinutes;
const PERIODE_1 = Object.freeze({ start: 1_890_864_000, ende: 1_893_456_000 });
const PERIODE_2 = Object.freeze({ start: 1_893_456_000, ende: 1_896_134_400 });
const BEREITGESTELLT = Object.freeze({ ok: true, reason: "queued" });
const ZURUECKGEHALTEN = Object.freeze({ ok: false, reason: "tenant_cap" });

let laufendeNummer = 0;

function neuerKunde(kennung) {
  laufendeNummer += 1;
  const tenant = `t_inklusiv_${kennung}`;
  const kunde = `cus_inklusiv_${kennung}`;
  speicher.bootstrapTenant(`+4930555${String(laufendeNummer).padStart(4, "0")}`, tenant);
  speicher.setTenantStripe(tenant, { customerId: kunde });
  return { tenant, kunde };
}

function aboEreignis(typ, { tenant, kunde, abo, periode, kuendigtZumEnde = false }) {
  return {
    type: typ,
    data: {
      object: {
        id: abo,
        status: "active",
        customer: kunde,
        cancel_at_period_end: kuendigtZumEnde,
        metadata: { tenant_ref: tenant, plan_slug: PLAN },
        current_period_start: periode.start,
        current_period_end: periode.ende,
      },
    },
  };
}

function erstattung(kunde, { captured } = {}) {
  const angabe = captured === undefined ? {} : { captured };
  return {
    type: "charge.refunded",
    id: `evt_erstattung_${kunde}`,
    data: { object: { id: `ch_${kunde}`, customer: kunde, ...angabe } },
  };
}

function geldEreignis(typ, objekt) {
  return { type: typ, id: `evt_${typ}_${objekt.customer}`, data: { object: objekt } };
}

function aboPausiert({ kunde, abo }) {
  return {
    type: "customer.subscription.paused",
    id: `evt_pause_${kunde}`,
    data: { object: { id: abo, customer: kunde } },
  };
}

function aboBeendet({ tenant, abo }) {
  return {
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: abo, metadata: { tenant_ref: tenant } } },
  };
}

async function sende(ereignis, { provisioning = BEREITGESTELLT } = {}) {
  const ergebnis = await applyStripeWebhook(ereignis, {
    store: speicher,
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    audit: () => {},
    req: {},
    provision: async () => provisioning,
    billing: undefined,
  });
  await speicher.drainFlushes();
  return ergebnis;
}

function inklusivminuten(tenant) {
  const abo = speicher.tenantSubscription(tenant);
  return includedMinutesFor({ plan: findPlan(abo.planSlug), subscription: abo });
}

test("Erstattung, Kündigen und Fortsetzen derselben Periode: Inklusivminuten bleiben entzogen", async () => {
  const { tenant, kunde } = neuerKunde("fortsetzen");
  const abo = "sub_inklusiv_fortsetzen";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));
  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN, "Vorbedingung: Abo bringt volle Inklusivminuten");
  await sende(erstattung(kunde));
  assert.equal(inklusivminuten(tenant), 0, "Vorbedingung: Erstattung entzieht die Inklusivminuten");

  await sende(
    aboEreignis(SUBSCRIPTION_EVENT.UPDATED, { tenant, kunde, abo, periode: PERIODE_1, kuendigtZumEnde: true }),
  );
  await sende(
    aboEreignis(SUBSCRIPTION_EVENT.UPDATED, { tenant, kunde, abo, periode: PERIODE_1, kuendigtZumEnde: false }),
  );

  assert.equal(inklusivminuten(tenant), 0, "Inklusivminuten nach Fortsetzen ohne neue Periode wieder da");
});

test("[NIE1] Verlängerung in eine spätere Periode nach Erstattung gibt die Inklusivminuten zurück", async () => {
  const { tenant, kunde } = neuerKunde("verlaengerung");
  const abo = "sub_inklusiv_verlaengerung";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));
  await sende(erstattung(kunde));
  assert.equal(inklusivminuten(tenant), 0, "Vorbedingung: Erstattung entzieht die Inklusivminuten");

  await sende(aboEreignis(SUBSCRIPTION_EVENT.UPDATED, { tenant, kunde, abo, periode: PERIODE_2 }));

  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN);
});

test("[NIE2] Neues Abo nach beendetem Abo und Erstattung gibt die Inklusivminuten zurück", async () => {
  const { tenant, kunde } = neuerKunde("neues_abo");
  await sende(
    aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo: "sub_inklusiv_alt", periode: PERIODE_1 }),
  );
  await sende(erstattung(kunde));
  await sende(aboBeendet({ tenant, abo: "sub_inklusiv_alt" }));
  assert.equal(inklusivminuten(tenant), 0, "Vorbedingung: Erstattung entzieht die Inklusivminuten");

  await sende(
    aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo: "sub_inklusiv_neu", periode: PERIODE_2 }),
  );

  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN);
});

test("[NIE3] Sperre aus einem Zahlungsereignis wird bei Aktivierung derselben Periode aufgehoben", async () => {
  const { tenant, kunde } = neuerKunde("sperre");
  const abo = "sub_inklusiv_sperre";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));
  await sende(aboPausiert({ kunde, abo }));
  assert.equal(speicher.billingHoldActive(tenant), "paused", "Vorbedingung: Zahlungsereignis sperrt");

  await sende(aboEreignis(SUBSCRIPTION_EVENT.UPDATED, { tenant, kunde, abo, periode: PERIODE_1 }));

  assert.equal(speicher.billingHoldActive(tenant), null);
});

test("[NIE4] Ohne Erstattung bleiben die Inklusivminuten bei Kündigen und Fortsetzen derselben Periode voll", async () => {
  const { tenant, kunde } = neuerKunde("ohne_erstattung");
  const abo = "sub_inklusiv_ohne_erstattung";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));

  await sende(
    aboEreignis(SUBSCRIPTION_EVENT.UPDATED, { tenant, kunde, abo, periode: PERIODE_1, kuendigtZumEnde: true }),
  );
  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN, "Kündigen zum Periodenende lässt die Minuten voll");
  await sende(
    aboEreignis(SUBSCRIPTION_EVENT.UPDATED, { tenant, kunde, abo, periode: PERIODE_1, kuendigtZumEnde: false }),
  );

  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN);
});

test("[NIE5] Neues Abo nach Erstattung mit zurückgehaltenem Provisioning hat nach der nächsten Aktivierung volle Inklusivminuten", async () => {
  const { tenant, kunde } = neuerKunde("zurueckgehalten");
  await sende(
    aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo: "sub_inklusiv_vorher", periode: PERIODE_1 }),
  );
  await sende(erstattung(kunde));
  await sende(aboBeendet({ tenant, abo: "sub_inklusiv_vorher" }));
  const neuesAbo = "sub_inklusiv_nachher";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo: neuesAbo, periode: PERIODE_2 }), {
    provisioning: ZURUECKGEHALTEN,
  });

  await sende(aboEreignis(SUBSCRIPTION_EVENT.UPDATED, { tenant, kunde, abo: neuesAbo, periode: PERIODE_2 }));

  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN);
});

test("Erstattung einer nicht eingezogenen Zahlung lässt Inklusivminuten voll, ohne Sperre und ohne Alarm", async () => {
  const { tenant, kunde } = neuerKunde("nicht_eingezogen");
  const abo = "sub_inklusiv_nicht_eingezogen";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));
  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN, "Vorbedingung: Abo bringt volle Inklusivminuten");

  const ergebnis = await sende(erstattung(kunde, { captured: false }));

  assert.equal(
    inklusivminuten(tenant),
    VOLLE_MINUTEN,
    "Erstattung einer nicht eingezogenen Zahlung entzieht Inklusivminuten",
  );
  assert.equal(speicher.billingHoldActive(tenant), null);
  assert.equal(ergebnis?.alarm ?? null, null);
});

test("[NIE1] Erstattung einer eingezogenen Zahlung entzieht die Inklusivminuten", async () => {
  const { tenant, kunde } = neuerKunde("eingezogen");
  const abo = "sub_inklusiv_eingezogen";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));
  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN, "Vorbedingung: Abo bringt volle Inklusivminuten");

  await sende(erstattung(kunde, { captured: true }));

  assert.equal(inklusivminuten(tenant), 0);
});

test("[NIE2] Erstattung ohne Angabe zum Einzug entzieht die Inklusivminuten", async () => {
  const { tenant, kunde } = neuerKunde("ohne_angabe");
  const abo = "sub_inklusiv_ohne_angabe";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));
  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN, "Vorbedingung: Abo bringt volle Inklusivminuten");

  await sende(erstattung(kunde));

  assert.equal(inklusivminuten(tenant), 0);
});

test("[NIE3] Streitfall meldet einen Alarm und lässt Inklusivminuten und Sperre unberührt", async () => {
  const { tenant, kunde } = neuerKunde("streitfall");
  const abo = "sub_inklusiv_streitfall";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));

  const ergebnis = await sende(
    geldEreignis(MONEY_EVENT.DISPUTE_CREATED, { id: `ch_${kunde}`, customer: kunde, captured: true }),
  );

  assert.equal(ergebnis.alarm?.detail, `type=${MONEY_EVENT.DISPUTE_CREATED} tenant=${tenant}`);
  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN);
  assert.equal(speicher.billingHoldActive(tenant), null);
});

test("[NIE3] Pausiertes Abo sperrt sofort, ohne Alarm und ohne Entzug der Inklusivminuten", async () => {
  const { tenant, kunde } = neuerKunde("pausiert");
  const abo = "sub_inklusiv_pausiert";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));

  const ergebnis = await sende(geldEreignis(MONEY_EVENT.SUBSCRIPTION_PAUSED, { id: abo, customer: kunde }));

  assert.equal(speicher.billingHoldActive(tenant), "paused");
  assert.equal(ergebnis.alarm, null);
  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN);
});

test("[NIE3] Ausstehende Zahlungsbestätigung sperrt erst nach Ablauf der Frist", async (t) => {
  const { tenant, kunde } = neuerKunde("bestaetigung");
  const abo = "sub_inklusiv_bestaetigung";
  await sende(aboEreignis(SUBSCRIPTION_EVENT.CREATED, { tenant, kunde, abo, periode: PERIODE_1 }));

  const ergebnis = await sende(
    geldEreignis(MONEY_EVENT.PAYMENT_ACTION_REQUIRED, { id: `in_${kunde}`, customer: kunde, subscription: abo }),
  );

  assert.equal(speicher.billingHoldActive(tenant), null, "Innerhalb der Frist ist nichts gesperrt");
  assert.equal(ergebnis.alarm, null);
  assert.equal(inklusivminuten(tenant), VOLLE_MINUTEN);
  const nachDerFrist = Date.now() + (PAYMENT_ACTION_GRACE_HOURS + 1) * 60 * 60 * 1000;
  t.mock.timers.enable({ apis: ["Date"], now: nachDerFrist });
  assert.equal(speicher.billingHoldActive(tenant), "payment_action");
});

test("Nicht eingezogene Erstattung ergibt die wirkungslose Geld-Aktion ohne Alarm", () => {
  assert.deepEqual(
    moneyActionFor(MONEY_EVENT.REFUNDED, { captured: false }),
    { action: MONEY_ACTION.WARN, alarm: false },
    "Erstattung einer nicht eingezogenen Zahlung entzieht Inklusivminuten",
  );
});

test("[NIE2] Erstattung ohne übergebene Charge ergibt weiter den Entzug der Inklusivminuten", () => {
  const entzug = { action: MONEY_ACTION.REVOKE_PERIOD_CREDIT, alarm: false };

  assert.deepEqual(moneyActionFor(MONEY_EVENT.REFUNDED), entzug);
  assert.deepEqual(moneyActionFor(MONEY_EVENT.REFUNDED, {}), entzug);
});

test("[NIE3] Streitfall, Pause und Zahlungsbestätigung wirken auch bei nicht eingezogener Charge wie bisher", () => {
  const nichtEingezogen = { captured: false };

  assert.deepEqual(moneyActionFor(MONEY_EVENT.DISPUTE_CREATED, nichtEingezogen), {
    action: MONEY_ACTION.WARN,
    alarm: true,
  });
  assert.deepEqual(moneyActionFor(MONEY_EVENT.SUBSCRIPTION_PAUSED, nichtEingezogen), {
    action: MONEY_ACTION.HOLD_OUTBOUND,
    alarm: false,
  });
  assert.deepEqual(moneyActionFor(MONEY_EVENT.PAYMENT_ACTION_REQUIRED, nichtEingezogen), {
    action: MONEY_ACTION.GRACE_THEN_HOLD,
    alarm: false,
  });
});
