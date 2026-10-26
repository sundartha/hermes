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
const GH_ZEILE = "To get started with GitHub CLI, please run: gh auth login";
const NICHT_ANGEMELDET = `process.stderr.write(${JSON.stringify(`${GH_ZEILE}\nAlternatively, populate the GH_TOKEN environment variable.\n`)});\nprocess.exit(4);`;
const OHNE_ABSICHT = `console.log(${JSON.stringify("## Ziel\n\nZahl\n")});`;
const EINRICHTUNG = "Einrichtungsschritt: gh auth login (README.md, „Einrichtung für den Arbeitsweg“)";
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

test("lauf nennt bei nicht angemeldetem gh die erste gh-Zeile, den Exit und den Einrichtungsschritt gh auth login", (context) => {
  const ergebnis = mitIssue(context, "lauf", NICHT_ANGEMELDET);
  haeltVorDemAgenten(ergebnis, `Issue #${ISSUE} nicht lesbar; ohne seinen Abschnitt „## Absicht“ startet die Phase nicht`);
  assert.ok(ergebnis.lauf.stderr.includes(`endete mit Exit 4: ${GH_ZEILE}`), ergebnis.lauf.stderr);
  assert.ok(ergebnis.lauf.stderr.includes(EINRICHTUNG), ergebnis.lauf.stderr);
  assert.doesNotMatch(ergebnis.lauf.stderr, /Alternatively/);
});

test("lauf meldet bei einem lesbaren Issue ohne Abschnitt „Absicht“ nur die Abweichung, ohne Einrichtungsschritt", (context) => {
  const ergebnis = mitIssue(context, "lauf", OHNE_ABSICHT);
  haeltVorDemAgenten(ergebnis, WEICHT_AB);
  assert.ok(!ergebnis.lauf.stderr.includes(EINRICHTUNG), ergebnis.lauf.stderr);
  assert.doesNotMatch(ergebnis.lauf.stderr, /nicht lesbar/);
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
