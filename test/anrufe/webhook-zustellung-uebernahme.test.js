import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { starteHaltendesModell } from "./haltendes-modell.js";
import { antwortVon, mitInstanzenAufPostgres, signierteZustellung, zeilenBis } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANTWORT_FRIST_MS = 3_000;
const WIEDERHOLUNG_FRIST_MS = 1_000;
const FRUEHESTENS_MS = 2_500;
const SPAETESTENS_MS = 4_500;
const WARTE_MIN_MS = 500;
const WARTE_MAX_MS = 1_500;
const ABBRUCH_NACH_MS = 500;
const ANKER_JE_ZUSTELLUNG = 2;
const UEBERNOMMEN = "[webhook-idempotenz] wiederholte_zustellung weg=turn art=uebernommen warte_ms=";
const ANNAHME_ALTERN_SQL = `UPDATE webhook_zustellung SET angenommen_um = now() - make_interval(secs => $1)`;
const ZEILEN_SQL = `SELECT count(*)::int AS zeilen, count(koerper)::int AS beantwortet FROM webhook_zustellung`;
const KRITERIUM_NAME = "B3-K7";
const MODELL_GEDULD = { LLM_MAX_RETRIES: "0", LLM_REQUEST_TIMEOUT_MS: "10000" };

const spracheingabe = (callId, token, felder = { SpeechResult: "Hallo" }) => ({
  callId,
  token,
  felder: { CallSid: `CA_${callId}`, ...felder },
});

const zeilenMit = (log, text) => log.split("\n").filter((zeile) => zeile.includes(text));

async function mitHaltendemModell(t, anrufe, lauf) {
  const modell = await starteHaltendesModell();
  try {
    await mitInstanzenAufPostgres(t, { anrufe, env: { ANTHROPIC_BASE_URL: modell.url, ...MODELL_GEDULD } }, (umgebung) =>
      lauf({ ...umgebung, modell }),
    );
  } finally {
    await modell.close();
  }
}

async function bisAngenommen({ modell, sql }) {
  await zeilenBis(
    async () => modell.count(),
    (anzahl) => anzahl >= 1,
  );
  const stand = await zeilenBis(
    async () => (await sql(ZEILEN_SQL)).rows[0],
    (zeilen) => zeilen.zeilen === ANKER_JE_ZUSTELLUNG,
  );
  assert.deepEqual(stand, { zeilen: ANKER_JE_ZUSTELLUNG, beantwortet: 0 });
}

function mitAbbruch(eingang) {
  const abbrechen = new AbortController();
  return { abbrechen, eingang: { ...eingang, optionen: { ...eingang.optionen, signal: abbrechen.signal } } };
}

async function abbrechen({ abbruch, vonA }) {
  abbruch.abbrechen.abort();
  await assert.rejects(vonA);
}

async function uebernahmeNach({ a, b, sql, signer, modell }, { callId, token, alterS }) {
  const eingang = signierteZustellung(signer, spracheingabe(callId, token));
  const abbruch = mitAbbruch(eingang);
  const vonA = antwortVon(a, abbruch.eingang);
  await bisAngenommen({ modell, sql });
  await sql(ANNAHME_ALTERN_SQL, [alterS]);
  const beginn = Date.now();
  const antwort = await antwortVon(b, eingang);
  return { eingang, abbruch, vonA, antwort, dauerMs: Date.now() - beginn };
}

test("B3-K7: eine Annahme ohne Antwort, die 14 s alt ist, übernimmt B nach 1 s mit eigenem XML und meldet die Wartezeit", async (t) => {
  await mitHaltendemModell(t, ["call_uebernahme"], async ({ instanzen: [a, b], sql, signer, modell }) => {
    const uebernahme = await uebernahmeNach(
      { a, b, sql, signer, modell },
      { callId: "call_uebernahme", token: "t0004", alterS: 14 },
    );
    const { antwort, dauerMs } = uebernahme;
    assert.ok(dauerMs <= ANTWORT_FRIST_MS, `B antwortet innerhalb von 3 s (${dauerMs} ms)`);
    assert.equal(antwort.status, HTTP_OK);
    assert.match(antwort.xml, /<Gather/);
    assert.equal(modell.count(), 2);
    const stand = await zeilenBis(
      async () => (await sql(ZEILEN_SQL)).rows[0],
      (zeilen) => zeilen.beantwortet === ANKER_JE_ZUSTELLUNG,
    );
    assert.deepEqual(stand, { zeilen: ANKER_JE_ZUSTELLUNG, beantwortet: ANKER_JE_ZUSTELLUNG });

    const zeilen = zeilenMit(b.stdout, UEBERNOMMEN);
    assert.equal(zeilen.length, 1, b.stdout);
    const warteMs = Number(zeilen[0].split(UEBERNOMMEN)[1]);
    assert.ok(warteMs >= WARTE_MIN_MS && warteMs <= WARTE_MAX_MS, `warte_ms=${warteMs}`);
    assert.equal(zeilenMit(b.stdout, "art=neu_verarbeitet").length, 0, b.stdout);
    await abbrechen(uebernahme);
  });
});

test("B3-K8: die Wartezeit zählt ab der Annahme, bei 12 s Alter antwortet B nach etwa 3 s", async (t) => {
  await mitHaltendemModell(t, ["call_grenze"], async ({ instanzen: [a, b], sql, signer, modell }) => {
    const uebernahme = await uebernahmeNach(
      { a, b, sql, signer, modell },
      { callId: "call_grenze", token: "t0005", alterS: 12 },
    );
    const { antwort, dauerMs } = uebernahme;
    assert.equal(antwort.status, HTTP_OK);
    assert.match(antwort.xml, /<Gather/);
    assert.ok(dauerMs >= FRUEHESTENS_MS, `nicht vor 2,5 s (${dauerMs} ms)`);
    assert.ok(dauerMs <= SPAETESTENS_MS, `spätestens nach 4,5 s (${dauerMs} ms)`);
    assert.equal(modell.count(), 2);
    await abbrechen(uebernahme);
  });
});

test("B3-K9: die Antwort von B gilt auch an A, das nach dem Abbruch dieselbe Marke mit anderem Körper bekommt", async (t) => {
  await mitHaltendemModell(t, ["call_gilt"], async ({ instanzen: [a, b], sql, signer, modell }) => {
    const { eingang, abbruch, vonA, antwort: vonB } = await uebernahmeNach(
      { a, b, sql, signer, modell },
      { callId: "call_gilt", token: "t0004", alterS: 14 },
    );
    assert.equal(modell.count(), 2);
    abbruch.abbrechen.abort();
    await assert.rejects(vonA);

    const andererKoerper = signierteZustellung(signer, spracheingabe("call_gilt", "t0004", { Redirect: "1" }));
    assert.notEqual(andererKoerper.optionen.body, eingang.optionen.body);
    const beginn = Date.now();
    const wiederholt = await antwortVon(a, andererKoerper);
    assert.ok(Date.now() - beginn <= WIEDERHOLUNG_FRIST_MS, "A antwortet innerhalb von 1 s");
    assert.equal(wiederholt.status, HTTP_OK);
    assert.equal(wiederholt.xml, vonB.xml);
    assert.equal(modell.count(), 2);
  });
});

test("B3-K10: verschwindet die Annahme beim Warten, verarbeitet B selbst und seine Antwort gilt auch an A", async (t) => {
  await mitHaltendemModell(t, ["call_verschwindet"], async ({ instanzen: [a, b], sql, signer, modell }) => {
    const eingang = signierteZustellung(signer, spracheingabe("call_verschwindet", "t0014"));
    const abbruch = mitAbbruch(eingang);
    const vonA = antwortVon(a, abbruch.eingang);
    await bisAngenommen({ modell, sql });
    const vonB = antwortVon(b, eingang);
    await echtWarten(ABBRUCH_NACH_MS);
    assert.equal(modell.count(), 1, "B wartet noch auf die Annahme von A");
    const abbruchZeit = Date.now();
    abbruch.abbrechen.abort();
    await assert.rejects(vonA);

    const antwort = await vonB;
    assert.ok(Date.now() - abbruchZeit <= ANTWORT_FRIST_MS, "B antwortet innerhalb von 3 s nach dem Abbruch");
    assert.equal(antwort.status, HTTP_OK);
    assert.match(antwort.xml, /<Gather/);
    assert.equal(modell.count(), 2);

    const andererKoerper = signierteZustellung(signer, spracheingabe("call_verschwindet", "t0014", { Redirect: "1" }));
    const wiederholt = await antwortVon(a, andererKoerper);
    assert.equal(wiederholt.xml, antwort.xml);
    assert.equal(modell.count(), 2);
  });
});

test("B3-K12: unter CI und ohne Postgres-Adresse schlägt der Übernahme-Abnahmetest fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = spawnSync(
    process.execPath,
    ["--test", `--test-name-pattern=${KRITERIUM_NAME}:`, "test/anrufe/webhook-zustellung-uebernahme.test.js"],
    { env: umgebung, encoding: "utf8" },
  );
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
