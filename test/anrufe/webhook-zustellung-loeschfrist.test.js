import assert from "node:assert/strict";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { kriteriumLauf } from "../gemeinsam/kriterium-lauf.mjs";
import { wartendeAufAblage } from "./wartende-auf-ablage.js";
import { mitInstanzenAufPostgres, zeilenBis } from "./zwei-instanzen-postgres.js";

const ABLAGE_TABELLE = "webhook_zustellung";
const KURZER_TAKT_MS = "500";
const SPERRDAUER_MS = 3_000;
const WARTE_GRENZE_MS = 1_500;
const MAX_WARTENDE = 3;
const FEHLER_FRIST_MS = 2_000;
const LOESCH_FRIST_MS = 3_000;
const ABGELAUFEN_S = 300;
const GRENZE_S = 240;
const ALTER_ANKER = "anker_abgelaufen";
const FRISCHER_ANKER = "anker_vier_minuten";
const LOESCHFEHLER_ZEILE = "[webhook-zustellung] loeschen_fehlgeschlagen";
const KRITERIUM_NAME = "L1";
const ENV_KURZER_TAKT = { WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: KURZER_TAKT_MS };
const ZEILE_ANLEGEN_SQL = `INSERT INTO webhook_zustellung (anker, kennung, angenommen_um)
  VALUES ($1, 'kennung_test', now() - make_interval(secs => $2))`;
const ANKER_SQL = "SELECT anker FROM webhook_zustellung ORDER BY anker";

const ankerIn = async (sql) => (await sql(ANKER_SQL)).rows.map((zeile) => zeile.anker);

async function haltSperre(sql, dauerMs) {
  await sql("BEGIN");
  await sql(`LOCK TABLE ${ABLAGE_TABELLE} IN ACCESS EXCLUSIVE MODE`);
  const beginn = Date.now();
  await echtWarten(dauerMs);
  return beginn;
}

async function wartendeAmEnde(sql) {
  const beginn = await haltSperre(sql, SPERRDAUER_MS);
  const wartende = await wartendeAufAblage(sql);
  return { beginn, wartende };
}

test("L1: nach 3 s Sperre wartet keine Sitzung des Löschtakts länger als 1,5 s", async (t) => {
  await mitInstanzenAufPostgres(t, { anzahl: 1, env: ENV_KURZER_TAKT }, async ({ sql }) => {
    try {
      const { wartende } = await wartendeAmEnde(sql);
      for (const zeile of wartende) {
        assert.ok(Number(zeile.wartet_ms) <= WARTE_GRENZE_MS, `Sitzung wartet seit ${zeile.wartet_ms} ms`);
      }
    } finally {
      await sql("ROLLBACK");
    }
  });
});

test("L2: nach 3 s Sperre warten höchstens 3 Sitzungen auf die Tabelle", async (t) => {
  await mitInstanzenAufPostgres(t, { anzahl: 1, env: ENV_KURZER_TAKT }, async ({ sql }) => {
    try {
      const { wartende } = await wartendeAmEnde(sql);
      assert.ok(wartende.length <= MAX_WARTENDE, `${wartende.length} Sitzungen warten`);
    } finally {
      await sql("ROLLBACK");
    }
  });
});

test("L3: spätestens 2 s nach Sperrbeginn steht loeschen_fehlgeschlagen im Log, ohne Anker oder Körper", async (t) => {
  await mitInstanzenAufPostgres(t, { anzahl: 1, env: ENV_KURZER_TAKT }, async ({ instanzen: [a], sql }) => {
    await sql("BEGIN");
    try {
      await sql(`LOCK TABLE ${ABLAGE_TABELLE} IN ACCESS EXCLUSIVE MODE`);
      const beginn = Date.now();
      const log = await zeilenBis(async () => a.stdout, (text) => text.includes(LOESCHFEHLER_ZEILE));
      assert.ok(log.includes(LOESCHFEHLER_ZEILE), `Fehlerzeile fehlt:\n${log}`);
      assert.ok(Date.now() - beginn <= FEHLER_FRIST_MS, "Fehlerzeile später als 2 s nach Sperrbeginn");
      for (const zeile of log.split("\n").filter((text) => text.includes(LOESCHFEHLER_ZEILE))) {
        assert.match(zeile, /code=\w+$/, `unerwartete Zeile: ${zeile}`);
      }
    } finally {
      await sql("ROLLBACK");
    }
  });
});

test("L4: nach Ende der Sperre ist die Zeile von 5 min innerhalb von 3 s weg, die von 4 min bleibt", async (t) => {
  await mitInstanzenAufPostgres(t, { anzahl: 1, env: ENV_KURZER_TAKT }, async ({ sql }) => {
    await sql("BEGIN");
    await sql(`LOCK TABLE ${ABLAGE_TABELLE} IN ACCESS EXCLUSIVE MODE`);
    await echtWarten(SPERRDAUER_MS);
    await sql("ROLLBACK");
    await sql(ZEILE_ANLEGEN_SQL, [ALTER_ANKER, ABGELAUFEN_S]);
    await sql(ZEILE_ANLEGEN_SQL, [FRISCHER_ANKER, GRENZE_S]);
    const beginn = Date.now();
    const uebrig = await zeilenBis(() => ankerIn(sql), (anker) => !anker.includes(ALTER_ANKER));
    assert.deepEqual(uebrig, [FRISCHER_ANKER]);
    assert.ok(Date.now() - beginn < LOESCH_FRIST_MS, "der Löschtakt löscht innerhalb von 3 s");
  });
});

test("L5: unter CI und ohne Postgres-Adresse schlägt der Löschfrist-Abnahmetest fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = kriteriumLauf("test/anrufe/webhook-zustellung-loeschfrist.test.js", `${KRITERIUM_NAME}:`, umgebung);
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
