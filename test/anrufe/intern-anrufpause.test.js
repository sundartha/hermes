import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEPLOY_TOKEN_MIN_LENGTH } from "../../src/routes/intern-anrufe-laufend.js";
import {
  ANRUFPAUSE_PATH,
  anrufpauseLesenHandler,
  anrufpauseSetzenHandler,
} from "../../src/routes/intern-anrufpause.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVICE_UNAVAILABLE = 503;
const ANTWORT_FRIST_MS = 2000;
const NUR_LESEN = 0o500;
const VOLLZUGRIFF = 0o700;
const TOKEN = "p".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const FALSCHES_TOKEN = "q".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const AUFRUFER_IP = "203.0.113.27";
const FEHLERDETAIL = "speicher_v6_kaputt";
const KEIN_ZWISCHENSPEICHER = "no-store";
const UNGUELTIG = Object.freeze({ error: "invalid_body" });
const NICHT_GESPEICHERT = Object.freeze({ error: "persist_failed" });
const UNGUELTIGE_KOERPER = Object.freeze([
  ["fehlt", undefined],
  ["null", null],
  ["leer", {}],
  ["Text statt Boolean", { an: "true" }],
  ["Zahl statt Boolean", { an: 1 }],
  ["null statt Boolean", { an: null }],
  ["zusaetzlicher Schluessel", { an: true, grund: "wartung" }],
  ["Liste", [true]],
]);
const STANDIN_NAMEN = [
  "callFinish lifecycle provisioning outboundGates callQuotaDenial requestTenant requireTenant",
  "conversationWatchdog ttsStore directiveSynth voiceRender costTruing messaging consultDelivery",
  "elevenLabsOutbound inboundBridges accountsRef auditStoreRef durableAuditFor",
].flatMap((zeile) => zeile.split(" "));

const DATENORDNER = fs.mkdtempSync(path.join(os.tmpdir(), "intern-anrufpause-"));
const SPEICHERDATEI = path.join(DATENORDNER, "store.json");
const SPEICHERSTAND_OHNE_PAUSE = Object.freeze({
  settings: {},
  calls: [],
  numbers: [],
  notifications: [],
});
fs.writeFileSync(SPEICHERDATEI, JSON.stringify(SPEICHERSTAND_OHNE_PAUSE));
const { config } = await import("../../src/config.js");
Object.assign(config.server, { dataDir: DATENORDNER, webDistDir: path.join(DATENORDNER, "web") });
config.auth.deployToken = TOKEN;
const speicher = await import("../../src/store.js");
const { buildApp } = await import("../../src/app.js");

after(() => {
  fs.chmodSync(DATENORDNER, VOLLZUGRIFF);
  fs.rmSync(DATENORDNER, { recursive: true, force: true });
});

const standIn = new Proxy(function standIn() {}, {
  get: (_ziel, schluessel) => (schluessel === "then" ? undefined : standIn),
  apply: () => standIn,
});

function gespeicherterWert() {
  return JSON.parse(fs.readFileSync(SPEICHERDATEI, "utf8")).anrufpause;
}

async function mitMitschnitt(arbeit) {
  const zeilen = [];
  const { log, warn, error } = console;
  console.log = console.warn = console.error = (...teile) => zeilen.push(teile.join(" "));
  try {
    return { ergebnis: await arbeit(), zeilen };
  } finally {
    Object.assign(console, { log, warn, error });
  }
}

function attrappenSpeicher({ wirft = false } = {}) {
  const attrappe = { an: false, aufrufe: [], freigeben: null };
  attrappe.anrufpauseAktiv = () => attrappe.an;
  attrappe.setzeAnrufpause = (an) => {
    attrappe.aufrufe.push(an);
    return new Promise((fertig, scheitern) => {
      attrappe.freigeben = () => (wirft ? scheitern(new Error(FEHLERDETAIL)) : fertig(an));
    }).then(() => {
      attrappe.an = an;
    });
  };
  return attrappe;
}

function anfrage(koerper, authorization = `Bearer ${TOKEN}`) {
  return { headers: { authorization }, path: ANRUFPAUSE_PATH, ip: AUFRUFER_IP, body: koerper };
}

function antwortSammler() {
  const antwort = { status: HTTP_OK, kopf: {}, koerper: undefined, weiter: [] };
  const merken = (feld) => (wert) => {
    Object.assign(antwort, { [feld]: wert });
    return res;
  };
  const res = {
    set: (name, wert) => merken("kopf")({ ...antwort.kopf, [name.toLowerCase()]: wert }),
    status: merken("status"),
    json: merken("koerper"),
  };
  return { antwort, res, next: (fehler) => antwort.weiter.push(fehler) };
}

async function setzen(store, koerper, authorization) {
  const { antwort, res, next } = antwortSammler();
  const handler = anrufpauseSetzenHandler({ config: { auth: { deployToken: TOKEN } }, store });
  const laeuft = handler(anfrage(koerper, authorization), res, next);
  await new Promise((weiter) => setImmediate(weiter));
  return { antwort, laeuft };
}

async function setzenUndFreigeben(store, koerper) {
  return mitMitschnitt(async () => {
    const { antwort, laeuft } = await setzen(store, koerper);
    const vorFreigabe = antwort.koerper;
    store.freigeben();
    await laeuft;
    return { antwort, vorFreigabe };
  });
}

test("Anrufpause: GET liefert genau {an} mit dem Wert des Speichers und no-store", () => {
  const store = attrappenSpeicher();
  const handler = anrufpauseLesenHandler({ config: { auth: { deployToken: TOKEN } }, store });
  for (const an of [false, true]) {
    store.an = an;
    const { antwort, res } = antwortSammler();
    handler(anfrage(undefined), res);
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(antwort.koerper, { an });
    assert.deepEqual(antwort.kopf, { "cache-control": KEIN_ZWISCHENSPEICHER });
  }
});

test("Anrufpause: POST ohne genau {an: <boolean>} gibt 400 und setzt nichts", async () => {
  for (const [fall, koerper] of UNGUELTIGE_KOERPER) {
    const store = attrappenSpeicher();
    const { ergebnis, zeilen } = await mitMitschnitt(() => setzen(store, koerper));
    assert.equal(ergebnis.antwort.status, HTTP_BAD_REQUEST, fall);
    assert.deepEqual(ergebnis.antwort.koerper, UNGUELTIG, fall);
    assert.equal(ergebnis.antwort.kopf["cache-control"], KEIN_ZWISCHENSPEICHER, fall);
    assert.deepEqual(store.aufrufe, [], fall);
    assert.deepEqual(zeilen, [], fall);
  }
});

test("Anrufpause: POST mit falschem Token gibt 401 und setzt nichts", async () => {
  const store = attrappenSpeicher();
  const { ergebnis } = await mitMitschnitt(() =>
    setzen(store, { an: true }, `Bearer ${FALSCHES_TOKEN}`),
  );
  assert.equal(ergebnis.antwort.status, HTTP_UNAUTHORIZED);
  assert.deepEqual(store.aufrufe, []);
});

test("Anrufpause: gueltiges POST antwortet erst nach dem Setzen mit genau {an} und schreibt eine Audit-Zeile", async () => {
  for (const an of [true, false]) {
    const store = attrappenSpeicher();
    const { ergebnis, zeilen } = await setzenUndFreigeben(store, { an });
    assert.equal(ergebnis.vorFreigabe, undefined);
    assert.deepEqual(store.aufrufe, [an]);
    assert.equal(ergebnis.antwort.status, HTTP_OK);
    assert.deepEqual(ergebnis.antwort.koerper, { an });
    assert.deepEqual(Object.keys(ergebnis.antwort.koerper), ["an"]);
    assert.equal(ergebnis.antwort.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
    assert.deepEqual(ergebnis.antwort.weiter, []);
    assert.deepEqual(zeilen, [`[audit] anrufpause_gesetzt ip=system an=${an}`]);
  }
});

test("Anrufpause: scheitert das Setzen, antwortet POST mit 503 persist_failed ohne Fehlerdetails", async () => {
  const store = attrappenSpeicher({ wirft: true });
  const { ergebnis, zeilen } = await setzenUndFreigeben(store, { an: true });
  assert.equal(ergebnis.vorFreigabe, undefined);
  assert.equal(ergebnis.antwort.status, HTTP_SERVICE_UNAVAILABLE);
  assert.deepEqual(ergebnis.antwort.koerper, NICHT_GESPEICHERT);
  assert.equal(ergebnis.antwort.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
  assert.deepEqual(ergebnis.antwort.weiter, []);
  assert.equal(store.an, false);
  assert.deepEqual(zeilen, ["[audit] anrufpause_fehlgeschlagen ip=system an=true"]);
  const text = JSON.stringify([ergebnis.antwort, zeilen]);
  assert.deepEqual(
    [FEHLERDETAIL, AUFRUFER_IP, TOKEN].filter((wert) => text.includes(wert)),
    [],
  );
});

test("Anrufpause: eine store.json ohne Feld anrufpause gilt als nicht pausiert und bekommt beim Speichern false", () => {
  assert.equal(
    Object.hasOwn(JSON.parse(fs.readFileSync(SPEICHERDATEI, "utf8")), "anrufpause"),
    false,
  );
  assert.equal(speicher.anrufpauseAktiv(), false);
  assert.equal(speicher.load().anrufpause, false);
  speicher.save();
  assert.equal(gespeicherterWert(), false);
});

test("Anrufpause: der Speicher zaehlt nur echtes true als Pause und schreibt sie in store.json", async () => {
  assert.equal(speicher.anrufpauseAktiv(), false);
  assert.equal(await speicher.setzeAnrufpause(true), true);
  assert.equal(speicher.anrufpauseAktiv(), true);
  assert.equal(gespeicherterWert(), true);
  await speicher.setzeAnrufpause(false);
  assert.equal(speicher.anrufpauseAktiv(), false);
  assert.equal(gespeicherterWert(), false);
  for (const fremderWert of ["ja", 1, "true"]) {
    speicher.load().anrufpause = fremderWert;
    assert.equal(speicher.anrufpauseAktiv(), false, JSON.stringify(fremderWert));
  }
  speicher.load().anrufpause = false;
});

test("Anrufpause: die echte App liest und setzt /intern/anrufpause mit Konfiguration und Speicher", async (kontext) => {
  const abhaengigkeiten = {
    ...Object.fromEntries(STANDIN_NAMEN.map((name) => [name, standIn])),
    config,
    store: speicher,
    audit: () => {},
  };
  const { ergebnis: app } = await mitMitschnitt(async () => (await buildApp(abhaengigkeiten)).app);
  const server = await new Promise((fertig) => {
    const lauscht = app.listen(0, "127.0.0.1", () => fertig(lauscht));
  });
  kontext.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const adresse = `http://127.0.0.1:${server.address().port}${ANRUFPAUSE_PATH}`;
  const authorization = `Bearer ${TOKEN}`;
  const lesen = async () =>
    (
      await fetch(adresse, {
        headers: { authorization },
        signal: AbortSignal.timeout(ANTWORT_FRIST_MS),
      })
    ).json();
  assert.deepEqual(await lesen(), { an: false });
  const { ergebnis: gesetzt } = await mitMitschnitt(() =>
    fetch(adresse, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ an: true }),
      signal: AbortSignal.timeout(ANTWORT_FRIST_MS),
    }),
  );
  assert.equal(gesetzt.status, HTTP_OK);
  assert.deepEqual(await gesetzt.json(), { an: true });
  assert.equal(speicher.anrufpauseAktiv(), true);
  assert.deepEqual(await lesen(), { an: true });
  await speicher.setzeAnrufpause(false);
});

test("Anrufpause: ist der Datenordner schreibgeschuetzt, wirft das Setzen und der alte Wert bleibt", async (kontext) => {
  assert.equal(speicher.anrufpauseAktiv(), false);
  fs.chmodSync(DATENORDNER, NUR_LESEN);
  kontext.after(() => fs.chmodSync(DATENORDNER, VOLLZUGRIFF));
  await assert.rejects(() => speicher.setzeAnrufpause(true));
  assert.equal(speicher.anrufpauseAktiv(), false);
  assert.equal(gespeicherterWert(), false);
});
