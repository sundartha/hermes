import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ersterVersuch, EXIT_ROT, funktion, lauf, MIT_TEXT, neu, neuUmbau, OHNE_FIX, ORDNER, phase, PHASENDATEI, PITCH, REPO, S1, schneide, SCHNITT, TEST, umbau, VERBOT } from "./neuschnitt-probe.js";

test("ein Neuschnitt, der den Szenariotext in der Phasendatei ändert, wird abgelehnt und endet nach dem zweiten Versuch als Entscheidungsnotiz", (context) => {
  const geaendert = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1", { szenarien: { S1: S1.replace("`4`", "`4` oder mehr") } })]) } };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [geaendert], planer: [{ ...SCHNITT, dateien: geaendert.dateien }], notiz: [{ antwort: "1. Pitch prüfen" }] };
  const { ergebnis, beleg, git, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(datei("anzahl-planung"), "2");
  const [erster] = beleg("a1-neuschnitt").versuche;
  assert.ok(erster.befunde.some((befund) => befund.startsWith('a1-n1: szenarien["S1"] ist nicht wörtlich der Text aus pitch.md')), erster.befunde.join("\n"));
  assert.match(datei("prompt-planung.txt"), /## Befunde zu deinem vorigen Neuschnitt[\s\S]*ist nicht wörtlich/);
  assert.equal(git("show", `HEAD:${PHASENDATEI}`), REPO[PHASENDATEI]);
  assert.equal(git("status", "--porcelain"), "");
  assert.match(datei("gh.log"), /"comment","54".*nicht so neu geschnitten.*Pitch prüfen/);
});

test("ein Neuschnitt, der Szenario und Pitch zugleich ändert, wird abgelehnt und der Pitch bleibt, wie er war", (context) => {
  const anders = S1.replace("`4`", "`5`");
  const beides = { dateien: { [`${ORDNER}/pitch.md`]: PITCH.replace(S1, anders), [PHASENDATEI]: phase([funktion("a1-n1", { szenarien: { S1: anders } })]) } };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [beides], planer: [{ ...SCHNITT, dateien: beides.dateien }], notiz: [{ antwort: "1. Pitch prüfen" }] };
  const { ergebnis, beleg, repo } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual(beleg("a1-neuschnitt").versuche[0].befunde, [`Der Planer darf nur ${PHASENDATEI} ändern, nicht ${ORDNER}/pitch.md.`]);
  assert.equal(readFileSync(join(repo, ORDNER, "pitch.md"), "utf8"), PITCH);
});

test("ein Neuschnitt, der einen Satz aus wasDarfNiePassieren weglässt, wird abgelehnt", (context) => {
  const ohne = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1", { wasDarfNiePassieren: [] })]) } };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [ohne], planer: [schneide([neu("a1-n1", { wasDarfNiePassieren: [] })])], notiz: [{ antwort: "1. Pitch prüfen" }] };
  const { ergebnis, beleg } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual(beleg("a1-neuschnitt").versuche[0].befunde, [`Kein neuer Auftrag mit eigenem Abnahmetest übernimmt aus a1 wörtlich: ${VERBOT}`]);
});

test("ein Neuschnitt, der den Satz aus wasDarfNiePassieren nur einem Umbau gibt, wird abgelehnt", (context) => {
  const auftraege = [umbau("a1-n1", { wasDarfNiePassieren: [VERBOT] }), funktion("a1-n2", { wasDarfNiePassieren: [], abhaengigVon: ["a1-n1"] })];
  const grund = "a1-n2 braucht den Umbau";
  const schnitt = schneide([neuUmbau("a1-n1"), neu("a1-n2", { wasDarfNiePassieren: [], abhaengigVon: [{ id: "a1-n1", grund }] })]);
  const { befunde } = ersterVersuch(context, { planung: [{ dateien: { [PHASENDATEI]: phase(auftraege) } }], planer: [schnitt], erkunder: [MIT_TEXT] });
  assert.deepEqual(befunde, [`Kein neuer Auftrag mit eigenem Abnahmetest übernimmt aus a1 wörtlich: ${VERBOT}`]);
});
