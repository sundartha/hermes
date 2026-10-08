import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DOPPELT, EINGANG_QUELLE, FREMDE_QUELLE, RECHNEN_TEST } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, EXIT_ROT, erwarteGemeldetenVerlust, messeUndMelde } from "./ausmisten/messung.mjs";

function branchArtefakt(artefakte) {
  return JSON.parse(readFileSync(join(artefakte, "branch-0", "branch-0.json"), "utf8"));
}

test("ausmisten-frueh: ein verlorener Mutant macht schon die Branch-Messung rot und nennt Ort und Mutator", async (context) => {
  const ergebnis = await messeUndMelde(context, { weg: [RECHNEN_TEST] });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.equal(ergebnis.zweig.status, EXIT_ROT, ergebnis.zweig.ausgabe);
  assert.match(
    ergebnis.zweig.ausgabe,
    /Verstoß: Mutant auf dem Branch nicht mehr getötet: src\/fremd\/rechnen\.js:2:\d+-2:\d+ \w+ → /,
  );
  assert.match(
    ergebnis.zweig.ausgabe,
    /Paket 0: rot nach src\/fremd\/rechnen\.js; 1 weitere Dateien nicht mehr gemessen\./,
  );
  erwarteGemeldetenVerlust(ergebnis, FREMDE_QUELLE);
});

test("ausmisten-frueh: nach dem ersten Verstoß misst der Branch keine weitere Datei und legt sein Ergebnis trotzdem ab", async (context) => {
  const ergebnis = await messeUndMelde(context, { weg: [RECHNEN_TEST] });
  const branch = branchArtefakt(ergebnis.artefakte);
  assert.deepEqual(branch.dateien, [FREMDE_QUELLE, EINGANG_QUELLE]);
  assert.deepEqual(branch.gemessen, [FREMDE_QUELLE]);
  assert.deepEqual(
    branch.jeDatei.map(({ datei }) => datei),
    [FREMDE_QUELLE],
  );
  assert.match(
    ergebnis.melden.ausgabe,
    /Paket 0 nach dem ersten Verstoß abgebrochen, nicht gemessen: src\/post\/eingang\.js/,
  );
});

test("ausmisten-frueh: ohne Verstoß misst der Branch jede Datei und bleibt grün", async (context) => {
  const ergebnis = await messeUndMelde(context, { weg: [DOPPELT] });
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  assert.deepEqual(
    branchArtefakt(ergebnis.artefakte).gemessen,
    branchArtefakt(ergebnis.artefakte).dateien,
  );
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
});
