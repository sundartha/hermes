import assert from "node:assert/strict";
import { test } from "node:test";

import { ABNAHME, ersterVersuch, funktion, ISSUE, lauf, MIT_TEXT, neu, neuUmbau, nummerierteNamen, ohne, OHNE_FIX, ohneTeam, ORDNER, phase, PHASENDATEI, SCHNITT, schneide, TEST, TEXT_BESTAND, TEXT_TEST, umbau, UMBAU_FERTIG } from "./neuschnitt-probe.js";

function fremdGeaendert() {
  const vorher = JSON.parse(phase([umbau("a0"), funktion("a1", { abhaengigVon: ["a0"] }), umbau("a2", { abhaengigVon: ["a1"] })]));
  const nachher = { ...vorher, issue: ISSUE + 1, entwurf: { ...vorher.entwurf, "src/text.js": "Anders." } };
  nachher.auftraege = [umbau("a0", { ziel: "Anders" }), funktion("a1"), funktion("a1-x"), umbau("a2", { abhaengigVon: ["a1"] })];
  const datei = (inhalt) => `${JSON.stringify(inhalt, null, 2)}\n`;
  return { vorher: datei(vorher), nachher: datei(nachher) };
}

test("ein Neuschnitt darf andere Aufträge, ihren Entwurf, Vorgänger und den Rahmen der Phasendatei nicht ändern", (context) => {
  const { vorher, nachher } = fremdGeaendert();
  const geschrieben = { dateien: { [PHASENDATEI]: nachher } };
  const rollen = { planer: [schneide([neu("a1-x")]), { ...SCHNITT, ...geschrieben }] };
  const { befunde, versuche, git } = ersterVersuch(context, rollen, { dateien: { [PHASENDATEI]: vorher }, bau: [UMBAU_FERTIG, OHNE_FIX] });
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

test("lässt der Kindlauf einen Schnitt durch, der andere Aufträge, Rahmen, Vorgänger, Arten oder fremde Dateien ändert oder keinen neuen Auftrag nennt, lehnt lauf ihn selbst mit diesen Befunden ab", (context) => {
  const { vorher, nachher } = fremdGeaendert();
  const nurA1 = { [PHASENDATEI]: phase([funktion("a1"), umbau("a2")]) };
  const entwurf = { "src/rechnen.js": "Entwurf.", "src/text.js": "Entwurf Text.", "test/": "Entwurf Tests." };
  ohneTeam(context, [
    {
      kind: { [PHASENDATEI]: nachher },
      dateien: { [PHASENDATEI]: vorher },
      bau: [UMBAU_FERTIG, OHNE_FIX],
      erwartet: [
        "a1 steht noch in der Phasendatei; der Neuschnitt ersetzt ihn.",
        "a1-x: neue Aufträge heißen a1-n1, a1-n2 und so weiter.",
        "a0 hat sich geändert; ein Neuschnitt ersetzt nur a1.",
        "a2 hat sich geändert; ein Neuschnitt ersetzt nur a1.",
        "a1 hing von a0 ab; das muss auch ein neuer Auftrag in abhaengigVon nennen.",
        "Der Entwurf für src/text.js gehört auch anderen Aufträgen und bleibt, wie er ist.",
        "Außer auftraege und entwurf bleibt die Phasendatei, wie sie ist.",
        `rot: 1 Befunde in ${ORDNER}.`,
        "S1 gehört mehreren Aufträgen: a1, a1-x",
      ],
    },
    { kind: { [PHASENDATEI]: phase([funktion("a1-n1")]) }, dateien: nurA1, erwartet: ["a2 fehlt; ein Neuschnitt ersetzt nur a1."] },
    {
      kind: { [PHASENDATEI]: phase([umbau("a2")]) },
      dateien: nurA1,
      erwartet: [
        "Der Neuschnitt nennt keinen neuen Auftrag statt a1.",
        "Kein neuer Auftrag mit eigenem Abnahmetest übernimmt aus a1 wörtlich: Eine negative Zahl wird nie positiv.",
        `rot: 1 Befunde in ${ORDNER}.`,
        "S1 gehört keinem Auftrag",
      ],
    },
    { kind: { [PHASENDATEI]: phase([funktion("a1-n1"), umbau("a2")]), [`${ORDNER}/design.md`]: "# Design\n", "notiz.txt": "Notiz\n" }, dateien: nurA1, erwartet: [`Der Planer darf nur ${PHASENDATEI} ändern, nicht notiz.txt, ${ORDNER}/design.md.`] },
    { kind: { [PHASENDATEI]: phase([funktion("a1-n1", { art: "falsch" })]) }, erwartet: ["a1-n1: art muss eine von funktion, fehlerbehebung, umbau, testumbau sein", `a1-n1: ein Umbau braucht einen bestehenden Verhaltenstest, ${ABNAHME} fehlt`] },
    {
      kind: { [PHASENDATEI]: phase([umbau("a1-n1", { bereich: "test/", erwarteteDateien: [TEXT_TEST], wasDarfNiePassieren: [] }), funktion("a1-n2", { abhaengigVon: ["a1-n1"] })], { entwurf }) },
      erwartet: ["a1-n1: bereich test/ umfasst nur Tests; ein reiner Testumbau hat art testumbau und läuft beim Test-Agenten, weil der Bau-Agent keine Tests ändert"],
    },
  ]);
});
