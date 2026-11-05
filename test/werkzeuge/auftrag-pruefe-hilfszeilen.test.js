import assert from "node:assert/strict";
import { test } from "node:test";

import { AUFTRAG_TOOL, probeDirectory, runIn } from "./probe-repo.js";

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const ISSUE = 7;
const TESTDATEI = "test/bestaetigung.test.js";
const AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";
const HINWEIS = /Hilfszeilen und der nutzende Test gehören in denselben Auftrag/;
const KEIN_FALL = "Der Auftrag fügt keinen Testfall hinzu und ändert keinen bestehenden.";
const AUFRUF_IM_FALL = 'test("zwei Prozesse teilen den Code", () => {\n  const prozesse = zweiProzesse();\n  assert.equal(windowIndexFor(prozesse), 0);\n});';

const A0C_ENTWURF_AUS_S2A_MIT_PLATZHALTER_NUMMER = "Was sich ändert: In test/call-confirmation.test.js entstehen die Hilfszeilen, die der Schutztest „Bremse zählt vorerst je Prozess“ von a1 braucht, ohne dass ein Fall hinzukommt oder sich ändert. Am Dateianfang: `windowIndexFor` kommt in den vorhandenen Import aus ../src/call-confirmation.js, und eine neue Importzeile `import { anfrage, zweiProzesse } from \"./gemeinsam/zwei-prozesse.js\";` steht nach dem Import von `abrufMitFrist`. Am Dateiende, vor dem Platz, an dem a1 den Fall anhängt, stehen drei Hilfsfunktionen ohne `test(...)`: `bestaetigungAnProzess(prozess, inhalt)` schickt per `anfrage(prozess, \"/api/call-confirmations\", { methode: \"POST\", koerper: inhalt })` eine Anfrage an einen Prozess, prüft mit `assert.equal` auf Status 200 und gibt `antwort.json()` zurück; `bremseAmProzessAusloesen(prozess, inhalt, richtigerCode)` leitet aus dem richtigen Code einen falschen, nicht leeren Code gleicher Länge ab (erstes Zeichen vertauscht: `0` wird `1`, jedes andere Zeichen wird `0`) und schickt `MAX_FAILED_CONFIRMATIONS_PER_WINDOW` solcher Anfragen gleichzeitig über `bestaetigungAnProzess` (mit `confirmation_code` im Inhalt) und wartet auf alle; `sperrenAmErstenProzess({ a, b }, objective)` stellt mit `inhalt = { to: \"+490000000000\", objective }` an `a` einen Code aus, löst an `a` die Bremse aus, schickt danach denselben richtigen Code an `a` und an `b` und gibt `{ anA, anB }` zurück.\nBleibt gleich: Jeder bestehende Fall der Datei bleibt Zeile für Zeile unverändert und grün; die neuen Zeilen werden von keinem Fall aufgerufen, das Verhalten ist also unverändert; kein Produktcode, keine neue Abhängigkeit, kein Geheimnis außer dem bereits vorhandenen Test-Secret.\nAbnahme: keiner, weil Umbau: bestehende Tests bleiben unverändert grün; abnahme ist test/call-confirmation.test.js selbst, weil sie die geänderte Datei vollständig durchläuft; ungenutzte Hilfszeilen sind hier gewollt, a1 nutzt sie.\nNicht-Ziele: Der Schutztest selbst und seine Festwerte (a1, weil nur dort ein roter oder neuer Fall entstehen darf); Änderungen an test/gemeinsam/zwei-prozesse.js oder anderen Testhilfen; Änderungen an bestehenden Fällen, Konstanten oder Importen außer dem Zusatz `windowIndexFor`.";

const PRODUKT_UMBAU = { id: "a1", art: "umbau", ziel: "Zerlege die Prüfung", bereich: "src/d.js", erwarteteDateien: ["src/d.js"], abnahme: TESTDATEI, prueft: AUSWEG };

function testumbau(felder = {}) {
  return {
    id: "a0c",
    art: "testumbau",
    ziel: "Lege Hilfen für den Schutztest an",
    bereich: TESTDATEI,
    erwarteteDateien: [TESTDATEI],
    abnahme: TESTDATEI,
    prueft: AUSWEG,
    ...felder,
  };
}

function pruefe(context, { auftraege, entwurf }) {
  const ordner = probeDirectory(context, {
    "src/d.js": "export const WERT = 1;\n",
    [TESTDATEI]: 'import { test } from "node:test";\ntest("ok", () => {});\n',
    "test/hilfe.js": "export const HILFE = 1;\n",
    "phase.json": JSON.stringify({ phase: "K-1-hilfszeilen", issue: ISSUE, entwurf, auftraege }),
  });
  return runIn(ordner, process.execPath, [AUFTRAG_TOOL, "pruefe", "phase.json"]);
}

test("auftrag-pruefe-hilfszeilen: Hilfsfunktionen in einer Testdatei ohne nutzenden Test im Auftrag sind ein Planfehler", (context) => {
  const entwurf = {
    [TESTDATEI]: `Legt die Hilfsfunktionen \`windowIndexFor(index)\` und \`zweiProzesse()\` an. ${KEIN_FALL} Der Schutztest in a1 ruft \`windowIndexFor(zweiProzesse())\` auf.`,
    "src/d.js": "Zerlegt die Prüfung.",
  };
  const lauf = pruefe(context, { auftraege: [testumbau(), PRODUKT_UMBAU], entwurf });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout);
  assert.match(lauf.stderr, /^a0c: .*test\/bestaetigung\.test\.js.*windowIndexFor, zweiProzesse/m);
  assert.match(lauf.stderr, HINWEIS);
});

test("auftrag-pruefe-hilfszeilen: eine als Code deklarierte Funktion ohne Aufruf im Entwurf ist ein Planfehler", (context) => {
  const entwurf = { [TESTDATEI]: "function sperrenAmErstenProzess(prozess) {\n  return prozess;\n}\nKein neuer Fall." };
  const lauf = pruefe(context, { auftraege: [testumbau()], entwurf });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout);
  assert.match(lauf.stderr, /^a0c: .*sperrenAmErstenProzess/m);
});

test("auftrag-pruefe-hilfszeilen: ruft ein Testfall im selben Entwurf die Hilfsfunktionen auf, ist der Plan grün", (context) => {
  const entwurf = { [TESTDATEI]: `Legt die Hilfsfunktionen \`windowIndexFor\` und \`zweiProzesse\` an. Der Fall:\n${AUFRUF_IM_FALL}` };
  const lauf = pruefe(context, { auftraege: [testumbau()], entwurf });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
});

test("auftrag-pruefe-hilfszeilen: eine exportierte Hilfsfunktion ist kein Planfehler", (context) => {
  const entwurf = { [TESTDATEI]: "export function zweiProzesse() {\n  return [];\n}\nexport { windowIndexFor };\nfunction windowIndexFor() {\n  return 0;\n}" };
  const lauf = pruefe(context, { auftraege: [testumbau()], entwurf });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
});

test("auftrag-pruefe-hilfszeilen: ein Aufruf im Entwurf einer anderen Datei desselben Auftrags genügt", (context) => {
  const entwurf = {
    [TESTDATEI]: "Legt die Hilfsfunktion `zweiProzesse` an. Kein neuer Fall.",
    "test/hilfe.js": "Die Hilfe ruft `zweiProzesse` auf.",
  };
  const lauf = pruefe(context, { auftraege: [testumbau({ erwarteteDateien: [TESTDATEI, "test/hilfe.js"] })], entwurf });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
});

test("auftrag-pruefe-hilfszeilen: Hilfsfunktionen im Produktbereich und verneinte Hilfsfunktionen sind kein Planfehler", (context) => {
  const entwurf = { "src/d.js": "Zerlegt in die Hilfsfunktionen `eins` und `zwei` derselben Datei.", [TESTDATEI]: "Keine Hilfsfunktion `drei` und kein neuer Fall." };
  const lauf = pruefe(context, { auftraege: [PRODUKT_UMBAU, testumbau({ id: "a2" })], entwurf });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
});

const ROTE_ENTWUERFE = [
  ["ein verneinter Aufrufsatz ist keine Nutzung", "Legt die Hilfsfunktion `zweiProzesse` an. Kein Testfall ruft `zweiProzesse()` auf.", "zweiProzesse"],
  ["ein verneinter Aufruf nach einem Semikolon macht den Namen im Anlegesatz nicht zur Nutzung", "Legt die Hilfsfunktion `zweiProzesse` an; kein Testfall ruft `zweiProzesse()` auf.", "zweiProzesse"],
  ["ein Doppelschrägstrich in einer Adresse blendet die Verneinung davor nicht aus", "Legt die Hilfsfunktion `zweiProzesse` an. Laut https://example.invalid/plan ruft kein Testfall `zweiProzesse()` auf.", "zweiProzesse"],
  ["kein direkt nach dem Verb verneint den Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Dort ruft kein Testfall `zweiProzesse()` auf.", "zweiProzesse"],
  ["nie oder nicht mehr vor auf verneint den Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Der Fall ruft `zweiProzesse()` nie auf. Der zweite Fall ruft `zweiProzesse()` nicht mehr auf.", "zweiProzesse"],
  ["nicht vor auf verneint den Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Der Fall ruft `zweiProzesse()` nicht auf.", "zweiProzesse"],
  ["ein verneinter Satz über einen Import in Prosa macht ihn nicht zur Nutzung", "`windowIndexFor` kommt in den vorhandenen Import aus ../src/d.js. Kein Testfall ruft `windowIndexFor()` auf.", "windowIndexFor"],
  ["ein verneinter Satz über einen Import in einer Codezeile macht ihn nicht zur Nutzung", 'import { WERT } from "../src/d.js";\nKein Testfall nutzt `WERT`.', "WERT"],
  ["ein Import in einer Codezeile, den kein Testfall nennt, ist eine ungenutzte Hilfszeile", 'import { WERT } from "../src/d.js";\ntest("leer", () => {});', "WERT"],
  ["ein Anlegesatz, der einen späteren Auftrag als Nutzer nennt, ist kein Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an, die ein späterer Auftrag nutzt. Kein neuer Fall.", "zweiProzesse"],
  ["eine spätere Verneinung im Anlegesatz hebt das Anlegen nicht auf", "Legt die Hilfsfunktionen `windowIndexFor` und `zweiProzesse` an und fügt keinen Testfall hinzu.", "windowIndexFor, zweiProzesse"],
  ["eine Verneinung in einem anderen Teilsatz vor den Namen hebt das Anlegen nicht auf", "Fügt keinen Testfall hinzu und legt die Hilfsfunktionen `windowIndexFor` und `zweiProzesse` an.", "windowIndexFor, zweiProzesse"],
  ["eine eingeschobene Verneinung im Subjekt verneint den Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Keiner der bestehenden Fälle, auch nicht der neue, ruft `zweiProzesse()` auf.", "zweiProzesse"],
  ["keinem und niemand verneinen den Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Von keinem Testfall wird `zweiProzesse()` aufgerufen. Niemand ruft `zweiProzesse()` auf.", "zweiProzesse"],
  ["ein verneinter Satz verneint auch den zweiten angereihten Namen", "Legt die Hilfsfunktionen `zweiProzesse` und `gesperrt` an. Kein Testfall ruft `zweiProzesse()` und `gesperrt()` auf.", "zweiProzesse, gesperrt"],
  ["ohne … aufzurufen ist kein Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Der neue Fall prüft das Ergebnis, ohne zweiProzesse() aufzurufen.", "zweiProzesse"],
  ["ein verneinter Aufruf im dass-Satz ist kein Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Der Auftrag hält fest, dass kein Fall `zweiProzesse()` aufruft.", "zweiProzesse"],
  ["ein verneinter Hauptsatz verneint auch seinen dass-Teil", "Legt die Hilfsfunktion `zweiProzesse` an. Der Auftrag fügt keinen Testfall hinzu, so dass `zweiProzesse()` aufgerufen wird.", "zweiProzesse"],
  ["ohne mit langem Objekt vor aufzurufen verneint den Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Der neue Fall prüft das Ergebnis, ohne zweiProzesse() im neuen Fall aufzurufen.", "zweiProzesse"],
  ["ein Satz, der die Funktion nur beschreibt, ist kein Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Die Funktion `zweiProzesse()` liefert zwei Prozesse.", "zweiProzesse"],
  ["zweimal im Anlegesatz genannt ist kein Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an, wobei `zweiProzesse` zwei Prozesse liefert. Kein neuer Fall.", "zweiProzesse"],
  ["zweimal genannt nach einem Semikolon ist kein Aufruf", "Ergänzt die Testhilfe `zweiProzesse`; `zweiProzesse` bleibt ungenutzt.", "zweiProzesse"],
  ["das Subjekt eines Aufrufs zählt nicht als genutzt, und was nur eine ungenutzte Hilfe ruft, bleibt ungenutzt", "Legt die Hilfsfunktionen `a_hilfe` und `b_hilfe` an. `a_hilfe` ruft `b_hilfe()` auf.", "a_hilfe, b_hilfe"],
  ["ein gewöhnliches Wort im Nutzsatz ist keine Nutzung", "Legt die Hilfsfunktion `prozess` an. Der Lauf verwendet den prozess des Servers.", "prozess"],
  ["ein späterer Auftrag ohne Kennung ist kein Nutzer", "Legt die Hilfsfunktion `zweiProzesse` an. Ein späterer Auftrag ruft `zweiProzesse()` auf.", "zweiProzesse"],
  ["der nächste Auftrag ohne Kennung ist kein Nutzer", "Legt die Hilfsfunktion `zweiProzesse` an. Der nächste Auftrag ruft `zweiProzesse()` auf.", "zweiProzesse"],
  ["spätere Aufträge in einem Code-Entwurf sind kein Nutzer", "function zwei() {}\nKein neuer Fall. Spätere Aufträge rufen zwei() auf.", "zwei"],
  ["niemals am Satzanfang verneint den Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Niemals ruft ein Fall `zweiProzesse()` auf.", "zweiProzesse"],
  ["niemals nach dem Ort verneint den Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Dort ruft niemals ein Fall `zweiProzesse()` auf.", "zweiProzesse"],
  ["niemals vor auf verneint den Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Der Fall ruft `zweiProzesse()` niemals auf.", "zweiProzesse"],
  ["ohne Aufruf angelegt ist kein Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Die Funktion `zweiProzesse()` bleibt ohne Aufruf.", "zweiProzesse"],
];

test("auftrag-pruefe-hilfszeilen: jeder rote Entwurf der Tabelle ist ein Planfehler mit den ungenutzten Namen", (context) => {
  for (const [name, text, namen] of ROTE_ENTWUERFE) {
    const lauf = pruefe(context, { auftraege: [testumbau()], entwurf: { [TESTDATEI]: text } });
    assert.equal(lauf.status, EXIT_ROT, `${name}: ${lauf.stdout}`);
    assert.match(lauf.stderr, new RegExp(`^a0c: .*${namen}`, "m"), name);
    assert.match(lauf.stderr, HINWEIS, name);
  }
});

const GRUENE_ENTWUERFE = [
  ["ein Kommentar mit nicht in der Codezeile verneint die Nutzung nicht", 'import { WERT } from "../src/d.js";\ntest("wert", () => {\n  assert.ok(WERT); // nicht null\n});'],
  ["ein importierter Name, den ein Testfall ohne Klammer nutzt, ist genutzt", 'import { WERT } from "../src/d.js";\ntest("wert", () => {\n  assert.equal(WERT, 1);\n});'],
  ["nicht auf in einem späteren Teilsatz verneint den Aufruf nicht", "Legt die Hilfsfunktion `zweiProzesse` an. Der neue Fall ruft `zweiProzesse()` auf und wartet nicht auf den Timer."],
  ["genutzt im Passiv ist eine Nutzung", "Legt die Hilfsfunktion `zweiProzesse` an. `zweiProzesse()` wird im neuen Fall genutzt."],
  ["verwendet mit Aufruf in Codezeichen ist eine Nutzung", "Legt die Hilfsfunktion `zweiProzesse` an. Der Fall verwendet `zweiProzesse()`."],
  ["ein Satz mit Verneinung nach dem Aufruf bleibt ein Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Der neue Fall ruft `zweiProzesse()` auf und erwartet keinen Fehler."],
  ["ein Aufruf mit nicht nach dem Aufruf bleibt ein Aufruf", "Legt die Hilfsfunktion `zweiProzesse` an. Der neue Fall ruft `zweiProzesse()` auf, nicht `andere()`."],
  ["nicht nur … sondern auch verneint nichts", "Legt die Hilfsfunktion `zweiProzesse` an. Der Fall prüft nicht nur das Ergebnis, sondern auch, dass `zweiProzesse()` aufgerufen wird."],
  ["ein Aufruf in einem Ausdruck in Codezeichen zählt als Aufruf", 'Legt die Hilfsfunktion `zweiProzesse` an. Der neue Fall `test("zwei", () => zweiProzesse())` prüft die Zahl.'],
  ["ein späteres Aufrufe nach ohne Mock verneint den Aufruf nicht", "Legt die Hilfsfunktion `zweiProzesse` an. Der neue Fall ruft `zweiProzesse()` ohne Mock auf und zählt die Aufrufe."],
  ["ein verneinter dass-Satz verneint nur sich selbst", "Legt die Hilfsfunktion `zweiProzesse` an. Der neue Fall ruft `zweiProzesse()` auf, damit feststeht, dass kein Prozess verwendet wird."],
  ["ein Satz, der die Testhilfe in Prosa aufruft, zählt als Nutzung", "Legt die Hilfsfunktion `zweiProzesse` an. Der neue Fall ruft die Testhilfe `zweiProzesse()` auf."],
  ["ein unabhängiges Nicht im Aufrufsatz oder in der Codezeile nimmt dem Aufruf nichts", 'Legt die Hilfsfunktionen `zweiProzesse` und `gesperrt` an. Der neue Fall ruft `zweiProzesse()` auf und prüft, dass nicht gesperrt wird.\nassert.ok(!gesperrt(), "nicht gesperrt");'],
  ["ein Aufruf ohne Argumente und eine Variable namens keiner sind Aufrufe", "Legt die Hilfsfunktionen `zweiProzesse` und `gesperrt` an. Der neue Fall ruft `zweiProzesse()` ohne Argumente auf.\nconst keiner = gesperrt();"],
];

test("auftrag-pruefe-hilfszeilen: jeder grüne Entwurf der Tabelle ist kein Planfehler", (context) => {
  for (const [name, text] of GRUENE_ENTWUERFE) {
    const lauf = pruefe(context, { auftraege: [testumbau()], entwurf: { [TESTDATEI]: text } });
    assert.equal(lauf.status, EXIT_GRUEN, `${name}: ${lauf.stderr}`);
  }
});

test("auftrag-pruefe-hilfszeilen: der echte Entwurf von a0c aus Paket S2a meldet die drei ungenutzten Hilfszeilen", (context) => {
  const lauf = pruefe(context, { auftraege: [testumbau()], entwurf: { [TESTDATEI]: A0C_ENTWURF_AUS_S2A_MIT_PLATZHALTER_NUMMER } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout);
  for (const name of ["windowIndexFor", "zweiProzesse", "sperrenAmErstenProzess"]) assert.match(lauf.stderr, new RegExp(`^a0c: .*${name}`, "m"), name);
  assert.match(lauf.stderr, HINWEIS);
});
