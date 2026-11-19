import assert from "node:assert/strict";
import { test } from "node:test";

import * as ops from "../../src/store/state-ops.js";
import { KYC_LEVEL } from "../../src/begriffe/mandant.js";

const MANDANT = "t_grenzfall";

function zustand(tenants) {
  return { tenants, numbers: [], settings: {}, calendar: {}, profiles: {}, notifications: [] };
}

test("tenantContext: Mandant ohne Namen nimmt den uebergebenen Namen und leitet den Vornamen daraus ab", () => {
  const ctx = ops.tenantContext(zustand([{ id: MANDANT }]), "Frieda Fuchs", MANDANT);
  assert.equal(ctx.ownerName, "Frieda Fuchs");
  assert.equal(ctx.firstName, "Frieda");
});

test("tenantContext: gespeicherter Name und Vorname haben Vorrang", () => {
  const ctx = ops.tenantContext(
    zustand([{ id: MANDANT, ownerName: "Anna Berg", firstName: "Annchen" }]),
    "Frieda Fuchs",
    MANDANT,
  );
  assert.equal(ctx.ownerName, "Anna Berg");
  assert.equal(ctx.firstName, "Annchen");
});

test("tenantContext: unbekannter Mandant und leerer Name geben leere Strings", () => {
  const ctx = ops.tenantContext(zustand([]), "", "t_unbekannt");
  assert.equal(ctx.ownerName, "");
  assert.equal(ctx.firstName, "");
  const ohneVorname = ops.tenantContext(zustand([{ id: MANDANT }]), "   ", MANDANT);
  assert.equal(ohneVorname.firstName, "");
});

test("clearSuspendedAt: setzt eine Sperrzeit zurueck, ohne Sperrzeit und ohne Mandant keine Aenderung", () => {
  const s = zustand([{ id: MANDANT, suspendedAt: "2026-01-01T00:00:00.000Z" }, { id: "t_frei" }]);
  const erst = ops.clearSuspendedAt(s, MANDANT);
  assert.equal(erst.changed, true);
  assert.equal(erst.tenant.suspendedAt, null);
  assert.equal(ops.clearSuspendedAt(s, MANDANT).changed, false);
  assert.equal(ops.clearSuspendedAt(s, "t_frei").changed, false);
  assert.deepEqual(ops.clearSuspendedAt(s, "t_fehlt"), { tenant: null, changed: false });
});

test("kycReached und tenantActiveSubscriber: Stufe, Status und fehlender Mandant", () => {
  const s = zustand([
    { id: "t_card", status: "active", kycLevel: KYC_LEVEL.CARD },
    { id: "t_ohne", status: "active" },
    { id: "t_zu", status: "closed", kycLevel: KYC_LEVEL.ID_VERIFIED },
  ]);
  assert.equal(ops.kycReached(s, "t_card", KYC_LEVEL.CARD), true);
  assert.equal(ops.kycReached(s, "t_card", KYC_LEVEL.ID_VERIFIED), false);
  assert.equal(ops.kycReached(s, "t_ohne", KYC_LEVEL.CARD), false);
  assert.equal(ops.kycReached(s, "t_fehlt", KYC_LEVEL.CARD), false);
  assert.equal(ops.tenantActiveSubscriber(s, "t_card", KYC_LEVEL.CARD), true);
  assert.equal(ops.tenantActiveSubscriber(s, "t_ohne", KYC_LEVEL.CARD), false);
  assert.equal(ops.tenantActiveSubscriber(s, "t_zu", KYC_LEVEL.CARD), false);
  assert.equal(ops.tenantActiveSubscriber(s, "t_fehlt", KYC_LEVEL.CARD), false);
});

test("billingHoldActive: ohne Faelligkeit sofort aktiv, mit Faelligkeit ab dem Zeitpunkt", () => {
  const s = zustand([
    { id: "t_ohne", billingHold: "grund" },
    { id: "t_spaeter", billingHold: "grund", billingHoldDueAt: "2026-02-01T00:00:00.000Z" },
  ]);
  assert.equal(ops.billingHoldActive(s, "t_ohne", "2026-01-01T00:00:00.000Z"), "grund");
  assert.equal(ops.billingHoldActive(s, "t_spaeter", "2026-01-31T23:59:59.000Z"), null);
  assert.equal(ops.billingHoldActive(s, "t_spaeter", "2026-02-01T00:00:00.000Z"), "grund");
  assert.equal(ops.billingHoldActive(s, "t_fehlt", "2026-02-01T00:00:00.000Z"), null);
});

test("canTransitionNumber, findNumber und numberRecordByE164: Treffer und Nichttreffer", () => {
  const s = zustand([]);
  s.numbers = [{ id: "n1", e164: "+4930111", status: "active" }, { id: "n2", e164: "+4930222", status: "released" }];
  assert.equal(ops.findNumber(s, "n1").e164, "+4930111");
  assert.equal(ops.findNumber(s, "n9"), null);
  assert.equal(ops.numberRecordByE164(s, "+4930111").id, "n1");
  assert.equal(ops.numberRecordByE164(s, "+4930222"), null);
  assert.equal(ops.canTransitionNumber("active", "suspended"), true);
  assert.equal(ops.canTransitionNumber("unbekannt", "active"), false);
  assert.equal(ops.findTenant(zustand([{ id: MANDANT }]), "t_fehlt"), null);
});
