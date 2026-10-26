import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BIS_ZUM_ABBRUCH, GRUEN_PRUEFLISTE, GRUPPEN, KENNUNG, LAUF_FRIST_MS, ORDNER, ROUTE, WEGPRUEFUNGEN, alsJson, aufrufe, bericht, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";
import { A2_BEFUND, AUFTRAG, EXIT_AUFRUF, EXIT_GRUEN, MIT_NUMMER, abgelegt, antwortMit, jePruefer, phaseDatei, planeAntworten, planungsBericht, werkzeug } from "./planung-plane-probe.js";

const EXIT_DECKEL = 5;
const MIO = 1_000_000;
const DECKEL_FREIGABE = 15 * MIO;
const DECKEL_OHNE_WIRKUNG = 1000 * MIO;
const PLANER_ANTWORTEN_BIS_NACHFRAGE = 2;
const PRUEFER_LAUF_VORHER = 100 * MIO;
const PLANER = 100_000;
const ERKUNDER = MIO;
const WEGPRUEFER = 340_000;
const ERKUNDER_LAUF = ERKUNDER + WEGPRUEFER;
const TOKEN = { planer: PLANER, erkunder: ERKUNDER, "pruefer-planung": WEGPRUEFER, entwurf: PLANER };
const ERSTE_WELLE = GRUPPEN.length;
const ZWEITE_WELLE = 1;
const FREIGABE_UNTER_NACHFRAGE = PLANER_ANTWORTEN_BIS_NACHFRAGE * PLANER + (ERSTE_WELLE + ZWEITE_WELLE) * ERKUNDER_LAUF - 1;
const NACHFRAGE_NUMMERN = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "T1", "T2", "B1", "S1", "S2"];
const FREIGABE_ZEILE = /^Planung freigegeben: .*\n/m;
const NACHFRAGEN = NACHFRAGE_NUMMERN.map((nummer) => ({ nummern: [nummer], frage: `Wo endet der Weg von ${nummer}?` }));

function zwoelfNachfragen() {
  return {
    "erkunder|## Nachfrage|S1": [bericht([...new Set(NACHFRAGE_NUMMERN)])],
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

test("plane --deckel geht vor die im Pitch freigegebene Menge: derselbe Lauf startet den Erkunder der zweiten Welle und plant grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = pitchFreigabe(planOrdner(context), `Planung freigegeben: ${FREIGABE_UNTER_NACHFRAGE} Token\n`);
  const lauf = planeMitToken(context, wurzel, { argumente: ["--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben: zwoelfNachfragen() });

  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, ZWEITE_WELLE);
});

function nachfrageWellen(lauf) {
  return abgelegt(lauf, "fingerabdruck.json").zustand.nachfrageWellen;
}

function eineWelleMitEinemErkunder(lauf) {
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, ZWEITE_WELLE);
  assert.equal(nachfrageWellen(lauf), 1);
}

test("plane: zwölf Nachfragen in einer Antwort sind eine Nachfrage-Welle", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben: zwoelfNachfragen() });

  eineWelleMitEinemErkunder(lauf);
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

const NACH_ERKUNDUNG = PLANER + ERSTE_WELLE * ERKUNDER_LAUF;
const NACH_ZUSCHNITT = NACH_ERKUNDUNG + PLANER;
const PRUEFLISTE_LAEUFE = ERSTE_WELLE + 1;
const NACH_PRUEFLISTE = NACH_ZUSCHNITT + PRUEFLISTE_LAEUFE * WEGPRUEFER;
const ENTWURF_LAEUFE = 2;
const DECKEL_VOR_ENTWURF = NACH_PRUEFLISTE + PLANER;

function fortgesetztGruen(context, wurzel, ueberschrieben = {}) {
  const lauf = planeMitToken(context, wurzel, { argumente: ["--fortsetzen", "--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben });
  exit(lauf, EXIT_GRUEN);
  return lauf;
}

test("plane mit einem Deckel ohne Wirkung ruft jede Rolle so oft auf wie ohne Prüfung vor jedem Schritt", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben: zwoelfNachfragen() });

  exit(lauf, EXIT_GRUEN);
  const jeRolle = Object.fromEntries(Object.keys(TOKEN).map((rolle) => [rolle, aufrufe(lauf, rolle).length]));
  const erkunderLaeufe = ERSTE_WELLE + ZWEITE_WELLE;
  assert.deepEqual(jeRolle, { planer: PLANER_ANTWORTEN_BIS_NACHFRAGE + 1, erkunder: erkunderLaeufe, "pruefer-planung": erkunderLaeufe + PRUEFLISTE_LAEUFE, entwurf: ENTWURF_LAEUFE });
});

const ENTWURF_VORHER_KLEIN = 1;
const SPAETER_MS = 3000;

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

const ALLE_NUMMERN = GRUPPEN.flatMap(({ nummern }) => nummern);
const EINE_GRUPPE = { "planer|## Gliederung": [alsJson({ gruppen: [{ ...GRUPPEN[0], nummern: ALLE_NUMMERN }] })], "erkunder|## Erkundung|S1": [bericht(ALLE_NUMMERN)] };
const DECKEL_IN_DER_ERKUNDUNG = PLANER + ERKUNDER + WEGPRUEFER;

function zuschnittNachUebernahme(lauf, wegpruefungen = 0) {
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Wegprüfung").length, wegpruefungen);
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  return zuschnitt.eingabe;
}

const LEERER_BERICHT = alsJson({ nummern: {}, hinweise: [] });
const DECKEL_VOR_RUECKSENDUNG_IM_ENTWURF = NACH_PRUEFLISTE + PLANER / 2;
const DECKEL_VOR_RUECKSENDUNG_AN_PRUEFER = NACH_ZUSCHNITT + WEGPRUEFER / 2;
const DECKEL_VOR_RUECKSENDUNG_ERKUNDER = NACH_ZUSCHNITT + ERKUNDER / 2;
const DECKEL_VOR_KORREKTUR = NACH_ZUSCHNITT + ERKUNDER + WEGPRUEFER / 2;

test("plane --deckel: hält vor der Rücksendung im Entwurf, wenn der gemessene Verbrauch den Deckel überschreitet", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_RUECKSENDUNG_IM_ENTWURF, ueberschrieben: { [`entwurf|## Entwurf|${ROUTE}`]: [alsJson({})] }, schritt: /^Rücksendung an entwurf$/ });

  assert.equal(aufrufe(lauf, "entwurf").length, ENTWURF_LAEUFE);
  assert.equal(existsSync(planungsDatei(lauf, "fingerabdruck.json")), true);
});

test("plane --deckel: hält vor der Rücksendung an einen Prüfer der Prüfliste", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_RUECKSENDUNG_AN_PRUEFER, ueberschrieben: { "pruefer-planung|## Prüfung": [alsJson({ pruefliste: [] }), ...jePruefer(GRUEN_PRUEFLISTE).slice(1)] }, schritt: /^Rücksendung an pruefer-planung$/ });

  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, PRUEFLISTE_LAEUFE);
});

test("plane --deckel: hält in der Nachfrage-Welle vor der Rücksendung an einen Erkunder, und nach --fortsetzen stehen die Wegprüfungen der angehaltenen Welle nicht doppelt im Fingerabdruck", { timeout: LAUF_FRIST_MS }, (context) => {
  const leer = { "erkunder|## Nachfrage|S1": [LEERER_BERICHT], "erkunder|## Befunde": [bericht(["S1", "S2"])] };
  const lauf = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_RUECKSENDUNG_ERKUNDER, ueberschrieben: nachfragenZu(["S1", "S2"], leer), schritt: /^Rücksendung an erkunder \(S1, S2\)$/ });

  assert.equal(aufrufe(lauf, "erkunder", "## Befunde").length, 0);
  assert.equal(abgelegt(lauf, "fingerabdruck.json").zustand.wegpruefungen.length, ERSTE_WELLE);
  assert.equal(nachfrageWellen(lauf), 0);

  const fortgesetzt = fortgesetztGruen(context, lauf.wurzel, nachfragenZu(["S1", "S2"], leer));
  assert.equal(abgelegt(fortgesetzt, "fingerabdruck.json").zustand.wegpruefungen.length, ERSTE_WELLE + ZWEITE_WELLE);
});

test("plane --deckel: hält in der Nachfrage-Welle vor der Korrektur des Erkunders nach einem Befund der Wegprüfung", { timeout: LAUF_FRIST_MS }, (context) => {
  const wegBefund = { ...GRUEN_PRUEFLISTE, befunde: { "weg:S1": "der Weg endet nicht in speichereStatus" } };
  const lauf = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_KORREKTUR, ueberschrieben: nachfragenZu(["S1"], { "erkunder|## Nachfrage|S1": [bericht(["S1"])], "pruefer-planung|## Wegprüfung|S1": [GRUEN_PRUEFLISTE, wegBefund] }), schritt: /^Korrektur nach der Wegprüfung S1, Runde 1$/ });

  assert.equal(aufrufe(lauf, "erkunder", "## Befunde").length, 0);
});

const WEG_BEFUND = "der Weg endet nicht in speichereStatus";
const MIT_WEGBEFUND = { ...EINE_GRUPPE, "pruefer-planung|## Wegprüfung|S1": [{ ...GRUEN_PRUEFLISTE, befunde: { "weg:S1": WEG_BEFUND } }] };
const HALT_ZEILE = `Weg ${ALLE_NUMMERN.join(", ")}: die Wegprüfung blieb unvollständig, weil plane am Kostendeckel anhielt`;
const DECKEL_VOR_WEGPRUEFUNG = PLANER + ERKUNDER / 2;

function inDerErkundungGestoppt(context, { ueberschrieben, schritt }) {
  const gestoppt = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_WEGPRUEFUNG, ueberschrieben, schritt });
  assert.equal(aufrufe(gestoppt, "erkunder").length, 1);
  assert.deepEqual(aufrufe(gestoppt, "pruefer-planung"), []);
  assert.equal(existsSync(planungsDatei(gestoppt, "fingerabdruck.json")), true);
  return gestoppt;
}

test("plane --fortsetzen nach Exit 5 vor der ersten Runde der Wegprüfung übernimmt den Bericht, startet aber dessen Wegprüfung, bevor es schneidet", { timeout: LAUF_FRIST_MS }, (context) => {
  const gestoppt = inDerErkundungGestoppt(context, { ueberschrieben: EINE_GRUPPE, schritt: /^Wegprüfung S1, .*, Runde 1$/ });
  assert.deepEqual(abgelegt(gestoppt, "fingerabdruck.json").zustand.wegAusstehend, [ALLE_NUMMERN]);

  const lauf = fortgesetztGruen(context, gestoppt.wurzel, MIT_WEGBEFUND);

  const zuschnitt = zuschnittNachUebernahme(lauf, 1);
  assert.ok(zuschnitt.includes(`Weg S1: ${WEG_BEFUND}`), zuschnitt);
  assert.ok(!zuschnitt.includes(HALT_ZEILE), zuschnitt);
  assert.deepEqual(abgelegt(lauf, "fingerabdruck.json").zustand.wegAusstehend, []);
});

const DECKEL_VOR_ZWEITER_WEGRUNDE = PLANER + ERKUNDER + WEGPRUEFER + ERKUNDER / 2;

test("plane --fortsetzen nach Exit 5 vor der zweiten Runde der Wegprüfung prüft den korrigierten Bericht, bevor es schneidet", { timeout: LAUF_FRIST_MS }, (context) => {
  const gestoppt = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_ZWEITER_WEGRUNDE, ueberschrieben: { ...MIT_WEGBEFUND, "erkunder|## Befunde": [bericht(ALLE_NUMMERN)] }, schritt: /^Wegprüfung S1, .*, Runde 2$/ });
  assert.equal(aufrufe(gestoppt, "erkunder", "## Befunde").length, 1);
  assert.deepEqual(abgelegt(gestoppt, "fingerabdruck.json").zustand.wegAusstehend, [ALLE_NUMMERN]);

  const zuschnitt = zuschnittNachUebernahme(fortgesetztGruen(context, gestoppt.wurzel, EINE_GRUPPE), 1);

  assert.ok(!zuschnitt.includes(`Weg S1: ${WEG_BEFUND}`), zuschnitt);
  assert.ok(!zuschnitt.includes(HALT_ZEILE), zuschnitt);
});

test("plane --fortsetzen nach Exit 5 vor der Rücksendung an den Erkunder übernimmt dessen ersten Bericht samt Befunden als offene Punkte", { timeout: LAUF_FRIST_MS }, (context) => {
  const leer = { ...EINE_GRUPPE, "erkunder|## Erkundung|S1": [LEERER_BERICHT] };
  const gestoppt = inDerErkundungGestoppt(context, { ueberschrieben: leer, schritt: /^Rücksendung an erkunder \(S1, / });
  assert.deepEqual(abgelegt(gestoppt, "erkundung-g1.json").nummern, {});

  const lauf = planeMitToken(context, gestoppt.wurzel, { argumente: ["--fortsetzen", "--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben: EINE_GRUPPE });

  const zuschnitt = zuschnittNachUebernahme(lauf);
  assert.ok(zuschnitt.includes(`Bericht ${ALLE_NUMMERN.join(", ")}: `), zuschnitt);
});

function vorDemEntwurfGestoppt(context) {
  const lauf = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_ENTWURF, ueberschrieben: {}, schritt: /^Entwurfs-Welle$/ });
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, PRUEFLISTE_LAEUFE);
  return lauf;
}

function entworfenNachFortsetzung(context, { wurzel }) {
  const lauf = fortgesetztGruen(context, wurzel);
  assert.equal(aufrufe(lauf, "entwurf").length, ENTWURF_LAEUFE);
  assert.equal(werkzeug(lauf, AUFTRAG, "pruefe", phaseDatei(lauf)).status, EXIT_GRUEN);
  return lauf;
}

test("plane --fortsetzen nach Exit 5 vor der Entwurfs-Welle übernimmt den befundfrei geprüften Schnitt und startet weder Planer noch Prüfer neu", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = entworfenNachFortsetzung(context, vorDemEntwurfGestoppt(context));

  assert.deepEqual(aufrufe(lauf, "planer"), []);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung"), []);
});

function umformatiert(gestoppt, name) {
  const datei = planungsDatei(gestoppt, name);
  writeFileSync(datei, JSON.stringify(JSON.parse(readFileSync(datei, "utf8"))));
}

function beanstandeterSchnittMitPassenderPruefsumme(gestoppt) {
  const schnitt = JSON.stringify({ ...abgelegt(gestoppt, "schnitt.json"), auftraege: [] });
  writeFileSync(planungsDatei(gestoppt, "schnitt.json"), schnitt);
  const geprueft = { ...abgelegt(gestoppt, "geprueft.json"), schnitt: createHash("sha256").update(schnitt).digest("hex") };
  writeFileSync(planungsDatei(gestoppt, "geprueft.json"), JSON.stringify(geprueft));
}

test("plane --fortsetzen nach Exit 5 vor der Entwurfs-Welle bringt die übernommenen korrigierten Befunde und Nachprüfungen in den Planungsbericht", { timeout: LAUF_FRIST_MS }, (context) => {
  const mitKorrektur = { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(MIT_NUMMER)] };
  const gestoppt = haeltVor(context, planOrdner(context), { deckel: DECKEL_VOR_ENTWURF + PLANER + WEGPRUEFER, ueberschrieben: mitKorrektur, schritt: /^Entwurfs-Welle$/ });
  const vorher = planungsBericht(gestoppt);
  assert.equal(vorher.befunde.korrigiert.length, 1);
  assert.equal(vorher.nachpruefungen.length, 1);

  const lauf = entworfenNachFortsetzung(context, gestoppt);

  assert.deepEqual(aufrufe(lauf, "planer"), []);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung"), []);
  const { befunde, nachpruefungen } = planungsBericht(lauf);
  assert.deepEqual([befunde.korrigiert, befunde.zurueckgewiesen, nachpruefungen], [vorher.befunde.korrigiert, vorher.befunde.zurueckgewiesen, vorher.nachpruefungen]);
});

function neuGeschnittenNach(context, aendere) {
  const gestoppt = vorDemEntwurfGestoppt(context);
  aendere(gestoppt);

  const lauf = entworfenNachFortsetzung(context, gestoppt);

  assert.equal(aufrufe(lauf, "planer", "## Zuschnitt").length, 1);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, PRUEFLISTE_LAEUFE);
}

test("plane --fortsetzen nach Exit 5 vor der Entwurfs-Welle schneidet und prüft neu, wenn planung/schnitt.json seit der Prüfung geändert ist", { timeout: LAUF_FRIST_MS }, (context) => {
  neuGeschnittenNach(context, (gestoppt) => umformatiert(gestoppt, "schnitt.json"));
});

test("plane --fortsetzen nach Exit 5 vor der Entwurfs-Welle schneidet und prüft neu, wenn planung/fingerabdruck.json seit der Prüfung geändert ist", { timeout: LAUF_FRIST_MS }, (context) => {
  neuGeschnittenNach(context, (gestoppt) => umformatiert(gestoppt, "fingerabdruck.json"));
});

test("plane --fortsetzen nach Exit 5 vor der Entwurfs-Welle schneidet und prüft neu, wenn planung/geprueft.json fehlt", { timeout: LAUF_FRIST_MS }, (context) => {
  neuGeschnittenNach(context, (gestoppt) => rmSync(planungsDatei(gestoppt, "geprueft.json")));
});

test("plane --fortsetzen nach Exit 5 vor der Entwurfs-Welle schneidet und prüft neu, wenn die Skriptprüfung den Schnitt trotz passender Prüfsumme beanstandet", { timeout: LAUF_FRIST_MS }, (context) => {
  neuGeschnittenNach(context, beanstandeterSchnittMitPassenderPruefsumme);
});

const UEBERZOGEN_IN_DER_ERKUNDUNG = 190_000;
const DECKEL_UNTER_DER_ERKUNDUNG = DECKEL_IN_DER_ERKUNDUNG - UEBERZOGEN_IN_DER_ERKUNDUNG;
const NACH_ENTWURF = NACH_PRUEFLISTE + ENTWURF_LAEUFE * PLANER;
const DECKEL_IN_DER_RUECKSENDUNG_IM_ENTWURF = NACH_ENTWURF + PLANER / 2;
const UNGUELTIGER_ENTWURF = { [`entwurf|## Entwurf|${ROUTE}`]: [alsJson({})], "entwurf|## Befunde": [alsJson({})] };

function nenntUeberschreitung(lauf, { deckel, gemessen, prozent }) {
  const { grund, deckel: stand } = planungsBericht(lauf);
  const ueberschritten = gemessen - deckel;
  assert.equal(stand.ueberschritten, ueberschritten);
  for (const angabe of [`${deckel}`, `${gemessen}`, `${ueberschritten} Token`, prozent]) assert.ok(grund.includes(angabe), grund);
  return { grund, stand };
}

function nenntUeberschreitungOhneVorschau(lauf, angaben) {
  const { grund, stand } = nenntUeberschreitung(lauf, angaben);
  assert.deepEqual(stand, { deckel: angaben.deckel, gemessen: angaben.gemessen, ueberschritten: stand.ueberschritten });
  return grund;
}

function ueberDemDeckelErkundet(context) {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_UNTER_DER_ERKUNDUNG)], ueberschrieben: EINE_GRUPPE });
  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Wegprüfung").length, 1);
  assert.deepEqual(aufrufe(lauf, "planer", "## Zuschnitt"), []);
  assert.equal(planungsBericht(lauf).deckelSchritt, "Erkundung");
  nenntUeberschreitungOhneVorschau(lauf, { deckel: DECKEL_UNTER_DER_ERKUNDUNG, gemessen: DECKEL_IN_DER_ERKUNDUNG, prozent: "15,2 %" });
  assert.equal(existsSync(planungsDatei(lauf, "fingerabdruck.json")), true);
  return lauf;
}

test("plane --deckel: endet mit Exit 5, wenn eine Welle teurer war als die Vorschau und der Deckel überschritten ist", { timeout: LAUF_FRIST_MS }, (context) => {
  ueberDemDeckelErkundet(context);
});

function mitKleinemEntwurfsMittel(context) {
  return vorigerBericht(planOrdner(context), { entwurf: { laeufe: 1, token: ENTWURF_VORHER_KLEIN } });
}

test("plane --deckel: ein sonst grüner Lauf über dem Deckel endet mit Exit 5 statt 0", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, mitKleinemEntwurfsMittel(context), { argumente: ["--deckel", String(DECKEL_VOR_ENTWURF)] });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "entwurf").length, ENTWURF_LAEUFE);
  assert.equal(planungsBericht(lauf).deckelSchritt, "Entwurfs-Welle");
  nenntUeberschreitungOhneVorschau(lauf, { deckel: DECKEL_VOR_ENTWURF, gemessen: NACH_ENTWURF, prozent: "2,5 %" });
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "phase.json")), false);
});

test("plane --deckel: offene Befunde über dem Deckel enden mit Exit 5 und die Meldung nennt die offenen Befunde", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, mitKleinemEntwurfsMittel(context), { argumente: ["--deckel", String(DECKEL_IN_DER_RUECKSENDUNG_IM_ENTWURF)], ueberschrieben: UNGUELTIGER_ENTWURF });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "entwurf", "## Befunde").length, 1);
  const grund = nenntUeberschreitungOhneVorschau(lauf, { deckel: DECKEL_IN_DER_RUECKSENDUNG_IM_ENTWURF, gemessen: NACH_ENTWURF + PLANER, prozent: "1,2 %" });
  const { offen } = planungsBericht(lauf).befunde;
  assert.ok(offen.length > 0);
  for (const befund of offen) assert.ok(befund.startsWith(`Entwurf ${ROUTE}: `) && grund.includes(befund), grund);
});

test("plane --deckel: nach Exit 5 wegen Überschreitung setzt --fortsetzen mit den bezahlten Ergebnissen fort", { timeout: LAUF_FRIST_MS }, (context) => {
  const gestoppt = ueberDemDeckelErkundet(context);

  const lauf = fortgesetztGruen(context, gestoppt.wurzel, EINE_GRUPPE);

  zuschnittNachUebernahme(lauf);
});

test("plane --deckel: genau auf dem Deckel endet ein grüner Lauf mit Exit 0", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, mitKleinemEntwurfsMittel(context), { argumente: ["--deckel", String(NACH_ENTWURF)] });

  exit(lauf, EXIT_GRUEN);
  assert.equal(planungsBericht(lauf).token, NACH_ENTWURF);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "phase.json")), true);
});

const ZWEITE_GRUPPE_SPAETER = { "erkunder|## Erkundung|S4": [{ text: bericht(GRUPPEN[1].nummern), warte: SPAETER_MS }] };
const DECKEL_IN_DER_ZWEITEN_WEGPRUEFUNG = 2 * MIO;
const NACH_ZWEITEM_ERKUNDER = PLANER + ERSTE_WELLE * ERKUNDER + WEGPRUEFER;

test("plane --deckel: hält plane mitten in einer Welle an und liegen die zu Ende gelaufenen Antworten über dem Deckel, nennt die Meldung die Überschreitung", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = haeltVor(context, planOrdner(context), { deckel: DECKEL_IN_DER_ZWEITEN_WEGPRUEFUNG, ueberschrieben: ZWEITE_GRUPPE_SPAETER, schritt: /^Wegprüfung S4, S5, B1, Runde 1$/ });

  assert.equal(aufrufe(lauf, "pruefer-planung", "## Wegprüfung").length, 1);
  nenntUeberschreitung(lauf, { deckel: DECKEL_IN_DER_ZWEITEN_WEGPRUEFUNG, gemessen: NACH_ZWEITEM_ERKUNDER, prozent: "22,0 %" });
});

test("plane --fortsetzen --deckel: der Verbrauch früherer Läufe derselben Planung zählt gegen den Deckel", { timeout: LAUF_FRIST_MS }, (context) => {
  const gestoppt = ueberDemDeckelErkundet(context);
  const unterDemVorverbrauch = DECKEL_IN_DER_ERKUNDUNG - 1;

  const lauf = planeMitToken(context, gestoppt.wurzel, { argumente: ["--fortsetzen", "--deckel", String(unterDemVorverbrauch)], ueberschrieben: EINE_GRUPPE });

  exit(lauf, EXIT_DECKEL);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
  const { deckel, grund } = planungsBericht(lauf);
  assert.deepEqual(deckel, { deckel: unterDemVorverbrauch, vorverbrauch: DECKEL_IN_DER_ERKUNDUNG, gemessen: 0, ueberschritten: 1 });
  for (const angabe of [`Deckel ${unterDemVorverbrauch} Token`, `Vorverbrauch ${DECKEL_IN_DER_ERKUNDUNG}`, "gemessen 0"]) assert.ok(grund.includes(angabe), grund);
});

const STROM_GRUND = 10_000;
const STROM_DECKEL = 135_000;
const STROM_NACHFRAGE = [20_000, 30_000, 40_000, BIS_ZUM_ABBRUCH, 50_000];
const STROM_TOKEN = { planer: STROM_GRUND, erkunder: STROM_GRUND, "pruefer-planung": STROM_GRUND, entwurf: STROM_GRUND, "erkunder|## Nachfrage|S1": STROM_NACHFRAGE };
const NACHFRAGE_S1 = nachfragenZu(["S1"], { "erkunder|## Nachfrage|S1": [bericht(["S1"])] });

function planeMitStrom(context, wurzel, argumente) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: NACHFRAGE_S1, argumente: ["plane", ORDNER, ...argumente], token: STROM_TOKEN });
}

function inDerNachfrageAbgebrochen(context) {
  const lauf = planeMitStrom(context, planOrdner(context), ["--deckel", String(STROM_DECKEL)]);
  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 1);
  assert.match(planungsBericht(lauf).grund, /bricht die laufenden Agenten beim Schritt „Nachfrage-Welle“ ab/);
  return lauf;
}

test("plane --fortsetzen --deckel: ein am Deckel abgebrochener Lauf zählt beim Fortsetzen mit", { timeout: LAUF_FRIST_MS }, (context) => {
  const abgebrochen = inDerNachfrageAbgebrochen(context);
  const vorverbrauch = planungsBericht(abgebrochen).token;

  const lauf = planeMitStrom(context, abgebrochen.wurzel, ["--fortsetzen", "--deckel", String(vorverbrauch - 1)]);

  exit(lauf, EXIT_DECKEL);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
  assert.equal(planungsBericht(lauf).deckel.vorverbrauch, vorverbrauch);
});

test("plane: ein am Deckel abgebrochener Erkunder steht mit seinem gemessenen Verbrauch in planung.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = inDerNachfrageAbgebrochen(context);

  const { wellen, kostenAbgebrochen } = planungsBericht(lauf);
  const nachfrage = wellen.find(({ schritt }) => schritt === "Nachfrage-Welle");
  assert.ok(nachfrage.gemessen > 0, JSON.stringify(wellen));
  assert.deepEqual(kostenAbgebrochen, { erkunder: { laeufe: 1, token: nachfrage.gemessen } });
});

const FERTIG_S4 = 5_000;
const ABGEBROCHEN_S1 = 60_000;
const DECKEL_BEIM_ABBRUCH_VON_S1 = STROM_GRUND + FERTIG_S4 + STROM_GRUND + ABGEBROCHEN_S1;
const S1_NACH_S4 = { ...STROM_TOKEN, "erkunder|## Erkundung|S4": [FERTIG_S4], "erkunder|## Erkundung|S1": [{ nachDemEndeVon: "erkunder|## Erkundung|S4" }, ABGEBROCHEN_S1, BIS_ZUM_ABBRUCH] };

test("plane: bricht der Deckel in einer Welle nur einen von zwei Erkundern ab, steht genau dessen gemessener Verbrauch unter kostenAbgebrochen", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = vorigerBericht(planOrdner(context), { erkunder: { laeufe: 1, token: STROM_GRUND }, "pruefer-planung": { laeufe: 1, token: STROM_GRUND } });
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER, "--deckel", String(DECKEL_BEIM_ABBRUCH_VON_S1)], token: S1_NACH_S4 });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "erkunder", "## Erkundung").length, 2);
  assert.deepEqual(planungsBericht(lauf).kostenAbgebrochen?.erkunder, { laeufe: 1, token: ABGEBROCHEN_S1 });
});

test("plane --fortsetzen: ist der Vorverbrauch nicht bestimmbar, hält plane mit Meldung", { timeout: LAUF_FRIST_MS }, (context) => {
  const gestoppt = ueberDemDeckelErkundet(context);
  const buchung = join(gestoppt.wurzel, ".fortschritt", KENNUNG, "verbrauch.json");
  assert.equal(JSON.parse(readFileSync(buchung, "utf8")).gesamt, DECKEL_IN_DER_ERKUNDUNG);

  for (const verderbe of [() => writeFileSync(buchung, JSON.stringify({ vorverbrauch: 0 })), () => writeFileSync(buchung, "kein JSON"), () => rmSync(buchung)]) {
    verderbe();
    const lauf = planeMitToken(context, gestoppt.wurzel, { argumente: ["--fortsetzen", "--deckel", String(DECKEL_OHNE_WIRKUNG)], ueberschrieben: EINE_GRUPPE });

    exit(lauf, EXIT_DECKEL);
    assert.deepEqual(aufrufe(lauf, "planer"), []);
    for (const angabe of ["Vorverbrauch nicht bestimmbar", buchung, "voller Neulauf", "gesamt"]) assert.ok(lauf.stderr.includes(angabe), lauf.stderr);
  }
});

function mitTeurerSchaetzung(context) {
  const teuerVorher = { laeufe: 1, token: PRUEFER_LAUF_VORHER };
  return vorigerBericht(planOrdner(context), { planer: teuerVorher, erkunder: teuerVorher, "pruefer-planung": teuerVorher, entwurf: teuerVorher });
}

test("plane: hält nicht vor einem Schritt wegen einer Schätzung, nur am gemessenen Deckel", { timeout: LAUF_FRIST_MS }, (context) => {
  const gruen = planeMitToken(context, mitTeurerSchaetzung(context), { argumente: ["--deckel", String(DECKEL_FREIGABE)] });
  const knapp = planeMitToken(context, mitTeurerSchaetzung(context), { argumente: ["--deckel", String(DECKEL_UNTER_DER_ERKUNDUNG)], ueberschrieben: EINE_GRUPPE });

  exit(gruen, EXIT_GRUEN);
  assert.equal(aufrufe(gruen, "entwurf").length, ENTWURF_LAEUFE);
  assert.deepEqual(planungsBericht(gruen).deckel, { deckel: DECKEL_FREIGABE });
  exit(knapp, EXIT_DECKEL);
  assert.equal(planungsBericht(knapp).deckelSchritt, "Erkundung");
});
