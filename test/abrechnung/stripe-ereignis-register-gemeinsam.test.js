import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";

const ZEITGRENZE_MS = 180_000;
const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const MS_JE_SEKUNDE = 1_000;
const GEHEIMNIS = "whsec_4b7d1e9a2c8f35067e1d9b4a8c2f6035";
const STRIPE_PFAD = "/webhooks/stripe";
const ABO_ENDE = "customer.subscription.deleted";
const ALT_S = 1000;
const NEU_S = 2000;
const GLEICHZEITIG = 8;
const SUSPEND_ZEILE = /stripe_webhook_suspend/g;
const MANDANT_SQL = `SELECT status FROM tenant WHERE id = $1`;
const REGISTER_SQL = `SELECT schluessel, ereignis_id, erstellt_s FROM stripe_ereignis_register WHERE ereignis_id IS NOT NULL ORDER BY schluessel`;
const UMGEBUNG = {
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_register",
  STRIPE_WEBHOOK_SECRET: GEHEIMNIS,
  NUMBER_SETUP_FEE_CENTS: "500",
  SESSION_SECRET: "stripe-register-sitzungsgeheimnis-mind-32-zeichen",
  OIDC_CLIENT_ID: "stripe-register-client",
  OIDC_CLIENT_SECRET: "stripe-register-client-geheimnis",
  STRIPE_STARTER_PRICE_ID: "price_test_starter",
  STRIPE_BUSINESS_PRICE_ID: "price_test_business",
};
const TRIGGER_AUS = `DROP TRIGGER IF EXISTS fehler_beim_sperren ON tenant;`;
const TRIGGER_AN = `
  CREATE OR REPLACE FUNCTION fehler_beim_sperren_fn() RETURNS trigger AS $$
  BEGIN RAISE EXCEPTION 'schreiben verweigert'; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER fehler_beim_sperren BEFORE UPDATE ON tenant
    FOR EACH ROW WHEN (NEW.status = 'suspended') EXECUTE FUNCTION fehler_beim_sperren_fn();`;

let zaehler = 0;
function frischeKennung(vorsatz) {
  zaehler += 1;
  return `${vorsatz}_${zaehler}`;
}

function ereignis({ id, tenant, abo, created }) {
  return JSON.stringify({
    id,
    type: ABO_ENDE,
    created,
    data: { object: { id: abo, metadata: { tenant_ref: tenant } } },
  });
}

function senden(prozess, koerper) {
  const zeit = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const mac = createHmac("sha256", GEHEIMNIS).update(`${zeit}.${koerper}`).digest("hex");
  return abrufMitFrist(`${prozess.localUrl}${STRIPE_PFAD}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` },
    body: koerper,
  });
}

function alsVerwaltung(db, arbeit) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(db.adresse).pathname;
  return mitVerbindung(url.href, arbeit);
}

function anlegen(db, tenant, abo) {
  return abfrage(
    db,
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level, stripe_subscription_id)
     VALUES ($1, 'active', 'Mandant Test', 'Mandant', 'card', $2)`,
    [tenant, abo],
  );
}

async function umgebungMitDatenbank(t) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return null;
  const gestartet = [];
  t.after(() => Promise.all(gestartet.map((prozess) => prozess.stop())));
  const env = gemeinsameUmgebung(db.adresse, UMGEBUNG);
  const starten = async () => {
    const prozess = await startServer({ env });
    gestartet.push(prozess);
    return prozess;
  };
  const erster = await starten();
  await erster.stop();
  return { db, starten };
}

function abfrage(db, sql, parameter) {
  return alsVerwaltung(db, async (verbindung) => (await verbindung.query(sql, parameter)).rows);
}

const status = async (db, tenant) => (await abfrage(db, MANDANT_SQL, [tenant]))[0].status;
const sperrzeilen = (...prozesse) =>
  prozesse.reduce((summe, prozess) => summe + (prozess.stdout.match(SUSPEND_ZEILE) ?? []).length, 0);

async function mitAbo(t) {
  const umgebung = await umgebungMitDatenbank(t);
  if (!umgebung) return null;
  const tenant = frischeKennung("t_register");
  const abo = frischeKennung("sub_register");
  await anlegen(umgebung.db, tenant, abo);
  return { ...umgebung, tenant, abo };
}

test(
  "Stripe-Register: dasselbe Abo-Ende gleichzeitig an zwei Prozesse sperrt den Mandanten genau einmal",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await mitAbo(t);
    if (!umgebung) return;
    const { db, tenant, abo } = umgebung;
    const a = await umgebung.starten();
    const b = await umgebung.starten();
    const koerper = ereignis({ id: "evt_gleichzeitig", tenant, abo, created: NEU_S });

    const antworten = await Promise.all([senden(a, koerper), senden(b, koerper)]);

    for (const antwort of antworten) {
      assert.equal(antwort.status, HTTP_OK);
      assert.deepEqual(await antwort.json(), { received: true });
    }
    assert.equal(sperrzeilen(a, b), 1);
    assert.equal(await status(db, tenant), "suspended");
  },
);

test(
  "Stripe-Register: dasselbe Abo-Ende nacheinander an A und B wirkt einmal und B antwortet 200",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await mitAbo(t);
    if (!umgebung) return;
    const { db, tenant, abo } = umgebung;
    const a = await umgebung.starten();
    const b = await umgebung.starten();
    const koerper = ereignis({ id: "evt_nacheinander", tenant, abo, created: NEU_S });

    assert.equal((await senden(a, koerper)).status, HTTP_OK);
    assert.equal((await senden(b, koerper)).status, HTTP_OK);

    assert.equal(sperrzeilen(a, b), 1);
    assert.equal(await status(db, tenant), "suspended");
  },
);

test(
  "Stripe-Register: nach Neustart eines Prozesses wirkt dasselbe Abo-Ende kein zweites Mal",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await mitAbo(t);
    if (!umgebung) return;
    const { tenant, abo } = umgebung;
    const koerper = ereignis({ id: "evt_neustart", tenant, abo, created: NEU_S });
    const vorher = await umgebung.starten();
    assert.equal((await senden(vorher, koerper)).status, HTTP_OK);
    await vorher.stop();

    const nachher = await umgebung.starten();
    const antwort = await senden(nachher, koerper);

    assert.equal(antwort.status, HTTP_OK);
    assert.equal(sperrzeilen(nachher), 0);
  },
);

for (const [erster, zweiter] of [["a", "b"], ["b", "a"]]) {
  test(
    `Stripe-Register: das ältere Abo-Ende nach dem neueren wird bei ${zweiter} verworfen (zuerst ${erster})`,
    { timeout: ZEITGRENZE_MS },
    async (t) => {
      const umgebung = await mitAbo(t);
      if (!umgebung) return;
      const { db, tenant, abo } = umgebung;
      const prozesse = { a: await umgebung.starten(), b: await umgebung.starten() };
      const neu = ereignis({ id: `evt_neu_${erster}`, tenant, abo, created: NEU_S });
      const alt = ereignis({ id: `evt_alt_${erster}`, tenant, abo, created: ALT_S });

      assert.equal((await senden(prozesse[erster], neu)).status, HTTP_OK);
      const antwort = await senden(prozesse[zweiter], alt);

      assert.equal(antwort.status, HTTP_OK);
      assert.equal(sperrzeilen(prozesse.a, prozesse.b), 1);
      const zeilen = await abfrage(db, REGISTER_SQL);
      assert.deepEqual(
        zeilen.map(({ ereignis_id: id, erstellt_s: s }) => [id, Number(s)]),
        [[`evt_neu_${erster}`, NEU_S]],
      );
    },
  );
}

test(
  "Stripe-Register: scheitert das Schreiben des Mandanten, antwortet 503 ohne Registerzeile und die Wiederholung wirkt einmal",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await mitAbo(t);
    if (!umgebung) return;
    const { db, tenant, abo } = umgebung;
    const prozess = await umgebung.starten();
    const koerper = ereignis({ id: "evt_scheitert", tenant, abo, created: NEU_S });
    await abfrage(db, TRIGGER_AN);

    const antwort = await senden(prozess, koerper);

    assert.equal(antwort.status, HTTP_UNAVAILABLE);
    assert.deepEqual(await antwort.json(), { error: "event not applied" });
    assert.deepEqual(await abfrage(db, REGISTER_SQL), []);

    await abfrage(db, TRIGGER_AUS);
    const wiederholung = await senden(prozess, koerper);

    assert.equal(wiederholung.status, HTTP_OK);
    assert.equal(await status(db, tenant), "suspended");
    assert.equal((await abfrage(db, REGISTER_SQL)).length, 1);
  },
);

test(
  "Stripe-Register: ein Ereignis für einen unbekannten Mandanten schreibt keine Registerzeile und wirkt nach dem Anlegen und Neustart",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await mitAbo(t);
    if (!umgebung) return;
    const { db } = umgebung;
    const tenant = frischeKennung("t_spaeter");
    const abo = frischeKennung("sub_spaeter");
    const koerper = ereignis({ id: "evt_spaeter", tenant, abo, created: NEU_S });
    const erster = await umgebung.starten();

    const antwort = await senden(erster, koerper);

    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(await abfrage(db, REGISTER_SQL), []);
    await erster.stop();
    await anlegen(db, tenant, abo);
    const zweiter = await umgebung.starten();
    assert.equal((await senden(zweiter, koerper)).status, HTTP_OK);
    assert.equal(await status(db, tenant), "suspended");
    assert.equal(sperrzeilen(zweiter), 1);
  },
);

test(
  "Stripe-Register: acht gleichzeitige Ereignisse verschiedener Abos antworten alle 200 und /healthz bleibt 200",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await mitAbo(t);
    if (!umgebung) return;
    const { db } = umgebung;
    const koerper = [];
    for (let i = 0; i < GLEICHZEITIG; i += 1) {
      const tenant = frischeKennung("t_viele");
      const abo = frischeKennung("sub_viele");
      await anlegen(db, tenant, abo);
      koerper.push(ereignis({ id: `evt_viele_${i}`, tenant, abo, created: NEU_S }));
    }
    const prozess = await umgebung.starten();

    const antworten = await Promise.all(koerper.map((text) => senden(prozess, text)));
    const gesund = await abrufMitFrist(`${prozess.localUrl}/healthz`);

    assert.deepEqual(antworten.map((antwort) => antwort.status), Array(GLEICHZEITIG).fill(HTTP_OK));
    assert.equal(gesund.status, HTTP_OK);
    assert.equal(sperrzeilen(prozess), GLEICHZEITIG);
  },
);
