import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALES } from "../../src/i18n/locales.js";
import { urteilen } from "../../scripts/anruf-probe/urteil.mjs";
import { probeLaufen } from "../../scripts/anruf-probe/wiederholung.mjs";

const GUT = {
  annahmeSekunden: 15,
  begruessung: LOCALES.de.disclosure("Probe GmbH") + " Wie kann ich helfen?",
  sprache: "de",
  auftraggeber: "Probe GmbH",
  dauerSekunden: 60,
  status: "completed",
};

const TABELLE = [
  ["alles an der Grenze ist grün", {}, []],
  ["Annahme nach 16 s", { annahmeSekunden: 16 }, ["annahme"]],
  ["Annahme unbekannt", { annahmeSekunden: undefined }, ["annahme"]],
  ["Dauer 61 s", { dauerSekunden: 61 }, ["dauer"]],
  ["Dauer unbekannt", { dauerSekunden: undefined }, ["dauer"]],
  ["Begrüßung fehlt", { begruessung: "" }, ["begruessung"]],
  ["Begrüßung nur Leerraum", { begruessung: "  " }, ["begruessung"]],
  ["Begrüßung kein Text", { begruessung: undefined }, ["begruessung"]],
  ["Begrüßung ohne Offenlegungssatz", { begruessung: "Hallo, hier ist Probe GmbH." }, ["offenlegung"]],
  ["Sprache unbekannt", { sprache: "xx" }, ["offenlegung"]],
  ["Status nicht beendet", { status: "failed" }, ["status"]],
  ["zwei Werte gerissen", { status: "busy", dauerSekunden: 99 }, ["dauer", "status"]],
];

for (const [name, abweichung, erwartet] of TABELLE) {
  test(`Urteil: ${name}`, () => {
    const urteil = urteilen({ ...GUT, ...abweichung });
    assert.deepEqual(urteil.gerissen, erwartet);
    assert.equal(urteil.gruen, erwartet.length === 0);
  });
}

test("Urteil: Offenlegung mit anderem Auftraggeber ist rot, Wortlaut vorne mit Leerraum bleibt grün", () => {
  assert.deepEqual(urteilen({ ...GUT, auftraggeber: "Andere AG" }).gerissen, ["offenlegung"]);
  assert.equal(urteilen({ ...GUT, begruessung: `  ${GUT.begruessung}` }).gruen, true);
});

test("Urteil: ohne Messung oder mit Nicht-Objekt ist rot mit dem Namen messung", () => {
  assert.deepEqual(urteilen(null).gerissen, ["messung"]);
  assert.deepEqual(urteilen("x").gerissen, ["messung"]);
});

function uhrBauen() {
  const waren = [];
  return { waren, jetzt: () => Date.parse("2026-11-17T10:00:00.000Z"), warte: async (ms) => waren.push(ms) };
}

function messenAus(messungen) {
  let n = 0;
  return async () => {
    const eintrag = messungen[n];
    n += 1;
    if (eintrag instanceof Error) throw eintrag;
    return eintrag;
  };
}

test("Wiederholung: grüner Erstversuch ruft nicht noch einmal und wartet nicht", async () => {
  const uhr = uhrBauen();
  const ergebnis = await probeLaufen({ messen: messenAus([GUT]), uhr });
  assert.equal(ergebnis.ausgang, "gruen");
  assert.deepEqual(uhr.waren, []);
});

test("Wiederholung: Erstversuch rot, Wiederholung nach 120000 ms grün", async () => {
  const uhr = uhrBauen();
  const ergebnis = await probeLaufen({ messen: messenAus([{ ...GUT, status: "failed" }, GUT]), uhr });
  assert.equal(ergebnis.ausgang, "wiederholung_gruen");
  assert.deepEqual(uhr.waren, [120000]);
});

test("Wiederholung: beide rot, Zeit des ersten roten Versuchs bleibt; ein Messfehler zählt als rot", async () => {
  const uhr = uhrBauen();
  const ergebnis = await probeLaufen({ messen: messenAus([new Error("x"), { ...GUT, dauerSekunden: 70 }]), uhr });
  assert.equal(ergebnis.ausgang, "rot");
  assert.equal(ergebnis.seit, "2026-11-17T10:00:00.000Z");
  assert.deepEqual(ergebnis.erst.gerissen, ["messung"]);
  assert.deepEqual(ergebnis.zweit.gerissen, ["dauer"]);
});
