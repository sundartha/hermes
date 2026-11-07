import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID, makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";
import { starteSelfServiceApp } from "../gemeinsam/self-service-app.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const SECRET = "einstellungen-secret-0123456789";
const SUB = "sub-einstellungen";
const TENANT_ID = "t_sub-einstellungen";
const EINSTELLUNGS_SCHLUESSEL = [
  "agentName",
  "greeting",
  "allowCalendar",
  "allowBooking",
  "allowSummaries",
  "smsSummaryOptIn",
  "allowPersonalData",
  "allowBankData",
  "allowResearch",
  "allowCallMemory",
  "language",
  "agentStyle",
].sort();
const FEHLER_LOG = "[pg] einstellungen schreiben fehlgeschlagen";

function runnerFuer(db, vorQuery = () => {}) {
  const client = {
    query: async (text, params) => {
      vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function instanz(runner) {
  const store = makePgStore(runner);
  await store.init();
  return store;
}

const sprache = (store) => store.resolveCallLanguage({ tenantId: BOOTSTRAP_TENANT_ID, numberRecord: null });
const zeile = async (db, tenantId) => {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
  return (await db.query(`SELECT * FROM settings WHERE tenant_id = $1`, [tenantId])).rows[0];
};

async function mitMandant(db, runner) {
  await instanz(runner);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [TENANT_ID]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $2)`, [
    TENANT_ID,
    SUB,
  ]);
  return instanz(runner);
}

function formular(settings, aenderung) {
  return {
    agentName: settings.agentName,
    language: settings.language ?? "",
    agentStyle: settings.agentStyle ?? "",
    greeting: settings.greeting,
    allowPersonalData: settings.allowPersonalData,
    allowBankData: settings.allowBankData,
    ...aenderung,
  };
}

async function speichern(app, body) {
  return abrufMitFrist(`${app.base}/api/self-service/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: app.cookie },
    body: JSON.stringify(body),
  });
}

async function startApp(store, runner) {
  return starteSelfServiceApp({
    store,
    runner,
    secret: SECRET,
    sub: SUB,
    tenantId: TENANT_ID,
    email: `${SUB}@kunde.de`,
    aktiv: true,
    audit: () => {},
    config: withConfigNamespaces({ paymentEnabled: false, publicUrl: "https://agent.test" }),
    billing: {},
    provision: async () => {},
  });
}

test("Kriterium 1 (#3305): der letzte Flush der alten Instanz ueberschreibt die neuere Sprache nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await instanz(runner);
  a.updateSettings(BOOTSTRAP_TENANT_ID, { language: "fr" });
  await a.drainFlushes();

  const b = await instanz(runner);
  b.updateSettings(BOOTSTRAP_TENANT_ID, { language: "de" });
  await b.drainFlushes();

  await a.save();
  await a.drainFlushes();

  assert.equal(sprache(await instanz(runner)), "de");
});

test("Kriterium 2: zwei Instanzen speichern das volle Formular, beide Aenderungen bleiben", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitMandant(db, runner);
  a.updateSettings(TENANT_ID, { allowBankData: true });
  await a.drainFlushes();
  const b = await instanz(runner);
  const appA = await startApp(a, runner);
  const appB = await startApp(b, runner);
  try {
    const ausgangA = a.tenantContext(TENANT_ID).settings;
    const resA = await speichern(appA, formular(ausgangA, { agentName: "Frieda" }));
    assert.equal(resA.status, 200);
    const ausgangB = b.tenantContext(TENANT_ID).settings;
    const resB = await speichern(appB, formular(ausgangB, { allowBankData: false }));
    assert.equal(resB.status, 200);

    await a.save();
    await a.drainFlushes();
    await b.save();
    await b.drainFlushes();

    const gespeichert = await zeile(db, TENANT_ID);
    assert.equal(gespeichert.agent_name, "Frieda");
    assert.equal(gespeichert.allow_bank_data, false);
  } finally {
    await appA.close();
    await appB.close();
  }
});

test("Kriterium 2: Gesamt-Flushs aendern die Einstellungs-Zeile nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitMandant(db, runner);
  a.updateSettings(TENANT_ID, { agentName: "Frieda" });
  await a.drainFlushes();
  const vorher = await zeile(db, TENANT_ID);

  await a.save();
  await a.drainFlushes();

  assert.deepEqual(await zeile(db, TENANT_ID), vorher);
});

test("Kriterium 3: scheitert das Schreiben, antwortet die Route 503, die Kopie heilt und das Log meldet es", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  let schreibenKaputt = false;
  const runner = runnerFuer(db, (text) => {
    if (schreibenKaputt && /INSERT INTO settings/.test(text)) throw new Error("Datenbank weg");
  });
  const a = await mitMandant(db, runner);
  const app = await startApp(a, runner);
  const meldungen = [];
  const original = console.error;
  console.error = (...teile) => meldungen.push(teile.join(" "));
  try {
    const ausgang = a.tenantContext(TENANT_ID).settings;
    const alterName = ausgang.agentName;
    schreibenKaputt = true;
    const res = await speichern(app, formular(ausgang, { agentName: "Verloren" }));
    schreibenKaputt = false;

    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "settings_not_saved" });
    assert.equal(a.tenantContext(TENANT_ID).settings.agentName, alterName);
    assert.ok(meldungen.some((m) => m.includes(FEHLER_LOG)), "Fehler wird geloggt");
  } finally {
    console.error = original;
    await app.close();
  }
});

test("Kriterium 3: scheitert die Verbindung, antwortet die Route 503, die Kopie heilt, und ein Folge-Schreibfehler heilt wieder", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  let verbindungKaputt = false;
  let schreibenKaputt = false;
  const runner = runnerFuer(db, (text) => {
    if (schreibenKaputt && /INSERT INTO settings/.test(text)) throw new Error("Datenbank weg");
  });
  const speicherRunner = {
    withClient: async (fn) => {
      if (verbindungKaputt) throw new Error("timeout exceeded when trying to connect");
      return runner.withClient(fn);
    },
  };
  const a = await mitMandant(db, speicherRunner);
  const app = await startApp(a, runner);
  const meldungen = [];
  const original = console.error;
  console.error = (...teile) => meldungen.push(teile.join(" "));
  try {
    const ausgang = a.tenantContext(TENANT_ID).settings;
    const alterName = ausgang.agentName;
    verbindungKaputt = true;
    const res = await speichern(app, formular(ausgang, { agentName: "Verloren" }));
    verbindungKaputt = false;

    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "settings_not_saved" });
    assert.equal(a.tenantContext(TENANT_ID).settings.agentName, alterName);
    assert.ok(meldungen.some((m) => m.includes(FEHLER_LOG)), "Fehler wird geloggt");

    schreibenKaputt = true;
    const folge = a.updateSettings(TENANT_ID, { agentName: "Zwei" });
    assert.equal(await folge.geschrieben, false);
    schreibenKaputt = false;
    assert.equal(a.tenantContext(TENANT_ID).settings.agentName, alterName);

    const res2 = await speichern(app, formular(a.tenantContext(TENANT_ID).settings, { agentName: "Drei" }));
    assert.equal(res2.status, 200);
    assert.equal((await zeile(db, TENANT_ID)).agent_name, "Drei");
  } finally {
    console.error = original;
    await app.close();
  }
});

test("Kriterium 4: Antworten tragen keinen stand und bleiben schluesselgleich", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitMandant(db, runner);
  const app = await startApp(a, runner);
  try {
    const erwartet = EINSTELLUNGS_SCHLUESSEL;
    const res = await speichern(app, formular(a.tenantContext(TENANT_ID).settings, { agentName: "Neu" }));
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(await res.json()).sort(), erwartet);

    const zustand = await abrufMitFrist(`${app.base}/api/self-service/state`, {
      headers: { Cookie: app.cookie },
    });
    assert.deepEqual(Object.keys((await zustand.json()).settings).sort(), erwartet);
    assert.deepEqual(Object.keys(a.tenantContext(TENANT_ID).settings).sort(), erwartet);
  } finally {
    await app.close();
  }
});

test("Kriterium 5: ein neuer Mandant bekommt beim ersten Speichern eine vollstaendige Zeile", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitMandant(db, runner);
  assert.equal(await zeile(db, TENANT_ID), undefined, "ohne Speichern keine Zeile");

  a.updateSettings(TENANT_ID, { language: "de" });
  await a.drainFlushes();

  const gespeichert = await zeile(db, TENANT_ID);
  const vorgaben = a.tenantContext(TENANT_ID).settings;
  assert.equal(gespeichert.language, "de");
  assert.equal(gespeichert.agent_name, vorgaben.agentName);
  assert.equal(gespeichert.greeting, vorgaben.greeting);
  for (const spalte of [
    "allow_calendar",
    "allow_booking",
    "allow_summaries",
    "allow_personal_data",
    "allow_bank_data",
    "sms_summary_opt_in",
    "allow_research",
    "allow_call_memory",
  ]) {
    assert.notEqual(gespeichert[spalte], null, spalte);
  }
});
