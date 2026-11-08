import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.js";
import { STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import * as speicherHilfe from "../pg-helpers.js";

const { BOOTSTRAP_TENANT_ID, makePgStore, pgliteAlsRolleOhneSuperuser } = speicherHilfe;

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const MS_JE_SEKUNDE = 1_000;
const PAUSIERT = "customer.subscription.paused";
const ZAHLUNG_OFFEN = "invoice.payment_action_required";
const FRIST_SQL = `SELECT stripe_billing_hold, stripe_billing_hold_due_at FROM tenant WHERE id = $1`;
const TENANT = "t_sperre";
const KYC_ZIEL = "card";
const ZAHLUNGSSPERRE = "paused";
const SUSPENDIERT = "2026-01-01T00:00:00.000Z";
const SPERRE_ZEILE_SQL = `SELECT status, kyc_level, suspended_at, stripe_billing_hold FROM tenant WHERE id = $1`;
const SPERRE_SETZEN_SQL = `UPDATE tenant SET stripe_billing_hold = $2 WHERE id = $1`;
const SUSPENDIEREN_SQL = `UPDATE tenant SET status = 'suspended', suspended_at = $2 WHERE id = $1`;
const KYC_SETZEN_SQL = `UPDATE tenant SET kyc_level = $2 WHERE id = $1`;
const SCHREIBFEHLER_LOG = "[pg] mandant-sperre schreiben fehlgeschlagen:";
const NICHT_GESCHRIEBEN = /Mandanten-Sperre nicht in die Datenbank geschrieben/;
const SPERRE_LESEN = /^SELECT status, kyc_level/;
const SPERRE_SCHREIBEN = /^UPDATE tenant SET stripe_billing_hold = /;
const NEUER_MANDANT = "t_sperre_neu";
const UNBEKANNTER_MANDANT = "t_sperre_unbekannt";
const SPAETERE_SPERRE = "payment_action";
const KYC_BOOTSTRAP = "id_verified";
const KYC_ZEILE_SQL = `SELECT kyc_level FROM tenant WHERE id = $1`;
const ABO_ENDE = "customer.subscription.deleted";
const SUSPENDIERUNG_SCHREIBEN = /^UPDATE tenant SET suspended_at = /;

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

async function migrierteDatenbank() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await instanz(runnerFuer(db));
  return db;
}

const gemeinsam = await migrierteDatenbank();
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

test("Kriterium 16: ein Abo-Schreiben von B ohne Aktivierungsmarker ueberschreibt den Marker von A nicht", async () => {
  const { db, a, b, tenant } = await zweiInstanzen();
  a.setTenantSubscription(tenant, { activationPending: true });
  await a.drainFlushes();

  b.setTenantSubscription(tenant, { cancelAtPeriodEnd: true });
  await b.drainFlushes();

  const { rows } = await db.query(`SELECT stripe_activation_pending FROM tenant WHERE id = $1`, [tenant]);
  assert.equal(rows[0].stripe_activation_pending, true);
});

test("Kriterium 16: der Aktivierungsmarker, den A loescht, kommt durch den Flush von B nicht zurueck", async () => {
  const { db, a, b, tenant } = await zweiInstanzen();
  a.setTenantSubscription(tenant, { activationPending: true });
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();
  a.setTenantSubscription(tenant, { activationPending: false });
  await a.drainFlushes();

  b.save();
  await b.drainFlushes();

  const { rows } = await db.query(`SELECT stripe_activation_pending FROM tenant WHERE id = $1`, [tenant]);
  assert.equal(rows[0].stripe_activation_pending, false);
});

test("Kriterium 17: hebt A die Sperre auf, sieht B, dieselbe Instanz, sie sofort nicht mehr", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE });
  await a.drainFlushes();
  assert.equal((await sperreVon(b, tenant)).billingHold(), ZAHLUNGSSPERRE);

  a.clearBillingHold(tenant);
  await a.drainFlushes();

  assert.equal((await sperreVon(b, tenant)).billingHold(), null);
});

test("Kriterium 18: sind die Sperr-Spalten nicht lesbar, wirft das Lesen statt zu erlauben", async () => {
  let lesenKaputt = false;
  const { b, tenant } = await zweiInstanzen(undefined, (text) => {
    if (lesenKaputt && /FROM tenant WHERE id = \$1/.test(text)) throw new Error("Datenbank weg");
  });

  lesenKaputt = true;
  await assert.rejects(sperreVon(b, tenant), /Datenbank weg/);
  lesenKaputt = false;

  assert.equal((await sperreVon(b, tenant)).billingHold(), null, "wieder lesbar");
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

test("Kriterium 18: einen Mandanten, den die Datenbank nicht kennt, liest B als ohne KYC-Stufe", async () => {
  const { db, b, tenant } = await zweiInstanzen();
  await db.query(`DELETE FROM tenant WHERE id = $1`, [tenant]);

  const sperre = await sperreVon(b, tenant);

  assert.equal(sperre.kycReached(KYC_ZIEL), false);
  assert.equal(sperre.activeSubscriber(KYC_ZIEL), false);
});

test("Schreibfehler: fehlt der Mandant in der Datenbank, bekommt der Aufrufer den Fehler", async (t) => {
  const { db, b, tenant } = await zweiInstanzen();
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  await db.query(`DELETE FROM tenant WHERE id = $1`, [tenant]);

  await assert.rejects(b.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE }), NICHT_GESCHRIEBEN);

  assert.ok(protokolliert(fehlerausgabe, SCHREIBFEHLER_LOG, "Mandant nicht in der Datenbank"));
});

test("Schreiben: eine Sperre fuer einen Mandanten, den keine Instanz kennt, schreibt nichts und wirft nicht", async () => {
  const { db, b } = await zweiInstanzen();

  await b.setBillingHold(UNBEKANNTER_MANDANT, { reason: ZAHLUNGSSPERRE });

  assert.equal((await db.query(`SELECT id FROM tenant WHERE id = $1`, [UNBEKANNTER_MANDANT])).rows.length, 0);
});

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

test("Kriterium 17: zwei Sperr-Schreiben hintereinander: die Kopie springt nicht auf den aelteren Wert zurueck", async () => {
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
  assert.equal(b.billingHoldActive(tenant), SPAETERE_SPERRE, "danach zieht die Kopie wieder aus der Datenbank nach");
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

test("Kriterium 16: eine Instanz, die eine Suspendierung nicht kennt, hebt sie nicht auf", async () => {
  const { db, a, b, tenant } = await zweiInstanzen();
  await a.setSuspendedAtIfAbsent(tenant);

  await b.clearSuspendedAt(tenant);

  assert.ok((await sperreZeile(db, tenant)).suspended_at, "suspended_at bleibt gesetzt");
});

test("Kriterium 16: hebt A die Suspendierung auf, schreibt B mit veralteter Kopie sie nicht zurueck", async () => {
  const { db, a, b, tenant } = await zweiInstanzen();
  await a.setSuspendedAtIfAbsent(tenant);
  await sperreVon(b, tenant);

  await a.clearSuspendedAt(tenant);
  await b.setSuspendedAtIfAbsent(tenant);

  assert.equal((await sperreZeile(db, tenant)).suspended_at, null);
});

function signiert(ereignis) {
  const rumpf = JSON.stringify(ereignis);
  const zeit = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const pruefsumme = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${rumpf}`).digest("hex");
  return { rumpf, signatur: `t=${zeit},v1=${pruefsumme}` };
}

const pausiertEreignis = (id, tenantId, type = PAUSIERT) => ({
  id,
  type,
  created: Math.floor(Date.now() / MS_JE_SEKUNDE),
  data: { object: { id: `sub_${id}`, metadata: { tenant_ref: tenantId } } },
});

async function webhookAntwort(speicher, ereignis, dienste = {}) {
  const { rumpf, signatur } = signiert(ereignis);
  const antwort = {};
  const res = {
    status(code) {
      antwort.status = code;
      return this;
    },
    json(koerper) {
      antwort.status ??= HTTP_OK;
      antwort.koerper = koerper;
      return this;
    },
  };
  const route = makeStripeWebhookRoute({
    config: { billing: { paymentEnabled: true, stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS } },
    store: speicher,
    audit: () => {},
    ...dienste,
  });
  await route({ rawBody: Buffer.from(rumpf), headers: { "stripe-signature": signatur } }, res);
  return antwort;
}

function schreibenKaputtBei(zustand) {
  return (text) => {
    if (zustand.kaputt && /UPDATE tenant SET/.test(text)) throw new Error("Datenbank weg");
  };
}

function suspendierungenGezaehlt(zustand) {
  const kaputt = schreibenKaputtBei(zustand);
  const zaehler = { suspendierungen: 0 };
  const haken = (text) => {
    if (SUSPENDIERUNG_SCHREIBEN.test(text)) zaehler.suspendierungen += 1;
    return kaputt(text);
  };
  return { zaehler, haken };
}

const protokolliert = (fehlerausgabe, ...teile) =>
  fehlerausgabe.mock.calls.some(({ arguments: zeile }) => teile.every((teil) => zeile.join(" ").includes(teil)));

test("Schreibfehler: scheitert das Schreiben einer Zahlungssperre, bekommt der Aufrufer den Fehler und die Kopie bleibt gesperrt", async (t) => {
  const zustand = { kaputt: false };
  const { db, b, tenant } = await zweiInstanzen(undefined, schreibenKaputtBei(zustand));
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  await sperreVon(b, tenant);

  zustand.kaputt = true;
  await assert.rejects(b.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE }), NICHT_GESCHRIEBEN);
  zustand.kaputt = false;

  assert.equal(b.billingHoldActive(tenant), ZAHLUNGSSPERRE, "die Kopie entsperrt nicht");
  assert.equal((await sperreZeile(db, tenant)).stripe_billing_hold, null);
  assert.ok(protokolliert(fehlerausgabe, SCHREIBFEHLER_LOG, "Datenbank weg"), "der Fehler steht im Log");
  await sperreVon(b, tenant);
  assert.equal(b.billingHoldActive(tenant), ZAHLUNGSSPERRE, "auch nach dem naechsten Lesen bleibt die Kopie gesperrt");
});

test("Schreibfehler: scheitert das Schreiben einer Suspendierung, bekommt der Aufrufer den Fehler", async () => {
  const zustand = { kaputt: false };
  const { b, tenant } = await zweiInstanzen(undefined, schreibenKaputtBei(zustand));

  zustand.kaputt = true;
  await assert.rejects(b.setSuspendedAtIfAbsent(tenant));
  zustand.kaputt = false;

  assert.ok(b.tenantSuspendedAt(tenant), "die Kopie behaelt die Suspendierung");
});

test("Schreibfehler: scheitert das Schreiben der Zahlungssperre aus einem Stripe-Ereignis, antwortet der Webhook 503 und protokolliert die Ereignis-ID", async (t) => {
  const zustand = { kaputt: false };
  const { db, b, tenant } = await zweiInstanzen(undefined, schreibenKaputtBei(zustand));
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  const antwort = await webhookAntwort(b, pausiertEreignis("evt_sperre_kaputt", tenant));
  zustand.kaputt = false;

  assert.equal(antwort.status, HTTP_UNAVAILABLE, "Stripe stellt das Ereignis erneut zu");
  assert.deepEqual(antwort.koerper, { error: "event not applied" });
  assert.ok(protokolliert(fehlerausgabe, "event=evt_sperre_kaputt"), "das Log nennt die Ereignis-ID");
  assert.equal(b.billingHoldActive(tenant), ZAHLUNGSSPERRE);
  assert.equal((await sperreZeile(db, tenant)).stripe_billing_hold, null);

  const erneut = await webhookAntwort(b, pausiertEreignis("evt_sperre_kaputt", tenant));
  assert.equal(erneut.status, HTTP_OK, "die erneute Zustellung wird angewendet");
  assert.equal((await sperreZeile(db, tenant)).stripe_billing_hold, ZAHLUNGSSPERRE);
});

const aboEndeDienste = {
  accounts: { setStatus: async () => true },
  sessions: { invalidateByTenant: async () => {} },
};

test("Schreibfehler: scheitert das Schreiben der Suspendierung aus einem Abo-Ende, schreibt die erneute Zustellung suspended_at in die Datenbank", async (t) => {
  const zustand = { kaputt: false };
  const { db, b, tenant } = await zweiInstanzen(undefined, schreibenKaputtBei(zustand));
  t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  const antwort = await webhookAntwort(b, pausiertEreignis("evt_abo_ende_kaputt", tenant, ABO_ENDE), aboEndeDienste);
  zustand.kaputt = false;
  assert.equal(antwort.status, HTTP_UNAVAILABLE);

  const erneut = await webhookAntwort(b, pausiertEreignis("evt_abo_ende_kaputt", tenant, ABO_ENDE), aboEndeDienste);
  assert.equal(erneut.status, HTTP_OK);
  assert.equal((await sperreZeile(db, tenant)).suspended_at, b.tenantSuspendedAt(tenant));
});

test("Schreibfehler: ist die wiederholte Suspendierung geschrieben, schreibt ein weiterer Aufruf sie nicht noch einmal", async (t) => {
  const zustand = { kaputt: false };
  const { zaehler, haken } = suspendierungenGezaehlt(zustand);
  const { b, tenant } = await zweiInstanzen(undefined, haken);
  t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  await assert.rejects(b.setSuspendedAtIfAbsent(tenant), NICHT_GESCHRIEBEN);
  zustand.kaputt = false;
  await b.setSuspendedAtIfAbsent(tenant);
  zaehler.suspendierungen = 0;

  await b.setSuspendedAtIfAbsent(tenant);
  assert.equal(zaehler.suspendierungen, 0);
});

test("Schreibfehler: scheitert das Schreiben der Zahlungssperre, schreibt ein weiterer Aufruf die bestaetigte Suspendierung nicht noch einmal", async (t) => {
  const zustand = { kaputt: false };
  const { zaehler, haken } = suspendierungenGezaehlt(zustand);
  const { b, tenant } = await zweiInstanzen(undefined, haken);
  t.mock.method(console, "error", () => {});
  await b.setSuspendedAtIfAbsent(tenant);

  zustand.kaputt = true;
  await assert.rejects(b.setBillingHold(tenant, { reason: ZAHLUNGSSPERRE }), NICHT_GESCHRIEBEN);
  zustand.kaputt = false;
  zaehler.suspendierungen = 0;

  await b.setSuspendedAtIfAbsent(tenant);
  assert.equal(zaehler.suspendierungen, 0);
});

test("Schreibfehler: scheitert das Aufheben einer Suspendierung, hebt der naechste Aufruf sie in der Datenbank auf", async (t) => {
  const zustand = { kaputt: false };
  const { db, b, tenant } = await zweiInstanzen(undefined, schreibenKaputtBei(zustand));
  t.mock.method(console, "error", () => {});
  await b.setSuspendedAtIfAbsent(tenant);

  zustand.kaputt = true;
  await assert.rejects(b.clearSuspendedAt(tenant), NICHT_GESCHRIEBEN);
  zustand.kaputt = false;

  await b.clearSuspendedAt(tenant);
  assert.equal((await sperreZeile(db, tenant)).suspended_at, null);
});

test("Kriterium 15: eine Zahlung, die eine Aktion verlangt, schreibt die Sperre mit Frist in die Datenbank", async () => {
  const { db, b, tenant } = await zweiInstanzen();

  const antwort = await webhookAntwort(b, pausiertEreignis("evt_sperre_frist", tenant, ZAHLUNG_OFFEN));

  assert.equal(antwort.status, HTTP_OK);
  const { rows } = await db.query(FRIST_SQL, [tenant]);
  assert.equal(rows[0].stripe_billing_hold, SPAETERE_SPERRE);
  assert.ok(rows[0].stripe_billing_hold_due_at, "die Frist steht in der Datenbank");
});

async function bootstrapKyc(db) {
  const { rows } = await db.query(KYC_ZEILE_SQL, [BOOTSTRAP_TENANT_ID]);
  return rows[0].kyc_level;
}

test("Anbindung: neben den Mandanten-Sperren schreibt und liest der Speicher die Anrufpause weiter in der Datenbank", async () => {
  const { a, b } = await zweiInstanzen();

  await speicherHilfe.anrufpauseSetzen(a, true);
  const gelesen = await speicherHilfe.anrufpauseGelesenVon(b.load());
  await speicherHilfe.anrufpauseSetzen(a, false);

  assert.equal(gelesen, true);
});

test("Bootstrap: eine frische Datenbank gibt dem Bootstrap-Mandanten beim Start die KYC-Stufe", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await instanz(runnerFuer(db));

  assert.equal(await bootstrapKyc(db), KYC_BOOTSTRAP);
});

test("Bootstrap: hat der Bootstrap-Mandant schon eine KYC-Stufe, setzt ein neuer Start sie nicht zurueck", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await instanz(runnerFuer(db));
  await db.query(KYC_SETZEN_SQL, [BOOTSTRAP_TENANT_ID, KYC_ZIEL]);

  const neu = await instanz(runnerFuer(db));

  assert.equal(await bootstrapKyc(db), KYC_ZIEL);
  assert.equal(neu.kycReached(BOOTSTRAP_TENANT_ID, KYC_BOOTSTRAP), false);
});
