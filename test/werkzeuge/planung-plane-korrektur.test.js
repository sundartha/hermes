import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FUNDSTELLE, GRUEN_PRUEFLISTE, GRUPPEN, HINWEIS, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, schnittliste } from "./planung-probe.js";
import { A2_ANTWORT, A2_BEFUND, A2_KORRIGIERT, antwortMit, auftragAus, EXIT_BEFUNDE, EXIT_GRUEN, geplanteListe, jePruefer, korrektur, MIT_NUMMER, OHNE_NUMMER, phaseDatei, plane, planungsBericht, prueflisteZeilen, zusatz } from "./planung-plane-probe.js";

test("plane: ein Skriptbefund nach der Korrektur geht an den Planer zurück und die Planung endet grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(OHNE_NUMMER), antwortMit(MIT_NUMMER)] });
  exit(lauf, EXIT_GRUEN);
  assert.equal(existsSync(phaseDatei(lauf)), true);
  const [, ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung.eingabe.includes("a14"), ruecksendung.eingabe);
  const { korrigiert } = planungsBericht(lauf).befunde;
  assert.equal(korrigiert.filter(({ schluessel }) => schluessel === "allein-gruen:a2").length, 1);
});

test("plane: ein Skriptbefund, der nach der Korrektur wiederkehrt, endet mit Exit 4 und planung/schnitt.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(OHNE_NUMMER), antwortMit(OHNE_NUMMER)] });
  exit(lauf, EXIT_BEFUNDE);
  assert.match(planungsBericht(lauf).grund, /wiederkehrend/u);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung", "schnitt.json")), true);
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: endet die Korrektur mit Exit 4, stehen die Befunde des Prüfers mit der letzten Antwort des Planers je einmal unter offen", { timeout: LAUF_FRIST_MS }, (context) => {
  const zurueck = `trifft nicht zu, weil a3 den Status selbst setzt (${ROUTE}:5)`;
  const drei = { ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": "a2 braucht den Code aus a1", "nie-saetze:a3": "a3 nennt keinen Nie-Satz", "gegenfrage:alle": "S5 fehlt im Plan" } };
  const antworten = [...A2_ANTWORT, { schluessel: "nie-saetze:a3", antwort: zurueck }];
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(drei), "planer|## Befunde": [antwortMit(OHNE_NUMMER, antworten), antwortMit(OHNE_NUMMER, antworten)] });
  exit(lauf, EXIT_BEFUNDE);
  const { offen, korrigiert, zurueckgewiesen } = planungsBericht(lauf).befunde;
  const erwartet = [
    `allein-gruen:a2: a2 braucht den Code aus a1 (Fundstelle: ${FUNDSTELLE}) | korrigiert: a2 liest den Code aus a1`,
    `nie-saetze:a3: a3 nennt keinen Nie-Satz (Fundstelle: ${FUNDSTELLE}) | ${zurueck}`,
    `gegenfrage:alle: S5 fehlt im Plan (Fundstelle: ${FUNDSTELLE})`,
  ];
  for (const zeile of erwartet) assert.equal(offen.filter((eintrag) => eintrag === zeile).length, 1, `${zeile} nicht genau einmal in\n${offen.join("\n")}`);
  assert.ok(offen.includes("gegenfrage:alle: Befund des Prüfers ohne Antwort des Planers"), offen.join("\n"));
  assert.deepEqual([korrigiert, zurueckgewiesen], [[], []]);
});

test("plane: eine Korrektur ohne weniger Befunde endet mit Exit 4",{ timeout: LAUF_FRIST_MS }, (context) => {
  const anderer = korrektur({ a2: A2_KORRIGIERT, a3: { prueft: ["S4", "B1"] }, dazu: [zusatz("a14", ["S5"]), zusatz("a15", [])] });
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(OHNE_NUMMER), antwortMit(anderer)] });
  exit(lauf, EXIT_BEFUNDE);
  assert.match(planungsBericht(lauf).grund, /sank nicht/u);
});

test("plane: nach drei Rücksendungen endet die Schleife mit Exit 4", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneNummern = (...kennungen) => alsJson({ schnitt: korrektur({ dazu: kennungen.map((id) => zusatz(id, [])) }) });
  const lauf = plane(context, {
    "planer|## Zuschnitt": [ohneNummern("a14", "a15", "a16", "a17")],
    "planer|## Befunde": [ohneNummern("a18", "a19", "a20"), ohneNummern("a21", "a22"), ohneNummern("a23")],
  });
  exit(lauf, EXIT_BEFUNDE);
  assert.match(planungsBericht(lauf).grund, /nach 3 Rücksendungen$/u);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 3);
});

test("plane: Antwortbefund und Skriptbefund derselben Korrektur gehen zusammen zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const zweiOhne = korrektur({ dazu: [zusatz("a14", []), zusatz("a15", [])] });
  const doppelt = korrektur({ a2: A2_KORRIGIERT, a3: { prueft: ["S4", "B1"] }, dazu: [zusatz("a14", ["S5"]), zusatz("a15", ["B1"])] });
  const sauber = korrektur({ a2: A2_KORRIGIERT, a3: { prueft: ["S4"] }, dazu: [zusatz("a14", ["S5"]), zusatz("a15", ["B1"])] });
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(zweiOhne, []), antwortMit(doppelt), antwortMit(sauber)] });
  exit(lauf, EXIT_GRUEN);
  const [, erste, zweite] = aufrufe(lauf, "planer", "## Befunde");
  for (const teil of ["allein-gruen:a2: Befund des Prüfers ohne Antwort des Planers", "a14: funktion ohne Nummer", "a15: funktion ohne Nummer"]) assert.ok(erste.eingabe.includes(teil), `${teil} fehlt in\n${erste.eingabe}`);
  assert.ok(zweite.eingabe.includes("B1 steht mehrfach"), zweite.eingabe);
  assert.equal(zweite.eingabe.includes("ohne Antwort des Planers"), false);
});

test("plane: eine Änderung mit neuem Auftrag ohne Nummer geht als Skriptbefund zurück und endet nach der Korrektur grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneNummer = alsJson({ teilliste: { auftraege: [auftragAus(schnittliste(), "a2", A2_KORRIGIERT), zusatz("a14", [])] }, antworten: A2_ANTWORT });
  const mitNummer = alsJson({ teilliste: { auftraege: [auftragAus(schnittliste(), "a3", { prueft: ["S4", "B1"] }), zusatz("a14", ["S5"])] }, antworten: A2_ANTWORT });
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [ohneNummer, mitNummer] });
  exit(lauf, EXIT_GRUEN);
  const [, ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung.eingabe.includes("a14: funktion ohne Nummer"), ruecksendung.eingabe);
  assert.deepEqual(geplanteListe(lauf), MIT_NUMMER);
  const { korrigiert } = planungsBericht(lauf).befunde;
  assert.equal(korrigiert.filter(({ schluessel }) => schluessel === "allein-gruen:a2").length, 1);
  assert.equal(existsSync(phaseDatei(lauf)), true);
});

test("plane: schnitt und teilliste zugleich sind ein Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const beides = alsJson({ schnitt: schnittliste(), teilliste: { auftraege: [zusatz("a14", ["S5"])] } });
  const lauf = plane(context, { "planer|## Zuschnitt": [beides], "planer|## Befunde": [alsJson({ schnitt: schnittliste() })] });
  exit(lauf, EXIT_GRUEN);
  const [ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung.eingabe.includes("Regel Teilliste: schnitt und teilliste zugleich; schick eines"), ruecksendung.eingabe);
  assert.deepEqual(geplanteListe(lauf), schnittliste());
});

test("plane: eine teilliste vor der ersten Schnittliste ist ein Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Zuschnitt": [alsJson({ teilliste: { auftraege: [zusatz("a14", ["S5"])] } })], "planer|## Befunde": [alsJson({ schnitt: schnittliste() })] });
  exit(lauf, EXIT_GRUEN);
  const [ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung.eingabe.includes("Regel Teilliste: teilliste gibt es erst nach einer Schnittliste"), ruecksendung.eingabe);
});

test("plane: der Planer liest verdichtete Berichte, Prüfer und Entwurf-Schreiber den Volltext", { timeout: LAUF_FRIST_MS }, (context) => {
  const nachfrage = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] });
  const lauf = plane(context, { "planer|## Zuschnitt": [nachfrage, alsJson({ schnitt: schnittliste() })], "erkunder|## Nachfrage|S4": [bericht(["S4"])] });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt, nachNachfrage] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(zuschnitt.eingabe.includes("### Erkundungsberichte (verdichtet)"), zuschnitt.eingabe);
  assert.ok(zuschnitt.eingabe.includes(`weg: eingang ${ROUTE} hinterlege 2–4 · wirkung ${ROUTE} speichereStatus 10–14`), zuschnitt.eingabe);
  assert.ok(nachNachfrage.eingabe.includes("Frage: Wo liegt der Hinweis?"), nachNachfrage.eingabe);
  assert.ok(nachNachfrage.eingabe.includes(`weg: eingang ${HINWEIS} nimmAnruf 1–4 · wirkung ${HINWEIS} setzeHinweis 6–9`), nachNachfrage.eingabe);
  for (const planer of [zuschnitt, nachNachfrage]) assert.equal(planer.eingabe.includes('"nummern": {'), false);
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  for (const { nummern: [erste] } of GRUPPEN) {
    const pruefer = pruefungen.find((eintrag) => prueflisteZeilen(eintrag).includes(`weg:${erste}`));
    assert.ok(pruefer.eingabe.includes(`"${erste}": {`), `Volltext zu ${erste} fehlt beim Prüfer`);
  }
  for (const entwurf of aufrufe(lauf, "entwurf", "## Entwurf")) assert.ok(entwurf.eingabe.includes('"nummern": {'), entwurf.eingabe);
});

test("plane: der Erkunder bekommt das Gerüst und die Namen aus dem Wenn", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context);
  exit(lauf, EXIT_GRUEN);
  const erkundung = aufrufe(lauf, "erkunder", "## Erkundung").find(({ eingabe }) => eingabe.includes("#### S1 ("));
  const [, geruest] = erkundung.eingabe.split("### Gerüst deines Berichts");
  for (const nummer of GRUPPEN[0].nummern) assert.ok(geruest.includes(`"${nummer}": {`), geruest);
  assert.ok(geruest.includes('"eingangImTest": "<AUSFUELLEN>"'), geruest);
  const [, namen] = erkundung.eingabe.split("### Namen aus dem Wenn, die in deiner Eingangsdatei stehen müssen");
  assert.ok(namen.includes("- S1: `POST /api/self-service/private-number`\n"), namen);
  assert.ok(namen.includes("- T2: `POST /api/self-service/private-number`\n"), namen);
});
