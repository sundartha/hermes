import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import {
  anrufeSql,
  gibDatenbankFrei,
  mandantenAbruf,
  mitHermesAufPostgres,
  mitHermesAufPostgresMitMandanten,
  neueAnrufe,
  postgresVorhanden,
  sperreDatenbank,
} from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_INTERNAL = 500;
const MANDANT_A = Object.freeze({ id: "tenant_exp_a", sub: "sub-exp-a", e164: "+4930555000201" });
const MANDANT_B = Object.freeze({ id: "tenant_exp_b", sub: "sub-exp-b", e164: "+4930555000202" });
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', 'completed', $4, $5, 'Testziel', $6, 600, 'telnyx')`;
const SEGMENT_SQL = `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`;
const PUNKT_SQL = `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
  VALUES ($1, $2, $3, $4, 'todo', false, $5)`;
const GESPRAECH = Object.freeze([
  ["caller", "Hallo, hier ist der Anrufer."],
  ["agent", "Guten Tag, hier ist die KI-Assistentin."],
  ["caller", "Dann passt der Donnerstag."],
]);

async function legeAnrufAn(sql, mandant, anruf) {
  const { id, zeilen } = anruf;
  await sql(ANRUF_SQL, [id, mandant.id, `tok_${id}`, mandant.e164, "+4915112345678", new Date().toISOString()]);
  for (const [rolle, text] of zeilen) {
    await sql(SEGMENT_SQL, [id, mandant.id, rolle, text, new Date().toISOString()]);
  }
}

const holeExport = async (mandant) => (await mandant.hole("/api/tenant-data/export")).json();
const idsVon = (daten) => daten.calls.map((anruf) => anruf.id);
const textzeilenVon = (anruf) => anruf.transcript.map((zeile) => [zeile.role, zeile.text]);

const mitMandanten = (t, lauf) =>
  mitHermesAufPostgresMitMandanten(t, { mandanten: [MANDANT_A, MANDANT_B] }, (hermes) =>
    lauf({ ...hermes, a: mandantenAbruf(hermes.srv, MANDANT_A.sub), b: mandantenAbruf(hermes.srv, MANDANT_B.sub) }),
  );

test("EXPORT-SQL-ANDERE-INSTANZ: der Export liefert einen Anruf, den nur die Datenbank kennt, mit 3 Zeilen in gesprochener Reihenfolge, neueste Anrufe zuerst", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, async ({ sql, a }) => {
    await legeAnrufAn(sql, MANDANT_A, { id: "call_exp_alt", zeilen: [] });
    await legeAnrufAn(sql, MANDANT_A, { id: "call_exp_neu", zeilen: GESPRAECH });
    for (const id of ["punkt_exp_1", "punkt_exp_2"]) {
      await sql(PUNKT_SQL, [id, MANDANT_A.id, "call_exp_neu", id, new Date().toISOString()]);
    }
    const antwort = await a.hole("/api/tenant-data/export");
    assert.equal(antwort.status, HTTP_OK);
    const daten = await antwort.json();
    assert.deepEqual(idsVon(daten), ["call_exp_neu", "call_exp_alt"]);
    assert.deepEqual(textzeilenVon(daten.calls[0]), GESPRAECH);
    assert.deepEqual(daten.calls[1].transcript, []);
    assert.deepEqual(daten.calls[0].actionItemIds, ["punkt_exp_1", "punkt_exp_2"]);
    assert.deepEqual(daten.calls[1].actionItemIds, []);
    assert.equal(daten.tenantId, MANDANT_A.id);
  });
});

test("EXPORT-SQL-MANDANT: der Export von B enthaelt weder Anruf noch Transkriptzeile von A", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, async ({ sql, a, b }) => {
    await legeAnrufAn(sql, MANDANT_A, { id: "call_exp_von_a", zeilen: GESPRAECH });
    await legeAnrufAn(sql, MANDANT_B, { id: "call_exp_von_b", zeilen: GESPRAECH.slice(0, 1) });
    const exportB = await holeExport(b);
    assert.deepEqual(idsVon(exportB), ["call_exp_von_b"]);
    assert.equal(textzeilenVon(exportB.calls[0]).length, 1);
    const exportA = await holeExport(a);
    assert.deepEqual(idsVon(exportA), ["call_exp_von_a"]);
    assert.equal(textzeilenVon(exportA.calls[0]).length, GESPRAECH.length);
  });
});

test("EXPORT-SQL-LESEFEHLER: bei gesperrter Datenbank antwortet der Export mit 500, ohne Export und ohne Audit-Eintrag", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitHermesAufPostgres(t, {}, async ({ srv, db, sql }) => {
    await neueAnrufe().rufeAn(srv);
    assert.equal((await anrufeSql(sql, 1)).length, 1);
    await sperreDatenbank(sql, db);
    try {
      const antwort = await abrufMitFrist(`${srv.localUrl}/api/tenant-data/export`);
      assert.equal(antwort.status, HTTP_INTERNAL);
      assert.equal((await antwort.text()).includes("calls"), false);
      assert.equal(srv.stdout.includes("[audit] data_export"), false);
      assert.match(srv.stdout, /\[pg\] anruf-export lesen fehlgeschlagen:/);
    } finally {
      await gibDatenbankFrei(db);
    }
  });
});
