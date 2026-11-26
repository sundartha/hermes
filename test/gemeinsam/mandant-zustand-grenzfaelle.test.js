import assert from "node:assert/strict";
import { test } from "node:test";

import { KYC_LEVEL } from "../../src/begriffe/mandant.ts";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";

const MIT_NAMEN = "t_mit_namen";
const OHNE_NAMEN = "t_ohne_namen";
const UNBEKANNT = "t_unbekannt";
const NUMMER = "+4930123456";

async function speicherMitMandanten() {
  const { store, db } = await makePgTestStore();
  await legeMandantAn(store, OHNE_NAMEN);
  await legeMandantAn(store, MIT_NAMEN);
  await db.query(`UPDATE tenant SET owner_name = 'Anna Berg', first_name = 'Annchen' WHERE id = $1`, [MIT_NAMEN]);
  await store.init();
  return store;
}

test("tenantContext: gespeicherter Name und Vorname haben Vorrang, ohne Namen und ohne Mandant bleiben sie leer", async () => {
  const store = await speicherMitMandanten();
  const mit = store.tenantContext(MIT_NAMEN);
  assert.equal(mit.ownerName, "Anna Berg");
  assert.equal(mit.firstName, "Annchen");
  const ohne = store.tenantContext(OHNE_NAMEN);
  assert.equal(ohne.ownerName, "");
  assert.equal(ohne.firstName, "");
  const unbekannt = store.tenantContext(UNBEKANNT);
  assert.equal(unbekannt.ownerName, "");
  assert.equal(unbekannt.firstName, "");
});

test("clearSuspendedAt: setzt eine Sperrzeit zurueck, ohne Sperrzeit und ohne Mandant bleibt alles leer", async () => {
  const store = await speicherMitMandanten();
  await store.setSuspendedAtIfAbsent(MIT_NAMEN);
  assert.notEqual(store.tenantSuspendedAt(MIT_NAMEN), null);
  await store.clearSuspendedAt(MIT_NAMEN);
  assert.equal(store.tenantSuspendedAt(MIT_NAMEN), null);
  await store.clearSuspendedAt(OHNE_NAMEN);
  assert.equal(store.tenantSuspendedAt(OHNE_NAMEN), null);
  await store.clearSuspendedAt(UNBEKANNT);
  assert.equal(store.tenantSuspendedAt(UNBEKANNT), null);
});

test("kycReached und tenantActiveSubscriber: Stufe, Status und fehlender Mandant", async () => {
  const store = await speicherMitMandanten();
  assert.equal(store.kycReached(OHNE_NAMEN, KYC_LEVEL.CARD), false);
  await store.setKycLevel(OHNE_NAMEN, KYC_LEVEL.CARD);
  assert.equal(store.kycReached(OHNE_NAMEN, KYC_LEVEL.CARD), true);
  assert.equal(store.kycReached(OHNE_NAMEN, KYC_LEVEL.ID_VERIFIED), false);
  assert.equal(store.kycReached(UNBEKANNT, KYC_LEVEL.CARD), false);
  assert.equal(store.tenantActiveSubscriber(OHNE_NAMEN, KYC_LEVEL.CARD), true);
  assert.equal(store.tenantActiveSubscriber(MIT_NAMEN, KYC_LEVEL.CARD), false);
  assert.equal(store.tenantActiveSubscriber(UNBEKANNT, KYC_LEVEL.CARD), false);
  assert.equal(store.tenantInactive(UNBEKANNT), false);
});

test("billingHoldActive: ohne Faelligkeit sofort aktiv, mit Faelligkeit erst ab dem Zeitpunkt, ohne Mandant leer", async () => {
  const store = await speicherMitMandanten();
  await store.setBillingHold(OHNE_NAMEN, { reason: "grund" });
  assert.equal(store.billingHoldActive(OHNE_NAMEN), "grund");
  await store.setBillingHold(MIT_NAMEN, { reason: "spaeter", dueAtIso: "2999-01-01T00:00:00.000Z" });
  assert.equal(store.billingHoldActive(MIT_NAMEN), null);
  await store.setBillingHold(MIT_NAMEN, { reason: "vorbei", dueAtIso: "2000-01-01T00:00:00.000Z" });
  assert.equal(store.billingHoldActive(MIT_NAMEN), "vorbei");
  assert.equal(store.billingHoldActive(UNBEKANNT), null);
});

test("numberRecordByE164: aktive Nummer wird gefunden, unbekannte und leere nicht", async () => {
  const store = await speicherMitMandanten();
  await store.seedBootstrapNumber(NUMMER, OHNE_NAMEN, "telnyx");
  assert.equal(store.numberRecordByE164(NUMMER).tenantId, OHNE_NAMEN);
  assert.equal(store.numberRecordByE164("+4930999999"), null);
  assert.equal(store.numberRecordByE164(""), null);
});

test("tenantContext: ohne gespeicherten Vorname ist der Vorname das erste Wort des vollen Namens", async () => {
  const { store, db } = await makePgTestStore();
  await legeMandantAn(store, MIT_NAMEN);
  await db.query(`UPDATE tenant SET owner_name = 'Anna Beispiel' WHERE id = $1`, [MIT_NAMEN]);
  await store.init();
  const kontext = store.tenantContext(MIT_NAMEN);
  assert.equal(kontext.ownerName, "Anna Beispiel");
  assert.equal(kontext.firstName, "Anna");
});

test("tenantSubscription: gesetzte Abo-Felder kommen je Schluessel an, ungesetzte und fehlender Mandant liefern die Standardwerte", async () => {
  const store = await speicherMitMandanten();
  const standard = {
    subscriptionId: null,
    planSlug: null,
    currentPeriodEnd: null,
    currentPeriodStart: null,
    numberSetupFeeExempt: false,
    activationPending: false,
    periodCreditRevoked: false,
    cancelAtPeriodEnd: false,
  };
  assert.deepEqual(store.tenantSubscription(OHNE_NAMEN), standard);
  assert.deepEqual(store.tenantSubscription(UNBEKANNT), standard);
  await store.setTenantSubscription(MIT_NAMEN, {
    subscriptionId: "sub_x1",
    currentPeriodEnd: "2030-02-01T00:00:00.000Z",
    currentPeriodStart: "2030-01-01T00:00:00.000Z",
    numberSetupFeeExempt: true,
    activationPending: true,
    periodCreditRevoked: true,
    cancelAtPeriodEnd: true,
  });
  assert.deepEqual(store.tenantSubscription(MIT_NAMEN), {
    subscriptionId: "sub_x1",
    planSlug: null,
    currentPeriodEnd: "2030-02-01T00:00:00.000Z",
    currentPeriodStart: "2030-01-01T00:00:00.000Z",
    numberSetupFeeExempt: true,
    activationPending: true,
    periodCreditRevoked: true,
    cancelAtPeriodEnd: true,
  });
});

test("resolveCallLanguage: Mandant ohne Eintrag und ohne Nummernsprache faellt auf die Standardsprache, die Nummernsprache geht vor", async () => {
  const store = await speicherMitMandanten();
  assert.equal(await store.resolveCallLanguage({ tenantId: UNBEKANNT, numberRecord: null }), "de");
  assert.equal(await store.resolveCallLanguage({ tenantId: OHNE_NAMEN, numberRecord: { language: "fr" } }), "fr");
});
