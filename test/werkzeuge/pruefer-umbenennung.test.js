import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { baueArbeitsordner, entferne } from "../../tools/auftrag/pruefer-arbeitsordner.mjs";
import { zuPruefendeCommits } from "../../tools/auftrag/pruefer-auswahl.mjs";
import { ohneGitVariablen, probeRepo } from "./pruefer/hilfen.mjs";
import { isolatedEnvironment } from "./probe-repo.js";

ohneGitVariablen();

const PR_PATCH = "pr/gesamt.patch";
const UMBENENNUNGEN = 30;
const GEAENDERT = "src/zahl.js";
const NEUE_ZAHL = "+export const ZAHL = 2;";
const UMBENANNT = "umbenannt, Inhalt gleich";

function testdatei(nummer) {
  return `test/t-${String(nummer).padStart(2, "0")}.test`;
}

function vieleTestdateien() {
  return Object.fromEntries(
    Array.from({ length: UMBENENNUNGEN }, (_, index) => [`${testdatei(index)}.js`, `export const NUMMER = ${index};\n`]),
  );
}

function arbeitsordnerAllerCommits(context, repo, basis) {
  const { commits } = zuPruefendeCommits({ basis, head: repo.git(["rev-parse", "HEAD"]), branch: "paket/probe", root: repo.ordner });
  const liste = commits.map((commit, index) => ({ ...commit, letzter: index === commits.length - 1 }));
  return liste.map((commit) => {
    const { ordner } = baueArbeitsordner(commit, { root: repo.ordner, auftragstext: "", ciLauf: "", basis, commits: liste });
    context.after(() => entferne(ordner));
    const diffs = readdirSync(join(ordner, "diff")).sort().map((name) => readFileSync(join(ordner, "diff", name), "utf8"));
    const gesamt = commit.letzter ? readFileSync(join(ordner, PR_PATCH), "utf8") : "";
    return { diffs, gesamt, auftrag: readFileSync(join(ordner, "auftrag.md"), "utf8") };
  });
}

function zeileFuer(repo, alt, neu) {
  const blob = repo.git(["rev-parse", `HEAD:${neu}`]);
  return `${UMBENANNT}: ${JSON.stringify(alt)} → ${JSON.stringify(neu)} (Blob ${blob}, Modus 100644)\n`;
}

test("30 byte-gleiche Umbenennungen und eine geänderte Datei: 30 Zeilen mit Blob statt Patch, die geänderte Datei als voller Patch", (context) => {
  const repo = probeRepo(context, { [GEAENDERT]: "export const ZAHL = 1;\n", ...vieleTestdateien() });
  const basis = repo.git(["rev-parse", "HEAD"]);
  for (let index = 0; index < UMBENENNUNGEN; index += 1) repo.git(["mv", `${testdatei(index)}.js`, `${testdatei(index)}.ts`]);
  repo.committe({ [GEAENDERT]: "export const ZAHL = 2;\n" }, "Benenne die Tests um\n");
  const [{ diffs, gesamt, auftrag }] = arbeitsordnerAllerCommits(context, repo, basis);
  const zeilen = Array.from({ length: UMBENENNUNGEN }, (_, index) => zeileFuer(repo, `${testdatei(index)}.js`, `${testdatei(index)}.ts`));
  for (const [index, zeile] of zeilen.entries()) {
    assert.equal(repo.git(["rev-parse", `${basis}:${testdatei(index)}.js`]), repo.git(["rev-parse", `HEAD:${testdatei(index)}.ts`]));
    assert.ok(diffs.includes(zeile), zeile);
    assert.ok(gesamt.includes(zeile), zeile);
  }
  assert.equal(diffs.length, UMBENENNUNGEN + 1);
  assert.equal(diffs.filter((diff) => diff.includes(NEUE_ZAHL)).length, 1);
  assert.ok(gesamt.includes(NEUE_ZAHL) && !gesamt.includes("diff --git a/test/"), gesamt);
  assert.ok(auftrag.includes(`"${testdatei(0)}.ts" → dateien/${testdatei(0)}.ts`), auftrag);
});

test("ein Commit mit nur byte-gleichen Umbenennungen: der Gesamt-Patch besteht genau aus den Zeilen", (context) => {
  const repo = probeRepo(context, vieleTestdateien());
  const basis = repo.git(["rev-parse", "HEAD"]);
  for (let index = 0; index < UMBENENNUNGEN; index += 1) repo.git(["mv", `${testdatei(index)}.js`, `${testdatei(index)}.ts`]);
  repo.committe({}, "Benenne die Tests um\n");
  const [{ diffs, gesamt }] = arbeitsordnerAllerCommits(context, repo, basis);
  const zeilen = Array.from({ length: UMBENENNUNGEN }, (_, index) => zeileFuer(repo, `${testdatei(index)}.js`, `${testdatei(index)}.ts`));
  assert.equal(gesamt, zeilen.join(""));
  assert.deepEqual(diffs, zeilen);
});

const AUSFUEHRBAR = 0o755;

function umbenanntMit(context, { neu = {}, vorbereiten = () => undefined }) {
  const repo = probeRepo(context, { "src/a.js": "export const A = 1;\n" });
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.git(["mv", "src/a.js", "src/a.ts"]);
  vorbereiten(repo);
  repo.committe(neu, "Benenne a um\n");
  return arbeitsordnerAllerCommits(context, repo, basis);
}

function zeigtLoeschenUndNeu(text) {
  return text.includes("diff --git a/src/a.js b/src/a.js\ndeleted file mode") && text.includes("diff --git a/src/a.ts b/src/a.ts\nnew file mode");
}

test("eine Umbenennung mit einem geänderten Byte oder mit geändertem Modus bleibt Lösch- und Neu-Patch", (context) => {
  const einByte = umbenanntMit(context, { neu: { "src/a.ts": "export const A = 2;\n" } });
  const modus = umbenanntMit(context, { vorbereiten: (repo) => chmodSync(join(repo.ordner, "src/a.ts"), AUSFUEHRBAR) });
  for (const [{ diffs, gesamt }] of [einByte, modus]) {
    assert.ok(!diffs.join("").includes(UMBENANNT) && !gesamt.includes(UMBENANNT), gesamt);
    assert.ok(zeigtLoeschenUndNeu(diffs.join("")) && zeigtLoeschenUndNeu(gesamt), gesamt);
  }
});

test("ein umbenannter Symlink mit gleichem Ziel bleibt Lösch- und Neu-Patch", (context) => {
  const repo = probeRepo(context, { "src/ziel.js": "export const Z = 1;\n" });
  symlinkSync("ziel.js", join(repo.ordner, "src/verweis.js"));
  repo.committe({}, "Verweis\n");
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.git(["mv", "src/verweis.js", "src/verweis.ts"]);
  repo.committe({}, "Benenne den Verweis um\n");
  const [{ diffs, gesamt }] = arbeitsordnerAllerCommits(context, repo, basis);
  assert.ok(!diffs.join("").includes(UMBENANNT) && !gesamt.includes(UMBENANNT), gesamt);
  assert.ok(gesamt.includes("deleted file mode 120000") && gesamt.includes("new file mode 120000"), gesamt);
});

test("eine Umbenennung, die ein späterer Commit ändert, ist am Commit eine Zeile und im Gesamt-Patch voll", (context) => {
  const repo = probeRepo(context, { "src/a.js": "export const A = 1;\n" });
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.git(["mv", "src/a.js", "src/a.ts"]);
  repo.committe({}, "Benenne a um\n");
  repo.committe({ "src/a.ts": "export const A = 2;\n" }, "Ändere a\n");
  const [erster, zweiter] = arbeitsordnerAllerCommits(context, repo, basis);
  assert.equal(erster.diffs.length, 1);
  assert.ok(erster.diffs[0].startsWith(`${UMBENANNT}: "src/a.js" → "src/a.ts" (Blob `), erster.diffs[0]);
  assert.ok(!zweiter.gesamt.includes(UMBENANNT) && zeigtLoeschenUndNeu(zweiter.gesamt), zweiter.gesamt);
});

test("eine neue Datei in einem Ordner mit dem Namen des alten Pfads steht neben der Umbenennungszeile als Patch", (context) => {
  const repo = probeRepo(context, { "src/a": "export const A = 1;\n" });
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.git(["mv", "src/a", "src/b"]);
  repo.committe({ "src/a/neu.js": "export const NEU = 1;\n" }, "Benenne a um, lege a/neu.js an\n");
  const [{ diffs, gesamt }] = arbeitsordnerAllerCommits(context, repo, basis);
  for (const text of [diffs.join(""), gesamt]) {
    assert.ok(text.includes(`${UMBENANNT}: "src/a" → "src/b"`), text);
    assert.ok(text.includes("+export const NEU = 1;"), text);
  }
});

const KEIN_UTF8 = Buffer.from([0xff]);
const COMMIT_EINSTELLUNGEN = [
  "-c", "user.name=Probe",
  "-c", "user.email=probe@invalid",
  "-c", "commit.gpgsign=false",
  "-c", "core.hooksPath=/dev/null",
];

function gitMitEingabe(repo, args, input) {
  const lauf = spawnSync("git", args, { cwd: repo.ordner, env: isolatedEnvironment(), input, encoding: "utf8" });
  assert.equal(lauf.status, 0, `git ${args[0]}: ${lauf.stderr}`);
  return lauf.stdout.trim();
}

test("steht neben einer Umbenennung ein Pfad, der kein UTF-8 ist, wird nichts verkürzt und die Datei fehlt nicht im Gesamt-Patch", (context) => {
  const repo = probeRepo(context, { "src/a.js": "export const A = 1;\n" });
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.git(["mv", "src/a.js", "src/b.js"]);
  const blob = gitMitEingabe(repo, ["hash-object", "-w", "--stdin"], "export const VERSTECKT = 1;\n");
  const eintrag = Buffer.concat([Buffer.from(`100644 ${blob}\tsrc/`), KEIN_UTF8, Buffer.from(".js\n")]);
  gitMitEingabe(repo, ["update-index", "--index-info"], eintrag);
  repo.git([...COMMIT_EINSTELLUNGEN, "commit", "-q", "-m", "Benenne a um\n"]);
  const [{ diffs, gesamt }] = arbeitsordnerAllerCommits(context, repo, basis);
  assert.ok(gesamt.includes("+export const VERSTECKT = 1;") && !gesamt.includes(UMBENANNT), gesamt);
  assert.ok(!diffs.join("").includes(UMBENANNT), diffs.join(""));
});
