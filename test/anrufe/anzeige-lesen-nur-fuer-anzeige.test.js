import assert from "node:assert/strict";
import { mock, test } from "node:test";
import express from "express";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeReadRoutes } from "../../src/routes/api-read.ts";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_anzeige_lesen";
const ZIEL = "+4915112349966";
const JETZT = "2026-11-22T18:50:00.000Z";

function neuerZustand() {
  const zustand = {
    abfragen: 0,
    fehler: false,
    zaehlen: () => {
      zustand.abfragen += 1;
    },
  };
  return zustand;
}

function zaehlenderRunner(db, zustand) {
  return {
    withClient: (fn) => {
      if (zustand.fehler) throw new Error("db weg");
      return fn({
        query: (text, params) => {
          zustand.zaehlen();
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      });
    },
  };
}

async function neueInstanz(db, zustand = neuerZustand()) {
  const store = makePgStore(zaehlenderRunner(db, zustand));
  await store.init();
  return store;
}

async function anrufAnlegen(db) {
  await neueInstanz(db);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [KUNDE]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
}

async function abfrage(store, callId) {
  const tenant = {
    requestTenant: () => KUNDE,
    requireTenant: () => KUNDE,
    tenantOwnsCall: (call, tenantId) => call.tenantId === tenantId,
  };
  const app = express();
  app.use(makeReadRoutes({ store, config: {}, audit: () => {}, tenant }));
  const http = await new Promise((listening) => {
    const server = app.listen(0, () => listening(server));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${http.address().port}/api/calls/${callId}`);
    return { status: antwort.status, body: await antwort.json() };
  } finally {
    await new Promise((closed) => http.close(closed));
  }
}

async function zweiInstanzen() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await anrufAnlegen(db);
  const zustand = neuerZustand();
  const a = await neueInstanz(db, zustand);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: "+4930555000322", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await a.persistCall(call.id);
  await b.leseCall(call.id);
  await b.markInboundElNachlaufStarted(call.id, JETZT);
  return { a, zustand, id: call.id };
}

test("Anzeige: Nachlauf der anderen Instanz zeigt completed", async () => {
  const { a, id } = await zweiInstanzen();
  assert.equal((await abfrage(a, id)).body.status, "completed");
});

test("Anzeige: Lesefehler der Datenbank liefert den Spiegelstand und eine Zeile mit Präfix", async () => {
  const { a, zustand, id } = await zweiInstanzen();
  const log = mock.method(console, "error", () => {});
  zustand.fehler = true;
  const antwort = await abfrage(a, id);
  zustand.fehler = false;
  const zeilen = log.mock.calls.map((aufruf) => String(aufruf.arguments[0]));
  log.mock.restore();
  assert.equal(antwort.status, 200);
  assert.equal(antwort.body.status, "active");
  assert.ok(zeilen.includes("[pg] leseCall fehlgeschlagen:"), zeilen.join("|"));
});

test("leseCallUngebunden liest für einen eigenen Anruf keine Datenbankzeile", async () => {
  const { a, zustand, id } = await zweiInstanzen();
  zustand.abfragen = 0;
  const call = await a.leseCallUngebunden(id);
  assert.equal(zustand.abfragen, 0);
  assert.equal(call.id, id);
  assert.equal(call.elNachlaufStartedAt, null);
});

test("leseCallUngebunden liest einen fremden Anruf aus der Datenbank", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await anrufAnlegen(db);
  const a = await neueInstanz(db);
  const zustand = neuerZustand();
  const b = await neueInstanz(db, zustand);
  const call = a.createCall({ direction: "outbound", from: "+4930555000322", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await a.persistCall(call.id);
  const gelesen = await b.leseCallUngebunden(call.id);
  assert.equal(gelesen.id, call.id);
  assert.ok(zustand.abfragen > 0);
});

test("Anzeige: trägt der Spiegel den Nachlauf schon, braucht die Route die Datenbank nicht", async () => {
  const { a, zustand, id } = await zweiInstanzen();
  await a.markInboundElNachlaufStarted(id, JETZT);
  const log = mock.method(console, "error", () => {});
  zustand.fehler = true;
  const antwort = await abfrage(a, id);
  zustand.fehler = false;
  const zeilen = log.mock.calls.length;
  log.mock.restore();
  assert.equal(antwort.body.status, "completed");
  assert.equal(zeilen, 0);
});

test("Anzeige: unbekannter Anruf ergibt 404", async () => {
  const { a } = await zweiInstanzen();
  const antwort = await abfrage(a, "gibt-es-nicht");
  assert.equal(antwort.status, 404);
});

async function beendetVonAnderer(status) {
  const db = await pgliteAlsRolleOhneSuperuser();
  await anrufAnlegen(db);
  const zustand = neuerZustand();
  const a = await neueInstanz(db, zustand);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: "+4930555000322", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await a.persistCall(call.id);
  const fremd = await b.leseCall(call.id);
  fremd.summary = "Termin vereinbart";
  fremd.answeredAt = "2026-11-22T18:51:00.000Z";
  fremd.transcript.push({ role: "agent", text: "Guten Tag", at: JETZT });
  await b.persistCall(call.id);
  await b.recordFailureReason(call.id, "el_uebergabe_gescheitert");
  await b.endCallRecord(call.id, status);
  return { a, b, zustand, id: call.id };
}

for (const status of ["completed", "failed"]) {
  test(`Anzeige: Kopie active, Zeile ${status} -> die Route zeigt die Zeile samt Zeiten, Zusammenfassung, Grund und Transkript`, async () => {
    const { a, b, id } = await beendetVonAnderer(status);
    const zeile = await b.leseCallUngebunden(id);
    const { body } = await abfrage(a, id);
    assert.equal(body.status, status);
    assert.equal(body.answeredAt, "2026-11-22T18:51:00.000Z");
    assert.equal(body.endedAt, zeile.endedAt);
    assert.ok(body.endedAt);
    assert.equal(body.summary, "Termin vereinbart");
    assert.equal(body.failureReason, "el_uebergabe_gescheitert");
    assert.equal(body.transcript.length, 1);
    assert.equal(body.transcript[0].text, "Guten Tag");
  });
}

test("Anzeige: ohne fuerAnzeige bleibt die Kopie active und die Datenbank wird nicht gefragt", async () => {
  const { a, zustand, id } = await beendetVonAnderer("completed");
  zustand.abfragen = 0;
  const call = await a.leseCallUngebunden(id);
  assert.equal(call.status, "active");
  assert.equal(zustand.abfragen, 0);
});

test("Anzeige: Kopie und Zeile active -> Spiegelstand", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await anrufAnlegen(db);
  const a = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: "+4930555000322", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await a.persistCall(call.id);
  const antwort = await abfrage(a, call.id);
  assert.equal(antwort.body.status, "active");
  assert.equal(antwort.body.endedAt ?? null, null);
});
