import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { lokaleUmgebung } from "./schwerlauf-lauf.js";
import { REPO_ROOT, RUNNER } from "./probe-repo.js";

const SPERRE = pathToFileURL(join(REPO_ROOT, "tools/schwerlauf/sperre.mjs")).href;
const EXIT_GESPERRT = 3;
const ABLEHNUNG = /^Probelauf läuft nur auf GitHub Actions \(Pflicht-Checks des PR bzw\. workflow_dispatch\)\. Lokal: npm run test:betroffen oder node --test <datei>\.$/m;
const SKRIPT = `import { nimmSperreAuchFuerKindprozesse } from ${JSON.stringify(SPERRE)};\nnimmSperreAuchFuerKindprozesse("Probelauf");\nconsole.log("erlaubt");`;

function nimmSperre(zusatz) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", SKRIPT], { env: { ...lokaleUmgebung(), ...zusatz }, encoding: "utf8" });
}

test("ohne GITHUB_ACTIONS und ohne Terminal lehnt die Sperre ab: Exit 3 und eine Meldung, ohne den Lauf zu starten", () => {
  const lauf = nimmSperre({});
  assert.equal(lauf.status, EXIT_GESPERRT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABLEHNUNG);
  assert.match(lauf.stderr, /^Die Sperre beruht auf Absprache: GITHUB_ACTIONS=true kann jeder Prozess setzen, es ist keine Sicherung/m);
  assert.equal(lauf.stdout, "");
});

test("mit GITHUB_ACTIONS=true erlaubt die Sperre den Lauf sofort", () => {
  const lauf = nimmSperre({ GITHUB_ACTIONS: "true" });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(lauf.stdout, "erlaubt\n");
});

test("HERMES_LOKAL_SCHWER=ja allein genügt nicht: ohne Terminal bleibt die Sperre zu", () => {
  for (const zusatz of [{ HERMES_LOKAL_SCHWER: "ja" }, { HERMES_LOKAL_SCHWER: "1", GITHUB_ACTIONS: "false" }]) {
    const lauf = nimmSperre(zusatz);
    assert.equal(lauf.status, EXIT_GESPERRT, lauf.stdout + lauf.stderr);
    assert.match(lauf.stderr, ABLEHNUNG);
  }
});

test("npm test ohne Dateiliste, mit einem Muster, einem Ordner oder mehr als 20 Dateien wird lokal abgelehnt", () => {
  const viele = Array.from({ length: 21 }, (_leer, nummer) => `test/probe-${nummer}.test.js`);
  for (const dateien of [[], ["test/**/*.test.js"], ["test/werkzeuge"], viele]) {
    const lauf = spawnSync(process.execPath, [RUNNER, "regression", ...dateien], { env: lokaleUmgebung(), encoding: "utf8" });
    assert.equal(lauf.status, EXIT_GESPERRT, lauf.stdout + lauf.stderr);
    assert.match(lauf.stderr, /^npm test \(regression, Muster, Ordner oder mehr als 20 Dateien\) läuft nur auf GitHub Actions/m);
  }
});
