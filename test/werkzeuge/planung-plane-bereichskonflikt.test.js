import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, GRUPPEN, LAUF_FRIST_MS, ORDNER, WEGPRUEFUNGEN, alsJson, angaben, aufrufe, bericht, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";
import { commitAll } from "./probe-repo.js";
import { AUFTRAG, EXIT_BEFUNDE, EXIT_GRUEN, planeAntworten, planungsBericht } from "./planung-plane-probe.js";

const PRODUKT = "src/a.js";
const SKRIPT = "scripts/b.sh";
const KOPPELNDER_TEST = "test/kopplung.test.js";
const NACHBAR = "scripts/c.sh";
const QUELLEN = { [PRODUKT]: "export function richteEin(wert) {\n  return wert;\n}\n", [SKRIPT]: "#!/bin/sh\necho start\n", [KOPPELNDER_TEST]: `// liest ${PRODUKT}, ${SKRIPT} und ${NACHBAR}\n` };

function wurzelMitKonflikt(context) {
  const wurzel = planOrdner(context);
  for (const [pfad, inhalt] of Object.entries(QUELLEN)) {
    mkdirSync(join(wurzel, pfad, ".."), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt);
  }
  commitAll(wurzel, "Konfliktdateien");
  return wurzel;
}

const KONFLIKT_AENDERUNGEN = [
  { datei: PRODUKT, funktion: "richteEin", von: 1, bis: 3, neueZeilen: 2 },
  { datei: SKRIPT, art: "zeilen", von: 2, bis: 2, neueZeilen: 1 },
];
const KONFLIKT_ABSCHNITT = /### Bereichskonflikte\n([\s\S]*?)(?:\n### |$)/u;

function konfliktAbschnitt({ eingabe }) {
  return KONFLIKT_ABSCHNITT.exec(eingabe)?.[1] ?? "";
}

function konfliktLauf(context, ueberschrieben, konfliktNummern = ["S1"]) {
  const konflikte = Object.fromEntries(konfliktNummern.map((nummer) => [nummer, { aenderungen: KONFLIKT_AENDERUNGEN }]));
  const erkundung = { "erkunder|## Erkundung|S1": [bericht(GRUPPEN[0].nummern, konflikte)] };
  return planeIn(context, wurzelMitKonflikt(context), { werkzeug: AUFTRAG, grund: planeAntworten(), argumente: ["plane", ORDNER], ueberschrieben: { ...erkundung, ...ueberschrieben } });
}

test("plane: ein Bereichskonflikt steht in der ersten Zuschnittnachricht, und solange er offen ist, startet nur eine Nachfrage zu seiner Nummer einen Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = konfliktLauf(context, {
    "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo setzt nimmAnruf den Hinweis?" }] }), alsJson({ schnitt: schnittliste() })],
    "planer|## Befunde": [alsJson({ nachfragen: [{ nummern: ["S1"], frage: "Geht S1 ohne scripts/b.sh?" }] })],
    "erkunder|## Nachfrage|S1": [alsJson({ nummern: { S1: angaben("S1") }, hinweise: [] })],
  });

  const [erster, zweiter] = aufrufe(lauf, "planer", "## Zuschnitt");
  const konflikt = konfliktAbschnitt(erster);
  assert.ok(konflikt.includes("S1") && konflikt.includes(PRODUKT) && konflikt.includes(SKRIPT), `(a) erste Zuschnittnachricht ohne Bereichskonflikte zu S1:\n${erster.eingabe}`);

  const nachfragen = aufrufe(lauf, "erkunder", "## Nachfrage");
  const [befunde] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(!nachfragen.some(({ eingabe }) => eingabe.includes("#### S4 (")), "(b) die Nachfrage zu S4 hat einen Erkunder gestartet");
  assert.ok(befunde?.eingabe.includes("Nachfrage 1") && befunde.eingabe.includes("Bereichskonflikt"), `(b) die Nachfrage zu S4 kam nicht als Befund zurück:\n${befunde?.eingabe}`);

  assert.equal(nachfragen.length, 1, "(c) die Nachfrage zu S1 hat nicht genau einen Erkunder gestartet");
  assert.ok(nachfragen[0].eingabe.includes("#### S1 ("));
  assert.equal(konfliktAbschnitt(zweiter), "", "nach der Nachfrage zu S1 ist der Konflikt aufgelöst");
  exit(lauf, EXIT_GRUEN);
});

test("plane: weist plane bei offenem Bereichskonflikt zum zweiten Mal eine Nachfrage ab, auch eine andere als die erste, endet es mit Exit 4 ohne Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const gemischt = alsJson({ nachfragen: [{ nummern: ["S1", "S4"], frage: "Wie hängen S1 und S4 zusammen?" }] });
  const andere = alsJson({ nachfragen: [{ nummern: ["S2"], frage: "Wo prüft bestaetige den Code?" }] });
  const lauf = konfliktLauf(context, { "planer|## Zuschnitt": [gemischt], "planer|## Befunde": [andere] });
  exit(lauf, EXIT_BEFUNDE);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 0);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
  assert.equal(planungsBericht(lauf).grund, "Bereichskonflikt S1: zum zweiten Mal Nachfragen zu anderen Nummern");
});

test("plane: ändert sich der offene Bereichskonflikt nach einer Nachfrage zu seiner Nummer, geht die nächste abgewiesene Nachfrage wieder als Befund zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const zuS4 = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo setzt nimmAnruf den Hinweis?" }] });
  const zu = (nummer) => alsJson({ nachfragen: [{ nummern: [nummer], frage: `Geht ${nummer} ohne scripts/b.sh?` }] });
  const sauber = (nummer) => [alsJson({ nummern: { [nummer]: angaben(nummer) }, hinweise: [] })];
  const lauf = konfliktLauf(context, {
    "planer|## Zuschnitt": [zuS4, zuS4, alsJson({ schnitt: schnittliste() })],
    "planer|## Befunde": [zu("S1"), zu("S7")],
    "erkunder|## Nachfrage|S1": sauber("S1"),
    "erkunder|## Nachfrage|S7": sauber("S7"),
    "pruefer-planung|## Wegprüfung": Array.from({ length: WEGPRUEFUNGEN + 1 }, () => GRUEN_PRUEFLISTE),
  }, ["S1", "S7"]);
  exit(lauf, EXIT_GRUEN);
  const befunde = aufrufe(lauf, "planer", "## Befunde");
  assert.equal(befunde.length, 2);
  assert.ok(befunde[0].eingabe.includes("Bereichskonflikt S1, S7 ist offen"));
  assert.ok(befunde[1].eingabe.includes("Bereichskonflikt S7 ist offen"));
  assert.deepEqual(aufrufe(lauf, "erkunder", "## Nachfrage").map(({ eingabe }) => /^#### (\S+) \(/mu.exec(eingabe)[1]), ["S1", "S7"]);
});

const KOPPELNDER_GRUND = `${KOPPELNDER_TEST} liest beide Dateien`;

function mitListe(listenAuftrag) {
  return alsJson({ schnitt: schnittliste({ erster: { bereich: [SKRIPT, PRODUKT], erwarteteDateien: [PRODUKT, SKRIPT, "test/nummern/eigene-nummer-hinterlegen.test.js"], bereichsgrund: KOPPELNDER_GRUND, ...listenAuftrag } }) });
}

function nachS4MitListe(context, listenAuftrag) {
  return konfliktLauf(context, {
    "planer|## Zuschnitt": [mitListe(listenAuftrag), "Zerlegung passt nicht: Probe"],
    "planer|## Befunde": [alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo setzt nimmAnruf den Hinweis?" }] }), "Zerlegung passt nicht: Probe"],
    "erkunder|## Nachfrage|S4": [alsJson({ nummern: { S4: angaben("S4") }, hinweise: [] })],
  });
}

test("plane: löst die Schnittliste einen Bereichskonflikt mit einer Liste, deren bereichsgrund einen koppelnden Test nennt, startet eine Nachfrage zu einer anderen Nummer ihren Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = nachS4MitListe(context, {});
  const nachfragen = aufrufe(lauf, "erkunder", "## Nachfrage");
  assert.equal(nachfragen.length, 1, `die Nachfrage zu S4 hat keinen Erkunder gestartet:\n${aufrufe(lauf, "planer", "## Befunde").map(({ eingabe }) => eingabe).join("\n")}`);
  assert.ok(nachfragen[0].eingabe.includes("#### S4 ("));
  assert.ok(!aufrufe(lauf, "planer", "## Befunde").some(({ eingabe }) => eingabe.includes("Bereichskonflikt")), "eine Nachfrage kam als Bereichskonflikt zurück");
  assert.equal(konfliktAbschnitt(aufrufe(lauf, "planer", "## Zuschnitt")[1]), "", "die Zuschnittnachricht nach der Nachfrage nennt den gelösten Konflikt");
});

function bleibtOffen(lauf) {
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 0);
  const [, abgewiesen] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(abgewiesen?.eingabe.includes("Bereichskonflikt S1 ist offen"), `die Nachfrage zu S4 kam nicht als Befund zurück:\n${abgewiesen?.eingabe}`);
}

test("plane: nennt der bereichsgrund der Liste keinen koppelnden Test, bleibt der Bereichskonflikt offen und die Nachfrage zu einer anderen Nummer geht als Befund zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  bleibtOffen(nachS4MitListe(context, { bereichsgrund: "die Dateien fallen gemeinsam" }));
});

test("plane: nennt die Liste neben den Konfliktdateien einen Ordner, bleibt der Bereichskonflikt offen und die Nachfrage zu einer anderen Nummer geht als Befund zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  bleibtOffen(nachS4MitListe(context, { bereich: [SKRIPT, PRODUKT, "src/"] }));
});

test("plane: steht die gültige Liste in einem Auftrag, der die Konfliktnummer nicht prüft, bleibt der Bereichskonflikt offen und die Nachfrage zu einer anderen Nummer geht als Befund zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  bleibtOffen(nachS4MitListe(context, { prueft: ["S7", "T2"] }));
});

test("plane: lässt die gültige Liste eine Konfliktdatei weg, bleibt der Bereichskonflikt offen und die Nachfrage zu einer anderen Nummer geht als Befund zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  bleibtOffen(nachS4MitListe(context, { bereich: [NACHBAR, PRODUKT] }));
});
