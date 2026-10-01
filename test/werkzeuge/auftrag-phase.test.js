import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as schlafen } from "node:timers/promises";

import { verwaisteSperren } from "../../tools/auftrag/sperren.mjs";
import { ESLINT_BIN, REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const LINT_FEHLER = "export const WERT = nichtDefiniert;\n";
const ABFRAGE_MS = 50;
const FRIST_MS = 60_000;
const ISSUE = { erste: 77, gleich: 78, importiert: 79, frei: 80, rot: 81, abgelehnt: 82, lint: 83, umbau: 85 };

const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
const name = basename(process.cwd());
const ort = dirname(process.env.ERSATZ_DREHBUCH);
const rolle = process.env.HERMES_ROLLE;
const eintrag = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"))[name] ?? {};
const zaehler = join(ort, "anzahl-" + name + "-" + rolle);
const nummer = existsSync(zaehler) ? Number(readFileSync(zaehler, "utf8")) : 0;
writeFileSync(zaehler, String(nummer + 1));
const liste = eintrag[rolle] ?? [eintrag];
const { dateien = {}, warteAuf, antwort = "fertig" } = liste[Math.min(nummer, liste.length - 1)];
const marke = (wer) => join(ort, "start-" + wer);
for (const [pfad, inhalt] of Object.entries(dateien)) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}
writeFileSync(marke(name), "");
const frist = Date.now() + 20000;
while (warteAuf && !existsSync(marke(warteAuf)) && Date.now() < frist) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
const zeige = (ereignis) => process.stdout.write(JSON.stringify(ereignis) + "\\n");
zeige({ type: "result", result: antwort });
process.exitCode = warteAuf && !existsSync(marke(warteAuf)) ? 1 : 0;
`;

const BASIS = {
  "package.json": JSON.stringify({
    name: "probe",
    type: "module",
    scripts: { test: "node --test", lint: "node -e 0", "test:betroffen": "node -e 0 --", pruefleiter: "node -e 0 --" },
  }),
  "package-lock.json": JSON.stringify({ name: "probe", lockfileVersion: 3, requires: true, packages: { "": { name: "probe" } } }),
  ".gitignore": ".fortschritt/\n.claude/worktrees/\nnode_modules/\n.env\n.env.test\n",
  "src/store/a.js": "export const WERT = 1;\n",
  "src/c.js": 'import { WERT } from "./store/a.js";\nexport const KOPIE = WERT;\n',
  "src/d.js": "export const WERT = 1;\n",
  "test/ok.test.js": 'import { test } from "node:test";\ntest("ok", () => {});\n',
};

function auftrag(id, bereich, dateien = [bereich]) {
  return { id, art: "umbau", ziel: `Baue ${id}`, bereich, erwarteteDateien: dateien, vorbild: "src/d.js", abnahme: "test/ok.test.js" };
}

function aufbau(context, drehbuch) {
  const remote = probeDirectory(context, {});
  runIn(remote, "git", ["init", "-q", "--bare"]);
  const repo = probeRepository(context, BASIS);
  runIn(repo, "git", ["config", "user.name", "Probe"]);
  runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
  runIn(repo, "git", ["remote", "add", "upstream", remote]);
  runIn(repo, "git", ["push", "-q", "upstream", "HEAD:master"]);
  const werkzeug = probeDirectory(context, { "claude.mjs": ERSATZ_CLAUDE, "drehbuch.json": JSON.stringify(drehbuch) });
  chmodSync(join(werkzeug, "claude.mjs"), AUSFUEHRBAR);
  return { repo, remote, werkzeug };
}

function phase({ repo, werkzeug }, [name, issue, ...auftraege]) {
  const datei = join(werkzeug, `${name}.json`);
  const entwurf = Object.fromEntries(auftraege.map(({ bereich }) => [bereich, "Entwurf."]));
  writeFileSync(datei, JSON.stringify({ phase: name, issue, entwurf, auftraege }));
  const umgebung = { HOME: werkzeug, HERMES_CLAUDE: join(werkzeug, "claude.mjs"), HERMES_SPERRE_WARTEN_MS: "100" };
  const env = { ...isolatedEnvironment(), ...umgebung, ERSATZ_DREHBUCH: join(werkzeug, "drehbuch.json") };
  return spawn(process.execPath, [EINSTIEG, "phase", datei], { cwd: repo, env });
}

function ende(kind, abbrechenBei = () => false) {
  let ausgabe = "";
  const lies = (stueck) => {
    ausgabe += stueck;
    if (abbrechenBei(ausgabe)) kind.kill();
  };
  kind.stdout.on("data", lies);
  kind.stderr.on("data", lies);
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

function liste(cwd, args) {
  return runIn(cwd, "git", args).stdout.split("\n").filter(Boolean);
}

test("zwei Aufträge laufen gleichzeitig in eigenen Worktrees und landen als zwei Commits in fester Reihenfolge", async (context) => {
  const probe = aufbau(context, {
    "77-A1": { warteAuf: "77-A2", dateien: { "src/store/a.js": "export const A = 2;\n", "src/store/z.js": "eins\n" } },
    "77-A2": { warteAuf: "77-A1", dateien: { "src/store/b.js": "export const B = 2;\n", "src/store/z.js": "zwei\n" } },
  });
  const { code, ausgabe } = await ende(phase(probe, ["a", ISSUE.erste, auftrag("A1", "src/store/", ["src/store/a.js"]), auftrag("A2", "src/store/", ["src/store/b.js"])]));
  assert.equal(code, 0, ausgabe);
  const commits = ["phase/77-a~1", "phase/77-a"].map((rev) => liste(probe.remote, ["show", "--name-only", "--format=", rev]).sort());
  assert.deepEqual(commits, [["src/store/a.js", "src/store/z.js"], ["src/store/b.js", "src/store/z.js"]]);
  assert.equal(runIn(probe.remote, "git", ["rev-list", "--count", "master..phase/77-a"]).stdout.trim(), "2");
  assert.equal(JSON.parse(readFileSync(join(probe.repo, ".fortschritt/a/A2.json"), "utf8")).neustarts, 1);
  assert.equal(liste(probe.repo, ["worktree", "list"]).length, 1);
});

test("ein Auftrag, der nach „Voraussetzung fehlt“ einen Umbau-Commit mitbringt, landet mit beiden Commits in der Phase", async (context) => {
  const umbau = { ziel: "Lege e an", bereich: "src/e.js", erwarteteDateien: ["src/e.js"], vorbild: "src/d.js", abnahme: "test/ok.test.js", entwurf: "E anlegen." };
  const probe = aufbau(context, {
    "85-V1": {
      plan: [{ antwort: JSON.stringify(umbau) }],
      bau: [
        { antwort: "Voraussetzung fehlt: Es braucht zuerst src/e.js." },
        { dateien: { "src/e.js": "export const E = 1;\n" } },
        { dateien: { "src/d.js": 'export { E as WERT } from "./e.js";\n' } },
      ],
    },
  });
  const { code, ausgabe } = await ende(phase(probe, ["v", ISSUE.umbau, auftrag("V1", "src/d.js")]));
  assert.equal(code, 0, ausgabe);
  assert.deepEqual(liste(probe.remote, ["log", "--format=%s", "master..phase/85-v"]), ["Baue V1", "Lege e an"]);
});

test("eine zweite Phase im selben Bereich wartet und nennt die Phase, auf die sie wartet", async (context) => {
  const probe = aufbau(context, {
    "77-A1": { dateien: { "src/store/a.js": "export const WERT = 2;\n" } },
    "80-D1": { dateien: { "src/d.js": "export const WERT = 2;\n" } },
  });
  const erste = await ende(phase(probe, ["a", ISSUE.erste, auftrag("A1", "src/store/")]));
  assert.equal(erste.code, 0, erste.ausgabe);
  for (const [name, issue, bereich] of [["b", ISSUE.gleich, "src/store/"], ["c", ISSUE.importiert, "src/c.js"]]) {
    const { ausgabe } = await ende(phase(probe, [name, issue, auftrag("B1", bereich)]), (text) => text.includes("wartet auf"));
    assert.match(ausgabe, new RegExp(`Phase ${name} wartet auf Phase a \\(Sperre src/store\\)`));
  }
  const unabhaengig = await ende(phase(probe, ["d", ISSUE.frei, auftrag("D1", "src/d.js")]));
  assert.equal(unabhaengig.code, 0, unabhaengig.ausgabe);
  runIn(probe.repo, "git", ["push", "-q", "upstream", "phase/77-a:master"]);
  const aufgeraeumt = spawnSync(process.execPath, [EINSTIEG, "aufraeumen"], { cwd: probe.repo, encoding: "utf8", env: isolatedEnvironment() });
  assert.equal(aufgeraeumt.status, 0, aufgeraeumt.stderr);
  assert.deepEqual(liste(probe.remote, ["for-each-ref", "--format=%(refname)", "refs/sperren/"]), ["refs/sperren/src/d.js"]);
  assert.equal(liste(probe.repo, ["worktree", "list"]).length, 1);
});

test("ein roter Auftrag verwirft die Phase, sichert die Diffs und löst Sperren, Worktrees und Branches", async (context) => {
  const probe = aufbau(context, {
    "81-R1": { dateien: { "lib/fremd.js": "x\n" } },
    "81-R2": { dateien: { "src/c.js": "export const KOPIE = 2;\n" } },
  });
  const { code } = await ende(phase(probe, ["r", ISSUE.rot, auftrag("R1", "src/d.js"), auftrag("R2", "src/c.js")]));
  assert.equal(code, EXIT_ROT);
  const diffs = ["R1", "R2"].map((id) => JSON.parse(readFileSync(join(probe.repo, `.fortschritt/r/${id}.json`), "utf8")).diff);
  assert.match(diffs.join(""), /lib\/fremd\.js[\s\S]*KOPIE = 2/);
  assert.deepEqual(liste(probe.remote, ["for-each-ref", "refs/sperren/", "refs/heads/phase/"]), []);
  assert.deepEqual(liste(probe.repo, ["branch", "--list", "phase/*", "worktree-*"]), []);
  assert.equal(liste(probe.repo, ["worktree", "list"]).length, 1);
});

test("ein abgelehnter Sperr-Push bricht die Phase mit Grund ab, statt endlos zu warten", { timeout: FRIST_MS }, async (context) => {
  const probe = aufbau(context, {});
  writeFileSync(join(probe.remote, "hooks/pre-receive"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(probe.remote, "hooks/pre-receive"), AUSFUEHRBAR);
  const { code, ausgabe } = await ende(phase(probe, ["h", ISSUE.abgelehnt, auftrag("H1", "src/d.js")]));
  assert.equal(code, EXIT_ROT);
  assert.match(ausgabe, /Die Sperren ließen sich nicht anlegen/);
  assert.equal(liste(probe.repo, ["worktree", "list"]).length, 1);
});

test("ein Worktree mit Lint-Fehler macht den Lint-Lauf im Haupt-Checkout nicht rot und bekommt nur .env.test", async (context) => {
  const probe = aufbau(context, { "83-L1": { warteAuf: "geprueft", dateien: { "src/d.js": LINT_FEHLER } } });
  writeFileSync(join(probe.repo, ".worktreeinclude"), `${readFileSync(join(REPO_ROOT, ".worktreeinclude"), "utf8")}.env\n`);
  for (const datei of [".env", ".env.test"]) writeFileSync(join(probe.repo, datei), "GEHEIM=1\n");
  copyFileSync(join(REPO_ROOT, "eslint.config.js"), join(probe.repo, "eslint.config.js"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(probe.repo, "node_modules"));
  const lauf = ende(phase(probe, ["l", ISSUE.lint, auftrag("L1", "src/d.js")]));
  const gestartet = join(probe.werkzeug, "start-83-L1");
  while (!existsSync(gestartet)) await Promise.race([lauf, schlafen(ABFRAGE_MS)]);
  const lint = () => spawnSync(process.execPath, [ESLINT_BIN, "."], { cwd: probe.repo, encoding: "utf8" });
  const imHauptCheckout = lint();
  assert.equal(imHauptCheckout.status, 0, imHauptCheckout.stdout);
  const worktree = join(probe.repo, ".claude/worktrees/phase-83-l/.claude/worktrees/83-L1");
  assert.deepEqual([".env.test", ".env", "src/d.js"].map((datei) => existsSync(join(worktree, datei))), [true, false, true]);
  writeFileSync(join(probe.repo, "src/d.js"), LINT_FEHLER);
  assert.equal(lint().status, EXIT_ROT);
  writeFileSync(join(probe.werkzeug, "start-geprueft"), "");
  assert.equal((await lauf).code, 0);
});

test("systemstand meldet eine Sperre, deren Phasen-Issue geschlossen ist", async () => {
  const antworten = {
    "/git/matching-refs/sperren/": [
      { ref: "refs/sperren/src/store", object: { sha: "s1" } },
      { ref: "refs/sperren/src/d.js", object: { sha: "s2" } },
    ],
    "/git/commits/s1": { message: "Sperre für Phase a (Issue #77)" },
    "/git/commits/s2": { message: "Sperre für Phase d (Issue #80)" },
    "/issues/77": { state: "closed" },
    "/issues/80": { state: "open" },
  };
  const remote = { get: async (pfad) => antworten[pfad], optional: async (pfad) => antworten[pfad] };
  assert.deepEqual(await verwaisteSperren(remote), ["Sperre src/store ohne laufende Phase: Sperre für Phase a (Issue #77)"]);
});
