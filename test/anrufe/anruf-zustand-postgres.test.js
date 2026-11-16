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
const ZUSTAND_ANRUFE = 30;
const MANDANT_A = Object.freeze({ id: "tenant_zst_a", sub: "sub-zst-a", e164: "+4930555000301" });
const MANDANT_B = Object.freeze({ id: "tenant_zst_b", sub: "sub-zst-b", e164: "+4930555000302" });
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

const holeZustand = async (mandant) => (await mandant.hole("/api/state")).json();
const idsVon = (zustand) => zustand.calls.map((anruf) => anruf.id);
const textzeilenVon = (anruf) => anruf.transcript.map((zeile) => [zeile.role, zeile.text]);

const mitMandanten = (t, lauf) =>
  mitHermesAufPostgresMitMandanten(t, { mandanten: [MANDANT_A, MANDANT_B] }, (hermes) =>
    lauf({ ...hermes, a: mandantenAbruf(hermes.srv, MANDANT_A.sub), b: mandantenAbruf(hermes.srv, MANDANT_B.sub) }),
  );

test("ZUSTAND-SQL-ANDERE-INSTANZ: /api/state zeigt einen Anruf, den nur die Datenbank kennt, mit 3 Zeilen in gesprochener Reihenfolge und Aktionspunkt-IDs, neueste zuerst", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, async ({ sql, a }) => {
    await legeAnrufAn(sql, MANDANT_A, { id: "call_zst_alt", zeilen: [] });
    await legeAnrufAn(sql, MANDANT_A, { id: "call_zst_neu", zeilen: GESPRAECH });
    await sql(PUNKT_SQL, ["punkt_zst_1", MANDANT_A.id, "call_zst_neu", "Rueckruf", new Date().toISOString()]);
    const antwort = await a.hole("/api/state");
    assert.equal(antwort.status, HTTP_OK);
    const zustand = await antwort.json();
    assert.deepEqual(idsVon(zustand), ["call_zst_neu", "call_zst_alt"]);
    assert.deepEqual(textzeilenVon(zustand.calls[0]), GESPRAECH);
    assert.deepEqual(zustand.calls[1].transcript, []);
    assert.deepEqual(zustand.calls[0].actionItemIds, ["punkt_zst_1"]);
    assert.equal(zustand.calls[0].goal, "Testziel");
    assert.equal(zustand.calls[0].tenantId, MANDANT_A.id);
  });
});

test("ZUSTAND-SQL-30-NEUESTE: /api/state zeigt von 31 Anrufen die 30 neuesten, den aeltesten nicht", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, async ({ sql, a }) => {
    for (let i = 0; i <= ZUSTAND_ANRUFE; i++) {
      await legeAnrufAn(sql, MANDANT_A, { id: `call_zst_${String(i).padStart(2, "0")}`, zeilen: [] });
    }
    const zustand = await holeZustand(a);
    assert.equal(zustand.calls.length, ZUSTAND_ANRUFE);
    assert.equal(zustand.calls[0].id, "call_zst_30");
    assert.equal(idsVon(zustand).includes("call_zst_00"), false);
  });
});

test("ZUSTAND-SQL-MANDANT: /api/state von B enthaelt weder Anruf noch Transkriptzeile von A", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, async ({ sql, a, b }) => {
    await legeAnrufAn(sql, MANDANT_A, { id: "call_zst_von_a", zeilen: GESPRAECH });
    await legeAnrufAn(sql, MANDANT_B, { id: "call_zst_von_b", zeilen: GESPRAECH.slice(0, 1) });
    const zustandB = await holeZustand(b);
    assert.deepEqual(idsVon(zustandB), ["call_zst_von_b"]);
    assert.equal(textzeilenVon(zustandB.calls[0]).length, 1);
    const zustandA = await holeZustand(a);
    assert.deepEqual(idsVon(zustandA), ["call_zst_von_a"]);
    assert.equal(textzeilenVon(zustandA.calls[0]).length, GESPRAECH.length);
  });
});

test("ZUSTAND-SQL-LESEFEHLER: bei gesperrter Datenbank antwortet /api/state mit 500 und ohne calls", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitHermesAufPostgres(t, {}, async ({ srv, db, sql }) => {
    await neueAnrufe().rufeAn(srv);
    assert.equal((await anrufeSql(sql, 1)).length, 1);
    await sperreDatenbank(sql, db);
    try {
      const antwort = await abrufMitFrist(`${srv.localUrl}/api/state`);
      assert.equal(antwort.status, HTTP_INTERNAL);
      assert.equal((await antwort.text()).includes("calls"), false);
      assert.match(srv.stdout, /\[pg\] anruf-export lesen fehlgeschlagen:/);
    } finally {
      await gibDatenbankFrei(db);
    }
  });
});
