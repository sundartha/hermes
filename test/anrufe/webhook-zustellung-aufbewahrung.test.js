import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { kriteriumLauf } from "../gemeinsam/kriterium-lauf.mjs";
import {
  antwortVon,
  mitDatenbankVorDemStart,
  mitInstanzenAufPostgres,
  signierteZustellung,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ABGELAUFEN_S = 300;
const GRENZE_S = 240;
const KURZER_TAKT_MS = "500";
const TAKT_FRIST_MS = 3_000;
const STANDARD_TAKT_ZEILE = "[webhook-zustellung] loeschtakt_ms=60000";
const KURZER_TAKT_ZEILE = `[webhook-zustellung] loeschtakt_ms=${KURZER_TAKT_MS}`;
const LOESCHFEHLER_ZEILE = "[webhook-zustellung] loeschen_fehlgeschlagen";
const GESPROCHEN = "Ich möchte einen Termin";
const KRITERIUM_10_NAME = "K10";
const ALTER_ANKER = "anker_abgelaufen";
const FRISCHER_ANKER = "anker_vier_minuten";
const ZEILE_ANLEGEN_SQL = `INSERT INTO webhook_zustellung (anker, kennung, angenommen_um)
  VALUES ($1, 'kennung_test', now() - make_interval(secs => $2))`;
const ANKER_SQL = "SELECT anker FROM webhook_zustellung ORDER BY anker";
const BEANTWORTET_SQL =
  "SELECT count(*)::int AS anzahl FROM webhook_zustellung WHERE koerper IS NOT NULL";
const ZURUECKDATIEREN_SQL =
  "UPDATE webhook_zustellung SET angenommen_um = now() - make_interval(secs => $1)";

const spracheingabe = (callId, token, gesagt) => ({
  callId,
  token,
  felder: { CallSid: `CA_${callId}`, SpeechResult: gesagt },
});

const ankerIn = async (sql) => (await sql(ANKER_SQL)).rows.map((zeile) => zeile.anker);

async function alteUndFrischeZeile(sql) {
  await sql(ZEILE_ANLEGEN_SQL, [ALTER_ANKER, ABGELAUFEN_S]);
  await sql(ZEILE_ANLEGEN_SQL, [FRISCHER_ANKER, GRENZE_S]);
}

const alteZeileWeg = (sql) => zeilenBis(() => ankerIn(sql), (anker) => !anker.includes(ALTER_ANKER));

async function vonAZurueckdatiert({ instanzen: [a], sql, signer }, { callId, sekunden }) {
  const vonA = await antwortVon(a, signierteZustellung(signer, spracheingabe(callId, "t0003", GESPROCHEN)));
  assert.match(vonA.xml, /<Gather/);
  await zeilenBis(
    async () => (await sql(BEANTWORTET_SQL)).rows[0].anzahl,
    (anzahl) => anzahl > 0,
  );
  await sql(ZURUECKDATIEREN_SQL, [sekunden]);
  return vonA;
}

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

test("K11: liegt die Annahme 5 min zurück, verarbeitet B selbst und die Attrappe zählt 2", async (t) => {
  await mitInstanzenAufPostgres(t, { anrufe: ["call_k11"] }, async (lauf) => {
    await vonAZurueckdatiert(lauf, { callId: "call_k11", sekunden: ABGELAUFEN_S });
    const vonB = await antwortVon(
      lauf.instanzen[1],
      signierteZustellung(lauf.signer, spracheingabe("call_k11", "t0003", GESPROCHEN)),
    );
    assert.equal(vonB.status, HTTP_OK);
    assert.match(vonB.xml, /<Gather/);
    assert.equal(lauf.modell.count(), 2, "B hat die abgelaufene Annahme nicht wiederholt");
  });
});

test("K11 Grenzkontrolle: liegt die Annahme 4 min zurück, liefert B das XML von A byte-gleich und die Attrappe bleibt bei 1", async (t) => {
  await mitInstanzenAufPostgres(t, { anrufe: ["call_k11g"] }, async (lauf) => {
    const vonA = await vonAZurueckdatiert(lauf, { callId: "call_k11g", sekunden: GRENZE_S });
    const vonB = await antwortVon(
      lauf.instanzen[1],
      signierteZustellung(lauf.signer, spracheingabe("call_k11g", "t0003", GESPROCHEN)),
    );
    assert.equal(vonB.status, HTTP_OK);
    assert.equal(vonB.xml, vonA.xml);
    assert.equal(lauf.modell.count(), 1);
  });
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

test("K16: ohne Schlüssel und ohne Tabelle stört der Löschfehler weder Start noch Anruf", async (t) => {
  await mitDatenbankVorDemStart(
    t,
    { anrufe: ["call_k16"], env: { WEBHOOK_ZUSTELLUNG_SECRET: "" } },
    async ({ sql, signer, starte }) => {
      await sql("DROP TABLE webhook_zustellung");
      const a = await starte();
      assert.equal((await abrufMitFrist(`${a.localUrl}/healthz`)).status, HTTP_OK);
      const antwort = await antwortVon(a, signierteZustellung(signer, spracheingabe("call_k16", "t0010", "Hallo")));
      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.xml, /<Gather/);
      await zeilenBis(async () => a.stdout, (log) => log.includes(LOESCHFEHLER_ZEILE));
      assert.ok(a.stdout.includes(LOESCHFEHLER_ZEILE), `der Löschfehler ist nicht geloggt:\n${a.stdout}`);
      for (const zeile of a.stdout.split("\n")) {
        assert.ok(!zeile.includes("t0010"), `Marke im Log: ${zeile}`);
        assert.ok(!zeile.includes("Hallo"), `Gesprochenes im Log: ${zeile}`);
      }
    },
  );
});

test("K12: unter CI und ohne Postgres-Adresse schlägt der Aufbewahrungstest fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = kriteriumLauf("test/anrufe/webhook-zustellung-aufbewahrung.test.js", `${KRITERIUM_10_NAME}:`, umgebung);
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
