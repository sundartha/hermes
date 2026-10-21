import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MELDUNG, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { probeDirectory } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const MELDUNG_OHNE_SEMGREP = "semgrep läuft nicht; ohne ihn zählt kein Paar als nur Typen und lint bricht ab";
const DATEI = "src/text.js";
const DREHBUCH = { bau: { [DATEI]: "export const text = 1;\n" }, "bau-antwort": "Zweck semgrep-fehlt: Drehbuchtext des Ersatz-Agenten." };

function nurGit(context) {
  const ordner = probeDirectory(context, {});
  const git = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  symlinkSync(git, join(ordner, "git"));
  return ordner;
}

function scheitertVorDemErstenAuftrag({ lauf, beleg, werkzeug }) {
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.includes(MELDUNG_OHNE_SEMGREP), lauf.stderr);
  assert.ok(lauf.stderr.endsWith(`${zweckBlock(MELDUNG.SEMGREP_FEHLT).join("\n")}\n`), lauf.stderr);
  assert.equal(beleg, null);
  assert.ok(!existsSync(join(werkzeug, "prompt-bau.txt")));
}

test("lauf ohne semgrep im PATH endet rot vor dem ersten Auftrag und nennt Grund und Zweck", (context) => {
  scheitertVorDemErstenAuftrag(starte(context, { auftrag: UMBAU, drehbuch: DREHBUCH, umgebung: { PATH: nurGit(context) } }));
});

test("lauf endet rot vor dem ersten Auftrag, wenn semgrep --version scheitert", (context) => {
  const ordner = nurGit(context);
  writeFileSync(join(ordner, "semgrep"), "#!/bin/sh\nexit 1\n", { mode: AUSFUEHRBAR });
  scheitertVorDemErstenAuftrag(starte(context, { auftrag: UMBAU, drehbuch: DREHBUCH, umgebung: { PATH: ordner } }));
});

test("lauf mit semgrep im PATH startet den ersten Auftrag ohne den Befund", (context) => {
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch: DREHBUCH });
  assert.ok(!lauf.stderr.includes(MELDUNG_OHNE_SEMGREP), lauf.stderr);
  assert.notEqual(beleg, null, lauf.stdout + lauf.stderr);
});
