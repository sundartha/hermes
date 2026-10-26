import assert from "node:assert/strict";
import { test } from "node:test";

import { prueflisteSoll } from "../../tools/auftrag/planung/antworten.mjs";
import { teilePruefliste } from "../../tools/auftrag/planung/aufteilung.mjs";

const SOLL = new Map([["S1", {}], ["S2", {}], ["S3", {}], ["B1", {}]]);
const GRUPPEN = [{ nummern: ["S1", "S2"] }, { nummern: ["S3", "B1"] }, { nummern: ["S9"] }];
const UEBERGREIFEND = null;
const GRUPPE_S1 = GRUPPEN.findIndex(({ nummern }) => nummern.includes("S1"));
const GRUPPE_S3 = GRUPPEN.findIndex(({ nummern }) => nummern.includes("S3"));

function auftrag(id, prueft, zusatz = {}) {
  return { id, art: "funktion", bereich: "src/routes/", prueft, abhaengigVon: [], ...zusatz };
}

const SCHNITT = {
  auftraege: [
    auftrag("a0", "kein Szenario, weil nur umgebaut wird", { art: "umbau" }),
    auftrag("a1", ["S1"], { falscheAngaben: [{ nummer: "S1", datei: "src/routes/nummer.js" }] }),
    auftrag("a2", ["S2"], { abhaengigVon: [{ id: "a1", grund: "braucht den Code" }] }),
    auftrag("a3", ["S3"], { abhaengigVon: [{ id: "a2", grund: "liest den Status" }] }),
    auftrag("a4", ["S2", "S3"], { bereichsgrund: "Route und Anruf ändern sich zusammen" }),
    auftrag("a5", ["B1"], { abhaengigVon: [{ id: "a0", grund: "nutzt die herausgezogene Prüfung" }] }),
  ],
};
const ANNAHMEN = [{ nummer: "S3", angabe: "vorbild", text: "nicht gefunden, weil kein Vorbild" }];

const ERWARTET = {
  "durchstich:a1": UEBERGREIFEND,
  "weg:S1": GRUPPE_S1,
  "weg:S2": GRUPPE_S1,
  "weg:S3": GRUPPE_S3,
  "weg:B1": GRUPPE_S3,
  "umbau:a0": UEBERGREIFEND,
  "b-nummer:B1": GRUPPE_S3,
  "nie-saetze:a0": UEBERGREIFEND,
  "allein-gruen:a0": UEBERGREIFEND,
  "nicht-zusammengelegt:a0": UEBERGREIFEND,
  "nie-saetze:a1": GRUPPE_S1,
  "allein-gruen:a1": GRUPPE_S1,
  "nicht-zusammengelegt:a1": UEBERGREIFEND,
  "nie-saetze:a2": GRUPPE_S1,
  "allein-gruen:a2": GRUPPE_S1,
  "nicht-zusammengelegt:a2": UEBERGREIFEND,
  "nie-saetze:a3": GRUPPE_S3,
  "allein-gruen:a3": UEBERGREIFEND,
  "nicht-zusammengelegt:a3": UEBERGREIFEND,
  "nie-saetze:a4": UEBERGREIFEND,
  "allein-gruen:a4": UEBERGREIFEND,
  "nicht-zusammengelegt:a4": UEBERGREIFEND,
  "nie-saetze:a5": GRUPPE_S3,
  "allein-gruen:a5": GRUPPE_S3,
  "nicht-zusammengelegt:a5": UEBERGREIFEND,
  "bereichsgrund:a4": UEBERGREIFEND,
  "ausweg:S3:vorbild": GRUPPE_S3,
  "falsche-angabe:a1:S1:src/routes/nummer.js": GRUPPE_S1,
  "gegenfrage:alle": UEBERGREIFEND,
};

test("aufteilung: die Schlüssel aller Prüfer ergeben genau prueflisteSoll", () => {
  const schluessel = prueflisteSoll(SCHNITT, SOLL, ANNAHMEN);
  assert.deepEqual(Object.keys(ERWARTET).toSorted(), schluessel.toSorted());
  const teile = teilePruefliste(schluessel, SCHNITT, GRUPPEN);
  assert.deepEqual(teile.map(({ gruppe }) => gruppe), [GRUPPE_S1, GRUPPE_S3, UEBERGREIFEND]);
  const alle = teile.flatMap((teil) => teil.schluessel);
  assert.equal(alle.length, schluessel.length);
  assert.deepEqual(alle.toSorted(), schluessel.toSorted());
  const zuordnung = Object.fromEntries(teile.flatMap(({ gruppe, schluessel: eigene }) => eigene.map((eintrag) => [eintrag, gruppe])));
  assert.deepEqual(zuordnung, ERWARTET);
});

test("aufteilung: bei einer Gruppe bleibt die Prüfliste ein Teil mit allen Schlüsseln", () => {
  const schluessel = prueflisteSoll(SCHNITT, SOLL, ANNAHMEN);
  assert.deepEqual(teilePruefliste(schluessel, SCHNITT, [{ nummern: [...SOLL.keys()] }]), [{ gruppe: 0, schluessel }]);
});

test("aufteilung: ohne Gruppen prüft ein Prüfer alle Schlüssel", () => {
  const schluessel = prueflisteSoll(SCHNITT, SOLL, ANNAHMEN);
  assert.deepEqual(teilePruefliste(schluessel, SCHNITT, []), [{ gruppe: UEBERGREIFEND, schluessel }]);
});
