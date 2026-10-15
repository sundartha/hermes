import assert from "node:assert/strict";
import { test } from "node:test";

import { phasenBefunde } from "../../tools/auftrag/format.mjs";
import { prueflisteSoll } from "../../tools/auftrag/planung/antworten.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const UMBAU_AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";

function auftrag(felder) {
  return {
    id: "A1",
    art: "testumbau",
    ziel: "Ziehe die Vorbereitung in eine Hilfe",
    bereich: "test/",
    erwarteteDateien: ["test/text.test.js", "test/hilfe.js"],
    vorbild: "test/text.test.js",
    abnahme: "test/text.test.js",
    prueft: UMBAU_AUSWEG,
    ...felder,
  };
}

function befunde(eintrag) {
  return phasenBefunde({ phase: "P-1-probe", entwurf: { [eintrag.bereich]: "Entwurf." }, auftraege: [eintrag] }, REPO_ROOT);
}

test("Testumbau: ein Umbau nur aus Tests muss testumbau heißen, ein testumbau braucht einen Bereich nur aus Tests und ändert keinen Produktcode", () => {
  const abnahme = "test/website-onboarding/portal-zugang.test.js";
  const gueltig = auftrag({ bereich: "test/website-onboarding/", erwarteteDateien: ["test/website-onboarding/hilfe.js"], vorbild: abnahme, abnahme });
  assert.deepEqual(befunde(gueltig), []);
  assert.match(befunde({ ...gueltig, art: "umbau" }).join("\n"), /A1: bereich test\/website-onboarding\/ umfasst nur Tests; ein reiner Testumbau hat art testumbau/);
  assert.match(befunde({ ...gueltig, bereich: "src/" }).join("\n"), /A1: ein testumbau braucht einen bereich, der nur Tests umfasst, nicht src\//);
  assert.match(befunde({ ...gueltig, erwarteteDateien: ["test/website-onboarding/hilfe.js", "test/website-onboarding/x.js", "src/x.js"] }).join("\n"), /ein testumbau ändert keinen Produktcode; erwartete Datei src\/x\.js ist keine Testdatei/);
  assert.match(befunde({ ...gueltig, prueft: ["S1"] }).join("\n"), /prueft muss bei einem Umbau genau/);
  assert.ok(prueflisteSoll({ auftraege: [gueltig] }, new Map(), []).includes("umbau:A1"));
});
