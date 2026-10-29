import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { vergleicheVorbereitung } from "../../tools/vorbereitung-pruefen.mjs";
import { nachCommitAufrufen, repoMitBasis } from "./pr-probe.js";
import { REPO_ROOT } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/vorbereitung-pruefen.mjs");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const PFAD = "src/routes/probe.js";
const HTTP_PFAD = "src/utils/http.js";
const KATALOG_BEFUND = /^src\/routes\/probe\.js:\d+: Änderung, die keine Umformung aus tools\/vorbereitung\/katalog\.json ist$/;
const IMPORT_NOT_FOUND = 'import { HTTP_NOT_FOUND } from "../utils/http.js";';
const IMPORT_HELFER = 'import { antworteFehler } from "../utils/http.js";';

function quelle(...zeilen) {
  return `${zeilen.join("\n")}\n`;
}

const HELFER = ["export function antworteFehler(res, status, code) {", "  return res.status(status).json({ error: code });", "}"];
const HTTP = quelle("export const HTTP_BAD_REQUEST = 400;", "export const HTTP_NOT_FOUND = 404;", "export const HTTP_OK = 200;", ...HELFER);

async function vergleich(vorher, nachher, { kreisfrei = false, http = HTTP, httpVorher = http, pfad = PFAD } = {}) {
  const text = (wert) => wert ?? undefined;
  return vergleicheVorbereitung({ pfad, vorher, nachher, kreisfrei: async () => kreisfrei, http: { vorher: text(httpVorher), nachher: text(http) } });
}

async function gruen(vorher, nachher, { genutzt, fall = genutzt.join(" "), ...optionen }) {
  assert.deepEqual(await vergleich(vorher, nachher, optionen), { gleich: true, genutzt }, fall);
}

async function rot(vorher, nachher, { fall = "", ...optionen } = {}) {
  const ergebnis = await vergleich(vorher, nachher, optionen);
  assert.equal(ergebnis.gleich, false, fall);
  assert.match(ergebnis.befund, KATALOG_BEFUND, fall);
}

async function rotJeFall(faelle, optionen = {}) {
  for (const [fall, vorher, nachher] of faelle) await rot(quelle(...vorher), quelle(IMPORT_HELFER, ...nachher), { ...optionen, fall });
}

const STATUS_VORHER = (n) => quelle("export const f = (res) => {", `  return res.sendStatus(${n});`, "};");
const STATUS_NACHHER = (name, kopf = IMPORT_NOT_FOUND) => quelle(kopf, "export const f = (res) => {", `  return res.sendStatus(${name});`, "};");

test("vorbereitung-pruefen: status-konstante: eine importierte Konstante aus src/utils/http.js mit dem Wert des ersetzten Literals ist gleichwertig", async () => {
  await gruen(STATUS_VORHER("404"), STATUS_NACHHER("HTTP_NOT_FOUND"), { genutzt: ["status-konstante"] });
});

test("vorbereitung-pruefen: status-konstante: eine lokale const durch den Import gleichen Werts ersetzt ist gleichwertig", async () => {
  const vorher = quelle("const HTTP_NOT_FOUND = 404;", "export const f = (res) => {", "  return res.sendStatus(HTTP_NOT_FOUND);", "};");
  await gruen(vorher, STATUS_NACHHER("HTTP_NOT_FOUND"), { genutzt: ["status-konstante", "zahl-konstante"], kreisfrei: true });
});

test("vorbereitung-pruefen: status-konstante gilt auch als Wert einer Objekteigenschaft und in Bedingung und return", async () => {
  const rumpf = (n) => ["export function f(x) {", `  if (x === ${n}) return { status: ${n}, body: null };`, `  return x ? ${n} : x;`, "}"];
  await gruen(quelle(...rumpf("404")), quelle(IMPORT_NOT_FOUND, ...rumpf("HTTP_NOT_FOUND")), { genutzt: ["status-konstante"] });
});

test("vorbereitung-pruefen: status-konstante: andere Importnamen aus demselben Modul bleiben stehen und müssen auf beiden Seiten gleich sein", async () => {
  const kopf = 'import { HTTP_NOT_FOUND, lehneEingabeAb } from "../utils/http.js";';
  const http = quelle(HTTP, "export function lehneEingabeAb(res, ungueltig) {", "  return ungueltig;", "}");
  const vorher = quelle('import { lehneEingabeAb } from "../utils/http.js";', "export const f = (res) => lehneEingabeAb(res, 404);");
  const nachher = quelle(kopf, "export const f = (res) => lehneEingabeAb(res, HTTP_NOT_FOUND);");
  await gruen(vorher, nachher, { genutzt: ["status-konstante"], http });
  await rot(quelle("export const f = (res) => lehneEingabeAb(res, 404);"), nachher, { http, fall: "Import hinzugekommen" });
});

test("vorbereitung-pruefen: status-konstante mit anderem Wert in src/utils/http.js ist nicht gleichwertig", async () => {
  await rot(STATUS_VORHER("400"), STATUS_NACHHER("HTTP_NOT_FOUND"), { fall: "Literal 400, Konstante 404" });
  const geaendert = HTTP.replace("HTTP_NOT_FOUND = 404", "HTTP_NOT_FOUND = 405");
  await rot(STATUS_VORHER("404"), STATUS_NACHHER("HTTP_NOT_FOUND"), { http: geaendert, fall: "Konstante am Ziel 405" });
  await rot(STATUS_NACHHER("HTTP_NOT_FOUND"), STATUS_VORHER("404"), { httpVorher: geaendert, fall: "Konstante an der Basis 405, Literal am Ziel" });
});

test("vorbereitung-pruefen: status-konstante nur aus src/utils/http.js, ohne Alias und nur aus einem benannten Import", async () => {
  const faelle = [
    ["Import aus anderem Modul", STATUS_NACHHER("HTTP_NOT_FOUND", 'import { HTTP_NOT_FOUND } from "../utils/anders.js";')],
    ["Import aus einem Paket", STATUS_NACHHER("HTTP_NOT_FOUND", 'import { HTTP_NOT_FOUND } from "http-konstanten";')],
    ["Alias", STATUS_NACHHER("NF", 'import { HTTP_NOT_FOUND as NF } from "../utils/http.js";')],
    ["Namensraum", quelle('import * as h from "../utils/http.js";', "export const f = (res) => res.sendStatus(h.HTTP_NOT_FOUND);")],
    ["Standardimport", STATUS_NACHHER("HTTP_NOT_FOUND", 'import HTTP_NOT_FOUND from "../utils/http.js";')],
    ["Name nicht in http.js", STATUS_NACHHER("HTTP_TEAPOT", 'import { HTTP_TEAPOT } from "../utils/http.js";')],
    ["Pfad endet auf http.js, ist aber ein anderes Modul", STATUS_NACHHER("HTTP_NOT_FOUND", 'import { HTTP_NOT_FOUND } from "./utils/http.js";')],
  ];
  for (const [fall, nachher] of faelle) await rot(STATUS_VORHER("404"), nachher, { fall });
});

test("vorbereitung-pruefen: status-konstante, deren Name in der Datei noch einmal gebunden ist, ist nicht gleichwertig", async () => {
  const parameter = "export const g = (HTTP_NOT_FOUND) => HTTP_NOT_FOUND;";
  const lokal = ["export function h() {", "  const HTTP_NOT_FOUND = 1;", "  return HTTP_NOT_FOUND;", "}"];
  const mit = (text, ...zeilen) => quelle(text.trimEnd(), ...zeilen);
  await rot(mit(STATUS_VORHER("404"), parameter), mit(STATUS_NACHHER("HTTP_NOT_FOUND"), parameter), { fall: "Parameter" });
  await rot(mit(STATUS_VORHER("404"), ...lokal), mit(STATUS_NACHHER("HTTP_NOT_FOUND"), ...lokal), { fall: "lokale Variable" });
});

test("vorbereitung-pruefen: status-konstante als Aufgerufene, Schlüssel, Spread oder ohne Lesestelle ist nicht gleichwertig", async () => {
  const faelle = [
    ["Aufgerufene", quelle("export const f = () => (404)();"), quelle(IMPORT_NOT_FOUND, "export const f = () => HTTP_NOT_FOUND();")],
    ["Schlüssel", quelle("export const o = { 404: 1 };"), quelle(IMPORT_NOT_FOUND, "export const o = { HTTP_NOT_FOUND: 1 };")],
    ["Kurzschreibweise", quelle("export const o = { HTTP_NOT_FOUND: 404 };"), quelle(IMPORT_NOT_FOUND, "export const o = { HTTP_NOT_FOUND };")],
    ["Spread", quelle("export const f = () => [...(404)];"), quelle(IMPORT_NOT_FOUND, "export const f = () => [...HTTP_NOT_FOUND];")],
    ["Zuweisung", quelle("export const f = () => 404;"), quelle(IMPORT_NOT_FOUND, "export const f = () => HTTP_NOT_FOUND;", "export const g = () => { HTTP_NOT_FOUND = 1; };")],
    ["Muster", quelle("export const f = () => 404;"), quelle(IMPORT_NOT_FOUND, "export const f = () => HTTP_NOT_FOUND;", "export const g = (o) => ({ x: HTTP_NOT_FOUND } = o);")],
    ["unbenutzter Import", quelle("export const f = () => 404;"), quelle(IMPORT_NOT_FOUND, "export const f = () => 404;")],
    ["eval in der Datei", quelle(STATUS_VORHER("404").trimEnd(), "export const e = (s) => eval(s);"), quelle(STATUS_NACHHER("HTTP_NOT_FOUND").trimEnd(), "export const e = (s) => eval(s);")],
  ];
  for (const [fall, vorher, nachher] of faelle) await rot(vorher, nachher, { fall });
});

test("vorbereitung-pruefen: status-konstante nur, wenn src/utils/http.js nur Statuskonstanten und Funktionsdeklarationen enthält und nichts zuweist", async () => {
  const kopf = ["export const HTTP_NOT_FOUND = 404;"];
  const faelle = [
    ["fehlt", null, "404", "HTTP_NOT_FOUND"],
    ["nicht lesbar", "export const HTTP_NOT_FOUND = ;", "404", "HTTP_NOT_FOUND"],
    ["Import", quelle('import "node:fs";', ...kopf), "404", "HTTP_NOT_FOUND"],
    ["Anweisung mit Wirkung", quelle(...kopf, 'console.log("geladen");'), "404", "HTTP_NOT_FOUND"],
    ["let statt const", quelle("export let HTTP_NOT_FOUND = 404;"), "404", "HTTP_NOT_FOUND"],
    ["Ausdruck statt Literal", quelle("export const HTTP_NOT_FOUND = 400 + 4;"), "404", "HTTP_NOT_FOUND"],
    ["Wert unter 100", quelle("export const HTTP_NOT_FOUND = 99;"), "99", "HTTP_NOT_FOUND"],
    ["Wert über 599", quelle("export const HTTP_NOT_FOUND = 600;"), "600", "HTTP_NOT_FOUND"],
    ["Bruch", quelle("export const HTTP_NOT_FOUND = 404.5;"), "404.5", "HTTP_NOT_FOUND"],
    ["Text statt Zahl", quelle('export const HTTP_NOT_FOUND = "404";'), '"404"', "HTTP_NOT_FOUND"],
    ["zwei Bindungen in einer Anweisung", quelle("export const HTTP_NOT_FOUND = 404, HTTP_OTHER = 400;"), "404", "HTTP_NOT_FOUND"],
    ["Name ohne HTTP_", quelle("export const NOT_FOUND = 404;"), "404", "NOT_FOUND"],
    ["Standard-Export", quelle(...kopf, "export default 1;"), "404", "HTTP_NOT_FOUND"],
    ["Weiterreichung", quelle(...kopf, 'export { x } from "./x.js";'), "404", "HTTP_NOT_FOUND"],
    ["Zuweisung in einer Funktion", quelle(...kopf, "export function f() {", "  f = null;", "}"), "404", "HTTP_NOT_FOUND"],
    ["eval in einer Funktion", quelle(...kopf, "export function f(s) {", "  return eval(s);", "}"), "404", "HTTP_NOT_FOUND"],
  ];
  for (const [fall, http, literal, name] of faelle) {
    await rot(STATUS_VORHER(literal), STATUS_NACHHER(name, `import { ${name} } from "../utils/http.js";`), { http, httpVorher: http, fall });
  }
  await gruen(STATUS_VORHER("404"), STATUS_NACHHER("HTTP_NOT_FOUND"), { genutzt: ["status-konstante"], http: quelle(...kopf, "export function f() {", "  return 1;", "}") });
});

test("vorbereitung-pruefen: status-konstante nimmt nur Namen, die src/utils/http.js nennt, und nur ohne Alias", async () => {
  const unbekannt = quelle('import { HTTP_TEAPOT } from "../utils/http.js";', "export const f = (res) => res.sendStatus(HTTP_TEAPOT);");
  const ohneImport = quelle("export const f = (res) => res.sendStatus(HTTP_TEAPOT);");
  await rot(unbekannt, ohneImport, { fall: "Name nicht in http.js, Import gestrichen" });
  const alias = STATUS_NACHHER("HTTP_BAD_REQUEST", 'import { HTTP_NOT_FOUND as HTTP_BAD_REQUEST } from "../utils/http.js";');
  await rot(STATUS_VORHER("400"), alias, { fall: "Alias mit dem Namen einer anderen Konstante" });
});

test("vorbereitung-pruefen: status-konstante nur für einen Namen, der in der Datei einmal gebunden ist", async () => {
  const parameter = (kopf, wert) => quelle(...kopf, `export const g = (HTTP_NOT_FOUND) => ${wert};`);
  await rot(parameter([], "404"), parameter([IMPORT_NOT_FOUND], "HTTP_NOT_FOUND"), { fall: "Parameter liest den Namen" });
  const lokal = (kopf, wert) => quelle(...kopf, "export function h() {", "  const HTTP_NOT_FOUND = 1;", `  return ${wert};`, "}");
  await rot(lokal([], "404"), lokal([IMPORT_NOT_FOUND], "HTTP_NOT_FOUND"), { fall: "lokale const liest den Namen" });
});

test("vorbereitung-pruefen: status-konstante nicht in der Kurzschreibweise, nicht als Schlüssel und nicht in einem Muster, auch wenn beide Seiten gleich sind", async () => {
  const kurz = (kopf) => quelle(...kopf, "export const o = () => ({ HTTP_NOT_FOUND });");
  await rot(kurz(["const HTTP_NOT_FOUND = 404;"]), kurz([IMPORT_NOT_FOUND]), { kreisfrei: true, fall: "Kurzschreibweise" });
  const muster = (kopf) => quelle(...kopf, "export const o = (q) => ({ x: HTTP_NOT_FOUND } = q);");
  await rot(muster(["const HTTP_NOT_FOUND = 404;"]), muster([IMPORT_NOT_FOUND]), { kreisfrei: true, fall: "Muster" });
});

const LOKAL_VORHER = (davor = []) => quelle(...davor, "const HTTP_NOT_FOUND = 404;", "export function f() {", "  return { status: HTTP_NOT_FOUND };", "}");
const LOKAL_NACHHER = (davor = []) => quelle(...davor, IMPORT_NOT_FOUND, "export function f() {", "  return { status: HTTP_NOT_FOUND };", "}");

test("vorbereitung-pruefen: status-konstante löst eine lokale Konstante auch hinter Exporten, Funktionen und Object.freeze auf", async () => {
  const davor = [
    "export const GRENZE = 10;",
    'export const ANTWORT = Object.freeze({ A: Object.freeze({ error: "x" }), L: Object.freeze([undefined, null, ""]) });',
    "function hilfe(x) {",
    "  return x;",
    "}",
    "export function andere(y) {",
    "  return hilfe(y);",
    "}",
    "const MUSTER = /[^a-z]/g;",
    "const NACHRICHT = `fest`;",
    "const SPAETER = () => hilfe(1);",
    "const LUECKE = [1, , 2];",
  ];
  await gruen(LOKAL_VORHER(davor), LOKAL_NACHHER(davor), { genutzt: [], kreisfrei: true });
});

test("vorbereitung-pruefen: status-konstante löst eine lokale Konstante nicht auf, wenn davor Code der Datei laufen kann", async () => {
  const faelle = [
    ["Aufruf", "start();"],
    ["const mit Aufruf", "const ERGEBNIS = start();"],
    ["Aufruf in Object.freeze", "const ERGEBNIS = Object.freeze(start());"],
    ["Aufruf im Objekt", "const ERGEBNIS = Object.freeze({ a: start() });"],
    ["Aufruf im Array", "const ERGEBNIS = [start()];"],
    ["berechneter Schlüssel", "const ERGEBNIS = { [start]: 1 };"],
    ["Spread im Objekt", "const ERGEBNIS = { ...start };"],
    ["Spread im Array", "const ERGEBNIS = [...start];"],
    ["Getter", "const ERGEBNIS = { get a() { return 1; } };"],
    ["Template mit Ausdruck", "const ERGEBNIS = `${start}`;"],
    ["Klasse", "class K {}"],
    ["let", "let ERGEBNIS = 1;"],
    ["Lesen der Konstante davor", "const ERGEBNIS = HTTP_NOT_FOUND;"],
    ["Object.freeze mit zwei Argumenten", "const ERGEBNIS = Object.freeze({}, 1);"],
    ["Object.freeze optional", "const ERGEBNIS = Object?.freeze({});"],
    ["Object.freeze als Index", 'const ERGEBNIS = Object["freeze"]({});'],
    ["andere Methode von Object", "const ERGEBNIS = Object.assign({});"],
    ["Object ist in der Datei gebunden", "const Object = { freeze: start };\nconst ERGEBNIS = Object.freeze({});"],
    ["Standardexport", "export default start();"],
    ["Zuweisung", "start = null;"],
    ["Name gelesen", "const ERGEBNIS = [start];"],
    ["export const mit Aufruf", "export const ERGEBNIS = start();"],
    ["Methode eines anderen Objekts", "const FREEZE = { freeze: () => 1 };\nconst ERGEBNIS = FREEZE.freeze({});"],
    ["Object als Index", "const ERGEBNIS = Object[freeze]({});"],
    ["Object ersetzt", "const Object = { freeze: (wert) => wert };\nconst ERGEBNIS = Object.freeze({});"],
    ["Methode im Objekt", "const ERGEBNIS = { start() {} };"],
  ];
  for (const [fall, davor] of faelle) await rot(LOKAL_VORHER([davor]), LOKAL_NACHHER([davor]), { kreisfrei: true, fall });
});

test("vorbereitung-pruefen: status-konstante löst eine lokale Konstante nur mit Nachweis gegen Import-Kreise auf", async () => {
  await rot(LOKAL_VORHER(), LOKAL_NACHHER(), { kreisfrei: false });
  await gruen(LOKAL_VORHER(), LOKAL_NACHHER(), { genutzt: [], kreisfrei: true });
});

test("vorbereitung-pruefen: status-konstante löst eine lokale Konstante nicht auf, wenn sie kein Status gleichen Namens im Format der Hilfe ist", async () => {
  const faelle = [
    ["exportiert", quelle("export const HTTP_NOT_FOUND = 404;", "export const f = () => ({ status: HTTP_NOT_FOUND });"), LOKAL_NACHHER()],
    ["anderer Name", quelle("const NOT_FOUND = 404;", "export const f = () => ({ status: NOT_FOUND });"), LOKAL_NACHHER()],
    ["Wert unter 100", quelle("const HTTP_NOT_FOUND = 99;", "export const f = () => ({ status: HTTP_NOT_FOUND });"), LOKAL_NACHHER()],
    ["Wert über 599", quelle("const HTTP_NOT_FOUND = 600;", "export const f = () => ({ status: HTTP_NOT_FOUND });"), LOKAL_NACHHER()],
    ["Bruch", quelle("const HTTP_NOT_FOUND = 404.5;", "export const f = () => ({ status: HTTP_NOT_FOUND });"), LOKAL_NACHHER()],
    ["Text", quelle('const HTTP_NOT_FOUND = "404";', "export const f = () => ({ status: HTTP_NOT_FOUND });"), LOKAL_NACHHER()],
    ["zwei Bindungen", quelle("const HTTP_NOT_FOUND = 404, EXTRA = 1;", "export const f = () => ({ status: HTTP_NOT_FOUND });"), LOKAL_NACHHER()],
    ["let", quelle("let HTTP_NOT_FOUND = 404;", "export const f = () => ({ status: HTTP_NOT_FOUND });"), LOKAL_NACHHER()],
    ["Schlüssel", quelle("const HTTP_NOT_FOUND = 404;", "export const f = () => ({ HTTP_NOT_FOUND: 1 });"), quelle(IMPORT_NOT_FOUND, "export const f = () => ({ HTTP_NOT_FOUND: 1 });")],
    ["Kurzschreibweise", quelle("const HTTP_NOT_FOUND = 404;", "export const f = () => ({ HTTP_NOT_FOUND });"), quelle(IMPORT_NOT_FOUND, "export const f = () => ({ HTTP_NOT_FOUND });")],
    ["Zuweisung", quelle("const HTTP_NOT_FOUND = 404;", "export const f = () => ({ status: HTTP_NOT_FOUND });", "export const g = () => { HTTP_NOT_FOUND = 1; };"), quelle(IMPORT_NOT_FOUND, "export const f = () => ({ status: HTTP_NOT_FOUND });", "export const g = () => { HTTP_NOT_FOUND = 1; };")],
    ["Aufgerufene", quelle("const HTTP_NOT_FOUND = 404;", "export const f = () => HTTP_NOT_FOUND();"), quelle(IMPORT_NOT_FOUND, "export const f = () => HTTP_NOT_FOUND();")],
    ["unbenutzt", quelle("const HTTP_NOT_FOUND = 404;", "export const f = () => 1;"), quelle(IMPORT_NOT_FOUND, "export const f = () => 1;")],
    ["Parameter gleichen Namens", quelle("const HTTP_NOT_FOUND = 404;", "export const f = (HTTP_NOT_FOUND) => ({ status: HTTP_NOT_FOUND });"), quelle(IMPORT_NOT_FOUND, "export const f = (HTTP_NOT_FOUND) => ({ status: HTTP_NOT_FOUND });")],
  ];
  for (const [fall, vorher, nachher] of faelle) await rot(vorher, nachher, { kreisfrei: true, fall });
});

test("vorbereitung-pruefen: status-konstante löst eine lokale Konstante nicht gegen ein Literal oder eine andere lokale Konstante auf", async () => {
  const davor = ["export function andere(y) {", "  return y;", "}"];
  const mitConst = (name) => quelle(...davor, `const ${name} = 404;`, "export function f(res) {", `  return res.sendStatus(${name});`, "}");
  const mitLiteral = quelle(...davor, "export function f(res) {", "  return res.sendStatus(404);", "}");
  await rot(mitConst("HTTP_NOT_FOUND"), mitLiteral, { kreisfrei: true, fall: "lokale const gegen Literal" });
  await rot(mitLiteral, mitConst("HTTP_NOT_FOUND"), { kreisfrei: true, fall: "Literal gegen lokale const" });
  await rot(mitConst("HTTP_NOT_FOUND"), mitConst("HTTP_MISSING"), { kreisfrei: true, fall: "lokale const gegen andere lokale const" });
});

test("vorbereitung-pruefen: status-konstante verlangt für die lokale Konstante denselben Wert wie die importierte", async () => {
  const andererWert = quelle("const HTTP_NOT_FOUND = 405;", "export function f() {", "  return { status: HTTP_NOT_FOUND };", "}");
  await rot(andererWert, LOKAL_NACHHER(), { kreisfrei: true });
});

const FEHLER_VORHER = (status, wert, kopf = []) => quelle(...kopf, "export const f = (res) => {", `  return res.status(${status}).json({ error: ${wert} });`, "};");
const FEHLER_NACHHER = (status, wert, kopf = []) => quelle(IMPORT_HELFER, ...kopf, "export const f = (res) => {", `  return antworteFehler(res, ${status}, ${wert});`, "};");

test("vorbereitung-pruefen: fehlerantwort: antworteFehler aus src/utils/http.js statt res.status(S).json({ error: X }) mit Literalen ist gleichwertig", async () => {
  await gruen(FEHLER_VORHER("404", '"not found"'), FEHLER_NACHHER("404", '"not found"'), { genutzt: ["fehlerantwort"] });
});

test("vorbereitung-pruefen: fehlerantwort gilt auch ohne return und mit Statuskonstante", async () => {
  const vorher = quelle("export const f = (res) => {", '  res.status(404).json({ error: "x" });', '  res.status(400).json({ error: "y" });', "};");
  const nachher = quelle(
    'import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND, antworteFehler } from "../utils/http.js";',
    "export const f = (res) => {",
    '  antworteFehler(res, HTTP_NOT_FOUND, "x");',
    '  antworteFehler(res, HTTP_BAD_REQUEST, "y");',
    "};",
  );
  await gruen(vorher, nachher, { genutzt: ["fehlerantwort", "status-konstante"] });
});

const KENNT_NAME = (wert, vorbau = []) => ({
  vorher: quelle(...vorbau, "export function f(res, antwort, status) {", `  return res.status(status).json({ error: ${wert} });`, "}"),
  nachher: quelle(IMPORT_HELFER, ...vorbau, "export function f(res, antwort, status) {", `  return antworteFehler(res, status, ${wert});`, "}"),
});

test("vorbereitung-pruefen: fehlerantwort in einem switch-Zweig ist gleichwertig, wenn kein Zweig den Fehlertext bindet", async () => {
  const rumpf = (aufruf) => quelle("export function f(res, text, x) {", "  switch (x) {", "    case 1:", '      const anderer = "a";', "      break;", "    case 2:", `      return ${aufruf};`, "  }", "}");
  const vorher = rumpf("res.status(400).json({ error: text })");
  const nachher = quelle(IMPORT_HELFER, rumpf("antworteFehler(res, 400, text)"));
  await gruen(vorher, nachher, { genutzt: ["fehlerantwort"] });
});

test("vorbereitung-pruefen: fehlerantwort mit Parametern der umgebenden Funktion als Status und Fehlertext ist gleichwertig", async () => {
  const { vorher, nachher } = KENNT_NAME("antwort");
  await gruen(vorher, nachher, { genutzt: ["fehlerantwort"] });
});

test("vorbereitung-pruefen: fehlerantwort mit einer vorher in demselben Block deklarierten const ist gleichwertig", async () => {
  const rumpf = (aufruf) => ["export function f(res, store) {", "  const { ergebnis } = store.hole();", "  const text = ergebnis;", `  if (ergebnis !== 1) return ${aufruf("ergebnis")};`, `  return ${aufruf("text")};`, "}"];
  const vorher = quelle(...rumpf((x) => `res.status(409).json({ error: ${x} })`));
  const nachher = quelle(IMPORT_HELFER, ...rumpf((x) => `antworteFehler(res, 409, ${x})`));
  await gruen(vorher, nachher, { genutzt: ["fehlerantwort"] });
});

test("vorbereitung-pruefen: fehlerantwort mit einer const der Datei ist gleichwertig, wenn die Datei in keinem Import-Kreis liegt", async () => {
  const kopf = ["const FEHLER = \"Anruf konnte nicht angelegt werden.\";", "export function g() {", "  return 1;", "}"];
  const vorher = quelle(...kopf, "export const f = (res) => {", "  return res.status(503).json({ error: FEHLER });", "};");
  const nachher = quelle(IMPORT_HELFER, ...kopf, "export const f = (res) => {", "  return antworteFehler(res, 503, FEHLER);", "};");
  await gruen(vorher, nachher, { genutzt: ["fehlerantwort"], kreisfrei: true });
  await rot(vorher, nachher, { kreisfrei: false, fall: "ohne Nachweis gegen Import-Kreise" });
});

test("vorbereitung-pruefen: fehlerantwort mit einem importierten Namen als Status oder Fehlertext ist nicht gleichwertig, denn eine fremde Live-Bindung kann sich ändern", async () => {
  const rumpf = (aufruf) => ['import { MELDUNG, STATUS } from "./meldung.js";', "export const f = (res) => {", `  return ${aufruf};`, "};"];
  const faelle = [
    ["Fehlertext", rumpf("res.status(400).json({ error: MELDUNG })"), rumpf("antworteFehler(res, 400, MELDUNG)")],
    ["Status", rumpf('res.status(STATUS).json({ error: "x" })'), rumpf('antworteFehler(res, STATUS, "x")')],
  ];
  await rotJeFall(faelle, { kreisfrei: true });
});

test("vorbereitung-pruefen: fehlerantwort mit einem Namen, der in der Datei irgendwo zugewiesen wird, ist nicht gleichwertig, auch wenn status() ihn über eine Closure ändert", async () => {
  const aendert = "  res.status = () => {\n    text = \"geaendert\";\n    return res;\n  };";
  const faelle = [
    ["Parameter, den status() ändert", ["export function f(res, text) {", aendert, "  return res.status(400).json({ error: text });", "}"], ["export function f(res, text) {", aendert, "  return antworteFehler(res, 400, text);", "}"]],
    ["Parameter als Status, den status() ändert", ["export function f(res, code) {", "  res.status = () => {\n    code = 500;\n    return res;\n  };", "  return res.status(code).json({ error: code });", "}"], ["export function f(res, code) {", "  res.status = () => {\n    code = 500;\n    return res;\n  };", "  return antworteFehler(res, code, code);", "}"]],
    ["const im Block, ein anderer Name gleicher Schreibweise wird zugewiesen", ["export function f(res) {", '  const text = "x";', "  return res.status(400).json({ error: text });", "}", "export function g() {", "  let text = 1;", "  text = 2;", "  return text;", "}"], ["export function f(res) {", '  const text = "x";', "  return antworteFehler(res, 400, text);", "}", "export function g() {", "  let text = 1;", "  text = 2;", "  return text;", "}"]],
    ["const der Datei, ein anderer Name gleicher Schreibweise wird zugewiesen", ['const FEHLER = "x";', "export function f(res) {", "  return res.status(400).json({ error: FEHLER });", "}", "export function g(FEHLER) {", "  FEHLER = 2;", "  return FEHLER;", "}"], ['const FEHLER = "x";', "export function f(res) {", "  return antworteFehler(res, 400, FEHLER);", "}", "export function g(FEHLER) {", "  FEHLER = 2;", "  return FEHLER;", "}"]],
    ["Parameter, per ++ geändert", ["export function f(res, code) {", "  res.status = () => {\n    code++;\n    return res;\n  };", "  return res.status(400).json({ error: code });", "}"], ["export function f(res, code) {", "  res.status = () => {\n    code++;\n    return res;\n  };", "  return antworteFehler(res, 400, code);", "}"]],
  ];
  await rotJeFall(faelle, { kreisfrei: true });
});

async function rotHinterAnweisung(faelle) {
  for (const [fall, davor] of faelle) {
    const kopf = [davor, 'const FEHLER = "fehler";'];
    await rot(FEHLER_VORHER("503", "FEHLER", kopf), FEHLER_NACHHER("503", "FEHLER", kopf), { kreisfrei: true, fall });
  }
}

test("vorbereitung-pruefen: fehlerantwort mit einer Datei-const nach einer Anweisung, die beim Laden Code ausführt, ist nicht gleichwertig", async () => {
  await rotHinterAnweisung([
    ["Aufruf", "start();"],
    ["const mit Aufruf", "const ERGEBNIS = start();"],
    ["Klasse", "class K { static s = start(); }"],
    ["const mit Template", "const T = `${start()}`;"],
    ["Destrukturierung", 'const [ERSTES] = "ab";'],
  ]);
});

test("vorbereitung-pruefen: fehlerantwort mit einer Datei-const nach einer Anweisung, die der Katalog nicht nennt, ist nicht gleichwertig", async () => {
  await rotHinterAnweisung([
    ["Object.freeze", "const STUFEN = Object.freeze({ a: 1 });"],
    ["Array", "const LISTE = [1, 2];"],
    ["Objekt", "const OPTIONEN = { a: 1 };"],
    ["Template ohne Ausdruck", "const MELDUNG = `fest`;"],
    ["export lokaler Namen", "const EINS = 1;\nexport { EINS };"],
    ["let", "let ZAEHLER = 1;"],
    ["var", "var ZAEHLER = 1;"],
  ]);
});

test("vorbereitung-pruefen: fehlerantwort mit einer Datei-const hinter den Anweisungen, die der Katalog nennt, ist gleichwertig", async () => {
  const davor = [
    'import { ANDERE } from "./andere.js";',
    "function hilfe() {\n  return 1;\n}",
    "export function weitere() {\n  return 2;\n}",
    'export * from "./alles.js";',
    'export { BENANNT } from "./benannt.js";',
    "const PFEIL = () => 1;",
    "export const FUNKTION = function () {\n  return 1;\n};",
    "const ZAHL = 1;",
  ];
  const kopf = [...davor, 'const FEHLER = "fehler";'];
  await gruen(FEHLER_VORHER("503", "FEHLER", kopf), FEHLER_NACHHER("503", "FEHLER", kopf), { genutzt: ["fehlerantwort"], kreisfrei: true });
});

test("vorbereitung-pruefen: fehlerantwort mit einer Datei-const als Fehlertext ist nur gleichwertig, wenn die Stelle in einer Funktion steht", async () => {
  const kopf = ['import res from "./antwort.js";', 'const FEHLER = "fehler";'];
  const vorher = quelle(...kopf, "export const ergebnis = res.status(503).json({ error: FEHLER });");
  const nachher = quelle(IMPORT_HELFER, ...kopf, "export const ergebnis = antworteFehler(res, 503, FEHLER);");
  await rot(vorher, nachher, { kreisfrei: true, fall: "Stelle auf oberster Ebene" });
  const inFunktion = (aufruf) => quelle(...kopf, "export function ergebnis() {", `  return ${aufruf};`, "}");
  await gruen(inFunktion("res.status(503).json({ error: FEHLER })"), quelle(IMPORT_HELFER, inFunktion("antworteFehler(res, 503, FEHLER)")), { genutzt: ["fehlerantwort"], kreisfrei: true, fall: "Stelle in einer Funktion" });
});

test("vorbereitung-pruefen: fehlerantwort mit einer Datei-const, deren Wert beim Laden Code ausführt, ist nicht gleichwertig", async () => {
  for (const [fall, zeile] of [["Aufruf", "const FEHLER = start();"], ["Objekt", "const FEHLER = { a: start() };"], ["let", 'let FEHLER = "fehler";']]) {
    await rot(FEHLER_VORHER("503", "FEHLER", [zeile]), FEHLER_NACHHER("503", "FEHLER", [zeile]), { kreisfrei: true, fall });
  }
});

test("vorbereitung-pruefen: fehlerantwort mit Fehlertext oder Status, der einen Fehler werfen oder Code ausführen kann, ist nicht gleichwertig", async () => {
  const faelle = [
    ["Eigenschaft", "fehler.text"],
    ["Aufruf", "fehler()"],
    ["Eigenschaft oder Literal", 'fehler.text || "x"'],
    ["Verknüpfung zweier Namen", "fehler && fehler"],
    ["Template", "`${fehler}`"],
    ["Objekt", "{ a: fehler }"],
    ["regulärer Ausdruck", "/x/"],
    ["new", "new Error(fehler)"],
    ["await", "await fehler"],
    ["unbekannter Name", "nirgends"],
    ["Zuweisung", "(fehler = 1)"],
    ["Index", "fehler[0]"],
    ["optionale Kette", "fehler?.text"],
  ];
  for (const [fall, wert] of faelle) {
    const kopf = (zeile) => quelle("export async function f(res, fehler) {", `  return ${zeile};`, "}");
    const vorher = kopf(`res.status(400).json({ error: ${wert} })`);
    const nachher = quelle(IMPORT_HELFER, "export async function f(res, fehler) {", `  return antworteFehler(res, 400, ${wert});`, "}");
    await rot(vorher, nachher, { fall });
  }
  const mitStatus = (s) => ({
    vorher: quelle("export function f(res, fehler) {", `  return res.status(${s}).json({ error: "x" });`, "}"),
    nachher: quelle(IMPORT_HELFER, "export function f(res, fehler) {", `  return antworteFehler(res, ${s}, "x");`, "}"),
  });
  for (const s of ["fehler.status", "fehler()", "fehler || 400", "-400", "404 + 1"]) {
    const { vorher, nachher } = mitStatus(s);
    await rot(vorher, nachher, { fall: `Status ${s}` });
  }
});

test("vorbereitung-pruefen: fehlerantwort mit einem Namen, dessen Lesen vor der Initialisierung werfen kann, ist nicht gleichwertig", async () => {
  const faelle = [
    ["const erst nach der Stelle", ["export function f(res) {", "  const r = (() => res.status(400).json({ error: spaeter }))();", '  const spaeter = "x";', "  return r;", "}"], ["export function f(res) {", "  const r = (() => antworteFehler(res, 400, spaeter))();", '  const spaeter = "x";', "  return r;", "}"]],
    ["const in der Funktion, Stelle in einer inneren Funktion", ["export function f(res) {", '  const text = "x";', "  return () => res.status(400).json({ error: text });", "}"], ["export function f(res) {", '  const text = "x";', "  return () => antworteFehler(res, 400, text);", "}"]],
    ["const in der Funktion, Stelle in einer Funktionsdeklaration", ["export function f(res) {", "  return h();", '  const text = "x";', "  function h() {", "    return res.status(400).json({ error: text });", "  }", "}"], ["export function f(res) {", "  return h();", '  const text = "x";', "  function h() {", "    return antworteFehler(res, 400, text);", "  }", "}"]],
    ["Parameter im Standardwert eines Parameters", ["export function f(res, a = res.status(400).json({ error: b }), b = 1) {", "  return a;", "}"], ["export function f(res, a = antworteFehler(res, 400, b), b = 1) {", "  return a;", "}"]],
    ["const im switch-Zweig", ["export function f(res, x) {", "  switch (x) {", "    case 1:", '      const text = "x";', "      break;", "    case 2:", "      return res.status(400).json({ error: text });", "  }", "}"], ["export function f(res, x) {", "  switch (x) {", "    case 1:", '      const text = "x";', "      break;", "    case 2:", "      return antworteFehler(res, 400, text);", "  }", "}"]],
    ["const im anderen switch-Zweig, die einen Parameter verdeckt", ["export function f(res, text, x) {", "  switch (x) {", "    case 1:", '      const text = "a";', "      break;", "    case 2:", "      return res.status(400).json({ error: text });", "  }", "}"], ["export function f(res, text, x) {", "  switch (x) {", "    case 1:", '      const text = "a";', "      break;", "    case 2:", "      return antworteFehler(res, 400, text);", "  }", "}"]],
    ["const in ihrer eigenen Initialisierung",["export function f(res) {", "  const text = res.status(400).json({ error: text });", "  return text;", "}"], ["export function f(res) {", "  const text = antworteFehler(res, 400, text);", "  return text;", "}"]],
    ["const in einem anderen Block", ["export function f(res, x) {", "  if (x) {", '    const text = "x";', "  }", "  return res.status(400).json({ error: text });", "}"], ["export function f(res, x) {", "  if (x) {", '    const text = "x";', "  }", "  return antworteFehler(res, 400, text);", "}"]],
    ["let im Rumpf", ["export function f(res) {", '  let text = "x";', "  return res.status(400).json({ error: text });", "}"], ["export function f(res) {", '  let text = "x";', "  return antworteFehler(res, 400, text);", "}"]],
    ["var im Rumpf", ["export function f(res) {", "  var text = 1;", "  return res.status(400).json({ error: text });", "}"], ["export function f(res) {", "  var text = 1;", "  return antworteFehler(res, 400, text);", "}"]],
    ["catch-Parameter", ["export function f(res) {", "  try {", "    return 1;", "  } catch (fehler) {", "    return res.status(400).json({ error: fehler });", "  }", "}"], ["export function f(res) {", "  try {", "    return 1;", "  } catch (fehler) {", "    return antworteFehler(res, 400, fehler);", "  }", "}"]],
    ["Klasse der Datei", ["class Meldung {}", "export function f(res) {", "  return res.status(400).json({ error: Meldung });", "}"], ["class Meldung {}", "export function f(res) {", "  return antworteFehler(res, 400, Meldung);", "}"]],
    ["Funktion der Datei", ["function meldung() {}", "export function f(res) {", "  return res.status(400).json({ error: meldung });", "}"], ["function meldung() {}", "export function f(res) {", "  return antworteFehler(res, 400, meldung);", "}"]],
  ];
  await rotJeFall(faelle, { kreisfrei: true });
});

test("vorbereitung-pruefen: fehlerantwort mit einem Empfänger, der nicht lokal gebunden ist oder zugewiesen wird, ist nicht gleichwertig", async () => {
  const faelle = [
    ["globaler Name", ["export const f = () => res.status(400).json({ error: \"x\" });"], ["export const f = () => antworteFehler(res, 400, \"x\");"]],
    ["Eigenschaft", ["export const f = (o) => o.res.status(400).json({ error: \"x\" });"], ["export const f = (o) => antworteFehler(o.res, 400, \"x\");"]],
    ["Aufruf", ["export const f = (g) => g().status(400).json({ error: \"x\" });"], ["export const f = (g) => antworteFehler(g(), 400, \"x\");"]],
    ["zugewiesen", ["export function f(res) {", "  res = null;", "  return res.status(400).json({ error: \"x\" });", "}"], ["export function f(res) {", "  res = null;", "  return antworteFehler(res, 400, \"x\");", "}"]],
  ];
  await rotJeFall(faelle);
});

test("vorbereitung-pruefen: fehlerantwort ist rot, wenn die alte Form etwas anderes tut als die Hilfe", async () => {
  const faelle = [
    ["anderer Körper", FEHLER_VORHER("404", '"x"').replace("{ error:", "{ message:"), FEHLER_NACHHER("404", '"x"')],
    ["zusätzliches Feld", FEHLER_VORHER("404", '"x"').replace('"x" }', '"x", ok: false }'), FEHLER_NACHHER("404", '"x"')],
    ["send statt json", FEHLER_VORHER("404", '"x"').replace(".json(", ".send("), FEHLER_NACHHER("404", '"x"')],
    ["anderer Status", FEHLER_VORHER("404", '"x"'), FEHLER_NACHHER("400", '"x"')],
    ["anderer Text", FEHLER_VORHER("404", '"x"'), FEHLER_NACHHER("404", '"y"')],
    ["vertauschte Argumente", FEHLER_VORHER("404", '"x"'), FEHLER_NACHHER('"x"', "404")],
    ["Schlüssel als Text", FEHLER_VORHER("404", '"x"').replace("{ error:", '{ "error":'), FEHLER_NACHHER("404", '"x"')],
    ["Schlüssel in Kurzschreibweise", quelle("export const f = (res, error) => {", "  return res.status(404).json({ error });", "};"), quelle(IMPORT_HELFER, "export const f = (res, error) => {", "  return antworteFehler(res, 404, error);", "};")],
    ["weiterer Aufruf dazwischen", FEHLER_VORHER("404", '"x"').replace(".status(404)", ".status(404).set('a', 'b')"), FEHLER_NACHHER("404", '"x"')],
    ["status an res selbst nicht aufgerufen", FEHLER_VORHER("404", '"x"').replace("res.status(404)", "res.sendStatus(404)").replace(".json({ error: \"x\" })", ""), FEHLER_NACHHER("404", '"x"')],
  ];
  for (const [fall, vorher, nachher] of faelle) await rot(vorher, nachher, { fall });
});

test("vorbereitung-pruefen: fehlerantwort ist rot bei falscher Argumentzahl, Spread, optionalem Aufruf oder wenn die Hilfe nur weitergereicht wird", async () => {
  const faelle = [
    ["zwei Argumente", "antworteFehler(res, 404)"],
    ["vier Argumente", 'antworteFehler(res, 404, "x", 1)'],
    ["Spread", "antworteFehler(...[res, 404, \"x\"])"],
    ["Spread als drittes", 'antworteFehler(res, 404, ..."x")'],
    ["optionaler Aufruf", 'antworteFehler?.(res, 404, "x")'],
    ["weitergereicht", "[1].map(antworteFehler)"],
    ["als Wert gelesen", "(antworteFehler)"],
    ["Eigenschaft gleichen Namens", 'res.antworteFehler(res, 404, "x")'],
  ];
  for (const [fall, aufruf] of faelle) {
    const vorher = FEHLER_VORHER("404", '"x"');
    const nachher = quelle(IMPORT_HELFER, "export const f = (res) => {", `  return ${aufruf};`, "};");
    await rot(vorher, nachher, { fall });
  }
});

test("vorbereitung-pruefen: fehlerantwort nur mit dem Import von antworteFehler aus src/utils/http.js, ohne Alias und nur aus einem benannten Import", async () => {
  const aufruf = (name) => ["export const f = (res) => {", `  return ${name}(res, 404, "x");`, "};"];
  const faelle = [
    ["anderes Modul", quelle('import { antworteFehler } from "../utils/anders.js";', ...aufruf("antworteFehler"))],
    ["Alias", quelle('import { antworteFehler as melde } from "../utils/http.js";', ...aufruf("melde"))],
    ["Namensraum", quelle('import * as h from "../utils/http.js";', "export const f = (res) => h.antworteFehler(res, 404, \"x\");")],
    ["lokal definiert", quelle("function antworteFehler(res, s, c) {", "  return res.status(s).json({ error: c });", "}", ...aufruf("antworteFehler"))],
    ["zusätzlich lokal gebunden", quelle(IMPORT_HELFER, "export const g = (antworteFehler) => antworteFehler;", ...aufruf("antworteFehler"))],
    ["zugewiesen", quelle(IMPORT_HELFER, "export const s = () => { antworteFehler = null; };", ...aufruf("antworteFehler"))],
    ["eval in der Datei", quelle(IMPORT_HELFER, "export const e = (s) => eval(s);", ...aufruf("antworteFehler"))],
  ];
  for (const [fall, nachher] of faelle) await rot(FEHLER_VORHER("404", '"x"'), nachher, { fall });
});

const NORMAL = 'res.status(404).json({ error: "x" })';

test("vorbereitung-pruefen: fehlerantwort nur, wenn antworteFehler in src/utils/http.js genau res.status(status).json({ error: code }) liefert", async () => {
  const nachher = quelle(IMPORT_HELFER, "export const f = (res) => {", '  return antworteFehler(res, 404, "x");', "};");
  const mit = (zeilen) => quelle("export function antworteFehler(res, status, code) {", ...zeilen, "}");
  const faelle = [
    ["fehlt", null, NORMAL],
    ["nicht lesbar", "export function antworteFehler(res, status, code) {", NORMAL],
    ["anderer Körper", mit(["  return res.status(status).json({ message: code });"]), 'res.status(404).json({ message: "x" })'],
    ["zusätzliches Feld", mit(["  return res.status(status).json({ error: code, ok: false });"]), 'res.status(404).json({ error: "x", ok: false })'],
    ["send", mit(["  return res.status(status).send({ error: code });"]), 'res.status(404).send({ error: "x" })'],
    ["ohne return", mit(["  res.status(status).json({ error: code });"]), NORMAL],
    ["Anweisung vor return", mit(['  res.set("Cache-Control", "no-store");', "  return res.status(status).json({ error: code });"]), NORMAL],
    ["Anweisung nach return", mit(["  return res.status(status).json({ error: code });", '  console.log("nie");']), NORMAL],
    ["throw statt return", mit(["  throw res.status(status).json({ error: code });"]), NORMAL],
    ["Empfänger ist der Text", mit(["  return code.status(status).json({ error: res });"]), NORMAL],
    ["Status ist der Text", mit(["  return res.status(code).json({ error: code });"]), NORMAL],
    ["Fehlertext ist der Status", mit(["  return res.status(status).json({ error: status });"]), NORMAL],
    ["status berechnet", mit(["  return res[status](status).json({ error: code });"]), 'res[status](404).json({ error: "x" })'],
    ["json berechnet", mit(["  return res.status(status)[json]({ error: code });"]), 'res.status(404)[json]({ error: "x" })'],
    ["Schlüssel berechnet", mit(["  return res.status(status).json({ [error]: code });"]), 'res.status(404).json({ [error]: "x" })'],
    ["anderer Schlüssel", mit(["  return res.status(status).json({ message: code });"]), NORMAL.replace("error", "message")],
    ["zwei Felder", mit(["  return res.status(status).json({ error: code, error2: code });"]), NORMAL],
    ["vier Parameter", quelle("export function antworteFehler(res, status, code, extra) {", "  return res.status(status).json({ error: code });", "}"), NORMAL],
    ["zwei Parameter", quelle("export function antworteFehler(res, status) {", "  return res.status(status).json({ error: status });", "}"), NORMAL],
    ["Standardwert", quelle("export function antworteFehler(res, status, code = 1) {", "  return res.status(status).json({ error: code });", "}"), NORMAL],
    ["async", quelle("export async function antworteFehler(res, status, code) {", "  return res.status(status).json({ error: code });", "}"), NORMAL],
    ["Generator", quelle("export function* antworteFehler(res, status, code) {", "  return res.status(status).json({ error: code });", "}"), NORMAL],
    ["Pfeilfunktion", quelle("export const antworteFehler = (res, status, code) => res.status(status).json({ error: code });"), NORMAL],
    ["nicht exportiert", quelle("function antworteFehler(res, status, code) {", "  return res.status(status).json({ error: code });", "}"), NORMAL],
    ["in http.js zugewiesen", quelle(...HELFER, "export function ersetze() {", "  antworteFehler = null;", "}"), NORMAL],
    ["Anweisung mit Wirkung", quelle(...HELFER, 'console.log("geladen");'), NORMAL],
    ["Import", quelle('import "node:fs";', ...HELFER), NORMAL],
  ];
  for (const [fall, http, vorherKette] of faelle) {
    const vorher = quelle("export const f = (res) => {", `  return ${vorherKette};`, "};");
    await rot(vorher, nachher, { http, httpVorher: http, fall });
  }
  await gruen(FEHLER_VORHER("404", '"x"'), nachher, { genutzt: ["fehlerantwort"] });
});

test("vorbereitung-pruefen: fehlerantwort ist rot für einen unbenutzten Import und wenn nicht jeder Aufruf der Datei die Bedingungen erfüllt", async () => {
  const kopf = (zeilen) => quelle(IMPORT_HELFER, "export const f = (res, fehler) => {", ...zeilen, "};");
  const vorher = (zeilen) => quelle("export const f = (res, fehler) => {", ...zeilen, "};");
  await rot(vorher(["  return 1;"]), kopf(["  return 1;"]), { fall: "unbenutzter Import" });
  const zwei = ['  res.status(404).json({ error: "x" });', "  return res.status(400).json({ error: fehler.text });"];
  const zweiNachher = ['  antworteFehler(res, 404, "x");', "  return antworteFehler(res, 400, fehler.text);"];
  await rot(vorher(zwei), kopf(zweiNachher), { fall: "ein Aufruf ohne Nachweis" });
  await gruen(vorher(zwei.slice(0, 1)), kopf(zweiNachher.slice(0, 1)), { genutzt: ["fehlerantwort"], fall: "Kontrolle: der erste Aufruf allein" });
});

test("vorbereitung-pruefen: fehlerantwort ist rot, wenn der Name antworteFehler in der Datei noch einmal gebunden ist", async () => {
  const eigeneBindung = quelle(IMPORT_HELFER, "export const f = (res) => antworteFehler(res, 404, \"x\");", "export const g = (antworteFehler, res) => antworteFehler(res, 400, \"y\");");
  const ausgeklappt = quelle("export const f = (res) => res.status(404).json({ error: \"x\" });", "export const g = (antworteFehler, res) => res.status(400).json({ error: \"y\" });");
  await rot(ausgeklappt, eigeneBindung, { fall: "der zweite Aufruf gehört zum Parameter" });
});

test("vorbereitung-pruefen: fehlerantwort ist rot, wenn antworteFehler nur als Argument eines Aufrufs mit drei Argumenten vorkommt", async () => {
  const faelle = [
    ["als Fehlertext der Hilfe selbst", ["export function f(res) {", "  return res.status(404).json({ error: antworteFehler });", "}"], ["export function f(res) {", "  return antworteFehler(res, 404, antworteFehler);", "}"]],
    ["als erstes Argument eines anderen Aufrufs", ["export function f(res, foo) {", '  return foo(antworteFehler, 404, "x");', "}"], ["export function f(res, foo) {", '  return foo(antworteFehler, 404, "x");', "}"]],
  ];
  await rotJeFall(faelle, { kreisfrei: true });
});

test("vorbereitung-pruefen: fehlerantwort setzt den Rumpf der Hilfe ohne Positionen ein, damit keine Regel seinen Schlüssel error über eine Zeichenposition der Routendatei trifft", async () => {
  const vorher = quelle("const FUENF = 5;", 'export const f = (res) => res.status(404).json({ 5: "x" });', "export const g = () => FUENF;");
  const nachher = quelle(IMPORT_HELFER, "const FUENF = 5;", 'export const f = (res) => antworteFehler(res, 404, "x");', "export const g = () => FUENF;");
  const einrueckung = nachher.lastIndexOf("FUENF") - quelle(...HELFER).indexOf("error");
  assert.ok(einrueckung >= 0);
  const http = " ".repeat(einrueckung) + quelle(...HELFER);
  const ergebnis = await vergleich(vorher, nachher, { kreisfrei: true, http });
  assert.equal(ergebnis.gleich, false, JSON.stringify(ergebnis));
});

test("vorbereitung-pruefen: fehlerantwort liest eine Funktion nicht über ihren eigenen Namen", async () => {
  const vorher = quelle("export const f = function melde(res) {", "  return res.status(400).json({ error: melde });", "};");
  const nachher = quelle(IMPORT_HELFER, "export const f = function melde(res) {", "  return antworteFehler(res, 400, melde);", "};");
  await rot(vorher, nachher);
});

test("vorbereitung-pruefen: fehlerantwort und status-konstante gelten in beide Richtungen mit der jeweils eigenen Fassung von src/utils/http.js", async () => {
  const ohneHelfer = quelle("export const HTTP_NOT_FOUND = 404;");
  await gruen(FEHLER_VORHER("404", '"x"'), FEHLER_NACHHER("404", '"x"'), { genutzt: ["fehlerantwort"], http: HTTP, httpVorher: ohneHelfer });
  await rot(FEHLER_VORHER("404", '"x"'), FEHLER_NACHHER("404", '"x"'), { http: ohneHelfer, httpVorher: HTTP });
  await gruen(FEHLER_NACHHER("404", '"x"'), FEHLER_VORHER("404", '"x"'), { genutzt: ["fehlerantwort"] });
});

const GIT_LISTE = `${JSON.stringify(["src/routes/probe.js"])}\n`;
const GIT_KOPF = 'import { HTTP_NOT_FOUND, antworteFehler } from "../utils/http.js";';
const GIT_VORHER = quelle("export const f = (res) => {", '  return res.status(404).json({ error: "x" });', "};");
const GIT_NACHHER = quelle(GIT_KOPF, "export const f = (res) => {", '  return antworteFehler(res, HTTP_NOT_FOUND, "x");', "};");

test("vorbereitung-pruefen: über Git gilt fehlerantwort mit der Fassung von src/utils/http.js am Ziel, auch wenn die Basis sie noch nicht hatte", (context) => {
  const repo = repoMitBasis(context, { [HTTP_PFAD]: quelle("export const HTTP_BAD_REQUEST = 400;"), [PFAD]: GIT_VORHER, "liste.json": GIT_LISTE });
  const lauf = nachCommitAufrufen(repo, [WERKZEUG, "--bereich", "liste.json"], { [HTTP_PFAD]: HTTP, [PFAD]: GIT_NACHHER });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.output);
  assert.match(lauf.output, /^src\/routes\/probe\.js: gleichwertig \(fehlerantwort, status-konstante\)$/m);
});

test("vorbereitung-pruefen: über Git ist fehlerantwort rot, wenn src/utils/http.js am Ziel einen anderen Wert oder eine andere Hilfe hat", (context) => {
  for (const [fall, http] of [
    ["anderer Wert", HTTP.replace("HTTP_NOT_FOUND = 404", "HTTP_NOT_FOUND = 405")],
    ["andere Hilfe", HTTP.replace("{ error: code }", "{ message: code }")],
  ]) {
    const repo = repoMitBasis(context, { [HTTP_PFAD]: HTTP, [PFAD]: GIT_VORHER, "liste.json": GIT_LISTE });
    const lauf = nachCommitAufrufen(repo, [WERKZEUG, "--bereich", "liste.json"], { [HTTP_PFAD]: http, [PFAD]: GIT_NACHHER });
    assert.equal(lauf.status, EXIT_ROT, `${fall}: ${lauf.output}`);
    assert.match(lauf.output, /^src\/routes\/probe\.js:\d+: Änderung, die keine Umformung/m, fall);
  }
});

test("vorbereitung-pruefen: über Git gilt eine Datei-const als Fehlertext nur ohne Import-Kreis", (context) => {
  const route = (kopf, aufruf) => quelle(kopf, 'const FEHLER = "fehler";', "export const f = (res) => {", `  return ${aufruf};`, "};");
  const vorher = { [HTTP_PFAD]: HTTP, "src/routes/frei.js": route("", 'res.status(404).json({ error: FEHLER })'), "src/routes/kreis.js": route('import "./kreis-b.js";', 'res.status(404).json({ error: FEHLER })'), "src/routes/kreis-b.js": 'export const b = 1;\n' };
  const repo = repoMitBasis(context, { ...vorher, "liste.json": `${JSON.stringify(["src/routes/frei.js", "src/routes/kreis.js"])}\n` });
  const helfer = 'import { antworteFehler } from "../utils/http.js";';
  const nachher = {
    "src/routes/frei.js": route(helfer, "antworteFehler(res, 404, FEHLER)"),
    "src/routes/kreis.js": route(`${helfer}\nimport "./kreis-b.js";`, "antworteFehler(res, 404, FEHLER)"),
    "src/routes/kreis-b.js": 'import "./kreis.js";\nexport const b = 1;\n',
  };
  const lauf = nachCommitAufrufen(repo, [WERKZEUG, "--bereich", "liste.json"], nachher);
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, /^src\/routes\/frei\.js: gleichwertig \(fehlerantwort\)$/m);
  assert.match(lauf.output, /^src\/routes\/kreis\.js:\d+: Änderung, die keine Umformung/m);
});
