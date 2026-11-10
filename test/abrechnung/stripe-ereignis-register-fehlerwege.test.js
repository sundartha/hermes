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
