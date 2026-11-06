import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { KOPIEN_LISTE, namen, pruefung, rotAn } from "./auftrag-lauf-hilfen.js";
import { BASIS, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT, probeRepository, runIn } from "./probe-repo.js";

const KNIP = "knip";
const ANWEISUNGEN = "anweisungen";
const BASISVERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const ANLEGEN = "--basis-anlegen";
const EXIT_GRUEN = 0;
const MIT_KNIP = {
  "package.json": JSON.stringify({
    type: "module",
    scripts: JSON.parse(BASIS["package.json"]).scripts,
    knip: { entry: ["test/*.test.js"], project: ["src/*.js"] },
  }),
};
const GENUTZT = "export function gross(text) {\n  return text.toLocaleUpperCase();\n}\n";
const MIT_TOTEM_CODE = `${GENUTZT}\nexport const ungenutzt = 3;\n`;
const REGEL = "# Regeln\n\nSchreibe Tests zuerst.\n";
const ANWEISUNGSAUFTRAG = { ...UMBAU, erwarteteDateien: ["src/text.js", "src/CLAUDE.md"] };

function basislisten(context) {
  const repo = probeRepository(context, { ...BASIS, ...MIT_KNIP });
  const liste = (werkzeug) => {
    const lauf = runIn(repo, process.execPath, [BASISVERGLEICH, werkzeug, ANLEGEN]);
    assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
    return [`tools/basis/${werkzeug}.json`, readFileSync(join(repo, `tools/basis/${werkzeug}.json`), "utf8")];
  };
  return Object.fromEntries([KNIP, ANWEISUNGEN].map(liste));
}

function lauf(context, { auftrag = UMBAU, bau, mitListen = true }) {
  const dateien = { ...KOPIEN_LISTE, ...MIT_KNIP, ...(mitListen ? basislisten(context) : {}) };
  return starte(context, { auftrag, drehbuch: { bau, "bau-antwort": `Zweck basis/knip: Drehbuchtext.\nZweck basis/anweisungen: Drehbuchtext.` }, dateien });
}

function zweiteRunde({ werkzeug }, teile) {
  const prompt = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  for (const teil of teile) assert.ok(prompt.includes(teil), `${teil}\n${prompt}`);
}

test("knip und anweisungen laufen im Bau nach der Pin-Prüfung und sind grün, wenn der Bau nichts Neues hinterlässt", (context) => {
  const { lauf: ende, beleg } = lauf(context, { bau: { "src/text.js": GENUTZT } });
  assert.equal(ende.status, 0, ende.stdout + ende.stderr);
  const liste = namen(beleg);
  assert.ok(liste.indexOf(KNIP) !== -1 && liste.indexOf(ANWEISUNGEN) === liste.indexOf(KNIP) + 1, liste.join(", "));
  assert.ok(liste.indexOf(KNIP) < liste.indexOf("abnahme"), liste.join(", "));
  assert.equal(pruefung(beleg, KNIP), 0, JSON.stringify(beleg.pruefungen));
  assert.equal(pruefung(beleg, ANWEISUNGEN), 0, JSON.stringify(beleg.pruefungen));
});

test("ein neuer ungenutzter Export macht die Runde an knip rot, und die zweite Runde bekommt Befund, Zweck-Text und Zuständigkeit", (context) => {
  const ergebnis = lauf(context, { bau: { "src/text.js": MIT_TOTEM_CODE } });
  rotAn(KNIP, ergebnis.lauf, ergebnis.beleg);
  zweiteRunde(ergebnis, ["exports ungenutzt", zweckBlock("basis/knip")[0], `dem Bau-Agenten: basis/${KNIP}`]);
});

test("eine neue Anweisungszeile macht die Runde an anweisungen rot, und die zweite Runde bekommt Befund, Zweck-Text und Zuständigkeit", (context) => {
  const ergebnis = lauf(context, { auftrag: ANWEISUNGSAUFTRAG, bau: { "src/text.js": GENUTZT, "src/CLAUDE.md": REGEL } });
  rotAn(ANWEISUNGEN, ergebnis.lauf, ergebnis.beleg);
  zweiteRunde(ergebnis, ["src/CLAUDE.md:3", zweckBlock("basis/anweisungen")[0], `dem Bau-Agenten: basis/${ANWEISUNGEN}`]);
});

test("fehlen die Basislisten schon auf der Basis, entfallen knip und anweisungen mit je einem Hinweis", (context) => {
  const { lauf: ende, beleg } = lauf(context, { bau: { "src/text.js": MIT_TOTEM_CODE }, mitListen: false });
  assert.equal(ende.status, 0, ende.stdout + ende.stderr);
  assert.ok(!namen(beleg).includes(KNIP) && !namen(beleg).includes(ANWEISUNGEN), namen(beleg).join(", "));
  for (const liste of [`tools/basis/${KNIP}.json`, `tools/basis/${ANWEISUNGEN}.json`]) {
    assert.equal(beleg.hinweise.filter((hinweis) => hinweis.includes(liste)).length, 1, JSON.stringify(beleg.hinweise));
  }
});
