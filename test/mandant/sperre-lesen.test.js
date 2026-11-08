import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KYC_ZIEL,
  NEUER_MANDANT,
  SUSPENDIEREN_SQL,
  SUSPENDIERT,
  TENANT,
  ZAHLUNGSSPERRE,
  sperreVon,
  zweiInstanzen,
} from "./sperre-hilfe.js";

test("Kriterium 15: eine Zahlungssperre, die A setzt, sieht B sofort in der Datenbank", async () => {
  const { a, b } = await zweiInstanzen();
  assert.equal((await sperreVon(b)).billingHold(), null, "Ausgangslage: keine Sperre");

  a.setBillingHold(TENANT, { reason: ZAHLUNGSSPERRE });
  await a.drainFlushes();

  assert.equal((await sperreVon(b)).billingHold(), ZAHLUNGSSPERRE);
  assert.equal(b.billingHoldActive(TENANT), ZAHLUNGSSPERRE, "die Kopie von B zieht nach");
});

test("Kriterium 15: A sieht die eigene Sperre sofort, auch wenn das Schreiben noch aussteht", async () => {
  const { a } = await zweiInstanzen();

  a.setBillingHold(TENANT, { reason: ZAHLUNGSSPERRE });

  assert.equal((await sperreVon(a)).billingHold(), ZAHLUNGSSPERRE);
});

test("Kriterium 17: hebt A die Sperre auf, sieht B, dieselbe Instanz, sie sofort nicht mehr", async () => {
  const { a, b } = await zweiInstanzen();
  a.setBillingHold(TENANT, { reason: ZAHLUNGSSPERRE });
  await a.drainFlushes();
  assert.equal((await sperreVon(b)).billingHold(), ZAHLUNGSSPERRE);

  a.clearBillingHold(TENANT);
  await a.drainFlushes();

  assert.equal((await sperreVon(b)).billingHold(), null);
});

test("Kriterium 18: sind die Sperr-Spalten nicht lesbar, wirft das Lesen statt zu erlauben", async () => {
  let lesenKaputt = false;
  const { b } = await zweiInstanzen(undefined, (text) => {
    if (lesenKaputt && /FROM tenant WHERE id = \$1/.test(text)) throw new Error("Datenbank weg");
  });

  lesenKaputt = true;
  await assert.rejects(sperreVon(b), /Datenbank weg/);
  lesenKaputt = false;

  assert.equal((await sperreVon(b)).billingHold(), null, "wieder lesbar");
});

test("Kriterium 15: liest B die Sperre, zieht die Kopie von B Status und KYC-Stufe nach", async () => {
  const { db, b } = await zweiInstanzen();
  assert.equal(b.tenantActiveSubscriber(TENANT, KYC_ZIEL), true, "Ausgangslage: aktiver Abonnent");

  await db.query(SUSPENDIEREN_SQL, [TENANT, SUSPENDIERT]);
  await sperreVon(b);

  assert.equal(b.tenantInactive(TENANT), true);
  assert.equal(b.tenantActiveSubscriber(TENANT, KYC_ZIEL), false);
});

test("Kriterium 15: B sieht die Sperre eines Mandanten, den A nach dem Start von B angelegt hat", async () => {
  const { db, b } = await zweiInstanzen();
  await db.query(
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level, stripe_billing_hold)
     VALUES ($1, 'active', 'Mandant Neu', 'Mandant', $2, $3)`,
    [NEUER_MANDANT, KYC_ZIEL, ZAHLUNGSSPERRE],
  );

  assert.equal((await sperreVon(b, NEUER_MANDANT)).billingHold(), ZAHLUNGSSPERRE);
});

test("Kriterium 18: einen Mandanten, den die Datenbank nicht kennt, liest B als ohne KYC-Stufe", async () => {
  const { db, b } = await zweiInstanzen();
  await db.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);

  const sperre = await sperreVon(b);

  assert.equal(sperre.kycReached(KYC_ZIEL), false);
  assert.equal(sperre.activeSubscriber(KYC_ZIEL), false);
});
