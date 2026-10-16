import assert from "node:assert/strict";
import { test } from "node:test";

import { ABNAHME, ersterVersuch, funktion, ISSUE, lauf, nummerierteNamen, OHNE_FIX, ORDNER, phase, PHASENDATEI, TEST, TEXT_TEST, umbau, UMBAU_FERTIG } from "./neuschnitt-probe.js";

test("ein Neuschnitt darf andere Aufträge, ihren Entwurf, Vorgänger und den Rahmen der Phasendatei nicht ändern", (context) => {
  const vorher = JSON.parse(phase([umbau("a0"), funktion("a1", { abhaengigVon: ["a0"] }), umbau("a2", { abhaengigVon: ["a1"] })]));
  const nachher = { ...vorher, issue: ISSUE + 1, entwurf: { ...vorher.entwurf, "src/text.js": "Anders." } };
  nachher.auftraege = [umbau("a0", { ziel: "Anders" }), funktion("a1"), funktion("a1-x"), umbau("a2", { abhaengigVon: ["a1"] })];
  const datei = (inhalt) => `${JSON.stringify(inhalt, null, 2)}\n`;
  const { befunde, git } = ersterVersuch(context, [{ dateien: { [PHASENDATEI]: datei(nachher) } }], { dateien: { [PHASENDATEI]: datei(vorher) }, bau: [UMBAU_FERTIG, OHNE_FIX] });
  assert.equal(git("log", "--format=%s", "-1"), "Verdopple Zahlen\n");
  for (const befund of [
    "a1 steht noch in der Phasendatei; der Neuschnitt ersetzt ihn.",
    "a1-x: neue Aufträge heißen a1-n1, a1-n2 und so weiter.",
    "a0 hat sich geändert; ein Neuschnitt ersetzt nur a1.",
    "a1 hing von a0 ab; das muss auch ein neuer Auftrag in abhaengigVon nennen.",
    "Der Entwurf für src/text.js gehört auch anderen Aufträgen und bleibt, wie er ist.",
    "Außer auftraege und entwurf bleibt die Phasendatei, wie sie ist.",
  ]) {
    assert.ok(befunde.includes(befund), `${befund}\n${befunde.join("\n")}`);
  }
});

test("ein Neuschnitt mit Nachfolgern, die nicht genau Kennung-n und eine Zahl heißen, oder mit ungültiger Phasendatei wird abgelehnt", (context) => {
  const falscheNamen = phase([funktion("a1-n01"), umbau("a1-n1x"), umbau("b1-n5")]);
  const falscheArt = phase([funktion("a1-n1", { art: "falsch" })]);
  const { versuche } = ersterVersuch(context, [{ dateien: { [PHASENDATEI]: falscheNamen } }, { dateien: { [PHASENDATEI]: falscheArt } }]);
  assert.deepEqual(versuche, [{ befunde: nummerierteNamen("a1-n01", "a1-n1x", "b1-n5") }, { befunde: ["a1-n1: art muss eine von funktion, fehlerbehebung, umbau, testumbau sein", `a1-n1: ein Umbau braucht einen bestehenden Verhaltenstest, ${ABNAHME} fehlt`] }]);
});

test("ein Neuschnitt, der einen anderen Auftrag weglässt oder mehrere andere Dateien anlegt, wird abgelehnt", (context) => {
  const dateien = { [PHASENDATEI]: phase([funktion("a1"), umbau("a2")]) };
  const ohneA2 = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1")]) } };
  const fremd = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1"), umbau("a2")]), [`${ORDNER}/design.md`]: "# Design\n", "notiz.txt": "Notiz\n" } };
  const { versuche } = ersterVersuch(context, [ohneA2, fremd], { dateien });
  assert.deepEqual(versuche, [
    { befunde: ["a2 fehlt; ein Neuschnitt ersetzt nur a1."] },
    { befunde: [`Der Planer darf nur ${PHASENDATEI} ändern, nicht notiz.txt, ${ORDNER}/design.md.`] },
  ]);
});

test("ein Neuschnitt mit einem umbau, dessen Bereich nur Tests umfasst, wird abgelehnt wie im Umbau-Weg; als testumbau wird er angenommen", (context) => {
  const entwurf = { "src/rechnen.js": "Entwurf.", "src/text.js": "Entwurf Text.", "test/": "Entwurf Tests." };
  const schnitt = (art) => phase([umbau("a1-n1", { art, bereich: "test/", erwarteteDateien: [TEXT_TEST], wasDarfNiePassieren: [] }), funktion("a1-n2", { abhaengigVon: ["a1-n1"] })], { entwurf });
  const abgelehnt = ersterVersuch(context, [{ dateien: { [PHASENDATEI]: schnitt("umbau") } }]);
  assert.deepEqual(abgelehnt.befunde, ["a1-n1: bereich test/ umfasst nur Tests; ein reiner Testumbau hat art testumbau und läuft beim Test-Agenten, weil der Bau-Agent keine Tests ändert"]);
  const angenommen = lauf(context, { test: [TEST], bau: [OHNE_FIX], planung: [{ dateien: { [PHASENDATEI]: schnitt("testumbau") } }], notiz: [{ antwort: "1. Pitch prüfen" }] });
  const [versuch] = angenommen.beleg("a1-neuschnitt").versuche;
  assert.deepEqual([versuch.befunde, versuch.neu.map(({ id }) => id)], [undefined, ["a1-n1", "a1-n2"]]);
});
