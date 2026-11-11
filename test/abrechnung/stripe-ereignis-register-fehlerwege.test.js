import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import * as regeln from "../../src/store/stripe-ereignis-regeln.js";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { STRIPE_REGISTER_SCHLUESSEL, STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";

const MS_JE_SEKUNDE = 1_000;
const WARTEGRENZE_MS = 10_000;
const ANTWORTGRENZE_MS = 12_000;
const TAKT_MS = 50;

function steuerbareUhr() {
  let jetzt = 0;
  return {
    jetzt: () => jetzt,
    schlafen: async (ms) => {
      jetzt += ms;
    },
  };
}

test("Stripe-Fehlerwege: belegte Sperre gibt nach der Wartegrenze auf, nicht erst nach Ablauf plus Zugabe", async () => {
  const uhr = steuerbareUhr();
  let versuche = 0;

  await assert.rejects(
    regeln.wartenBisFrei({ versuch: async () => (versuche += 1, null), ...uhr }),
    /stripe event lock busy/,
  );

  assert.ok(uhr.jetzt() >= WARTEGRENZE_MS, `gewartet ${uhr.jetzt()} ms`);
  assert.ok(uhr.jetzt() <= ANTWORTGRENZE_MS - MS_JE_SEKUNDE, `gewartet ${uhr.jetzt()} ms`);
  assert.ok(versuche > 1);
});

test("Stripe-Fehlerwege: wird die Sperre kurz vor der Wartegrenze frei, kommt das Ereignis noch dran", async () => {
  const uhr = steuerbareUhr();
  const zeile = { ereignis_id: "evt_vorher" };

  const ergebnis = await regeln.wartenBisFrei({
    versuch: async () => (uhr.jetzt() >= WARTEGRENZE_MS - TAKT_MS * 2 ? zeile : null),
    ...uhr,
  });

  assert.equal(ergebnis, zeile);
});

test("Stripe-Fehlerwege: eine freie Sperre wird ohne Warten genommen", async () => {
  const uhr = steuerbareUhr();
  const zeile = { ereignis_id: null };

  const ergebnis = await regeln.wartenBisFrei({ versuch: async () => zeile, ...uhr });

  assert.equal(ergebnis, zeile);
  assert.equal(uhr.jetzt(), 0);
});

const ZEITGRENZE_MS = 120_000;
const HTTP_UNAVAILABLE = 503;
const REGISTERFRIST_MS = 5_000;
const SPERRZEILE = /stripe_webhook_suspend/;
const NEU_S = 2000;
const UMGEBUNG = {
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: STRIPE_REGISTER_SCHLUESSEL,
  STRIPE_WEBHOOK_SECRET: STRIPE_ROUTEN_GEHEIMNIS,
  NUMBER_SETUP_FEE_CENTS: "500",
  SESSION_SECRET: "stripe-register-sitzungsgeheimnis-mind-32-zeichen",
  OIDC_CLIENT_ID: "stripe-register-client",
  OIDC_CLIENT_SECRET: "stripe-register-client-geheimnis",
  STRIPE_STARTER_PRICE_ID: "price_test_starter",
  STRIPE_BUSINESS_PRICE_ID: "price_test_business",
};

function alsVerwaltung(db, arbeit) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(db.adresse).pathname;
  return mitVerbindung(url.href, arbeit);
}

function abfrage(db, sql, parameter) {
  return alsVerwaltung(db, async (verbindung) => (await verbindung.query(sql, parameter)).rows);
}

function aboEnde(tenant, abo, id) {
  const koerper = JSON.stringify({
    id,
    type: "customer.subscription.deleted",
    created: NEU_S,
    data: { object: { id: abo, metadata: { tenant_ref: tenant } } },
  });
  const zeit = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const mac = createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${koerper}`).digest("hex");
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` },
    body: koerper,
  };
}

async function laufenderProzess(t) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return null;
  const gestartet = [];
  t.after(() => Promise.all(gestartet.map((prozess) => prozess.stop())));
  const env = gemeinsameUmgebung(db.adresse, UMGEBUNG);
  const ersterStart = await startServer({ env });
  await ersterStart.stop();
  await abfrage(
    db,
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level, stripe_subscription_id)
     VALUES ('t_frist', 'active', 'Mandant Test', 'Mandant', 'card', 'sub_frist')`,
  );
  const prozess = await startServer({ env });
  gestartet.push(prozess);
  return { db, prozess };
}

const mandantStatus = async (db) => (await abfrage(db, "SELECT status FROM tenant WHERE id = 't_frist'"))[0].status;

test(
  "Stripe-Fehlerwege: hängt die Registerabfrage an einer Tabellensperre, antwortet der Webhook nach der Registerfrist mit 503 und wendet nichts an",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await laufenderProzess(t);
    if (!umgebung) return;
    const { db, prozess } = umgebung;
    await alsVerwaltung(db, async (sperrer) => {
      await sperrer.query("BEGIN");
      await sperrer.query("LOCK TABLE stripe_ereignis_register IN ACCESS EXCLUSIVE MODE");

      const antwort = await abrufMitFrist(
        `${prozess.localUrl}/webhooks/stripe`,
        aboEnde("t_frist", "sub_frist", "evt_haengt"),
        { wartezeitMs: REGISTERFRIST_MS },
      );

      assert.equal(antwort.status, HTTP_UNAVAILABLE);
      assert.deepEqual(await antwort.json(), { error: "event not applied" });
      await sperrer.query("ROLLBACK");
    });
    assert.doesNotMatch(prozess.stdout, SPERRZEILE);
    assert.equal(await mandantStatus(db), "active");
  },
);

test(
  "Stripe-Fehlerwege: nach der Registerfrist wirkt dieselbe Wiederholung, sobald die Tabelle frei ist",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await laufenderProzess(t);
    if (!umgebung) return;
    const { db, prozess } = umgebung;
    const senden = () => abrufMitFrist(`${prozess.localUrl}/webhooks/stripe`, aboEnde("t_frist", "sub_frist", "evt_wieder"), { wartezeitMs: REGISTERFRIST_MS });
    await alsVerwaltung(db, async (sperrer) => {
      await sperrer.query("BEGIN");
      await sperrer.query("LOCK TABLE stripe_ereignis_register IN ACCESS EXCLUSIVE MODE");
      assert.equal((await senden()).status, HTTP_UNAVAILABLE);
      await sperrer.query("ROLLBACK");
    });

    const wiederholung = await senden();

    assert.equal(wiederholung.status, 200);
    assert.equal(await mandantStatus(db), "suspended");
    const zeilen = await abfrage(db, "SELECT ereignis_id FROM stripe_ereignis_register WHERE ereignis_id IS NOT NULL");
    assert.deepEqual(zeilen, [{ ereignis_id: "evt_wieder" }]);
  },
);

test(
  "Stripe-Fehlerwege: ist die Datenbank nicht erreichbar, antwortet der Webhook 503 und wendet nichts an",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const umgebung = await laufenderProzess(t);
    if (!umgebung) return;
    const { db, prozess } = umgebung;
    const datenbank = new URL(db.adresse).pathname.slice(1);
    await mitVerbindung(process.env[POSTGRES_VARIABLE], (verwaltung) =>
      verwaltung.query(`DROP DATABASE ${datenbank} WITH (FORCE)`),
    );

    const antwort = await abrufMitFrist(
      `${prozess.localUrl}/webhooks/stripe`,
      aboEnde("t_frist", "sub_frist", "evt_ohne_db"),
      { wartezeitMs: REGISTERFRIST_MS },
    );

    assert.equal(antwort.status, HTTP_UNAVAILABLE);
    assert.deepEqual(await antwort.json(), { error: "event not applied" });
    assert.doesNotMatch(prozess.stdout, SPERRZEILE);
  },
);

const WIRKUNG_ZEITGRENZE_MS = 180_000;
const HTTP_OK = 200;
const HALTE_SPERRE = 7_700_001;
const SUSPEND_ZEILE = /stripe_webhook_suspend/g;
const REGISTER_SQL = `SELECT ereignis_id FROM stripe_ereignis_register WHERE ereignis_id IS NOT NULL`;
const TENANT_HAELT_AN = `
  CREATE FUNCTION tenant_haelt_an_fn() RETURNS trigger AS $$
  BEGIN PERFORM pg_advisory_lock(${HALTE_SPERRE}); PERFORM pg_advisory_unlock(${HALTE_SPERRE}); RETURN NEW; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER tenant_haelt_an BEFORE UPDATE ON tenant
    FOR EACH ROW WHEN (OLD.stripe_subscription_id IS NOT NULL AND NEW.stripe_subscription_id IS NULL) EXECUTE FUNCTION tenant_haelt_an_fn();`;
const SPERRE_ABLAUFEN = `UPDATE stripe_ereignis_register SET sperre_bis = now() - interval '1 second' WHERE sperre_inhaber IS NOT NULL`;
const TENANT_FREI = `DROP TRIGGER tenant_haelt_an ON tenant;`;
const WARTEN_BIS_ANGEHALTEN = `
  DO $$ BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = ${HALTE_SPERRE})
    LOOP PERFORM pg_sleep(0.05); END LOOP;
  END $$;`;
const EINTRAGEN_SCHEITERT = `
  CREATE FUNCTION eintragen_scheitert_fn() RETURNS trigger AS $$
  BEGIN RAISE EXCEPTION 'eintragen verweigert'; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER eintragen_scheitert BEFORE UPDATE ON stripe_ereignis_register
    FOR EACH ROW WHEN (NEW.ereignis_id IS DISTINCT FROM OLD.ereignis_id) EXECUTE FUNCTION eintragen_scheitert_fn();`;
const EINTRAGEN_FREI = `DROP TRIGGER eintragen_scheitert ON stripe_ereignis_register;`;

function aboEndeMitId(id, tenant = "t_wirkung", abo = "sub_wirkung") {
  const koerper = JSON.stringify({
    id,
    type: "customer.subscription.deleted",
    created: NEU_S,
    data: { object: { id: abo, metadata: { tenant_ref: tenant } } },
  });
  const zeit = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const mac = createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${koerper}`).digest("hex");
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` },
    body: koerper,
  };
}

const sendenMitId = (prozess, id, ...ziel) => abrufMitFrist(`${prozess.localUrl}/webhooks/stripe`, aboEndeMitId(id, ...ziel));
const wirkungSperrzeilen = (prozess) => (prozess.stdout.match(SUSPEND_ZEILE) ?? []).length;
const wirkungMandantStatus = async (db) => (await abfrage(db, "SELECT status FROM tenant WHERE id = 't_wirkung'"))[0].status;

async function wirkungUmgebung(t) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return null;
  const gestartet = [];
  t.after(() => Promise.all(gestartet.filter((prozess) => prozess.child.signalCode === null).map((prozess) => prozess.stop())));
  const env = gemeinsameUmgebung(db.adresse, UMGEBUNG);
  const starten = async () => {
    const prozess = await startServer({ env });
    gestartet.push(prozess);
    return prozess;
  };
  await (await starten()).stop();
  await abfrage(
    db,
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level, stripe_subscription_id)
     VALUES ('t_wirkung', 'active', 'Mandant Test', 'Mandant', 'card', 'sub_wirkung')`,
  );
  return { db, starten };
}

test(
  "Stripe-Register: stirbt ein Prozess vor dem Ende der Speicherung, fehlt die Registerzeile und die Wiederholung an den anderen Prozess wirkt einmal",
  { timeout: WIRKUNG_ZEITGRENZE_MS },
  async (t) => {
    const lauf = await wirkungUmgebung(t);
    if (!lauf) return;
    const { db } = lauf;
    const sterbender = await lauf.starten();
    const anderer = await lauf.starten();
    await abfrage(db, TENANT_HAELT_AN);
    await alsVerwaltung(db, async (halter) => {
      await halter.query(`SELECT pg_advisory_lock(${HALTE_SPERRE})`);
      const antwort = sendenMitId(sterbender, "evt_stirbt").catch(() => null);
      await abfrage(db, WARTEN_BIS_ANGEHALTEN);
      await sendenMitId(sterbender, "evt_sonde", "t_unbekannt", "sub_unbekannt");
      const beendet = new Promise((fertig) => sterbender.child.once("exit", fertig));
      sterbender.child.kill("SIGKILL");
      await beendet;
      assert.equal(await antwort, null);
      assert.deepEqual(await abfrage(db, REGISTER_SQL), []);
      await halter.query(`SELECT pg_advisory_unlock(${HALTE_SPERRE})`);
    });
    await abfrage(db, TENANT_FREI);
    await abfrage(db, SPERRE_ABLAUFEN);

    const wiederholung = await sendenMitId(anderer, "evt_stirbt");

    assert.equal(wiederholung.status, HTTP_OK);
    assert.equal(wirkungSperrzeilen(anderer), 1);
    assert.equal(await wirkungMandantStatus(db), "suspended");
    assert.deepEqual(await abfrage(db, REGISTER_SQL), [{ ereignis_id: "evt_stirbt" }]);
  },
);

test(
  "Stripe-Register: scheitert nur das Eintragen nach dem Anwenden, antwortet 503 und die Wiederholung wirkt ein zweites Mal und trägt die Zeile ein",
  { timeout: WIRKUNG_ZEITGRENZE_MS },
  async (t) => {
    const lauf = await wirkungUmgebung(t);
    if (!lauf) return;
    const { db } = lauf;
    const prozess = await lauf.starten();
    await abfrage(db, EINTRAGEN_SCHEITERT);

    const erster = await sendenMitId(prozess, "evt_eintragen");

    assert.equal(erster.status, HTTP_UNAVAILABLE);
    assert.deepEqual(await erster.json(), { error: "event not applied" });
    assert.equal(await wirkungMandantStatus(db), "suspended");
    assert.equal(wirkungSperrzeilen(prozess), 1);
    assert.deepEqual(await abfrage(db, REGISTER_SQL), []);

    await abfrage(db, EINTRAGEN_FREI);
    const wiederholung = await sendenMitId(prozess, "evt_eintragen");

    assert.equal(wiederholung.status, HTTP_OK);
    assert.equal(wirkungSperrzeilen(prozess), 2);
    assert.deepEqual(await abfrage(db, REGISTER_SQL), [{ ereignis_id: "evt_eintragen" }]);
  },
);

async function halterStirbtMitten(lauf, id) {
  const sterbender = await lauf.starten();
  await abfrage(lauf.db, TENANT_HAELT_AN);
  await alsVerwaltung(lauf.db, async (halter) => {
    await halter.query(`SELECT pg_advisory_lock(${HALTE_SPERRE})`);
    const antwort = sendenMitId(sterbender, id).catch(() => null);
    await abfrage(lauf.db, WARTEN_BIS_ANGEHALTEN);
    const beendet = new Promise((fertig) => sterbender.child.once("exit", fertig));
    sterbender.child.kill("SIGKILL");
    await beendet;
    assert.equal(await antwort, null);
    await halter.query(`SELECT pg_advisory_unlock(${HALTE_SPERRE})`);
  });
  await abfrage(lauf.db, TENANT_FREI);
}

test(
  "Stripe-Register: nach dem Tod des Halters wirkt die Zustellung nach Ablauf der Sperre genau einmal",
  { timeout: WIRKUNG_ZEITGRENZE_MS },
  async (t) => {
    const lauf = await wirkungUmgebung(t);
    if (!lauf) return;
    const { db } = lauf;
    await halterStirbtMitten(lauf, "evt_halter_tot");
    const anderer = await lauf.starten();
    const sperrenVorher = await abfrage(db, "SELECT sperre_inhaber FROM stripe_ereignis_register WHERE sperre_inhaber IS NOT NULL");
    assert.equal(sperrenVorher.length, 1);
    await abfrage(db, SPERRE_ABLAUFEN);

    const zustellung = await sendenMitId(anderer, "evt_halter_tot");
    const erneut = await sendenMitId(anderer, "evt_halter_tot");

    assert.equal(zustellung.status, HTTP_OK);
    assert.equal(erneut.status, HTTP_OK);
    assert.equal(wirkungSperrzeilen(anderer), 1);
    assert.equal(await wirkungMandantStatus(db), "suspended");
    assert.deepEqual(await abfrage(db, REGISTER_SQL), [{ ereignis_id: "evt_halter_tot" }]);
    assert.deepEqual(await abfrage(db, "SELECT sperre_inhaber FROM stripe_ereignis_register WHERE sperre_inhaber IS NOT NULL"), []);
  },
);
