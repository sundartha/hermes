import assert from "node:assert/strict";
import { test } from "node:test";

import { zuPruefendeCommits } from "../../tools/auftrag/pruefer-auswahl.mjs";
import { ohneGitVariablen, probeRepo } from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const PAKET_BRANCH = "paket/28-pruefer";
const PAKET_NACHRICHT = "Ändere die Zahl\n\nWarum: Probe.\n\nPaket: 28\n";
const AUFTRAG_NACHRICHT =
  "Ändere den Text\n\nWarum: Auftrag a1.\n\nAuftrag: probe/a1\nArt: funktion\n";

function auswahl(repo, basis, branch) {
  return zuPruefendeCommits({
    basis,
    head: repo.git(["rev-parse", "HEAD"]),
    branch,
    root: repo.ordner,
  });
}

test("ein Paket-Commit auf dem passenden paket/NN-Branch fällt weg, ein Auftrags-Commit wird geprüft", (context) => {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  const paket = repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, PAKET_NACHRICHT);
  const auftrag = repo.committe({ "src/text.js": "export const TEXT = 1;\n" }, AUFTRAG_NACHRICHT);
  const { probeBranch, commits, weggelassen } = auswahl(repo, basis, PAKET_BRANCH);
  assert.equal(probeBranch, false);
  assert.deepEqual(weggelassen, [paket]);
  assert.deepEqual(
    commits.map(({ sha, dateien }) => ({ sha, dateien })),
    [{ sha: auftrag, dateien: ["src/text.js"] }],
  );
});

test("ein Commit mit Paket: 99 auf einem paket/28-Branch wird geprüft", (context) => {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  const fremd = repo.committe(
    { "src/zahl.js": "export const ZAHL = 3;\n" },
    "Ändere die Zahl\n\nWarum: Probe.\n\nPaket: 99\n",
  );
  const { commits, weggelassen } = auswahl(repo, basis, PAKET_BRANCH);
  assert.deepEqual(weggelassen, []);
  assert.deepEqual(
    commits.map(({ sha }) => sha),
    [fremd],
  );
});

test("ein Paket-Commit auf einem fremden Branch wird geprüft", (context) => {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  const commit = repo.committe({ "src/zahl.js": "export const ZAHL = 4;\n" }, PAKET_NACHRICHT);
  assert.deepEqual(
    auswahl(repo, basis, "fix/zahl").commits.map(({ sha }) => sha),
    [commit],
  );
});

test("rotprobe/- und beleg/-Branches sind Probe-Branches und werden nicht geprüft", (context) => {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe({ "src/zahl.js": "export const ZAHL = 5;\n" }, AUFTRAG_NACHRICHT);
  for (const branch of ["rotprobe/token", "beleg/auto-merge"]) {
    assert.deepEqual(auswahl(repo, basis, branch), {
      probeBranch: true,
      commits: [],
      weggelassen: [],
    });
  }
});

function patchIdAufBasis(repo, basis, inhalt) {
  repo.git(["checkout", "-q", "--detach", basis]);
  repo.committe({ "src/zahl.js": inhalt }, AUFTRAG_NACHRICHT);
  return auswahl(repo, basis, "variante").commits[0].patchId;
}

test("nach einem Rebase bleibt die patchId gleich, ein geänderter Diff ändert sie, auch bei Leerzeichen", (context) => {
  const repo = probeRepo(context, {
    "src/zahl.js": "export const ZAHL = 1;\n",
    "src/text.js": "export const TEXT = 1;\n",
  });
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.git(["checkout", "-q", "-b", "arbeit"]);
  const original = repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, AUFTRAG_NACHRICHT);
  const [vorher] = auswahl(repo, basis, "arbeit").commits;
  repo.git(["checkout", "-q", "-b", "neu", basis]);
  const neueBasis = repo.committe({ "src/text.js": "export const TEXT = 2;\n" }, "Neue Basis");
  repo.git([
    "-c",
    "user.name=Probe",
    "-c",
    "user.email=probe@example.invalid",
    "cherry-pick",
    original,
  ]);
  const [nachRebase] = auswahl(repo, neueBasis, "neu").commits;
  assert.notEqual(nachRebase.sha, vorher.sha);
  assert.equal(nachRebase.patchId, vorher.patchId);
  assert.match(vorher.patchId, /^[0-9a-f]{40}$/);
  assert.notEqual(patchIdAufBasis(repo, basis, "export const ZAHL = 3;\n"), vorher.patchId);
  assert.notEqual(patchIdAufBasis(repo, basis, "export const ZAHL =  2;\n"), vorher.patchId);
});

test("ein Commit an der Telefonie ist kritisch, einer an einer anderen Datei nicht", (context) => {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe({ "src/telephony/anruf.js": "export const ANRUF = 1;\n" }, AUFTRAG_NACHRICHT);
  repo.committe({ "src/anzeige.js": "export const ANZEIGE = 1;\n" }, AUFTRAG_NACHRICHT);
  assert.deepEqual(
    auswahl(repo, basis, "fix/x").commits.map(({ kritisch }) => kritisch),
    [true, false],
  );
});
