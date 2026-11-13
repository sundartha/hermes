import assert from "node:assert/strict";
import { test } from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { kriteriumLauf } from "../gemeinsam/kriterium-lauf.mjs";
import {
  antwortVon,
  mitZweiInstanzenUndCommitRelais,
  signierteZustellung,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const OHNE_ERKENNUNG = "[webhook-idempotenz] wiederholte_zustellung weg=turn art=ohne_erkennung";
const KRITERIUM_NAME = "SF-K1";
const ANKER_JE_ZUSTELLUNG = 2;
const FREIGABE_SPERRE_SQL = `
  CREATE FUNCTION freigabe_sperre() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'freigabe gesperrt'; END $$;
  CREATE TRIGGER freigabe_sperre BEFORE DELETE ON webhook_zustellung FOR EACH ROW EXECUTE FUNCTION freigabe_sperre()`;
const OFFEN_SQL = `SELECT count(*)::int AS offen FROM webhook_zustellung WHERE koerper IS NULL`;

const spracheingabe = (callId, token) => ({
  callId,
  token,
  felder: { CallSid: `CA_${callId}`, SpeechResult: "Hallo" },
});

const zeilenMit = (log, text) => log.split("\n").filter((zeile) => zeile.includes(text));

test("SF-K1: scheitert die späte Freigabe nach einer erst nach der Frist bestätigten Annahme, steht art=ohne_erkennung grund=fehler im Log", async (t) => {
  await mitZweiInstanzenUndCommitRelais(t, { anrufe: ["call_sf0", "call_sf1"], relaisBei: "a" }, async ({ a, sql, signer, relais }) => {
    await antwortVon(a, signierteZustellung(signer, spracheingabe("call_sf0", "t0089")));
    await sql(FREIGABE_SPERRE_SQL);
    relais.halteCommitNachInsert();
    const eingang = signierteZustellung(signer, spracheingabe("call_sf1", "t0090"));
    await antwortVon(a, eingang);
    assert.equal(zeilenMit(a.stdout, `${OHNE_ERKENNUNG} grund=frist`).length, 1, a.stdout);
    assert.equal(zeilenMit(a.stdout, `${OHNE_ERKENNUNG} grund=fehler`).length, 0, a.stdout);

    relais.fortsetzen();
    await relais.antwortUebergeben();
    const log = await zeilenBis(
      async () => a.stdout,
      (text) => zeilenMit(text, `${OHNE_ERKENNUNG} grund=fehler`).length === 1,
    );
    assert.equal(zeilenMit(log, `${OHNE_ERKENNUNG} grund=fehler`).length, 1, a.stdout);
    assert.equal(zeilenMit(a.stdout, "annahme_freigegeben weg=turn grund=spaet").length, 0, a.stdout);
    assert.deepEqual((await sql(OFFEN_SQL)).rows[0], { offen: ANKER_JE_ZUSTELLUNG });
  });
});

test("SF-K2: unter CI und ohne Postgres-Adresse schlägt der Abnahmetest der späten Freigabe fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = kriteriumLauf("test/anrufe/webhook-zustellung-spaet-fehlgeschlagen.test.js", `${KRITERIUM_NAME}:`, umgebung);
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
