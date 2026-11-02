import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";
import { ZUORDNUNG, dateiFuerSchritt, eintraegeDerZuordnung, zuordnungAus } from "./zweck-quellen.js";

const GIT_PUFFER = 64 * 1024 * 1024;
const SAMMELDATEI ="tools/zweck/zuordnung/workflow-schritte.json";
const LINT = ".github/workflows/ci.yml › pruefungen › Lint";
const LINT_EINTRAG = { gruppen: "tools/zweck/zuordnung/lint-regeln.json", beleg: "tools/lint-format.mjs" };

function git(argumente) {
  return execFileSync("git", argumente, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_PUFFER });
}

function umzugscommit() {
  const [erster] = git(["log", "--diff-filter=A", "--reverse", "--format=%H", "--", `${ZUORDNUNG}/`]).split("\n");
  assert.ok(erster, `kein Commit legt ${ZUORDNUNG}/ an`);
  return erster;
}

function ordnerIm(commit) {
  return git(["ls-tree", "-r", "--name-only", commit, "--", `${ZUORDNUNG}/`])
    .split("\n")
    .filter(Boolean)
    .map((voll) => ({ pfad: voll.slice(ZUORDNUNG.length + 1), text: git(["show", `${commit}:${voll}`]) }));
}

function datei(schritt, eintrag = {}) {
  return { pfad: dateiFuerSchritt(schritt), text: JSON.stringify({ schritt, ...eintrag }) };
}

test("der Umzug in den Ordner übernimmt jeden Eintrag der Sammeldatei unverändert und keinen dazu", () => {
  const commit = umzugscommit();
  const vorher = JSON.parse(git(["show", `${commit}^:${SAMMELDATEI}`]));
  assert.ok(Object.keys(vorher).length > 0);
  assert.deepEqual(zuordnungAus(ordnerIm(commit)), vorher);
  assert.throws(() => git(["cat-file", "-e", `${commit}:${SAMMELDATEI}`]), "die Sammeldatei bleibt neben dem Ordner bestehen");
});

test("der Pfad eines Eintrags folgt aus Workflow-Datei, Job und Schrittname", () => {
  const faelle = [
    [LINT, "workflows/ci/pruefungen/lint.json"],
    [".github/workflows/ci.yml › pruefungen › Syntax (.js und .mjs; .ts prüft die Typprüfung)", "workflows/ci/pruefungen/syntax-js-und-mjs-ts-prueft-die-typpruefung.json"],
    [".github/workflows/pruefleiter.yml › werkzeugtests › Übernahme im Schatten", "workflows/pruefleiter/werkzeugtests/uebernahme-im-schatten.json"],
    [".github/actions/node-npm-ci/action.yml › npm ci für apps/web", "actions/node-npm-ci/npm-ci-fuer-apps-web.json"],
    [".github/workflows/testschutz.yml › neu-auswerten › Testschutz der verknüpften PRs neu starten", "workflows/testschutz/neu-auswerten/testschutz-der-verknuepften-prs-neu-starten.json"],
  ];
  for (const [schritt, pfad] of faelle) assert.equal(dateiFuerSchritt(schritt), pfad, schritt);
});

test("der Leser gibt je Datei den Schritt mit seinem Eintrag ohne das Feld schritt zurück", () => {
  assert.deepEqual(zuordnungAus([datei(LINT, LINT_EINTRAG)]), { [LINT]: LINT_EINTRAG });
});

test("ein Eintrag an einem anderen Pfad als dem aus seinem Schritt bricht das Lesen ab", () => {
  const falsch = { ...datei(LINT, LINT_EINTRAG), pfad: "workflows/ci/pruefungen/lint-zwei.json" };
  assert.throws(() => zuordnungAus([falsch]), /gehört nach tools\/zweck\/zuordnung\/workflow-schritte\/workflows\/ci\/pruefungen\/lint\.json/);
});

test("eine Datei ohne Schritt oder ohne Endung .json im Ordner bricht das Lesen ab", () => {
  assert.throws(() => zuordnungAus([{ pfad: "workflows/ci/pruefungen/lint.json", text: JSON.stringify(LINT_EINTRAG) }]), /Feld schritt fehlt/);
  assert.throws(() => zuordnungAus([{ ...datei(LINT, LINT_EINTRAG), pfad: "workflows/ci/pruefungen/lint.txt" }]), /keine JSON-Datei/);
});

test("der echte Ordner liest sich ohne Abbruch und kennt den Lint-Schritt", () => {
  assert.deepEqual(eintraegeDerZuordnung()[LINT], LINT_EINTRAG);
});
