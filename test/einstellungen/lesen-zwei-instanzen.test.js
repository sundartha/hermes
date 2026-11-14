import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  BOOTSTRAP_TENANT_ID,
  einstellungenNachladenVon,
  makePgStore,
  pgliteAlsRolleOhneSuperuser,
} from "../pg-helpers.js";
import { makeReadRoutes } from "../../src/routes/api-read.js";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.js";
import { starteSelfServiceApp } from "../gemeinsam/self-service-app.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";
import { EL_INBOUND_ACCESS_BOOT_ENV, OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, nowSeconds } from "../helpers.js";
import { mitDatenbankVorDemStart, mitInstanzHinterRelais, zeilenBis } from "../anrufe/zwei-instanzen-postgres.js";
import { mitHermesAufPostgres, neueAnrufe } from "../anrufe/hermes-mit-postgres.js";

const SECRET = "einstellungen-lesen-secret-0123456789";
const SUB = "sub-einstellungen-lesen";
const TENANT_ID = "t_sub-einstellungen-lesen";
const NACHLADEN_LOG = "[pg] einstellungen nachladen fehlgeschlagen";
const HTTP_OK = 200;
const KURZE_FRIST_MS = 60;
const GLEICHZEITIGE_ANRUFE = 5;
const VERZOEGERUNG_MS = 15;
const BOOT_NUMMER = "+15005550006";
const ANRUFER = "+4915112345678";
const OWNER_NAME = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;
const REGISTRIERUNG = "phnum_lesen";
const AGENT_ID = "agent_lesen";
const EL_ZUGANG = Object.freeze({
  ELEVENLABS_AGENT_ID: AGENT_ID,
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
  ...EL_INBOUND_ACCESS_BOOT_ENV,
});

function runnerFuer(db, vorQuery = async () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

const mitFassade = (store) =>
  Object.assign(store, {
    einstellungenNachladen: (tenantId) => einstellungenNachladenVon(store.load(), tenantId),
  });

async function instanz(runner, optionen) {
  const store = makePgStore(runner, optionen);
  await store.init();
  return mitFassade(store);
}

const sprache = (store) => store.resolveCallLanguage({ tenantId: BOOTSTRAP_TENANT_ID, numberRecord: null });
const einstellungen = (store) => store.tenantContext(TENANT_ID).settings;
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

async function startApp(store, runner, audit = () => {}) {
  return starteSelfServiceApp({
    store,
    runner,
    secret: SECRET,
    sub: SUB,
    tenantId: TENANT_ID,
    email: `${SUB}@kunde.de`,
    aktiv: true,
    audit,
    config: withConfigNamespaces({ paymentEnabled: false, publicUrl: "https://agent.test" }),
    billing: {},
    provision: async () => {},
  });
}

const zustand = async (app) =>
  (await abrufMitFrist(`${app.base}/api/self-service/state`, { headers: { Cookie: app.cookie } })).json();

const speichern = (app, body) =>
  abrufMitFrist(`${app.base}/api/self-service/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: app.cookie },
    body: JSON.stringify(body),
  });

function fehlerSammeln() {
  const meldungen = [];
  const original = console.error;
  console.error = (...teile) => meldungen.push(teile.join(" "));
  return { meldungen, wiederherstellen: () => (console.error = original) };
}

function haengendesLesen() {
  let freigeben;
  const tor = new Promise((weiter) => (freigeben = weiter));
  const zustandLesen = { haengt: false };
  const vorQuery = async (text) => {
    if (zustandLesen.haengt && /FROM settings WHERE/.test(text)) await tor;
  };
  return { zustandLesen, vorQuery, freigeben };
}

test("Kriterium 7: GET /api/self-service/state auf B liefert nach einer Aenderung auf A die neuen Werte", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitMandant(db, runner);
  a.updateSettings(TENANT_ID, { agentName: "Alt", language: "fr" });
  await a.drainFlushes();
  const b = await instanz(runner);
  a.updateSettings(TENANT_ID, { agentName: "Neu", language: "de" });
  await a.drainFlushes();
  assert.equal(einstellungen(b).agentName, "Alt", "B ist veraltet");

  const app = await startApp(b, runner);
  try {
    const antwort = await zustand(app);
    assert.equal(antwort.settings.agentName, "Neu");
    assert.equal(antwort.settings.language, "de");
    assert.equal(antwort.language, "de");
    assert.ok(!JSON.stringify(antwort).includes('"stand"'), "stand taucht in keiner Antwort auf");
  } finally {
    await app.close();
  }
});

test("Kriterium 7: GET /api/state auf B liefert nach einer Aenderung auf A die neuen Werte", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitMandant(db, runner);
  a.updateSettings(TENANT_ID, { agentName: "Alt" });
  await a.drainFlushes();
  const b = await instanz(runner);
  a.updateSettings(TENANT_ID, { agentName: "Neu" });
  await a.drainFlushes();

  const tenant = { requestTenant: () => TENANT_ID, requireTenant: () => TENANT_ID, tenantOwnsCall: () => true };
  const config = withConfigNamespaces({ multiTenant: false, claudeModel: "m", voiceEngine: "budget" });
  const app = express();
  app.use(makeReadRoutes({ store: b, config, audit: () => {}, tenant }));
  const server = await new Promise((fertig) => {
    const s = app.listen(0, "127.0.0.1", () => fertig(s));
  });
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/state`);
    assert.equal(res.status, HTTP_OK);
    const antwort = await res.json();
    assert.equal(antwort.settings.agentName, "Neu");
    assert.ok(!("stand" in antwort.settings));
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
});

test("Kriterium 6: Sprache einer veralteten Instanz folgt der Datenbank (Nachstellung #3305, Fall 2)", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await instanz(runner);
  a.updateSettings(BOOTSTRAP_TENANT_ID, { language: "fr" });
  await a.drainFlushes();
  const b = await instanz(runner);
  a.updateSettings(BOOTSTRAP_TENANT_ID, { language: "de" });
  await a.drainFlushes();
  assert.equal(sprache(b), "fr", "B ist veraltet");

  assert.equal(await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID), true);

  assert.equal(sprache(b), "de");
});

test("Kriterium 8: A schaltet das Anrufgedaechtnis ab, B nutzt es beim naechsten Anruf nicht mehr", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await instanz(runner);
  a.updateSettings(BOOTSTRAP_TENANT_ID, { allowCallMemory: true });
  await a.drainFlushes();
  const b = await instanz(runner);
  const frueher = b.createCall({ direction: "outbound", from: BOOT_NUMMER, to: ANRUFER, tenantId: BOOTSTRAP_TENANT_ID });
  b.getCall(frueher.id).result = { outcome: "Termin vereinbart", facts: [] };
  assert.equal(b.counterpartyMemory(BOOTSTRAP_TENANT_ID, ANRUFER).length, 1, "B erinnert sich");

  a.updateSettings(BOOTSTRAP_TENANT_ID, { allowCallMemory: false });
  await a.drainFlushes();
  await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID);

  assert.deepEqual(b.counterpartyMemory(BOOTSTRAP_TENANT_ID, ANRUFER), []);
});

test("Kriterium 9: scheitert das Lesen, bleibt die Sprache des alten Stands, die Rechte-Felder gelten als false und das Log meldet es", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  let lesenKaputt = false;
  const runner = runnerFuer(db, async (text) => {
    if (lesenKaputt && /FROM settings WHERE/.test(text)) throw new Error("Datenbank weg");
  });
  const a = await instanz(runner);
  a.updateSettings(BOOTSTRAP_TENANT_ID, {
    language: "fr",
    allowCallMemory: true,
    allowBankData: true,
    allowPersonalData: true,
    allowResearch: true,
  });
  await a.drainFlushes();
  const b = await instanz(runner);
  a.updateSettings(BOOTSTRAP_TENANT_ID, { language: "de" });
  await a.drainFlushes();
  const log = fehlerSammeln();
  try {
    lesenKaputt = true;
    assert.equal(await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID), false);
    lesenKaputt = false;

    const kopie = b.tenantContext(BOOTSTRAP_TENANT_ID).settings;
    assert.equal(sprache(b), "fr", "Sprache des alten Stands");
    for (const recht of ["allowCallMemory", "allowBankData", "allowPersonalData", "allowResearch"]) {
      assert.equal(kopie[recht], false, recht);
    }
    assert.ok(log.meldungen.some((m) => m.includes(NACHLADEN_LOG)), "Fehler wird geloggt");

    assert.equal(await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID), true, "naechster Eingang heilt");
    assert.equal(sprache(b), "de");
    assert.equal(b.tenantContext(BOOTSTRAP_TENANT_ID).settings.allowBankData, true);
  } finally {
    log.wiederherstellen();
  }
});

test("Kriterium 9: haengt das Lesen, bricht es nach der Frist ab und der Eingang laeuft mit abgeschalteten Rechten weiter", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const lesen = haengendesLesen();
  const runner = runnerFuer(db, lesen.vorQuery);
  const a = await instanz(runner);
  a.updateSettings(BOOTSTRAP_TENANT_ID, { language: "fr", allowBankData: true });
  await a.drainFlushes();
  const b = await instanz(runner, { einstellungenFristMs: KURZE_FRIST_MS });
  const log = fehlerSammeln();
  try {
    lesen.zustandLesen.haengt = true;
    const beginn = Date.now();
    const lesbar = await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID);
    assert.equal(lesbar, false);
    assert.ok(Date.now() - beginn < 1_000, "kehrt nach der Frist zurueck, nicht nach dem Haenger");
    assert.equal(sprache(b), "fr");
    assert.equal(b.tenantContext(BOOTSTRAP_TENANT_ID).settings.allowBankData, false);
    assert.ok(log.meldungen.some((m) => m.includes(NACHLADEN_LOG)), "Fristablauf wird geloggt");
  } finally {
    lesen.freigeben();
    log.wiederherstellen();
  }
  assert.equal(await b.einstellungenNachladen(BOOTSTRAP_TENANT_ID), true);
  assert.equal(b.tenantContext(BOOTSTRAP_TENANT_ID).settings.allowBankData, true, "nach dem Haenger heilt der Stand");
});

test("Kriterium 10: bei fuenf gleichzeitigen Eingaengen desselben Mandanten liest B hoechstens einmal zugleich", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  let zugleich = 0;
  let hoechstens = 0;
  let lesungen = 0;
  const runner = runnerFuer(db, async (text) => {
    if (!/FROM settings WHERE/.test(text)) return;
    lesungen += 1;
    zugleich += 1;
    hoechstens = Math.max(hoechstens, zugleich);
    await echtWarten(VERZOEGERUNG_MS);
    zugleich -= 1;
  });
  const b = await instanz(runner);
  const vorher = lesungen;

  const ergebnisse = await Promise.all(
    Array.from({ length: GLEICHZEITIGE_ANRUFE }, () => b.einstellungenNachladen(BOOTSTRAP_TENANT_ID)),
  );

  assert.deepEqual(ergebnisse, Array(GLEICHZEITIGE_ANRUFE).fill(true));
  assert.equal(hoechstens, 1);
  assert.ok(lesungen - vorher >= 1 && lesungen - vorher < GLEICHZEITIGE_ANRUFE, "Anfragen teilen sich das Lesen");
});

test("Kriterium 11: POST /api/self-service/settings prueft die Nur-Abschalten-Felder gegen den Stand der Datenbank", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = runnerFuer(db);
  const a = await mitMandant(db, runner);
  a.updateSettings(TENANT_ID, { allowBankData: true });
  await a.drainFlushes();
  const b = await instanz(runner);
  a.updateSettings(TENANT_ID, { allowBankData: false });
  await a.drainFlushes();
  assert.equal(einstellungen(b).allowBankData, true, "B haelt die Kopie noch offen");
  const audits = [];
  const app = await startApp(b, runner, (...teile) => audits.push(teile.join(" ")));
  try {
    const res = await speichern(app, { allowBankData: true });

    assert.equal(res.status, HTTP_OK);
    assert.equal((await res.json()).allowBankData, false);
    assert.equal((await zeile(db, TENANT_ID)).allow_bank_data, false);
    assert.ok(audits.some((m) => m.includes("rejected=allowBankData")), audits.join("|"));
  } finally {
    await app.close();
  }
});

test("Kriterium 11: ist der Stand nicht lesbar, wird ein true fuer ein Nur-Abschalten-Feld abgelehnt", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  let lesenKaputt = false;
  const runner = runnerFuer(db, async (text) => {
    if (lesenKaputt && /FROM settings WHERE/.test(text)) throw new Error("Datenbank weg");
  });
  const a = await mitMandant(db, runner);
  a.updateSettings(TENANT_ID, { allowBankData: true, allowPersonalData: true });
  await a.drainFlushes();
  const b = await instanz(runner);
  const audits = [];
  const app = await startApp(b, runner, (...teile) => audits.push(teile.join(" ")));
  const log = fehlerSammeln();
  try {
    lesenKaputt = true;
    const res = await speichern(app, { allowBankData: true, allowPersonalData: true, agentName: "Frieda" });
    lesenKaputt = false;

    assert.equal(res.status, HTTP_OK);
    assert.ok(audits.some((m) => m.includes("rejected=allowBankData,allowPersonalData")), audits.join("|"));
    const gespeichert = await zeile(db, TENANT_ID);
    assert.equal(gespeichert.allow_bank_data, true, "die Datenbank behaelt ihren Wert");
    assert.equal(gespeichert.agent_name, "Frieda", "freie Felder werden weiter gespeichert");
    assert.ok(log.meldungen.some((m) => m.includes(NACHLADEN_LOG)), "Fehler wird geloggt");
  } finally {
    log.wiederherstellen();
    await app.close();
  }
});

test("Kriterium 11: ist der Stand nicht lesbar, wird ein gesendetes false fuer ein Nur-Abschalten-Feld trotzdem gespeichert", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  let lesenKaputt = false;
  const runner = runnerFuer(db, async (text) => {
    if (lesenKaputt && /FROM settings WHERE/.test(text)) throw new Error("Datenbank weg");
  });
  const a = await mitMandant(db, runner);
  a.updateSettings(TENANT_ID, { allowBankData: true, allowPersonalData: true });
  await a.drainFlushes();
  const b = await instanz(runner);
  const app = await startApp(b, runner);
  const log = fehlerSammeln();
  try {
    lesenKaputt = true;
    const res = await speichern(app, { allowBankData: false });
    lesenKaputt = false;

    assert.equal(res.status, HTTP_OK);
    assert.equal((await res.json()).allowBankData, false);
    const gespeichert = await zeile(db, TENANT_ID);
    assert.equal(gespeichert.allow_bank_data, false, "das Abschalten landet in der Datenbank");
    assert.equal(gespeichert.allow_personal_data, true, "nicht gesendete Felder bleiben unberuehrt");
  } finally {
    log.wiederherstellen();
    await app.close();
  }
});

function signierterEingang(signer, callSid) {
  const rumpf = new URLSearchParams({ From: ANRUFER, To: BOOT_NUMMER, CallSid: callSid }).toString();
  const zeitstempel = String(nowSeconds());
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
      "telnyx-timestamp": zeitstempel,
    },
    body: rumpf,
  };
}

const eingangAuf = (instanzProzess, signer, callSid) =>
  abrufMitFrist(`${instanzProzess.localUrl}/voice/incoming`, signierterEingang(signer, callSid));

const anrufSprachen = async (sql) => (await sql(`SELECT language FROM call ORDER BY started_at, id`)).rows.map((r) => r.language);

const setzeSprache = (sql, sprachwert) =>
  sql(`UPDATE settings SET language = $2 WHERE tenant_id = $1`, [BOOTSTRAP_TENANT_ID, sprachwert]);

test("Kriterium 6 (Budget-Pfad): ein Anruf auf der veralteten Instanz B traegt die Sprache, die A gesetzt hat", async (t) => {
  await mitDatenbankVorDemStart(t, {}, async ({ sql, signer, starte }) => {
    await setzeSprache(sql, "fr");
    const b = await starte();
    await setzeSprache(sql, "de");

    const res = await eingangAuf(b, signer, "CAlesen_budget");

    assert.equal(res.status, HTTP_OK);
    const sprachen = await zeilenBis(
      () => anrufSprachen(sql),
      (liste) => liste.length === 1,
    );
    assert.deepEqual(sprachen, ["de"]);
  });
});

function initAnfrage(instanzProzess, token, nr) {
  return abrufMitFrist(`${instanzProzess.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INIT_TOKEN_HEADER]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN,
    },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: `conv_lesen_${nr}`,
      called_number: BOOT_NUMMER,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: token },
    }),
  });
}

async function initAntwortFuerEingang(instanzProzess, signer, nr) {
  const eingang = await eingangAuf(instanzProzess, signer, `CAlesen_el_${nr}`);
  assert.equal(eingang.status, HTTP_OK);
  const token = (await eingang.text()).match(new RegExp(`${EL_CALL_BINDING_SIP_HEADER}=([0-9a-f]{32})`))[1];
  const init = await initAnfrage(instanzProzess, token, nr);
  assert.equal(init.status, HTTP_OK, await init.clone().text());
  return (await init.json()).conversation_config_override.agent;
}

test("Kriterium 6 (ElevenLabs-Eingang): Anruf und Antwort des Init-Webhooks tragen die Sprache, die A gesetzt hat", async (t) => {
  await mitDatenbankVorDemStart(t, { env: EL_ZUGANG }, async ({ sql, signer, starte }) => {
    await sql(`UPDATE tenant SET owner_name = $2, first_name = $3 WHERE id = $1`, [
      BOOTSTRAP_TENANT_ID,
      OWNER_NAME,
      OWNER_TEST_FIRST_NAME,
    ]);
    await sql(`UPDATE number SET provider_agent_phone_number_id = $2 WHERE tenant_id = $1`, [
      BOOTSTRAP_TENANT_ID,
      REGISTRIERUNG,
    ]);
    await setzeSprache(sql, "fr");
    const b = await starte();
    const franzoesisch = await initAntwortFuerEingang(b, signer, 1);
    assert.equal(franzoesisch.language, "fr", "Ausgangslage: B spricht, was in der Datenbank steht");

    await setzeSprache(sql, "de");
    const deutsch = await initAntwortFuerEingang(b, signer, 2);

    assert.equal(deutsch.language, "de");
    assert.notEqual(deutsch.first_message, franzoesisch.first_message);
    const sprachen = await zeilenBis(
      () => anrufSprachen(sql),
      (liste) => liste.length === 2,
    );
    assert.deepEqual(sprachen, ["fr", "de"]);
  });
});

test("Kriterium 6 (place_call): ein Auftrag ohne language ueber B nimmt die Sprache, die A gesetzt hat", async (t) => {
  await mitHermesAufPostgres(t, {}, async ({ srv, sql }) => {
    await setzeSprache(sql, "fr");
    const { rufeAn } = neueAnrufe();

    const res = await rufeAn(srv);

    assert.equal(res.status, HTTP_OK);
    const sprachen = await zeilenBis(
      () => anrufSprachen(sql),
      (liste) => liste.length === 1,
    );
    assert.deepEqual(sprachen, ["fr"]);
  });
});

test("Kriterium 9 (Eingang): haengt die Datenbank, antwortet /voice/incoming im normalen Pfad mit der Sprache des alten Stands", async (t) => {
  await mitInstanzHinterRelais(t, {}, async ({ a, sql, signer, relais }) => {
    const erster = await eingangAuf(a, signer, "CAlesen_basis");
    assert.equal(erster.status, HTTP_OK);
    const [grundsprache] = await zeilenBis(
      () => anrufSprachen(sql),
      (liste) => liste.length === 1,
    );
    assert.notEqual(grundsprache, "fr", "Ausgangslage: die Grundsprache ist nicht die neue");
    await setzeSprache(sql, "fr");

    relais.anhalten();
    let zweiter;
    try {
      zweiter = await eingangAuf(a, signer, "CAlesen_haengt");
    } finally {
      relais.fortsetzen();
      await relais.abwarten();
    }

    assert.equal(zweiter.status, HTTP_OK);
    assert.match(await zweiter.text(), /<Gather/, "normaler Antwortpfad, kein technisches Ende");
    assert.match(a.stdout, /\[pg\] einstellungen nachladen fehlgeschlagen/);
    const sprachen = await zeilenBis(
      () => anrufSprachen(sql),
      (liste) => liste.length === 2,
    );
    assert.equal(sprachen[1], grundsprache, "Sprache des alten Stands");

    await eingangAuf(a, signer, "CAlesen_danach");
    const danach = await zeilenBis(
      () => anrufSprachen(sql),
      (liste) => liste.length === 3,
    );
    assert.equal(danach[2], "fr", "der naechste Eingang heilt");
  });
});

test("Kriterium 31: mit dem JSON-Speicher hat das Nachladen nichts zu tun und meldet den Stand als lesbar", async () => {
  const fassade = await import("../../src/store.js");

  assert.equal(await fassade.einstellungenNachladen(BOOTSTRAP_TENANT_ID), true);
});
