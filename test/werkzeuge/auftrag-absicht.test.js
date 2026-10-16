import assert from "node:assert/strict";
import { test } from "node:test";

import { phasenBefunde } from "../../tools/auftrag/format.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const BEREICH = "src/routes/api-onboard.js";
const AUFTRAG = { id: "a1", art: "umbau", ziel: "Ziehe die Prüfung heraus", bereich: BEREICH, erwarteteDateien: [BEREICH], abnahme: "test/x.test.js", prueft: "keiner, weil Umbau: bestehende Tests bleiben unverändert grün", abhaengigVon: [] };

function phaseMit(absicht) {
  return { phase: "p-1-probe", absicht, entwurf: { [BEREICH]: "Entwurf." }, auftraege: [AUFTRAG] };
}

test("Absicht: eine leere oder zu lange Absicht in der Phasendatei ist ein Befund, eine fehlende nicht", () => {
  const ohne = phaseMit("x");
  delete ohne.absicht;
  const zuLang = "a".repeat(1001);
  assert.deepEqual(phasenBefunde(ohne, REPO_ROOT).filter((befund) => befund.includes("Absicht")), []);
  assert.deepEqual(phasenBefunde(phaseMit("Wofür."), REPO_ROOT).filter((befund) => befund.includes("Absicht")), []);
  assert.match(phasenBefunde(phaseMit(" "), REPO_ROOT).join("\n"), /^Absicht ist leer/m);
  assert.match(phasenBefunde(phaseMit(zuLang), REPO_ROOT).join("\n"), /^Absicht hat 1001 Zeichen, höchstens 1000/m);
});
