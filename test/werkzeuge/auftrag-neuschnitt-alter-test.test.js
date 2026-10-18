import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { listHint } from "../../tools/testschutz/freigabe.mjs";

import { ABNAHME, AUSFUEHRBAR, ersterVersuch, funktion, ISSUE, phase, PHASENDATEI, RECHNEN_BESTAND, TEXT_BESTAND, TEXT_TEST, umbau } from "./neuschnitt-probe.js";
import { probeDirectory } from "./probe-repo.js";

const LABEL_ZEIT = "2026-10-01T10:00:00Z";
const NEUER_TEST = "test/rechnen/neu.test.js";

const GH = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
appendFileSync(process.env.ERSATZ_GH, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "api") process.stdout.write(readFileSync(process.env.ERSATZ_ISSUE, "utf8"));
`;

function freigabeIssue(liste) {
  const body = ["## Absicht", "", "Verdoppeln.", "", "## Tests, deren Erwartung sich ändern darf", "", ...liste.map((pfad) => `- \`${pfad}\``)].join("\n");
  const label = { __typename: "LabeledEvent", createdAt: LABEL_ZEIT, actor: { login: "Antonio20045" }, label: { name: "verhalten-geaendert" } };
  return { data: { repository: { issue: { number: ISSUE, body, lastEditedAt: null, timelineItems: { nodes: [label] } } } } };
}

function mitIssue(context, issue) {
  const ort = probeDirectory(context, { "gh.mjs": GH, "issue.json": JSON.stringify(issue) });
  chmodSync(join(ort, "gh.mjs"), AUSFUEHRBAR);
  return { HERMES_GH: join(ort, "gh.mjs"), ERSATZ_ISSUE: join(ort, "issue.json") };
}

function schnittMit(context, auftraege, { umgebung, dateien } = {}) {
  return ersterVersuch(context, { kind: [{ [PHASENDATEI]: phase(auftraege) }] }, { umgebung, dateien });
}

function ohneFreigabe(datei, problem) {
  return `a1-n1: ${datei} ist ein bestehender Test, den a1 nicht nannte, und der Test-Agent dürfte ihn ändern. Ein Neuschnitt nimmt ihn nur mit Freigabe auf: Listenpunkt \`${datei}\` ${listHint()}, hier Issue #${ISSUE}. Ohne lesbare Freigabe lehnt er ab: ${problem}.`;
}

function issueAbrufe(datei) {
  return datei("gh.log").split("\n").filter((zeile) => zeile.startsWith('["api"'));
}

const MIT_BESTAND = funktion("a1-n1", { erwarteteDateien: ["src/rechnen.js", ABNAHME, RECHNEN_BESTAND] });

test("ein Neuschnitt, dessen Auftrag mit Test-Agent einen bestehenden Test neu aufnimmt, wird abgelehnt, wenn gh kein lesbares Issue liefert", (context) => {
  const { versuche } = schnittMit(context, [MIT_BESTAND]);
  assert.deepEqual(versuche.map(({ befunde }) => befunde), [[ohneFreigabe(RECHNEN_BESTAND, "gh lieferte kein lesbares Issue")], [ohneFreigabe(RECHNEN_BESTAND, "gh lieferte kein lesbares Issue")]]);
});

test("ein Neuschnitt, der einen bestehenden Test neu aufnimmt, den das Phasen-Issue nicht freigibt, wird abgelehnt", (context) => {
  const { befunde, datei } = schnittMit(context, [MIT_BESTAND], { umgebung: mitIssue(context, freigabeIssue([TEXT_BESTAND])) });
  assert.deepEqual(befunde, [ohneFreigabe(RECHNEN_BESTAND, `${RECHNEN_BESTAND} steht nicht als eigener Listenpunkt ${listHint()}`)]);
  assert.match(issueAbrufe(datei)[0], new RegExp(`"number=${ISSUE}"`));
});

test("ein Neuschnitt, der einen bestehenden Test neu aufnimmt, den das Phasen-Issue freigibt, wird angenommen", (context) => {
  const { versuche, datei } = schnittMit(context, [MIT_BESTAND], { umgebung: mitIssue(context, freigabeIssue([RECHNEN_BESTAND])) });
  assert.deepEqual([versuche[0].befunde, versuche[0].neu.map(({ id }) => id)], [undefined, ["a1-n1"]]);
  assert.equal(issueAbrufe(datei).length, 1);
});

test("Tests, die der alte Auftrag schon nannte, der Abnahmetest, neue Tests und Tests eines Auftrags ohne Test-Agent brauchen keine Freigabe und kein Issue", (context) => {
  const alt = funktion("a1", { erwarteteDateien: ["src/rechnen.js", ABNAHME, RECHNEN_BESTAND] });
  const neu = funktion("a1-n1", { abnahme: TEXT_BESTAND, erwarteteDateien: ["src/rechnen.js", TEXT_BESTAND, RECHNEN_BESTAND, NEUER_TEST] });
  const ohneTestAgent = umbau("a1-n2", { erwarteteDateien: ["src/text.js", TEXT_TEST] });
  const { versuche, datei } = schnittMit(context, [neu, ohneTestAgent], { dateien: { [PHASENDATEI]: phase([alt]) } });
  assert.deepEqual([versuche[0].befunde, versuche[0].neu.map(({ id }) => id)], [undefined, ["a1-n1", "a1-n2"]]);
  assert.deepEqual(issueAbrufe(datei), []);
});
