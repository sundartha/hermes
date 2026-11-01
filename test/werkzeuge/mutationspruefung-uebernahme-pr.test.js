import assert from "node:assert/strict";
import { test } from "node:test";

import { abgewandelt } from "./mutationspruefung-nachrunde-hilfen.js";
import { holeImPullRequest, mergeVorlauf, prLauf, vorlaufJeDatei } from "./mutationspruefung-uebernahme-hilfen.js";

const KEIN_VORERGEBNIS = /^Mutationsprüfung: kein Vorergebnis \((.+)\), voller Neulauf\.$/m;
const AUS_VORLAUF = /^Mutationsprüfung: Vorergebnis aus Lauf (\d+), .+$/m;
const FRIST = { timeout: 600_000 };
const zustand = vorlaufJeDatei(FRIST);

function abgelehnt(optionen, grund, eigener = zustand.vorlauf) {
  const { geholt } = holeImPullRequest(eigener, zustand.aufraeumer, optionen);
  const treffer = geholt.stdout.match(KEIN_VORERGEBNIS);
  assert.ok(treffer, geholt.stdout);
  assert.match(treffer[1], grund);
}

function gewaehlt(optionen) {
  const { geholt } = holeImPullRequest(zustand.vorlauf, zustand.aufraeumer, optionen);
  const treffer = geholt.stdout.match(AUS_VORLAUF);
  assert.ok(treffer, geholt.stdout);
  return { lauf: Number(treffer[1]), ausgabe: geholt.stdout };
}

function mitTeilen(umbau) {
  return abgewandelt(zustand.vorlauf, zustand.aufraeumer, umbau);
}

test("der Pull Request übernimmt den jüngsten abgeschlossenen früheren Lauf, nicht laufende, abgebrochene oder spätere", FRIST, () => {
  const laeufe = [
    prLauf(zustand.vorlauf, { id: 4710 }),
    prLauf(zustand.vorlauf, { id: 4712, conclusion: "failure" }),
    prLauf(zustand.vorlauf, { id: 4713, status: "in_progress", conclusion: null }),
    prLauf(zustand.vorlauf, { id: 4999, conclusion: "cancelled" }),
    prLauf(zustand.vorlauf, { id: 5001 }),
  ];
  assert.equal(gewaehlt({ laeufe }).lauf, 4712);
});

test("ein Lauf eines anderen Pull Requests auf demselben Zweignamen wird nicht als Vorlauf genommen", FRIST, () => {
  abgelehnt({ laeufe: [prLauf(zustand.vorlauf, { pull_requests: [{ number: 78 }] })] }, /kein früherer abgeschlossener Lauf dieses Pull Requests/);
});

test("ein Lauf aus einem Fork wird nicht als Vorlauf genommen", FRIST, () => {
  abgelehnt({ laeufe: [prLauf(zustand.vorlauf, { head_repository: { full_name: "fremd/repo" } })] }, /kein früherer abgeschlossener Lauf dieses Pull Requests/);
});

test("ein Lauf eines anderen Workflows wird nicht als Vorlauf genommen", FRIST, () => {
  abgelehnt({ laeufe: [prLauf(zustand.vorlauf, { path: ".github/workflows/andere.yml" })] }, /kein früherer abgeschlossener Lauf dieses Pull Requests/);
});

test("ein Lauf eines anderen Ereignisses wird nicht als Vorlauf genommen", FRIST, () => {
  abgelehnt({ laeufe: [prLauf(zustand.vorlauf, { event: "push" })] }, /kein früherer abgeschlossener Lauf dieses Pull Requests/);
});

test("ohne früheren Lauf des Pull Requests läuft die Prüfung voll neu mit Logzeile", FRIST, () => {
  abgelehnt({ laeufe: [] }, /kein früherer abgeschlossener Lauf dieses Pull Requests/);
});

test("ein Vorlauf, dessen Kopf einen anderen Baum hat als der geprüfte, wird nicht angenommen", FRIST, () => {
  abgelehnt({ laeufe: [prLauf(zustand.vorlauf, { head_sha: zustand.vorlauf.basis })], lauf: { head_sha: zustand.vorlauf.basis } }, /Kopf des Vorlaufs nicht nachprüfbar/);
});

test("ein Vorlauf, der auf dem Merge-Commit des Pull Requests gemessen hat, wird angenommen, auch wenn der Zweig hinter dem Hauptstand liegt", FRIST, () => {
  const merge = mergeVorlauf(zustand.vorlauf, zustand.aufraeumer);
  const lauf = { head_sha: merge.kopfPr };
  const { geholt } = holeImPullRequest(merge, zustand.aufraeumer, { laeufe: [prLauf(merge, lauf)], lauf });
  assert.match(geholt.stdout, AUS_VORLAUF);
});

test("ein Merge-Commit des Vorlaufs, dessen Baum nicht zum Teilergebnis passt, wird nicht angenommen", FRIST, () => {
  const merge = mergeVorlauf(zustand.vorlauf, zustand.aufraeumer, (teil) => ({ ...teil, baum: "0".repeat(40) }));
  const lauf = { head_sha: merge.kopfPr };
  abgelehnt({ laeufe: [prLauf(merge, lauf)], lauf }, /Kopf des Vorlaufs nicht nachprüfbar/, merge);
});

test("ein Merge-Commit des Vorlaufs, der den Kopf des Pull Requests nicht als zweiten Elternteil hat, wird nicht angenommen", FRIST, () => {
  const merge = mergeVorlauf(zustand.vorlauf, zustand.aufraeumer);
  const lauf = { head_sha: merge.kopfBasis };
  abgelehnt({ laeufe: [prLauf(merge, lauf)], lauf }, /Kopf des Vorlaufs nicht nachprüfbar/, merge);
});

test("Teilergebnisse eines Vorlaufs, die auf verschiedenen Commits gemessen haben, werden nicht angenommen", FRIST, () => {
  const merge = mergeVorlauf(zustand.vorlauf, zustand.aufraeumer);
  const gemischt = abgewandelt(merge, zustand.aufraeumer, ([erster]) => [{ ...erster, teile: 2, kopf: merge.merge, baum: merge.baum }, { ...erster, teil: 2, teile: 2, kopf: merge.kopfPr, baum: merge.baum }]);
  const lauf = { head_sha: merge.kopfPr };
  abgelehnt({ laeufe: [prLauf(merge, lauf)], lauf }, /Kopf des Vorlaufs nicht nachprüfbar/, gemischt);
});

test("Teilergebnisse ohne Angabe des geprüften Baums werden nicht angenommen", FRIST, () => {
  const ohneBaum = mitTeilen((teile) => teile.map((teil) => ({ ...teil, baum: undefined })));
  abgelehnt({}, /Kopf des Vorlaufs nicht nachprüfbar/, ohneBaum);
});

test("ein Vorlauf mit fehlendem Teilergebnis wird nicht angenommen", FRIST, () => {
  const unvollstaendig = mitTeilen(([erster]) => [{ ...erster, teile: 2 }]);
  abgelehnt({}, /hat nicht alle Teilergebnisse/, unvollstaendig);
});

test("ohne Angabe des Schalters übernimmt der Pull Request im Schattenmodus", FRIST, () => {
  const { ausgabe } = gewaehlt({ umgebung: { MUTATION_UEBERNAHME_PR: undefined } });
  assert.match(ausgabe, /Schattenmodus: nichts wird übernommen\./);
});

test("der Schalter aus holt keinen Vorlauf", FRIST, () => {
  abgelehnt({ umgebung: { MUTATION_UEBERNAHME_PR: "aus" } }, /ausgeschaltet/);
});

test("ein unbekannter Wert des Schalters holt keinen Vorlauf", FRIST, () => {
  abgelehnt({ umgebung: { MUTATION_UEBERNAHME_PR: "vielleicht" } }, /unbekannten Wert "vielleicht"/);
});

test("der Schalter an holt den Vorlauf ohne Hinweis auf den Schattenmodus", FRIST, () => {
  assert.doesNotMatch(gewaehlt({ umgebung: { MUTATION_UEBERNAHME_PR: "an" } }).ausgabe, /Schattenmodus/);
});
