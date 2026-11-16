import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

import {
  gibDatenbankFrei,
  mandantenAbruf,
  postgresVorhanden,
  seedeMandant,
  sperreDatenbank,
} from "../anrufe/hermes-mit-postgres.js";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { startServer } from "../helpers.js";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const CALL_ID = "call_2970_poll_b";
const MAX_DAUER_S = 600;
const ENV = { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" };
const MANDANT_M = Object.freeze({ id: "tenant_poll_m", sub: "sub-poll-m", e164: "+4930555000201" });
const MANDANT_N = Object.freeze({ id: "tenant_poll_n", sub: "sub-poll-n", e164: "+4930555000202" });
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, max_duration_s)
  VALUES ($1, $2, $3, 'outbound', $4, $5, '+4915112349955', 'Testziel', now(), $6)`;

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function mitZweiInstanzen(t, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const umgebung = pgStartUmgebung(db.adresse, ENV);
  const gestartet = [];
  try {
    await (await startServer({ env: umgebung })).stop();
    for (const mandant of [MANDANT_M, MANDANT_N]) await seedeMandant(sql, mandant);
    for (let nr = 0; nr < 2; nr += 1) gestartet.push(await startServer({ env: umgebung }));
    return await lauf({ b: gestartet[1], db, sql });
  } finally {
    await gibDatenbankFrei(db);
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await verwaltung.end();
  }
}

const legeAnrufAn = (sql, status) =>
  sql(ANRUF_SQL, [CALL_ID, MANDANT_M.id, "tok_2970_poll", status, MANDANT_M.e164, MAX_DAUER_S]);

test("CONSULT-POLL-B-1: Poll auf Instanz B: von A beendeter Anruf liefert done", async (t) => {
  await mitZweiInstanzen(t, async ({ b, sql }) => {
    await legeAnrufAn(sql, "completed");
    const antwort = await mandantenAbruf(b, MANDANT_M.sub).hole(`/api/calls/${CALL_ID}/consult`);
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(await antwort.json(), { event: "done", eventId: null, questions: [] });
  });
});

test("CONSULT-POLL-B-2: Poll auf Instanz B: anderer Mandant bekommt 404", async (t) => {
  await mitZweiInstanzen(t, async ({ b, sql }) => {
    await legeAnrufAn(sql, "completed");
    const antwort = await mandantenAbruf(b, MANDANT_N.sub).hole(`/api/calls/${CALL_ID}/consult`);
    assert.equal(antwort.status, HTTP_NOT_FOUND);
    assert.equal((await antwort.json()).error, "not found");
  });
});

test("CONSULT-POLL-B-3: Poll auf Instanz B: Lesefehler liefert weder done noch 404", async (t) => {
  await mitZweiInstanzen(t, async ({ b, db, sql }) => {
    await legeAnrufAn(sql, "completed");
    await sperreDatenbank(sql, db);
    const antwort = await mandantenAbruf(b, MANDANT_M.sub).hole(`/api/calls/${CALL_ID}/consult`);
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(await antwort.json(), { event: "none", eventId: null, questions: [] });
  });
});
