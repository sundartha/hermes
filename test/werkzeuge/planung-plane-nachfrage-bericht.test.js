import assert from "node:assert/strict";
import { test } from "node:test";

import { GRUPPEN, LAUF_FRIST_MS, ROUTE, alsJson, aufrufe, bericht, exit, schnittliste } from "./planung-probe.js";
import { EXIT_GRUEN, plane } from "./planung-plane-probe.js";

const MARKE = { S1: "keine, weil die Erkundung S1 markiert", S4: "keine, weil die Erkundung S4 markiert", S5: "keine, weil die Erkundung S5 markiert" };
const ZU_S4 = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] });
const VERDICHTET = /^ownerEntscheidung: /mu;

function erkundetMitMarken(nummern) {
  return bericht(nummern, Object.fromEntries(nummern.filter((nummer) => MARKE[nummer]).map((nummer) => [nummer, { ownerEntscheidung: MARKE[nummer] }])));
}

function nachfrageZuS4(context, weitere = {}) {
  return plane(context, {
    "erkunder|## Erkundung|S1": [erkundetMitMarken(GRUPPEN[0].nummern)],
    "erkunder|## Erkundung|S4": [erkundetMitMarken(GRUPPEN[1].nummern)],
    "planer|## Zuschnitt": [ZU_S4, alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|S4": [bericht(["S4"])],
    ...weitere,
  });
}

function nachfrageNachricht(lauf) {
  const [nachfrage] = aufrufe(lauf, "erkunder", "## Nachfrage");
  assert.ok(nachfrage, "kein Nachfrage-Erkunder gestartet");
  return nachfrage.eingabe;
}

test("plane: die Nachfrage-Nachricht enthält den verdichteten Erkundungsbericht der nachgefragten Nummern", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = nachfrageZuS4(context);
  exit(lauf, EXIT_GRUEN);
  const eingabe = nachfrageNachricht(lauf);
  assert.match(eingabe, /^#### S4$/mu, eingabe);
  assert.ok(eingabe.includes(`ownerEntscheidung: ${MARKE.S4}`), eingabe);
});

test("plane: die Nachfrage-Nachricht enthält keine Berichtsteile zu Nummern, nach denen nicht gefragt wurde", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = nachfrageZuS4(context);
  exit(lauf, EXIT_GRUEN);
  const eingabe = nachfrageNachricht(lauf);
  assert.ok(eingabe.includes(MARKE.S4), eingabe);
  for (const fremd of [MARKE.S1, MARKE.S5]) assert.equal(eingabe.includes(fremd), false, `${fremd} steht in der Nachfrage:\n${eingabe}`);
  for (const nummer of ["S1", "S5", "B1"]) assert.equal(eingabe.split("\n").includes(`#### ${nummer}`), false, `Bericht zu ${nummer} steht in der Nachfrage:\n${eingabe}`);
});

test("plane: die Nachricht der ersten Erkundung bleibt ohne Berichtsteil", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = nachfrageZuS4(context);
  exit(lauf, EXIT_GRUEN);
  const erkundungen = aufrufe(lauf, "erkunder", "## Erkundung");
  assert.equal(erkundungen.length, GRUPPEN.length);
  for (const { eingabe } of erkundungen) assert.doesNotMatch(eingabe, VERDICHTET, eingabe);
  assert.match(nachfrageNachricht(lauf), VERDICHTET);
});

test("plane: der Bericht des Nachfrage-Erkunders wird weiter wie bisher geprüft", { timeout: LAUF_FRIST_MS }, (context) => {
  const erfunden = bericht(["S4"], { S4: { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] } });
  const lauf = nachfrageZuS4(context, { "erkunder|## Nachfrage|S4": [erfunden], "erkunder|## Befunde": [erfunden] });
  exit(lauf, EXIT_GRUEN);
  assert.match(nachfrageNachricht(lauf), VERDICHTET);
  const [rueckgabe] = aufrufe(lauf, "erkunder", "## Befunde");
  assert.ok(rueckgabe?.eingabe.includes("Funktion gibtEsNicht fehlt in"), rueckgabe?.eingabe);
  const { eingabe } = aufrufe(lauf, "planer", "## Zuschnitt")[1];
  assert.ok(eingabe.includes("Nachfragen zu S4 enden; schneide mit einer Annahme."), eingabe);
});
