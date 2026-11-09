import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { makeStripeEreignisRegister } from "../../src/store/stripe-ereignis-register.js";
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

function signierteAnfrage(koerper) {
  const zeit = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const mac = createHmac("sha256", GEHEIMNIS).update(`${zeit}.${koerper}`).digest("hex");
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` },
    body: koerper,
  };
}

function senden(prozess, koerper) {
  return abrufMitFrist(`${prozess.localUrl}${STRIPE_PFAD}`, signierteAnfrage(koerper));
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

const SPERRE_SETZEN_SQL = `
  INSERT INTO stripe_ereignis_register (schluessel, ereignis_id, erstellt_s, aktion, sperre_inhaber, sperre_bis)
  VALUES ($1, $2, $3, 'suspend', 'fremder-prozess', now() + ($4::int * interval '1 second'))`;
const REGISTER_ZEILE_SQL = `SELECT sperre_inhaber FROM stripe_ereignis_register WHERE schluessel = $1`;
const SPERRE_DAUER_S = 3600;
const SPERRE_ABGELAUFEN_S = -60;
const WARTEZEIT_MINDESTENS_MS = 30_000;
const WARTEZEIT_HOECHSTENS_MS = 60_000;

test(
  "Stripe-Register: eine fremde, nicht abgelaufene Sperre lässt das Ereignis nach der Wartezeit mit 503 scheitern",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await mitAbo(t);
    if (!umgebung) return;
    const { db, tenant, abo } = umgebung;
    const prozess = await umgebung.starten();
    await abfrage(db, SPERRE_SETZEN_SQL, [abo, "evt_vorher", ALT_S, SPERRE_DAUER_S]);
    const koerper = ereignis({ id: "evt_gesperrt", tenant, abo, created: NEU_S });
    const beginn = Date.now();

    const antwort = await abrufMitFrist(`${prozess.localUrl}${STRIPE_PFAD}`, signierteAnfrage(koerper), { wartezeitMs: WARTEZEIT_HOECHSTENS_MS });
    const dauer = Date.now() - beginn;

    assert.equal(antwort.status, HTTP_UNAVAILABLE);
    assert.ok(dauer >= WARTEZEIT_MINDESTENS_MS, `gewartet ${dauer} ms`);
    assert.match(prozess.stdout, /stripe event lock busy/);
    assert.equal(await status(db, tenant), "active");
    assert.deepEqual(await abfrage(db, REGISTER_ZEILE_SQL, [abo]), [{ sperre_inhaber: "fremder-prozess" }]);
  },
);

test(
  "Stripe-Register: eine abgelaufene fremde Sperre wird übernommen und gibt den Stand des älteren Ereignisses frei",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await mitAbo(t);
    if (!umgebung) return;
    const { db, tenant, abo } = umgebung;
    const prozess = await umgebung.starten();
    await abfrage(db, SPERRE_SETZEN_SQL, [abo, "evt_vorher", NEU_S, SPERRE_ABGELAUFEN_S]);

    const veraltet = await senden(prozess, ereignis({ id: "evt_veraltet", tenant, abo, created: ALT_S }));

    assert.equal(veraltet.status, HTTP_OK);
    assert.equal(await status(db, tenant), "active");
    assert.deepEqual(await abfrage(db, REGISTER_ZEILE_SQL, [abo]), [{ sperre_inhaber: null }]);
    const neu = await senden(prozess, ereignis({ id: "evt_neuer", tenant, abo, created: NEU_S + 1 }));
    assert.equal(neu.status, HTTP_OK);
    assert.equal(await status(db, tenant), "suspended");
  },
);

test(
  "Stripe-Register: ein Geld-Ereignis für einen unbekannten Kunden schreibt keine Registerzeile",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await mitAbo(t);
    if (!umgebung) return;
    const { db } = umgebung;
    const prozess = await umgebung.starten();
    const koerper = JSON.stringify({
      id: "evt_geld_unbekannt",
      type: "charge.dispute.created",
      created: NEU_S,
      data: { object: { customer: frischeKennung("cus_unbekannt") } },
    });

    const antwort = await senden(prozess, koerper);

    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(await abfrage(db, REGISTER_SQL), []);
  },
);

const SPERRE_WARTE_GRENZE_MS = 35_000;
const SPERRE_TAKT_MS = 50;
const ABFRAGE_OBERGRENZE = 10_000;
const SPERRE_ZEILE = { ereignis_id: null, erstellt_s: null, aktion: null };

function registerMitUhr(freiAbMs) {
  const uhr = { zeit: 0, abfragen: 0 };
  const runner = {
    withClient: async (arbeit) =>
      arbeit({
        query: async (sql) => {
          if (!sql.includes("INSERT INTO stripe_ereignis_register")) return { rows: [] };
          uhr.abfragen += 1;
          assert.ok(uhr.abfragen < ABFRAGE_OBERGRENZE, "Sperre wartet ohne Ende");
          return { rows: uhr.zeit >= freiAbMs ? [SPERRE_ZEILE] : [] };
        },
      }),
  };
  const register = makeStripeEreignisRegister(runner, {
    now: () => uhr.zeit,
    sleep: async (ms) => {
      uhr.zeit += ms;
    },
  });
  return { uhr, register };
}

test("Stripe-Register: eine belegte Sperre gibt nach genau 35 Sekunden mit Fehler auf", async () => {
  const { uhr, register } = registerMitUhr(SPERRE_WARTE_GRENZE_MS + SPERRE_TAKT_MS);

  await assert.rejects(register.mitSchluessel("k", async () => "fertig"), /stripe event lock busy/);

  assert.equal(uhr.zeit, SPERRE_WARTE_GRENZE_MS);
});

test("Stripe-Register: eine Sperre, die einen Takt vor der Frist frei wird, wird noch genommen", async () => {
  const { register } = registerMitUhr(SPERRE_WARTE_GRENZE_MS - SPERRE_TAKT_MS);

  assert.equal(await register.mitSchluessel("k", async () => "fertig"), "fertig");
});

test("Stripe-Register: eine Sperre, die genau zur Frist frei wird, wird noch genommen", async () => {
  const { register } = registerMitUhr(SPERRE_WARTE_GRENZE_MS);

  assert.equal(await register.mitSchluessel("k", async () => "fertig"), "fertig");
});
