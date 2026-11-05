import assert from "node:assert/strict";
import { after, test } from "node:test";

import express from "express";
import pg from "pg";

import { deriveConfirmationKey, normalizeConfirmationCode } from "../../src/call-confirmation.js";
import { POOL_GRENZEN } from "../../src/utils/pg-pool.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbank, POSTGRES_VARIABLE } from "./echtes-postgres.js";

const ERWARTETER_FEHLER =
  "Datenbankfehler beim Einlösen ergibt nicht 503 confirmation_unavailable, oder die Transaktion hat keine kurze Anweisungsfrist";
const GEHEIMNIS = "bestaetigungscodes-ausfall-secret-mind-32-zeichen";
const KONFIGURATION = {
  auth: { callConfirmationSecret: GEHEIMNIS },
  voice: { elevenLabsOutbound: { enabled: false } },
};
const ZIEL = "+4915112345678";
const PFAD = "/api/call-confirmations";
const KOPF_MANDANT = "x-internal-tenant";
const HTTP_OK = 200;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;
const ZEITGRENZE_MS = 120_000;
const NICHT_VERFUEGBAR = { reason: "confirmation_unavailable" };
const VERBRAUCHT = { confirmed: false, reason: "already_used" };
const ABGELEHNT = { confirmed: false, reason: undefined };

const FENSTER_MS = 300_000;
const ANNAHMEFENSTER = 2;
const BREMSE_GRENZE = 10;
const HEUTIGES_FENSTER = 5_900_000;
const FERNES_FENSTER = 13_000_000;
const FRUEHES_FENSTER = 1_000_000;
const UHR_START_MS = HEUTIGES_FENSTER * FENSTER_MS;
const EINE_MS = 1;

const BESTAETIGUNG_ANWEISUNGSFRIST_MS = 1000;
const FRIST_ALS_TEXT = "1s";
const KURZE_FRIST_MS = 5;
const DAUER_MS = 50;
const MS_JE_SEKUNDE = 1000;
const ROLLBACK_NACH_GESCHEITERTEM_COMMIT = 1;

const VERBRAUCH = "bestaetigung_verbrauch";
const SLOT = "bestaetigung_slot";
const SLOT_VERSTECKT = "bestaetigung_slot_versteckt";
const FEHLVERSUCH = "bestaetigung_fehlversuch";
const REGISTERTABELLEN = [VERBRAUCH, SLOT, FEHLVERSUCH];
const LEERES_REGISTER = { [VERBRAUCH]: 0, [SLOT]: 0, [FEHLVERSUCH]: 0 };
const SCHREIBEND = "INSERT OR UPDATE";
const JEDE_AENDERUNG = "INSERT OR UPDATE OR DELETE";
const STOERUNG_MELDUNG = "eingeschleuster-datenbankfehler-ausfall";
const LOG_ARTEN = ["log", "warn", "error"];
const LOG_MARKE = "[call-confirmation]";
const OHNE_POSTGRES = `kein Postgres, übersprungen (${POSTGRES_VARIABLE} fehlt)`;

const FUNKTIONEN = `
  CREATE TABLE frist_protokoll (tabelle text, frist text);
  CREATE FUNCTION frist_merken() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    INSERT INTO frist_protokoll VALUES (TG_TABLE_NAME, current_setting('statement_timeout'));
    RETURN NULL;
  END $$;
  CREATE FUNCTION stoerung_fehler() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION '${STOERUNG_MELDUNG}';
  END $$;
  CREATE FUNCTION stoerung_ohne_meldung() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION '';
  END $$;
  CREATE FUNCTION frist_verkuerzen() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM set_config('statement_timeout', '${KURZE_FRIST_MS}', true);
    RETURN NULL;
  END $$;
  CREATE FUNCTION dauert_laenger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM pg_sleep(${DAUER_MS / MS_JE_SEKUNDE});
    RETURN NULL;
  END $$;
`;

const datenbank = await echteDatenbank({ after, diagnostic() {}, skip() {} });
const OPTIONEN = { timeout: ZEITGRENZE_MS, skip: datenbank ? false : OHNE_POSTGRES };
const uhr = { ms: UHR_START_MS };
const umgebung = datenbank ? await aufbauen() : null;

function antwortBricht() {
  throw new Error(STOERUNG_MELDUNG);
}

function routeStarten(makeCallConfirmationRoutes, store, jsonErsetzer) {
  const app = express();
  app.set("json replacer", jsonErsetzer);
  app.use(express.json());
  app.use(
    makeCallConfirmationRoutes({
      store,
      config: KONFIGURATION,
      tenant: { requestTenant: (req) => req.headers[KOPF_MANDANT] },
      now: () => uhr.ms,
    }),
  );
  return new Promise((fertig) => {
    const server = app.listen(0, "127.0.0.1", () => fertig(server));
  });
}

async function aufbauen() {
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = datenbank.adresse;
  const { makeCallConfirmationRoutes } = await import("../../src/routes/api-call-confirmations.js");
  const { MCP_HOP_TIMEOUT_MS } = await import("../../src/mcp-tools.js");
  const ersterSpeicher = await import("../../src/store.js");
  const zweiterSpeicher = await import("../../src/store.js?zweite-instanz");
  const erste = await routeStarten(makeCallConfirmationRoutes, ersterSpeicher);
  const zweite = await routeStarten(makeCallConfirmationRoutes, zweiterSpeicher);
  const sendeBruch = await routeStarten(makeCallConfirmationRoutes, ersterSpeicher, antwortBricht);
  after(() => {
    for (const server of [erste, zweite, sendeBruch]) {
      server.close();
      server.closeAllConnections();
    }
  });
  const verwaltung = await datenbank.verbinden();
  await verwaltung.query(FUNKTIONEN);
  return { erste, zweite, sendeBruch, verwaltung, MCP_HOP_TIMEOUT_MS };
}

async function frischerMandant(mandant, startMs = UHR_START_MS) {
  uhr.ms = startMs;
  await umgebung.verwaltung.query(`INSERT INTO tenant (id) VALUES ($1)`, [mandant]);
  return { erste: { route: umgebung.erste, mandant }, zweite: { route: umgebung.zweite, mandant } };
}

function anfrageMit(objective = "Termin beim Friseur vereinbaren") {
  return { to: ZIEL, objective };
}

async function senden({ route, mandant }, koerper) {
  const antwort = await abrufMitFrist(`http://127.0.0.1:${route.address().port}${PFAD}`, {
    method: "POST",
    headers: { "content-type": "application/json", [KOPF_MANDANT]: mandant },
    body: JSON.stringify(koerper),
  });
  const istJson = antwort.headers.get("content-type")?.includes("json");
  return { status: antwort.status, koerper: istJson ? await antwort.json() : {} };
}

async function ausstellen(ort, inhalt) {
  const antwort = await senden(ort, inhalt);
  assert.equal(antwort.status, HTTP_OK);
  return antwort.koerper.confirmation;
}

async function codeHolen(ort, inhalt) {
  const { code } = await ausstellen(ort, inhalt);
  return code;
}

function einloesen(ort, inhalt, code) {
  return senden(ort, { ...inhalt, confirmation_code: code });
}

async function bestaetigt(ort, inhalt, code) {
  const { koerper } = await einloesen(ort, inhalt, code);
  return koerper.confirmed;
}

async function ablehnung(ort, inhalt, code) {
  const {
    koerper: { confirmed, reason },
  } = await einloesen(ort, inhalt, code);
  return { confirmed, reason };
}

function falscherCode(richtigerCode) {
  const [erstes, ...rest] = richtigerCode;
  return `${erstes === "0" ? "1" : "0"}${rest.join("")}`;
}

async function ausloeser(t, { tabelle, ereignis, funktion }) {
  const name = `${funktion}_${tabelle}`;
  await umgebung.verwaltung.query(
    `CREATE TRIGGER ${name} BEFORE ${ereignis} ON ${tabelle} FOR EACH STATEMENT EXECUTE FUNCTION ${funktion}()`,
  );
  const entfernen = () => umgebung.verwaltung.query(`DROP TRIGGER IF EXISTS ${name} ON ${tabelle}`);
  t.after(entfernen);
  return entfernen;
}

async function slotTabelleVerstecken(t) {
  const { verwaltung } = umgebung;
  await verwaltung.query(`ALTER TABLE ${SLOT} RENAME TO ${SLOT_VERSTECKT}`);
  const aufheben = () =>
    verwaltung.query(`ALTER TABLE IF EXISTS ${SLOT_VERSTECKT} RENAME TO ${SLOT}`);
  t.after(aufheben);
  return aufheben;
}

function fehlerBei(tabelle, ereignis) {
  return (t) => ausloeser(t, { tabelle, ereignis, funktion: "stoerung_fehler" });
}

const AUSFALL_EINLOESEN = {
  name: "einloesen",
  merkmal: STOERUNG_MELDUNG,
  stoeren: fehlerBei(VERBRAUCH, "INSERT"),
  koerper: (code) => ({ confirmation_code: code }),
};
const AUSFALL_ZAEHLEN = {
  name: "zaehlen",
  merkmal: STOERUNG_MELDUNG,
  stoeren: fehlerBei(FEHLVERSUCH, SCHREIBEND),
  koerper: (code) => ({ confirmation_code: falscherCode(code) }),
};
const AUSFALL_AUSSTELLEN = {
  name: "ausstellen",
  merkmal: SLOT,
  stoeren: slotTabelleVerstecken,
  koerper: () => ({}),
};
const AUSFAELLE = [AUSFALL_EINLOESEN, AUSFALL_ZAEHLEN, AUSFALL_AUSSTELLEN];
const AUSFALL_OHNE_FEHLEROBJEKT = {
  name: "ohne-fehlerobjekt",
  stoeren: treiberLehntOhneFehlerobjektAb,
  koerper: AUSFALL_EINLOESEN.koerper,
};
const AUSFALL_LEERE_MELDUNG = {
  name: "leere-meldung",
  stoeren: (t) =>
    ausloeser(t, { tabelle: VERBRAUCH, ereignis: "INSERT", funktion: "stoerung_ohne_meldung" }),
  koerper: AUSFALL_EINLOESEN.koerper,
};

function logMitschneiden(t) {
  const zeilen = [];
  for (const art of LOG_ARTEN) {
    t.mock.method(console, art, (...teile) => {
      zeilen.push(teile.map(String).join(" "));
    });
  }
  return zeilen;
}

async function ausfallErleben(t, fall, mandant) {
  const { erste } = await frischerMandant(mandant);
  const inhalt = anfrageMit();
  const code = await codeHolen(erste, inhalt);
  const aufheben = await fall.stoeren(t);
  const antwort = await senden(erste, { ...inhalt, ...fall.koerper(code) });
  await aufheben();
  return { code, antwort };
}

function geheimeSpuren(code) {
  const schluessel = deriveConfirmationKey(GEHEIMNIS);
  return [
    code,
    normalizeConfirmationCode(code),
    GEHEIMNIS,
    schluessel.toString("hex"),
    schluessel.toString("base64"),
  ];
}

function pruefeLogOhneGeheimes(zeilen, code) {
  for (const spur of geheimeSpuren(code)) {
    assert.equal(
      zeilen.filter((zeile) => zeile.includes(spur)).length,
      0,
      "eine Logzeile nennt Code, Secret oder Schlüssel",
    );
  }
}

function pruefeNichtVerfuegbar(antwort) {
  assert.equal(antwort.status, HTTP_SERVICE_UNAVAILABLE, ERWARTETER_FEHLER);
  assert.deepEqual(antwort.koerper, NICHT_VERFUEGBAR, ERWARTETER_FEHLER);
}

async function pruefeAusfall(t, fall) {
  const zeilen = logMitschneiden(t);
  const { code, antwort } = await ausfallErleben(t, fall, `mandant-s10-${fall.name}`);
  pruefeNichtVerfuegbar(antwort);
  assert.ok(
    zeilen.some((zeile) => zeile.includes(fall.merkmal)),
    `keine Logzeile nennt den Datenbankfehler: ${zeilen.join(" | ")}`,
  );
  pruefeLogOhneGeheimes(zeilen, code);
}

async function registerZeilen({ mandant }) {
  const anzahl = {};
  for (const tabelle of REGISTERTABELLEN) {
    const { rows } = await umgebung.verwaltung.query(
      `SELECT count(*)::int AS anzahl FROM ${tabelle} WHERE tenant_id = $1`,
      [mandant],
    );
    anzahl[tabelle] = rows[0].anzahl;
  }
  return anzahl;
}

function anweisungsText(abfrage) {
  return String(abfrage?.text ?? abfrage);
}

function anweisungsTexte(abfragen) {
  return abfragen.mock.calls.map(({ arguments: [abfrage] }) => anweisungsText(abfrage));
}

function treiberLehntOhneFehlerobjektAb(t) {
  const echteAbfrage = pg.Client.prototype.query;
  const abfragen = t.mock.method(pg.Client.prototype, "query", function abfrage(text, ...rest) {
    return anweisungsText(text).includes(VERBRAUCH)
      ? Promise.reject()
      : echteAbfrage.call(this, text, ...rest);
  });
  return () => abfragen.mock.restore();
}

async function pruefeAblehnungOhneMeldung(t, fall) {
  const zeilen = logMitschneiden(t);
  const { antwort } = await ausfallErleben(t, fall, `mandant-s10-${fall.name}`);
  pruefeNichtVerfuegbar(antwort);
  const logzeilen = zeilen.filter((zeile) => zeile.includes(LOG_MARKE));
  assert.equal(logzeilen.length, 1, `erwartet genau eine Logzeile: ${zeilen.join(" | ")}`);
  const [logzeile] = logzeilen;
  const angabe = logzeile.slice(logzeile.lastIndexOf(":") + 1).trim();
  assert.notEqual(angabe, "", `die Logzeile sagt nichts über den Fehler: ${logzeile}`);
}

function transaktionAus(texte) {
  const beginn = texte.findIndex((text) => /^\s*BEGIN/i.test(text));
  const ende = texte.findIndex(
    (text, stelle) => stelle > beginn && /^\s*(COMMIT|ROLLBACK)/i.test(text),
  );
  return texte.slice(beginn, ende + 1);
}

function schlimmsteDauerMs(transaktion) {
  const mitPoolFrist = transaktion.findIndex((text) => /statement_timeout/i.test(text)) + 1;
  assert.ok(mitPoolFrist > 0, "keine Anweisung setzt die Frist");
  const mitKurzerFrist = transaktion.length - mitPoolFrist;
  assert.ok(mitKurzerFrist > 0, "nach dem Setzen der Frist wurde nichts gezählt");
  return (
    POOL_GRENZEN.connectionTimeoutMillis +
    mitPoolFrist * POOL_GRENZEN.statementTimeoutMs +
    (mitKurzerFrist + ROLLBACK_NACH_GESCHEITERTEM_COMMIT) * BESTAETIGUNG_ANWEISUNGSFRIST_MS
  );
}

async function fristProtokoll() {
  const { rows } = await umgebung.verwaltung.query(`SELECT tabelle, frist FROM frist_protokoll`);
  return rows;
}

function grenzenAb(startMs) {
  return {
    imFolgefenster: startMs + FENSTER_MS,
    abgelaufen: startMs + ANNAHMEFENSTER * FENSTER_MS,
  };
}

test(
  "S10: scheitert die Datenbank beim Einlösen, antwortet die Route 503 und die Logzeile nennt den Fehler",
  OPTIONEN,
  (t) => pruefeAusfall(t, AUSFALL_EINLOESEN),
);

test(
  "S10: scheitert das Zählen eines Fehlversuchs, antwortet die Route 503 statt 200 abgelehnt",
  OPTIONEN,
  (t) => pruefeAusfall(t, AUSFALL_ZAEHLEN),
);

test(
  "S10: scheitert die Datenbank beim Ausstellen, antwortet die Route 503 ohne Code",
  OPTIONEN,
  (t) => pruefeAusfall(t, AUSFALL_AUSSTELLEN),
);

test(
  "S10: lehnt der Treiber ohne Fehlerobjekt ab, antwortet die Route 503 und die Logzeile bleibt nicht leer",
  OPTIONEN,
  (t) => pruefeAblehnungOhneMeldung(t, AUSFALL_OHNE_FEHLEROBJEKT),
);

test(
  "S10: meldet die Datenbank einen Fehler mit leerer Meldung, antwortet die Route 503 und die Logzeile bleibt nicht leer",
  OPTIONEN,
  (t) => pruefeAblehnungOhneMeldung(t, AUSFALL_LEERE_MELDUNG),
);

test(
  "S10: scheitert das Senden der Antwort, endet die Anfrage mit 500 statt zu hängen und nennt kein confirmed",
  OPTIONEN,
  async (t) => {
    logMitschneiden(t);
    const { erste } = await frischerMandant("mandant-s10-senden");
    const inhalt = anfrageMit();
    const code = await codeHolen(erste, inhalt);
    const ort = { ...erste, route: umgebung.sendeBruch };
    const antwort = await einloesen(ort, inhalt, code);
    assert.equal(antwort.status, HTTP_INTERNAL_SERVER_ERROR);
    assert.deepEqual(antwort.koerper, {});
  },
);

test(
  "S11: scheitert der Slot-Vorschub, gilt der neu ausgestellte Code und der alte ist nicht bestätigt",
  OPTIONEN,
  async (t) => {
    const { erste, zweite } = await frischerMandant("mandant-s11");
    const inhalt = anfrageMit();
    const alterCode = await codeHolen(erste, inhalt);
    const aufheben = await fehlerBei(SLOT, SCHREIBEND)(t);
    const gescheitert = await einloesen(erste, inhalt, alterCode);
    await aufheben();
    pruefeNichtVerfuegbar(gescheitert);
    const neuerCode = await codeHolen(zweite, inhalt);
    assert.equal(await bestaetigt(zweite, inhalt, neuerCode), true);
    assert.equal(await bestaetigt(erste, inhalt, alterCode), false);
  },
);

test(
  "S12: jede Anweisung beim Ausstellen und Einlösen läuft mit der kurzen Frist, und die Summe bleibt unter dem MCP-Hop",
  OPTIONEN,
  async (t) => {
    const { erste } = await frischerMandant("mandant-s12-frist");
    const inhalt = anfrageMit();
    await umgebung.verwaltung.query(`TRUNCATE frist_protokoll`);
    for (const tabelle of REGISTERTABELLEN) {
      await ausloeser(t, { tabelle, ereignis: JEDE_AENDERUNG, funktion: "frist_merken" });
    }
    const code = await codeHolen(erste, inhalt);
    const abfragen = t.mock.method(pg.Client.prototype, "query");
    const eingeloest = await einloesen(erste, inhalt, code);
    const transaktion = transaktionAus(anweisungsTexte(abfragen));
    abfragen.mock.restore();
    const protokoll = await fristProtokoll();
    const fristen = [...new Set(protokoll.map(({ frist }) => frist))];
    assert.deepEqual(fristen, [FRIST_ALS_TEXT], ERWARTETER_FEHLER);
    assert.equal(eingeloest.koerper.confirmed, true);
    const tabellen = new Set(protokoll.map(({ tabelle }) => tabelle));
    assert.deepEqual([...tabellen].sort(), [...REGISTERTABELLEN].sort());
    assert.ok(
      schlimmsteDauerMs(transaktion) < umgebung.MCP_HOP_TIMEOUT_MS,
      `Fristen über ${transaktion.length} Nachrichten reichen über den MCP-Hop`,
    );
  },
);

test(
  "S12: reißt eine Anweisung die Frist, antwortet die Route 503 und der Code ist weder verbraucht noch gezählt",
  OPTIONEN,
  async (t) => {
    const { erste, zweite } = await frischerMandant("mandant-s12-abbruch");
    const inhalt = anfrageMit();
    const code = await codeHolen(erste, inhalt);
    const aufheben = [
      await ausloeser(t, { tabelle: VERBRAUCH, ereignis: "INSERT", funktion: "frist_verkuerzen" }),
      await ausloeser(t, { tabelle: SLOT, ereignis: SCHREIBEND, funktion: "dauert_laenger" }),
    ];
    const abgebrochen = await einloesen(erste, inhalt, code);
    await Promise.all(aufheben.map((entfernen) => entfernen()));
    pruefeNichtVerfuegbar(abgebrochen);
    assert.deepEqual(await registerZeilen(erste), LEERES_REGISTER);
    assert.equal(await bestaetigt(zweite, inhalt, code), true);
  },
);

test(
  "[NIE1] ein Datenbankfehler führt nie zu confirmed:true, nie zu 200 und nie zu einem Code",
  OPTIONEN,
  async (t) => {
    logMitschneiden(t);
    for (const fall of AUSFAELLE) {
      const { antwort } = await ausfallErleben(t, fall, `mandant-nie1-${fall.name}`);
      assert.notEqual(antwort.status, HTTP_OK, `${fall.name}: Fehler ergab 200`);
      assert.notEqual(antwort.koerper.confirmed, true, `${fall.name}: Fehler ergab confirmed:true`);
      assert.equal(
        antwort.koerper.confirmation,
        undefined,
        `${fall.name}: Fehler ergab einen Code`,
      );
    }
  },
);

test(
  "[NIE2] scheitert der Slot-Vorschub, bleibt weder Verbrauch noch Slot zurück",
  OPTIONEN,
  async (t) => {
    logMitschneiden(t);
    const { erste } = await frischerMandant("mandant-nie2");
    const inhalt = anfrageMit();
    const code = await codeHolen(erste, inhalt);
    const aufheben = await fehlerBei(SLOT, SCHREIBEND)(t);
    const antwort = await einloesen(erste, inhalt, code);
    await aufheben();
    assert.notEqual(antwort.koerper.confirmed, true, "gescheiterter Vorschub ergab confirmed:true");
    assert.deepEqual(await registerZeilen(erste), LEERES_REGISTER, "halbes Ergebnis im Register");
  },
);

test(
  "[NIE3] keine Logzeile eines Datenbankfehlers nennt Code, Secret oder abgeleiteten Schlüssel",
  OPTIONEN,
  async (t) => {
    const zeilen = logMitschneiden(t);
    for (const fall of AUSFAELLE) {
      const { code } = await ausfallErleben(t, fall, `mandant-nie3-${fall.name}`);
      pruefeLogOhneGeheimes(zeilen, code);
    }
  },
);

test(
  "[NIE4] S9: mit einer Uhr weit vor der Datenbankzeit bleibt ein verbrauchter Code verbraucht",
  OPTIONEN,
  async () => {
    const inhalt = anfrageMit();
    const { erste, zweite } = await frischerMandant(
      "mandant-nie4-frueh",
      FRUEHES_FENSTER * FENSTER_MS,
    );
    const code = await codeHolen(erste, inhalt);
    assert.equal(await bestaetigt(zweite, inhalt, code), true);
    assert.deepEqual(await ablehnung(erste, inhalt, code), VERBRAUCHT);
  },
);

test(
  "[NIE4] S9: mit einer Uhr weit nach der Datenbankzeit folgen Ablauf und Aufräumen der Uhr der Route",
  OPTIONEN,
  async () => {
    const inhalt = anfrageMit();
    const startMs = FERNES_FENSTER * FENSTER_MS;
    const { abgelaufen } = grenzenAb(startMs);
    const { erste, zweite } = await frischerMandant("mandant-nie4-fern", startMs);
    const code = await codeHolen(erste, inhalt);
    assert.equal(await bestaetigt(erste, inhalt, code), true);
    uhr.ms = abgelaufen - EINE_MS;
    assert.deepEqual(await ablehnung(zweite, inhalt, code), VERBRAUCHT);
    uhr.ms = abgelaufen;
    await codeHolen(zweite, inhalt);
    assert.deepEqual(await registerZeilen(erste), LEERES_REGISTER);
  },
);

test(
  "[NIE5] S9: unverbrauchter Code gilt im Folgefenster, zwei Fenster später nicht mehr, verbraucht bleibt verbraucht",
  OPTIONEN,
  async () => {
    const { imFolgefenster, abgelaufen } = grenzenAb(UHR_START_MS);
    const { erste, zweite } = await frischerMandant("mandant-nie5-ablauf");
    const inhalt = anfrageMit();
    const andererInhalt = anfrageMit("Tisch im Restaurant reservieren");
    const { code, expires_at: ablauf } = await ausstellen(erste, inhalt);
    const nieEingeloest = await codeHolen(erste, andererInhalt);
    assert.equal(ablauf, new Date(imFolgefenster).toISOString());

    uhr.ms = imFolgefenster;
    assert.equal(await bestaetigt(zweite, inhalt, code), true);
    uhr.ms = abgelaufen - EINE_MS;
    assert.deepEqual(await ablehnung(erste, inhalt, code), VERBRAUCHT);

    uhr.ms = abgelaufen;
    assert.deepEqual(await ablehnung(zweite, andererInhalt, nieEingeloest), ABGELEHNT);
  },
);

test(
  "[NIE5] S9: die Bremse sperrt nach zehn Fehlversuchen und beginnt im neuen Fenster bei null",
  OPTIONEN,
  async () => {
    const { imFolgefenster } = grenzenAb(UHR_START_MS);
    const { erste, zweite } = await frischerMandant("mandant-nie5-bremse");
    const inhalt = anfrageMit();
    const code = await codeHolen(erste, inhalt);
    for (let versuch = 0; versuch < BREMSE_GRENZE; versuch += 1) {
      await einloesen(versuch % 2 === 0 ? erste : zweite, inhalt, falscherCode(code));
    }
    assert.equal(await bestaetigt(erste, inhalt, code), false);

    uhr.ms = imFolgefenster;
    assert.equal(await bestaetigt(zweite, inhalt, code), true);
  },
);
