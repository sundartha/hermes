import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { listenUmziehen } from "../../tools/auftrag/listenumzug.mjs";
import { geklonterText, kopienNachUmzug, kopienOrt, stammtAusAltemText } from "../../tools/auslagerung-eintraege.mjs";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const LISTE = "tools/basis/jscpd.json";
const KONFIGURATION = ".jscpd.json";
const HILFE = "src/werte.js";
const NEU = "src/waehlen.js";
const PARTNER = "test/waehlen.test.js";
const SKRIPT = "scripts/waehlen.js";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

const WAEHLE = [
  "export function waehle(eintraege, grenze) {",
  "  const treffer = eintraege.filter((eintrag) => eintrag.wert > grenze);",
  "  const sortiert = treffer.toSorted((links, rechts) => links.wert - rechts.wert);",
  "  return sortiert.map((eintrag) => ({ name: eintrag.name, wert: eintrag.wert }));",
  "}",
].join("\n");
const FREMD = [
  "export function sammle(zeilen, trenner) {",
  "  const teile = zeilen.map((zeile) => String(zeile).trim());",
  "  return teile.filter((teil) => teil.length > 0 && teil !== trenner).join(trenner);",
  "}",
].join("\n");
const ZWEI = "export function zwei(wert) {\n  return wert * 2;\n}";
const BLEIBT = "export function bleibt(wert) {\n  return wert;\n}";
const WEITERGEREICHT = 'export { waehle, zwei } from "./waehlen.js";';

function datei(...teile) {
  return `${teile.join("\n\n")}\n`;
}

function liste(version, befunde) {
  return `${JSON.stringify({ version, befunde }, null, 2)}\n`;
}

function lesen(repo) {
  return JSON.parse(readFileSync(join(repo, LISTE), "utf8"));
}

function mitTokens(eintrag, tokens) {
  return eintrag.replace(/\d+$/, `${tokens}`);
}

function basisRepo(context, { aendern = ({ version, befunde }) => [version, befunde], partner = PARTNER, dazu = {} } = {}) {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "eslint.config.js": "export default [];\n",
    [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
    [HILFE]: datei(WAEHLE, ZWEI, BLEIBT),
    [partner]: datei(WAEHLE, FREMD),
    ...dazu,
  });
  const angelegt = runIn(repo, process.execPath, [BASIS_VERGLEICH, "jscpd", "--basis-anlegen"]);
  assert.equal(angelegt.status, EXIT_GRUEN, `${angelegt.stdout}${angelegt.stderr}`);
  const { version, befunde } = lesen(repo);
  assert.equal(befunde.length, 1, befunde.join(", "));
  writeFiles(repo, { [LISTE]: liste(...aendern({ version, befunde })) });
  commitAll(repo, "Liste");
  return { repo, alt: befunde[0] };
}

function auslagern(repo, dateien = {}) {
  writeFiles(repo, { [HILFE]: datei(WEITERGEREICHT, BLEIBT), [NEU]: datei(WAEHLE, ZWEI), ...dateien });
  commitAll(repo, "Auslagerung");
}

async function umziehen(context, repo) {
  const meldungen = [];
  context.mock.method(console, "log", (zeile) => meldungen.push(zeile));
  const ergebnis = await listenUmziehen({ basis: "HEAD~1", root: repo });
  assert.equal(ergebnis, EXIT_GRUEN, meldungen.join("\n"));
  return meldungen.join("\n");
}

function gate(repo) {
  const lauf = runIn(repo, process.execPath, [BASIS_VERGLEICH, "jscpd", "--basis", "HEAD~1"]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

async function umgezogen(context, { aendern, dateien, partner, dazu }) {
  const { repo } = basisRepo(context, { aendern, partner, dazu });
  auslagern(repo, dateien);
  const vorher = lesen(repo);
  await umziehen(context, repo);
  return { repo, vorher, nachher: lesen(repo) };
}

function istAlsNeuGemeldet(repo) {
  const pruefung = gate(repo);
  assert.equal(pruefung.status, EXIT_ROT, pruefung.ausgabe);
  assert.match(pruefung.ausgabe, /src\/waehlen\.js:\d+-\d+ gleicht test\/waehlen\.test\.js/);
}

test("Umzug mit gleicher Tokenzahl: der Eintrag zieht auf die ausgelagerte Datei, und die Kopien-Prüfung meldet nichts Neues", async (context) => {
  const { repo, alt } = basisRepo(context);
  auslagern(repo);
  const vorab = gate(repo);
  assert.equal(vorab.status, EXIT_ROT, vorab.ausgabe);
  const ausgabe = await umziehen(context, repo);
  assert.deepEqual(lesen(repo).befunde, [alt.replace(HILFE, NEU)]);
  assert.match(ausgabe, /1 Kopien-Einträge der alten Datei auf die wortgleich ausgelagerte Datei umgezogen/);
  const pruefung = gate(repo);
  assert.equal(pruefung.status, EXIT_GRUEN, pruefung.ausgabe);
});

test("Umzug mit höherer Tokenzahl als der alte Eintrag: der Eintrag bleibt, jscpd meldet die ausgelagerte Kopie als neu", async (context) => {
  const { repo, vorher, nachher } = await umgezogen(context, {
    aendern: ({ version, befunde }) => [version, befunde.map((eintrag) => mitTokens(eintrag, Number(eintrag.split("|").at(-1)) - 1))],
  });
  assert.deepEqual(nachher, vorher);
  istAlsNeuGemeldet(repo);
});

test("neue Kopie, deren Code nicht aus der alten Datei stammt: der Eintrag bleibt, jscpd meldet die Kopie als neu", async (context) => {
  const dateien = { [HILFE]: datei(ZWEI, BLEIBT), [NEU]: datei(FREMD, ZWEI) };
  const { repo, vorher, nachher } = await umgezogen(context, { dateien });
  assert.deepEqual(nachher, vorher);
  istAlsNeuGemeldet(repo);
});

test("Code geht in eine Datei, die es auf der Basis schon gab: der Eintrag bleibt, jscpd meldet die Kopie als neu", async (context) => {
  const { vorher, nachher } = await umgezogen(context, { dazu: { [NEU]: datei("export const NOTIZ = 1;") } });
  assert.deepEqual(nachher, vorher);
});

test("Auftrag ändert auch den Partner der Kopie: die Kopie ist nicht mehr unverändert, der Eintrag bleibt", async (context) => {
  const geaendert = datei(WAEHLE, FREMD, "export const NOTIZ = 1;");
  const { vorher, nachher } = await umgezogen(context, { partner: SKRIPT, dateien: { [SKRIPT]: geaendert } });
  assert.deepEqual(nachher, vorher);
});

test("Eintrag aus einer anderen jscpd-Version: die Tokenzahlen sind nicht vergleichbar, der Eintrag bleibt", async (context) => {
  const { vorher, nachher } = await umgezogen(context, { aendern: ({ befunde }) => ["0.0.1", befunde] });
  assert.deepEqual(nachher, vorher);
});

test("geänderte jscpd-Konfiguration: die Tokenzahlen sind nicht vergleichbar, der Eintrag bleibt", async (context) => {
  const konfiguration = readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8").replace('"minTokens": 50', '"minTokens": 51');
  const { vorher, nachher } = await umgezogen(context, { dateien: { [KONFIGURATION]: konfiguration } });
  assert.deepEqual(nachher, vorher);
});

const HILFE_TABELLE = "src/mcp-tools.js";
const NEU_TABELLE = "src/mcp/schemata.js";
const PARTNER_TABELLE = "test/mcp-ui.test.js";

function schluessel(erste, zweite, tokens) {
  return `${erste}|${zweite}|${tokens}`;
}

const alt = (tokens) => schluessel(HILFE_TABELLE, PARTNER_TABELLE, tokens);
const neu = (tokens) => schluessel(NEU_TABELLE, PARTNER_TABELLE, tokens);
const funde = (...keys) => keys.map((key) => ({ key }));
const alles = { unveraendert: () => true, neueDatei: () => true, stammtAus: () => true };

function umgezogenNach({ liste: bisher, aktuell, pruefen = {} }) {
  return kopienNachUmzug({ liste: bisher, aktuell: funde(...aktuell), pruefen: { ...alles, ...pruefen } });
}

test("Kopien-Einträge nach Umzug, MCZ-Fall: vier der fünf Einträge ziehen mit ihrer Tokenzahl um, der fünfte bleibt, die Liste wächst nicht", () => {
  const ergebnis = umgezogenNach({ liste: [50, 51, 54, 63, 64].map(alt), aktuell: [51, 54, 63, 64].map(neu) });
  assert.deepEqual(ergebnis, { neu: [alt(50), ...[51, 54, 63, 64].map(neu)], anzahl: 4 });
});

test("Kopien-Einträge nach Umzug: niedrigere Tokenzahl in der neuen Datei zieht mit der niedrigeren Zahl um", () => {
  assert.deepEqual(umgezogenNach({ liste: [alt(60)], aktuell: [neu(55)] }), { neu: [neu(55)], anzahl: 1 });
});

test("Kopien-Einträge nach Umzug: höhere Tokenzahl in der neuen Datei zieht nicht um", () => {
  assert.equal(umgezogenNach({ liste: [alt(60)], aktuell: [neu(61)] }), undefined);
});

test("Kopien-Einträge nach Umzug: ist der alte Eintrag noch gültig, ist die Kopie in der neuen Datei neu und nichts zieht um", () => {
  assert.equal(umgezogenNach({ liste: [alt(60)], aktuell: [alt(60), neu(60)] }), undefined);
});

test("Kopien-Einträge nach Umzug: findet jscpd das alte Paar noch mit weniger Tokens, bleibt der alte Eintrag gültig und nichts zieht um", () => {
  assert.equal(umgezogenNach({ liste: [alt(60)], aktuell: [alt(55), neu(58)] }), undefined);
});

test("Kopien-Einträge nach Umzug: findet jscpd das alte Paar mit mehr Tokens als der Eintrag, deckt das den Eintrag nicht", () => {
  assert.deepEqual(umgezogenNach({ liste: [alt(60)], aktuell: [alt(61), neu(58)] }), { neu: [neu(58)], anzahl: 1 });
});

test("Kopien-Einträge nach Umzug: ein Eintrag deckt nur einen Fund, der zweite Fund bleibt unbekannt und ersetzt einen offenen Eintrag", () => {
  const ergebnis = umgezogenNach({ liste: [alt(70), neu(60)], aktuell: [neu(55), neu(50)] });
  assert.deepEqual(ergebnis, { neu: [neu(50), neu(60)], anzahl: 1 });
});

test("Kopien-Einträge nach Umzug: ein geschrumpfter Fund deckt den kleinsten passenden Eintrag, der größere bleibt offen", () => {
  const ergebnis = umgezogenNach({ liste: [alt(70), alt(60)], aktuell: [alt(55), neu(65)] });
  assert.deepEqual(ergebnis, { neu: [alt(60), neu(65)], anzahl: 1 });
});

test("Kopien-Einträge nach Umzug: bei zwei alten Einträgen zieht der nicht mehr gefundene um, der noch gültige bleibt", () => {
  const ergebnis = umgezogenNach({ liste: [alt(52), alt(63)], aktuell: [alt(52), neu(51)] });
  assert.deepEqual(ergebnis, { neu: [alt(52), neu(51)], anzahl: 1 });
});

test("Kopien-Einträge nach Umzug: mehr Funde in den neuen Dateien als offene Einträge, die Liste wächst nicht", () => {
  const ergebnis = umgezogenNach({ liste: [alt(60)], aktuell: [neu(60), neu(58), schluessel("src/mcp/zwei.js", PARTNER_TABELLE, 60)] });
  assert.deepEqual(ergebnis, { neu: [neu(60)], anzahl: 1 });
});

test("Kopien-Einträge nach Umzug: der kleinste passende offene Eintrag nimmt den Fund, damit auch ein größerer Fund noch einen Eintrag findet", () => {
  const ergebnis = umgezogenNach({ liste: [alt(70), alt(60)], aktuell: [neu(55), neu(65)] });
  assert.deepEqual(ergebnis, { neu: [neu(55), neu(65)], anzahl: 2 });
});

test("Kopien-Einträge nach Umzug: ein Fund, der schon als Eintrag in der Liste steht, ersetzt keinen alten Eintrag ein zweites Mal", () => {
  assert.equal(umgezogenNach({ liste: [alt(60), neu(60)], aktuell: [neu(60)] }), undefined);
});

test("Kopien-Einträge nach Umzug: ohne Fund in den neuen Dateien bleibt die Liste", () => {
  assert.equal(umgezogenNach({ liste: [alt(60)], aktuell: [] }), undefined);
});

test("Kopien-Einträge nach Umzug: ein Fund mit anderem Partner als der alte Eintrag zieht nicht um", () => {
  assert.equal(umgezogenNach({ liste: [alt(60)], aktuell: [schluessel(NEU_TABELLE, "test/anderes.test.js", 60)] }), undefined);
});

test("Kopien-Einträge nach Umzug: steht die alte Datei im Schlüssel hinter dem Partner, bleibt der neue Schlüssel nach Dateinamen geordnet", () => {
  const ergebnis = umgezogenNach({ liste: [schluessel("lib/a.js", HILFE_TABELLE, 60)], aktuell: [schluessel("lib/a.js", NEU_TABELLE, 60)] });
  assert.deepEqual(ergebnis, { neu: [schluessel("lib/a.js", NEU_TABELLE, 60)], anzahl: 1 });
});

test("Kopien-Einträge nach Umzug: eine Kopie des Partners mit sich selbst ersetzt keinen Eintrag", () => {
  const ergebnis = umgezogenNach({ liste: [alt(60)], aktuell: [schluessel(PARTNER_TABELLE, PARTNER_TABELLE, 60)] });
  assert.equal(ergebnis, undefined);
});

test("Kopien-Einträge nach Umzug: ein Fund ohne gemeinsame Datei mit dem alten Eintrag ersetzt ihn nicht", () => {
  const ergebnis = umgezogenNach({ liste: [schluessel("lib/x.js", "lib/y.js", 70)], aktuell: [schluessel(NEU_TABELLE, NEU_TABELLE, 60)] });
  assert.equal(ergebnis, undefined);
});

test("Kopien-Einträge nach Umzug: ein Eintrag der alten Datei mit sich selbst zieht nicht um", () => {
  const ergebnis = umgezogenNach({ liste: [schluessel(HILFE_TABELLE, HILFE_TABELLE, 60)], aktuell: [schluessel(NEU_TABELLE, NEU_TABELLE, 60)] });
  assert.equal(ergebnis, undefined);
});

test("Kopien-Einträge nach Umzug: ist der Partner seit der Basis geändert, zieht nichts um", () => {
  const unveraendert = (datei) => datei !== PARTNER_TABELLE;
  assert.equal(umgezogenNach({ liste: [alt(60)], aktuell: [neu(60)], pruefen: { unveraendert } }), undefined);
});

test("Kopien-Einträge nach Umzug: war die Datei des Funds schon auf der Basis, zieht nichts um", () => {
  const neueDatei = (datei) => datei !== NEU_TABELLE;
  assert.equal(umgezogenNach({ liste: [alt(60)], aktuell: [neu(60)], pruefen: { neueDatei } }), undefined);
});

test("Kopien-Einträge nach Umzug: stammt der Code der Kopie nicht aus der alten Datei, zieht nichts um", () => {
  const stammtAus = () => false;
  assert.equal(umgezogenNach({ liste: [alt(60)], aktuell: [neu(60)], pruefen: { stammtAus } }), undefined);
});

test("Kopien-Einträge nach Umzug: die Prüfung bekommt Ort des Funds, alte und neue Datei", () => {
  const gesehen = [];
  const stammtAus = (ort, dateien) => gesehen.push({ ort, dateien });
  umgezogenNach({ liste: [alt(60)], aktuell: [neu(60)], pruefen: { stammtAus } });
  assert.deepEqual(gesehen, [{ ort: undefined, dateien: { von: HILFE_TABELLE, nach: NEU_TABELLE } }]);
});

test("Code aus der alten Datei: gleicher Text in anderer Einrückung und mit zusätzlichem export vorn gilt als wortgleich", () => {
  const alterText = "const A = {\n  x: 1,\n};\nconst B = 2;\n";
  assert.equal(stammtAusAltemText("export const A = {\n    x: 1,\n  };", alterText), true);
});

test("Code aus der alten Datei: Text, der dort nicht steht, gilt als nicht wortgleich", () => {
  assert.equal(stammtAusAltemText("const A = { x: 2 };", "const A = { x: 1 };\n"), false);
});

test("Code aus der alten Datei: fehlt die alte Datei auf der Basis, gilt der Code als nicht wortgleich", () => {
  assert.equal(stammtAusAltemText("const A = 1;", null), false);
});

test("Code aus der alten Datei: ein leerer Text oder nur export gilt nie als wortgleich", () => {
  assert.deepEqual([stammtAusAltemText("", "const A = 1;"), stammtAusAltemText("  export ", "export const A = 1;")], [false, false]);
});

test("Ort einer Kopie: Dateien und Zeilen beider Seiten werden aus der Fundmeldung gelesen, eine unlesbare Meldung ergibt keinen Ort", () => {
  const ort = kopienOrt("src/mcp/schemata.js:3-9 gleicht test/mcp-ui.test.js:124-130 (51 Tokens)");
  assert.deepEqual([...ort], [["src/mcp/schemata.js", { von: 3, bis: 9 }], ["test/mcp-ui.test.js", { von: 124, bis: 130 }]]);
  assert.equal(kopienOrt("irgendetwas anderes").size, 0);
});

test("Text einer Kopie: die Zeilen von bis bis einschließlich, für eine unbekannte Datei leer", () => {
  const ort = new Map([["a.js", { von: 2, bis: 3 }]]);
  assert.deepEqual([geklonterText("eins\nzwei\ndrei\nvier\n", ort, "a.js"), geklonterText("eins\nzwei\n", ort, "b.js")], ["zwei\ndrei", ""]);
});
