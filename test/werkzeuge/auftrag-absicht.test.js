import assert from "node:assert/strict";
import { test } from "node:test";

import { bauPrompt, testAgentPrompt, testPrompt, testumbauPrompt } from "../../tools/auftrag/agenten.mjs";
import { phasenBefunde } from "../../tools/auftrag/format.mjs";
import { absichtAusPitch } from "../../tools/auftrag/planung/absicht.mjs";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

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

const ABSICHT = [
  "Ein Kunde soll seine eigenen Anrufe ohne den Hinweis für Fremde bekommen, aber nur, wenn feststeht, dass die Nummer wirklich ihm gehört.",
  "Nicht gewollt ist eine Abkürzung, die den Hinweis schon bei einer bloß eingetragenen Nummer weglässt.",
  "Im Zweifel bleibt der Hinweis an.",
].join("\n");
const PITCH = ["# P-001 Probe", "", "Status: Entwurf", "", "## Absicht", ABSICHT, "", "### Kein Abschnittsende", "", "## Problem", "Heute: x", ""].join("\n");
const ABNAHME = "test/abnahme.test.js";
const GEPLANT = "test/geplant.test.js";

function prompts(context, phase) {
  const root = probeDirectory(context, { [BEREICH]: "export const x = 1;\n", [GEPLANT]: 'test("alt", () => {});\n' });
  const auftrag = { id: "a1", art: "funktion", ziel: "Baue", bereich: BEREICH, erwarteteDateien: [BEREICH], abnahme: ABNAHME, erwarteterFehler: "fehlt" };
  const umbau = { ...auftrag, art: "testumbau", erwarteteDateien: [GEPLANT], abnahme: GEPLANT };
  return {
    test: testAgentPrompt({ phase, auftrag, root }),
    bau: bauPrompt({ phase, auftrag, root }, "Ausgabe."),
    testumbau: testumbauPrompt(phase, umbau, root),
    planUndNotiz: testPrompt(phase, auftrag, root),
  };
}

test("Absicht: die Absicht aus dem Pitch steht wörtlich als erster eigener Abschnitt im Prompt von Test-, Bau- und Testumbau-Agent", (context) => {
  const absicht = absichtAusPitch(PITCH);
  assert.equal(absicht, `${ABSICHT}\n\n### Kein Abschnittsende`);
  for (const [rolle, text] of Object.entries(prompts(context, { absicht, entwurf: { [BEREICH]: "Entwurf." } }))) {
    assert.ok(text.startsWith(`## Absicht\n\n${absicht}\n\n## Auftrag\n`), `${rolle}: ${text.slice(0, 200)}`);
    assert.equal(text.split("\n").filter((zeile) => zeile === "## Absicht").length, 1, rolle);
  }
});

test("Absicht: eine Phase ohne Absicht ändert keinen Prompt, mit Absicht wächst er nur um den Abschnitt", (context) => {
  const absicht = absichtAusPitch(PITCH);
  const ohne = prompts(context, { entwurf: { [BEREICH]: "Entwurf." } });
  const mit = prompts(context, { absicht, entwurf: { [BEREICH]: "Entwurf." } });
  for (const rolle of Object.keys(ohne)) {
    assert.ok(!ohne[rolle].includes("## Absicht"), rolle);
    assert.equal(mit[rolle], `## Absicht\n\n${absicht}\n\n${ohne[rolle]}`, rolle);
  }
});
