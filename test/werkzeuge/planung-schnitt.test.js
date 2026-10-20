import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { REGEL, erkundungsVorpruefung, schnittBefunde, schnittPruefung } from "../../tools/auftrag/planung/schnitt.mjs";
import { REPO_ROOT, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const DATEI_A = "src/anrufe/start.js";
const DATEI_B = "src/nummern/zuteilen.js";
const TEST_A = "test/anrufe/anruf-starten.test.js";
const TEST_B = "test/nummern/nummer-zuteilen.test.js";
const NIE_A = "Der Agent ruft nie ohne Freigabe an.";
const NIE_B = "Die Nummer wird nie doppelt vergeben.";
const PITCH = ["# Pitch", "", "## Nicht-Ziele", "", NIE_A, NIE_B, "", "## Ablauf", "", "Ein Kunde meldet sich."].join("\n");
const GRUND = "Der Umbau schafft die Grundlage";
const ALTLAST = { datei: DATEI_A, name: "starte", von: 1, bis: 20, zeilen: 20, befunde: { complexity: 1 }, nummern: ["S1"] };

function auftrag(kennung, nummer, { datei, abnahme, nie }) {
  return {
    id: kennung,
    art: "funktion",
    ziel: "Der Kunde erreicht sein Ziel",
    bereich: datei,
    erwarteteDateien: [datei],
    vorbild: "src/vorbild.js",
    abnahme,
    erwarteterFehler: "Die Antwort fehlt",
    wasDarfNiePassieren: [{ satz: nie, quelle: "pitch.md", abschnitt: "## Nicht-Ziele" }],
    prueft: [nummer],
    abhaengigVon: [],
    eingang: "erreicht",
  };
}

function angaben(datei, funktion) {
  return {
    aenderungen: [{ datei, funktion, von: 1, bis: 3, neueZeilen: 10 }],
    codeowners: [],
    ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist",
    schema: { aenderung: false, fundstelle: `${datei} Zeile 1` },
  };
}

function basis(context) {
  const root = probeDirectory(context, {
    ".github/CODEOWNERS": "/src/geschuetzt.js @owner\n",
    "test/vorhanden.test.js": "",
    "test/anrufe/vorhanden.test.js": "",
    "tools/bereiche.json": JSON.stringify([{ bereich: "anrufe" }, { bereich: "nummern" }]),
  });
  return {
    schnitt: {
      annahmen: [],
      fehlendeSzenarien: [],
      ownerAufgaben: [],
      gemeinsameNamen: [],
      auftraege: [auftrag("a1", "S1", { datei: DATEI_A, abnahme: TEST_A, nie: NIE_A }), auftrag("a2", "S2", { datei: DATEI_B, abnahme: TEST_B, nie: NIE_B })],
    },
    eingaben: {
      soll: new Map([
        ["S1", { text: "Gegeben ein Kunde\nWenn er anruft\nDann klingelt es" }],
        ["S2", { text: "Gegeben ein Kunde\nWenn er eine Nummer will\nDann bekommt er eine" }],
      ]),
      berichte: [
        { gruppe: ["S1"], nummern: { S1: angaben(DATEI_A, "starte") } },
        { gruppe: ["S2"], nummern: { S2: angaben(DATEI_B, "teile") } },
      ],
      funktionsliste: [],
      dateikarte: [],
      dokumente: { "pitch.md": PITCH },
      root,
    },
  };
}

function lauf({ schnitt, eingaben }) {
  return schnittBefunde(schnitt, eingaben);
}

function erwarte(ergebnis, regel, ...teile) {
  const { befunde } = ergebnis;
  assert.equal(befunde.length, teile.length, befunde.join("\n"));
  for (const befund of befunde) assert.ok(befund.startsWith(`Regel ${regel}: `), befund);
  for (const teil of teile) assert.ok(befunde.some((befund) => befund.includes(teil)), `${teil} fehlt in\n${befunde.join("\n")}`);
}

function gruen(ergebnis) {
  assert.deepEqual(ergebnis.befunde, []);
}

function eigener(b, kennung) {
  return b.schnitt.auftraege.find(({ id }) => id === kennung);
}

function angabenVon({ eingaben }, nummer) {
  const { nummern } = eingaben.berichte.find(({ gruppe }) => gruppe.includes(nummer));
  return nummern[nummer];
}

function umbau(b, kennung, ueberschrieben = {}) {
  const datei = `src/gemeinsam/${kennung}.js`;
  const bestehend = `test/gemeinsam/${kennung}-bestehend.test.js`;
  const neu = {
    id: kennung,
    art: "umbau",
    ziel: "Die Grundlage wird aufgeräumt",
    bereich: datei,
    erwarteteDateien: [datei],
    vorbild: "src/vorbild.js",
    abnahme: bestehend,
    erwarteterFehler: "Nichts ändert sich",
    prueft: UMBAU_AUSWEG,
    abhaengigVon: [],
    altfunktionen: [],
    ...ueberschrieben,
  };
  b.schnitt.auftraege.push(neu);
  b.eingaben.dateikarte.push({ datei: neu.erwarteteDateien[0], tests: [neu.abnahme] });
  return neu;
}

function haengtAn(abhaengiger, ...kennungen) {
  abhaengiger.abhaengigVon.push(...kennungen.map((id) => ({ id, grund: GRUND })));
}

const ERKUNDUNGS_QUELLEN = {
  ".gitignore": "node_modules\n",
  "package.json": JSON.stringify({ type: "module" }),
  "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n',
  "eslint-suppressions.json": JSON.stringify({ "src/alt.js": { "no-var": { count: 1 } } }),
  "src/eingang.js": [
    "export function registriere(router) {",
    '  router.post("/api/probe", function nimmAn(anfrage) {',
    "    const kopie = anfrage;",
    "    return kopie;",
    "  });",
    "}",
    "",
  ].join("\n"),
  "src/logik.js": ["export function rechne(wert) {", "  const doppelt = wert * 2;", "  return doppelt + 1;", "}", ""].join("\n"),
  "src/alt.js": ["export function altlast() {", "  var alt = 1;", "  return alt;", "}", ""].join("\n"),
  "src/vorbild.js": "export const vorbild = 1;\n",
  ".github/CODEOWNERS": "/src/geschuetzt.js @owner\n",
  "test/vorhanden.test.js": "",
  "tools/bereiche.json": JSON.stringify([{ bereich: "anrufe", quellen: ["^src/"], eingaenge: [], fachlogik: [] }]),
};
const WENN_ROUTE = "Gegeben ein Kunde\nWenn er über `POST /api/probe` sendet\nDann kommt eine Antwort";
const EINGANGS_STELLE = { rolle: "eingang", datei: "src/eingang.js", funktion: "nimmAn", von: 2, bis: 4 };

function erkundungsOrdner(context) {
  const ordner = probeRepository(context, ERKUNDUNGS_QUELLEN);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(ordner, "node_modules"));
  return ordner;
}

function erkundungsAngaben({ datei, funktion, bis }, ueberschrieben) {
  return {
    weg: [EINGANGS_STELLE, { rolle: "wirkung", datei, funktion, von: 2, bis }],
    aenderungen: [{ datei, funktion, von: 2, bis, neueZeilen: 3 }],
    tests: ["test/vorhanden.test.js"],
    vorbild: "src/vorbild.js",
    schema: { aenderung: false, fundstelle: `${datei} Zeile 1` },
    codeowners: [],
    ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist",
    eingangImTest: "erreichbar",
    widersprueche: [],
    ...ueberschrieben,
  };
}

const LOGIK_STELLE = { datei: "src/logik.js", funktion: "rechne", bis: 3 };

function erkundungsBericht(ueberschrieben = {}, stelle = LOGIK_STELLE) {
  return { gruppe: ["S1"], nummern: { S1: erkundungsAngaben(stelle, ueberschrieben) } };
}

function erkundungsSoll() {
  return new Map([["S1", { text: WENN_ROUTE }]]);
}

function erkundungsSchnitt(datei) {
  const einziger = auftrag("a1", "S1", { datei, abnahme: "test/anrufe/probe-neu.test.js", nie: NIE_A });
  einziger.vorbild = "src/vorbild.js";
  return { annahmen: [], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege: [einziger] };
}

function erkundungsEingaben(root, berichte) {
  return { soll: erkundungsSoll(), berichte, dokumente: { "pitch.md": PITCH }, root };
}

test("die Basis ist grün: keine Befunde, keine Hinweise, keine Annahmen", (context) => {
  const ergebnis = lauf(basis(context));
  assert.deepEqual(ergebnis, { befunde: [], hinweise: [], annahmen: [] });
});

test("Form: ein abhaengigVon-Eintrag ohne grund ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").abhaengigVon = [{ id: "a1" }];
  erwarte(lauf(b), REGEL.form, "a2: abhaengigVon a1 braucht einen Grund");
});

test("Form: ein Kreis a1 -> a2 -> a1 ist rot", (context) => {
  const b = basis(context);
  haengtAn(eigener(b, "a1"), "a2");
  haengtAn(eigener(b, "a2"), "a1");
  erwarte(lauf(b), REGEL.form, "abhaengigVon bildet einen Kreis");
});

test("Form: abhaengigVon als Text statt Objekt ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").abhaengigVon = ["a0"];
  erwarte(lauf(b), REGEL.form, "a2: abhaengigVon nennt undefined, das ist kein anderer Auftrag");
});

test("Form: fehlende annahmen sind rot", (context) => {
  const b = basis(context);
  delete b.schnitt.annahmen;
  erwarte(lauf(b), REGEL.form, "annahmen muss eine Liste sein");
});

test("Form: eine unbekannte art ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").art = "zauberei";
  erwarte(lauf(b), REGEL.form, "a2: art muss eine von funktion, fehlerbehebung, umbau, testumbau sein");
});

test("Form: eine doppelte id ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").id = "a1";
  erwarte(lauf(b), REGEL.form, "id a1 kommt doppelt vor");
});

test("bei Form-Befunden laufen die übrigen Regeln nicht", (context) => {
  const b = basis(context);
  eigener(b, "a2").abhaengigVon = [{ id: "a1" }];
  eigener(b, "a2").prueft = [];
  eigener(b, "a2").abnahme = "test/foo.test.js";
  const ergebnis = lauf(b);
  erwarte(ergebnis, REGEL.form, "a2: abhaengigVon a1 braucht einen Grund");
  assert.deepEqual(ergebnis.hinweise, []);
});

test("Erkundung: eine Soll-Nummer ohne Bericht ist rot mit 0 Erkundungsberichten", (context) => {
  const root = erkundungsOrdner(context);
  const ergebnis = erkundungsVorpruefung([], { soll: erkundungsSoll(), root });
  assert.deepEqual(ergebnis.befunde, ["Regel Erkundung: S1 hat 0 Erkundungsberichte statt genau einem"]);
});

test("Erkundung: eine Nummer in zwei Berichten ist rot mit 2 Erkundungsberichten", (context) => {
  const root = erkundungsOrdner(context);
  const ergebnis = erkundungsVorpruefung([erkundungsBericht(), erkundungsBericht()], { soll: erkundungsSoll(), root });
  assert.deepEqual(ergebnis.befunde, ["Regel Erkundung: S1 hat 2 Erkundungsberichte statt genau einem"]);
});

test("Erkundung: ein Bericht mit fehlender Datei ist rot und nennt den Bericht", (context) => {
  const root = erkundungsOrdner(context);
  const bericht = erkundungsBericht({}, { ...LOGIK_STELLE, datei: "src/fehlt.js" });
  const ergebnis = erkundungsVorpruefung([bericht], { soll: erkundungsSoll(), root });
  assert.equal(ergebnis.befunde.length, 2, ergebnis.befunde.join("\n"));
  for (const befund of ergebnis.befunde) assert.ok(befund.startsWith("Regel Erkundung: Bericht S1: "), befund);
  assert.ok(ergebnis.befunde.every((befund) => befund.includes("Datei src/fehlt.js fehlt")), ergebnis.befunde.join("\n"));
});

test("Erkundung: ein Bericht ohne gruppe ist rot", (context) => {
  const root = erkundungsOrdner(context);
  const ergebnis = erkundungsVorpruefung([{ nummern: {} }], { soll: erkundungsSoll(), root });
  assert.deepEqual(ergebnis.befunde, [
    "Regel Erkundung: ein Erkundungsbericht nennt keine gruppe",
    "Regel Erkundung: S1 hat 0 Erkundungsberichte statt genau einem",
  ]);
});

test("Erkundung: ein gültiger Bericht ist grün", (context) => {
  const root = erkundungsOrdner(context);
  const ergebnis = erkundungsVorpruefung([erkundungsBericht()], { soll: erkundungsSoll(), root });
  assert.deepEqual(ergebnis.befunde, []);
});

test("Erkundung: die Auswege des Berichts stehen in den Annahmen des Ergebnisses", (context) => {
  const root = erkundungsOrdner(context);
  const text = "nicht gefunden, weil es keinen Test gibt";
  const bericht = erkundungsBericht({ tests: text });
  const ergebnis = erkundungsVorpruefung([bericht], { soll: erkundungsSoll(), root });
  assert.deepEqual(ergebnis.befunde, []);
  assert.deepEqual(ergebnis.annahmen, [
    { nummer: "S1", angabe: "tests", text },
    { nummer: "S1", angabe: "ownerEntscheidung", text: "keine, weil keine geschützte Datei betroffen ist" },
  ]);
});

test("bei Befunden der Vorprüfung liefert schnittPruefung nur Erkundung-Befunde", async (context) => {
  const root = erkundungsOrdner(context);
  const schnitt = erkundungsSchnitt("src/logik.js");
  schnitt.auftraege[0].prueft = [];
  schnitt.auftraege[0].abnahme = "test/foo.test.js";
  const ergebnis = await schnittPruefung(schnitt, erkundungsEingaben(root, []));
  assert.deepEqual(ergebnis.befunde, ["Regel Erkundung: S1 hat 0 Erkundungsberichte statt genau einem"]);
  assert.deepEqual(ergebnis.hinweise, []);
});

test("schnittPruefung ist Ende zu Ende grün mit echter Funktionsliste und echter Dateikarte", async (context) => {
  const root = erkundungsOrdner(context);
  const ergebnis = await schnittPruefung(erkundungsSchnitt("src/logik.js"), erkundungsEingaben(root, [erkundungsBericht()]));
  assert.deepEqual(ergebnis.befunde, []);
  assert.deepEqual(ergebnis.hinweise, []);
  assert.deepEqual(ergebnis.annahmen, [{ nummer: "S1", angabe: "ownerEntscheidung", text: "keine, weil keine geschützte Datei betroffen ist" }]);
});

test("schnittPruefung findet eine echte Altfunktion ohne Umbau", async (context) => {
  const root = erkundungsOrdner(context);
  const bericht = erkundungsBericht({}, { datei: "src/alt.js", funktion: "altlast", bis: 3 });
  const ergebnis = await schnittPruefung(erkundungsSchnitt("src/alt.js"), erkundungsEingaben(root, [bericht]));
  erwarte(ergebnis, REGEL.altfunktionen, "a1: Altfunktion src/alt.js:altlast (1-4, no-var) steht bei keinem Umbau");
});

test("Nummern: eine Soll-Nummer bei keinem Auftrag ist rot", (context) => {
  const b = basis(context);
  b.eingaben.soll.set("S3", { text: "Gegeben x\nWenn y\nDann z" });
  erwarte(lauf(b), REGEL.nummern, "S3 steht bei keiner Funktion und keiner Fehlerbehebung");
});

test("Nummern: eine Nummer bei zwei Aufträgen ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").prueft = ["S1", "S2"];
  haengtAn(eigener(b, "a2"), "a1");
  erwarte(lauf(b), REGEL.nummern, "S1 steht mehrfach: a1, a2");
});

test("Nummern: ein Umbau mit prueft S1 ist rot", (context) => {
  const b = basis(context);
  umbau(b, "u1", { prueft: ["S1"] });
  erwarte(lauf(b), REGEL.nummern, "u1: ein Umbau prüft keine Nummer");
});

test("Nummern: eine Funktion mit leerem prueft ist rot und lässt ihre Nummer offen", (context) => {
  const b = basis(context);
  eigener(b, "a2").prueft = [];
  erwarte(lauf(b), REGEL.nummern, "a2: funktion ohne Nummer in prueft", "S2 steht bei keiner Funktion und keiner Fehlerbehebung");
});

test("Nummern: prueft mit S9 ohne Soll-Nummer ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").prueft = ["S2", "S9"];
  erwarte(lauf(b), REGEL.nummern, "a2: S9 ist keine Soll-Nummer");
});

test("Nummern: zwei Funktionen, die sich die Nummern ohne Überschneidung teilen, sind grün", (context) => {
  const b = basis(context);
  b.eingaben.soll.set("S3", { text: "Gegeben ein Kunde\nWenn er auflegt\nDann ist das Gespräch beendet" });
  eigener(b, "a1").prueft = ["S1", "S3"];
  gruen(lauf(b));
});

test("T-Verweis: T1 bei a2 und S1 bei a1 ist rot", (context) => {
  const b = basis(context);
  b.eingaben.soll.set("T1", { text: "S1 im Pitch" });
  eigener(b, "a2").prueft = ["S2", "T1"];
  erwarte(lauf(b), REGEL.verweis, "T1 lautet nur „S1 im Pitch“ und steht deshalb beim Auftrag von S1, nicht bei a2");
});

test("T-Verweis: T1 und S1 beim selben Auftrag sind grün", (context) => {
  const b = basis(context);
  b.eingaben.soll.set("T1", { text: "S1 im Pitch" });
  eigener(b, "a1").prueft = ["S1", "T1"];
  gruen(lauf(b));
});

test("T-Verweis: T1 mit weiterem Text darf bei einem anderen Auftrag stehen", (context) => {
  const b = basis(context);
  b.eingaben.soll.set("T1", { text: "S1 im Pitch, dazu bleibt der Weg geschützt\nGegeben ein Angreifer" });
  eigener(b, "a2").prueft = ["S2", "T1"];
  gruen(lauf(b));
});

test("Durchstich: ohne Auftrag a1 ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").id = "a3";
  erwarte(lauf(b), REGEL.durchstich, "es gibt keinen Auftrag a1 (Durchstich)");
});

test("Durchstich: ein a1 als fehlerbehebung ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").art = "fehlerbehebung";
  erwarte(lauf(b), REGEL.durchstich, "a1 ist fehlerbehebung, der Durchstich ist eine funktion");
});

test("Durchstich: ein a1, das von einer funktion abhängt, ist rot", (context) => {
  const b = basis(context);
  haengtAn(eigener(b, "a1"), "a2");
  erwarte(lauf(b), REGEL.durchstich, "a1 hängt von a2 ab, das ist kein Umbau");
});

test("Durchstich: eine Änderungsdatei von a1 außerhalb von a1 und seiner Kette ist rot", (context) => {
  const b = basis(context);
  angabenVon(b, "S1").aenderungen.push({ datei: "src/anrufe/fremd.js", funktion: "fremd", von: 1, bis: 2, neueZeilen: 1 });
  erwarte(lauf(b), REGEL.durchstich, "a1: Änderungsdatei src/anrufe/fremd.js von S1 steht weder bei a1 noch in seiner abhaengigVon-Kette noch unter falscheAngaben oder ownerAufgaben");
});

test("Durchstich: eine Änderungsdatei aus einem vorgelagerten Umbau ist grün", (context) => {
  const b = basis(context);
  const vorgelagert = umbau(b, "u1");
  haengtAn(eigener(b, "a1"), "u1");
  angabenVon(b, "S1").aenderungen.push({ datei: vorgelagert.erwarteteDateien[0], funktion: "helfe", von: 1, bis: 2, neueZeilen: 1 });
  gruen(lauf(b));
});

test("Altfunktionen: eine Funktion mit Befunden ohne Umbau in der Kette ist rot", (context) => {
  const b = basis(context);
  b.eingaben.funktionsliste = [ALTLAST];
  erwarte(lauf(b), REGEL.altfunktionen, "a1: Altfunktion src/anrufe/start.js:starte (1-20, complexity) steht bei keinem Umbau");
});

test("Altfunktionen: ein Umbau mit denselben Namen aber anderen Zeilen ist rot", (context) => {
  const b = basis(context);
  b.eingaben.funktionsliste = [ALTLAST];
  umbau(b, "u1", { bereich: DATEI_A, erwarteteDateien: [DATEI_A], altfunktionen: [{ datei: DATEI_A, funktion: "starte", von: 1, bis: 25 }] });
  haengtAn(eigener(b, "a1"), "u1");
  erwarte(lauf(b), REGEL.altfunktionen, "a1: Altfunktion src/anrufe/start.js:starte (1-20, complexity) steht bei keinem Umbau");
});

test("Altfunktionen: ein Umbau über zwei Stufen mit datei, von und bis ist grün", (context) => {
  const b = basis(context);
  b.eingaben.funktionsliste = [ALTLAST];
  umbau(b, "u2", { bereich: DATEI_A, erwarteteDateien: [DATEI_A], altfunktionen: [{ datei: DATEI_A, funktion: "starte", von: 1, bis: 20 }] });
  haengtAn(umbau(b, "u1"), "u2");
  haengtAn(eigener(b, "a1"), "u1");
  gruen(lauf(b));
});

test("Altfunktionen: ein Umbau in der Kette, dessen erwarteteDateien die Datei der Altfunktion nicht nennen, ist rot", (context) => {
  const b = basis(context);
  b.eingaben.funktionsliste = [ALTLAST];
  umbau(b, "u1", { altfunktionen: [{ datei: DATEI_A, funktion: "starte", von: 1, bis: 20 }] });
  haengtAn(eigener(b, "a1"), "u1");
  erwarte(lauf(b), REGEL.altfunktionen, "a1: Altfunktion src/anrufe/start.js:starte (1-20, complexity) steht bei keinem Umbau");
});

test("Altfunktionen: eine Funktion ohne Befunde braucht nichts", (context) => {
  const b = basis(context);
  b.eingaben.funktionsliste = [{ ...ALTLAST, befunde: {} }];
  gruen(lauf(b));
});

test("Altfunktionen: eine Stelle unter falscheAngaben braucht keinen Umbau", (context) => {
  const b = basis(context);
  b.eingaben.funktionsliste = [ALTLAST];
  eigener(b, "a1").falscheAngaben = [{ nummer: "S1", datei: DATEI_A, grund: "Die Stelle gehört zu einer anderen Nummer", fundstelle: `${DATEI_A} Zeile 5` }];
  const ergebnis = lauf(b);
  gruen(ergebnis);
  assert.deepEqual(ergebnis.annahmen, [{ auftrag: "a1", text: `Widerspruch zur Erkundung S1 ${DATEI_A}: Die Stelle gehört zu einer anderen Nummer (${DATEI_A} Zeile 5)` }]);
});

test("Umbau-Test: eine abnahme, die in keiner Dateikarte-Zeile des Umbaus steht, ist rot", (context) => {
  const b = basis(context);
  umbau(b, "u1");
  b.eingaben.dateikarte = [{ datei: "src/gemeinsam/u1.js", tests: ["test/gemeinsam/anderer.test.js"] }];
  erwarte(lauf(b), REGEL.umbauTest, "u1: abnahme test/gemeinsam/u1-bestehend.test.js gehört laut Dateikarte zu keiner Datei des Umbaus (src/gemeinsam/u1.js)");
});

test("Umbau-Test: fehlt die Datei des Umbaus in der Dateikarte ganz, ist es rot", (context) => {
  const b = basis(context);
  umbau(b, "u1");
  b.eingaben.dateikarte = [];
  erwarte(lauf(b), REGEL.umbauTest, "u1: abnahme test/gemeinsam/u1-bestehend.test.js gehört laut Dateikarte zu keiner Datei des Umbaus (src/gemeinsam/u1.js)");
});

test("Umbau-Test: eine abnahme, die in der Dateikarte der Umbau-Datei steht, ist grün", (context) => {
  const b = basis(context);
  umbau(b, "u1");
  gruen(lauf(b));
});

test("Schema: meldet der Bericht eine Schemaänderung ohne schema nutzung beim Besitzer, ist es rot", (context) => {
  const b = basis(context);
  angabenVon(b, "S1").schema = { aenderung: true, fundstelle: "db/schema.sql Zeile 4" };
  erwarte(lauf(b), REGEL.schema, "S1: Schemaänderung laut Bericht, a1 braucht schema nutzung");
});

test("Schema: eine aenderung, die kein Umbau ist, ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").schema = "aenderung";
  erwarte(lauf(b), REGEL.schema, "a2: die Schemaänderung ist ein umbau");
});

test("Schema: eine aenderung ohne vertraeglich davor ist rot", (context) => {
  const b = basis(context);
  umbau(b, "u1", { schema: "aenderung" });
  erwarte(lauf(b), REGEL.schema, "u1: vor der Schemaänderung fehlt in abhaengigVon ein Auftrag mit schema vertraeglich");
});

test("Schema: eine nutzung ohne aenderung davor ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").schema = "nutzung";
  erwarte(lauf(b), REGEL.schema, "a2: vor der Nutzung fehlt in abhaengigVon die Schemaänderung");
});

test("Schema: ein ungültiger Wert neu ist rot, auch ohne Schemaänderung im Bericht", (context) => {
  const b = basis(context);
  eigener(b, "a2").schema = "neu";
  erwarte(lauf(b), REGEL.schema, "a2: schema muss eine von vertraeglich, aenderung, nutzung sein");
});

test("Schema: die volle Kette vertraeglich, aenderung, nutzung ist grün", (context) => {
  const b = basis(context);
  angabenVon(b, "S1").schema = { aenderung: true, fundstelle: "db/schema.sql Zeile 4" };
  umbau(b, "u1", { schema: "vertraeglich" });
  haengtAn(umbau(b, "u2", { schema: "aenderung" }), "u1");
  const nutzung = eigener(b, "a1");
  nutzung.schema = "nutzung";
  haengtAn(nutzung, "u2");
  gruen(lauf(b));
});

test("Bereich: bei einer Produktdatei ist ihr Ordner als bereich rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").bereich = "src/anrufe/";
  erwarte(lauf(b), REGEL.bereich, "a1: bereich ist src/anrufe/, die Produktdateien verlangen src/anrufe/start.js");
});

test("Bereich: Dateien in zwei Ordnern ohne bereichsgrund sind rot", (context) => {
  const b = basis(context);
  Object.assign(eigener(b, "a1"), { bereich: "src/", erwarteteDateien: [DATEI_A, DATEI_B] });
  erwarte(lauf(b), REGEL.bereich, "a1: Produktdateien in mehreren Ordnern brauchen bereichsgrund");
});

test("Bereich: mit bereichsgrund und engstem gemeinsamem Ordner ist es grün und der Grund steht in den Annahmen", (context) => {
  const b = basis(context);
  Object.assign(eigener(b, "a1"), { bereich: "src/", erwarteteDateien: [DATEI_A, DATEI_B], bereichsgrund: "Beide Dateien teilen sich eine Hilfe" });
  const ergebnis = lauf(b);
  gruen(ergebnis);
  assert.deepEqual(ergebnis.annahmen, [{ auftrag: "a1", text: "bereich src/: Beide Dateien teilen sich eine Hilfe" }]);
});

test("Bereich: ist die Repo-Wurzel der einzige gemeinsame Ordner, ist bereich / rot, und der Grund ohne koppelnden Test auch", (context) => {
  const b = basis(context);
  Object.assign(eigener(b, "a1"), { bereich: "/", erwarteteDateien: [DATEI_A, "lib/x.js"], bereichsgrund: "Beide gehören zusammen" });
  erwarte(lauf(b), REGEL.bereich, `a1: bereich ist /, der einzige gemeinsame Ordner der Produktdateien ist die Repo-Wurzel; sie verlangen die Liste ["lib/x.js","${DATEI_A}"]`, "a1: bereichsgrund nennt keinen bestehenden Test");
});

test("Bereich: erwarteteDateien nur mit Tests ist rot", (context) => {
  const b = basis(context);
  const nurTest = "test/anrufe/nur-test.test.js";
  Object.assign(eigener(b, "a1"), { erwarteteDateien: [nurTest] });
  angabenVon(b, "S1").aenderungen[0].datei = nurTest;
  erwarte(lauf(b), REGEL.bereich, "a1: erwarteteDateien nennt keine Produktdatei");
});

test("Bereich: mehrere Dateien im selben Ordner mit bereich auf den Ordner sind grün", (context) => {
  const b = basis(context);
  Object.assign(eigener(b, "a1"), { bereich: "src/anrufe/", erwarteteDateien: [DATEI_A, "src/anrufe/ende.js"] });
  gruen(lauf(b));
});

const UMBAU_TEST = "test/anrufe/vorbereitung.test.js";

function testumbau(b, ueberschrieben = {}) {
  return Object.assign(eigener(b, "a1"), { art: "testumbau", bereich: UMBAU_TEST, erwarteteDateien: [UMBAU_TEST], abnahme: UMBAU_TEST, prueft: UMBAU_AUSWEG, ...ueberschrieben });
}

test("Bereich: ein testumbau nur mit Testdateien und deren Datei als bereich ist grün", (context) => {
  const b = basis(context);
  testumbau(b);
  angabenVon(b, "S1").aenderungen[0].datei = UMBAU_TEST;
  const { befunde } = lauf(b);
  assert.deepEqual(befunde.filter((befund) => befund.startsWith(`Regel ${REGEL.bereich}: `)), []);
});

test("Bereich: ein testumbau, der eine Produktdatei nennt, ist rot", (context) => {
  const b = basis(context);
  testumbau(b, { erwarteteDateien: [UMBAU_TEST, DATEI_A] });
  const { befunde } = lauf(b);
  assert.deepEqual(befunde.filter((befund) => befund.startsWith(`Regel ${REGEL.bereich}: `)), [`Regel ${REGEL.bereich}: a1: ein testumbau nennt in erwarteteDateien nur Testdateien, nicht ${DATEI_A}`]);
});

test("Bereich: ein testumbau, dessen bereich nicht der engste Ordner seiner Testdateien ist, ist rot", (context) => {
  const b = basis(context);
  testumbau(b, { bereich: "test/", erwarteteDateien: [UMBAU_TEST, "test/anrufe/ende.test.js"] });
  const { befunde } = lauf(b);
  assert.deepEqual(befunde.filter((befund) => befund.startsWith(`Regel ${REGEL.bereich}: `)), [`Regel ${REGEL.bereich}: a1: bereich ist test/, die Testdateien verlangen test/anrufe/`]);
});

test("Änderungsdateien: eine Datei von a2 außerhalb von a2 und seiner Kette ist rot", (context) => {
  const b = basis(context);
  angabenVon(b, "S2").aenderungen.push({ datei: "src/nummern/fremd.js", funktion: "fremd", von: 1, bis: 2, neueZeilen: 1 });
  erwarte(lauf(b), REGEL.aenderungen, "a2: Änderungsdatei src/nummern/fremd.js von S2 steht weder bei a2 noch in seiner abhaengigVon-Kette noch unter falscheAngaben oder ownerAufgaben");
});

test("Änderungsdateien: eine Datei aus der Kette von a2 ist grün", (context) => {
  const b = basis(context);
  const vorgelagert = umbau(b, "u1");
  haengtAn(eigener(b, "a2"), "u1");
  angabenVon(b, "S2").aenderungen.push({ datei: vorgelagert.erwarteteDateien[0], funktion: "helfe", von: 1, bis: 2, neueZeilen: 1 });
  gruen(lauf(b));
});

test("Änderungsdateien: die einzige Änderungsdatei von S2 steht nur beim vorgelagerten Umbau ist rot", (context) => {
  const b = basis(context);
  const vorgelagert = umbau(b, "u1");
  haengtAn(eigener(b, "a2"), "u1");
  angabenVon(b, "S2").aenderungen = [{ datei: vorgelagert.erwarteteDateien[0], funktion: "helfe", von: 1, bis: 2, neueZeilen: 1 }];
  erwarte(lauf(b), REGEL.aenderungen, "a2: keine gemeldete Änderungsdatei seiner Nummern steht in seinen eigenen erwarteteDateien; neues Verhalten gehört nicht in einen Umbau davor");
});

test("Durchstich: die einzige Änderungsdatei von S1 steht nur beim vorgelagerten Umbau ist rot", (context) => {
  const b = basis(context);
  const vorgelagert = umbau(b, "u1");
  haengtAn(eigener(b, "a1"), "u1");
  angabenVon(b, "S1").aenderungen = [{ datei: vorgelagert.erwarteteDateien[0], funktion: "helfe", von: 1, bis: 2, neueZeilen: 1 }];
  erwarte(lauf(b), REGEL.durchstich, "a1: keine gemeldete Änderungsdatei seiner Nummern steht in seinen eigenen erwarteteDateien");
});

test("Änderungsdateien: führt a2 eine der Dateien selbst, die auch der Umbau davor hat, ist es grün", (context) => {
  const b = basis(context);
  const vorgelagert = umbau(b, "u1");
  haengtAn(eigener(b, "a2"), "u1");
  angabenVon(b, "S2").aenderungen = [
    { datei: vorgelagert.erwarteteDateien[0], funktion: "helfe", von: 1, bis: 2, neueZeilen: 1 },
    { datei: DATEI_B, funktion: "teile", von: 1, bis: 3, neueZeilen: 10 },
  ];
  gruen(lauf(b));
});

test("Änderungsdateien: eine geschützte Datei weder beim Auftrag noch in ownerAufgaben ist rot", (context) => {
  const b = basis(context);
  angabenVon(b, "S2").aenderungen.push({ datei: "src/geschuetzt.js", funktion: "schuetze", von: 1, bis: 2, neueZeilen: 1 });
  erwarte(lauf(b), REGEL.aenderungen, "a2: Änderungsdatei src/geschuetzt.js von S2 steht weder bei a2 noch in seiner abhaengigVon-Kette noch unter falscheAngaben oder ownerAufgaben");
});

test("Änderungsdateien: eine geschützte Datei nur in ownerAufgaben ist grün", (context) => {
  const b = basis(context);
  angabenVon(b, "S2").aenderungen.push({ datei: "src/geschuetzt.js", funktion: "schuetze", von: 1, bis: 2, neueZeilen: 1 });
  angabenVon(b, "S2").codeowners = ["src/geschuetzt.js"];
  b.schnitt.ownerAufgaben = [{ aufgabe: "src/geschuetzt.js vom Owner ändern lassen", fundstelle: ".github/CODEOWNERS", auftrag: "a2" }];
  gruen(lauf(b));
});

test("Änderungsdateien: eine ungeschützte Datei in ownerAufgaben bleibt rot, wenn sie beim Auftrag fehlt", (context) => {
  const b = basis(context);
  angabenVon(b, "S2").aenderungen.push({ datei: "src/nummern/fremd.js", funktion: "fremd", von: 1, bis: 2, neueZeilen: 1 });
  b.schnitt.ownerAufgaben = [{ aufgabe: "src/nummern/fremd.js vom Owner ändern lassen", fundstelle: ".github/CODEOWNERS", auftrag: "a2" }];
  erwarte(lauf(b), REGEL.aenderungen, "a2: Änderungsdatei src/nummern/fremd.js von S2 steht weder bei a2 noch in seiner abhaengigVon-Kette noch unter falscheAngaben oder ownerAufgaben");
});

test("Änderungsdateien: eine Datei unter falscheAngaben mit Grund ist grün und steht in den Annahmen", (context) => {
  const b = basis(context);
  angabenVon(b, "S2").aenderungen.push({ datei: "src/nummern/fremd.js", funktion: "fremd", von: 1, bis: 2, neueZeilen: 1 });
  eigener(b, "a2").falscheAngaben = [{ nummer: "S2", datei: "src/nummern/fremd.js", grund: "Die Erkundung hat die Datei verwechselt", fundstelle: "src/nummern/zuteilen.js Zeile 4" }];
  const ergebnis = lauf(b);
  gruen(ergebnis);
  assert.deepEqual(ergebnis.annahmen, [
    { auftrag: "a2", text: "Widerspruch zur Erkundung S2 src/nummern/fremd.js: Die Erkundung hat die Datei verwechselt (src/nummern/zuteilen.js Zeile 4)" },
  ]);
  assert.deepEqual(ergebnis.hinweise, ["Hinweis: 1 Angaben der Erkundung als falsch erklärt; der Prüfer sieht jede nach"]);
});

test("Änderungsdateien: falscheAngaben ohne fundstelle ist rot und lässt die Datei offen", (context) => {
  const b = basis(context);
  angabenVon(b, "S2").aenderungen.push({ datei: "src/nummern/fremd.js", funktion: "fremd", von: 1, bis: 2, neueZeilen: 1 });
  eigener(b, "a2").falscheAngaben = [{ nummer: "S2", datei: "src/nummern/fremd.js", grund: "Die Erkundung hat die Datei verwechselt" }];
  erwarte(
    lauf(b),
    REGEL.aenderungen,
    "a2: falscheAngaben S2 src/nummern/fremd.js braucht eine Fundstelle, die die Erkundung widerlegt",
    "a2: Änderungsdatei src/nummern/fremd.js von S2 steht weder bei a2",
  );
});

test("Änderungsdateien: falscheAngaben ohne Grund ist rot und lässt die Datei offen", (context) => {
  const b = basis(context);
  angabenVon(b, "S2").aenderungen.push({ datei: "src/nummern/fremd.js", funktion: "fremd", von: 1, bis: 2, neueZeilen: 1 });
  eigener(b, "a2").falscheAngaben = [{ nummer: "S2", datei: "src/nummern/fremd.js", grund: "", fundstelle: "src/nummern/zuteilen.js Zeile 4" }];
  erwarte(lauf(b), REGEL.aenderungen, "a2: falscheAngaben S2 src/nummern/fremd.js braucht einen Grund", "a2: Änderungsdatei src/nummern/fremd.js von S2 steht weder bei a2");
});

test("Änderungsdateien: falscheAngaben mit einer Datei, die die Erkundung nicht meldet, ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").falscheAngaben = [{ nummer: "S2", datei: "src/nummern/nirgends.js", grund: "Die Datei wurde vermutet", fundstelle: "src/nummern/zuteilen.js Zeile 4" }];
  erwarte(lauf(b), REGEL.aenderungen, "a2: falscheAngaben");
  assert.ok(lauf(b).befunde[0].includes("nennt keine gemeldete Änderungsdatei einer eigenen Nummer"));
});

test("CODEOWNERS: eine erwartete Datei aus CODEOWNERS ist rot", (context) => {
  const b = basis(context);
  const geschuetzt = "src/geschuetzt.js";
  Object.assign(eigener(b, "a2"), { bereich: geschuetzt, erwarteteDateien: [geschuetzt] });
  Object.assign(angabenVon(b, "S2"), { aenderungen: [{ datei: geschuetzt, funktion: "schuetze", von: 1, bis: 3, neueZeilen: 1 }], codeowners: [geschuetzt] });
  b.schnitt.ownerAufgaben = [{ aufgabe: `${geschuetzt} vom Owner ändern lassen`, fundstelle: ".github/CODEOWNERS", auftrag: "a2" }];
  erwarte(lauf(b), REGEL.codeowners, "a2: erwartete Datei src/geschuetzt.js steht in CODEOWNERS; sie gehört in ownerAufgaben");
});

test("CODEOWNERS: eine codeowners-Datei des Berichts ohne ownerAufgabe ist rot", (context) => {
  const b = basis(context);
  angabenVon(b, "S2").codeowners = ["src/geschuetzt.js"];
  erwarte(lauf(b), REGEL.codeowners, "src/geschuetzt.js ist laut Erkundung Sache eines Owners und fehlt in ownerAufgaben");
});

test("CODEOWNERS: eine ownerEntscheidung des Berichts ohne ownerAufgabe ist rot", (context) => {
  const b = basis(context);
  angabenVon(b, "S1").ownerEntscheidung = { fundstelle: ".github/CODEOWNERS Zeile 3", text: "Der Owner entscheidet" };
  erwarte(lauf(b), REGEL.codeowners, ".github/CODEOWNERS Zeile 3 ist laut Erkundung Sache eines Owners und fehlt in ownerAufgaben");
});

test("CODEOWNERS: eine ownerAufgabe ohne auftrag ist rot", (context) => {
  const b = basis(context);
  b.schnitt.ownerAufgaben = [{ aufgabe: "Owner fragen", fundstelle: "Notiz im Pitch" }];
  erwarte(lauf(b), REGEL.codeowners, "ownerAufgaben:");
  assert.ok(lauf(b).befunde[0].includes("braucht aufgabe, fundstelle und den Auftrag, der ohne sie rot wird"));
});

test("CODEOWNERS: eine ownerAufgabe mit unbekanntem auftrag ist rot", (context) => {
  const b = basis(context);
  b.schnitt.ownerAufgaben = [{ aufgabe: "Owner fragen", fundstelle: "Notiz im Pitch", auftrag: "a9" }];
  erwarte(lauf(b), REGEL.codeowners, "ownerAufgaben:");
  assert.ok(lauf(b).befunde[0].includes("\"auftrag\":\"a9\""));
});

test("CODEOWNERS: eine ownerAufgabe, die nur src/geschuetzt.jsx nennt, deckt src/geschuetzt.js nicht", (context) => {
  const b = basis(context);
  angabenVon(b, "S2").codeowners = ["src/geschuetzt.js"];
  b.schnitt.ownerAufgaben = [{ aufgabe: "src/geschuetzt.jsx vom Owner ändern lassen", fundstelle: ".github/CODEOWNERS", auftrag: "a2" }];
  erwarte(lauf(b), REGEL.codeowners, "src/geschuetzt.js ist laut Erkundung Sache eines Owners und fehlt in ownerAufgaben");
});

test("CODEOWNERS: eine andere Fundstelle der ownerAufgabe deckt die gemeldete Owner-Entscheidung nicht", (context) => {
  const b = basis(context);
  angabenVon(b, "S1").ownerEntscheidung = { fundstelle: "pitch.md Zur Freigabe", text: "Der Owner entscheidet" };
  b.schnitt.ownerAufgaben = [{ aufgabe: "Owner entscheiden lassen", fundstelle: "pitch.md Zur Freigabe Punkt 2", auftrag: "a1" }];
  erwarte(lauf(b), REGEL.codeowners, "pitch.md Zur Freigabe ist laut Erkundung Sache eines Owners und fehlt in ownerAufgaben");
});

test("CODEOWNERS: dieselbe Fundstelle mit anderem Leerraum deckt die Owner-Entscheidung", (context) => {
  const b = basis(context);
  angabenVon(b, "S1").ownerEntscheidung = { fundstelle: "pitch.md Zur Freigabe", text: "Der Owner entscheidet" };
  b.schnitt.ownerAufgaben = [{ aufgabe: "Owner entscheiden lassen", fundstelle: "pitch.md  Zur\nFreigabe", auftrag: "a1" }];
  gruen(lauf(b));
});

test("CODEOWNERS: alles Gemeldete in ownerAufgaben ist grün", (context) => {
  const b = basis(context);
  angabenVon(b, "S1").ownerEntscheidung = { fundstelle: ".github/CODEOWNERS Zeile 3", text: "Der Owner entscheidet" };
  angabenVon(b, "S2").codeowners = ["src/geschuetzt.js"];
  b.schnitt.ownerAufgaben = [
    { aufgabe: "Owner entscheiden lassen", fundstelle: ".github/CODEOWNERS Zeile 3", auftrag: "a1" },
    { aufgabe: "src/geschuetzt.js vom Owner ändern lassen", fundstelle: ".github/CODEOWNERS", auftrag: "a2" },
  ];
  gruen(lauf(b));
});

test("Abnahmetest: test/foo.test.js ohne Bereich ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").abnahme = "test/foo.test.js";
  erwarte(lauf(b), REGEL.abnahme, "a1: abnahme test/foo.test.js liegt nicht im Testordner eines Bereichs aus tools/bereiche.json");
});

function kennungIstRot(context, abnahme) {
  const b = basis(context);
  eigener(b, "a1").abnahme = abnahme;
  erwarte(lauf(b), REGEL.abnahme, `a1: abnahme ${abnahme} enthält eine Kennung wie p001, a1, s3 im Namen`);
}

test("Abnahmetest: die Phasenkennung p001 im Namen ist rot", (context) => {
  kennungIstRot(context, "test/anrufe/p001-hinweis.test.js");
});

test("Abnahmetest: die Phasenkennung p-605 mit Bindestrich ist rot", (context) => {
  kennungIstRot(context, "test/anrufe/p-605-hinterlegen.test.js");
});

test("Abnahmetest: die Auftragskennung a-1 mit Bindestrich ist rot", (context) => {
  kennungIstRot(context, "test/anrufe/hinweis-a-1.test.js");
});

test("Abnahmetest: die Auftragskennung a1 am Anfang ist rot", (context) => {
  kennungIstRot(context, "test/anrufe/a1-hinweis.test.js");
});

test("Abnahmetest: die Nummer s3 im Namen ist rot", (context) => {
  kennungIstRot(context, "test/anrufe/s3-hinweis.test.js");
});

test("Abnahmetest: ein Probe-Repo mit nur dem Bereich anrufe macht test/nummern/x.test.js rot", (context) => {
  const b = basis(context);
  b.eingaben.root = probeDirectory(context, { "tools/bereiche.json": JSON.stringify([{ bereich: "anrufe" }]) });
  eigener(b, "a2").abnahme = "test/nummern/x.test.js";
  erwarte(lauf(b), REGEL.abnahme, "a2: abnahme test/nummern/x.test.js liegt nicht im Testordner eines Bereichs aus tools/bereiche.json");
});

test("Abnahmetest: ein unbekannter Bereich ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").abnahme = "test/unbekannt/x.test.js";
  erwarte(lauf(b), REGEL.abnahme, "a1: abnahme test/unbekannt/x.test.js liegt nicht im Testordner eines Bereichs aus tools/bereiche.json");
});

test("Abnahmetest: dieselbe abnahme bei zwei Aufträgen ist für beide rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").abnahme = TEST_A;
  erwarte(lauf(b), REGEL.abnahme, `a1: abnahme ${TEST_A} hat auch ein anderer Auftrag`, `a2: abnahme ${TEST_A} hat auch ein anderer Auftrag`);
});

test("Abnahmetest: eine Funktion mit schon vorhandener abnahme im root ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").abnahme = "test/anrufe/vorhanden.test.js";
  erwarte(lauf(b), REGEL.abnahme, "a1: abnahme test/anrufe/vorhanden.test.js gibt es schon; funktion braucht einen neuen Test");
});

test("Abnahmetest: ein Umbau mit bestehender abnahme außerhalb eines Bereichs ist grün", (context) => {
  const b = basis(context);
  umbau(b, "u1", { abnahme: "test/vorhanden.test.js" });
  gruen(lauf(b));
});

test("Eingang: ein fehlender eingang ist rot", (context) => {
  const b = basis(context);
  delete eigener(b, "a2").eingang;
  erwarte(lauf(b), REGEL.eingang, "a2: eingang ist weder „erreicht“ noch „nicht erreicht, weil …“ mit Grund");
});

test("Eingang: nicht erreicht, weil ohne Grund ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").eingang = "nicht erreicht, weil";
  erwarte(lauf(b), REGEL.eingang, "a2: eingang ist weder „erreicht“ noch „nicht erreicht, weil …“ mit Grund");
});

test("Eingang: nicht erreicht mit Grund aber ohne Annahme ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a2").eingang = "nicht erreicht, weil der Webhook fehlt";
  erwarte(lauf(b), REGEL.eingang, "a2: eingang „nicht erreicht“ ohne Eintrag in annahmen");
});

test("Eingang: nicht erreicht mit annahmen-Eintrag des Auftrags ist grün und der Grund steht automatisch in annahmen", (context) => {
  const b = basis(context);
  eigener(b, "a2").eingang = "nicht erreicht, weil der Webhook fehlt";
  const annahme = { auftrag: "a2", text: "Der Webhook wird im Auftrag selbst gebaut" };
  b.schnitt.annahmen = [annahme];
  const ergebnis = lauf(b);
  gruen(ergebnis);
  assert.deepEqual(ergebnis.annahmen, [annahme, { auftrag: "a2", text: "eingang nicht erreicht, weil der Webhook fehlt" }]);
});

test("Eingang: eine Annahme eines anderen Auftrags genügt nicht", (context) => {
  const b = basis(context);
  eigener(b, "a2").eingang = "nicht erreicht, weil der Webhook fehlt";
  b.schnitt.annahmen = [{ auftrag: "a1", text: "Der Webhook wird im Auftrag selbst gebaut" }];
  erwarte(lauf(b), REGEL.eingang, "a2: eingang „nicht erreicht“ ohne Eintrag in annahmen");
});

test("Durchstich: a1 mit eingang nicht erreicht und passender Annahme ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").eingang = "nicht erreicht, weil der Webhook fehlt";
  b.schnitt.annahmen = [{ auftrag: "a1", text: "Der Webhook wird im Auftrag selbst gebaut" }];
  erwarte(lauf(b), REGEL.durchstich, "a1 führt durch den echten Eingang; eingang muss „erreicht“ sein");
});

test("Form: eine Annahme mit text „...“ ist rot", (context) => {
  const b = basis(context);
  b.schnitt.annahmen = [{ auftrag: "a1", text: "..." }];
  erwarte(lauf(b), REGEL.form, "annahmen: {\"auftrag\":\"a1\",\"text\":\"...\"} braucht einen text mit Grund");
});

test("Eingang: ein Umbau ohne eingang ist grün", (context) => {
  const b = basis(context);
  assert.equal(umbau(b, "u1").eingang, undefined);
  gruen(lauf(b));
});

test("Nie-Sätze: ein Satz, der nicht im Abschnitt steht, ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").wasDarfNiePassieren[0].satz = "Der Agent löscht Kundendaten.";
  erwarte(lauf(b), REGEL.nie, "a1 wasDarfNiePassieren: „Der Agent löscht Kundendaten.“ steht nicht wörtlich als ganzer Satz oder ganze Zeile in pitch.md, ## Nicht-Ziele");
});

test("Nie-Sätze: ein Abschnitt, den es nicht gibt, ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").wasDarfNiePassieren[0].abschnitt = "## Gibt es nicht";
  erwarte(lauf(b), REGEL.nie, "a1 wasDarfNiePassieren: Überschrift „## Gibt es nicht“ steht nicht im Design Doc (pitch.md)");
});

test("Nie-Sätze: die quelle andere.md ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").wasDarfNiePassieren[0].quelle = "andere.md";
  erwarte(lauf(b), REGEL.nie, "a1 wasDarfNiePassieren: quelle andere.md ist keins der Dokumente pitch.md, design.md, sicherheit.md");
});

test("Nie-Sätze: ein Satz, der auch im Szenariotext steht, ist rot", (context) => {
  const b = basis(context);
  b.eingaben.soll.set("S1", { text: `Gegeben ein Kunde\nWenn er anruft\nDann gilt: ${NIE_A}` });
  erwarte(lauf(b), REGEL.nie, `a1 wasDarfNiePassieren: „${NIE_A}“ steht im Szenario S1`);
});

test("Nie-Sätze: ein Eintrag als bloßer Text ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").wasDarfNiePassieren = [NIE_A];
  erwarte(lauf(b), REGEL.nie, "a1 wasDarfNiePassieren: jeder Eintrag braucht satz, quelle und abschnitt");
});

test("Nie-Sätze: wörtlich mit anderem Leerraum ist grün", (context) => {
  const b = basis(context);
  eigener(b, "a1").wasDarfNiePassieren[0].satz = "Der Agent  ruft nie\nohne Freigabe an.";
  gruen(lauf(b));
});

test("Nie-Sätze: ein Wortfetzen wie „nie“ ist rot", (context) => {
  const b = basis(context);
  eigener(b, "a1").wasDarfNiePassieren[0].satz = "nie";
  erwarte(lauf(b), REGEL.nie, "a1 wasDarfNiePassieren: „nie“ steht nicht wörtlich als ganzer Satz oder ganze Zeile in pitch.md, ## Nicht-Ziele");
});

test("Nie-Sätze: ganze Zeilen aus Listen sind grün", (context) => {
  const b = basis(context);
  const liste = ["# Pitch", "", "## Nicht-Ziele", "", `- ${NIE_A}`, `* ${NIE_B}`, "1. Der Kunde wird nie belästigt."].join("\n");
  b.eingaben.dokumente = { "pitch.md": liste };
  eigener(b, "a1").wasDarfNiePassieren = [NIE_A, NIE_B, "Der Kunde wird nie belästigt."].map((satz) => ({ satz, quelle: "pitch.md", abschnitt: "## Nicht-Ziele" }));
  gruen(lauf(b));
});

test("Nie-Sätze: ein Satz, der nur als Überschrift im Abschnitt steht, ist grün, mit oder ohne Etikett aus Wort und Kennung", (context) => {
  const b = basis(context);
  const kunde = "Der Kunde wird nie belästigt.";
  b.eingaben.dokumente = { "pitch.md": ["# Pitch", "", "## Nicht-Ziele", "", `### Regel R3: ${NIE_A}`, "", "Begründung.", "", `#### Grenze 12: ${NIE_B}`, "", `### ${kunde}`].join("\n") };
  eigener(b, "a1").wasDarfNiePassieren = [NIE_A, NIE_B, kunde].map((satz) => ({ satz, quelle: "pitch.md", abschnitt: "## Nicht-Ziele" }));
  gruen(lauf(b));
});

test("Nie-Sätze: ein Teil einer Überschrift oder einer Zeile mit Rauten in der Mitte bleibt rot", (context) => {
  const zeilen = [
    "# Pitch",
    "",
    "## Nicht-Ziele",
    "",
    `### Regel R3: ${NIE_A}`,
    "### Der Agent: ruft nie ohne Kosten an.",
    "### Hinweis zu Regel R4: wählt nie nachts.",
    "Nicht als Überschrift: ## Regel R5: hält nie still.",
    NIE_B,
  ];
  for (const satz of ["ruft nie ohne Freigabe an.", `R3: ${NIE_A}`, "ruft nie ohne Kosten an.", "wählt nie nachts.", "hält nie still."]) {
    const b = basis(context);
    b.eingaben.dokumente = { "pitch.md": zeilen.join("\n") };
    eigener(b, "a1").wasDarfNiePassieren[0].satz = satz;
    erwarte(lauf(b), REGEL.nie, `a1 wasDarfNiePassieren: „${satz}“ steht nicht wörtlich als ganzer Satz oder ganze Zeile in pitch.md, ## Nicht-Ziele`);
  }
});

test("Nie-Sätze: ein ganzer Satz aus einer Zeile mit zwei Sätzen ist grün", (context) => {
  const b = basis(context);
  b.eingaben.dokumente = { "pitch.md": ["# Pitch", "", "## Nicht-Ziele", "", `${NIE_A} ${NIE_B}`].join("\n") };
  eigener(b, "a1").wasDarfNiePassieren = [NIE_A, NIE_B].map((satz) => ({ satz, quelle: "pitch.md", abschnitt: "## Nicht-Ziele" }));
  gruen(lauf(b));
});

test("Nie-Sätze: Sätze aus design.md und sicherheit.md sind grün", (context) => {
  const b = basis(context);
  b.eingaben.dokumente = {
    ...b.eingaben.dokumente,
    "design.md": "# Design\n\n## Grenzen\n\nDie Nummer wird nie weitergegeben.\n",
    "sicherheit.md": "# Sicherheit\n\n## 2. Angriffswege\n\nDer Zugang bleibt nie offen.\n",
  };
  eigener(b, "a1").wasDarfNiePassieren = [
    { satz: "Die Nummer wird nie weitergegeben.", quelle: "design.md", abschnitt: "## Grenzen" },
    { satz: "Der Zugang bleibt nie offen.", quelle: "sicherheit.md", abschnitt: "## 2. Angriffswege" },
  ];
  gruen(lauf(b));
});

test("Nie-Sätze: eine Funktion ohne Feld wasDarfNiePassieren ist rot", (context) => {
  const b = basis(context);
  delete eigener(b, "a1").wasDarfNiePassieren;
  erwarte(lauf(b), REGEL.nie, "a1: wasDarfNiePassieren muss eine Liste von Einträgen mit satz, quelle und abschnitt sein");
});

test("Nie-Sätze: ein Umbau ohne wasDarfNiePassieren ist grün", (context) => {
  const b = basis(context);
  assert.equal(umbau(b, "u1").wasDarfNiePassieren, undefined);
  gruen(lauf(b));
});

test("Gemeinsame Namen: anbieter gleich nutzer ist rot", (context) => {
  const b = basis(context);
  b.schnitt.gemeinsameNamen = [{ name: "Zeitstempel", anbieter: DATEI_A, nutzer: DATEI_A }];
  erwarte(lauf(b), REGEL.namen, "braucht name und zwei verschiedene Bereiche der Schnittliste");
});

test("Gemeinsame Namen: ein Eintrag ohne name ist rot", (context) => {
  const b = basis(context);
  b.schnitt.gemeinsameNamen = [{ anbieter: DATEI_A, nutzer: DATEI_B }];
  erwarte(lauf(b), REGEL.namen, "braucht name und zwei verschiedene Bereiche der Schnittliste");
});

test("Gemeinsame Namen: ein Bereich, der nicht in der Schnittliste steht, ist rot", (context) => {
  const b = basis(context);
  b.schnitt.gemeinsameNamen = [{ name: "Zeitstempel", anbieter: DATEI_A, nutzer: "src/unbekannt/" }];
  erwarte(lauf(b), REGEL.namen, "braucht name und zwei verschiedene Bereiche der Schnittliste");
});

test("Gemeinsame Namen: ohne Abhängigkeit vom Anbieter zum Nutzer ist rot", (context) => {
  const b = basis(context);
  b.schnitt.gemeinsameNamen = [{ name: "Zeitstempel", anbieter: DATEI_A, nutzer: DATEI_B }];
  erwarte(lauf(b), REGEL.namen, `Zeitstempel: kein Auftrag in ${DATEI_B} hängt von einem Auftrag in ${DATEI_A} ab`);
});

test("Gemeinsame Namen: eine Abhängigkeit über zwei Stufen ist grün", (context) => {
  const b = basis(context);
  const anbieter = umbau(b, "u2");
  haengtAn(umbau(b, "u1"), "u2");
  haengtAn(eigener(b, "a2"), "u1");
  b.schnitt.gemeinsameNamen = [{ name: "Zeitstempel", anbieter: anbieter.bereich, nutzer: DATEI_B }];
  gruen(lauf(b));
});

test("Hinweis: mehr als 400 neue Zeilen ergeben einen Hinweis mit der id und keinen Befund", (context) => {
  const b = basis(context);
  angabenVon(b, "S1").aenderungen[0].neueZeilen = 401;
  const ergebnis = lauf(b);
  gruen(ergebnis);
  assert.equal(ergebnis.hinweise.length, 1);
  assert.ok(ergebnis.hinweise[0].startsWith("Hinweis: a1 hat geschätzt 401 neue Zeilen"), ergebnis.hinweise[0]);
});

test("Hinweis: genau 400 neue Zeilen ergeben keinen Hinweis", (context) => {
  const b = basis(context);
  angabenVon(b, "S1").aenderungen[0].neueZeilen = 400;
  const ergebnis = lauf(b);
  gruen(ergebnis);
  assert.deepEqual(ergebnis.hinweise, []);
});

const AUFTRAG_TOOL = join(REPO_ROOT, "tools/auftrag.mjs");
const SICHERHEIT = "# Sicherheit\n\n## 2. Angriffswege\n\nkeine Angriffswege gefunden\n";
const PITCH_MIT_SZENARIO = `${PITCH}\n\n## Szenario S1: Anruf\n${WENN_ROUTE}\n`;

function planungsOrdner(repo, schnitt, berichte) {
  const ordner = join(repo, "plaene/P-1-probe");
  mkdirSync(join(ordner, "planung"), { recursive: true });
  writeFileSync(join(ordner, "pitch.md"), PITCH_MIT_SZENARIO);
  writeFileSync(join(ordner, "sicherheit.md"), SICHERHEIT);
  writeFileSync(join(ordner, "planung/schnitt.json"), JSON.stringify(schnitt));
  berichte.forEach((bericht, stelle) => writeFileSync(join(ordner, `planung/erkundung-${stelle + 1}.json`), JSON.stringify(bericht)));
  return ordner;
}

test("Befehl schnitt: ein fehlender Erkundungsbericht ergibt Exit 4 und nur Zeilen mit Regel", (context) => {
  const repo = erkundungsOrdner(context);
  const ordner = planungsOrdner(repo, erkundungsSchnitt("src/logik.js"), []);
  const lauf4 = runIn(repo, process.execPath, [AUFTRAG_TOOL, "schnitt", ordner]);
  assert.equal(lauf4.status, 4, lauf4.stderr + lauf4.stdout);
  const zeilen = lauf4.stderr.split("\n").filter((zeile) => zeile.trim() !== "");
  assert.deepEqual(zeilen, ["Regel Erkundung: S1 hat 0 Erkundungsberichte statt genau einem"]);
});

test("Befehl schnitt: eine grüne Schnittliste ergibt Exit 0 und grün auf stdout", (context) => {
  const repo = erkundungsOrdner(context);
  const ordner = planungsOrdner(repo, erkundungsSchnitt("src/logik.js"), [erkundungsBericht()]);
  const gruenLauf = runIn(repo, process.execPath, [AUFTRAG_TOOL, "schnitt", ordner]);
  assert.equal(gruenLauf.status, 0, gruenLauf.stderr + gruenLauf.stdout);
  assert.ok(gruenLauf.stdout.includes("grün:"), gruenLauf.stdout);
  assert.equal(gruenLauf.stderr, "");
});

test("Befehl schnitt: eine rote Regel bei grüner Erkundung ergibt Exit 4 und nur Zeilen mit Regel", (context) => {
  const repo = erkundungsOrdner(context);
  const schnitt = erkundungsSchnitt("src/logik.js");
  schnitt.auftraege[0].id = "a3";
  const ordner = planungsOrdner(repo, schnitt, [erkundungsBericht()]);
  const lauf4 = runIn(repo, process.execPath, [AUFTRAG_TOOL, "schnitt", ordner]);
  assert.equal(lauf4.status, 4, lauf4.stderr + lauf4.stdout);
  const zeilen = lauf4.stderr.split("\n").filter((zeile) => zeile.trim() !== "");
  assert.ok(zeilen.length > 0, lauf4.stdout);
  for (const zeile of zeilen) assert.ok(zeile.startsWith("Regel "), zeile);
  assert.ok(zeilen.includes("Regel Durchstich: es gibt keinen Auftrag a1 (Durchstich)"), zeilen.join("\n"));
});

test("Befehl schnitt: ein pitch.md ohne Szenario ergibt Exit 4 und Abdeckung nicht bestimmbar", (context) => {
  const repo = erkundungsOrdner(context);
  const ordner = planungsOrdner(repo, erkundungsSchnitt("src/logik.js"), [erkundungsBericht()]);
  writeFileSync(join(ordner, "pitch.md"), PITCH);
  const lauf4 = runIn(repo, process.execPath, [AUFTRAG_TOOL, "schnitt", ordner]);
  assert.equal(lauf4.status, 4, lauf4.stderr + lauf4.stdout);
  assert.ok(lauf4.stderr.includes("Regel Nummern: Abdeckung nicht bestimmbar"), lauf4.stderr);
});

const DATEI_C = "src/nummern/zaehler.js";
const AENDERUNG_IN_DATEI_C = { datei: DATEI_C, funktion: "zaehle", von: 1, bis: 2, neueZeilen: 1 };

function vorhanden(kennung, ueberschrieben = {}) {
  const datei = `src/alt/${kennung}.js`;
  return { id: kennung, art: "funktion", ziel: "Der Kunde kommt weiter", bereich: datei, erwarteteDateien: [datei], abnahme: `test/anrufe/alt-${kennung}.test.js`, prueft: ["S9"], abhaengigVon: [], ...ueberschrieben };
}

function mitVorhandenen(b, ...vorhandene) {
  return { ...b, eingaben: { ...b.eingaben, vorhandene } };
}

test("Vorhandene: ein abhaengigVon auf einen vorhandenen Auftrag der Phase ist grün", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5"));
  haengtAn(eigener(b, "a2"), "a5");
  gruen(lauf(b));
});

test("Vorhandene: ohne vorhandene ist ein abhaengigVon auf eine fremde Kennung rot", (context) => {
  const b = basis(context);
  haengtAn(eigener(b, "a2"), "a5");
  erwarte(lauf(b), REGEL.form, 'a2: abhaengigVon nennt "a5", das ist kein anderer Auftrag');
});

test("Vorhandene: ein Kreis über einen vorhandenen Auftrag ist rot", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5", { abhaengigVon: ["a2"] }));
  haengtAn(eigener(b, "a2"), "a5");
  erwarte(lauf(b), REGEL.form, "abhaengigVon bildet einen Kreis: a5 -> a2 -> a5");
});

test("Vorhandene: ein neuer Auftrag mit der Kennung eines vorhandenen ist rot", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a2"));
  erwarte(lauf(b), REGEL.form, "a2: die Kennung hat schon ein vorhandener Auftrag der Phase");
});

test("Vorhandene: ein abhaengigVon auf eine Kennung, die weder neu noch vorhanden ist, ist rot", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5"));
  haengtAn(eigener(b, "a2"), "a9");
  erwarte(lauf(b), REGEL.form, 'a2: abhaengigVon nennt "a9", das ist kein anderer Auftrag');
});

test("Vorhandene: eine Annahme zu einem vorhandenen Auftrag ist grün", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5"));
  b.schnitt.annahmen = [{ auftrag: "a5", text: "a5 bleibt, weil er schon gebaut ist" }];
  gruen(lauf(b));
});

test("Vorhandene: eine Änderungsdatei aus der Kette über vorhandene Aufträge ist grün", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5", { abhaengigVon: ["a6"] }), vorhanden("a6", { erwarteteDateien: [DATEI_C] }));
  haengtAn(eigener(b, "a2"), "a5");
  angabenVon(b, "S2").aenderungen.push(AENDERUNG_IN_DATEI_C);
  gruen(lauf(b));
});

test("Vorhandene: eine Änderungsdatei, die kein vorhandener Auftrag der Kette nennt, ist rot", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5"), vorhanden("a6", { erwarteteDateien: [DATEI_C] }));
  haengtAn(eigener(b, "a2"), "a5");
  angabenVon(b, "S2").aenderungen.push(AENDERUNG_IN_DATEI_C);
  erwarte(lauf(b), REGEL.aenderungen, `a2: Änderungsdatei ${DATEI_C} von S2 steht weder bei a2 noch in seiner abhaengigVon-Kette`);
});

test("Vorhandene: eine abnahme, die ein vorhandener Auftrag schon hat, ist rot", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5", { abnahme: TEST_B }));
  erwarte(lauf(b), REGEL.abnahme, `a2: abnahme ${TEST_B} hat schon der vorhandene Auftrag a5`);
});

function ohneA1({ schnitt, eingaben }) {
  const soll = new Map([...eingaben.soll].filter(([nummer]) => nummer !== "S1"));
  const berichte = eingaben.berichte.filter(({ gruppe }) => !gruppe.includes("S1"));
  return { schnitt: { ...schnitt, auftraege: schnitt.auftraege.filter(({ id }) => id !== "a1") }, eingaben: { ...eingaben, soll, berichte } };
}

test("Durchstich: mit vorhandenen und ohne durchstich gilt die Regel Durchstich nicht, auch wenn a1 schon neu geschnitten ist", (context) => {
  const b = mitVorhandenen(ohneA1(basis(context)), vorhanden("a1-n1"));
  gruen(lauf(b));
});

test("Durchstich: mit durchstich gilt die Regel für diese Kennung", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5"));
  b.eingaben.durchstich = "a2";
  haengtAn(eigener(b, "a2"), "a1");
  erwarte(lauf(b), REGEL.durchstich, "a2 hängt von a1 ab, das ist kein Umbau");
});

test("Durchstich: mit durchstich steht eine fremde Änderungsdatei des Durchstichs nur unter der Regel Durchstich", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5"));
  b.eingaben.durchstich = "a2";
  angabenVon(b, "S2").aenderungen.push(AENDERUNG_IN_DATEI_C);
  erwarte(lauf(b), REGEL.durchstich, `a2: Änderungsdatei ${DATEI_C} von S2 steht weder bei a2 noch in seiner abhaengigVon-Kette`);
});

test("Durchstich: mit durchstich und einer unbekannten Kennung fehlt der Durchstich", (context) => {
  const b = mitVorhandenen(basis(context), vorhanden("a5"));
  b.eingaben.durchstich = "a2-n1";
  erwarte(lauf(b), REGEL.durchstich, "es gibt keinen Auftrag a2-n1 (Durchstich)");
});
