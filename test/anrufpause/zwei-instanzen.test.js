import { test } from "node:test";
import assert from "node:assert/strict";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitZweiHermesAufPostgres, neueAnrufe, postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";
import { pgliteAlsRolleOhneSuperuser, makePgStore } from "../pg-helpers.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const STATEMENT_FRIST_MS = 30_000;
const DEPLOY_TOKEN = "anrufpause-zwei-instanzen-token-0123456789";
const PAUSE_PFAD = "/intern/anrufpause";
const PAUSENTEXT = "Ausgehende Anrufe sind pausiert (Anrufpause).";
const PAUSEN_AUDIT = "grund=frozen quelle=anrufpause";
const TABELLE = "platform_anrufpause";
const TABELLE_VERSTECKT = "platform_anrufpause_versteckt";
const MIT_TOKEN = Object.freeze({ HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN });

const pauseAnfrage = (instanz, { methode = "GET", koerper } = {}) =>
  abrufMitFrist(`${instanz.localUrl}${PAUSE_PFAD}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${DEPLOY_TOKEN}`,
      ...(koerper === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });

async function pauseSetzen(instanz, an) {
  const res = await pauseAnfrage(instanz, { methode: "POST", koerper: { an } });
  assert.equal(res.status, HTTP_OK);
  assert.deepEqual(await res.json(), { an });
}

async function pauseLesen(instanz) {
  const res = await pauseAnfrage(instanz);
  assert.equal(res.status, HTTP_OK);
  return res.json();
}

const verstecken = (sql) => sql(`ALTER TABLE ${TABELLE} RENAME TO ${TABELLE_VERSTECKT}`);
const wiederherstellen = (sql) => sql(`ALTER TABLE ${TABELLE_VERSTECKT} RENAME TO ${TABELLE}`);

async function abgelehnt(instanz, rufeAn, anbieter) {
  const vorher = anbieter.starts().length;
  const res = await rufeAn(instanz);
  assert.equal(res.status, HTTP_FORBIDDEN);
  assert.equal((await res.json()).error, PAUSENTEXT);
  assert.equal(anbieter.starts().length, vorher, "die Attrappe zaehlt keinen Anrufstart");
  assert.match(instanz.stdout, new RegExp(`place_call_denied.*${PAUSEN_AUDIT}`));
}

test("Kriterium 12: eine Pause, die A setzt, lehnt den place_call ueber B sofort ab", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, { env: MIT_TOKEN }, async ({ a, b, anbieter }) => {
    const { rufeAn } = neueAnrufe();
    assert.equal((await rufeAn(b)).status, HTTP_OK, "Ausgangslage: ohne Pause startet B den Anruf");
    assert.equal(anbieter.starts().length, 1);

    await pauseSetzen(a, true);

    await abgelehnt(b, rufeAn, anbieter);
    await pauseSetzen(a, false);
    assert.equal((await rufeAn(b)).status, HTTP_OK, "aufgehoben auf A, startet B wieder");
    assert.equal(anbieter.starts().length, 2);
  });
});

test("Kriterium 13: der letzte Flush von B setzt die Pause nicht zurueck", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, { env: MIT_TOKEN }, async ({ a, b, starte, sql }) => {
    await pauseSetzen(a, true);

    await b.stop();
    const neueB = await starte();

    assert.deepEqual(await pauseLesen(a), { an: true });
    assert.deepEqual(await pauseLesen(neueB), { an: true });
    const { rows } = await sql(`SELECT an FROM ${TABELLE}`);
    assert.equal(rows[0].an, true);
  });
});

test("Kriterium 14: ist platform_anrufpause nicht lesbar, lehnt B jeden place_call ab", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, { env: MIT_TOKEN }, async ({ b, anbieter, sql }) => {
    const { rufeAn } = neueAnrufe();
    await verstecken(sql);
    try {
      await abgelehnt(b, rufeAn, anbieter);
      await abgelehnt(b, rufeAn, anbieter);
      assert.deepEqual(await pauseLesen(b), { an: true }, "GET meldet fail-closed die Pause");
      assert.match(b.stdout, /\[anrufpause\] nicht lesbar, gilt als aktiv/);
    } finally {
      await wiederherstellen(sql);
    }

    assert.equal((await rufeAn(b)).status, HTTP_OK, "wieder lesbar, startet B wieder");
    assert.equal(anbieter.starts().length, 1);
  });
});

test("Kriterium 14 (Frist): haengt das Lesen an einer Sperre, laeuft die Statement-Frist ab und B lehnt ab", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, { env: MIT_TOKEN }, async ({ b, anbieter, sql }) => {
    const { rufeAn } = neueAnrufe();
    await sql(`BEGIN`);
    await sql(`LOCK TABLE ${TABELLE} IN ACCESS EXCLUSIVE MODE`);
    try {
      const vorher = anbieter.starts().length;
      const res = await abrufMitFrist(
        `${b.localUrl}/api/calls`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: "+491511234999", objective: "Auftrag Frist" }),
        },
        { wartezeitMs: STATEMENT_FRIST_MS },
      );
      assert.equal(res.status, HTTP_FORBIDDEN);
      assert.equal((await res.json()).error, PAUSENTEXT);
      assert.equal(anbieter.starts().length, vorher, "die Attrappe zaehlt keinen Anrufstart");
    } finally {
      await sql(`ROLLBACK`);
    }

    assert.equal((await rufeAn(b)).status, HTTP_OK, "Sperre weg, startet B wieder");
  });
});

async function frischeInstanz(db) {
  const store = makePgStore({ withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (q) => db.exec(q) }) });
  await store.init();
  return store;
}

test("Kriterium 13 (Speicher): der Gesamt-Flush einer Instanz mit Kopie false schreibt platform_anrufpause nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await frischeInstanz(db);
  const b = await frischeInstanz(db);
  await db.query(`INSERT INTO ${TABELLE} (id, an) VALUES (1, true) ON CONFLICT (id) DO UPDATE SET an = true`);
  assert.equal(b.load().anrufpause, false, "Ausgangslage: Bs Kopie ist veraltet");

  b.save();
  await b.drainFlushes();
  a.save();
  await a.drainFlushes();

  const { rows } = await db.query(`SELECT an FROM ${TABELLE}`);
  assert.equal(rows[0].an, true);
});
