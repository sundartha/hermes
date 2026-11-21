import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_5509_kunde";
const ZIEL = "+4915112345509";
const ABSENDER = "+4930555005509";
const UNBEKANNT = "call_5509_unbekannt";
const GELESENE_ZEILE = "FROM call WHERE";
const ZUGRIFF_FRIST_MS = 1000;

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

function zaehlenderRunner(db, fehler) {
  const zaehler = { clients: 0 };
  const client = {
    query: (text, params) => {
      if (fehler.haengt && text.includes(GELESENE_ZEILE)) return new Promise(() => {});
      if (fehler.an && text.includes(GELESENE_ZEILE)) throw new Error("lesen-ausgefallen-5509");
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { zaehler, runner: { withClient: (fn) => { zaehler.clients += 1; return fn(client); } } };
}

async function zweiInstanzen() {
  const db = await pgliteAlsRolleOhneSuperuser();
  const roh = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (s) => db.exec(s) }) };
  const a = makePgStore(roh);
  await a.init();
  await setzeKontext(db, KUNDE);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const fehler = { an: false };
  const { zaehler, runner } = zaehlenderRunner(db, fehler);
  const b = makePgStore(runner);
  await b.init();
  const call = a.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  await a.persistCall(call.id);
  zaehler.clients = 0;
  return { db, a, b, call, zaehler, fehler };
}

test("NACHLESEN-1: ein spaeter Schreiber liest einen unbekannten Anruf ueber genau einen Client nach", async () => {
  const { b, call, zaehler } = await zweiInstanzen();
  await b.markBilled(call.id);
  assert.equal(zaehler.clients, 2);
});

test("NACHLESEN-1b: die Nachlesung allein braucht einen Client und der Anruf steht danach im Spiegel", async () => {
  const { b, call, zaehler } = await zweiInstanzen();
  await b.addTranscript(call.id, "agent", "Hallo");
  assert.equal(zaehler.clients, 2);
  const nachgelesen = await b.leseCall(call.id);
  assert.equal(nachgelesen.transcript.at(-1).text, "Hallo");
});

test("NACHLESEN-2: transkriptLoeschen eines unbekannten Anrufs braucht genau einen Client und loescht das Transkript", async () => {
  const { a, b, call, zaehler } = await zweiInstanzen();
  await a.addTranscript(call.id, "agent", "Geheim");
  zaehler.clients = 0;
  await b.purgeTranscript(call.id);
  assert.equal(zaehler.clients, 1);
  assert.deepEqual((await b.leseCallUngebunden(call.id)).transcript, []);
});

test("NACHLESEN-3: unbekannte callId liefert null und loescht nichts", async () => {
  const { b, zaehler } = await zweiInstanzen();
  await b.purgeTranscript(UNBEKANNT);
  assert.equal(zaehler.clients, 1);
  assert.equal(await b.leseCall(UNBEKANNT), null);
});

test("NACHLESEN-4: ein Lesefehler wird weitergereicht und der Spiegel bleibt leer", async () => {
  const { b, call, fehler } = await zweiInstanzen();
  fehler.an = true;
  const meldung = console.error;
  console.error = () => {};
  try {
    await assert.rejects(b.markBilled(call.id), /lesen-ausgefallen-5509/);
  } finally {
    console.error = meldung;
  }
  fehler.an = false;
  assert.equal(b.getCall(call.id) ?? null, null);
});

test("NACHLESEN-5: eine haengende Nachlesung ueber den Client der Schlange bricht nach der Zugriffsfrist ab", async (t) => {
  const { b, call, fehler } = await zweiInstanzen();
  fehler.haengt = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ergebnis = assert.rejects(b.markBilled(call.id), /Zugriffsfrist abgelaufen/);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  t.mock.timers.tick(ZUGRIFF_FRIST_MS - 1);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  t.mock.timers.tick(1);
  await ergebnis;
});
