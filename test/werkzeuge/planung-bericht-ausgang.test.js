import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { LAUF_FRIST_MS, ORDNER, exit, phaseFuer, plane } from "./planung-probe.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const START = join(REPO_ROOT, "tools/auftrag/planung/neuschnitt-start.mjs");
const PHASENDATEI = `${ORDNER}/phase.json`;
const EXIT_ABBRUCH = 1;
const EISDIR = /^unerwarteter Fehler: Error: EISDIR/u;
const ANLASS = "Der Abnahmetest von a2 wurde nach dem Bau nicht grün.";
const VERLAUF = "test: a2 rot wie erwartet";

function lies(datei) {
  assert.equal(existsSync(datei), true, `${datei} fehlt`);
  return JSON.parse(readFileSync(datei, "utf8"));
}

function neuschnitt(context) {
  const ablage = probeDirectory(context, {});
  const vorbereitung = (wurzel) => {
    const claude = join(wurzel, "CLAUDE.md");
    rmSync(claude, { force: true });
    mkdirSync(claude, { recursive: true });
    writeFileSync(join(wurzel, PHASENDATEI), `${JSON.stringify(phaseFuer(wurzel), null, 2)}\n`);
    const eingabe = { root: wurzel, ordner: ORDNER, datei: PHASENDATEI, auftragId: "a2", fertig: ["a1"], anlass: ANLASS, kopf: `\n## Neuschnitt\n\n${ANLASS}\n\n## Verlauf\n\n${VERLAUF}`, verlauf: [VERLAUF], hinweise: [] };
    writeFileSync(join(ablage, "eingabe.json"), JSON.stringify(eingabe));
    return [ablage];
  };
  return { ...plane(context, { werkzeug: START, grund: {}, ueberschrieben: {}, argumente: vorbereitung }), ablage };
}

test("Neuschnitt: ein unerwarteter Fehler im Lauf endet mit Exit 1, planung.json und ergebnis.json nennen den Fehlertext", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = neuschnitt(context);
  exit(lauf, EXIT_ABBRUCH);
  const planung = lies(join(lauf.ablage, "planung.json"));
  assert.equal(planung.exit, EXIT_ABBRUCH);
  assert.match(planung.grund, EISDIR);
  assert.deepEqual(planung.befunde.offen, []);
  const ergebnis = lies(join(lauf.ablage, "ergebnis.json"));
  assert.equal(ergebnis.exitCode, EXIT_ABBRUCH);
  assert.match(ergebnis.grund, EISDIR);
  assert.deepEqual(ergebnis.planung, planung);
});
