import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes/eingabe-nur-mit-schema";
const DATEI = "src/probe-eingabe.js";

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

async function erwarteBefund(quelltext) {
  const gefunden = await befunde(DATEI, quelltext);
  assert.equal(gefunden.length, 1, "Eingaberegel: die Handprüfung wurde nicht gemeldet");
  assert.match(gefunden[0].message, /src\/utils\/eingabe-pruefen\.js/);
  assert.match(gefunden[0].message, /zod/);
  assert.match(gefunden[0].message, /src\/routes\/_validation\.js/);
}

async function erwarteKeinen(datei, quelltext) {
  const gefunden = await befunde(datei, quelltext);
  assert.deepEqual(gefunden, [], `Eingaberegel: ${datei} wurde gemeldet`);
}

const ALTE_ZEILE = 'export const a = (req) => (typeof req.query.token === "string" ? req.query.token : "");\n';
const KOERPER = 'export const a = (req) => typeof req.body.email === "string";\n';
const PFAD = 'export const a = (req) => typeof req.params.id === "string";\n';
const KOERPER_GANZ = 'export const a = (req) => typeof req.body === "object";\n';
const KETTE = 'export const a = (req) => typeof req.body?.email === "string";\n';
const ANFRAGE_ALS_REQUEST = 'export const a = (request) => typeof request.query.code === "string";\n';
const ZUGEWIESEN = 'export const a = (req) => {\n  const q = req.query;\n  return typeof q.after === "string";\n};\n';
const ZWEI_SCHRITTE =
  'export const a = (req) => {\n  const q = req.query;\n  const nach = q.after;\n  return typeof nach === "string";\n};\n';
const ZERLEGT = 'export const a = (req) => {\n  const { code } = req.query;\n  return typeof code === "string";\n};\n';
const KOERPER_ZERLEGT = 'export const a = (req) => {\n  const { body } = req;\n  return typeof body.x === "string";\n};\n';
const FREMDER_WERT = 'export const a = (antwort) => typeof antwort.body === "string";\n';
const EIGENER_WERT = 'export const a = (wert) => typeof wert === "string";\n';
const ANDERER_TEIL = 'export const a = (req) => typeof req.headers.host === "string";\n';
const LOKALER_WERT = 'export const a = (req) => {\n  const text = String(req.query.x);\n  return typeof text === "string";\n};\n';
const OHNE_TYPEOF = 'export const a = (req) => req.query.token ?? "";\n';

test("Eingaberegel: die alte Handprüfung typeof req.query.token ist ein Fehler, der auf Helfer, Schema-Ort und zod verweist", () =>
  erwarteBefund(ALTE_ZEILE));
test("Eingaberegel: typeof auf req.body.<feld> ist ein Fehler", () => erwarteBefund(KOERPER));
test("Eingaberegel: typeof auf req.params.<feld> ist ein Fehler", () => erwarteBefund(PFAD));
test("Eingaberegel: typeof auf den ganzen req.body ist ein Fehler", () => erwarteBefund(KOERPER_GANZ));
test("Eingaberegel: typeof auf req.body?.<feld> ist ein Fehler", () => erwarteBefund(KETTE));
test("Eingaberegel: der Name request gilt wie req", () => erwarteBefund(ANFRAGE_ALS_REQUEST));
test("Eingaberegel: typeof auf eine Variable aus req.query ist ein Fehler", () => erwarteBefund(ZUGEWIESEN));
test("Eingaberegel: typeof auf einen Wert aus einer Variable aus req.query in zwei Schritten ist ein Fehler", () =>
  erwarteBefund(ZWEI_SCHRITTE));
test("Eingaberegel: typeof auf einen zerlegten Wert aus req.query ist ein Fehler", () => erwarteBefund(ZERLEGT));
test("Eingaberegel: typeof auf einen aus req zerlegten Körper ist ein Fehler", () => erwarteBefund(KOERPER_ZERLEGT));

test("Eingaberegel: typeof auf einen fremden body bleibt erlaubt", () => erwarteKeinen(DATEI, FREMDER_WERT));
test("Eingaberegel: typeof auf einen Parameter bleibt erlaubt", () => erwarteKeinen(DATEI, EIGENER_WERT));
test("Eingaberegel: typeof auf req.headers bleibt erlaubt", () => erwarteKeinen(DATEI, ANDERER_TEIL));
test("Eingaberegel: typeof auf einen lokal gebildeten Text bleibt erlaubt", () => erwarteKeinen(DATEI, LOKALER_WERT));
test("Eingaberegel: ein Lesezugriff ohne typeof bleibt erlaubt", () => erwarteKeinen(DATEI, OHNE_TYPEOF));
test("Eingaberegel: test/ ist nicht Teil der Regel", () => erwarteKeinen("test/probe-eingabe.js", ALTE_ZEILE));
test("Eingaberegel: der Helfer-Ordner src/utils ist Teil der Regel", async () => {
  const gefunden = await befunde("src/utils/probe-eingabe.js", ALTE_ZEILE);
  assert.equal(gefunden.length, 1);
});

const MIT_RUECKFALL_ODER =
  'export const a = (req) => {\n  const body = req.body || {};\n  return typeof body.sub === "string";\n};\n';
const MIT_RUECKFALL_NULLISH =
  'export const a = (req) => {\n  const { code } = req.query ?? {};\n  return typeof code === "string";\n};\n';
const MIT_BEDINGUNG =
  'export const a = (req, roh) => {\n  const q = roh ? req.query : {};\n  return typeof q.x === "string";\n};\n';
const PARAMETER_MIT_EINGABE =
  'const lies = (nutzlast) => typeof nutzlast.id === "string";\nexport const a = (req) => lies(req.body);\n';
const PARAMETER_UEBER_VARIABLE =
  'function lies(nutzlast) {\n  return typeof nutzlast === "object";\n}\nexport const a = (req) => {\n  const roh = req.body;\n  return lies(roh);\n};\n';
const PARAMETER_OHNE_EINGABE =
  'const lies = (wert) => typeof wert.id === "string";\nexport const a = () => lies({ id: "x" });\n';
const RUECKFALL_OHNE_EINGABE =
  'export const a = (req) => {\n  const kopf = req.headers || {};\n  return typeof kopf.host === "string";\n};\n';
const NUTZLAST_PARAMETER = 'export const a = (body) => typeof body.data === "object";\n';
const NUTZLAST_ABGELEITET =
  'export const a = (body) => {\n  const ev = body.data;\n  return typeof ev.payload === "object";\n};\n';

test("Eingaberegel: req.body || {} verbirgt die Eingabe nicht", () =>
  erwarteBefund(MIT_RUECKFALL_ODER));
test("Eingaberegel: req.query ?? {} verbirgt die zerlegte Eingabe nicht", () =>
  erwarteBefund(MIT_RUECKFALL_NULLISH));
test("Eingaberegel: eine Bedingung mit req.query auf einer Seite verbirgt die Eingabe nicht", () =>
  erwarteBefund(MIT_BEDINGUNG));
test("Eingaberegel: der Parameter einer Funktion, der im selben Modul req.body bekommt, ist Eingabe", () =>
  erwarteBefund(PARAMETER_MIT_EINGABE));
test("Eingaberegel: der Parameter, der über eine Variable aus req.body bedient wird, ist Eingabe", () =>
  erwarteBefund(PARAMETER_UEBER_VARIABLE));
test("Eingaberegel: ein Parameter, der nie Eingabe bekommt, bleibt erlaubt", () =>
  erwarteKeinen(DATEI, PARAMETER_OHNE_EINGABE));
test("Eingaberegel: ein Rückfallwert auf req.headers bleibt erlaubt", () =>
  erwarteKeinen(DATEI, RUECKFALL_OHNE_EINGABE));
test("Eingaberegel: in den Webhook-Parsern ist jeder Parameter die Nutzlast", async () => {
  const datei = "src/telephony/adapters/telnyx/speak-events.js";
  assert.equal((await befunde(datei, NUTZLAST_PARAMETER)).length, 1);
  assert.equal((await befunde(datei, NUTZLAST_ABGELEITET)).length, 1);
});
test("Eingaberegel: außerhalb der Webhook-Parser bleibt typeof auf einen Parameter erlaubt", () =>
  erwarteKeinen(DATEI, NUTZLAST_PARAMETER));
