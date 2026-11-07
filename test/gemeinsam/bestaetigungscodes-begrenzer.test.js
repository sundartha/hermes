import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mcpPost, readToolResult, startServer, toolCall } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";

const ERWARTETER_FEHLER =
  "Mandant A wird nach 600 Anfragen in einem Fenster nicht mit 429 begrenzt, oder Mandant B wird wegen der Anfragen von A begrenzt, oder ein Aufruf von außen mit gefälschtem Mandantenkopf verbraucht das Budget des Mandanten, oder ein unbekanntes Ergebnis der Bestätigung wird still als abgelehnt (200, confirmed:false) statt als 503 beantwortet, oder ein 429 der Route erscheint am Werkzeug als „Eingabe prüfen“";
const GEHEIMNIS = "bestaetigungscodes-begrenzer-secret-mind-32-zeichen";
const ZIEL = "+4915112345678";
const OBJECTIVE = "Begrenzer je Mandant";
const ANFRAGE = Object.freeze({ to: ZIEL, objective: OBJECTIVE });
const GRENZE_JE_MANDANT = 600;
const GLEICHZEITIG = 50;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const BEREITS_VERBRAUCHT = "already_used";
const FREMDE_ADRESSE = "203.0.113.7";
const TEXT_EINGABE_PRUEFEN = "The request was rejected. Please check the input and try again.";
const TEXT_ZU_VIELE_ANFRAGEN = /too many/i;
const ZEITGRENZE_MS = 120_000;

let laufenderDienst;

function dienst() {
  laufenderDienst ??= startServer({ env: { CALL_CONFIRMATION_SECRET: GEHEIMNIS } });
  return laufenderDienst;
}

after(async () => {
  if (laufenderDienst) await (await laufenderDienst).stop();
});

async function bestaetigung(srv, inhalt, kopfzeilen) {
  const antwort = await abrufMitFrist(`${srv.localUrl}/api/call-confirmations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...kopfzeilen },
    body: JSON.stringify(inhalt),
  });
  return { status: antwort.status, inhalt: await antwort.json() };
}

function alsMandant(mandant) {
  return { "x-internal-tenant": mandant };
}

async function anfragenStellen(srv, kopfzeilen, anzahl) {
  const status = [];
  for (let gestellt = 0; gestellt < anzahl; gestellt += GLEICHZEITIG) {
    const runde = Math.min(GLEICHZEITIG, anzahl - gestellt);
    const antworten = await Promise.all(
      Array.from({ length: runde }, () => bestaetigung(srv, ANFRAGE, kopfzeilen)),
    );
    status.push(...antworten.map((antwort) => antwort.status));
  }
  return status;
}

function nurStatus(liste, erwartet) {
  return liste.filter((status) => status !== erwartet);
}

async function grenzeErreichen(srv, mandant) {
  const status = await anfragenStellen(srv, alsMandant(mandant), GRENZE_JE_MANDANT);
  assert.deepEqual(nurStatus(status, HTTP_OK), [], "die ersten 600 Anfragen gehen durch");
  return bestaetigung(srv, ANFRAGE, alsMandant(mandant));
}

function falscherCode(richtigerCode) {
  const [erstes, ...rest] = richtigerCode;
  return `${erstes === "0" ? "1" : "0"}${rest.join("")}`;
}

async function prepareCall(srv) {
  return readToolResult(
    await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("prepare_call", ANFRAGE)),
  );
}

function betreiberMandant(srv) {
  const [mandant] = srv.readStore().tenants.map((eintrag) => eintrag.id);
  return mandant;
}

test(
  "S13: falscher Code 200 confirmed:false ohne reason, richtiger Code 200 confirmed:true, derselbe Code erneut 200 already_used",
  { timeout: ZEITGRENZE_MS },
  async () => {
    const srv = await dienst();
    const mandant = alsMandant("mandant-begrenzer-antwort");
    const { inhalt: ausgestellt } = await bestaetigung(srv, ANFRAGE, mandant);
    const { code } = ausgestellt.confirmation;
    const einloesen = (versuch) =>
      bestaetigung(srv, { ...ANFRAGE, confirmation_code: versuch }, mandant);
    const vorschau = ausgestellt.preview;

    assert.deepEqual(
      await einloesen(falscherCode(code)),
      { status: HTTP_OK, inhalt: { preview: vorschau, confirmed: false } },
      ERWARTETER_FEHLER,
    );
    assert.deepEqual(
      await einloesen(code),
      { status: HTTP_OK, inhalt: { preview: vorschau, confirmed: true } },
      ERWARTETER_FEHLER,
    );
    assert.deepEqual(
      await einloesen(code),
      {
        status: HTTP_OK,
        inhalt: { preview: vorschau, confirmed: false, reason: BEREITS_VERBRAUCHT },
      },
      ERWARTETER_FEHLER,
    );
  },
);

test(
  "S14: nach 600 Anfragen eines Mandanten in einem Fenster antwortet die Route auf die weitere mit 429",
  { timeout: ZEITGRENZE_MS },
  async () => {
    const srv = await dienst();
    const weitere = await grenzeErreichen(srv, "mandant-begrenzer-grenze");
    assert.equal(weitere.status, HTTP_TOO_MANY_REQUESTS, ERWARTETER_FEHLER);
  },
);

test(
  "S15: hat Mandant A die Grenze erreicht, bekommt Mandant B im selben Fenster kein 429",
  { timeout: ZEITGRENZE_MS },
  async () => {
    const srv = await dienst();
    const anA = await grenzeErreichen(srv, "mandant-begrenzer-a");
    assert.equal(anA.status, HTTP_TOO_MANY_REQUESTS, ERWARTETER_FEHLER);
    const anB = await bestaetigung(srv, ANFRAGE, alsMandant("mandant-begrenzer-b"));
    assert.equal(anB.status, HTTP_OK, ERWARTETER_FEHLER);
  },
);

test(
  "S16: 600 Aufrufe von außen mit gefälschtem Mandantenkopf verbrauchen das Budget des Mandanten nicht",
  { timeout: ZEITGRENZE_MS },
  async () => {
    const srv = await dienst();
    const mandant = "mandant-begrenzer-gefaelscht";
    const vonAussen = { ...alsMandant(mandant), "x-forwarded-for": FREMDE_ADRESSE };
    const status = await anfragenStellen(srv, vonAussen, GRENZE_JE_MANDANT);
    assert.deepEqual(
      nurStatus(status, HTTP_FORBIDDEN),
      [],
      "internalOnly weist jeden Aufruf von außen ab",
    );
    const lokal = await bestaetigung(srv, ANFRAGE, alsMandant(mandant));
    assert.equal(lokal.status, HTTP_OK, ERWARTETER_FEHLER);
  },
);

test(
  "S16b: 600 Aufrufe von außen ohne Mandantenkopf verbrauchen den Zähler des lokalen Kanals ohne Kopfzeile nicht",
  { timeout: ZEITGRENZE_MS },
  async () => {
    const srv = await dienst();
    const andereAdresse = "198.51.100.23";
    const vonAussen = { "x-forwarded-for": andereAdresse };
    const status = await anfragenStellen(srv, vonAussen, GRENZE_JE_MANDANT);
    assert.deepEqual(
      nurStatus(status, HTTP_FORBIDDEN),
      [],
      "internalOnly weist jeden Aufruf von außen ab",
    );
    const lokal = await bestaetigung(srv, ANFRAGE, {});
    assert.equal(lokal.status, HTTP_OK, ERWARTETER_FEHLER);
  },
);

test(
  "S17: die 601. Anfrage eines Mandanten über das Werkzeug meldet zu viele Anfragen, nicht „Eingabe prüfen“",
  { timeout: ZEITGRENZE_MS },
  async () => {
    const srv = await dienst();
    const erste = await prepareCall(srv);
    assert.notEqual(erste.isError, true, "die erste Anfrage über das Werkzeug geht durch");
    const status = await anfragenStellen(
      srv,
      alsMandant(betreiberMandant(srv)),
      GRENZE_JE_MANDANT - 1,
    );
    assert.deepEqual(nurStatus(status, HTTP_OK), [], "die Anfragen 2 bis 600 gehen durch");

    const weitere = await prepareCall(srv);
    assert.equal(weitere.isError, true, ERWARTETER_FEHLER);
    const [{ text }] = weitere.content;
    assert.notEqual(text, TEXT_EINGABE_PRUEFEN, ERWARTETER_FEHLER);
    assert.match(text, TEXT_ZU_VIELE_ANFRAGEN, ERWARTETER_FEHLER);
  },
);
