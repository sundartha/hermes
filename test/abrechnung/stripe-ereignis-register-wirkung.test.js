import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { STRIPE_REGISTER_SCHLUESSEL, STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";

const ZEITGRENZE_MS = 180_000;
const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const MS_JE_SEKUNDE = 1_000;
const NEU_S = 2000;
const HALTE_SPERRE = 7_700_001;
const SUSPEND_ZEILE = /stripe_webhook_suspend/g;
const REGISTER_SQL = `SELECT ereignis_id FROM stripe_ereignis_register WHERE ereignis_id IS NOT NULL`;
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

function alsVerwaltung(db, arbeit) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(db.adresse).pathname;
  return mitVerbindung(url.href, arbeit);
}

function abfrage(db, sql, parameter) {
  return alsVerwaltung(db, async (verbindung) => (await verbindung.query(sql, parameter)).rows);
}

function aboEnde(id, tenant = "t_wirkung", abo = "sub_wirkung") {
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

const senden = (prozess, id, ...ziel) => abrufMitFrist(`${prozess.localUrl}/webhooks/stripe`, aboEnde(id, ...ziel));
const sperrzeilen = (prozess) => (prozess.stdout.match(SUSPEND_ZEILE) ?? []).length;
const mandantStatus = async (db) => (await abfrage(db, "SELECT status FROM tenant WHERE id = 't_wirkung'"))[0].status;

async function umgebung(t) {
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
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const lauf = await umgebung(t);
    if (!lauf) return;
    const { db } = lauf;
    const sterbender = await lauf.starten();
    const anderer = await lauf.starten();
    await abfrage(db, TENANT_HAELT_AN);
    await alsVerwaltung(db, async (halter) => {
      await halter.query(`SELECT pg_advisory_lock(${HALTE_SPERRE})`);
      const antwort = senden(sterbender, "evt_stirbt").catch(() => null);
      await abfrage(db, WARTEN_BIS_ANGEHALTEN);
      await senden(sterbender, "evt_sonde", "t_unbekannt", "sub_unbekannt");
      const beendet = new Promise((fertig) => sterbender.child.once("exit", fertig));
      sterbender.child.kill("SIGKILL");
      await beendet;
      assert.equal(await antwort, null);
      assert.deepEqual(await abfrage(db, REGISTER_SQL), []);
      await halter.query(`SELECT pg_advisory_unlock(${HALTE_SPERRE})`);
    });
    await abfrage(db, TENANT_FREI);
    await abfrage(db, SPERRE_ABLAUFEN);

    const wiederholung = await senden(anderer, "evt_stirbt");

    assert.equal(wiederholung.status, HTTP_OK);
    assert.equal(sperrzeilen(anderer), 1);
    assert.equal(await mandantStatus(db), "suspended");
    assert.deepEqual(await abfrage(db, REGISTER_SQL), [{ ereignis_id: "evt_stirbt" }]);
  },
);

test(
  "Stripe-Register: scheitert nur das Eintragen nach dem Anwenden, antwortet 503 und die Wiederholung wirkt ein zweites Mal und trägt die Zeile ein",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const lauf = await umgebung(t);
    if (!lauf) return;
    const { db } = lauf;
    const prozess = await lauf.starten();
    await abfrage(db, EINTRAGEN_SCHEITERT);

    const erster = await senden(prozess, "evt_eintragen");

    assert.equal(erster.status, HTTP_UNAVAILABLE);
    assert.deepEqual(await erster.json(), { error: "event not applied" });
    assert.equal(await mandantStatus(db), "suspended");
    assert.equal(sperrzeilen(prozess), 1);
    assert.deepEqual(await abfrage(db, REGISTER_SQL), []);

    await abfrage(db, EINTRAGEN_FREI);
    const wiederholung = await senden(prozess, "evt_eintragen");

    assert.equal(wiederholung.status, HTTP_OK);
    assert.equal(sperrzeilen(prozess), 2);
    assert.deepEqual(await abfrage(db, REGISTER_SQL), [{ ereignis_id: "evt_eintragen" }]);
  },
);
