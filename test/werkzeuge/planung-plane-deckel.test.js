import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, KENNUNG, LAUF_FRIST_MS, ORDNER, ROUTE, WEGPRUEFUNGEN, alsJson, aufrufe, bericht, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";
import { AUFTRAG, EXIT_AUFRUF, EXIT_GRUEN, abgelegt, planeAntworten, planungsBericht } from "./planung-plane-probe.js";

const EXIT_DECKEL = 5;
const MIO = 1_000_000;
const DECKEL_FREIGABE = 15 * MIO;
const DECKEL_OHNE_WIRKUNG = 1000 * MIO;
const PLANER_ANTWORTEN_BIS_NACHFRAGE = 2;
const PRUEFER_LAUF_VORHER = 100 * MIO;
const DECKEL_UNTER_ERSTER_WELLE = 4 * MIO;
const PLANER = 100_000;
const ERKUNDER = MIO;
const WEGPRUEFER = 340_000;
const ERKUNDER_LAUF = ERKUNDER + WEGPRUEFER;
const TOKEN = { planer: PLANER, erkunder: ERKUNDER, "pruefer-planung": WEGPRUEFER, entwurf: PLANER };
const ERSTE_WELLE = 3;
const ZWEITE_WELLE = 12;
const NACHFRAGE_NUMMERN = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "T1", "T2", "B1", "S1", "S2"];
const FREIGABE_ZEILE = /^Planung freigegeben: .*\n/m;
const NACHFRAGEN = NACHFRAGE_NUMMERN.map((nummer) => ({ nummern: [nummer], frage: `Wo endet der Weg von ${nummer}?` }));

function zwoelfNachfragen() {
  const antworten = {};
  for (const nummer of NACHFRAGE_NUMMERN) (antworten[`erkunder|## Nachfrage|${nummer}`] ??= []).push(bericht([nummer]));
  return {
    ...antworten,
    "planer|## Zuschnitt": [alsJson({ nachfragen: NACHFRAGEN }), alsJson({ schnitt: schnittliste() })],
    "pruefer-planung|## Wegprüfung": Array.from({ length: WEGPRUEFUNGEN + ZWEITE_WELLE }, () => GRUEN_PRUEFLISTE),
  };
}

function planeMitToken(context, wurzel, { argumente = [], ueberschrieben = {} } = {}) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER, ...argumente], token: TOKEN });
}

function planungsDatei({ wurzel }, name) {
  return join(wurzel, ORDNER, "planung", name);
}

function pitchFreigabe(wurzel, zeile) {
  const datei = join(wurzel, ORDNER, "pitch.md");
  writeFileSync(datei, readFileSync(datei, "utf8").replace(FREIGABE_ZEILE, zeile));
  return wurzel;
}

test("plane ohne --deckel: liegen gemessene Kosten und Vorschau der zweiten Welle über der im Pitch freigegebenen Menge, endet plane vor ihr mit Exit 5, ohne einen ihrer Erkunder zu starten", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, pitchFreigabe(planOrdner(context), `Planung freigegeben: ${DECKEL_FREIGABE} Token\n`), { ueberschrieben: zwoelfNachfragen() });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "erkunder", "## Erkundung").length, ERSTE_WELLE);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 0);
  assert.equal(existsSync(planungsDatei(lauf, "fingerabdruck.json")), true);
  const gemessen = PLANER_ANTWORTEN_BIS_NACHFRAGE * PLANER + ERSTE_WELLE * ERKUNDER_LAUF;
  assert.deepEqual(planungsBericht(lauf).deckel, { deckel: DECKEL_FREIGABE, gemessen, vorschau: ZWEITE_WELLE * ERKUNDER_LAUF });
});

test("plane --deckel geht vor die im Pitch freigegebene Menge: derselbe Lauf startet alle 12 Erkunder der zweiten Welle und plant grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = pitchFreigabe(planOrdner(context), `Planung freigegeben: ${DECKEL_FREIGABE} Token\n`);
  const lauf = planeMitToken(context, wurzel, { argumente: ["--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben: zwoelfNachfragen() });

  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, ZWEITE_WELLE);
});

function nachfrageWellen(lauf) {
  return abgelegt(lauf, "fingerabdruck.json").zustand.nachfrageWellen;
}

function eineWelleMitZwoelfErkundern(lauf) {
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, ZWEITE_WELLE);
  assert.equal(nachfrageWellen(lauf), 1);
}

test("plane: zwölf Nachfragen in einer Antwort sind eine Nachfrage-Welle", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben: zwoelfNachfragen() });

  eineWelleMitZwoelfErkundern(lauf);
});

test("plane --fortsetzen nach Exit 5 vor der Nachfrage-Welle: die Welle ist nicht verbraucht, und ein Fortsetzen mit größerem Deckel lässt sie erkunden", { timeout: LAUF_FRIST_MS }, (context) => {
  const gestoppt = planeMitToken(context, pitchFreigabe(planOrdner(context), `Planung freigegeben: ${DECKEL_FREIGABE} Token\n`), { ueberschrieben: zwoelfNachfragen() });
  exit(gestoppt, EXIT_DECKEL);
  assert.equal(nachfrageWellen(gestoppt), 0);

  const lauf = planeMitToken(context, gestoppt.wurzel, { argumente: ["--fortsetzen", "--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben: zwoelfNachfragen() });

  eineWelleMitZwoelfErkundern(lauf);
});

function ohneFreigabe(context, zeile) {
  const lauf = planeMitToken(context, pitchFreigabe(planOrdner(context), zeile));

  exit(lauf, EXIT_AUFRUF);
  assert.match(lauf.stderr, /Planung freigegeben: <Zahl> Token/);
  assert.equal(aufrufe(lauf, "planer").length, 0);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung")), false);
}

test("plane ohne --deckel, Pitch ohne Zeile „Planung freigegeben“: plane endet mit Exit 2, nennt die Zeile und startet keinen Agenten", { timeout: LAUF_FRIST_MS }, (context) => {
  ohneFreigabe(context, "");
});

test("plane ohne --deckel, Pitch mit einer Menge, die keine ganze Zahl ist: plane endet mit Exit 2, nennt die Zeile und startet keinen Agenten", { timeout: LAUF_FRIST_MS }, (context) => {
  ohneFreigabe(context, "Planung freigegeben: 15 Mio. Token\n");
});

function ungueltigerDeckel(context, angabe) {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", angabe] });

  exit(lauf, EXIT_AUFRUF);
  assert.match(lauf.stderr, new RegExp(`--deckel braucht eine ganze Zahl Token über 0, nicht ${angabe}`));
  assert.equal(aufrufe(lauf, "planer").length, 0);
}

test("plane --deckel 0: plane endet mit Exit 2, nennt die Angabe und startet keinen Agenten", { timeout: LAUF_FRIST_MS }, (context) => {
  ungueltigerDeckel(context, "0");
});

test("plane --deckel 15Mio: plane endet mit Exit 2, nennt die Angabe und startet keinen Agenten", { timeout: LAUF_FRIST_MS }, (context) => {
  ungueltigerDeckel(context, "15Mio");
});

test("plane --deckel: liegt die Vorschau der Prüfliste aus dem vorigen Lauf über dem Deckel, endet plane nach der Erkundung mit Exit 5, ohne einen Prüfer der Prüfliste zu starten", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  mkdirSync(join(wurzel, ".fortschritt", KENNUNG), { recursive: true });
  writeFileSync(join(wurzel, ".fortschritt", KENNUNG, "planung.json"), JSON.stringify({ kostenJeLauf: { "pruefer-planung": { laeufe: 1, token: PRUEFER_LAUF_VORHER } } }));

  const lauf = planeMitToken(context, wurzel, { argumente: ["--deckel", String(DECKEL_FREIGABE)] });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "erkunder", "## Erkundung").length, ERSTE_WELLE);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, 0);
  assert.ok(planungsBericht(lauf).deckel.vorschau >= PRUEFER_LAUF_VORHER);
});

test("plane --deckel: vor der ersten Welle gilt der Mittelwert je Erkunder-Lauf aus planung.json des vorigen Laufs", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  const erster = planeMitToken(context, wurzel, { argumente: ["--deckel", String(DECKEL_OHNE_WIRKUNG)] });
  exit(erster, EXIT_GRUEN);
  rmSync(join(wurzel, ORDNER, "phase.json"));
  rmSync(join(wurzel, ORDNER, "planung"), { recursive: true });

  const zweiter = planeMitToken(context, wurzel, { argumente: ["--deckel", String(DECKEL_UNTER_ERSTER_WELLE)] });

  exit(zweiter, EXIT_DECKEL);
  assert.equal(aufrufe(zweiter, "erkunder").length, 0);
  assert.deepEqual(planungsBericht(zweiter).deckel, { deckel: DECKEL_UNTER_ERSTER_WELLE, gemessen: PLANER, vorschau: ERSTE_WELLE * ERKUNDER_LAUF });
});

const NACH_ERKUNDUNG = PLANER + ERSTE_WELLE * ERKUNDER_LAUF;
const NACH_ZUSCHNITT = NACH_ERKUNDUNG + PLANER;
const PRUEFLISTE_LAEUFE = ERSTE_WELLE + 1;
const NACH_PRUEFLISTE = NACH_ZUSCHNITT + PRUEFLISTE_LAEUFE * WEGPRUEFER;
const ENTWURF_LAEUFE = 2;
const DECKEL_VOR_PRUEFLISTE = NACH_ZUSCHNITT + WEGPRUEFER;
const DECKEL_VOR_ENTWURF = NACH_PRUEFLISTE + PLANER;
const DECKEL_VOR_ZUSCHNITT = NACH_ERKUNDUNG + PLANER / 2;
const ERKUNDER_LAUF_VORHER_KLEIN = PLANER;
const NACHFRAGE_VORSCHAU = PLANER + ZWEITE_WELLE * ERKUNDER_LAUF_VORHER_KLEIN;
const DECKEL_IN_DER_NACHFRAGE = NACHFRAGE_VORSCHAU + ERKUNDER / 2;
const NACH_HALT_HOECHSTENS = DECKEL_IN_DER_NACHFRAGE + (ZWEITE_WELLE - 1) * ERKUNDER;

function fortgesetztGruen(context, wurzel, ueberschrieben = {}) {
  const lauf = planeMitToken(context, wurzel, { argumente: ["--fortsetzen", "--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben });
  exit(lauf, EXIT_GRUEN);
  return lauf;
}

test("plane --deckel: passt die Prüfliste mit dem Mittel der Wegprüfungen dieses Laufs nicht mehr unter den Deckel, endet plane nach dem Zuschnitt mit Exit 5, ohne einen Prüfer der Prüfliste zu starten, und lässt sich fortsetzen", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_VOR_PRUEFLISTE)] });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, 0);
  assert.deepEqual(planungsBericht(lauf).deckel, { deckel: DECKEL_VOR_PRUEFLISTE, gemessen: NACH_ZUSCHNITT, vorschau: PRUEFLISTE_LAEUFE * WEGPRUEFER });
  assert.equal(existsSync(planungsDatei(lauf, "fingerabdruck.json")), true);

  const fortgesetzt = fortgesetztGruen(context, lauf.wurzel);
  assert.equal(aufrufe(fortgesetzt, "pruefer-planung", "## Prüfung").length, PRUEFLISTE_LAEUFE);
});

test("plane --deckel: passt die Prüfliste noch, die Entwurfs-Welle aber nicht mehr unter den Deckel, startet plane keinen Entwurf, schreibt keine phase.json und lässt sich fortsetzen", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_VOR_ENTWURF)] });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, PRUEFLISTE_LAEUFE);
  assert.equal(aufrufe(lauf, "entwurf").length, 0);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "phase.json")), false);
  assert.equal(planungsBericht(lauf).deckel.gemessen, NACH_PRUEFLISTE);

  const fortgesetzt = fortgesetztGruen(context, lauf.wurzel);
  assert.equal(aufrufe(fortgesetzt, "entwurf").length, ENTWURF_LAEUFE);
});

test("plane --deckel: würde erst die Antwort des Planers zwischen Erkundung und Prüfliste den Deckel überschreiten, endet plane vor ihr mit Exit 5", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_VOR_ZUSCHNITT)] });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "planer").length, PLANER_ANTWORTEN_BIS_NACHFRAGE - 1);
  assert.deepEqual(planungsBericht(lauf).deckel, { deckel: DECKEL_VOR_ZUSCHNITT, gemessen: NACH_ERKUNDUNG, vorschau: PLANER });
  assert.equal(existsSync(planungsDatei(lauf, "fingerabdruck.json")), true);
});

function kleinesErkunderMittel({ wurzel }) {
  writeFileSync(join(wurzel, ".fortschritt", KENNUNG, "planung.json"), JSON.stringify({ kostenJeLauf: { erkunder: { laeufe: 1, token: ERKUNDER_LAUF_VORHER_KLEIN } } }));
}

test("plane --fortsetzen --deckel: ist die Vorschau der Nachfrage-Welle zu klein, startet in ihr keine Wegprüfung mehr, sobald der Deckel überschritten wäre, die Welle bleibt unverbraucht und lässt sich fortsetzen", { timeout: LAUF_FRIST_MS }, (context) => {
  const gestoppt = planeMitToken(context, pitchFreigabe(planOrdner(context), `Planung freigegeben: ${DECKEL_FREIGABE} Token\n`), { ueberschrieben: zwoelfNachfragen() });
  exit(gestoppt, EXIT_DECKEL);
  kleinesErkunderMittel(gestoppt);

  const lauf = planeMitToken(context, gestoppt.wurzel, { argumente: ["--fortsetzen", "--deckel", String(DECKEL_IN_DER_NACHFRAGE)], ueberschrieben: zwoelfNachfragen() });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, ZWEITE_WELLE);
  assert.ok(aufrufe(lauf, "pruefer-planung", "## Wegprüfung").length < ZWEITE_WELLE);
  assert.ok(planungsBericht(lauf).token <= NACH_HALT_HOECHSTENS);
  assert.match(planungsBericht(lauf).deckelSchritt, /Wegprüfung/);
  assert.equal(nachfrageWellen(lauf), 0);

  eineWelleMitZwoelfErkundern(fortgesetztGruen(context, lauf.wurzel, zwoelfNachfragen()));
});

test("plane mit einem Deckel ohne Wirkung ruft jede Rolle so oft auf wie ohne Prüfung vor jedem Schritt", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben: zwoelfNachfragen() });

  exit(lauf, EXIT_GRUEN);
  const jeRolle = Object.fromEntries(Object.keys(TOKEN).map((rolle) => [rolle, aufrufe(lauf, rolle).length]));
  const erkunderLaeufe = ERSTE_WELLE + ZWEITE_WELLE;
  assert.deepEqual(jeRolle, { planer: PLANER_ANTWORTEN_BIS_NACHFRAGE + 1, erkunder: erkunderLaeufe, "pruefer-planung": erkunderLaeufe + PRUEFLISTE_LAEUFE, entwurf: ENTWURF_LAEUFE });
});

const ENTWURF_VORHER_KLEIN = 1;
const DECKEL_VOR_ZWEITER_PRUEFLISTE = NACH_PRUEFLISTE + PLANER;
const DECKEL_VOR_RUECKSENDUNG_ERKUNDER = NACH_ZUSCHNITT + 2 * ERKUNDER_LAUF + ERKUNDER / 2;
const DECKEL_VOR_KORREKTUR = NACH_ZUSCHNITT + ERKUNDER_LAUF + WEGPRUEFER;
const SPAETER_MS = 3000;
const LEERER_BERICHT = alsJson({ nummern: {}, hinweise: [] });

function vorigerBericht(wurzel, kostenJeLauf) {
  mkdirSync(join(wurzel, ".fortschritt", KENNUNG), { recursive: true });
  writeFileSync(join(wurzel, ".fortschritt", KENNUNG, "planung.json"), JSON.stringify({ kostenJeLauf }));
  return wurzel;
}

function nachfragenZu(nummern, antworten) {
  return { "planer|## Zuschnitt": [alsJson({ nachfragen: nummern.map((nummer) => ({ nummern: [nummer], frage: `Wo endet ${nummer}?` })) }), alsJson({ schnitt: schnittliste() })], ...antworten };
}

function haeltVor(context, wurzel, { deckel, ueberschrieben, schritt }) {
  const lauf = planeMitToken(context, wurzel, { argumente: ["--deckel", String(deckel)], ueberschrieben });
  exit(lauf, EXIT_DECKEL);
  assert.match(planungsBericht(lauf).deckelSchritt, schritt);
  return lauf;
}

test("plane --deckel: hält vor der Rücksendung im Entwurf, wenn die Vorschau des Entwurfs aus dem vorigen Lauf zu klein war", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = vorigerBericht(planOrdner(context), { entwurf: { laeufe: 1, token: ENTWURF_VORHER_KLEIN } });
  const lauf = haeltVor(context, wurzel, { deckel: DECKEL_VOR_ENTWURF, ueberschrieben: { [`entwurf|## Entwurf|${ROUTE}`]: [alsJson({})] }, schritt: /^Rücksendung an entwurf$/ });

  assert.equal(aufrufe(lauf, "entwurf").length, ENTWURF_LAEUFE);
  assert.equal(existsSync(planungsDatei(lauf, "fingerabdruck.json")), true);
});

test("plane --deckel: hält vor der Rücksendung an einen Prüfer der Prüfliste", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_ZWEITER_PRUEFLISTE, ueberschrieben: { "pruefer-planung|## Prüfung": [alsJson({ pruefliste: [] }), GRUEN_PRUEFLISTE, GRUEN_PRUEFLISTE, GRUEN_PRUEFLISTE] }, schritt: /^Rücksendung an pruefer-planung$/ });

  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, PRUEFLISTE_LAEUFE);
});

test("plane --deckel: hält in der Nachfrage-Welle vor der Rücksendung an einen Erkunder, und nach --fortsetzen stehen die Wegprüfungen der angehaltenen Welle nicht doppelt im Fingerabdruck", { timeout: LAUF_FRIST_MS }, (context) => {
  const spaeterLeer = { "erkunder|## Nachfrage|S1": [bericht(["S1"])], "erkunder|## Nachfrage|S2": [{ text: LEERER_BERICHT, warte: SPAETER_MS }], "erkunder|## Befunde": [bericht(["S2"])] };
  const lauf = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_RUECKSENDUNG_ERKUNDER, ueberschrieben: nachfragenZu(["S1", "S2"], spaeterLeer), schritt: /^Rücksendung an erkunder \(S2\)$/ });

  assert.equal(aufrufe(lauf, "erkunder", "## Befunde").length, 0);
  assert.equal(abgelegt(lauf, "fingerabdruck.json").zustand.wegpruefungen.length, ERSTE_WELLE);
  assert.equal(nachfrageWellen(lauf), 0);

  const fortgesetzt = fortgesetztGruen(context, lauf.wurzel, nachfragenZu(["S1", "S2"], spaeterLeer));
  assert.equal(abgelegt(fortgesetzt, "fingerabdruck.json").zustand.wegpruefungen.length, ERSTE_WELLE + 2);
});

test("plane --deckel: hält in der Nachfrage-Welle vor der Korrektur des Erkunders nach einem Befund der Wegprüfung", { timeout: LAUF_FRIST_MS }, (context) => {
  const wegBefund = { ...GRUEN_PRUEFLISTE, befunde: { "weg:S1": "der Weg endet nicht in speichereStatus" } };
  const lauf = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_KORREKTUR, ueberschrieben: nachfragenZu(["S1"], { "erkunder|## Nachfrage|S1": [bericht(["S1"])], "pruefer-planung|## Wegprüfung|S1": [GRUEN_PRUEFLISTE, wegBefund] }), schritt: /^Korrektur nach der Wegprüfung S1, Runde 1$/ });

  assert.equal(aufrufe(lauf, "erkunder", "## Befunde").length, 0);
});

const DECKEL_FUER_ENTWURF_WIE_PLANER = NACH_PRUEFLISTE + ENTWURF_LAEUFE * PLANER;

test("plane --deckel: ohne frühere Messung des Entwurfs schätzt plane die Entwurfs-Welle mit dem Mittel des Planers, der wie der Entwurf kein Werkzeug hat, nicht mit dem des teuersten Erkunders, und plant grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_FUER_ENTWURF_WIE_PLANER)] });

  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "entwurf").length, ENTWURF_LAEUFE);
  assert.equal(planungsBericht(lauf).token, DECKEL_FUER_ENTWURF_WIE_PLANER);
});

const DECKEL_KNAPP_UNTER_ERSTER_WELLE_ZUM_PLANER_MITTEL = PLANER + ERSTE_WELLE * PLANER - 1;

test("plane --deckel: hat der Erkunder keine frühere Messung und keine gemessene Rolle seine Werkzeuge, schätzt plane die erste Welle mit dem höchsten Mittel aller gemessenen Rollen und hält vor ihr an", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_KNAPP_UNTER_ERSTER_WELLE_ZUM_PLANER_MITTEL)] });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "erkunder").length, 0);
  assert.deepEqual(planungsBericht(lauf).deckel, { deckel: DECKEL_KNAPP_UNTER_ERSTER_WELLE_ZUM_PLANER_MITTEL, gemessen: PLANER, vorschau: ERSTE_WELLE * PLANER });
});
