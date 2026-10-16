import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { probeDirectory } from "./probe-repo.js";
import { ersterVersuch, EXIT_ROT, funktion, lauf, NEUSCHNITT, OHNE_FIX, ORDNER, phase, PHASENDATEI, PITCH, REPO, SCHNITT, SICHERHEIT, TEST } from "./neuschnitt-probe.js";

test("ein Neuschnitt, den der Planer selbst committet, wird abgelehnt und auf den Stand vor ihm zurückgesetzt", (context) => {
  const { befunde, git } = ersterVersuch(context, { planung: [{ ...NEUSCHNITT, commit: true }], planer: [{ ...SCHNITT, dateien: NEUSCHNITT.dateien, commit: true }] });
  assert.deepEqual(befunde, ["Der Planer darf nicht committen; der Lauf setzt auf den Stand vor ihm zurück."]);
  assert.equal(git("show", `HEAD:${PHASENDATEI}`), REPO[PHASENDATEI]);
  assert.equal(git("log", "--format=%s", "-1"), "Basis\n");
});

test("ein Planer, der Belege unter .fortschritt ändert, wird abgelehnt", (context) => {
  const beleg = { ".fortschritt/P-001-probe/a1.json": "{}" };
  const { befunde } = ersterVersuch(context, { planung: [{ dateien: { ...NEUSCHNITT.dateien, ...beleg } }], planer: [{ ...SCHNITT, dateien: beleg }] });
  assert.deepEqual(befunde, ["Der Planer hat .fortschritt/ verändert."]);
});

test("ohne vollständigen Plan aus einem Pitch im Repo oder nach einem Neuschnitt startet der Planer nicht und es entsteht gleich eine Entscheidungsnotiz", (context) => {
  const aussen = probeDirectory(context, { "plan/pitch.md": PITCH, "plan/sicherheit.md": SICHERHEIT, "plan/phase.json": REPO[PHASENDATEI] });
  const faelle = [
    { dateien: { [`${ORDNER}/pitch.md`]: undefined } },
    { dateien: { [`${ORDNER}/sicherheit.md`]: undefined } },
    { dateien: { [PHASENDATEI]: phase([funktion("a1")], { phase: "alt-P-001" }) } },
    { dateien: { [`${ORDNER}/phase-neu.json`]: REPO[PHASENDATEI] }, phasendatei: `${ORDNER}/phase-neu.json` },
    { phasendatei: join(aussen, "plan/phase.json") },
    { dateien: { [PHASENDATEI]: phase([funktion("a1-n12")]) } },
  ];
  for (const { dateien, phasendatei } of faelle) {
    const { ergebnis, datei } = lauf(context, { test: [TEST], bau: [OHNE_FIX], notiz: [{ antwort: "1. Plan prüfen" }] }, { dateien, phasendatei });
    const fall = JSON.stringify({ dateien, phasendatei });
    assert.equal(ergebnis.status, EXIT_ROT, fall + ergebnis.stdout + ergebnis.stderr);
    assert.deepEqual([datei("anzahl-planung"), datei("anzahl-notiz")], ["", "1"], fall);
  }
});
