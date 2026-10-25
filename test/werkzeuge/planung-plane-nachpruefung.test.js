import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { FUNDSTELLE, GRUEN_PRUEFLISTE, GRUPPEN, LAUF_FRIST_MS, ROUTE, alsJson, aufrufe, exit, schnittliste } from "./planung-probe.js";
import { A2_ANTWORT, A2_BEFUND, A2_KORRIGIERT, abgelegt, antwortMit, auftragAus, EXIT_ABBRUCH, EXIT_BEFUNDE, EXIT_GRUEN, jePruefer, MIT_NUMMER, phaseDatei, plane, planungsBericht, prueflisteZeilen, UEBERGREIFENDER_PRUEFER, WARTEN_MS, zeilenDes } from "./planung-plane-probe.js";

test("plane: die Gruppenprüfer und der übergreifende Prüfer laufen gleichzeitig und ihre Befunde gehen in einer Rücksendung an den Planer", { timeout: LAUF_FRIST_MS }, (context) => {
  const langsam = { ...GRUEN_PRUEFLISTE, warte: WARTEN_MS, befunde: { "nie-saetze:a1": "a1 nennt keinen Nie-Satz", "allein-gruen:a2": "a2 braucht den Code aus a1" } };
  const teilliste = { auftraege: [auftragAus(schnittliste(), "a1", { ziel: "Ziel a1 mit Nie-Satz" }), auftragAus(schnittliste(), "a2", A2_KORRIGIERT)] };
  const antworten = [{ schluessel: "nie-saetze:a1", antwort: "korrigiert: a1 nennt den Nie-Satz" }, ...A2_ANTWORT];
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(langsam), "planer|## Befunde": [alsJson({ teilliste, antworten })] });
  exit(lauf, EXIT_GRUEN);
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  assert.equal(pruefungen.length, GRUPPEN.length + UEBERGREIFENDER_PRUEFER);
  const spaetesterStart = Math.max(...pruefungen.map(({ start }) => start));
  const fruehestesEnde = Math.min(...pruefungen.map(({ ende }) => ende));
  assert.ok(spaetesterStart < fruehestesEnde, `Prüfer laufen nicht gleichzeitig: ${spaetesterStart} ≥ ${fruehestesEnde}`);
  const [ruecksendung, ...weitere] = aufrufe(lauf, "planer", "## Befunde");
  assert.equal(weitere.length, 0);
  for (const schluessel of ["nie-saetze:a1", "allein-gruen:a2"]) assert.ok(ruecksendung.eingabe.includes(`${schluessel}: `), ruecksendung.eingabe);
  const zeilen = pruefungen.flatMap(prueflisteZeilen);
  const pruefliste = abgelegt(lauf, "pruefliste.json");
  const wege = pruefliste.filter(({ schluessel }) => schluessel.startsWith("weg:"));
  assert.deepEqual(zeilen.toSorted(), pruefliste.filter((zeile) => !wege.includes(zeile)).map(({ schluessel }) => schluessel).toSorted());
  assert.equal(wege.length, GRUPPEN.flatMap(({ nummern }) => nummern).length);
  for (const zeile of wege) assert.deepEqual(zeile, { schluessel: zeile.schluessel, ergebnis: "erfüllt", fundstelle: FUNDSTELLE });
  assert.deepEqual(abgelegt(lauf, "pruefliste-aufteilung.json").map(({ gruppe }) => gruppe), [...GRUPPEN.keys(), null]);
  const uebergreifend = pruefungen.find((eintrag) => prueflisteZeilen(eintrag).includes("gegenfrage:alle"));
  for (const teil of ["### Erkundungsberichte (verdichtet)", "### Dateikarte", `weg: eingang ${ROUTE} hinterlege 2–4`]) assert.ok(uebergreifend.eingabe.includes(teil), teil);
  assert.equal(uebergreifend.eingabe.includes('"nummern": {'), false);
});

test("plane: nach der Korrektur prüft ein frischer Prüfer genau die Nachprüf-Schlüssel", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(MIT_NUMMER)] });
  exit(lauf, EXIT_GRUEN);
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  const [nachpruefung, ...weitere] = aufrufe(lauf, "pruefer-planung", "## Nachprüfung");
  assert.equal(weitere.length, 0);
  assert.equal(nachpruefung.resume, false);
  assert.equal(pruefungen.some(({ sitzung }) => sitzung === nachpruefung.sitzung), false);
  assert.deepEqual(prueflisteZeilen(nachpruefung), ["durchstich:a1", "b-nummer:B1", ...zeilenDes("a2"), ...zeilenDes("a3"), ...zeilenDes("a14"), "gegenfrage:alle"]);
  assert.ok(nachpruefung.eingabe.includes("allein-gruen:a2: a2 braucht den Code aus a1 | korrigiert: a2 liest den Code aus a1"));
  assert.equal(planungsBericht(lauf).nachpruefungen[0].sitzung, nachpruefung.sitzung);
});

test("plane: ein zurückgewiesener Befund, den die Nachprüfung bestätigt, endet mit Exit 4 und beiden Texten im Bericht", { timeout: LAUF_FRIST_MS }, (context) => {
  const antwort = `trifft nicht zu, weil a2 den Code selbst erzeugt (${ROUTE}:5)`;
  const bestaetigt = "a2 liest den Code aus a1, den a2 nicht erzeugt";
  const lauf = plane(context, {
    "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND),
    "planer|## Befunde": [antwortMit(schnittliste(), [{ schluessel: "allein-gruen:a2", antwort }])],
    "pruefer-planung|## Nachprüfung": [{ ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": bestaetigt } }],
  });
  exit(lauf, EXIT_BEFUNDE);
  const { grund, befunde } = planungsBericht(lauf);
  assert.match(grund, /wiederkehrend/u);
  assert.deepEqual(befunde.zurueckgewiesen, [{ schluessel: "allein-gruen:a2", befund: "a2 braucht den Code aus a1", antwort }]);
  assert.deepEqual(befunde.offen, [`allein-gruen:a2: ${bestaetigt} (Fundstelle: ${FUNDSTELLE})`]);
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: ein neuer Befund der Nachprüfung geht an den Planer zurück und endet nach der zweiten Nachprüfung grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const zwei = { ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": "a2 braucht den Code aus a1", "nie-saetze:a3": "a3 nennt keinen Nie-Satz" } };
  const ersteAntworten = [...A2_ANTWORT, { schluessel: "nie-saetze:a3", antwort: "korrigiert: a3 gibt S5 an a14 ab" }];
  const a14Korrigiert = { ...MIT_NUMMER, auftraege: MIT_NUMMER.auftraege.map((eintrag) => (eintrag.id === "a14" ? { ...eintrag, ziel: "Ziel a14 ohne Anruf" } : eintrag)) };
  const lauf = plane(context, {
    "pruefer-planung|## Prüfung": jePruefer(zwei),
    "planer|## Befunde": [antwortMit(MIT_NUMMER, ersteAntworten), antwortMit(a14Korrigiert, [{ schluessel: "allein-gruen:a14", antwort: "korrigiert: a14 ruft nicht an" }])],
    "pruefer-planung|## Nachprüfung": [{ ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a14": "a14 braucht einen Anruf aus a3" } }, GRUEN_PRUEFLISTE],
  });
  exit(lauf, EXIT_GRUEN);
  const beleg = planungsBericht(lauf);
  const [erste, zweite] = aufrufe(lauf, "pruefer-planung", "## Nachprüfung");
  assert.deepEqual(beleg.nachpruefungen.map(({ runde, sitzung, befunde }) => [runde, sitzung, befunde]), [[1, erste.sitzung, 1], [2, zweite.sitzung, 0]]);
  assert.notEqual(erste.sitzung, zweite.sitzung);
  const pruefung = beleg.schleifen.find(({ art }) => art === "pruefung");
  assert.deepEqual(pruefung.runden.map(({ zahl }) => zahl), [2, 1]);
  assert.equal(existsSync(phaseDatei(lauf)), true);
});

test("plane: ein Nachprüfer, der eine Datei ändert, bricht mit Exit 1 ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(MIT_NUMMER)], "pruefer-planung|## Nachprüfung": [{ ...GRUEN_PRUEFLISTE, schreibe: ROUTE }] });
  exit(lauf, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, `pruefer-planung haben ${ROUTE} geändert`);
});
