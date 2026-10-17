import assert from "node:assert/strict";
import { test } from "node:test";

import { zusicherungenGleich } from "../../tools/auftrag/testtitel.mjs";

const KOPF = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { versende } from "../src/versand.js";\n';
const ROUTE = "  const route = { kunde: KUNDE, protokoll: () => {} };\n";
const SETUP = "async function setup(t) {";
const FALL = 'test("versendet den Code", async (t) => {\n  const ctx = await setup(t);\n  assert.equal(ctx.senden(), true);\n});\n';
const PRUEFHILFE = "function pruefe(wert) {\n  assert.ok(wert);\n}\n";
const ZUSATZ = "  const extra = 1;\n";

function datei({ oben = "", rumpf = ROUTE, kopf = SETUP } = {}) {
  return `${KOPF}${oben}const KUNDE = {};\n${PRUEFHILFE}${kopf}\n${rumpf}  return { senden: () => versende(route.kunde) };\n}\n${FALL}`;
}

function mitImport(zeile) {
  return datei({ oben: `${zeile}\n` });
}

function ergebnisse(faelle) {
  return [...faelle].map(([name, [alt, neu]]) => [name, zusicherungenGleich(alt, neu)]);
}

function erwartet(faelle) {
  return [...faelle].map(([name, [, , wert]]) => [name, wert]);
}

test("Hilfen im Vorbau: eine Hilfe ohne Zusicherung darf ihren Rumpf ändern und ein neues await import nutzen, wenn Name und Parameter bleiben", () => {
  const a2 = datei({
    oben: 'const { pruefeGates } = await import("../src/gates.js");\n',
    rumpf: `${ROUTE}  const gates = pruefeGates(KUNDE);\n  route.kunde = { ...KUNDE, gates };\n`,
  });
  const pfeil = (wert) => `${KOPF}const kunde = () => ({ ${wert} });\ntest("a", () => assert.equal(versende(kunde()), true));\n`;
  const faelle = new Map([
    ["Muster a2", [datei(), a2, true]],
    ["nur Rumpf", [datei(), datei({ rumpf: ROUTE + ZUSATZ }), true]],
    ["Paket", [datei(), mitImport('const { default: express } = await import("express");'), true]],
    ["Pfeil-Hilfe", [pfeil(""), pfeil("gates: true"), true]],
    ["Parameter", [datei(), datei({ kopf: "async function setup(t, extra) {" }), false]],
    ["ohne async", [datei(), datei({ kopf: "function setup(t) {" }), false]],
  ]);
  assert.deepEqual(ergebnisse(faelle), erwartet(faelle));
});

test("Hilfen im Vorbau: eine geänderte Hilfe mit Zusicherung, Attrappe, Umweg oder fremder Veränderung und eine Hilfe, die direkt in einer Zusicherung steht oder eine Testoption speist, zählen als Änderung", () => {
  const mitZeile = (zeile) => datei({ rumpf: `${ROUTE}${zeile}` });
  const zusaetzlich = (zeile) => [mitZeile(zeile), mitZeile(`${zeile}${ZUSATZ}`), false];
  const direkt = (wert) => `${KOPF}function soll() {\n  return ${wert};\n}\ntest("a", () => assert.equal(versende({}), soll()));\n`;
  const option = (wert) => `${KOPF}function aus() {\n  return ${wert};\n}\nconst OPTIONEN = { skip: aus() };\ntest("a", OPTIONEN, () => assert.equal(versende({}), true));\n`;
  const faelle = new Map([
    ["assert im Rumpf", zusaetzlich("  assert.ok(route);\n")],
    ["Prüfhilfe im Rumpf", zusaetzlich("  pruefe(route);\n")],
    ["t.mock.method", [datei(), mitZeile('  t.mock.method(route, "protokoll", () => {});\n'), false]],
    ["Attrappe für assert", [datei(), mitZeile("  assert.equal = () => {};\n"), false]],
    ["console ersetzt", [datei(), mitZeile("  console = { log() {} };\n"), false]],
    ["importiertes Objekt", zusaetzlich('  versende.modus = "alt";\n')],
    ["Object.assign", [mitZeile("  Object.assign(route, { a: 1 });\n"), mitZeile("  Object.assign(console, { log() {} });\n"), false]],
    ["Erwartungshilfe", [direkt("true"), direkt("versende({})"), false]],
    ["Hilfe einer Testoption", [option("false"), option("true"), false]],
    ["berechneter Zugriff", [datei(), mitZeile('  t["mock"].method(route, "protokoll", () => {});\n'), false]],
    ["berechneter Schlüssel", [datei(), mitZeile('  const { ["mock"]: attrappe } = t;\n'), false]],
    ["Schlüssel als Text", [datei(), mitZeile('  const { "mock": attrappe } = t;\n'), false]],
    ["t.skip", [datei(), mitZeile("  t.skip();\n"), false]],
    ["t.todo", [datei(), mitZeile("  t.todo();\n"), false]],
    ["t.plan", [datei(), mitZeile("  t.plan(1);\n"), false]],
  ]);
  assert.deepEqual(ergebnisse(faelle), erwartet(faelle));
});

test("Hilfen im Vorbau: eine geänderte Hilfe verändert nur Eigenschaften eines eigenen Literals oben im Rumpf, das kein anderer Name derselben Hilfe verdeckt, liest und ruft Methoden nur daran und gibt ihnen nur solche Literale mit", () => {
  const mitZeilen = (zeilen) => datei({ rumpf: `${ROUTE}${zeilen}` });
  const vorUndNach = (zeilen) => [mitZeilen(zeilen), mitZeilen(`${zeilen}${ZUSATZ}`), false];
  const faelle = new Map([
    ["eigenes Literal", [datei(), mitZeilen("  route.extra = [];\n  const liste = [];\n  liste.length = 0;\n"), true]],
    ["fremdes Objekt im Literal", vorUndNach('  const halter = { ziel: versende };\n  halter.ziel.modus = "alt";\n')],
    ["Name neu belegt", vorUndNach('  let x;\n  x = versende;\n  x.modus = "alt";\n')],
    ["Literal im Block", vorUndNach('  {\n    const versende = {};\n  }\n  versende.modus = "alt";\n')],
    ["verdeckt im Block", vorUndNach('  {\n    const route = versende;\n    route.modus = "alt";\n  }\n')],
    ["verdeckt als Parameter", vorUndNach('  [versende].forEach((route) => {\n    route.modus = "alt";\n  });\n')],
    ["verdeckt in catch", vorUndNach('  try {\n    throw versende;\n  } catch (route) {\n    route.modus = "alt";\n  }\n')],
    ["Methode an fremdem Array", [datei({ oben: "const LISTE = [];\n" }), datei({ oben: "const LISTE = [];\n", rumpf: `${ROUTE}  LISTE.push(1);\n` }), false]],
  ]);
  const LISTE = "const LISTE = [];\n";
  for (const [name, zeile] of [
    ["Methode als Wert", "  [0].forEach(LISTE.pop, LISTE);\n"],
    ["Methode des Testkontexts als Wert", "  [() => {}].forEach(t.after, t);\n"],
  ])
    faelle.set(name, [datei({ oben: LISTE }), datei({ oben: LISTE, rumpf: ROUTE + zeile }), false]);
  const behaelter = (zeilen) =>
    `${KOPF}function setup(ziel) {\n  const halter = [];\n${zeilen}  return halter;\n}\ntest("a", () => {\n  const soll = [1];\n  setup(soll);\n  assert.deepEqual(versende(), soll);\n});\n`;
  faelle.set("Parameter in eigenen Behälter", [behaelter(""), behaelter("  halter.push(ziel);\n"), false]);
  faelle.set("Parameter über eigenen Behälter", [behaelter(""), behaelter("  halter.push(ziel);\n  const kopie = halter.pop();\n  [0].forEach(kopie.pop, kopie);\n"), false]);
  assert.deepEqual(ergebnisse(faelle), erwartet(faelle));
});

test("Hilfen im Vorbau: eine geänderte Hilfe nennt keinen Namen, den eine Zusicherung über Herkunft, Konstanten oder Funktionen erreicht, und ruft Methoden nur an eigenen Literalen auf", () => {
  const OBEN = "const ERWARTET = [1];\nconst ALLE = [ERWARTET];\nfunction hole() {\n  return ERWARTET;\n}\n";
  const PRUEFUNG = 'test("a", async () => {\n  const ctx = await setup();\n  const soll = ERWARTET;\n  assert.deepEqual(ctx.werte, soll);\n});\n';
  const erreichbar = (zeile) => `${KOPF}${OBEN}function setup() {\n  const route = { werte: [1] };\n${zeile}  return route;\n}\n${PRUEFUNG}`;
  const faelle = new Map(
    [
      ["eigenes Literal", "  route.werte = [1];\n", true],
      ["Erwartung über Herkunft", "  ERWARTET.splice(0);\n", false],
      ["Konstante mit Erwartung", "  ALLE.at(0).splice(0);\n", false],
      ["Funktion mit Erwartung", "  hole().splice(0);\n", false],
    ].map(([name, zeile, wert]) => [name, [erreichbar(""), erreichbar(zeile), wert]]),
  );
  const mitAlias = (kopf, zeile) => erreichbar(zeile).replace(OBEN, `${kopf}\n${OBEN}`);
  const STATISCH = 'import { ERWARTET as kopie } from "../src/daten.js";';
  const DYNAMISCH = 'const { default: daten } = await import("../src/daten.js");';
  for (const [name, kopf, zeile, wert] of [
    ["statischer Alias aufgerufen", STATISCH, "  kopie();\n", true],
    ["statischer Alias als Objekt", STATISCH, "  kopie.splice(0);\n", false],
    ["statischer Alias als Argument", STATISCH, "  [].splice.call(kopie, 0);\n", false],
    ["dynamischer Import als Objekt", DYNAMISCH, "  daten.ERWARTET.splice(0);\n", false],
  ])
    faelle.set(name, [erreichbar(""), mitAlias(kopf, zeile), wert]);
  const ueberFunktion = (zeile) => erreichbar(zeile).replace("assert.deepEqual(ctx.werte, soll)", "assert.deepEqual(ctx.werte, hole())");
  for (const [name, zeile, wert] of [
    ["Methode am eigenen Literal", "  const liste = [1];\n  liste.push(2);\n  route.werte = liste;\n", true],
    ["Methode an der Erwartung einer Funktion", "  ERWARTET.splice(0);\n", false],
    ["Erwartung einer Funktion als Argument", "  versende(ERWARTET);\n", false],
  ])
    faelle.set(name, [ueberFunktion(""), ueberFunktion(zeile), wert]);
  const ueberAufruf = (zeile) => erreichbar(zeile).replace("assert.deepEqual(ctx.werte, soll)", "assert.deepEqual(ctx.werte, Array.from(hole()))");
  faelle.set("Erwartung als Argument eines Aufrufs in der Zusicherung", [ueberAufruf(""), ueberAufruf("  versende(ERWARTET);\n"), false]);
  assert.deepEqual(ergebnisse(faelle), erwartet(faelle));
});

test("Hilfen im Vorbau: was eine geänderte Hilfe oben in der Datei aufruft oder nennt, muss dieselben Bedingungen erfüllen", () => {
  const mitOben = (oben, zeile) => datei({ oben, rumpf: `${ROUTE}${zeile}` });
  const ERSETZE = 'function ersetze(ziel) {\n  mock.method(ziel, "protokoll", () => {});\n}\n';
  const SPAETER = 'let ersetze;\nersetze = (ziel) => mock.method(ziel, "protokoll", () => {});\n';
  const SCHARF = 'let ersetze = () => {};\nfunction scharf() {\n  ersetze = (ziel) => mock.method(ziel, "protokoll", () => {});\n}\n';
  const faelle = new Map([
    ["harmlose neue Hilfe", [datei(), mitOben("function leer() {\n  return {};\n}\n", "  route.extra = leer();\n"), true]],
    ["rekursive Hilfe", [datei(), mitOben("function zaehle(n) {\n  return n > 0 ? zaehle(n - 1) : 0;\n}\n", "  route.extra = zaehle(2);\n"), true]],
    ["Name ohne Wert", [mitOben("let ZAEHLER;\n", ""), mitOben("let ZAEHLER;\n", "  route.extra = ZAEHLER;\n"), true]],
    ["neue Hilfe mit Attrappe", [datei(), mitOben(ERSETZE, "  ersetze(route);\n"), false]],
    ["über eine weitere Hilfe", [datei(), mitOben(`${ERSETZE}function weiter(ziel) {\n  ersetze(ziel);\n}\n`, "  weiter(route);\n"), false]],
    ["über eine Konstante", [datei(), mitOben('const TABELLE = { ersetze: (ziel) => mock.method(ziel, "protokoll", () => {}) };\n', "  TABELLE.ersetze(route);\n"), false]],
    ["bestehende Prüfhilfe", [datei(), mitOben("", "  pruefe(route);\n"), false]],
    ["später belegter Name", [mitOben(SPAETER, ""), mitOben(SPAETER, "  ersetze(route);\n"), false]],
    ["in einer Funktion neu belegter Name", [mitOben(SCHARF, ""), mitOben(SCHARF, "  ersetze(route);\n"), false]],
  ]);
  assert.deepEqual(ergebnisse(faelle), erwartet(faelle));
});

test("Hilfen im Vorbau: ein neues await import zählt als Änderung, wenn es Testbibliothek, eingebautes Modul, absoluten Pfad, Optionen, berechnete Namen, Vorgaben oder bestehende Namen trägt", () => {
  const faelle = new Map(
    [
      ["node:assert", 'const { equal } = await import("node:assert");'],
      ["eingebautes Modul", 'const { strict } = await import("assert");'],
      ["Testbibliothek als Paket", 'const { describe } = await import("test");'],
      ["absoluter Pfad", 'const { wert } = await import("/liste.js");'],
      ["ohne await", 'const { wert } = import("./liste.js");'],
      ["Optionen", 'const { wert } = await import("./liste.js", { with: { type: "json" } });'],
      ["Vorlage", 'const { wert } = await import(`./${"liste"}.js`);'],
      ["berechneter Name", 'const { [versende({})]: wert } = await import("./liste.js");'],
      ["Vorgabe", 'const { wert = versende({}) } = await import("./liste.js");'],
      ["mock", 'const { mock } = await import("./liste.js");'],
      ["let", 'let { wert } = await import("./liste.js");'],
      ["zweite Belegung", 'const { wert } = await import("./liste.js"), LAUF = Date.now();'],
      ["bestehender Name", 'const { KUNDE: kunde, route } = await import("./liste.js");'],
    ].map(([name, zeile]) => [name, [datei(), mitImport(zeile), false]]),
  );
  assert.deepEqual(ergebnisse(faelle), erwartet(faelle));
});

test("Hilfen im Vorbau: eine geänderte Hilfe nutzt nur zugelassene Formen, Namen der Datei oder des eigenen Geltungsbereichs, Importe aus src und Parameter als Argument oder Operand; alles andere zählt als Änderung", () => {
  const NACH = 'import { after } from "node:test";\n';
  const faelle = new Map(
    [
      ["Parameter als Argument", "  route.extra = [1].map((eintrag) => versende(`${eintrag}`));\n", true],
      ["Parameter als Objekt", "  route.extra = [1].map((eintrag) => eintrag.wert);\n", false],
      ["Parameter verdeckt eigenen Namen", "  const eintrag = [];\n  route.extra = [1].map((eintrag) => eintrag.wert);\n", false],
      ["globaler Name", "  route.extra = structuredClone(KUNDE);\n", false],
      ["Schleife", "  for (const eintrag of [1]) route.extra = eintrag;\n", false],
      ["this", "  route.extra = this;\n", false],
      ["Getter", "  const ziel = { get kunde() {\n    return KUNDE;\n  } };\n", false],
      ["optionale Kette", "  route.extra = route?.kunde;\n", false],
      ["Klasse", "  class Ersatz {}\n  route.extra = new Ersatz();\n", false],
      ["innerer Name", "  const zaehle = () => {\n    const n = 1;\n    return n;\n  };\n  route.extra = zaehle();\n", true],
      ["globaler Name im Block verdeckt", "  {\n    const structuredClone = 0;\n  }\n  route.extra = structuredClone(KUNDE);\n", false],
      ["globaler Name in innerer Funktion belegt", "  const f = () => {\n    const structuredClone = 0;\n    return structuredClone;\n  };\n  route.extra = structuredClone(KUNDE);\n", false],
      ["globaler Name vor innerer Funktion belegt", "  route.extra = structuredClone(KUNDE);\n  const f = () => {\n    const structuredClone = 0;\n    return structuredClone;\n  };\n", false],
      ["globaler Name als innerer Parameter", "  const g = (structuredClone) => versende(structuredClone);\n  route.extra = structuredClone(KUNDE);\n", false],
    ].map(([name, zeile, wert]) => [name, [datei(), datei({ rumpf: ROUTE + zeile }), wert]]),
  );
  faelle.set("Testbibliothek", [datei({ oben: NACH }), datei({ oben: NACH, rumpf: `${ROUTE}  after(() => {});\n` }), false]);
  for (const [name, zeile] of [
    ["Paket", 'import { stub } from "sinon";'],
    ["Paket aus await import", 'const { stub } = await import("sinon");'],
    ["Paket über relativen Pfad", 'import { stub } from "../node_modules/sinon/pkg/sinon-esm.js";'],
    ["Testhilfe neben dem Test", 'import { stub } from "./attrappen.js";'],
    ["Pfad aus src heraus", 'import { stub } from "../src/../test/attrappen.js";'],
    ["Paket namens src", 'import { stub } from "src/attrappen.js";'],
    ["src unter anderem Ordner", 'import { stub } from "../test/src/attrappen.js";'],
    ["Ordner statt Datei", 'import { stub } from "../src/..";'],
  ])
    faelle.set(name, [datei({ oben: `${zeile}\n` }), datei({ oben: `${zeile}\n`, rumpf: `${ROUTE}  stub(route, "protokoll");\n` }), false]);
  const SINON = 'import { stub } from "sinon";\n';
  for (const [name, zeilen] of [
    ["Paket im Block verdeckt", "  {\n    const stub = 0;\n  }\n"],
    ["Paket in innerer Funktion verdeckt", "  const f = () => {\n    const stub = 0;\n    return stub;\n  };\n"],
  ])
    faelle.set(name, [datei({ oben: SINON }), datei({ oben: SINON, rumpf: `${ROUTE}${zeilen}  stub(route, "protokoll");\n` }), false]);
  assert.deepEqual(ergebnisse(faelle), erwartet(faelle));
});

test("Hilfen im Vorbau: eine Hilfe, die eine Zusicherung über Konstanten, Aufrufe oder Funktionen erreicht, bleibt fest; nur das erste Argument eines Vergleichs gibt sie über eine Variable im Testfall frei", () => {
  const AUFBAU = 'async function setup() {\n  return { x: 1 };\n}\ntest("a", async () => {\n  const ctx = await setup();\n';
  const mitHilfe = (name, oben, fall) => (rumpf) => `${KOPF}function ${name}() {\n${rumpf}}\n${oben}${fall}`;
  const imFall = (zeilen) => mitHilfe("setup", "", `test("a", async () => {\n  const ctx = await setup();\n${zeilen}});\n`);
  const faelle = new Map(
    [
      ["Ist-Seite über Variable", imFall("  assert.equal(ctx.x, 1);\n"), true],
      ["Ist-Seite über Zuweisung", mitHilfe("setup", "", 'test("a", async () => {\n  let ctx;\n  ctx = await setup();\n  assert.equal(ctx.x, 1);\n});\n'), true],
      ["Soll-Seite über Zuweisung", mitHilfe("setup", "", 'test("a", async () => {\n  let ctx;\n  ctx = await setup();\n  assert.equal(ctx.x, ctx.y);\n});\n'), false],
      ["Konstante der Erwartung", mitHilfe("soll", "const ERWARTET = soll();\n", 'test("a", () => assert.equal(versende({}), ERWARTET));\n'), false],
      ["Pfeilfunktion der Erwartung", mitHilfe("soll", "const erwartung = () => soll();\n", 'test("a", () => assert.equal(versende({}), erwartung()));\n'), false],
      ["Erwartung im ersten Argument", mitHilfe("berechne", AUFBAU, "  const soll = berechne();\n  assert.ok(ctx.x === soll);\n});\n"), false],
      ["ein Argument", imFall("  assert.ok(ctx.x);\n"), false],
      ["beide Seiten", imFall("  assert.equal(ctx.x, (await setup()).x);\n"), false],
      ["Ist-Seite über Konstante oben", mitHilfe("setup", "const ERG = setup();\n", 'test("a", () => assert.equal(ERG.x, 1));\n'), false],
      ["match", imFall("  assert.match(ctx.x, /1/);\n"), false],
      ["Hilfe im zweiten Argument", imFall("  assert.equal(1, ctx.x);\n"), false],
      ["lokale Funktion im Testfall", mitHilfe("soll", "", 'test("a", () => {\n  const erzeuge = () => soll();\n  const ctx = erzeuge();\n  assert.equal(ctx.x, 1);\n});\n'), false],
      ["Vergleich mit einem Argument", imFall("  assert.equal(ctx.x);\n"), false],
      ["Erwartung als Argument eines Aufrufs", mitHilfe("soll", "", 'test("a", () => assert.equal(versende({}), Number(soll())));\n'), false],
      ["Ist-Seite als Argument eines Aufrufs", imFall("  assert.equal(Number(ctx.x), 1);\n"), true],
      ["Erwartung über Eigenschaft", mitHilfe("soll", "const erwartung = {};\nerwartung.wert = soll();\n", 'test("a", () => assert.equal(versende({}), erwartung.wert));\n'), false],
      ["Erwartung über berechnete Eigenschaft", mitHilfe("soll", 'const erwartung = {};\nerwartung["wert"] = soll();\n', 'test("a", () => assert.equal(versende({}), erwartung));\n'), false],
      ["einstellig über Eigenschaft", mitHilfe("soll", "const erwartung = {};\nerwartung.wert = soll();\n", 'test("a", () => assert.ok(erwartung.wert));\n'), false],
      ["Ist-Seite über Eigenschaft im Testfall", imFall("  const ziel = {};\n  ziel.x = await setup();\n  assert.equal(ziel.x, 1);\n"), false],
    ].map(([name, datei, wert]) => [name, [datei("  return { x: 1 };\n"), datei("  return { x: 2 };\n"), wert]]),
  );
  assert.deepEqual(ergebnisse(faelle), erwartet(faelle));
});
