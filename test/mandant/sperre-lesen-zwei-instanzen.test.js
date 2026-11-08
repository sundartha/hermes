import { test } from "node:test";
import assert from "node:assert/strict";

import * as speicherHilfe from "../pg-helpers.js";

const { makePgStore, pgliteAlsRolleOhneSuperuser } = speicherHilfe;

const TENANT = "t_sperre_lesen";
const NEUER_MANDANT = "t_sperre_lesen_neu";
const KYC_ZIEL = "card";
const ZAHLUNGSSPERRE = "paused";
const SPAETERE_SPERRE = "payment_action";
const SUSPENDIERT = "2026-01-01T00:00:00.000Z";
const SPERRE_ZEILE_SQL = `SELECT status, kyc_level, suspended_at, stripe_billing_hold FROM tenant WHERE id = $1`;
const SPERRE_SETZEN_SQL = `UPDATE tenant SET stripe_billing_hold = $2 WHERE id = $1`;
const SUSPENDIEREN_SQL = `UPDATE tenant SET status = 'suspended', suspended_at = $2 WHERE id = $1`;
const SPERRE_LESEN = /^SELECT status, kyc_level/;
const SPERRE_SCHREIBEN = /^UPDATE tenant SET stripe_billing_hold = /;
const SPERRE_LESEN_ZEILE = /FROM tenant WHERE id = \$1/;

function runnerFuer(db, vorQuery = () => {}, nachQuery = () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      const ergebnis = await db.query(text, params);
      await nachQuery(text);
      return ergebnis;
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function instanz(runner) {
  const speicher = makePgStore(runner);
  await speicher.init();
  return speicher;
}

const gemeinsam = await (async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await instanz(runnerFuer(db));
  return db;
})();
let laufendeNummer = 0;

async function zweiInstanzen({ kyc = KYC_ZIEL, nachQuery } = {}, vorQuery) {
  const db = gemeinsam;
  laufendeNummer += 1;
  const tenant = `${TENANT}_${laufendeNummer}`;
  await db.query(
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level)
     VALUES ($1, 'active', 'Mandant Test', 'Mandant', $2)`,
    [tenant, kyc],
  );
  const runner = runnerFuer(db);
  const a = await instanz(runner);
  const b = await instanz(vorQuery || nachQuery ? runnerFuer(db, vorQuery, nachQuery) : runner);
  return { db, a, b, tenant };
}

const sperreAusKopie = (speicher, tenantId) => ({
  kycReached: (stufe) => speicher.kycReached(tenantId, stufe),
  inactive: () => speicher.tenantInactive(tenantId),
  billingHold: () => speicher.billingHoldActive(tenantId),
  activeSubscriber: (stufe) => speicher.tenantActiveSubscriber(tenantId, stufe),
});

const sperreVon = async (speicher, tenantId) =>
  speicherHilfe.mandantSperreGelesenVon
    ? speicherHilfe.mandantSperreGelesenVon(speicher.load(), tenantId)
    : sperreAusKopie(speicher, tenantId);
const sperreZeile = async (db, tenantId) => (await db.query(SPERRE_ZEILE_SQL, [tenantId])).rows[0];

function angehalten(muster, nummer) {
  const zustand = { gesehen: 0 };
  let freigeben;
  const halt = new Promise((weiter) => {
    freigeben = weiter;
  });
  const haken = (text) => {
    if (!muster.test(text)) return undefined;
    zustand.gesehen += 1;
    return zustand.gesehen === nummer ? halt : undefined;
  };
  return { haken, freigeben: () => freigeben() };
}

test("Kriterium 15: eine Zahlungssperre, die A setzt, sieht B sofort in der Datenbank", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  assert.equal((await sperreVon(b, tenant)).billingHold(), null, "Ausgangslage: keine Sperre");

  a.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE });
  await a.drainFlushes();

  assert.equal((await sperreVon(b, tenant)).billingHold(), ZAHLUNGSSPERRE);
  assert.equal(b.billingHoldActive(tenant), ZAHLUNGSSPERRE, "die Kopie von B zieht nach");
});

test("Kriterium 15: A sieht die eigene Sperre sofort, auch wenn das Schreiben noch aussteht", async () => {
  const { a, tenant } = await zweiInstanzen();

  a.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE });

  assert.equal((await sperreVon(a, tenant)).billingHold(), ZAHLUNGSSPERRE);
});

test("Kriterium 15: liest B die Sperre, zieht die Kopie von B Status und KYC-Stufe nach", async () => {
  const { db, b, tenant } = await zweiInstanzen();
  assert.equal(b.tenantActiveSubscriber(tenant, KYC_ZIEL), true, "Ausgangslage: aktiver Abonnent");

  await db.query(SUSPENDIEREN_SQL, [tenant, SUSPENDIERT]);
  await sperreVon(b, tenant);

  assert.equal(b.tenantInactive(tenant), true);
  assert.equal(b.tenantActiveSubscriber(tenant, KYC_ZIEL), false);
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

test("Kriterium 16: der letzte Flush von B hebt Zahlungssperre und Suspendierung nicht auf", async () => {
  const { db, a, b, tenant } = await zweiInstanzen();
  a.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE });
  a.setSuspendedAtIfAbsent(tenant);
  await a.drainFlushes();
  await db.query(`UPDATE tenant SET status = 'suspended' WHERE id = $1`, [tenant]);

  b.save();
  await b.drainFlushes();

  const zeile = await sperreZeile(db, tenant);
  assert.equal(zeile.status, "suspended");
  assert.equal(zeile.stripe_billing_hold, ZAHLUNGSSPERRE);
  assert.ok(zeile.suspended_at, "suspended_at bleibt gesetzt");
  const frisch = await sperreVon(await instanz(runnerFuer(db)), tenant);
  assert.equal(frisch.inactive(), true);
  assert.equal(frisch.billingHold(), ZAHLUNGSSPERRE);
});

test("Kriterium 16: der letzte Flush von B setzt die KYC-Stufe von A nicht zurueck, und B sieht sie sofort", async () => {
  const { db, a, b, tenant } = await zweiInstanzen({ kyc: null });
  assert.equal((await sperreVon(b, tenant)).kycReached(KYC_ZIEL), false, "Ausgangslage: ohne Stufe");

  a.setKycLevel(tenant, KYC_ZIEL);
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal((await sperreZeile(db, tenant)).kyc_level, KYC_ZIEL);
  assert.equal((await sperreVon(b, tenant)).kycReached(KYC_ZIEL), true);
  assert.equal(b.kycReached(tenant, KYC_ZIEL), true, "die Kopie von B zieht nach");
});

test("Kriterium 16: hebt A die Suspendierung auf, schreibt B, die sie gelesen hat, sie nicht zurueck", async () => {
  const { db, a, b, tenant } = await zweiInstanzen();
  await a.setSuspendedAtIfAbsent(tenant);
  await sperreVon(b, tenant);

  await a.clearSuspendedAt(tenant);
  await b.setSuspendedAtIfAbsent(tenant);

  assert.equal((await sperreZeile(db, tenant)).suspended_at, null);
});

test("Kriterium 17: hebt A die Sperre auf, sieht B, dieselbe Instanz, sie sofort nicht mehr", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE });
  await a.drainFlushes();
  assert.equal((await sperreVon(b, tenant)).billingHold(), ZAHLUNGSSPERRE);

  a.clearBillingHold(tenant);
  await a.drainFlushes();

  assert.equal((await sperreVon(b, tenant)).billingHold(), null);
  assert.equal(b.billingHoldActive(tenant), null, "die Kopie von B zieht nach");
});

test("Kriterium 17: das Lesen wartet auf das eigene Schreiben, danach zieht die Kopie wieder aus der Datenbank nach", async () => {
  const zweites = angehalten(SPERRE_SCHREIBEN, 2);
  const { db, b, tenant } = await zweiInstanzen(undefined, zweites.haken);

  const erst = b.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE });
  const dann = b.clearBillingHold(tenant);
  await erst;
  assert.equal(b.billingHoldActive(tenant), null, "die Kopie behaelt den neueren Wert");

  const lesen = sperreVon(b, tenant);
  zweites.freigeben();
  assert.equal((await lesen).billingHold(), null, "das Lesen wartet auf das eigene Schreiben");
  await dann;

  await db.query(SPERRE_SETZEN_SQL, [tenant, SPAETERE_SPERRE]);
  await sperreVon(b, tenant);
  assert.equal(b.billingHoldActive(tenant), SPAETERE_SPERRE);
});

test("Kriterium 17: ein spaet ankommendes aelteres Lesen setzt die Kopie von B nicht zurueck", async () => {
  const erstesLesen = angehalten(SPERRE_LESEN, 1);
  const { a, b, tenant } = await zweiInstanzen({ nachQuery: erstesLesen.haken });

  const alt = sperreVon(b, tenant);
  await a.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE });
  assert.equal((await sperreVon(b, tenant)).billingHold(), ZAHLUNGSSPERRE);
  erstesLesen.freigeben();
  await alt;

  assert.equal(b.billingHoldActive(tenant), ZAHLUNGSSPERRE);
});

test("Kriterium 18: sind die Sperr-Spalten nicht lesbar, wirft das Lesen statt zu erlauben", async () => {
  let lesenKaputt = false;
  const { b, tenant } = await zweiInstanzen(undefined, (text) => {
    if (lesenKaputt && SPERRE_LESEN_ZEILE.test(text)) throw new Error("Datenbank weg");
  });

  lesenKaputt = true;
  await assert.rejects(sperreVon(b, tenant), /Datenbank weg/);
  lesenKaputt = false;

  assert.equal((await sperreVon(b, tenant)).billingHold(), null, "wieder lesbar");
});

test("Kriterium 18: einen Mandanten, den die Datenbank nicht kennt, liest B als gesperrt und ohne KYC-Stufe", async () => {
  const { db, b, tenant } = await zweiInstanzen();
  await db.query(`DELETE FROM tenant WHERE id = $1`, [tenant]);

  const sperre = await sperreVon(b, tenant);

  assert.equal(sperre.inactive(), true);
  assert.equal(sperre.kycReached(KYC_ZIEL), false);
  assert.equal(sperre.activeSubscriber(KYC_ZIEL), false);
});
