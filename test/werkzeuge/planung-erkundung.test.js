import assert from "node:assert/strict";
import { test } from "node:test";

import { ANGABEN, PLATZHALTER, berichtsGeruest, erkundungBefunde } from "../../tools/auftrag/planung/erkundung.mjs";
import { probeDirectory } from "./probe-repo.js";

const EINGANG = [
  "export function registriere(router) {",
  '  router.post("/api/probe", function nimmAn(anfrage) {',
  "    const kopie = anfrage;",
  "    return kopie;",
  "  });",
  "}",
  "",
].join("\n");
const LOGIK = ["export function rechne(wert) {", "  const doppelt = wert * 2;", "  return doppelt + 1;", "}", ""].join("\n");
const GESCHUETZT = ["export function schuetze() {", "  return 1;", "}", ""].join("\n");
const WENN_ROUTE = "Gegeben ein Kunde\nWenn er über `POST /api/probe` sendet\nDann kommt eine Antwort";

function ordner(context) {
  return probeDirectory(context, {
    "src/eingang.js": EINGANG,
    "src/logik.js": LOGIK,
    "src/geschuetzt.js": GESCHUETZT,
    ".github/CODEOWNERS": "/src/geschuetzt.js @owner\n",
    "test/vorhanden.test.js": "",
  });
}

function sollMitText(text = WENN_ROUTE) {
  return new Map([
    ["S1", { text }],
    ["B1", { text: "Gegeben ein Kunde\nWenn er etwas tut\nDann passiert nichts" }],
    ["T1", { text }],
  ]);
}

const EINGANGS_STELLE = { rolle: "eingang", datei: "src/eingang.js", funktion: "nimmAn", von: 2, bis: 4 };
const WIRKUNGS_STELLE = { rolle: "wirkung", datei: "src/logik.js", funktion: "rechne", von: 2, bis: 3 };
const AENDERUNG = { datei: "src/logik.js", funktion: "rechne", von: 2, bis: 3, neueZeilen: 3 };

function angaben(ueberschrieben = {}) {
  return {
    weg: [EINGANGS_STELLE, WIRKUNGS_STELLE],
    aenderungen: [AENDERUNG],
    tests: ["test/vorhanden.test.js"],
    schema: { aenderung: false, fundstelle: "src/logik.js Zeile 1" },
    codeowners: [],
    ownerEntscheidung: { fundstelle: ".github/CODEOWNERS", text: "keine geschützte Datei betroffen" },
    eingangImTest: "erreichbar",
    widersprueche: [],
    ...ueberschrieben,
  };
}

function lauf(context, nummern, { gruppe = ["S1"], soll = sollMitText() } = {}) {
  return erkundungBefunde({ nummern }, { gruppe, soll, root: ordner(context) });
}

function einzeln(context, ueberschrieben, optionen) {
  return lauf(context, { S1: angaben(ueberschrieben) }, optionen);
}

function genau(befunde, teil) {
  assert.equal(befunde.length, 1, befunde.join("\n"));
  assert.ok(befunde[0].includes(teil), befunde[0]);
}

test("ein vollständiger Bericht hat keine Befunde und keine Annahmen", (context) => {
  const { befunde, annahmen } = einzeln(context, {});
  assert.deepEqual(befunde, []);
  assert.deepEqual(annahmen, []);
});

test("alle Auswege „nicht gefunden, weil …“ sind grün und stehen in den Annahmen", (context) => {
  const { befunde, annahmen } = einzeln(context, {
    tests: "nicht gefunden, weil es keinen Test gibt",
    weg: [EINGANGS_STELLE, { rolle: "wirkung", ausweg: "nicht gefunden, weil die Wirkung außerhalb liegt" }],
    aenderungen: "keine Änderung, weil nur gelesen wird",
    eingangImTest: "nicht erreichbar, weil der Eingang nur im Betrieb läuft",
    ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist",
  });
  assert.deepEqual(befunde, []);
  assert.deepEqual(annahmen, [
    { nummer: "S1", angabe: "weg wirkung", text: "nicht gefunden, weil die Wirkung außerhalb liegt" },
    { nummer: "S1", angabe: "aenderungen", text: "keine Änderung, weil nur gelesen wird" },
    { nummer: "S1", angabe: "tests", text: "nicht gefunden, weil es keinen Test gibt" },
    { nummer: "S1", angabe: "ownerEntscheidung", text: "keine, weil keine geschützte Datei betroffen ist" },
    { nummer: "S1", angabe: "eingangImTest", text: "nicht erreichbar, weil der Eingang nur im Betrieb läuft" },
  ]);
});

test("eine Weg-Stelle mit fehlender Datei ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { weg: [EINGANGS_STELLE, { ...WIRKUNGS_STELLE, datei: "src/fehlt.js" }] });
  genau(befunde, "Datei src/fehlt.js fehlt");
});

test("eine Funktion, die in der Datei fehlt, ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { weg: [EINGANGS_STELLE, { ...WIRKUNGS_STELLE, funktion: "gibtEsNicht" }] });
  genau(befunde, "Funktion gibtEsNicht fehlt in src/logik.js");
});

test("Zeilen außerhalb der Funktion sind ein Befund", (context) => {
  const { befunde } = einzeln(context, { weg: [EINGANGS_STELLE, { ...WIRKUNGS_STELLE, von: 2, bis: 40 }] });
  genau(befunde, "liegen nicht in der Funktion");
});

test("ein Test, der fehlt, ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { tests: ["test/fehlt.test.js"] });
  genau(befunde, "Test test/fehlt.test.js fehlt");
});

test("eine leere Testliste ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { tests: [] });
  genau(befunde, "tests ist leer");
});

test("eine fehlende Nummer der Gruppe ist ein Befund", (context) => {
  const { befunde } = lauf(context, { S1: angaben() }, { gruppe: ["S1", "B1"] });
  assert.deepEqual(befunde, ["B1: Nummer der Gruppe fehlt im Bericht"]);
});

test("eine Nummer außerhalb der Gruppe ist ein Befund", (context) => {
  const { befunde } = lauf(context, { S1: angaben(), T1: angaben() });
  genau(befunde, "T1: gehört nicht zur Gruppe S1");
});

test("ein Weg ohne Eingang und ohne Ausweg ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { weg: [WIRKUNGS_STELLE] });
  assert.deepEqual(befunde, ["S1: Weg ohne Stelle mit Rolle eingang und ohne Ausweg"]);
});

test("ein Weg ohne Wirkung und ohne Ausweg ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { weg: [EINGANGS_STELLE] });
  assert.deepEqual(befunde, ["S1: Weg ohne Stelle mit Rolle wirkung und ohne Ausweg"]);
});

test("ein Name aus dem Wenn, der in keiner Eingangsdatei steht, ist ein Befund", (context) => {
  const soll = sollMitText("Gegeben ein Kunde\nWenn der Agent `place_call` aufruft\nDann kommt eine Antwort");
  const { befunde } = einzeln(context, {}, { soll });
  genau(befunde, "`place_call` aus dem Wenn steht in keiner gemeldeten Eingangsdatei");
});

test("eine Route aus dem Wenn wird über ihren Pfad in der Eingangsdatei gefunden", (context) => {
  const { befunde } = einzeln(context, {});
  assert.deepEqual(befunde, []);
});

test("eine S-Nummer ohne Änderungsstelle und ohne Ausweg ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { aenderungen: [] });
  genau(befunde, "ohne Änderungsstelle und ohne „keine Änderung, weil …“");
});

test("eine T-Nummer ohne Änderungsstelle und ohne Ausweg ist ein Befund", (context) => {
  const { befunde } = lauf(context, { T1: angaben({ aenderungen: [] }) }, { gruppe: ["T1"] });
  genau(befunde, "T1: ohne Änderungsstelle und ohne „keine Änderung, weil …“");
});

test("eine B-Nummer darf ohne Änderungsstelle bleiben", (context) => {
  const { befunde } = lauf(context, { B1: angaben({ aenderungen: [] }) }, { gruppe: ["B1"] });
  assert.deepEqual(befunde, []);
});

test("eine fehlende Angabe ist ein Befund, auch wenn nur das Feld fehlt", (context) => {
  const { schema, ...ohneSchema } = angaben();
  assert.equal(schema.aenderung, false);
  const { befunde } = lauf(context, { S1: ohneSchema });
  assert.deepEqual(befunde, ["S1: Angabe schema fehlt"]);
});

test("ein leeres Feld ist kein Ausweg", (context) => {
  const { befunde, annahmen } = einzeln(context, { eingangImTest: "  " });
  assert.equal(befunde.length, 1);
  assert.deepEqual(annahmen, []);
});

test("ein Ausweg ohne Grund ist ein Befund und keine Annahme", (context) => {
  const { befunde, annahmen } = einzeln(context, { tests: "nicht gefunden, weil " });
  genau(befunde, "ohne Grund");
  assert.deepEqual(annahmen, []);
});

test("ein Ausweg, der für die Angabe nicht gilt, ist ein Befund und keine Annahme", (context) => {
  const { befunde, annahmen } = einzeln(context, { tests: "keine, weil es egal ist" });
  genau(befunde, "kein Ausweg");
  assert.deepEqual(annahmen, []);
});

test("eine geschützte Änderungsdatei, die unter codeowners fehlt, ist ein Befund", (context) => {
  const geschuetzt = { datei: "src/geschuetzt.js", funktion: "schuetze", von: 1, bis: 3, neueZeilen: 1 };
  const { befunde } = einzeln(context, { aenderungen: [geschuetzt] });
  genau(befunde, "Änderungsdatei src/geschuetzt.js steht in CODEOWNERS, fehlt unter codeowners");
});

test("eine geschützte Änderungsdatei unter codeowners ist grün", (context) => {
  const geschuetzt = { datei: "src/geschuetzt.js", funktion: "schuetze", von: 1, bis: 3, neueZeilen: 1 };
  const { befunde } = einzeln(context, { aenderungen: [geschuetzt], codeowners: ["src/geschuetzt.js"] });
  assert.deepEqual(befunde, []);
});

test("eine Datei unter codeowners, die nicht in CODEOWNERS steht, ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { codeowners: ["src/logik.js"] });
  genau(befunde, "codeowners nennt src/logik.js, das nicht in CODEOWNERS steht");
});

test("eine neue Datei ohne Suche nach vorhandener Logik ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { aenderungen: [{ datei: "src/neu.js", neu: "datei", neueZeilen: 10 }] });
  genau(befunde, "neue datei src/neu.js ohne vorhanden");
});

test("eine als neu gemeldete Datei, die es schon gibt, ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { aenderungen: [{ datei: "src/logik.js", neu: "datei", neueZeilen: 10 }] });
  genau(befunde, "gibt es schon");
});

test("eine als neu gemeldete Funktion, die es schon gibt, ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { aenderungen: [{ datei: "src/logik.js", funktion: "rechne", neu: "funktion", neueZeilen: 5 }] });
  genau(befunde, "gibt es schon");
});

test("eine neue Funktion mit neuem Namen ohne Suche nach vorhandener Logik ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { aenderungen: [{ datei: "src/logik.js", funktion: "rechneNeu", neu: "funktion", neueZeilen: 5 }] });
  genau(befunde, "neue funktion rechneNeu ohne vorhanden");
});

test("eine Änderung ohne neueZeilen ist ein Befund", (context) => {
  const { neueZeilen, ...ohneZeilen } = AENDERUNG;
  assert.equal(neueZeilen, 3);
  const { befunde } = einzeln(context, { aenderungen: [ohneZeilen] });
  genau(befunde, "neueZeilen fehlt");
});

function mitTeil(befunde, teil) {
  assert.ok(befunde.some((befund) => befund.includes(teil)), befunde.join("\n"));
}

test("ein Ordner oder eine Nicht-Testdatei unter tests ist ein Befund", (context) => {
  genau(einzeln(context, { tests: ["test"] }).befunde, "test ist keine Testdatei test/….test.js");
  genau(einzeln(context, { tests: ["src/logik.js"] }).befunde, "src/logik.js ist keine Testdatei test/….test.js");
});

test("ein fehlender Test bleibt ein Befund mit seinem Namen", (context) => {
  genau(einzeln(context, { tests: ["test/fehlt.test.js"] }).befunde, "Test test/fehlt.test.js fehlt");
});

test("ein Vorbild ist keine Angabe mehr, auch ein altes Vorbild auf eine fehlende Datei ergibt keinen Befund", (context) => {
  const { befunde, annahmen } = einzeln(context, { vorbild: "src/fehlt.js" });
  assert.deepEqual([befunde, annahmen], [[], []]);
});

test("unsaubere Pfade in einer Weg-Stelle sind ein Befund", (context) => {
  for (const datei of ["./src/logik.js", "src//logik.js", "../x.js", "/etc/x.js"]) {
    const { befunde } = einzeln(context, { weg: [EINGANGS_STELLE, { ...WIRKUNGS_STELLE, datei }] });
    genau(befunde, "muss ein relativer Pfad im Repo sein");
  }
});

test("unsaubere Pfade in einer Änderung sind ein Befund", (context) => {
  for (const datei of ["./src/logik.js", "src//logik.js", "../x.js", "/etc/x.js"]) {
    const { befunde } = einzeln(context, { aenderungen: [{ ...AENDERUNG, datei }] });
    genau(befunde, "muss ein relativer Pfad im Repo sein");
  }
});

test("eine neue Datei außerhalb des Repos ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { aenderungen: [{ datei: "../x.js", neu: "datei", neueZeilen: 3 }] });
  genau(befunde, "muss ein relativer Pfad im Repo sein");
});

test("eine Änderung an ./src/geschuetzt.js umgeht CODEOWNERS nicht", (context) => {
  const geschuetzt = { datei: "./src/geschuetzt.js", funktion: "schuetze", von: 1, bis: 3, neueZeilen: 1 };
  const { befunde } = einzeln(context, { aenderungen: [geschuetzt] });
  assert.ok(befunde.length >= 1, "kein Befund");
  mitTeil(befunde, "muss ein relativer Pfad im Repo sein");
});

test("ein unsauberer Pfad unter codeowners ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { codeowners: ["./src/geschuetzt.js"] });
  genau(befunde, "codeowners nennt ./src/geschuetzt.js, das nicht in CODEOWNERS steht");
});

test("eine Weg-Stelle in einer Testdatei ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { weg: [{ ...EINGANGS_STELLE, datei: "test/vorhanden.test.js" }, WIRKUNGS_STELLE] });
  mitTeil(befunde, "Stelle des Wegs liegt in der Testdatei");
});

test("eine neue Datei oder Funktion ohne neue Zeile ist ein Befund", (context) => {
  const datei = einzeln(context, { aenderungen: [{ datei: "src/neu.js", neu: "datei", neueZeilen: 0 }] });
  genau(datei.befunde, "braucht mindestens eine neue Zeile");
  const funktion = einzeln(context, { aenderungen: [{ datei: "src/logik.js", funktion: "rechneNeu", neu: "funktion", neueZeilen: 0 }] });
  genau(funktion.befunde, "braucht mindestens eine neue Zeile");
});

test("eine bestehende Änderung mit neueZeilen 0 ist grün", (context) => {
  const { befunde } = einzeln(context, { aenderungen: [{ ...AENDERUNG, neueZeilen: 0 }] });
  assert.deepEqual(befunde, []);
});

test("eine Weg-Stelle mit einem Ordner als Datei ist ein Befund ohne Abbruch", (context) => {
  let ergebnis;
  assert.doesNotThrow(() => {
    ergebnis = einzeln(context, { weg: [EINGANGS_STELLE, { ...WIRKUNGS_STELLE, datei: "src" }] });
  });
  genau(ergebnis.befunde, "src ist keine Datei");
});

test("ein falsches schema ist ein Befund", (context) => {
  genau(einzeln(context, { schema: { aenderung: "ja", fundstelle: "x" } }).befunde, "schema.aenderung muss ja (true) oder nein (false) sein");
  genau(einzeln(context, { schema: { aenderung: true } }).befunde, "schema braucht eine Fundstelle");
});

test("eine falsche ownerEntscheidung ist ein Befund", (context) => {
  genau(einzeln(context, { ownerEntscheidung: { fundstelle: "design.md" } }).befunde, "braucht den Text der Entscheidung");
  genau(einzeln(context, { ownerEntscheidung: { text: "x" } }).befunde, "ownerEntscheidung braucht eine Fundstelle");
});

test("ein Widerspruch ohne beide Fundstellen ist ein Befund", (context) => {
  genau(einzeln(context, { widersprueche: [{ designDoc: "a" }] }).befunde, "Widerspruch ohne beide Fundstellen");
});

test("eine Änderung mit unbekanntem neu ist ein Befund", (context) => {
  genau(einzeln(context, { aenderungen: [{ ...AENDERUNG, neu: "irgendwas" }] }).befunde, "neu muss „datei“ oder „funktion“ sein");
});

test("eine Weg-Stelle mit von größer als bis ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { weg: [EINGANGS_STELLE, { ...WIRKUNGS_STELLE, von: 5, bis: 2 }] });
  genau(befunde, "sind keine Zeilen von-bis");
});

test("ein Weg-Eintrag mit unbekannter Rolle ist ein Befund", (context) => {
  const { befunde } = einzeln(context, { weg: [EINGANGS_STELLE, WIRKUNGS_STELLE, { ...WIRKUNGS_STELLE, rolle: "quatsch" }] });
  genau(befunde, "rolle muss eine von");
});

test("tests als Objekt ist ein Befund", (context) => {
  genau(einzeln(context, { tests: {} }).befunde, "tests muss eine Liste sein");
});

test("ein gültiges schema und Widersprüche mit beiden Fundstellen sind grün", (context) => {
  const { befunde, annahmen } = einzeln(context, {
    schema: { aenderung: true, fundstelle: "src/logik.js Zeile 1" },
    widersprueche: [{ designDoc: "design.md Zeile 3", code: "src/logik.js Zeile 2" }],
  });
  assert.deepEqual(befunde, []);
  assert.deepEqual(annahmen, []);
});

test("eine Nummer der Gruppe, die nicht in den Soll-Nummern steht, ist ein Befund", (context) => {
  const soll = new Map([["B1", { text: "Gegeben ein Kunde\nWenn er etwas tut\nDann passiert nichts" }]]);
  const { befunde } = einzeln(context, {}, { soll });
  assert.deepEqual(befunde, ["S1: steht nicht in den Soll-Nummern"]);
});

test("ein Grund nur aus Satzzeichen oder unsichtbarem Zeichen ist ein Befund und keine Annahme", (context) => {
  for (const tests of ["nicht gefunden, weil .", "nicht gefunden, weil ​"]) {
    const { befunde, annahmen } = einzeln(context, { tests });
    genau(befunde, "ohne Grund");
    assert.deepEqual(annahmen, []);
  }
});

test("ein Eingang über Ausweg ist grün und die Wenn-Prüfung entfällt", (context) => {
  const soll = sollMitText("Gegeben ein Kunde\nWenn der Agent `place_call` aufruft\nDann kommt eine Antwort");
  const eingang = { rolle: "eingang", ausweg: "nicht gefunden, weil der Eingang außerhalb liegt" };
  const { befunde, annahmen } = einzeln(context, { weg: [eingang, WIRKUNGS_STELLE] }, { soll });
  assert.deepEqual(befunde, []);
  assert.deepEqual(annahmen, [{ nummer: "S1", angabe: "weg eingang", text: "nicht gefunden, weil der Eingang außerhalb liegt" }]);
});

test("weg, schema, codeowners und widersprueche als Ausweg sind grün und stehen in den Annahmen", (context) => {
  const { befunde, annahmen } = einzeln(context, {
    weg: "nicht gefunden, weil der Weg unbekannt ist",
    schema: "nicht gefunden, weil es kein Schema gibt",
    codeowners: "nicht gefunden, weil es keine Datei gibt",
    widersprueche: "nicht gefunden, weil nichts widerspricht",
  });
  assert.deepEqual(befunde, []);
  assert.deepEqual(annahmen, [
    { nummer: "S1", angabe: "weg", text: "nicht gefunden, weil der Weg unbekannt ist" },
    { nummer: "S1", angabe: "schema", text: "nicht gefunden, weil es kein Schema gibt" },
    { nummer: "S1", angabe: "codeowners", text: "nicht gefunden, weil es keine Datei gibt" },
    { nummer: "S1", angabe: "widersprueche", text: "nicht gefunden, weil nichts widerspricht" },
  ]);
});

test("das Gerüst nennt jede Nummer und jede Pflichtangabe", (context) => {
  const geruest = berichtsGeruest(["S1", "T1"]);
  assert.deepEqual(Object.keys(geruest.nummern), ["S1", "T1"]);
  assert.deepEqual(geruest.hinweise, []);
  for (const eintrag of Object.values(geruest.nummern)) {
    assert.deepEqual(Object.keys(eintrag).toSorted(), ANGABEN.toSorted());
    assert.deepEqual(eintrag.weg.map(({ rolle }) => rolle), ["eingang", "wirkung"]);
    assert.equal(eintrag.aenderungen[0].neueZeilen, PLATZHALTER);
  }
  const { befunde } = lauf(context, geruest.nummern, { gruppe: ["S1", "T1"] });
  for (const teil of ["S1: tests[0] enthält noch den Platzhalter <AUSFUELLEN>", "T1: weg[1].funktion enthält noch den Platzhalter <AUSFUELLEN>", "T1: schema.fundstelle enthält noch den Platzhalter <AUSFUELLEN>"]) assert.ok(befunde.includes(teil), `${teil} fehlt in\n${befunde.join("\n")}`);
});

test("ein stehen gebliebener Platzhalter ist ein Befund", (context) => {
  genau(einzeln(context, { vorbild: `nicht gefunden, weil ${PLATZHALTER}` }).befunde, "S1: vorbild enthält noch den Platzhalter <AUSFUELLEN>");
  const widerspruch = { designDoc: "design.md, ## Lösung", code: `src/eingang.js:${PLATZHALTER}`, text: "Das Design Doc nennt PUT" };
  genau(einzeln(context, { widersprueche: [widerspruch] }).befunde, "S1: widersprueche[0].code enthält noch den Platzhalter <AUSFUELLEN>");
});
