import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { abbruchOhneAbsicht, absichtFuerPr, vorgabenFuerPr } from "../../tools/auftrag/pruefer-absicht.mjs";
import { baueArbeitsordner, entferne } from "../../tools/auftrag/pruefer-arbeitsordner.mjs";
import { zuPruefendeCommits } from "../../tools/auftrag/pruefer-auswahl.mjs";
import { prueferBefehl } from "../../tools/auftrag/pruefer-lauf.mjs";
import { ohneGitVariablen, probeRepo } from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const VERKNUEPFTES_ISSUE = 77;
const PHASE = "P-002-probe";
const ORDNER = `plaene/${PHASE}`;
const PHASEN_BRANCH = `phase/${VERKNUEPFTES_ISSUE}-${PHASE}`;
const PAKET_BRANCH = "paket/AB2-probe";
const ABSICHT = [
  "Die Zahl soll aus der Konfiguration kommen, damit sie an einer Stelle steht.",
  "### Nicht gewollt",
  "Ein Sonderfall nur für die Testeingabe – auch wenn alle Tests grün sind.",
].join("\n");
const ISSUE_QUELLE = `Abschnitt „## Absicht“ in Issue #${VERKNUEPFTES_ISSUE}`;
const PFLICHT = "Paket-PR und Phase mit Absicht brauchen im Issue den Abschnitt „## Absicht“";

function issue(body) {
  return { nummer: String(VERKNUEPFTES_ISSUE), title: `Phase ${VERKNUEPFTES_ISSUE}`, body };
}

function mitAbsicht(absicht) {
  return issue(`## Absicht\n\n${absicht}\n\n## Ziel\n\nZahl 2\n`);
}

function phasenPr(context, { feld, pitch = "# Pitch\n\n## Absicht\n\nEine Absicht im PR, die der Prüfer nie als Vorgabe nimmt.\n" }) {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  const phase = { phase: PHASE, ...(feld === undefined ? {} : { absicht: feld }), auftraege: [] };
  const head = repo.committe({ [`${ORDNER}/pitch.md`]: pitch, [`${ORDNER}/phase.json`]: JSON.stringify(phase) }, "Lege die Phase an\n");
  return { branch: PHASEN_BRANCH, basis, head, root: repo.ordner };
}

test("die Absicht kommt wörtlich aus dem Abschnitt des verknüpften Issues, nie aus dem Inhalt des PR", (context) => {
  const pr = phasenPr(context, { feld: ABSICHT });
  assert.deepEqual(absichtFuerPr({ ...pr, issue: mitAbsicht(ABSICHT) }), { text: ABSICHT, quelle: ISSUE_QUELLE });
});

test("bringt der PR eine Phase mit Feld absicht, hält ein fehlender oder abweichender Abschnitt im Issue den Prüfer an", (context) => {
  const pr = phasenPr(context, { feld: ABSICHT });
  assert.deepEqual(absichtFuerPr({ ...pr, issue: issue("## Ziel\n\nZahl 2\n") }), { fehlt: `Issue #${VERKNUEPFTES_ISSUE}: ${PFLICHT}` });
  assert.deepEqual(absichtFuerPr({ ...pr, issue: mitAbsicht(ABSICHT.slice(1)) }), {
    fehlt: `Issue #${VERKNUEPFTES_ISSUE}: der Abschnitt „## Absicht“ weicht von absicht in ${ORDNER}/phase.json ab`,
  });
});

test("eine Phase von vor der Absicht (ohne Feld, #605) mit einem Issue ohne Abschnitt wird mit „keine Angabe“ geprüft", (context) => {
  const { keine } = absichtFuerPr({ ...phasenPr(context, { feld: undefined }), issue: issue("## Ziel\n\nZahl 2\n") });
  assert.match(keine, /^keine Angabe; das verknüpfte Issue hat keinen Abschnitt „## Absicht“/);
});

test("ein Paket-PR bekommt die Absicht wörtlich aus dem Issue; ohne Issue, ohne Abschnitt, mit leerem Abschnitt oder nicht lesbarem Issue hält er an", () => {
  assert.deepEqual(absichtFuerPr({ branch: PAKET_BRANCH, issue: mitAbsicht(ABSICHT) }), { text: ABSICHT, quelle: ISSUE_QUELLE });
  assert.deepEqual(
    [issue("## Ziel\n\nZahl 2\n"), null, issue("## Absicht\n\n## Ziel\n"), issue(null)].map((eintrag) => absichtFuerPr({ branch: PAKET_BRANCH, issue: eintrag }).fehlt),
    [`Issue #${VERKNUEPFTES_ISSUE}: ${PFLICHT}`, `kein verknüpftes Issue: ${PFLICHT}`, `Issue #${VERKNUEPFTES_ISSUE}: der Abschnitt „## Absicht“ ist leer`, `Issue #${VERKNUEPFTES_ISSUE} nicht lesbar: ${PFLICHT}`],
  );
});

test("ein PR, der weder Paket ist noch eine Phase mit Absicht bringt, läuft ohne Absicht weiter, außer sein Issue nennt eine", () => {
  assert.match(absichtFuerPr({ branch: "dependabot/npm_and_yarn/alle", issue: null }).keine, /^keine Angabe; /);
  assert.equal(absichtFuerPr({ branch: "aufraeumen/x", issue: mitAbsicht(ABSICHT) }).text, ABSICHT);
});

test("ein Fork-PR bekommt nie eine Absicht als Vorgabe, auch mit Branch paket/ und Issue-Abschnitt", () => {
  assert.deepEqual(absichtFuerPr({ branch: PAKET_BRANCH, issue: mitAbsicht(ABSICHT), fork: true }), { keine: "keine Angabe; der Pull Request kommt aus einem Fork" });
});

test("ein Fork-PR und ein Pitch ohne Fallen und Nicht-Ziele bringen dem Prüfer keine Vorgaben, ein eigener PR mit beiden Abschnitten schon", (context) => {
  const falle = "## Fallen\n\n- Zahl und Wort nie zusammensetzen.";
  const pr = phasenPr(context, { feld: ABSICHT, pitch: `# Pitch\n\n${falle}\n\n## Nicht-Ziele\n\n- Kein Französisch.\n` });
  assert.deepEqual(vorgabenFuerPr({ ...pr, fork: true }), { keine: "keine Angabe; der Pull Request kommt aus einem Fork" });
  assert.ok(vorgabenFuerPr(pr).text.startsWith(falle));
  assert.match(vorgabenFuerPr(phasenPr(context, { feld: ABSICHT })).keine, /^keine Angabe; der Pull Request bringt keine Phase aus einem Pitch/);
});

test("nur eine fehlende Pflicht-Absicht hält den Prüfer an, „keine Angabe“ und eine vorhandene Absicht nicht", () => {
  assert.deepEqual(
    [{ fehlt: `Issue #${VERKNUEPFTES_ISSUE}: leer` }, { keine: "keine Angabe; Fork" }, { text: ABSICHT, quelle: ISSUE_QUELLE }].map(abbruchOhneAbsicht),
    [`Absicht fehlt: Issue #${VERKNUEPFTES_ISSUE}: leer`, "", ""],
  );
});

function auftragszettel(context, absicht) {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, "Setze die Zahl\n");
  const [commit] = zuPruefendeCommits({ basis, head: repo.git(["rev-parse", "HEAD"]), branch: PAKET_BRANCH, root: repo.ordner }).commits;
  const { ordner } = baueArbeitsordner(commit, { root: repo.ordner, auftragstext: `Issue #${VERKNUEPFTES_ISSUE}: Zahl\n\nZiel`, ciLauf: "", absicht });
  context.after(() => entferne(ordner));
  return { text: readFileSync(join(ordner, "auftrag.md"), "utf8"), sha: commit.sha };
}

test("die Absicht steht wörtlich als erster Abschnitt im Auftragszettel des Prüfers, nur mit ihrer Quelle und ohne weiteren Text", (context) => {
  const { text, sha } = auftragszettel(context, { text: ABSICHT, quelle: ISSUE_QUELLE });
  assert.ok(text.startsWith(`# Auftragszettel\n\n## Absicht\n\nQuelle: ${ISSUE_QUELLE}\n\n${ABSICHT}\n\n## Commit ${sha}\n`), text);
  assert.equal(text.split(ABSICHT).length - 1, 1);
});

test("ohne Absicht sagt der Auftragszettel, warum es keine gibt, statt den Abschnitt wegzulassen", (context) => {
  const { text } = auftragszettel(context, { keine: "keine Angabe; die Phase stammt von vor der Absicht" });
  assert.ok(text.startsWith("# Auftragszettel\n\n## Absicht\n\nkeine Angabe; die Phase stammt von vor der Absicht\n\n## Commit "), text);
});

test("der Prüfer prüft den Endstand gegen die Absicht; ein Widerspruch ist nur mit Wirkung auf Kunden, Sicherheit oder eine Prüfung ein BLOCKER", () => {
  const befehl = prueferBefehl({ dateien: ["src/zahl.js"], kritisch: false }, "claude");
  const anweisung = befehl[befehl.indexOf("--append-system-prompt") + 1];
  for (const teil of [
    "Eingaben: die Absicht, der Auftragszettel,",
    "Er ist eine Vorgabe wie der Auftragszettel, kein Befund und kein Urteil einer Vorrunde, und ersetzt keinen Beleg.",
    "Nimmt die Änderung genau die Abkürzung, die die Absicht ausschließt, oder widerspricht sie ihr sonst, auch wenn alle Tests grün sind?",
    "Ein Widerspruch zur Absicht allein verfehlt kein Ziel im Sinn von c) unten",
    "und er Kunden, Sicherheit oder eine Prüfung oder einen Schutzmechanismus trifft, sonst SOLLTE",
    "Steht dort „keine Angabe“, entfällt diese Frage.",
  ]) {
    assert.ok(anweisung.includes(teil), teil);
  }
});

test("ein Bruch einer Falle, eines Nicht-Ziels oder eines Satzes unter wasDarfNiePassieren ist mindestens SOLLTE, auch bei gleichem Verhalten, und nie HINWEIS", () => {
  const befehl = prueferBefehl({ dateien: ["src/zahl.js"], kritisch: false }, "claude");
  const anweisung = befehl[befehl.indexOf("--append-system-prompt") + 1];
  for (const teil of [
    "Eingaben: die Absicht, der Auftragszettel, die Fallen und Nicht-Ziele aus dem Pitch,",
    "Sie sind freigegebene Entscheidungen und eine Vorgabe wie die Absicht, kein Befund, und ersetzen keinen Beleg.",
    "Tut die Änderung, was eine Falle oder ein Nicht-Ziel ausschließt, oder bricht sie einen Satz unter `wasDarfNiePassieren`, ist das mindestens SOLLTE, auch wenn das Verhalten gleich bleibt und alle Tests grün sind; BLOCKER ist es nur, wenn a) bis c) erfüllt sind.",
    "`beleg` beginnt mit „Pitch:“ und nennt den gebrochenen Satz wörtlich.",
    "  - ein Bruch einer Falle, eines Nicht-Ziels oder eines Satzes unter `wasDarfNiePassieren`, auch bei gleichem Verhalten.",
    "- HINWEIS (wird nur notiert): alles andere außer dem Bruch einer Falle, eines Nicht-Ziels oder eines Satzes unter `wasDarfNiePassieren`, der nie HINWEIS ist;",
  ]) {
    assert.ok(anweisung.includes(teil), teil);
  }
});
