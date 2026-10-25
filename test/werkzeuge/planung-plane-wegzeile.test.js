import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, GRUPPEN, HINWEIS, LAUF_FRIST_MS, ROUTE, WEGPRUEFUNGEN, alsJson, aufrufe, bericht, exit, schnittliste } from "./planung-probe.js";
import { A2_BEFUND, EXIT_GRUEN, MIT_NUMMER, WEGFEHLER, abgebrochen, abgelegt, aendereWerkzeug, antwortMit, fortsetzung, jePruefer, plane, planungsDatei, prueflisteZeilen } from "./planung-plane-probe.js";

const ZEILE_DES_WEGPRUEFERS = 2;
const WEG_FUNDSTELLE = `${HINWEIS}:${ZEILE_DES_WEGPRUEFERS}`;
const WEG_GRUEN = { ...GRUEN_PRUEFLISTE, fundstelle: WEG_FUNDSTELLE };
const WEGE_GRUEN = { "pruefer-planung|## Wegprüfung": Array.from({ length: WEGPRUEFUNGEN }, () => WEG_GRUEN) };
const ERFUNDENE_AENDERUNG = { datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 };
const ALLE = GRUPPEN.flatMap(({ nummern }) => nummern);
const ERSTE = GRUPPEN[0].nummern;

function wegzeilenBeimPruefer(lauf, ueberschrift = "## Prüfung") {
  return aufrufe(lauf, "pruefer-planung", ueberschrift).flatMap(prueflisteZeilen).filter((zeile) => zeile.startsWith("weg:"));
}

function abgenommen(nummer) {
  return { schluessel: `weg:${nummer}`, ergebnis: "erfüllt", fundstelle: WEG_FUNDSTELLE };
}

function zeileIn(lauf, datei, nummer) {
  return abgelegt(lauf, datei).find(({ schluessel }) => schluessel === `weg:${nummer}`);
}

test("plane: eine Wegzeile, die die Wegprüfung ohne Befund abgenommen hat, geht nicht an den Prüfer, solange der Bericht der Nummer gleich ist", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, WEGE_GRUEN);
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Wegprüfung").length, GRUPPEN.length);
  assert.deepEqual(wegzeilenBeimPruefer(lauf), []);
  assert.ok(aufrufe(lauf, "pruefer-planung", "## Prüfung").flatMap(prueflisteZeilen).includes("durchstich:a1"));
});

test("plane: die übernommene Wegzeile steht in pruefliste.json als erfüllt mit der Fundstelle der Wegprüfung", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, WEGE_GRUEN);
  exit(lauf, EXIT_GRUEN);
  for (const nummer of ALLE) assert.deepEqual(zeileIn(lauf, "pruefliste.json", nummer), abgenommen(nummer));
});

test("plane: ein geänderter Bericht der Nummer bringt die Wegzeile wieder in die Prüfliste", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context, WEGE_GRUEN);
  const datei = planungsDatei(vorher, "erkundung-g1.json");
  const gelesen = JSON.parse(readFileSync(datei, "utf8"));
  const inhalt = JSON.stringify({ ...gelesen, nummern: { ...gelesen.nummern, S1: { ...gelesen.nummern.S1, schema: { aenderung: false, fundstelle: `${ROUTE} Zeile 2` } } } });
  writeFileSync(datei, inhalt);
  const abdruck = abgelegt(vorher, "fingerabdruck.json");
  const summe = createHash("sha256").update(inhalt).digest("hex");
  writeFileSync(planungsDatei(vorher, "fingerabdruck.json"), JSON.stringify({ ...abdruck, ablage: { ...abdruck.ablage, "erkundung-g1.json": summe } }));
  const lauf = fortsetzung(context, vorher);
  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(wegzeilenBeimPruefer(lauf), ["weg:S1"]);
  assert.deepEqual(zeileIn(lauf, "pruefliste.json", "S2"), abgenommen("S2"));
});

test("plane: eine Wegprüfung mit Befund oder mit verworfener Korrektur wird nicht übernommen", { timeout: LAUF_FRIST_MS }, (context) => {
  const befund = plane(context, { ...WEGE_GRUEN, "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, WEGFEHLER], "erkunder|## Befunde": [bericht(ERSTE)] });
  exit(befund, EXIT_GRUEN);
  assert.deepEqual(wegzeilenBeimPruefer(befund).toSorted(), ERSTE.map((nummer) => `weg:${nummer}`).toSorted());
  const erfunden = bericht(ERSTE, { S1: { aenderungen: [ERFUNDENE_AENDERUNG] } });
  const verworfen = plane(context, { ...WEGE_GRUEN, "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER], "erkunder|## Befunde": [erfunden, erfunden] });
  exit(verworfen, EXIT_GRUEN);
  assert.deepEqual(wegzeilenBeimPruefer(verworfen).toSorted(), ERSTE.map((nummer) => `weg:${nummer}`).toSorted());
  assert.deepEqual(zeileIn(verworfen, "pruefliste.json", "S4"), abgenommen("S4"));
});

test("plane: eine spätere Wegprüfung mit Befund verwirft die frühere Abnahme derselben Nummer, auch wenn der Bericht gleich bleibt", { timeout: LAUF_FRIST_MS }, (context) => {
  const nachfrage = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo endet der Weg von S4?" }] });
  const befund = { ...GRUEN_PRUEFLISTE, befunde: { "weg:S4": "der Weg endet nicht in setzeHinweis" } };
  const lauf = plane(context, {
    ...WEGE_GRUEN,
    "planer|## Zuschnitt": [nachfrage, alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|S4": [bericht(["S4"])],
    "pruefer-planung|## Wegprüfung|S4": [WEG_GRUEN, befund, befund],
    "erkunder|## Befunde": [bericht(["S4"])],
  });
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Wegprüfung").filter(({ eingabe }) => eingabe.includes("#### S4 (")).length, 3);
  assert.deepEqual(wegzeilenBeimPruefer(lauf), ["weg:S4"]);
});

test("plane: die Nachprüfung fragt eine abgenommene Wegzeile nicht neu, solange der Bericht der Nummer gleich ist", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { ...WEGE_GRUEN, "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(MIT_NUMMER)] });
  exit(lauf, EXIT_GRUEN);
  const [nachpruefung] = aufrufe(lauf, "pruefer-planung", "## Nachprüfung");
  assert.ok(prueflisteZeilen(nachpruefung).includes("durchstich:a1"));
  assert.deepEqual(wegzeilenBeimPruefer(lauf, "## Nachprüfung"), []);
  assert.deepEqual(zeileIn(lauf, "nachpruefung-1.json", "S4"), abgenommen("S4"));
});

test("plane --fortsetzen: nach einem Fortsetzen gilt eine abgenommene Wegzeile mit dem gespeicherten Stand", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context, WEGE_GRUEN);
  const lauf = fortsetzung(context, vorher);
  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung", "## Wegprüfung"), []);
  assert.deepEqual(wegzeilenBeimPruefer(lauf), []);
  assert.deepEqual(zeileIn(lauf, "pruefliste.json", "B1"), abgenommen("B1"));
});

test("plane: eine Wegzeile aus einem Lauf vor einer Änderung unter tools/ wird nach dem Fortsetzen wieder vom Prüfer gelesen", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context, WEGE_GRUEN);
  aendereWerkzeug(vorher, { committet: true });
  const lauf = fortsetzung(context, vorher);
  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(wegzeilenBeimPruefer(lauf).toSorted(), ALLE.map((nummer) => `weg:${nummer}`).toSorted());
});
