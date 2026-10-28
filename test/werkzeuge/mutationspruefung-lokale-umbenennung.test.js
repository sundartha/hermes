import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, planAusgabe } from "./mutationspruefung-hilfen.js";
import { commitAll, probeRepository, writeFiles } from "./probe-repo.js";

const ZAHL = "src/zahl.js";
const KEIN_TEIL = /^Plan: keine geänderte Zeile unter src\/ mit Mutanten oder Abschaltung\.$/m;
const ERSTER_TEIL = /^Teil 1 von \d+: src\/zahl\.js/m;
const UMBAU = "Benenne um\n\nWarum: lesbarer.\n\nArt: umbau\nPaket: 1";

const EINORDNEN = [
  "export function einordnen(zahl) {",
  "  const x = zahl;",
  '  const stufen = [[0, "negativ"]];',
  "  function f(s) {",
  "    var grenze = s[0];",
  "    return x < grenze;",
  "  }",
  "  const treffer = stufen.find((s) => f(s));",
  '  return treffer ? treffer[1] : "positiv";',
  "}",
].join("\n");
const SICHER = ["export function sicher(lesen) {", "  try {", "    return lesen();", "  } catch (e) {", "    return e;", "  }", "}"].join("\n");
const PAAR = ["export function paar(a) {", "  return { a };", "}"].join("\n");

function datei(...teile) {
  return `${teile.join("\n\n")}\n`;
}

const VORHER = datei(EINORDNEN, SICHER, PAAR);

function geplant(context, { pfad = ZAHL, vorher = VORHER, nachher, dazu = {} }) {
  const repo = probeRepository(context, { ...BASIS, ...dazu, [pfad]: vorher });
  writeFiles(repo, { [pfad]: nachher });
  commitAll(repo, UMBAU);
  return planAusgabe(context, repo);
}

function erkannt(context, aenderung, namen) {
  const ausgabe = geplant(context, aenderung);
  const zeile = new RegExp(`^src/zahl\\.js: reine Umbenennung, keine Mutanten nötig \\(.+\\): ${namen} Namen\\.$`, "m");
  assert.match(ausgabe, zeile);
  assert.match(ausgabe, KEIN_TEIL);
}

function vollGerechnet(context, aenderung, ersterTeil = ERSTER_TEIL) {
  const ausgabe = geplant(context, aenderung);
  assert.doesNotMatch(ausgabe, /reine Umbenennung/);
  assert.match(ausgabe, ersterTeil);
}

function ersetzt(text, ...paare) {
  return paare.reduce((stand, [alt, neu]) => {
    assert.ok(stand.includes(alt), alt);
    return stand.replaceAll(alt, neu);
  }, text);
}

test("Lokale Umbenennung: ein Parameter einer Pfeilfunktion heißt danach anders; der Plan hat keinen Teil", (context) => {
  erkannt(context, { nachher: ersetzt(VORHER, ["(s) => f(s)", "(stufe) => f(stufe)"]) }, 1);
});

test("Lokale Umbenennung: eine const im Funktionsblock und eine Fangvariable heißen danach anders; der Plan zählt zwei Namen und hat keinen Teil", (context) => {
  const nachher = ersetzt(VORHER, ["const x = zahl;", "const wert = zahl;"], ["return x < grenze;", "return wert < grenze;"], ["catch (e)", "catch (fehler)"], ["return e;", "return fehler;"]);
  erkannt(context, { nachher }, 2);
});

test("Lokale Umbenennung: eine lokale Funktion, die nur aufgerufen wird, heißt danach anders, ihr name ändert sich; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["function f(s)", "function unterGrenze(s)"], ["f(s));", "unterGrenze(s));"]) });
});

test("Lokale Umbenennung: eine Kurzschreibweise wird aufgelöst, der Eigenschaftsname bleibt; der Plan hat keinen Teil", (context) => {
  erkannt(context, { nachher: ersetzt(VORHER, ["paar(a)", "paar(wert)"], ["{ a }", "{ a: wert }"]) }, 1);
});

test("Lokale Umbenennung: der neue Name verdeckt ein äußeres Binding, das in der Funktion gelesen wird; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["function f(s)", "function f(x)"], ["var grenze = s[0];", "var grenze = x[0];"]) });
});

test("Lokale Umbenennung: der neue Name wird von einem inneren Parameter verdeckt; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["const x = zahl;", "const s = zahl;"], ["return x < grenze;", "return s < grenze;"]) });
});

test("Lokale Umbenennung: der neue Name gleicht einer var derselben Funktion; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["function f(s)", "function f(grenze)"], ["var grenze = s[0];", "var grenze = grenze[0];"]) });
});

test("Lokale Umbenennung: nur ein Teil der Fundstellen heißt danach anders; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["const x = zahl;", "const wert = zahl;"]) });
});

test("Lokale Umbenennung: eine exportierte Funktion heißt danach anders; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["export function sicher(", "export function schuetze("]) });
});

test("Lokale Umbenennung: eine Kurzschreibweise ändert mit dem Namen den Eigenschaftsnamen; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["paar(a)", "paar(wert)"], ["{ a }", "{ wert }"]) });
});

test("Lokale Umbenennung: neben der Umbenennung ändert sich eine andere Stelle der Datei; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["(s) => f(s)", "(stufe) => f(stufe)"], ["return lesen();", "return lesen(1);"]) });
});

test("Lokale Umbenennung: die Datei liest arguments; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["return lesen();", "return lesen(arguments.length);"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["(s) => f(s)", "(stufe) => f(stufe)"]) });
});

test("Lokale Umbenennung: eine Funktion wird als Wert weitergegeben und heißt danach anders, ihr name ändert sich; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["(s) => f(s)", "f"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["function f(s)", "function unterGrenze(s)"], ["find(f)", "find(unterGrenze)"]) });
});

test("Lokale Umbenennung: eine Pfeilfunktion bekommt ihren name von der const und heißt danach anders, ihr Wert wird weitergegeben; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["(s) => f(s)", "pruefe"], ["const treffer", "const pruefe = (s) => f(s);\n  const treffer"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["pruefe", "unterGrenze"]) });
});

test("Lokale Umbenennung: eine const hält eine benannte Funktion, deren name nicht von der const kommt, und heißt danach anders; der Plan hat keinen Teil", (context) => {
  const vorher = ersetzt(VORHER, ["(s) => f(s)", "pruefe"], ["const treffer", "const pruefe = function unter(s) {\n    return f(s);\n  };\n  const treffer"]);
  erkannt(context, { vorher, nachher: ersetzt(vorher, ["pruefe", "unterGrenze"]) }, 1);
});

test("Lokale Umbenennung: eine const hält eine Pfeilfunktion, die nur aufgerufen wird, und heißt danach anders, deren name ändert sich; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["(s) => f(s)", "(s) => pruefe(s)"], ["const treffer", "const pruefe = (s) => f(s);\n  const treffer"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["pruefe", "unterGrenze"]) });
});

test("Lokale Umbenennung: eine lokale Klasse heißt danach anders; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["    return e;", "    class Fehler {}\n    return new Fehler(e);"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["Fehler", "Ausnahme"]) });
});

test("Lokale Umbenennung: eine lokale Funktion wird mit new aufgerufen und heißt danach anders; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["    return e;", "    function Fehler() {}\n    return new Fehler(e);"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["Fehler", "Ausnahme"]) });
});

test("Lokale Umbenennung: eine let bekommt später eine Pfeilfunktion zugewiesen, wird weitergegeben und heißt danach anders; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["(s) => f(s)", "pruefe"], ["const treffer", "let pruefe;\n  pruefe = (s) => f(s);\n  const treffer"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["pruefe", "unterGrenze"]) });
});

test("Lokale Umbenennung: ein Parameter hat eine Pfeilfunktion als Standardwert, wird weitergegeben und heißt danach anders; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["sicher(lesen)", "sicher(lesen, melden = (e) => e)"], ["return e;", "return [melden, e];"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["melden", "weitergeben"]) });
});

test("Lokale Umbenennung: neben einer lokalen Umbenennung heißt ein globaler Name anders; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["return lesen();", "return lesen(globalThis);"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["(s) => f(s)", "(stufe) => f(stufe)"], ["globalThis", "global"]) });
});

test("Lokale Umbenennung: neben der Umbenennung fällt der Wert einer Rückgabe weg; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["(s) => f(s)", "(stufe) => f(stufe)"], ["return lesen();", "return;"]) });
});

test("Lokale Umbenennung: nur eine Kurzschreibweise wird aufgelöst, kein Name ändert sich; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["{ a }", "{ a: a }"]) });
});

test("Lokale Umbenennung: die neue Fassung ist nicht lesbar, weil der neue Name schon als const derselben Funktion gebunden ist; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["const x = zahl;", "const stufen = zahl;"], ["return x < grenze;", "return stufen < grenze;"]) });
});

test("Lokale Umbenennung: eine CommonJS-Datei benennt einen lokalen Namen um; der Plan rechnet die Datei", (context) => {
  const pfad = "src/zahl.cjs";
  const vorher = 'function einordnen(zahl) {\n  const x = zahl;\n  return x < 0 ? "negativ" : "positiv";\n}\nmodule.exports = { einordnen };\n';
  const nutzung = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport zahl from "../src/zahl.cjs";\ntest("cjs", () => {\n  assert.equal(zahl.einordnen(-1), "negativ");\n});\n';
  vollGerechnet(context, { pfad, vorher, nachher: ersetzt(vorher, ["const x", "const wert"], ["return x", "return wert"]), dazu: { "test/zahl-cjs.test.js": nutzung } }, /^Teil 1 von \d+: src\/zahl\.cjs/m);
});

test("Lokale Umbenennung: eine const hält einen anonymen Funktionsausdruck, wird weitergegeben und heißt danach anders; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["(s) => f(s)", "pruefe"], ["const treffer", "const pruefe = function (s) {\n    return f(s);\n  };\n  const treffer"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["pruefe", "unterGrenze"]) });
});

test("Lokale Umbenennung: eine const hält einen anonymen Klassenausdruck und heißt danach anders; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["    return e;", "    const Fehler = class {};\n    return new Fehler(e);"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["Fehler", "Ausnahme"]) });
});

test("Lokale Umbenennung: neben der Umbenennung bekommt eine leere Rückgabe einen Wert; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["return lesen();", "lesen();\n    return;"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["(s) => f(s)", "(stufe) => f(stufe)"], ["return;", "return lesen;"]) });
});

test("Lokale Umbenennung: eine const heißt danach anders, ihre Lesestelle nennt aber einen eingebauten globalen Namen; der Plan rechnet die Datei", (context) => {
  vollGerechnet(context, { nachher: ersetzt(VORHER, ["const x = zahl;", "const wert = zahl;"], ["return x < grenze;", "return Number < grenze;"]) });
});

test("Lokale Umbenennung: ein benannter Funktionsausdruck wird zurückgegeben und heißt danach anders, sein name ändert sich; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["    return e;", "    return function f() {\n      return e;\n    };"]);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["function f()", "function fehlerLesen()"]) });
});

test("Lokale Umbenennung: die Datei ruft eval auf; der Plan rechnet die Datei", (context) => {
  const vorher = ersetzt(VORHER, ["return lesen();", 'return lesen(eval("1"));']);
  vollGerechnet(context, { vorher, nachher: ersetzt(vorher, ["(s) => f(s)", "(stufe) => f(stufe)"]) });
});

test("Lokale Umbenennung: eine nicht exportierte Konstante auf oberster Ebene heißt danach anders; der Plan rechnet die Datei", (context) => {
  const vorher = `const NULLPUNKT = 0;\n\n${ersetzt(VORHER, ["[[0, ", "[[NULLPUNKT, "])}`;
  vollGerechnet(context, { vorher, nachher: vorher.replaceAll("NULLPUNKT", "GRENZE") });
});
