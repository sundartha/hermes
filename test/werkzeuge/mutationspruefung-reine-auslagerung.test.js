import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { testumbauPruefung } from "../../tools/mutationspruefung/testumbau.mjs";
import { probeRepository, writeFiles } from "./probe-repo.js";

const HILFE = "test/helfer/zahl-hilfe.js";
const NEU = "test/gemeinsam/ohne-quelle.js";
const ERKANNT = "reine Auslagerung: keine Testumbau-Mutation (aus ";

const SICHER = 'import assert from "node:assert/strict";';
const QUELLE = 'import { einordnen } from "../../src/zahl.js";';
const WERTE_IN_HILFE = 'import { MINUS } from "./werte.js";';
const WERTE_IN_NEU = 'import { MINUS } from "../helfer/werte.js";';
const GRENZEN = "export const GRENZEN = Object.freeze({ unten: 0, oben: 1, stufen: [0, 1] });";
const DOPPELT = "export const doppelt = (wert) => wert * 2;";
const GLEICH = "export function gleich(wert) {\n  assert.equal(wert, MINUS);\n}";
const NEGATIV = "export function negativ() {\n  return einordnen(GRENZEN.unten);\n}";
const AUS_NEU = 'import { GRENZEN } from "../gemeinsam/ohne-quelle.js";';
const ALLES_WEITER = 'export * from "../gemeinsam/ohne-quelle.js";';

function datei(...teile) {
  return `${teile.join("\n\n")}\n`;
}

const VORHER = { kopf: [SICHER, QUELLE, WERTE_IN_HILFE], rumpf: [GRENZEN, DOPPELT, GLEICH, NEGATIV] };
const AUSGELAGERT = { kopf: [SICHER, WERTE_IN_NEU], rumpf: [GRENZEN, DOPPELT, GLEICH] };
const NACHHER = { kopf: [QUELLE, AUS_NEU], rumpf: [ALLES_WEITER, NEGATIV] };

function aufgebaut({ kopf, rumpf }) {
  return datei(kopf.join("\n"), ...rumpf);
}

const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "src/zahl.js": 'export function einordnen(zahl) {\n  if (zahl < 0) return "negativ";\n  return "positiv";\n}\n',
  "src/anders.js": "export const ANDERS = 1;\n",
  "test/helfer/werte.js": "export const MINUS = -1;\n",
  "test/zahlen/rest.js": "export const REST = 0;\n",
  "test/zahl.test.js": [
    'import { test } from "node:test";',
    'import { gleich, negativ } from "./helfer/zahl-hilfe.js";',
    'test("negativ", () => gleich(negativ()));',
    "",
  ].join("\n"),
};

async function geprueft(repo, context) {
  const durchlaufen = [];
  const werkzeug = {
    alterStand: () => () => {},
    ueberlebt: ({ status }) => status === "Survived",
    durchgang: async (quelle) => {
      durchlaufen.push(quelle);
      return [];
    },
  };
  const protokoll = context.mock.method(console, "log", () => {});
  const start = cwd();
  chdir(repo);
  try {
    const exitCode = await testumbauPruefung("HEAD", werkzeug);
    return { exitCode, durchlaufen, ausgabe: protokoll.mock.calls.map((aufruf) => String(aufruf.arguments[0])) };
  } finally {
    chdir(start);
  }
}

async function nachAuslagerung(context, { vorher = VORHER, nachher = NACHHER, neu = { [NEU]: aufgebaut(AUSGELAGERT) }, dazu = {}, weg = [] } = {}) {
  const repo = probeRepository(context, { ...BASIS, [HILFE]: aufgebaut(vorher) });
  writeFiles(repo, { [HILFE]: aufgebaut(nachher), ...neu, ...dazu });
  for (const pfad of weg) rmSync(join(repo, pfad));
  return geprueft(repo, context);
}

function erkannt({ exitCode, durchlaufen, ausgabe }) {
  assert.equal(exitCode, 0, ausgabe.join("\n"));
  assert.deepEqual(durchlaufen, [], ausgabe.join("\n"));
  const zeile = ausgabe.find((text) => text.startsWith(ERKANNT));
  assert.ok(zeile, ausgabe.join("\n"));
  return zeile;
}

function vollGerechnet({ durchlaufen, ausgabe }) {
  assert.ok(durchlaufen.includes("src/zahl.js"), ausgabe.join("\n"));
  assert.ok(!ausgabe.some((text) => text.startsWith(ERKANNT)), ausgabe.join("\n"));
}

function mitRumpf(teil, rumpf) {
  return { ...teil, rumpf };
}

function mitKopf(teil, kopf) {
  return { ...teil, kopf };
}

function ausgelagertMit(...rumpf) {
  return { [NEU]: aufgebaut(mitRumpf(AUSGELAGERT, rumpf)) };
}

function verschobenMit(context, anweisung, kopf = []) {
  return nachAuslagerung(context, {
    vorher: { kopf: [...VORHER.kopf, ...kopf], rumpf: [anweisung, ...VORHER.rumpf] },
    neu: { [NEU]: aufgebaut({ kopf: [...AUSGELAGERT.kopf, ...kopf], rumpf: [anweisung, ...AUSGELAGERT.rumpf] }) },
  });
}

test("Reine Auslagerung: eine Hilfe gibt eine Funktion, eine Pfeilfunktion und eine eingefrorene Konstante Wort für Wort an eine neue Hilfe ab und reicht sie mit export * weiter, ohne Testumbau-Mutation", async (context) => {
  const zeile = erkannt(await nachAuslagerung(context));
  assert.ok(zeile.includes(`aus ${HILFE} nach ${NEU}: 3 Anweisungen`), zeile);
});

test("Reine Auslagerung: dieselbe Auslagerung mit benannter Weiterreichung startet keine Testumbau-Mutation", async (context) => {
  const benannt = 'export { GRENZEN, doppelt, gleich } from "../gemeinsam/ohne-quelle.js";';
  erkannt(await nachAuslagerung(context, { nachher: mitRumpf(NACHHER, [benannt, NEGATIV]) }));
});

test("Reine Auslagerung: ein geändertes Literal in einer verschobenen Anweisung führt zur vollen Testumbau-Mutation", async (context) => {
  const geaendert = GRENZEN.replace("oben: 1", "oben: 2");
  vollGerechnet(await nachAuslagerung(context, { neu: ausgelagertMit(geaendert, DOPPELT, GLEICH) }));
});

test("Reine Auslagerung: eine Anweisung, die aus der Hilfe verschwindet und in keiner neuen Hilfe steht, führt zur vollen Testumbau-Mutation", async (context) => {
  const vorher = mitRumpf(VORHER, ["const UNGENUTZT = 1;", ...VORHER.rumpf]);
  vollGerechnet(await nachAuslagerung(context, { vorher }));
});

test("Reine Auslagerung: eine Anweisung, die in der Hilfe bleibt und zugleich am Ende der neuen Hilfe steht, führt zur vollen Testumbau-Mutation", async (context) => {
  const vorher = mitRumpf(VORHER, ["const SCHRITT = 1;", ...VORHER.rumpf]);
  const nachher = mitRumpf(NACHHER, ["const SCHRITT = 1;", ...NACHHER.rumpf]);
  vollGerechnet(await nachAuslagerung(context, { vorher, nachher, neu: ausgelagertMit(GRENZEN, DOPPELT, GLEICH, "const SCHRITT = 1;") }));
});

test("Reine Auslagerung: eine neue Hilfe, die eine Quelldatei unter src/ importiert, die die alte Hilfe nicht importierte, führt zur vollen Testumbau-Mutation", async (context) => {
  const kopf = [...AUSGELAGERT.kopf, 'import { ANDERS } from "../../src/anders.js";'];
  vollGerechnet(await nachAuslagerung(context, { neu: { [NEU]: aufgebaut(mitKopf(AUSGELAGERT, kopf)) } }));
});

test("Reine Auslagerung: eine neue Hilfe, die einen Namen aus derselben Datei unter anderem Namen importiert, führt zur vollen Testumbau-Mutation", async (context) => {
  const kopf = [...AUSGELAGERT.kopf, 'import { einordnen as ordnen } from "../../src/zahl.js";'];
  vollGerechnet(await nachAuslagerung(context, { neu: { [NEU]: aufgebaut(mitKopf(AUSGELAGERT, kopf)) } }));
});

test("Reine Auslagerung: eine neue Hilfe, deren relativer Import am neuen Ort auf eine andere Datei zeigt, führt zur vollen Testumbau-Mutation", async (context) => {
  const dazu = { "test/gemeinsam/werte.js": "export const MINUS = 1;\n" };
  vollGerechnet(await nachAuslagerung(context, { neu: { [NEU]: aufgebaut(mitKopf(AUSGELAGERT, [SICHER, WERTE_IN_HILFE])) }, dazu }));
});

test("Reine Auslagerung: ein verschobener Aufruf auf oberster Ebene führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, 'dns.setDefaultResultOrder("ipv4first");', ['import dns from "node:dns";']));
});

test("Reine Auslagerung: eine verschobene Konstante, die beim Laden eine Funktion aufruft, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, "export const JETZT = Date.now();"));
});

test("Reine Auslagerung: eine verschobene Konstante mit await führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, "export const WERT = await 1;"));
});

test("Reine Auslagerung: eine verschobene Konstante, die beim Destrukturieren einen Vorgabewert aufruft, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, "export const { WERT = Date.now() } = {};"));
});

test("Reine Auslagerung: eine eingefrorene Konstante mit einem Aufruf im Argument führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, "export const ZEIT = Object.freeze({ wert: Date.now() });"));
});

test("Reine Auslagerung: eine verschobene Funktion, die import.meta liest, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, "export function hier() {\n  return import.meta.url;\n}"));
});

test("Reine Auslagerung: eine verschobene Funktion, die __dirname liest, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, "export function hier() {\n  return __dirname;\n}"));
});

test("Reine Auslagerung: eine verschobene Funktion mit dynamischem Import führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, 'export function werte() {\n  return import("./werte.js");\n}'));
});

test("Reine Auslagerung: eine verschobene Funktion mit require führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, 'export function werte() {\n  return require("./werte.js");\n}'));
});

test("Reine Auslagerung: ein exportierter Name der Hilfe, der nicht weitergereicht wird, führt zur vollen Testumbau-Mutation", async (context) => {
  const nurGrenzen = 'export { GRENZEN } from "../gemeinsam/ohne-quelle.js";';
  vollGerechnet(await nachAuslagerung(context, { nachher: mitRumpf(NACHHER, [nurGrenzen, NEGATIV]) }));
});

test("Reine Auslagerung: eine verschobene Funktion, die einen Namen der alten Hilfe ohne eigenen Import nutzt, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await nachAuslagerung(context, { neu: { [NEU]: aufgebaut(mitKopf(AUSGELAGERT, [SICHER])) } }));
});

test("Reine Auslagerung: eine verbliebene Anweisung, die einen verschobenen Namen ohne Import nutzt, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await nachAuslagerung(context, { nachher: mitKopf(NACHHER, [QUELLE]) }));
});

test("Reine Auslagerung: ein zusätzlich geänderter Test führt zur vollen Testumbau-Mutation", async (context) => {
  const geaendert = `${BASIS["test/zahl.test.js"]}test("noch einmal", () => gleich(negativ()));\n`;
  vollGerechnet(await nachAuslagerung(context, { dazu: { "test/zahl.test.js": geaendert } }));
});

test("Reine Auslagerung: eine zweite geänderte Testhilfe neben der Auslagerung führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await nachAuslagerung(context, { dazu: { "test/zahlen/rest.js": "export const REST = 1;\n" } }));
});

test("Reine Auslagerung: eine gelöschte Datei neben der Auslagerung führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await nachAuslagerung(context, { weg: ["test/zahlen/rest.js"] }));
});

test("Reine Auslagerung: eine neue Hilfe, die als Test läuft, führt zur vollen Testumbau-Mutation", async (context) => {
  const alsTest = "test/gemeinsam/ohne-quelle.test.js";
  const nachher = { kopf: [QUELLE, AUS_NEU.replace("ohne-quelle.js", "ohne-quelle.test.js")], rumpf: [ALLES_WEITER.replace("ohne-quelle.js", "ohne-quelle.test.js"), NEGATIV] };
  vollGerechnet(await nachAuslagerung(context, { nachher, neu: { [alsTest]: aufgebaut(AUSGELAGERT) } }));
});

test("Reine Auslagerung: eine neue Hilfe als Symlink führt zur vollen Testumbau-Mutation", async (context) => {
  const repo = probeRepository(context, { ...BASIS, [HILFE]: aufgebaut(VORHER) });
  writeFiles(repo, { [HILFE]: aufgebaut(NACHHER), "node_modules/ausgelagert.js": aufgebaut(AUSGELAGERT) });
  mkdirSync(join(repo, "test/gemeinsam"));
  symlinkSync("../../node_modules/ausgelagert.js", join(repo, NEU));
  vollGerechnet(await geprueft(repo, context));
});

test("Reine Auslagerung: eine alte Hilfe, die nachher einen neuen Import aus src/ bekommt, führt zur vollen Testumbau-Mutation", async (context) => {
  const kopf = [...NACHHER.kopf, 'import { ANDERS } from "../../src/anders.js";'];
  vollGerechnet(await nachAuslagerung(context, { nachher: mitKopf(NACHHER, kopf) }));
});

test("Reine Auslagerung: eine neue Hilfe, die sich nicht lesen lässt, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await nachAuslagerung(context, { neu: { [NEU]: `${aufgebaut(AUSGELAGERT)}export const = ;\n` } }));
});

test("Reine Auslagerung: eine Änderung nur an der Hilfe ohne neue Hilfe führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await nachAuslagerung(context, { nachher: mitKopf(VORHER, [QUELLE, SICHER, WERTE_IN_HILFE]), neu: {} }));
});

test("Reine Auslagerung: eine eingefrorene Konstante mit berechnetem Schlüssel führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, "export const SCHLUESSEL = Object.freeze({ [String(1)]: 1 });"));
});

test("Reine Auslagerung: eine verschobene Konstante mit einem anderen Aufruf an Object führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, "export const VERSIEGELT = Object.seal({ wert: 1 });"));
});

test("Reine Auslagerung: eine eingefrorene Konstante mit einem zweiten Argument führt zur vollen Testumbau-Mutation", async (context) => {
  vollGerechnet(await verschobenMit(context, "export const ZWEI = Object.freeze({ wert: 1 }, Date.now());"));
});

test("Reine Auslagerung: eine neue Hilfe mit einem Import ohne Namen führt zur vollen Testumbau-Mutation", async (context) => {
  const kopf = [...AUSGELAGERT.kopf, 'import "../../src/anders.js";'];
  vollGerechnet(await nachAuslagerung(context, { neu: { [NEU]: aufgebaut(mitKopf(AUSGELAGERT, kopf)) } }));
});

test("Reine Auslagerung: ein Import der Hilfe, den nachher weder die Hilfe noch eine neue Hilfe hat, führt zur vollen Testumbau-Mutation", async (context) => {
  const vorher = mitKopf(VORHER, [...VORHER.kopf, 'import { ANDERS } from "../../src/anders.js";']);
  vollGerechnet(await nachAuslagerung(context, { vorher }));
});

test("Reine Auslagerung: eine Weiterreichung, die zwei verschobene Namen vertauscht, führt zur vollen Testumbau-Mutation", async (context) => {
  const vertauscht = 'export { doppelt as gleich, gleich as doppelt, GRENZEN } from "../gemeinsam/ohne-quelle.js";';
  vollGerechnet(await nachAuslagerung(context, { nachher: mitRumpf(NACHHER, [vertauscht, NEGATIV]) }));
});

test("Reine Auslagerung: ein Import aus der neuen Hilfe unter anderem Namen führt zur vollen Testumbau-Mutation", async (context) => {
  const umbenannt = 'import { doppelt as GRENZEN } from "../gemeinsam/ohne-quelle.js";';
  vollGerechnet(await nachAuslagerung(context, { nachher: mitKopf(NACHHER, [QUELLE, umbenannt]) }));
});

test("Reine Auslagerung: eine neue Hilfe, die die alte Hilfe nicht lädt, nimmt deren Import nicht mit und führt zur vollen Testumbau-Mutation", async (context) => {
  const anders = 'import { ANDERS } from "../../src/anders.js";';
  const ungenutzt = "function anders() {\n  return ANDERS;\n}";
  const vorher = { kopf: [...VORHER.kopf, anders], rumpf: [...VORHER.rumpf, ungenutzt] };
  const neu = { [NEU]: aufgebaut(AUSGELAGERT), "test/gemeinsam/ungeladen.js": aufgebaut({ kopf: ['import { ANDERS } from "../../src/anders.js";'], rumpf: [ungenutzt] }) };
  vollGerechnet(await nachAuslagerung(context, { vorher, neu }));
});
