import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { KENNUNG, LAUF_FRIST_MS, ORDNER, exit, plane } from "./planung-probe.js";
import { REPO_ROOT } from "./probe-repo.js";

const AUFTRAG = join(REPO_ROOT, "tools/auftrag.mjs");
const EXIT_ABBRUCH = 1;

function planungsBericht({ wurzel }) {
  const datei = join(wurzel, ".fortschritt", KENNUNG, "planung.json");
  assert.equal(existsSync(datei), true, `${datei} fehlt`);
  return JSON.parse(readFileSync(datei, "utf8"));
}

test("plane: ein Dateisystemfehler im Lauf endet mit Exit 1 und einer planung.json, deren Grund den Fehlertext nennt", { timeout: LAUF_FRIST_MS }, (context) => {
  const ordnerStattDatei = (wurzel) => {
    const datei = join(wurzel, ".github", "CODEOWNERS");
    rmSync(datei, { force: true });
    mkdirSync(datei, { recursive: true });
    return ["plane", ORDNER];
  };
  const lauf = plane(context, { werkzeug: AUFTRAG, grund: {}, ueberschrieben: {}, argumente: ordnerStattDatei });
  exit(lauf, EXIT_ABBRUCH);
  const { exit: berichtExit, grund, befunde } = planungsBericht(lauf);
  assert.equal(berichtExit, EXIT_ABBRUCH);
  assert.deepEqual(befunde.offen, []);
  assert.match(grund, /^unerwarteter Fehler: Error: EISDIR/u);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "phase.json")), false);
});
