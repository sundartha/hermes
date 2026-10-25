import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { funktion } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, ghSkript, issueMitAbsicht, starte } from "./auftrag-lauf-probe.js";
import { probeDirectory } from "./probe-repo.js";
import { ghErsatz } from "./warteschlange/hilfen.mjs";

const ISSUE = 7;
const ABSICHT = "Die Zahl soll verdoppelt werden, ohne Sonderfall für die Testeingabe.";
const ABWEICHENDES_ISSUE = issueMitAbsicht(ABSICHT.slice(0, -1));
const NICHT_LESBAR = "process.exit(1);";
const WEICHT_AB = `Issue #${ISSUE}: der Abschnitt „## Absicht“ fehlt oder weicht von absicht in phase.json ab`;
const PASST_NICHT = "Auftrag passt nicht: Die Stelle gibt es so nicht.";

function mitIssue(context, befehl, skript) {
  const phase = { issue: ISSUE, absicht: ABSICHT };
  return starte(context, { auftrag: funktion("2 !== 4"), drehbuch: {}, phase, umgebung: ghSkript(probeDirectory(context, {}), skript), befehl });
}

function agentGestartet(werkzeug) {
  return existsSync(join(werkzeug, "starts.jsonl"));
}

function haeltVorDemAgenten({ lauf, werkzeug }, meldung) {
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.includes(meldung), lauf.stderr);
  assert.equal(agentGestartet(werkzeug), false);
}

test("lauf mit Feld absicht startet nicht, wenn das Issue den Abschnitt „Absicht“ nicht wörtlich hat", (context) => {
  haeltVorDemAgenten(mitIssue(context, "lauf", ABWEICHENDES_ISSUE), WEICHT_AB);
});

test("lauf mit Feld absicht startet nicht, wenn das Issue nicht lesbar ist", (context) => {
  haeltVorDemAgenten(mitIssue(context, "lauf", NICHT_LESBAR), `Issue #${ISSUE} nicht lesbar; ohne seinen Abschnitt „## Absicht“ startet die Phase nicht`);
});

test("teillauf mit Feld absicht startet nicht, wenn das Issue den Abschnitt „Absicht“ nicht wörtlich hat", (context) => {
  haeltVorDemAgenten(mitIssue(context, "teillauf", ABWEICHENDES_ISSUE), WEICHT_AB);
});

test("lauf einer vertraulichen Phase fragt kein Issue ab", (context) => {
  const gh = ghErsatz(context);
  const phase = { phase: "F-999-probe", vertraulich: true, issue: undefined, absicht: ABSICHT };
  const { werkzeug } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { "test-antwort": PASST_NICHT }, phase, umgebung: gh.umgebung });
  assert.equal(agentGestartet(werkzeug), true);
  assert.deepEqual(gh.aufrufe(), []);
});
