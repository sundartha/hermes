import assert from "node:assert/strict";
import { test } from "node:test";

import { ROTER_TEST, SIEBEN_TEST, VERDOPPELT, funktion, pruefung } from "./auftrag-lauf-hilfen.js";
import { ACHT_ZUSATZ, ERSTER_START_NACH_ABBRUCH_ANHAENGEN, GRUNDLAGE, RECHNEN, abgebrochen, rollen } from "./auftrag-lauf-fortsetzung-hilfen.js";
import { EXIT_ROT, starte, starteNochmal } from "./auftrag-lauf-probe.js";
import { commitAll, gitAusgabe, runIn, writeFiles } from "./probe-repo.js";

const DREHBUCH = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
const EIGENER_ZWISCHENSTAND = "Zwischenstand: Abnahmetest für A1";
const SICHERUNGEN = "refs/auftrag-zwischenstand";

function sicherungen(repo) {
  return gitAusgabe(repo, "for-each-ref", "--format=%(objectname)", SICHERUNGEN).split("\n").filter(Boolean);
}

function ausgang(repo) {
  return gitAusgabe(repo, "rev-parse", "HEAD");
}

const TEST_UND_BAU = [{ "test/rechnen.test.js": ROTER_TEST }, { "src/rechnen.js": VERDOPPELT }];

function mitZwischenstaenden({ dateien = TEST_UND_BAU, oben = [] } = {}) {
  const stand = {};
  const vorbereiten = (repo) => {
    stand.basis = ausgang(repo);
    for (const inhalt of dateien) {
      writeFiles(repo, inhalt);
      commitAll(repo, EIGENER_ZWISCHENSTAND);
      stand.erster ??= ausgang(repo);
    }
    stand.zwischenstand = ausgang(repo);
    for (const betreff of oben) {
      writeFiles(repo, { "notizen/fremd.txt": `${betreff}\n` });
      commitAll(repo, betreff);
    }
  };
  return { stand, vorbereiten };
}

test("ein Neustart mit eigenen Zwischenständen oben auf dem Branch baut gegen den Stand davor: der neue Fall ist rot, ein Commit liegt auf der Basis", (context) => {
  const { stand: vorher, vorbereiten: zwischenstaende } = mitZwischenstaenden();
  const vorbereiten = (repo) => {
    zwischenstaende(repo);
    runIn(repo, "git", ["update-ref", "refs/remotes/origin/master", "HEAD"]);
    runIn(repo, "git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"]);
  };
  const { repo, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, vorbereiten });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(beleg.basis, vorher.basis);
  assert.equal(pruefung(beleg, "rot"), 0);
  assert.equal(gitAusgabe(repo, "rev-parse", "HEAD~1"), vorher.basis);
  assert.equal(gitAusgabe(repo, "log", "--format=%s", `${vorher.basis}..HEAD`), "Verdopple Zahlen");
});

test("ein Neustart sichert die eigenen Zwischenstände unter einer Referenz, bevor er den Branch auf den Stand davor setzt", (context) => {
  const { stand: vorher, vorbereiten } = mitZwischenstaenden();
  const { repo, lauf } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, vorbereiten });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(sicherungen(repo), [vorher.zwischenstand]);
  assert.equal(gitAusgabe(repo, "rev-list", "--count", `${vorher.basis}..${vorher.zwischenstand}`), "2");
  assert.match(lauf.stderr, /eigene Zwischenstände von Auftrag A1 \(Commits: 2\)/);
});

test("Zwischenstände eines anderen Auftrags oben auf dem Branch bleiben liegen: die Basis ist der Kopf wie bisher", (context) => {
  const vorbereiten = (repo) => {
    writeFiles(repo, { "src/text.js": "export function gross(text) {\n  return text.toUpperCase() + '';\n}\n" });
    commitAll(repo, "Zwischenstand: Abnahmetest für B2");
  };
  const { repo, lauf, beleg, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, vorbereiten });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(beleg.basis, basis);
  assert.equal(gitAusgabe(repo, "log", "--format=%s", `${basis}..HEAD`), "Verdopple Zahlen");
  assert.deepEqual(sicherungen(repo), []);
});

test("liegt über den eigenen Zwischenständen ein fremder Commit, bleibt die Basis der Kopf: lauf setzt keinen fremden Commit zurück", (context) => {
  const { stand: vorher, vorbereiten } = mitZwischenstaenden({ dateien: [{ "notizen/halde.txt": "Rest\n" }], oben: ["Plane den Auftrag A1"] });
  const { repo, lauf, beleg, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, vorbereiten });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(beleg.basis, basis);
  assert.notEqual(beleg.basis, vorher.basis);
  assert.equal(runIn(repo, "git", ["merge-base", "--is-ancestor", vorher.zwischenstand, "HEAD"]).status, 0);
  assert.deepEqual(sicherungen(repo), []);
});

test("ist schon einer der eigenen Zwischenstände auf einem Remote-Zweig, setzt lauf nichts zurück und hält mit dem Grund an", (context) => {
  const { stand: vorher, vorbereiten: zwischenstaende } = mitZwischenstaenden();
  const vorbereiten = (repo) => {
    zwischenstaende(repo);
    runIn(repo, "git", ["update-ref", "refs/remotes/origin/paket-probe", vorher.erster]);
  };
  const { repo, lauf, kopf } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, vorbereiten });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /schon gepusht/);
  assert.equal(kopf, vorher.zwischenstand);
  assert.deepEqual(sicherungen(repo), []);
});

test("ein Neustart setzt auf dem gesicherten Stand fort, auch wenn die Zwischenstände des Abbruchs noch oben auf dem Branch liegen", (context) => {
  const erster = abgebrochen(context, { drehbuch: { "test-nachrunde": { [RECHNEN]: SIEBEN_TEST } } });
  assert.match(gitAusgabe(erster.repo, "log", "-1", "--format=%s"), /^Zwischenstand: Abnahmetest für A1$/);
  runIn(erster.repo, "git", ["reset", "-q", "--hard", "HEAD"]);
  runIn(erster.repo, "git", ["clean", "-q", "-fd"]);
  const { lauf, beleg, repo } = starteNochmal(erster, { ...GRUNDLAGE, [ERSTER_START_NACH_ABBRUCH_ANHAENGEN]: { [RECHNEN]: ACHT_ZUSATZ } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /Fortsetzung auf gesichertem Stand/);
  assert.deepEqual(rollen(beleg), ["test"]);
  assert.equal(gitAusgabe(repo, "log", "--format=%s", `${erster.basis}..HEAD`), "Verdopple Zahlen");
  assert.equal(sicherungen(repo).length, 1);
});
