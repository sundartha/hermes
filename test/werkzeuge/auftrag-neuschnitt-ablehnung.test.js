import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ersterVersuch, EXIT_ROT, funktion, lauf, MIT_TEXT, neu, neuUmbau, OHNE_FIX, ORDNER, phase, PHASENDATEI, PITCH, REPO, S1, schneide, SCHNITT, TEST, VERBOT } from "./neuschnitt-probe.js";

test("ein Neuschnitt, der den Szenariotext in der Phasendatei ändert, wird abgelehnt und endet nach dem zweiten Versuch als Entscheidungsnotiz", (context) => {
  const geaendert = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1", { szenarien: { S1: S1.replace("`4`", "`4` oder mehr") } })]) } };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planer: [{ ...SCHNITT, dateien: geaendert.dateien }], notiz: [{ antwort: "1. Pitch prüfen" }] };
  const { ergebnis, beleg, git, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(datei("anzahl-planer"), "2");
  const { versuche, agenten } = beleg("a1-neuschnitt");
  assert.deepEqual(versuche[0].befunde, [`planer haben ${PHASENDATEI} geändert`]);
  assert.match(datei("prompt-planer.txt"), /## Befunde zu deinem vorigen Neuschnitt[\s\S]*planer haben /);
  const planer = new Set(agenten.filter(({ rolle }) => rolle === "planer").map(({ sitzung }) => sitzung));
  assert.equal(planer.size, 2, JSON.stringify(agenten));
  assert.equal(git("show", `HEAD:${PHASENDATEI}`), REPO[PHASENDATEI]);
  assert.equal(git("status", "--porcelain"), "");
  assert.match(datei("gh.log"), /"comment","54".*nicht so neu geschnitten.*Pitch prüfen/);
});

test("ein Neuschnitt, der Szenario und Pitch zugleich ändert, wird abgelehnt und der Pitch bleibt, wie er war", (context) => {
  const anders = S1.replace("`4`", "`5`");
  const beides = { dateien: { [`${ORDNER}/pitch.md`]: PITCH.replace(S1, anders), [PHASENDATEI]: phase([funktion("a1-n1", { szenarien: { S1: anders } })]) } };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planer: [{ ...SCHNITT, dateien: beides.dateien }], notiz: [{ antwort: "1. Pitch prüfen" }] };
  const { ergebnis, beleg, repo } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual(beleg("a1-neuschnitt").versuche[0].befunde, [`planer haben ${PHASENDATEI}, ${ORDNER}/pitch.md geändert`]);
  assert.equal(readFileSync(join(repo, ORDNER, "pitch.md"), "utf8"), PITCH);
});

test("ein Neuschnitt, der einen Satz aus wasDarfNiePassieren weglässt, wird abgelehnt", (context) => {
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planer: [schneide([neu("a1-n1", { wasDarfNiePassieren: [] })])], notiz: [{ antwort: "1. Pitch prüfen" }] };
  const { ergebnis, beleg } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual(beleg("a1-neuschnitt").versuche[0].befunde, [`Kein neuer Auftrag mit eigenem Abnahmetest übernimmt aus a1 wörtlich: ${VERBOT}`]);
});

test("ein Neuschnitt, der den Satz aus wasDarfNiePassieren nur einem Umbau gibt, wird abgelehnt", (context) => {
  const grund = "a1-n2 braucht den Umbau";
  const schnitt = schneide([neuUmbau("a1-n1"), neu("a1-n2", { wasDarfNiePassieren: [], abhaengigVon: [{ id: "a1-n1", grund }] })]);
  const { befunde } = ersterVersuch(context, { planer: [schnitt], erkunder: [MIT_TEXT] });
  assert.deepEqual(befunde, [`Kein neuer Auftrag mit eigenem Abnahmetest übernimmt aus a1 wörtlich: ${VERBOT}`]);
});
