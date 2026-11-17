import assert from "node:assert/strict";
import { test } from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { kriteriumLauf } from "../gemeinsam/kriterium-lauf.mjs";
import {
  mitDatenbankVorDemStart,
  mitInstanzenAufPostgres,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const ABGELAUFEN_S = 300;
const GRENZE_S = 240;
const KURZER_TAKT_MS = "500";
const TAKT_FRIST_MS = 3_000;
const STANDARD_TAKT_ZEILE = "[webhook-zustellung] loeschtakt_ms=60000";
const KURZER_TAKT_ZEILE = `[webhook-zustellung] loeschtakt_ms=${KURZER_TAKT_MS}`;
const KRITERIUM_10_NAME = "K10";
const ALTER_ANKER = "anker_abgelaufen";
const FRISCHER_ANKER = "anker_vier_minuten";
const ZEILE_ANLEGEN_SQL = `INSERT INTO webhook_zustellung (anker, kennung, angenommen_um)
  VALUES ($1, 'kennung_test', now() - make_interval(secs => $2))`;
const ANKER_SQL = "SELECT anker FROM webhook_zustellung ORDER BY anker";
const ankerIn = async (sql) => (await sql(ANKER_SQL)).rows.map((zeile) => zeile.anker);

async function alteUndFrischeZeile(sql) {
  await sql(ZEILE_ANLEGEN_SQL, [ALTER_ANKER, ABGELAUFEN_S]);
  await sql(ZEILE_ANLEGEN_SQL, [FRISCHER_ANKER, GRENZE_S]);
}

const alteZeileWeg = (sql) => zeilenBis(() => ankerIn(sql), (anker) => !anker.includes(ALTER_ANKER));

test("K10: eine Instanz ohne Schlüssel löscht beim Start abgelaufene Zeilen, eine Zeile von 4 min bleibt", async (t) => {
  await mitDatenbankVorDemStart(
    t,
    { env: { WEBHOOK_ZUSTELLUNG_SECRET: "" } },
    async ({ sql, starte }) => {
      await alteUndFrischeZeile(sql);
      await starte();
      assert.deepEqual(await alteZeileWeg(sql), [FRISCHER_ANKER]);
    },
  );
});

test("K15: mit verkürztem Löschtakt ist eine nach dem Start eingefügte abgelaufene Zeile innerhalb von 3 s weg", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anzahl: 1, env: { WEBHOOK_ZUSTELLUNG_SECRET: "", WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: KURZER_TAKT_MS } },
    async ({ instanzen: [a], sql }) => {
      assert.ok(a.stdout.includes(KURZER_TAKT_ZEILE), `Startzeile fehlt:\n${a.stdout}`);
      await alteUndFrischeZeile(sql);
      assert.deepEqual(await alteZeileWeg(sql), [FRISCHER_ANKER]);
      await sql(ZEILE_ANLEGEN_SQL, [ALTER_ANKER, ABGELAUFEN_S]);
      const beginn = Date.now();
      assert.deepEqual(await alteZeileWeg(sql), [FRISCHER_ANKER]);
      assert.ok(Date.now() - beginn < TAKT_FRIST_MS, "der Takt löscht innerhalb von 3 s");
    },
  );
});

for (const [name, schluessel, ablage] of [
  ["mit Schlüssel", undefined, "datenbank"],
  ["ohne Schlüssel", "", "speicher"],
]) {
  test(`K15: ohne Löschtakt-Variable schreibt der Start ${name} loeschtakt_ms=60000 und ablage=${ablage}`, async (t) => {
    const env = schluessel === undefined ? {} : { WEBHOOK_ZUSTELLUNG_SECRET: schluessel };
    await mitInstanzenAufPostgres(t, { anzahl: 1, env }, async ({ instanzen: [a] }) => {
      const zeile = a.stdout.split("\n").find((text) => text.includes(STANDARD_TAKT_ZEILE));
      assert.ok(zeile, `Startzeile fehlt:\n${a.stdout}`);
      assert.ok(zeile.includes(`ablage=${ablage}`), `falsche Ablage: ${zeile}`);
    });
  });
}

test("K12: unter CI und ohne Postgres-Adresse schlägt der Aufbewahrungstest fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = kriteriumLauf("test/anrufe/webhook-zustellung-aufbewahrung.test.js", `${KRITERIUM_10_NAME}:`, umgebung);
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
