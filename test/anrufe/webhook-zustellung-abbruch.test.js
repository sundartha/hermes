import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { starteHaltendesModell } from "./haltendes-modell.js";
import { antwortVon, mitInstanzenAufPostgres, signierteZustellung, zeilenBis } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANTWORT_FRIST_MS = 3_000;
const FREIGABE_FRIST_MS = 1_000;
const AUFRAEUM_FRIST_MS = 3_000;
const SPERRE_NACH_ANTWORT_MS = 1_500;
const NACHLAUF_MS = 1_000;
const ANKER_JE_ZUSTELLUNG = 2;
const FREIGABE_ZEILE = "[webhook-idempotenz] annahme_freigegeben weg=turn grund=";
const ZEILEN_SQL = `SELECT count(*)::int AS zeilen, count(koerper)::int AS beantwortet FROM webhook_zustellung`;
const OFFEN_SQL = `SELECT count(*)::int AS offen FROM webhook_zustellung WHERE koerper IS NULL`;
const KRITERIUM_NAME = "B2-K6";

const spracheingabe = (callId, token) => ({
  callId,
  token,
  felder: { CallSid: `CA_${callId}`, SpeechResult: "Hallo" },
});

const zeilenMit = (log, text) => log.split("\n").filter((zeile) => zeile.includes(text));

async function mitHaltendemModell(t, anrufe, lauf) {
  const modell = await starteHaltendesModell();
  try {
    await mitInstanzenAufPostgres(
      t,
      { anrufe, env: { ANTHROPIC_BASE_URL: modell.url, LLM_MAX_RETRIES: "0", LLM_REQUEST_TIMEOUT_MS: "10000" } },
      (umgebung) => lauf({ ...umgebung, modell }),
    );
  } finally {
    await modell.close();
  }
}

async function bisModellErreicht(modell) {
  await zeilenBis(
    async () => modell.count(),
    (anzahl) => anzahl >= 1,
  );
}

test("B2-K6: bricht Telnyx die Verbindung vor der Antwort ab, ist die Annahme sofort frei und B verarbeitet selbst", async (t) => {
  await mitHaltendemModell(t, ["call_abbruch"], async ({ instanzen: [a, b], sql, signer, modell }) => {
    const eingang = signierteZustellung(signer, spracheingabe("call_abbruch", "t0006"));
    const abbrechen = new AbortController();
    const abgebrochen = antwortVon(a, { ...eingang, optionen: { ...eingang.optionen, signal: abbrechen.signal } });
    await bisModellErreicht(modell);
    abbrechen.abort();
    await assert.rejects(abgebrochen);
    assert.equal(modell.count(), 1, "A hatte die Zustellung angenommen und rechnete");

    const abbruch = Date.now();
    const stand = await zeilenBis(
      async () => (await sql(ZEILEN_SQL)).rows[0],
      (zeilen) => zeilen.zeilen === 0,
    );
    assert.deepEqual(stand, { zeilen: 0, beantwortet: 0 });
    assert.ok(Date.now() - abbruch <= FREIGABE_FRIST_MS, "innerhalb von 1 s nach dem Abbruch");
    const abbruchZeilen = await zeilenBis(
      async () => zeilenMit(a.stdout, FREIGABE_ZEILE),
      (zeilen) => zeilen.length >= 1,
    );
    assert.equal(abbruchZeilen.length, 1, a.stdout);
    assert.equal(zeilenMit(a.stdout, `${FREIGABE_ZEILE}abbruch`).length, 1, a.stdout);

    const beginn = Date.now();
    const antwort = await antwortVon(b, eingang);
    assert.ok(Date.now() - beginn <= ANTWORT_FRIST_MS, "B antwortet innerhalb von 3 s");
    assert.equal(antwort.status, HTTP_OK);
    assert.match(antwort.xml, /<Gather/);
    assert.equal(modell.count(), 2);
  });
});

test("B2-K6b: scheitert das Ablegen, wird die Annahme frei und B verarbeitet selbst", async (t) => {
  await mitHaltendemModell(t, ["call_ablegen"], async ({ instanzen: [a, b], sql, signer, modell }) => {
    const eingang = signierteZustellung(signer, spracheingabe("call_ablegen", "t0017"));
    const vonA = antwortVon(a, eingang);
    await bisModellErreicht(modell);
    await sql("BEGIN");
    try {
      await sql("LOCK TABLE webhook_zustellung IN ACCESS EXCLUSIVE MODE");
      modell.loslassen();
      const antwort = await vonA;
      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.xml, /<Gather/);
      await echtWarten(SPERRE_NACH_ANTWORT_MS);
    } finally {
      await sql("COMMIT");
    }
    const freigegeben = Date.now();
    const stand = await zeilenBis(
      async () => (await sql(OFFEN_SQL)).rows[0],
      (zeilen) => zeilen.offen === 0,
    );
    assert.deepEqual(stand, { offen: 0 });
    assert.ok(Date.now() - freigegeben <= AUFRAEUM_FRIST_MS, "innerhalb von 3 s nach der Sperre");
    const ablegenZeilen = await zeilenBis(
      async () => zeilenMit(a.stdout, `${FREIGABE_ZEILE}ablegen_fehlgeschlagen`),
      (zeilen) => zeilen.length >= 1,
    );
    assert.equal(ablegenZeilen.length, 1, a.stdout);

    const beginn = Date.now();
    const vonB = await antwortVon(b, eingang);
    assert.ok(Date.now() - beginn <= ANTWORT_FRIST_MS, "B antwortet innerhalb von 3 s");
    assert.equal(vonB.status, HTTP_OK);
    assert.match(vonB.xml, /<Gather/);
    assert.equal(modell.count(), 2);
  });
});

test("B2-K6c: scheitert auch die Freigabe, bleibt es bei einer Zeile ohne Erkennung und A antwortet trotzdem", async (t) => {
  await mitHaltendemModell(t, ["call_frei"], async ({ instanzen: [a], sql, signer, modell }) => {
    const eingang = signierteZustellung(signer, spracheingabe("call_frei", "t0018"));
    const abbrechen = new AbortController();
    const abgebrochen = antwortVon(a, { ...eingang, optionen: { ...eingang.optionen, signal: abbrechen.signal } });
    await bisModellErreicht(modell);
    await sql("BEGIN");
    try {
      await sql("LOCK TABLE webhook_zustellung IN ACCESS EXCLUSIVE MODE");
      abbrechen.abort();
      await assert.rejects(abgebrochen);
      const fehlgeschlagen = await zeilenBis(
        async () => zeilenMit(a.stdout, "art=ohne_erkennung grund=frist"),
        (zeilen) => zeilen.length >= 1,
      );
      assert.equal(fehlgeschlagen.length, 1, a.stdout);
      assert.equal(zeilenMit(a.stdout, FREIGABE_ZEILE).length, 0, a.stdout);
    } finally {
      await sql("ROLLBACK");
    }
    assert.equal((await sql(OFFEN_SQL)).rows[0].offen, ANKER_JE_ZUSTELLUNG);
  });
});

test("B7: eine abgelegte Antwort bleibt nach dem Ende der Verbindung und B liefert sie ohne neuen Modellaufruf", async (t) => {
  await mitHaltendemModell(t, ["call_bleibt"], async ({ instanzen: [a, b], sql, signer, modell }) => {
    const eingang = signierteZustellung(signer, spracheingabe("call_bleibt", "t0016"));
    const antwortA = antwortVon(a, eingang);
    await bisModellErreicht(modell);
    modell.loslassen();
    const vonA = await antwortA;
    assert.match(vonA.xml, /<Gather/);
    await zeilenBis(
      async () => (await sql(ZEILEN_SQL)).rows[0],
      (zeilen) => zeilen.beantwortet === ANKER_JE_ZUSTELLUNG,
    );
    await echtWarten(NACHLAUF_MS);
    assert.deepEqual((await sql(ZEILEN_SQL)).rows[0], { zeilen: ANKER_JE_ZUSTELLUNG, beantwortet: ANKER_JE_ZUSTELLUNG });
    assert.equal(zeilenMit(a.stdout, "annahme_freigegeben").length, 0, a.stdout);

    const vonB = await antwortVon(b, eingang);
    assert.equal(vonB.xml, vonA.xml);
    assert.equal(modell.count(), 1);
  });
});

test("B2-K6d: ohne Annahme in der Datenbank gibt ein Abbruch nichts frei und A läuft weiter", async (t) => {
  await mitHaltendemModell(t, ["call_ohne"], async ({ instanzen: [a], sql, signer, modell }) => {
    await sql("DROP TABLE webhook_zustellung");
    const eingang = signierteZustellung(signer, spracheingabe("call_ohne", "t0019"));
    const abbrechen = new AbortController();
    const abgebrochen = antwortVon(a, { ...eingang, optionen: { ...eingang.optionen, signal: abbrechen.signal } });
    await bisModellErreicht(modell);
    abbrechen.abort();
    await assert.rejects(abgebrochen);
    await echtWarten(NACHLAUF_MS);
    assert.equal(zeilenMit(a.stdout, "annahme_freigegeben").length, 0, a.stdout);
    assert.equal(zeilenMit(a.stdout, "[guard] uncaughtException").length, 0, a.stdout);
    const gesund = await abrufMitFrist(`${a.localUrl}/healthz`);
    assert.equal(gesund.status, HTTP_OK);
  });
});

test("B2-K12: unter CI und ohne Postgres-Adresse schlägt der Abbruch-Abnahmetest fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = spawnSync(
    process.execPath,
    ["--test", `--test-name-pattern=${KRITERIUM_NAME}:`, "test/anrufe/webhook-zustellung-abbruch.test.js"],
    { env: umgebung, encoding: "utf8" },
  );
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
