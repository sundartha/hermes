import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, GRUPPEN, LAUF_FRIST_MS, ORDNER, ROUTE, WEGPRUEFUNGEN, alsJson, aufrufe, bericht, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";
import { A2_BEFUND, AUFTRAG, EXIT_ABBRUCH, EXIT_AUFRUF, EXIT_GRUEN, MIT_NUMMER, abgelegt, antwortMit, jePruefer, offenePunkte, phaseDatei, planeAntworten, planungsBericht, werkzeug } from "./planung-plane-probe.js";
import { mitKopfzeile } from "./planung-freigabe-probe.js";

const MIO = 1_000_000;
const DECKEL_OHNE_WIRKUNG = 1000 * MIO;
const PLANER = 100_000;
const ERKUNDER = MIO;
const WEGPRUEFER = 340_000;
const TOKEN = { planer: PLANER, erkunder: ERKUNDER, "pruefer-planung": WEGPRUEFER, entwurf: PLANER };
const ERSTE_WELLE = GRUPPEN.length;
const ZWEITE_WELLE = 1;
const NACHFRAGE_NUMMERN = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "T1", "T2", "B1", "S1", "S2"];
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

function nachfrageWellen(lauf) {
  return abgelegt(lauf, "fingerabdruck.json").zustand.nachfrageWellen;
}

function eineWelleMitEinemErkunder(lauf) {
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, ZWEITE_WELLE);
  assert.equal(nachfrageWellen(lauf), 1);
}

test("plane: zwölf Nachfragen in einer Antwort sind eine Nachfrage-Welle", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { ueberschrieben: zwoelfNachfragen() });

  eineWelleMitEinemErkunder(lauf);
});

test("plane: --deckel ist keine Angabe mehr, plane endet mit Exit 2 und startet keinen Agenten", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { argumente: ["--deckel", String(DECKEL_OHNE_WIRKUNG)] });

  exit(lauf, EXIT_AUFRUF);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung")), false);
});

test("plane: ein alter Pitch mit einer Zeile Planung freigegeben plant grün und hält an keiner Token-Menge an", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  mitKopfzeile(wurzel, ORDNER, "Planung freigegeben: 1 Token");

  const lauf = planeMitToken(context, wurzel);

  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "entwurf").length, ENTWURF_LAEUFE);
});

test("plane: bleibt ein Erkundungsbericht nach der Rücksendung mit Befunden, nennt der Zuschnitt ihn unter Offene Punkte als Bericht seiner Gruppe", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitToken(context, planOrdner(context), { ueberschrieben: { ...EINE_GRUPPE, "erkunder|## Erkundung|S1": [LEERER_BERICHT], "erkunder|## Befunde": [LEERER_BERICHT] } });

  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes(`Bericht ${ALLE_NUMMERN.join(", ")}: `), zuschnitt.eingabe);
});

const PRUEFLISTE_LAEUFE = ERSTE_WELLE + 1;
const ENTWURF_LAEUFE = 2;

const ALLE_NUMMERN = GRUPPEN.flatMap(({ nummern }) => nummern);
const EINE_GRUPPE = { "planer|## Gliederung": [alsJson({ gruppen: [{ ...GRUPPEN[0], nummern: ALLE_NUMMERN }] })], "erkunder|## Erkundung|S1": [bericht(ALLE_NUMMERN)] };

const LEERER_BERICHT = alsJson({ nummern: {}, hinweise: [] });

const ENTWURF_ABSTURZ = { [`entwurf|## Entwurf|${ROUTE}`]: [{ absturz: { exit: 1, fehler: "Entwurf abgestürzt" } }] };

function imEntwurfAbgebrochen(context, ueberschrieben = {}) {
  const lauf = planeMitToken(context, planOrdner(context), { ueberschrieben: { ...ENTWURF_ABSTURZ, ...ueberschrieben } });
  exit(lauf, EXIT_ABBRUCH);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, PRUEFLISTE_LAEUFE);
  assert.equal(existsSync(planungsDatei(lauf, "geprueft.json")), true);
  return lauf;
}

test("plane: eine abgestürzte Entwurfs-Welle zählt in planung.json nicht als Lauf ihrer Rolle", { timeout: LAUF_FRIST_MS }, (context) => {
  const { kostenJeLauf } = planungsBericht(imEntwurfAbgebrochen(context));

  assert.equal(kostenJeLauf.entwurf, undefined, JSON.stringify(kostenJeLauf));
  assert.equal(kostenJeLauf["pruefer-planung"].laeufe, PRUEFLISTE_LAEUFE, JSON.stringify(kostenJeLauf));
});

function entworfenNachFortsetzung(context, { wurzel }) {
  const lauf = planeMitToken(context, wurzel, { argumente: ["--fortsetzen"] });
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "entwurf").length, ENTWURF_LAEUFE);
  assert.equal(werkzeug(lauf, AUFTRAG, "pruefe", phaseDatei(lauf)).status, EXIT_GRUEN);
  return lauf;
}

test("plane --fortsetzen nach einem Abbruch in der Entwurfs-Welle übernimmt den befundfrei geprüften Schnitt und startet weder Planer noch Prüfer neu", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = entworfenNachFortsetzung(context, imEntwurfAbgebrochen(context));

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

test("plane --fortsetzen nach einem Abbruch in der Entwurfs-Welle bringt die übernommenen korrigierten Befunde und Nachprüfungen in den Planungsbericht", { timeout: LAUF_FRIST_MS }, (context) => {
  const mitKorrektur = { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(MIT_NUMMER)] };
  const gestoppt = imEntwurfAbgebrochen(context, mitKorrektur);
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
  const gestoppt = imEntwurfAbgebrochen(context);
  aendere(gestoppt);

  const lauf = entworfenNachFortsetzung(context, gestoppt);

  assert.equal(aufrufe(lauf, "planer", "## Zuschnitt").length, 1);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, PRUEFLISTE_LAEUFE);
}

test("plane --fortsetzen nach einem Abbruch in der Entwurfs-Welle schneidet und prüft neu, wenn planung/schnitt.json seit der Prüfung geändert ist", { timeout: LAUF_FRIST_MS }, (context) => {
  neuGeschnittenNach(context, (gestoppt) => umformatiert(gestoppt, "schnitt.json"));
});

test("plane --fortsetzen nach einem Abbruch in der Entwurfs-Welle schneidet und prüft neu, wenn planung/fingerabdruck.json seit der Prüfung geändert ist", { timeout: LAUF_FRIST_MS }, (context) => {
  neuGeschnittenNach(context, (gestoppt) => umformatiert(gestoppt, "fingerabdruck.json"));
});

test("plane --fortsetzen nach einem Abbruch in der Entwurfs-Welle schneidet und prüft neu, wenn planung/geprueft.json fehlt", { timeout: LAUF_FRIST_MS }, (context) => {
  neuGeschnittenNach(context, (gestoppt) => rmSync(planungsDatei(gestoppt, "geprueft.json")));
});

test("plane --fortsetzen nach einem Abbruch in der Entwurfs-Welle schneidet und prüft neu, wenn die Skriptprüfung den Schnitt trotz passender Prüfsumme beanstandet", { timeout: LAUF_FRIST_MS }, (context) => {
  neuGeschnittenNach(context, beanstandeterSchnittMitPassenderPruefsumme);
});
