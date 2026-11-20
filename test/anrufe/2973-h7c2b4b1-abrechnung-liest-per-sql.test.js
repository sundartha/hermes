import assert from "node:assert/strict";
import { test } from "node:test";

import { captureConsole } from "../helpers.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const ALT_MIN = 600;
const MS_JE_MIN = 60_000;
const ANRUF_ABSENDER = "+4930555000312";
const ANRUF_ZIEL = "+4915112349934";
const MANDANTEN_LESEN = "SELECT id FROM tenant ORDER BY id";
const LESEFEHLER = "Berichtsanrufe lesen kaputt (h7c2b4b1-6)";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "postfach@kv2.invalid" });
const store = await import("../../src/store.js");
const { makePgStore } = await import("../pg-helpers.js");

function ersterMandant() {
  const [erster] = store.load().tenants;
  return erster.id;
}

const kontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function anrufEinerAnderenInstanz(db) {
  const runner = { withClient: (arbeit) => arbeit({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }) };
  const fremd = makePgStore(runner);
  await fremd.init();
  const tenantId = ersterMandant();
  const call = fremd.createCall({ direction: "outbound", from: ANRUF_ABSENDER, to: ANRUF_ZIEL, goal: "Test", tenantId });
  await fremd.persistCall(call.id);
  const angelegt = fremd.getCall(call.id);
  angelegt.status = "completed";
  angelegt.answeredAt = new Date(Date.now() - (ALT_MIN + 1) * MS_JE_MIN).toISOString();
  angelegt.endedAt = new Date(Date.now() - ALT_MIN * MS_JE_MIN).toISOString();
  fremd.save();
  await fremd.drainFlushes();
  return call.id;
}

async function aufbau() {
  const hermes = laufendesHermes();
  const { sessionCookie } = await hermes.anmelden();
  await hermes.db.query("UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)", ["kv2-betreiber"]);
  const callId = await anrufEinerAnderenInstanz(hermes.db);
  const sweep = () => hermes.anfrage("/api/billing/cost-truing/sweep", { method: "POST", headers: { cookie: sessionCookie } });
  return { db: hermes.db, callId, sweep };
}

const { db, callId, sweep } = await aufbau();

async function schluesselEntnehmen() {
  await kontext(db, ersterMandant());
  const { rows } = await db.query("DELETE FROM anruf_schluessel WHERE call_id = $1 RETURNING *", [callId]);
  return rows;
}

async function schluesselZurueck(rows) {
  for (const zeile of rows) {
    const spalten = Object.keys(zeile);
    const marken = spalten.map((_name, nr) => `$${nr + 1}`).join(", ");
    await db.query(`INSERT INTO anruf_schluessel (${spalten.join(", ")}) VALUES (${marken})`, Object.values(zeile));
  }
}

function mandantenLesenScheitertEinmal() {
  const aushaengen = () => {
    delete db.query;
    delete db.exec;
  };
  const haengeEin = (name) => {
    const eingehaengt = (text, ...rest) => {
      if (String(text) === MANDANTEN_LESEN) {
        aushaengen();
        throw new Error(LESEFEHLER);
      }
      delete db[name];
      const ergebnis = db[name](text, ...rest);
      db[name] = eingehaengt;
      return ergebnis;
    };
    db[name] = eingehaengt;
  };
  haengeEin("query");
  haengeEin("exec");
  return aushaengen;
}

test("H7c2b4b1-6: scheitert das Lesen der Berichtsanrufe, endet der Sweep mit diesem Fehler ohne Antwort 200 und ohne Sweep-Zeile mit leerer Kandidatenliste", async () => {
  const abgelehnt = [];
  const merke = (grund) => abgelehnt.push(grund);
  const bisherige = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", merke);
  const zuruecksetzen = mandantenLesenScheitertEinmal();
  let antwort;
  const zeilen = await captureConsole(async () => {
    antwort = await sweep();
  }).finally(() => {
    zuruecksetzen();
    process.off("unhandledRejection", merke);
    for (const listener of bisherige) process.on("unhandledRejection", listener);
  });
  assert.equal(antwort.status, HTTP_SERVER_ERROR);
  assert.deepEqual(abgelehnt, []);
  assert.doesNotMatch(zeilen.join("\n"), /\[cost-truing\] sweep trigger=\S+ kandidaten=/);
});

test("H7c2b4b1-5: ein Anruf, der beim Binden nicht mehr in der Datenbank steht, ist kein Kandidat und der Sweep laeuft weiter", async () => {
  const schluessel = await schluesselEntnehmen();
  assert.ok(schluessel.length > 0);
  const antwort = await sweep();
  await schluesselZurueck(schluessel);
  assert.equal(antwort.status, HTTP_OK);
  assert.equal((await antwort.json()).candidates, 0);
});

test("H7c2b4b1-1: der Sweep einer Instanz nimmt einen beendeten Anruf auf, den nur die Datenbank kennt, als Kandidat", async () => {
  const antwort = await sweep();
  assert.equal(antwort.status, HTTP_OK);
  const ergebnis = await antwort.json();
  assert.equal(ergebnis.candidates, 1);
  assert.equal(ergebnis.failed, 0);
});

