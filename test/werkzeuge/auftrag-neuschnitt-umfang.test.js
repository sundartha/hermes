import assert from "node:assert/strict";
import { test } from "node:test";

import { ersterVersuch, funktion, ISSUE, lauf, MIT_TEXT, neu, neuUmbau, nummerierteNamen, ohne, OHNE_FIX, ORDNER, phase, PHASENDATEI, SCHNITT, schneide, TEST, TEXT_BESTAND, TEXT_TEST, umbau, UMBAU_FERTIG } from "./neuschnitt-probe.js";

test("ein Neuschnitt darf andere Aufträge, ihren Entwurf, Vorgänger und den Rahmen der Phasendatei nicht ändern", (context) => {
  const vorher = JSON.parse(phase([umbau("a0"), funktion("a1", { abhaengigVon: ["a0"] }), umbau("a2", { abhaengigVon: ["a1"] })]));
  const nachher = { ...vorher, issue: ISSUE + 1, entwurf: { ...vorher.entwurf, "src/text.js": "Anders." } };
  nachher.auftraege = [umbau("a0", { ziel: "Anders" }), funktion("a1"), funktion("a1-x"), umbau("a2", { abhaengigVon: ["a1"] })];
  const datei = (inhalt) => `${JSON.stringify(inhalt, null, 2)}\n`;
  const geschrieben = { dateien: { [PHASENDATEI]: datei(nachher) } };
  const rollen = { planer: [schneide([neu("a1-x")]), { ...SCHNITT, ...geschrieben }] };
  const { befunde, versuche, git } = ersterVersuch(context, rollen, { dateien: { [PHASENDATEI]: datei(vorher) }, bau: [UMBAU_FERTIG, OHNE_FIX] });
  assert.equal(git("log", "--format=%s", "-1"), "Verdopple Zahlen\n");
  for (const befund of [
    "a1-x: neue Aufträge heißen a1-n1, a1-n2 und so weiter.",
    "a1 hing von a0 ab; das muss auch ein neuer Auftrag in abhaengigVon nennen.",
  ]) {
    assert.ok(befunde.includes(befund), `${befund}\n${befunde.join("\n")}`);
  }
  assert.deepEqual(versuche[1].befunde, [`planer haben ${PHASENDATEI} geändert`]);
});

test("ein Neuschnitt mit Nachfolgern, die nicht genau Kennung-n und eine Zahl heißen, oder mit ungültiger Phasendatei wird abgelehnt", (context) => {
  const planer = [schneide([neu("a1-n01", { abhaengigVon: [{ id: "a1-n1x", grund: "a1-n01 braucht den Umbau" }] }), neuUmbau("a1-n1x"), neuUmbau("b1-n5", { abnahme: TEXT_BESTAND })]), schneide([neu("a1-n1", { art: "falsch" })])];
  const { versuche } = ersterVersuch(context, { planer, erkunder: [MIT_TEXT] });
  assert.deepEqual(versuche.map((versuch) => ohne(versuch, "planung")), [{ befunde: nummerierteNamen("a1-n01", "a1-n1x", "b1-n5") }, { befunde: ["Regel Form: a1-n1: art muss eine von funktion, fehlerbehebung, umbau, testumbau sein"] }]);
});

test("ein Neuschnitt, der einen anderen Auftrag weglässt oder mehrere andere Dateien anlegt, wird abgelehnt", (context) => {
  const dateien = { [PHASENDATEI]: phase([funktion("a1"), umbau("a2")]) };
  const ohneA2 = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1")]) } };
  const fremd = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1"), umbau("a2")]), [`${ORDNER}/design.md`]: "# Design\n", "notiz.txt": "Notiz\n" } };
  const { versuche } = ersterVersuch(context, { planer: [{ ...SCHNITT, ...ohneA2 }, { ...SCHNITT, ...fremd }] }, { dateien });
  assert.deepEqual(versuche.map((versuch) => ohne(versuch, "planung")), [
    { befunde: [`planer haben ${PHASENDATEI} geändert`] },
    { befunde: [`planer haben notiz.txt, ${ORDNER}/design.md, ${PHASENDATEI} geändert`] },
  ]);
});

test("ein Neuschnitt mit einem umbau, dessen Bereich nur Tests umfasst, wird abgelehnt wie im Umbau-Weg; als testumbau wird er angenommen", (context) => {
  const imSchnitt = (art) => schneide([neuUmbau("a1-n1", { art, bereich: "test/text/", erwarteteDateien: [TEXT_TEST, TEXT_BESTAND], wasDarfNiePassieren: [] }), neu("a1-n2", { abhaengigVon: [{ id: "a1-n1", grund: "a1-n2 braucht den Testumbau" }] })]);
  const abgelehnt = ersterVersuch(context, { planer: [imSchnitt("umbau")] });
  assert.deepEqual(abgelehnt.befunde, [["Regel Umbau-Test: a1-n1: abnahme test/text/gross.test.js gehört laut Dateikarte zu keiner Datei des Umbaus ()", "Regel Bereich: a1-n1: erwarteteDateien nennt keine Produktdatei"].join("\n")]);
  const angenommen = lauf(context, { test: [TEST], bau: [OHNE_FIX], planer: [imSchnitt("testumbau")], notiz: [{ antwort: "1. Pitch prüfen" }] });
  const [versuch] = angenommen.beleg("a1-neuschnitt").versuche;
  assert.deepEqual([versuch.befunde, versuch.neu.map(({ id }) => id)], [undefined, ["a1-n1", "a1-n2"]]);
});
