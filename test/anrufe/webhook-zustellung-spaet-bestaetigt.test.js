import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { starteHaltendesModell } from "./haltendes-modell.js";
import {
  antwortVon,
  mitZweiInstanzenUndCommitRelais,
  signierteZustellung,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANTWORT_FRIST_MS = 3_000;
const ANKER_JE_ZUSTELLUNG = 2;
const OHNE_ERKENNUNG_FRIST =
  "[webhook-idempotenz] wiederholte_zustellung weg=turn art=ohne_erkennung grund=frist";
const FREIGABE_SPAET = "[webhook-idempotenz] annahme_freigegeben weg=turn grund=spaet";
const KRITERIUM_NAME = "T2-K11";
const MODELL_GEDULD = { LLM_MAX_RETRIES: "0", LLM_REQUEST_TIMEOUT_MS: "10000" };
const ZEILEN_SQL = `SELECT count(*)::int AS zeilen, count(koerper)::int AS beantwortet FROM webhook_zustellung`;
const OFFEN_SQL = `SELECT count(*)::int AS offen FROM webhook_zustellung WHERE koerper IS NULL`;
const ANNAHME_ALTERN_SQL = `UPDATE webhook_zustellung SET angenommen_um = now() - make_interval(secs => $1)`;

const spracheingabe = (callId, token) => ({
  callId,
  token,
  felder: { CallSid: `CA_${callId}`, SpeechResult: "Hallo" },
});

const zeilenMit = (log, text) => log.split("\n").filter((zeile) => zeile.includes(text));

function nichtsGesprochenesImLog(log, marke) {
  for (const zeile of log.split("\n")) {
    assert.ok(!zeile.includes("Hallo"), `Gesprochenes im Log: ${zeile}`);
    assert.ok(!zeile.includes(marke), `Marke im Log: ${zeile}`);
  }
}

async function bisKeineOffeneAnnahme(sql) {
  return zeilenBis(
    async () => (await sql(OFFEN_SQL)).rows[0],
    (stand) => stand.offen === 0,
  );
}

async function logBis(instanz, text) {
  await zeilenBis(
    async () => instanz.stdout,
    (log) => log.includes(text),
  );
}

async function antwortInnerhalbVon3s(instanz, eingang) {
  const beginn = Date.now();
  const antwort = await antwortVon(instanz, eingang);
  assert.ok(Date.now() - beginn <= ANTWORT_FRIST_MS, `Antwort nach ${Date.now() - beginn} ms`);
  assert.equal(antwort.status, HTTP_OK);
  assert.match(antwort.xml, /<Gather/);
  return antwort;
}

test("T2-K11: bestätigt die Datenbank ein hängendes COMMIT erst nach der Frist, gibt A die Annahme sofort frei und B verarbeitet selbst", async (t) => {
  await mitZweiInstanzenUndCommitRelais(
    t,
    { anrufe: ["call_spaet0", "call_spaet1"], relaisBei: "a" },
    async ({ a, b, sql, signer, relais, modell }) => {
      await antwortVon(a, signierteZustellung(signer, spracheingabe("call_spaet0", "t0010")));
      await zeilenBis(
        async () => (await sql(ZEILEN_SQL)).rows[0],
        (stand) => stand.beantwortet === ANKER_JE_ZUSTELLUNG,
      );
      assert.equal(modell.count(), 1);

      relais.halteCommitNachInsert();
      const eingang = signierteZustellung(signer, spracheingabe("call_spaet1", "t0011"));
      await antwortInnerhalbVon3s(a, eingang);
      assert.equal(zeilenMit(a.stdout, OHNE_ERKENNUNG_FRIST).length, 1, a.stdout);
      nichtsGesprochenesImLog(a.stdout, "t0011");

      relais.fortsetzen();
      await relais.antwortUebergeben();
      assert.deepEqual(await bisKeineOffeneAnnahme(sql), { offen: 0 });
      await logBis(a, FREIGABE_SPAET);
      assert.equal(zeilenMit(a.stdout, FREIGABE_SPAET).length, 1, a.stdout);

      await antwortInnerhalbVon3s(b, eingang);
      assert.equal(modell.count(), 3);
    },
  );
});

test("T2-K12: bestätigt die Datenbank eine hängende Übernahme erst nach der Frist, gibt B die Annahme sofort frei", async (t) => {
  const modell = await starteHaltendesModell();
  try {
    const optionen = {
      anrufe: ["call_spaet_uebernahme"],
      relaisBei: "b",
      env: { ANTHROPIC_BASE_URL: modell.url, ...MODELL_GEDULD },
    };
    await mitZweiInstanzenUndCommitRelais(t, optionen, async ({ a, b, sql, signer, relais }) => {
      const eingang = signierteZustellung(signer, spracheingabe("call_spaet_uebernahme", "t0024"));
      const abbrechen = new AbortController();
      const vonA = antwortVon(a, {
        ...eingang,
        optionen: { ...eingang.optionen, signal: abbrechen.signal },
      });
      vonA.catch(() => {});
      await zeilenBis(
        async () => (await sql(ZEILEN_SQL)).rows[0],
        (stand) => stand.zeilen === ANKER_JE_ZUSTELLUNG && modell.count() >= 1,
      );
      await sql(ANNAHME_ALTERN_SQL, [14]);

      relais.halteCommitNachInsert();
      await antwortInnerhalbVon3s(b, eingang);
      assert.equal(zeilenMit(b.stdout, OHNE_ERKENNUNG_FRIST).length, 1, b.stdout);

      relais.fortsetzen();
      await relais.antwortUebergeben();
      assert.deepEqual(await bisKeineOffeneAnnahme(sql), { offen: 0 });
      await logBis(b, FREIGABE_SPAET);
      assert.equal(zeilenMit(b.stdout, FREIGABE_SPAET).length, 1, b.stdout);
      assert.equal(modell.count(), 2);
      abbrechen.abort();
      await assert.rejects(vonA);
    });
  } finally {
    await modell.close();
  }
});

test("T2-K13: unter CI und ohne Postgres-Adresse schlägt der Abnahmetest der späten Bestätigung fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = spawnSync(
    process.execPath,
    [
      "--test",
      `--test-name-pattern=${KRITERIUM_NAME}:`,
      "test/anrufe/webhook-zustellung-spaet-bestaetigt.test.js",
    ],
    { env: umgebung, encoding: "utf8" },
  );
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
