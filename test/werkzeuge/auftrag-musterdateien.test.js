import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bauPrompt, testumbauPrompt } from "../../tools/auftrag/agenten.mjs";
import { UMBAU_AUSWEG, geschuetzteMuster, istGeschuetzt, phasenBefunde } from "../../tools/auftrag/format.mjs";
import { starte } from "./auftrag-lauf-probe.js";
import { ESLINT_BIN, REPO_ROOT, probeDirectory } from "./probe-repo.js";

const MUSTER = JSON.parse(readFileSync(join(REPO_ROOT, "tools/auftrag/musterdateien.json"), "utf8"));
const ALLE_MUSTER = [...MUSTER.bau, ...MUSTER.test];
const REGEL = "Bei Widerspruch zwischen der geänderten Datei und dem Muster gilt das Muster.";
const ALTER_UMBAU = { id: "a1", art: "umbau", ziel: "Räume d auf", bereich: "src/d.js", erwarteteDateien: ["src/d.js"], vorbild: "src/fehlt.js", abnahme: "test/ok.test.js", prueft: UMBAU_AUSWEG };
const LEERE_UNTERDRUECKUNGEN = "eslint-suppressions.empty.json";

function muster(art) {
  return ALLE_MUSTER.find((eintrag) => eintrag.art === art);
}

function inhalt(art) {
  return `export const MUSTER = "${art}";`;
}

function bauPromptFuer(context, bereich) {
  const root = probeDirectory(context, Object.fromEntries(ALLE_MUSTER.map(({ art, datei }) => [datei, `${inhalt(art)}\n`])));
  const auftrag = { id: "A1", art: "umbau", ziel: "Baue", bereich, erwarteteDateien: [bereich], vorbild: "src/store/pg.js", abnahme: "test/a.test.js" };
  return bauPrompt({ phase: { entwurf: { [bereich]: "Entwurf." } }, auftrag, root }, "Ausgabe.");
}

function gezeigteMuster(text) {
  return ALLE_MUSTER.filter(({ datei }) => text.includes(`: ${datei}\n`)).map(({ art }) => art);
}

test("jede Musterdatei gibt es und sie liegt unter dem Präfix ihrer Art", () => {
  const falsch = ALLE_MUSTER.filter(({ praefix, datei }) => !existsSync(join(REPO_ROOT, datei)) || !datei.startsWith(praefix));
  assert.deepEqual(falsch, []);
});

test("alle Musterdateien bestehen ESLint ohne geduldete Befunde und ohne Warnung", () => {
  const dateien = ALLE_MUSTER.map(({ datei }) => datei);
  const lauf = spawnSync(process.execPath, [ESLINT_BIN, "--suppressions-location", LEERE_UNTERDRUECKUNGEN, "--max-warnings", "0", ...dateien], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
});

test("kein Bereich mit Muster ist geschützt, Agenten im Auftragsweg arbeiten dort", () => {
  const geschuetzt = geschuetzteMuster(REPO_ROOT);
  assert.deepEqual(ALLE_MUSTER.filter(({ praefix }) => istGeschuetzt(geschuetzt, praefix)), []);
});

test("der Bau-Agent bekommt genau das Muster mit dem längsten passenden Präfix samt Regel, auch wenn der Auftrag noch ein Vorbild nennt", (context) => {
  const gezeigt = ["src/routes/neu.js", "src/telephony/", "src/store/", "scripts/neu.mjs"].map((bereich) => gezeigteMuster(bauPromptFuer(context, bereich)));
  assert.deepEqual(gezeigt, [["Route"], ["Telefonie"], ["Modul"], ["Skript"]]);
  const route = bauPromptFuer(context, "src/routes/neu.js");
  assert.ok(route.includes(inhalt("Route")), route);
  assert.ok(route.includes(`\n${REGEL}\n`), route);
  assert.doesNotMatch(route, /^## Vorbild/m);
  assert.ok(!route.includes("src/store/pg.js"), route);
});

test("ein Bereich ohne Muster bekommt keinen Dateiinhalt, sondern den Satz, dass es keins gibt", (context) => {
  const ohne = bauPromptFuer(context, "apps/web/neu.js");
  assert.deepEqual(gezeigteMuster(ohne), []);
  assert.ok(ohne.includes("## Muster\n\nFür apps/web/neu.js gibt es kein Muster.\n"), ohne);
});

test("der Test-Agent bekommt im Lauf das Testmuster seiner Abnahme samt Regel, auch aus einer alten Phase mit Vorbild", (context) => {
  const auftrag = {
    id: "A1",
    art: "funktion",
    ziel: "Prüfe Signaturen",
    bereich: "src/rechnen.js",
    erwarteteDateien: ["src/rechnen.js", "test/sicherheit/rechnen.test.js"],
    vorbild: "src/text.js",
    abnahme: "test/sicherheit/rechnen.test.js",
    erwarteterFehler: "2 !== 4",
    wasDarfNiePassieren: [],
  };
  const { datei } = muster("Sicherheitstest");
  const { werkzeug } = starte(context, { auftrag, drehbuch: {}, dateien: { [datei]: "export const SICHERHEITSMUSTER = 1;\n" } });
  const testPrompt = readFileSync(join(werkzeug, "prompt-test.txt"), "utf8");
  assert.ok(testPrompt.includes(`## Muster (Sicherheitstest): ${datei}\n`), testPrompt);
  assert.ok(testPrompt.includes("export const SICHERHEITSMUSTER = 1;"), testPrompt);
  assert.ok(testPrompt.includes(`\n${REGEL}\n`), testPrompt);
});

test("der Testumbau-Agent bekommt wie der Test-Agent das Testmuster seiner Abnahme samt Regel", (context) => {
  const { datei: musterDatei } = muster("Sicherheitstest");
  const abnahme = "test/sicherheit/rechnen.test.js";
  const root = probeDirectory(context, { [musterDatei]: "export const UMBAUMUSTER = 1;\n", [abnahme]: 'test("alt", () => {});\n' });
  const umbau = { id: "A1", art: "testumbau", ziel: "Baue Tests um", bereich: abnahme, erwarteteDateien: [abnahme], abnahme };
  const text = testumbauPrompt({ entwurf: { [abnahme]: "Entwurf." } }, umbau, root);
  assert.ok(text.includes(`## Muster (Sicherheitstest): ${musterDatei}\n`), text);
  assert.ok(text.includes("export const UMBAUMUSTER = 1;"), text);
  assert.ok(text.includes(`\n${REGEL}\n`), text);
});

test("eine alte Phasendatei, deren Auftrag noch ein Vorbild auf eine fehlende Datei nennt, bleibt ohne Befund", (context) => {
  const root = probeDirectory(context, { "src/d.js": "export const WERT = 1;\n", "test/ok.test.js": 'import { test } from "node:test";\ntest("ok", () => {});\n' });
  const phase = { phase: "alt", entwurf: { "src/d.js": "Entwurf." }, auftraege: [ALTER_UMBAU] };
  assert.deepEqual(phasenBefunde(phase, root), []);
});
