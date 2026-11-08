import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KYC_ZIEL,
  TENANT,
  ZAHLUNGSSPERRE,
  instanz,
  runnerFuer,
  sperreVon,
  sperreZeile,
  zweiInstanzen,
} from "./sperre-hilfe.js";

test("Kriterium 16: der letzte Flush von B hebt Zahlungssperre und Suspendierung nicht auf", async () => {
  const { db, a, b } = await zweiInstanzen();
  a.setBillingHold(TENANT, { reason: ZAHLUNGSSPERRE });
  a.setSuspendedAtIfAbsent(TENANT);
  await a.drainFlushes();
  await db.query(`UPDATE tenant SET status = 'suspended' WHERE id = $1`, [TENANT]);

  b.save();
  await b.drainFlushes();

  const zeile = await sperreZeile(db);
  assert.equal(zeile.status, "suspended");
  assert.equal(zeile.stripe_billing_hold, ZAHLUNGSSPERRE);
  assert.ok(zeile.suspended_at, "suspended_at bleibt gesetzt");
  const frisch = await sperreVon(await instanz(runnerFuer(db)));
  assert.equal(frisch.inactive(), true);
  assert.equal(frisch.billingHold(), ZAHLUNGSSPERRE);
});

test("Kriterium 16: der letzte Flush von B setzt die KYC-Stufe von A nicht zurueck, und B sieht sie sofort", async () => {
  const { db, a, b } = await zweiInstanzen({ kyc: null });
  assert.equal((await sperreVon(b)).kycReached(KYC_ZIEL), false, "Ausgangslage: ohne Stufe");

  a.setKycLevel(TENANT, KYC_ZIEL);
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal((await sperreZeile(db)).kyc_level, KYC_ZIEL);
  assert.equal((await sperreVon(b)).kycReached(KYC_ZIEL), true);
  assert.equal(b.kycReached(TENANT, KYC_ZIEL), true, "die Kopie von B zieht nach");
});

test("Kriterium 16: ein Abo-Schreiben von B ohne Aktivierungsmarker ueberschreibt den Marker von A nicht", async () => {
  const { db, a, b } = await zweiInstanzen();
  a.setTenantSubscription(TENANT, { activationPending: true });
  await a.drainFlushes();

  b.setTenantSubscription(TENANT, { cancelAtPeriodEnd: true });
  await b.drainFlushes();

  const { rows } = await db.query(`SELECT stripe_activation_pending FROM tenant WHERE id = $1`, [TENANT]);
  assert.equal(rows[0].stripe_activation_pending, true);
});

test("Kriterium 16: der Aktivierungsmarker, den A loescht, kommt durch den Flush von B nicht zurueck", async () => {
  const { db, a, b } = await zweiInstanzen();
  a.setTenantSubscription(TENANT, { activationPending: true });
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();
  a.setTenantSubscription(TENANT, { activationPending: false });
  await a.drainFlushes();

  b.save();
  await b.drainFlushes();

  const { rows } = await db.query(`SELECT stripe_activation_pending FROM tenant WHERE id = $1`, [TENANT]);
  assert.equal(rows[0].stripe_activation_pending, false);
});

test("Kriterium 16: eine Instanz, die eine Suspendierung nicht kennt, hebt sie nicht auf", async () => {
  const { db, a, b } = await zweiInstanzen();
  await a.setSuspendedAtIfAbsent(TENANT);

  await b.clearSuspendedAt(TENANT);

  assert.ok((await sperreZeile(db)).suspended_at, "suspended_at bleibt gesetzt");
});

test("Kriterium 16: hebt A die Suspendierung auf, schreibt B mit veralteter Kopie sie nicht zurueck", async () => {
  const { db, a, b } = await zweiInstanzen();
  await a.setSuspendedAtIfAbsent(TENANT);
  await sperreVon(b);

  await a.clearSuspendedAt(TENANT);
  await b.setSuspendedAtIfAbsent(TENANT);

  assert.equal((await sperreZeile(db)).suspended_at, null);
});
