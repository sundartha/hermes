import assert from "node:assert/strict";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { starteHaltendesModell } from "./haltendes-modell.js";
import {
  antwortVon,
  mitInstanzenAufPostgres,
  signierteZustellung,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANKER_JE_ZUSTELLUNG = 2;
const ALTER_S = 14;
const WARTEN_AUF_ABLAGE_MS = 700;
const MODELL_GEDULD = { LLM_MAX_RETRIES: "0", LLM_REQUEST_TIMEOUT_MS: "10000" };
const UEBERNOMMEN = "art=uebernommen";
const NEU_VERARBEITET = "art=neu_verarbeitet";
const ZEILEN_SQL = `SELECT count(*)::int AS zeilen FROM webhook_zustellung`;
const ALTERN_SQL = `UPDATE webhook_zustellung SET angenommen_um = now() - make_interval(secs => $1)`;
const LOESCHEN_SPERREN_SQL = `CREATE FUNCTION loeschen_sperren() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'loeschen gesperrt'; END $$;
  CREATE TRIGGER loeschen_sperren BEFORE DELETE ON webhook_zustellung
  FOR EACH ROW EXECUTE FUNCTION loeschen_sperren()`;
const FREIGABE_ZAEHLEN_SQL = `CREATE SEQUENCE loeschen_zaehler;
  CREATE FUNCTION loeschen_zaehlen() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  AS $$ BEGIN PERFORM nextval('loeschen_zaehler'); RETURN NULL; END $$;
  CREATE TRIGGER loeschen_zaehlen AFTER DELETE ON webhook_zustellung
  FOR EACH STATEMENT EXECUTE FUNCTION loeschen_zaehlen()`;
const ZAEHLER_SQL = `SELECT CASE WHEN is_called THEN last_value ELSE 0 END::int AS anzahl FROM loeschen_zaehler`;

const zeilenMit = (log, text) => log.split("\n").filter((zeile) => zeile.includes(text));

async function mitHaltendemModell(t, { callId, anzahl = 2 }, lauf) {
  const modell = await starteHaltendesModell();
  try {
    await mitInstanzenAufPostgres(
      t,
      { anzahl, anrufe: [callId], env: { ANTHROPIC_BASE_URL: modell.url, ...MODELL_GEDULD } },
      (umgebung) =>
        lauf({
          ...umgebung,
          modell,
          eingang: signierteZustellung(umgebung.signer, {
            callId,
            token: "t0004",
            felder: { CallSid: `CA_${callId}`, SpeechResult: "Hallo" },
          }),
        }),
    );
  } finally {
    await modell.close();
  }
}

async function annahmeVonA({ a, sql, modell, eingang }) {
  const abbrechen = new AbortController();
  const vonA = antwortVon(a, {
    ...eingang,
    optionen: { ...eingang.optionen, signal: abbrechen.signal },
  });
  vonA.catch(() => {});
  await zeilenBis(
    async () => modell.count(),
    (anzahl) => anzahl >= 1,
  );
  await zeilenBis(
    async () => (await sql(ZEILEN_SQL)).rows[0].zeilen,
    (zeilen) => zeilen === ANKER_JE_ZUSTELLUNG,
  );
  return async () => {
    abbrechen.abort();
    await vonA.catch(() => {});
  };
}

test("B3-K13: scheitert die Übernahme in der Datenbank, verarbeitet B selbst und meldet die neue Verarbeitung", async (t) => {
  await mitHaltendemModell(
    t,
    { callId: "call_uebernahme_fehler" },
    async ({ instanzen: [a, b], sql, modell, eingang }) => {
      const beenden = await annahmeVonA({ a, sql, modell, eingang });
      await sql(LOESCHEN_SPERREN_SQL);
      await sql(ALTERN_SQL, [ALTER_S]);
      const antwort = await antwortVon(b, eingang);
      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.xml, /<Gather/);
      assert.equal(modell.count(), 2);
      assert.equal(zeilenMit(b.stdout, NEU_VERARBEITET).length, 1, b.stdout);
      assert.equal(zeilenMit(b.stdout, UEBERNOMMEN).length, 0, b.stdout);
      await beenden();
    },
  );
});

test("B3-K14: übernehmen zwei wartende Instanzen zugleich, meldet nur der Gewinner die Übernahme", async (t) => {
  await mitHaltendemModell(
    t,
    { callId: "call_uebernahme_zwei", anzahl: 3 },
    async ({ instanzen: [a, b, c], sql, modell, eingang }) => {
      const beenden = await annahmeVonA({ a, sql, modell, eingang });
      await sql(ALTERN_SQL, [ALTER_S]);
      const [vonB, vonC] = await Promise.all([antwortVon(b, eingang), antwortVon(c, eingang)]);
      assert.equal(vonB.status, HTTP_OK);
      assert.equal(vonC.status, HTTP_OK);
      assert.match(vonB.xml, /<Gather/);
      assert.match(vonC.xml, /<Gather/);
      const gemeldet =
        zeilenMit(b.stdout, UEBERNOMMEN).length + zeilenMit(c.stdout, UEBERNOMMEN).length;
      assert.equal(gemeldet, 1, `${b.stdout}\n${c.stdout}`);
      await beenden();
    },
  );
});

test("B3-K15: liegt die Antwort der annehmenden Instanz beim Warten vor, übernimmt B nicht", async (t) => {
  await mitHaltendemModell(
    t,
    { callId: "call_antwort_liegt_vor" },
    async ({ instanzen: [a, b], sql, modell, eingang }) => {
      const beenden = await annahmeVonA({ a, sql, modell, eingang });
      await sql(FREIGABE_ZAEHLEN_SQL);
      const vonB = antwortVon(b, eingang);
      await zeilenBis(
        async () => (await sql(ZAEHLER_SQL)).rows[0].anzahl,
        (anzahl) => anzahl >= 1,
      );
      modell.loslassen();
      const antwort = await vonB;
      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.xml, /<Gather/);
      assert.equal(modell.count(), 1);
      assert.deepEqual((await sql(ZAEHLER_SQL)).rows[0], { anzahl: 1 });
      assert.equal(zeilenMit(b.stdout, UEBERNOMMEN).length, 0, b.stdout);
      await beenden();
    },
  );
});

test("B3-K16: wartet B mit anderem Körper auf die Annahme von A, bleibt in der Ablage nur die Annahme von A und B übernimmt dessen Antwort", async (t) => {
  await mitHaltendemModell(
    t,
    { callId: "call_anderer_koerper" },
    async ({ instanzen: [a, b], sql, signer, modell, eingang }) => {
      const beenden = await annahmeVonA({ a, sql, modell, eingang });
      const anderer = signierteZustellung(signer, {
        callId: "call_anderer_koerper",
        token: "t0004",
        felder: { CallSid: "CA_call_anderer_koerper", Redirect: "1" },
      });
      const vonB = antwortVon(b, anderer);
      await echtWarten(WARTEN_AUF_ABLAGE_MS);
      assert.equal(modell.count(), 1);
      assert.deepEqual((await sql(ZEILEN_SQL)).rows[0], { zeilen: ANKER_JE_ZUSTELLUNG });
      modell.loslassen();
      const antwort = await vonB;
      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.xml, /<Gather/);
      assert.deepEqual((await sql(ZEILEN_SQL)).rows[0], { zeilen: ANKER_JE_ZUSTELLUNG });
      await beenden();
    },
  );
});
