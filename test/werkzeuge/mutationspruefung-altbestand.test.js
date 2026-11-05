import assert from "node:assert/strict";
import { test } from "node:test";

import { ALTBESTAND_MELDUNGEN, altbestandGemeldet, altbestandZeile } from "../../tools/mutationspruefung/altbestand.mjs";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

function json(wert) {
  return `${JSON.stringify(wert, null, 2)}\n`;
}

function sha(verzeichnis) {
  return runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

const LISTE = "tools/basis/altbestand-ohne-auftrag.json";
const EINTRAG = { kuerzel: "S1da", grund: "Antonio 01.11. 10:3x / 02.11.: Kurzauftrag vor SLN, Antonio approvt selbst" };
const MUTANT = "src/a.js:3 ConditionalExpression";
const NACHRICHT = `Ändere a.js\n\nGleichwertig: ${MUTANT}, weil die Bedingung nie falsch wird.\n`;
const IM_PULL_REQUEST = (nummer) => ({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: `refs/pull/${nummer}/merge` });
const IN_DER_GRUPPE = (nummer) => ({ GITHUB_EVENT_NAME: "merge_group", GITHUB_REF: `refs/heads/gh-readonly-queue/master/pr-${nummer}-${"b".repeat(40)}` });

function repo(context, { basisListe, kopfListe = basisListe }) {
  const verzeichnis = probeRepository(context, basisListe === null ? { "a.txt": "a\n" } : { [LISTE]: json(basisListe) });
  const basis = sha(verzeichnis);
  if (kopfListe !== basisListe) {
    writeFiles(verzeichnis, { [LISTE]: json(kopfListe) });
    commitAll(verzeichnis, "Ändere die Liste");
  }
  return { verzeichnis, basis };
}

const FAELLE = [
  { name: "pull_request eines gelisteten PR: die Meldung ohne Zeile Auftrag zählt", umgebung: IM_PULL_REQUEST(7), liste: { 7: EINTRAG }, erwartet: [MUTANT] },
  { name: "Merge-Gruppe eines gelisteten PR: die Meldung zählt", umgebung: IN_DER_GRUPPE(7), liste: { 7: EINTRAG }, erwartet: [MUTANT] },
  { name: "PR außerhalb der Liste: die Meldung zählt nicht", umgebung: IM_PULL_REQUEST(9), liste: { 7: EINTRAG }, erwartet: [] },
  { name: "Merge-Gruppe außerhalb der Liste: die Meldung zählt nicht", umgebung: IN_DER_GRUPPE(9), liste: { 7: EINTRAG }, erwartet: [] },
  { name: "lokaler Lauf ohne GitHub-Umgebung: die Meldung zählt nicht", umgebung: {}, liste: { 7: EINTRAG }, erwartet: [] },
  { name: "workflow_dispatch: die Meldung zählt nicht", umgebung: { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/master" }, liste: { 7: EINTRAG }, erwartet: [] },
  { name: "neuer Eintrag nur am Kopf: die Meldung zählt nicht", umgebung: IM_PULL_REQUEST(8), liste: { 7: EINTRAG }, kopfListe: { 7: EINTRAG, 8: EINTRAG }, erwartet: [] },
  { name: "Liste fehlt am Basis-Stand: die Meldung zählt nicht", umgebung: IM_PULL_REQUEST(7), liste: null, kopfListe: { 7: EINTRAG }, erwartet: [] },
];

test("Gleichwertig-Meldungen ohne Zeile Auftrag zählen nur im Lauf eines gelisteten PR mit wirksamer Liste", (context) => {
  for (const { name, umgebung, liste, kopfListe, erwartet } of FAELLE) {
    ALTBESTAND_MELDUNGEN.clear();
    const { verzeichnis, basis } = repo(context, { basisListe: liste, kopfListe });
    const gemeldet = altbestandGemeldet({ nachrichten: [NACHRICHT, "Ohne Meldung\n"], basis, root: verzeichnis, umgebung });
    assert.deepEqual(gemeldet, erwartet, name);
  }
});

test("eine Altbestand-Meldung steht im Bericht als Altbestand mit PR und Kürzel", (context) => {
  ALTBESTAND_MELDUNGEN.clear();
  const { verzeichnis, basis } = repo(context, { basisListe: { 7: EINTRAG } });
  altbestandGemeldet({ nachrichten: [NACHRICHT], basis, root: verzeichnis, umgebung: IM_PULL_REQUEST(7) });
  assert.equal(altbestandZeile(MUTANT), `Altbestand: Gleichwertig-Meldung ohne Zeile „Auftrag:“ aus PR 7 (S1da): ${MUTANT}`);
  assert.equal(altbestandZeile("src/b.js:1 StringLiteral"), null);
});
