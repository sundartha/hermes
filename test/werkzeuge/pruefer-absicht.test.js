import assert from "node:assert/strict";
import { test } from "node:test";

import { abbruchOhneAbsicht, absichtFuerPr } from "../../tools/auftrag/pruefer-absicht.mjs";
import { ohneGitVariablen, probeRepo } from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const PHASE = "P-002-probe";
const ORDNER = `plaene/${PHASE}`;
const PHASEN_BRANCH = `phase/77-${PHASE}`;
const PAKET_BRANCH = "paket/AB2-probe";
const ABSICHT = [
  "Die Zahl soll aus der Konfiguration kommen, damit sie an einer Stelle steht.",
  "### Nicht gewollt",
  "Ein Sonderfall nur für die Testeingabe – auch wenn alle Tests grün sind.",
].join("\n");
const ISSUE_QUELLE = "Abschnitt „## Absicht“ in Issue #77";
const PFLICHT = "Paket-PR und Phase mit Absicht brauchen im Issue den Abschnitt „## Absicht“";

function issue(body) {
  return { nummer: "77", title: "Phase 77", body };
}

function mitAbsicht(absicht) {
  return issue(`## Absicht\n\n${absicht}\n\n## Ziel\n\nZahl 2\n`);
}

function phasenPr(context, { feld }) {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  const phase = { phase: PHASE, ...(feld === undefined ? {} : { absicht: feld }), auftraege: [] };
  const pitch = "# Pitch\n\n## Absicht\n\nEine Absicht im PR, die der Prüfer nie als Vorgabe nimmt.\n";
  const head = repo.committe({ [`${ORDNER}/pitch.md`]: pitch, [`${ORDNER}/phase.json`]: JSON.stringify(phase) }, "Lege die Phase an\n");
  return { branch: PHASEN_BRANCH, basis, head, root: repo.ordner };
}

test("die Absicht kommt wörtlich aus dem Abschnitt des verknüpften Issues, nie aus dem Inhalt des PR", (context) => {
  const pr = phasenPr(context, { feld: ABSICHT });
  assert.deepEqual(absichtFuerPr({ ...pr, issue: mitAbsicht(ABSICHT) }), { text: ABSICHT, quelle: ISSUE_QUELLE });
});

test("bringt der PR eine Phase mit Feld absicht, hält ein fehlender oder abweichender Abschnitt im Issue den Prüfer an", (context) => {
  const pr = phasenPr(context, { feld: ABSICHT });
  assert.deepEqual(absichtFuerPr({ ...pr, issue: issue("## Ziel\n\nZahl 2\n") }), { fehlt: `Issue #77: ${PFLICHT}` });
  assert.deepEqual(absichtFuerPr({ ...pr, issue: mitAbsicht(ABSICHT.slice(1)) }), {
    fehlt: `Issue #77: der Abschnitt „## Absicht“ weicht von absicht in ${ORDNER}/phase.json ab`,
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
    [`Issue #77: ${PFLICHT}`, `kein verknüpftes Issue: ${PFLICHT}`, "Issue #77: der Abschnitt „## Absicht“ ist leer", `Issue #77 nicht lesbar: ${PFLICHT}`],
  );
});

test("ein PR, der weder Paket ist noch eine Phase mit Absicht bringt, läuft ohne Absicht weiter, außer sein Issue nennt eine", () => {
  assert.match(absichtFuerPr({ branch: "dependabot/npm_and_yarn/alle", issue: null }).keine, /^keine Angabe; /);
  assert.equal(absichtFuerPr({ branch: "aufraeumen/x", issue: mitAbsicht(ABSICHT) }).text, ABSICHT);
});

test("ein Fork-PR bekommt nie eine Absicht als Vorgabe, auch mit Branch paket/ und Issue-Abschnitt", () => {
  assert.deepEqual(absichtFuerPr({ branch: PAKET_BRANCH, issue: mitAbsicht(ABSICHT), fork: true }), { keine: "keine Angabe; der Pull Request kommt aus einem Fork" });
});

test("nur eine fehlende Pflicht-Absicht hält den Prüfer an, „keine Angabe“ und eine vorhandene Absicht nicht", () => {
  assert.deepEqual(
    [{ fehlt: "Issue #77: leer" }, { keine: "keine Angabe; Fork" }, { text: ABSICHT, quelle: ISSUE_QUELLE }].map(abbruchOhneAbsicht),
    ["Absicht fehlt: Issue #77: leer", "", ""],
  );
});
