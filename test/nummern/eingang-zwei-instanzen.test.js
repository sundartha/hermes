import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import express from "express";

import { makeVoiceRoutes } from "../../src/routes/voice.ts";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makePgStore, pgliteAlsRolleOhneSuperuser, schemaErneutAnwenden } from "../pg-helpers.js";

const MANDANT = "t_eingang_a";
const FREMD = "t_eingang_fremd";
const E164 = "+12025550191";
const NEU = "+12025550192";
const UNBEKANNT = "+12025550199";
const ABSENDER = "+4930555000330";
const UNERREICHBAR = /Diese Nummer ist nicht erreichbar\. Auf Wiederhören\./;
const KURZE_FRIST_MS = 60;
const GROSSZUEGIGE_FRIST_MS = 60_000;
const hash = (wert) => createHash("sha256").update(wert, "utf8").digest("hex");

function runnerFuer(db, vorQuery = async () => {}) {
  return {
    withClient: (arbeit) =>
      arbeit({
        query: async (text, werte) => {
          await vorQuery(text);
          return db.query(text, werte);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

const kontext = (db, mandant) => db.query("SELECT set_config('app.current_tenant', $1, false)", [mandant]);

async function instanz(db, optionen = {}, vorQuery) {
  const store = makePgStore(runnerFuer(db, vorQuery), { einstellungenFristMs: GROSSZUEGIGE_FRIST_MS, ...optionen });
  await store.init();
  return store;
}

async function mandantAnlegen(db, id) {
  await kontext(db, id);
  await db.query("INSERT INTO tenant (id, status, idp_subject, country) VALUES ($1, 'active', $1, 'US')", [id]);
}

async function aufbau() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await instanz(db);
  await mandantAnlegen(db, MANDANT);
  return db;
}

async function nummerKaufenAufA(db, { id = "num_eingang", e164 = E164, status = "active", mandant = MANDANT } = {}) {
  const a = await instanz(db);
  a.load().numbers.push({ id, tenantId: mandant, e164, provider: "telnyx", status, country: "US", language: "en" });
  a.save();
  await a.drainFlushes();
  return a;
}

function appMit(store, audits) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config: withConfigNamespaces({
        skipTwilioSignatureCheck: true,
        machineDetection: { enabled: false, timeoutS: 25 },
        publicUrl: "https://hermes.test",
        elevenLabsInbound: { sipUser: "u", sipPassword: "p".repeat(32), begruessungslautEnabled: false },
      }),
      audit: (art) => audits.push(art),
      voiceRender: { render: (direktiven) => JSON.stringify(direktiven), turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
      ttsStore: { takeOnce: async () => null },
      lifecycle: { reattachActiveCall: async () => ({ call: null, logUnknown: false }), armMaxDurationTimer: () => {} },
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
      inboundBridges: { armBindingDeadline: () => {} },
      vorspannAblauf: { behandle: async () => {} },
    }),
  );
  return app;
}

async function anrufAn(store, nummer) {
  const audits = [];
  const server = await new Promise((resolve) => {
    const srv = appMit(store, audits).listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/voice/incoming`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: `CA_${nummer}`, From: ABSENDER, To: nummer }).toString(),
    });
    return { text: await antwort.text(), audits };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function ohneLog(arbeit) {
  const original = { error: console.error, log: console.log };
  const zeilen = [];
  console.error = (...teile) => zeilen.push(teile.join(" "));
  console.log = (...teile) => zeilen.push(teile.join(" "));
  try {
    await arbeit();
  } finally {
    console.error = original.error;
    console.log = original.log;
  }
  return zeilen;
}

const angenommen = (ergebnis) => !UNERREICHBAR.test(ergebnis.text) && !ergebnis.audits.includes("inbound_unrouted");
const schluessel = async (db) => (await db.query("SELECT e164_hash, tenant_id FROM nummer_schluessel ORDER BY e164_hash")).rows;

test("28a: eine auf A gekaufte aktive Nummer nimmt auf B ohne Neustart an, auch wenn B den Mandanten kennt", async () => {
  const db = await aufbau();
  const b = await instanz(db);
  assert.equal(b.load().tenants.some((mandant) => mandant.id === MANDANT), true);
  assert.deepEqual(b.load().numbers, []);
  await nummerKaufenAufA(db);
  const ergebnis = await anrufAn(b, E164);
  assert.equal(angenommen(ergebnis), true, ergebnis.text);
  assert.deepEqual(b.load().numbers.map((nummer) => [nummer.id, nummer.tenantId, nummer.status]), [["num_eingang", MANDANT, "active"]]);
  assert.equal(b.load().calls.some((anruf) => anruf.tenantId === MANDANT && anruf.to === E164), true);
});
test("28a: kennt B den Mandanten noch nicht, wird er mit der Nummer geladen und der Anruf angenommen", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const b = await instanz(db);
  await mandantAnlegen(db, MANDANT);
  assert.equal(b.load().tenants.some((mandant) => mandant.id === MANDANT), false);
  await nummerKaufenAufA(db);
  const ergebnis = await anrufAn(b, E164);
  assert.equal(angenommen(ergebnis), true, ergebnis.text);
  assert.equal(b.load().tenants.some((mandant) => mandant.id === MANDANT), true);
});

test("28c: eine unbekannte Nummer bekommt weiter die Ansage und den Audit-Vermerk", async () => {
  const db = await aufbau();
  const b = await instanz(db);
  await nummerKaufenAufA(db);
  const ergebnis = await anrufAn(b, UNBEKANNT);
  assert.match(ergebnis.text, UNERREICHBAR);
  assert.deepEqual(ergebnis.audits, ["inbound_unrouted"]);
});

test("28c: eine Nummer, die noch nicht aktiv ist, wird auf B nicht angenommen", async () => {
  const db = await aufbau();
  const b = await instanz(db);
  await nummerKaufenAufA(db, { status: "requested" });
  const ergebnis = await anrufAn(b, E164);
  assert.match(ergebnis.text, UNERREICHBAR);
  assert.deepEqual(b.load().numbers.filter((nummer) => nummer.status === "active"), []);
});

test("28c: scheitert das Nachladen, bleibt die Ansage und der Fehler steht im Protokoll", async () => {
  const db = await aufbau();
  const b = await instanz(db, {}, async (text) => {
    if (/nummer_schluessel/.test(text)) throw new Error("Schluesselausfall");
  });
  await nummerKaufenAufA(db);
  let ergebnis;
  const zeilen = await ohneLog(async () => {
    ergebnis = await anrufAn(b, E164);
  });
  assert.match(ergebnis.text, UNERREICHBAR);
  assert.deepEqual(ergebnis.audits, ["inbound_unrouted"]);
  assert.ok(zeilen.some((zeile) => zeile.includes("[pg] nummer nachladen fehlgeschlagen: Schluesselausfall")), zeilen.join("|"));
  assert.deepEqual(b.load().numbers, []);
});

test("28c: haengt das Nachladen laenger als die Frist, bleibt die Ansage", async () => {
  const db = await aufbau();
  let freigeben;
  const tor = new Promise((weiter) => (freigeben = weiter));
  const haengt = { an: false };
  const b = await instanz(db, { einstellungenFristMs: KURZE_FRIST_MS }, async (text) => {
    if (haengt.an && /nummer_schluessel/.test(text)) await tor;
  });
  await nummerKaufenAufA(db);
  haengt.an = true;
  let ergebnis;
  const zeilen = await ohneLog(async () => {
    ergebnis = await anrufAn(b, E164);
  });
  freigeben();
  assert.match(ergebnis.text, UNERREICHBAR);
  assert.ok(zeilen.some((zeile) => zeile.includes("[pg] nummer nachladen fehlgeschlagen: Frist abgelaufen")), zeilen.join("|"));
});

test("SG-38 Unter der App-Rolle ist keine Nummer eines fremden Mandanten lesbar und die Schluesseltabelle hat nur Hash und Mandant", async () => {
  const db = await aufbau();
  await mandantAnlegen(db, FREMD);
  await nummerKaufenAufA(db);
  await kontext(db, FREMD);
  assert.deepEqual((await db.query("SELECT id FROM number")).rows, []);
  const spalten = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'nummer_schluessel' ORDER BY column_name");
  assert.deepEqual(spalten.rows.map((zeile) => zeile.column_name), ["e164_hash", "tenant_id"]);
  assert.deepEqual(await schluessel(db), [{ e164_hash: hash(E164), tenant_id: MANDANT }]);
});

test("28b: Aendern der Nummer und Loeschen der Zeile pflegen die Schluesseltabelle", async () => {
  const db = await aufbau();
  await nummerKaufenAufA(db);
  await kontext(db, MANDANT);
  await db.query("UPDATE number SET e164 = $1 WHERE id = 'num_eingang'", [NEU]);
  assert.deepEqual(await schluessel(db), [{ e164_hash: hash(NEU), tenant_id: MANDANT }]);
  await db.query("UPDATE number SET e164 = NULL WHERE id = 'num_eingang'");
  assert.deepEqual(await schluessel(db), []);
  await db.query("UPDATE number SET e164 = $1 WHERE id = 'num_eingang'", [E164]);
  assert.deepEqual(await schluessel(db), [{ e164_hash: hash(E164), tenant_id: MANDANT }]);
  await db.query("DELETE FROM number WHERE id = 'num_eingang'");
  assert.deepEqual(await schluessel(db), []);
});

test("28b: Nummern, die schon vor der Migration in der Datenbank standen, stehen danach in der Schluesseltabelle", async () => {
  const db = await aufbau();
  await mandantAnlegen(db, FREMD);
  await nummerKaufenAufA(db);
  await nummerKaufenAufA(db, { id: "num_fremd", e164: NEU, mandant: FREMD });
  await db.exec("DELETE FROM nummer_schluessel");
  await db.exec("DELETE FROM schema_migrations WHERE version = 30");
  await schemaErneutAnwenden(db);
  assert.deepEqual(
    await schluessel(db),
    [
      { e164_hash: hash(E164), tenant_id: MANDANT },
      { e164_hash: hash(NEU), tenant_id: FREMD },
    ].sort((links, rechts) => links.e164_hash.localeCompare(rechts.e164_hash)),
  );
});

test("28a: kennt B die aktive Nummer schon, nimmt es an, ohne die Schluesseltabelle zu lesen", async () => {
  const db = await aufbau();
  await nummerKaufenAufA(db);
  const lesezugriffe = [];
  const b = await instanz(db, {}, async (text) => {
    if (/nummer_schluessel/.test(text)) lesezugriffe.push(text);
  });
  assert.equal(b.load().numbers.length, 1);
  const ergebnis = await anrufAn(b, E164);
  assert.equal(angenommen(ergebnis), true, ergebnis.text);
  assert.deepEqual(lesezugriffe, []);
});

test("28a: hat B die Nummer nur als beantragt in der Kopie, wird sie aus der Datenbank als aktiv uebernommen und nicht doppelt gefuehrt", async () => {
  const db = await aufbau();
  await nummerKaufenAufA(db, { status: "requested" });
  const b = await instanz(db);
  assert.deepEqual(b.load().numbers.map((nummer) => nummer.status), ["requested"]);
  await kontext(db, MANDANT);
  await db.query("UPDATE number SET status = 'active' WHERE id = 'num_eingang'");
  const ergebnis = await anrufAn(b, E164);
  assert.equal(angenommen(ergebnis), true, ergebnis.text);
  assert.deepEqual(b.load().numbers.map((nummer) => [nummer.id, nummer.status]), [["num_eingang", "active"]]);
});

test("28c: scheitert das Lesen der Nummernzeile, wird die Transaktion zurueckgenommen und die Ansage bleibt", async () => {
  const db = await aufbau();
  const befehle = [];
  const b = await instanz(db, {}, async (text) => {
    befehle.push(text);
    if (/FROM number WHERE tenant_id = \$1 AND e164 = \$2/.test(text)) throw new Error("Zeilenausfall");
  });
  await nummerKaufenAufA(db);
  let ergebnis;
  const zeilen = await ohneLog(async () => {
    ergebnis = await anrufAn(b, E164);
  });
  assert.match(ergebnis.text, UNERREICHBAR);
  assert.ok(zeilen.some((zeile) => zeile.includes("[pg] nummer nachladen fehlgeschlagen: Zeilenausfall")), zeilen.join("|"));
  assert.equal(befehle.filter((text) => text === "ROLLBACK").length, 1);
  assert.equal(befehle.includes("COMMIT"), false);
});
