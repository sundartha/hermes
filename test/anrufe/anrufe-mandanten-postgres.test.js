import assert from "node:assert/strict";
import test from "node:test";

import {
  anrufAnBis,
  mandantenAbruf,
  mitHermesAufPostgresMitMandanten,
  neueAnrufe,
  postgresVorhanden,
  transkriptSql,
  zeilenBis,
} from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY = 429;
const NICHT_GEFUNDEN = "not found";
const ERGEBNIS_ABFRAGE_MS = "200";
const KONSULT_ENV = { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" };

const EIGENE_NUMMER_A = "+4915112340999";
const BEHALTEN_ENV = { DIAGNOSTIC_RETENTION_DAYS: "7" };

const MANDANT_A = Object.freeze({
  id: "tenant_mand_a",
  sub: "sub-mand-a",
  e164: "+4930555000101",
  privateNumber: EIGENE_NUMMER_A,
});
const MANDANT_B = Object.freeze({ id: "tenant_mand_b", sub: "sub-mand-b", e164: "+4930555000102" });

const GESPRAECH = Object.freeze([
  { role: "agent", message: "Guten Tag, hier ist die KI-Assistentin von Mandant Test." },
  { role: "user", message: "Ja, bitte sehr, worum geht es?" },
  { role: "agent", message: "Ich moechte einen Termin am Donnerstag vereinbaren." },
  { role: "user", message: "Donnerstag um zehn Uhr passt." },
]);
const GESPRAECH_TEXTE = GESPRAECH.map((zeile) => zeile.message);
const texteVon = (zeilen) => zeilen.map((zeile) => zeile.text);

const ANRUFE_JE_MANDANT_SQL =
  "SELECT tenant_id, count(*)::int AS anzahl FROM call GROUP BY tenant_id ORDER BY tenant_id";

const gestartet = (anruf) => Boolean(anruf.konversation);
const beendet = (anruf) => anruf.status !== "active";

function mitMandanten(t, env, lauf) {
  const optionen = {
    env: { ELEVENLABS_RESULT_POLL_MS: ERGEBNIS_ABFRAGE_MS, ...env },
    mandanten: [MANDANT_A, MANDANT_B],
  };
  return mitHermesAufPostgresMitMandanten(t, optionen, (hermes) =>
    lauf({
      ...hermes,
      ziel: neueAnrufe().ziel,
      a: mandantenAbruf(hermes.srv, MANDANT_A.sub),
      b: mandantenAbruf(hermes.srv, MANDANT_B.sub),
    }),
  );
}

async function startet(sql, mandant, ziel) {
  const antwort = await mandant.rufeAn(ziel);
  assert.equal(antwort.status, HTTP_OK);
  return anrufAnBis(sql, { ziel, genug: gestartet });
}

async function fremdBekommt404(antwort) {
  assert.equal(antwort.status, HTTP_NOT_FOUND);
  assert.equal((await antwort.json()).error, NICHT_GEFUNDEN);
}

async function eigenerAnrufIstSichtbar(mandant, anruf) {
  const antwort = await mandant.hole(`/api/calls/${anruf.id}`);
  assert.equal(antwort.status, HTTP_OK);
  assert.equal((await antwort.json()).id, anruf.id);
}

async function beendeGespraechVonA({ anbieter, sql, a }) {
  const anruf = await startet(sql, a, EIGENE_NUMMER_A);
  anbieter.beendeGespraech(anruf.konversation, GESPRAECH);
  const fertig = await anrufAnBis(sql, { ziel: EIGENE_NUMMER_A, genug: beendet });
  assert.equal(fertig.status, "completed");
  return fertig;
}

test("PG-MANDANT-LIMIT: das Stundenlimit zaehlt je Mandant, der Anruf von A verbraucht das Kontingent von B nicht", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, { MAX_CALLS_PER_HOUR: "1" }, async ({ anbieter, sql, ziel, a, b }) => {
    assert.equal((await a.rufeAn(ziel())).status, HTTP_OK);
    assert.equal((await b.rufeAn(ziel())).status, HTTP_OK);
    const zweiterVonB = await b.rufeAn(ziel());
    assert.equal(zweiterVonB.status, HTTP_TOO_MANY);
    assert.equal((await zweiterVonB.json()).reason, "stundenlimit");
    assert.equal(anbieter.starts().length, 2);
    const je = await zeilenBis(
      async () => (await sql(ANRUFE_JE_MANDANT_SQL)).rows,
      (zeilen) => zeilen.length === 2,
    );
    assert.deepEqual(je, [
      { tenant_id: MANDANT_A.id, anzahl: 1 },
      { tenant_id: MANDANT_B.id, anzahl: 1 },
    ]);
  });
});

test("PG-MANDANT-LESEN: den Anruf von A liest B nicht, A selbst und B auf seinen eigenen Anruf schon", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, {}, async ({ sql, ziel, a, b }) => {
    const anrufA = await startet(sql, a, ziel());
    const anrufB = await startet(sql, b, ziel());
    const gehoertZu = await sql("SELECT id, tenant_id FROM call WHERE id = ANY($1) ORDER BY seq", [
      [anrufA.id, anrufB.id],
    ]);
    assert.deepEqual(gehoertZu.rows, [
      { id: anrufA.id, tenant_id: MANDANT_A.id },
      { id: anrufB.id, tenant_id: MANDANT_B.id },
    ]);
    await fremdBekommt404(await b.hole(`/api/calls/${anrufA.id}`));
    await eigenerAnrufIstSichtbar(a, anrufA);
    await eigenerAnrufIstSichtbar(b, anrufB);
  });
});

test("PG-MANDANT-STEUERN: den Anruf von A beendet und befragt B nicht, der Anruf bleibt active", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, KONSULT_ENV, async ({ anbieter, sql, ziel, a, b }) => {
    const anrufA = await startet(sql, a, ziel());
    const eigenerZweiter = await startet(sql, a, ziel());
    await fremdBekommt404(await b.sende(`/api/calls/${anrufA.id}/cancel`));
    await fremdBekommt404(await b.hole(`/api/calls/${anrufA.id}/consult`));
    const danach = await sql("SELECT status FROM call WHERE id = $1", [anrufA.id]);
    assert.deepEqual(danach.rows, [{ status: "active" }]);
    assert.equal(anbieter.beendetGespraech(anrufA.konversation), false);
    const eigenes = await a.sende(`/api/calls/${eigenerZweiter.id}/cancel`);
    assert.equal((await eigenes.json()).status, "cancelled");
    assert.equal(anbieter.beendetGespraech(eigenerZweiter.konversation), true);
    assert.equal((await a.hole(`/api/calls/${eigenerZweiter.id}/consult`)).status, HTTP_OK);
  });
});

test("PG-MANDANT-EXPORT: der Export liefert B keinen Anruf und A genau seinen Anruf mit den Transkriptzeilen in der gesprochenen Reihenfolge", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, BEHALTEN_ENV, async (hermes) => {
    const anruf = await beendeGespraechVonA(hermes);
    const zeilen = await transkriptSql(hermes.sql, anruf, GESPRAECH.length);
    assert.deepEqual(texteVon(zeilen), GESPRAECH_TEXTE);
    const exportB = await (await hermes.b.hole("/api/tenant-data/export")).json();
    assert.equal(exportB.calls.length, 0);
    const exportA = await (await hermes.a.hole("/api/tenant-data/export")).json();
    assert.equal(exportA.calls.length, 1);
    assert.equal(exportA.calls[0].id, anruf.id);
    assert.deepEqual(texteVon(exportA.calls[0].transcript), GESPRAECH_TEXTE);
  });
});

test("PG-MANDANT-NEUSTART: nach hartem Neustart liefert Hermes A dieselben Transkriptzeilen in derselben Reihenfolge und B weiter 404", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, BEHALTEN_ENV, async (hermes) => {
    const anruf = await beendeGespraechVonA(hermes);
    await transkriptSql(hermes.sql, anruf, GESPRAECH.length);
    const { srv } = await hermes.neustartHart();
    const nachA = await mandantenAbruf(srv, MANDANT_A.sub).hole(`/api/calls/${anruf.id}`);
    assert.equal(nachA.status, HTTP_OK);
    assert.deepEqual(texteVon((await nachA.json()).transcript), GESPRAECH_TEXTE);
    await fremdBekommt404(await mandantenAbruf(srv, MANDANT_B.sub).hole(`/api/calls/${anruf.id}`));
  });
});
