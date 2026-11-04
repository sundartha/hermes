import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { BESTEHENDER_TEST, GRUEN_PRUEFLISTE, GRUPPEN, LAUF_FRIST_MS, ROUTE, alsJson, aufrufe, bericht, exit, schnittliste } from "./planung-probe.js";
import { A2_BEFUND, ABBRUCH_IM_SCHNITT, EXIT_ABBRUCH, EXIT_BEFUNDE, EXIT_GRUEN, EXIT_PASST_NICHT, SCHNITT_SOFORT, WEGFEHLER, WEG_ZEILE, abgelegt, abgebrochen, antwortMit, fortsetzung, jePruefer, offenePunkte, phaseDatei, plane, planungsBericht, planungsDatei, prueflisteZeilen } from "./planung-plane-probe.js";

const FINGERABDRUCK = "fingerabdruck.json";
const ERSTE_GRUPPE = "erkundung-g1.json";
const ZWEITE_GRUPPE = "erkundung-g2.json";
const NACHFRAGE = "## Nachfrage";
const FALSCH = { datei: ROUTE, art: "liste", von: 9, bis: 9, neueZeilen: 1 };
const RICHTIG = { datei: ROUTE, funktion: "speichereStatus", von: 10, bis: 14, neueZeilen: 1 };
const MIT_FALSCHER = { S7: { aenderungen: [FALSCH] } };
const BERICHTIGT = bericht(["S7"], { S7: { aenderungen: [RICHTIG] } });
const UNVERAENDERT = bericht(["S7"], MIT_FALSCHER);
const ERFUNDEN = bericht(["S7"], { S7: { aenderungen: [{ ...RICHTIG, funktion: "gibtEsNicht" }] } });
const LUECKE = { ...GRUEN_PRUEFLISTE, weglassen: ["weg:S4"] };
const ABBRUCH = ABBRUCH_IM_SCHNITT;
const AUSWEG_SCHLUESSEL = "ausweg:S5:tests";
const AUSWEG_BEFUND = `${BESTEHENDER_TEST} prüft diesen Weg doch`;
const MIT_AUSWEG_BEFUND = { ...GRUEN_PRUEFLISTE, befunde: { [AUSWEG_SCHLUESSEL]: AUSWEG_BEFUND } };
const ZURUECKGEWIESEN = `trifft nicht zu, weil a2 den Code selbst erzeugt (${ROUTE}:5)`;

function standMitFalscherFundstelle(context) {
  const vorher = plane(context, {
    ...ABBRUCH,
    "erkunder|## Erkundung|S1": [bericht(GRUPPEN[0].nummern, MIT_FALSCHER)],
    "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, WEGFEHLER],
    "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern, MIT_FALSCHER)],
  });
  exit(vorher, EXIT_PASST_NICHT);
  assert.deepEqual(offeneZeilen(vorher), [WEG_ZEILE]);
  return vorher;
}

function offeneZeilen(lauf) {
  return abgelegt(lauf, FINGERABDRUCK).zustand.wegOffen.map(({ zeile }) => zeile);
}

function s7Aenderungen(lauf) {
  return abgelegt(lauf, ERSTE_GRUPPE).nummern.S7.aenderungen;
}

function ersterZuschnitt(lauf) {
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(zuschnitt, lauf.stderr);
  return zuschnitt;
}

function kopfzeilen(eingabe) {
  return eingabe.split("\n").filter((zeile) => zeile.startsWith("#### "));
}

test("plane --fortsetzen: eine vom Wegprüfer verworfene Fundstelle wird nur für ihre Nummer nachgefragt, berichtigt, frisch geprüft und ist danach kein Befund mehr", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = standMitFalscherFundstelle(context);
  assert.deepEqual(s7Aenderungen(vorher), [FALSCH]);
  const andereGruppe = readFileSync(planungsDatei(vorher, ZWEITE_GRUPPE), "utf8");
  const s1Vorher = abgelegt(vorher, ERSTE_GRUPPE).nummern.S1;

  const lauf = fortsetzung(context, vorher, { ueberschrieben: { ...SCHNITT_SOFORT, "erkunder|## Nachfrage|S7": [BERICHTIGT] } });

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "planer", "## Gliederung"), []);
  assert.deepEqual(aufrufe(lauf, "erkunder", "## Erkundung"), []);
  const [nachfrage, ...weitere] = aufrufe(lauf, "erkunder", NACHFRAGE);
  assert.deepEqual(weitere, []);
  assert.ok(nachfrage.eingabe.includes(WEG_ZEILE), nachfrage.eingabe);
  assert.deepEqual(new Set(kopfzeilen(nachfrage.eingabe).map((zeile) => zeile.split(" ")[1])), new Set(["S7"]));
  const [wegpruefung, ...weitereWege] = aufrufe(lauf, "pruefer-planung", "## Wegprüfung");
  assert.deepEqual(weitereWege, []);
  assert.ok(wegpruefung.eingabe.includes(RICHTIG.funktion), wegpruefung.eingabe);
  assert.deepEqual(s7Aenderungen(lauf), [RICHTIG]);
  assert.deepEqual(abgelegt(lauf, ERSTE_GRUPPE).nummern.S1, s1Vorher);
  assert.equal(readFileSync(planungsDatei(lauf, ZWEITE_GRUPPE), "utf8"), andereGruppe);
  assert.equal(offenePunkte(ersterZuschnitt(lauf)).includes("Weg S7"), false);
  assert.deepEqual(offeneZeilen(lauf), []);
  assert.equal(existsSync(phaseDatei(lauf)), true);
});

test("plane --fortsetzen: die Berichtigung steht im Fingerabdruck, die nächste Fortsetzung nimmt sie an und startet keinen Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = standMitFalscherFundstelle(context);
  exit(fortsetzung(context, vorher, { ueberschrieben: { ...ABBRUCH, "erkunder|## Nachfrage|S7": [BERICHTIGT] } }), EXIT_PASST_NICHT);

  const lauf = fortsetzung(context, vorher);

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.deepEqual(s7Aenderungen(lauf), [RICHTIG]);
  assert.equal(offenePunkte(ersterZuschnitt(lauf)).includes("Weg S7"), false);
});

test("plane --fortsetzen: eine Berichtigung verbraucht die eine Nachfrage-Welle des Planers nicht", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = standMitFalscherFundstelle(context);
  const frage = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] });

  const lauf = fortsetzung(context, vorher, {
    ueberschrieben: {
      "planer|## Zuschnitt": [frage, alsJson({ schnitt: schnittliste() })],
      "erkunder|## Nachfrage|S7": [BERICHTIGT],
      "erkunder|## Nachfrage|S4": [bericht(["S4"])],
    },
  });

  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", NACHFRAGE).length, 2);
  assert.equal(abgelegt(lauf, FINGERABDRUCK).zustand.nachfrageWellen, 1);
});

test("plane --fortsetzen: eine Fundstelle, die der Wegprüfer auch nach der Nachfrage verwirft, bleibt Befund und wird nicht noch einmal nachgefragt", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = standMitFalscherFundstelle(context);

  const zweite = fortsetzung(context, vorher, {
    ueberschrieben: {
      ...ABBRUCH,
      "erkunder|## Nachfrage|S7": [UNVERAENDERT],
      "erkunder|## Befunde": [UNVERAENDERT],
      "pruefer-planung|## Wegprüfung|S7": [WEGFEHLER, WEGFEHLER],
    },
  });

  exit(zweite, EXIT_PASST_NICHT);
  assert.deepEqual(s7Aenderungen(zweite), [FALSCH]);
  assert.deepEqual(offeneZeilen(zweite), [WEG_ZEILE]);
  assert.ok(offenePunkte(ersterZuschnitt(zweite)).includes(`- ${WEG_ZEILE}`), ersterZuschnitt(zweite).eingabe);
  assert.deepEqual(planungsBericht(zweite).wegpruefungen.at(-1).offen, [WEG_ZEILE]);

  const dritte = fortsetzung(context, vorher, { ueberschrieben: SCHNITT_SOFORT });

  exit(dritte, EXIT_GRUEN);
  assert.deepEqual(aufrufe(dritte, "erkunder"), []);
  assert.ok(offenePunkte(ersterZuschnitt(dritte)).includes(`- ${WEG_ZEILE}`), ersterZuschnitt(dritte).eingabe);
  assert.ok(aufrufe(dritte, "pruefer-planung", "## Prüfung").flatMap(prueflisteZeilen).includes("weg:S7"));
});

test("plane --fortsetzen: hat der Erkunder berichtigt und der Wegprüfer findet danach etwas anderes, fragt die nächste Fortsetzung erneut nach", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = standMitFalscherFundstelle(context);

  const zweite = fortsetzung(context, vorher, {
    ueberschrieben: {
      ...ABBRUCH,
      "erkunder|## Nachfrage|S7": [BERICHTIGT],
      "erkunder|## Befunde": [BERICHTIGT],
      "pruefer-planung|## Wegprüfung|S7": [WEGFEHLER, WEGFEHLER],
    },
  });

  exit(zweite, EXIT_PASST_NICHT);
  assert.deepEqual(s7Aenderungen(zweite), [RICHTIG]);
  assert.deepEqual(offeneZeilen(zweite), [WEG_ZEILE]);

  const dritte = fortsetzung(context, vorher, { ueberschrieben: { ...SCHNITT_SOFORT, "erkunder|## Nachfrage|S7": [BERICHTIGT] } });

  exit(dritte, EXIT_GRUEN);
  assert.equal(aufrufe(dritte, "erkunder", NACHFRAGE).length, 1);
  assert.deepEqual(offeneZeilen(dritte), []);
});

test("plane --fortsetzen: eine Berichtigung, die die Skriptprüfung nicht besteht, ändert den Bericht nicht und lässt den Befund stehen", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = standMitFalscherFundstelle(context);

  const lauf = fortsetzung(context, vorher, { ueberschrieben: { ...ABBRUCH, "erkunder|## Nachfrage|S7": [ERFUNDEN], "erkunder|## Befunde": [ERFUNDEN] } });

  exit(lauf, EXIT_PASST_NICHT);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung", "## Wegprüfung"), []);
  assert.deepEqual(s7Aenderungen(lauf), [FALSCH]);
  assert.deepEqual(offeneZeilen(lauf), [WEG_ZEILE]);
});

test("plane --fortsetzen: ein offener Punkt, der nur eine Lücke der Prüfliste nennt, startet keinen Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context, { "pruefer-planung|## Wegprüfung|S4": [LUECKE], "pruefer-planung|## Befunde": [LUECKE] });
  assert.notDeepEqual(offeneZeilen(vorher), []);

  const lauf = fortsetzung(context, vorher);

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.ok(offenePunkte(ersterZuschnitt(lauf)).includes("Weg S4, S5, B1:"), ersterZuschnitt(lauf).eingabe);
});

test("plane --fortsetzen: ein offener Prüfbefund an einem Ausweg der Erkundung wird in der nächsten Fortsetzung nachgefragt und berichtigt", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = plane(context, {
    "erkunder|## Erkundung|S4": [bericht(GRUPPEN[1].nummern, { S5: { tests: "nicht gefunden, weil kein Test diesen Weg prüft" } })],
    "pruefer-planung|## Prüfung": jePruefer(MIT_AUSWEG_BEFUND),
    "planer|## Befunde": [antwortMit(schnittliste(), [{ schluessel: AUSWEG_SCHLUESSEL, antwort: `trifft nicht zu, weil kein Test diesen Weg prüft (${ROUTE}:5)` }])],
    "pruefer-planung|## Nachprüfung": [MIT_AUSWEG_BEFUND],
  });
  exit(vorher, EXIT_BEFUNDE);

  const lauf = fortsetzung(context, vorher, { ueberschrieben: { ...SCHNITT_SOFORT, "erkunder|## Nachfrage|S5": [bericht(["S5"])] } });

  exit(lauf, EXIT_GRUEN);
  const [nachfrage] = aufrufe(lauf, "erkunder", NACHFRAGE);
  assert.ok(nachfrage.eingabe.includes(AUSWEG_BEFUND), nachfrage.eingabe);
  assert.deepEqual(abgelegt(lauf, ZWEITE_GRUPPE).nummern.S5.tests, [BESTEHENDER_TEST]);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").flatMap(prueflisteZeilen).includes(AUSWEG_SCHLUESSEL), false);
  assert.deepEqual(offeneZeilen(lauf), []);
});

function gruenGeprueftMitOffenemPunkt(context) {
  const vorher = plane(context, {
    "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, WEGFEHLER],
    "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern)],
    [`entwurf|## Entwurf|${ROUTE}`]: [{ absturz: { exit: 1, fehler: "Entwurf abgestürzt" } }],
  });
  exit(vorher, EXIT_ABBRUCH);
  assert.deepEqual(offeneZeilen(vorher), [WEG_ZEILE]);
  assert.equal(existsSync(planungsDatei(vorher, "geprueft.json")), true);
  return vorher;
}

test("plane --fortsetzen: verwirft das Skript den geprüften Schnitt, gilt die Prüfung nicht weiter, und der offene Punkt wird nachgefragt", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = gruenGeprueftMitOffenemPunkt(context);
  const schnitt = JSON.stringify({ ...abgelegt(vorher, "schnitt.json"), auftraege: [] });
  writeFileSync(planungsDatei(vorher, "schnitt.json"), schnitt);
  writeFileSync(planungsDatei(vorher, "geprueft.json"), JSON.stringify({ ...abgelegt(vorher, "geprueft.json"), schnitt: createHash("sha256").update(schnitt).digest("hex") }));

  const lauf = fortsetzung(context, vorher, { ueberschrieben: { ...SCHNITT_SOFORT, "erkunder|## Nachfrage|S7": [BERICHTIGT] } });

  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", NACHFRAGE).length, 1);
  assert.deepEqual(offeneZeilen(lauf), []);
});

test("plane --fortsetzen: nach einer grünen Prüfung startet ein offener Punkt keinen Erkunder mehr, und die Prüfung gilt weiter", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = fortsetzung(context, gruenGeprueftMitOffenemPunkt(context));

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung"), []);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
});

function geendetMitPruefbefund(context) {
  const vorher = plane(context, {
    "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND),
    "planer|## Befunde": [antwortMit(schnittliste(), [{ schluessel: "allein-gruen:a2", antwort: ZURUECKGEWIESEN }])],
    "pruefer-planung|## Nachprüfung": [A2_BEFUND],
  });
  exit(vorher, EXIT_BEFUNDE);
  return vorher;
}

test("plane --fortsetzen: der Planer bekommt seinen letzten Schnitt und die Befunde des vorigen Laufs und behält ihn mit einer leeren Teilliste; Prüfer und Skript prüfen trotzdem", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = geendetMitPruefbefund(context);
  const schnitt = abgelegt(vorher, "schnitt.json");
  const [offen] = planungsBericht(vorher).befunde.offen;

  const lauf = fortsetzung(context, vorher, { ueberschrieben: { "planer|## Zuschnitt": [alsJson({ teilliste: {} })] } });

  exit(lauf, EXIT_GRUEN);
  const { eingabe } = ersterZuschnitt(lauf);
  assert.ok(eingabe.includes(JSON.stringify(schnitt, null, 2)), eingabe);
  assert.ok(eingabe.includes(offen), eingabe);
  assert.ok(eingabe.includes(ZURUECKGEWIESEN), eingabe);
  assert.deepEqual(abgelegt(lauf, "schnitt.json"), schnitt);
  assert.ok(aufrufe(lauf, "pruefer-planung", "## Prüfung").flatMap(prueflisteZeilen).includes("allein-gruen:a2"));
});

test("plane --fortsetzen: ein behaltener Schnitt, den das Skript verwirft, endet wie ein neuer mit Befunden", { timeout: LAUF_FRIST_MS }, (context) => {
  const schlecht = alsJson({ schnitt: schnittliste({ erster: { prueft: ["S1", "T2"] } }) });
  const vorher = plane(context, { "planer|## Zuschnitt": [schlecht], "planer|## Befunde": [schlecht] });
  exit(vorher, EXIT_BEFUNDE);
  const behalten = alsJson({ teilliste: {} });

  const lauf = fortsetzung(context, vorher, { ueberschrieben: { "planer|## Zuschnitt": [behalten], "planer|## Befunde": [behalten] } });

  exit(lauf, EXIT_BEFUNDE);
  assert.equal(existsSync(phaseDatei(lauf)), false);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung", "## Prüfung"), []);
});
