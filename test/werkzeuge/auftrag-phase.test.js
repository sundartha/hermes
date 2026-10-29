import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as schlafen } from "node:timers/promises";

import { verwaisteSperren } from "../../tools/auftrag/sperren.mjs";
import { MELDUNG, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { CI_LOKAL_ROT, ciLokalAufrufe, mitCiLokal, mitErsatzWerkzeugen } from "./ersatz-werkzeuge.js";
import { ESLINT_BIN, REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const LINT_FEHLER = "export const WERT = nichtDefiniert;\n";
const ABFRAGE_MS = 50;
const FRIST_MS = 60_000;
const FREIRAUM_MS = 1500;
const PARALLEL_FRIST_MS = 180_000;
const ERSATZ_FRIST_MS = 90_000;
const SPEICHER_ATTRAPPE = {
  "src/store.js": "export const WERT = 1;\n",
  "src/store/json.js": "export const WERT = 1;\n",
  "src/store/pg.js": "export function makePgStore() {\n  return { WERT: 1 };\n}\n",
};
const ISSUE = { erste: 77, gleich: 78, importiert: 79, frei: 80, rot: 81, abgelehnt: 82, lint: 83, limit: 84, umbau: 85, ciGruen: 86, ciRot: 87, gleichzeitig: 88, nachbarn: 89, testdatei: 90, ausserhalb: 91, deckel: 92 };
const LIMIT_SEKUNDEN = 2;
const VOLLER_KONTEXT = { type: "assistant", message: { usage: { input_tokens: 100_000 }, content: [] } };

const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
const name = basename(process.cwd());
const ort = dirname(process.env.ERSATZ_DREHBUCH);
const rolle = process.env.HERMES_ROLLE;
const eintrag = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"))[name] ?? {};
const zaehler = join(ort, "anzahl-" + name + "-" + rolle);
const nummer = existsSync(zaehler) ? Number(readFileSync(zaehler, "utf8")) : 0;
writeFileSync(zaehler, String(nummer + 1));
const liste = eintrag[rolle] ?? [eintrag];
const { dateien = {}, warteAuf, zeilen = [], antwort = "fertig", limit } = liste[Math.min(nummer, liste.length - 1)];
const marke = (wer) => join(ort, "start-" + wer);
appendFileSync(join(ort, "starts.txt"), name + " " + Date.now() + "\\n");
for (const [pfad, inhalt] of Object.entries(dateien)) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}
writeFileSync(marke(name), "");
const frist = Date.now() + Number(process.env.ERSATZ_FRIST_MS ?? 20000);
while (warteAuf && !existsSync(marke(warteAuf)) && Date.now() < frist) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
const zeige = (ereignis) => process.stdout.write(JSON.stringify(ereignis) + "\\n");
zeilen.forEach(zeige);
if (limit) zeige({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.ceil(Date.now() / 1000) + limit } });
zeige({ type: "result", is_error: Boolean(limit), result: limit ? "Usage limit reached" : antwort });
process.exitCode = limit || (warteAuf && !existsSync(marke(warteAuf))) ? 1 : 0;
`;

const BASIS = {
  "package.json": JSON.stringify({
    name: "probe",
    type: "module",
    scripts: { test: "node --test", lint: "node -e 0", "test:betroffen": "node -e 0 --", pruefleiter: "node -e 0 --", "ci:lokal": "node -e 0 --" },
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

function aufbau(context, drehbuch, dateien = {}) {
  const remote = probeDirectory(context, {});
  runIn(remote, "git", ["init", "-q", "--bare"]);
  const repo = probeRepository(context, { ...BASIS, ...dateien });
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
  const umgebung = { HOME: werkzeug, HERMES_CLAUDE: join(werkzeug, "claude.mjs"), HERMES_SPERRE_WARTEN_MS: "100", ERSATZ_FRIST_MS: String(ERSATZ_FRIST_MS), ...mitErsatzWerkzeugen(werkzeug) };
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

async function warteAufZeile(lauf, datei, muster) {
  let beendet = false;
  lauf.then(() => {
    beendet = true;
  });
  for (;;) {
    const treffer = existsSync(datei) ? muster.exec(readFileSync(datei, "utf8")) : null;
    if (treffer !== null || beendet) return treffer;
    await schlafen(ABFRAGE_MS);
  }
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
      plan: [{ antwort: ["```json", JSON.stringify(umbau), "```"].join("\n") }],
      test: [{ dateien: { "test/d.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { WERT } from "../src/d.js";\ntest("zwei", () => assert.equal(WERT, 2));\n' } }],
      bau: [
        { antwort: "Voraussetzung fehlt: Es braucht zuerst src/e.js." },
        { dateien: { "src/e.js": "export const E = 2;\n" } },
        { dateien: { "src/d.js": 'export { E as WERT } from "./e.js";\n' } },
      ],
    },
  });
  const funktion = { ...auftrag("V1", "src/d.js", ["src/d.js", "test/d.test.js"]), art: "funktion", abnahme: "test/d.test.js", erwarteterFehler: "1 !== 2", wasDarfNiePassieren: [] };
  const { code, ausgabe } = await ende(phase(probe, ["v", ISSUE.umbau, funktion]));
  assert.equal(code, 0, ausgabe);
  assert.deepEqual(liste(probe.remote, ["log", "--format=%s", "master..phase/85-v"]), ["Baue V1", "Lege e an"]);
});

test("ein Nutzungslimit hält auch den nächsten Agenten eines parallelen Auftrags bis zur Freigabe an", { timeout: FRIST_MS }, async (context) => {
  const probe = aufbau(context, {
    "84-G1": { bau: [{ limit: LIMIT_SEKUNDEN }, { dateien: { "src/d.js": "export const WERT = 2;\n" } }] },
    "84-G2": { bau: [{ warteAuf: "gesperrt", zeilen: [VOLLER_KONTEXT] }, { dateien: { "src/c.js": "export const KOPIE = 2;\n" } }] },
  });
  const lauf = ende(phase(probe, ["g", ISSUE.limit, auftrag("G1", "src/d.js"), auftrag("G2", "src/c.js")]));
  const meldung = await warteAufZeile(lauf, join(probe.repo, ".fortschritt/g/G1.log"), /^Auftrag G1: Nutzungslimit erreicht; .* ab (\S+) und/m);
  writeFileSync(join(probe.werkzeug, "start-gesperrt"), "");
  const { code, ausgabe } = await lauf;
  assert.ok(meldung, `G1 meldet das Nutzungslimit nicht sofort:\n${ausgabe}`);
  assert.equal(code, 0, ausgabe);
  const starts = readFileSync(join(probe.werkzeug, "starts.txt"), "utf8").split("\n").filter((zeile) => zeile.startsWith("84-G2 "));
  const [freigabe, naechsterStart] = [Date.parse(meldung[1]), Number(starts.at(-1).split(" ")[1])];
  assert.ok(naechsterStart >= freigabe, `G2 startete einen Agenten ${freigabe - naechsterStart} ms vor der Freigabe`);
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
  cpSync(join(REPO_ROOT, "tools/eslint-rules"), join(probe.repo, "tools/eslint-rules"), { recursive: true });
  writeFiles(probe.repo, SPEICHER_ATTRAPPE);
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

test("phase fährt ci-lokal einmal nach dem letzten Auftrag auf dem Phasen-Branch gegen master, nicht in jedem Auftrag", async (context) => {
  const drehbuch = { "86-C1": { dateien: { "src/d.js": "export const WERT = 2;\n" } }, "86-C2": { dateien: { "src/c.js": "export const KOPIE = 2;\n" } } };
  const probe = aufbau(context, drehbuch, mitCiLokal(BASIS["package.json"], 0));
  const master = runIn(probe.repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const { code, ausgabe } = await ende(phase(probe, ["c", ISSUE.ciGruen, auftrag("C1", "src/d.js"), auftrag("C2", "src/c.js")]));
  assert.equal(code, 0, ausgabe);
  assert.deepEqual(ciLokalAufrufe(probe.werkzeug), [["--basis", master]]);
  assert.equal(runIn(probe.remote, "git", ["rev-list", "--count", "master..phase/86-c"]).stdout.trim(), "2");
});

test("ist ci-lokal am Ende der Phase rot, lädt phase nichts hoch, behält den Phasen-Branch lokal mit dem Auftrag und nennt die roten Schritte mit Zweck", async (context) => {
  const probe = aufbau(context, { "87-D1": { dateien: { "src/d.js": "export const WERT = 2;\n" } } }, mitCiLokal(BASIS["package.json"], 1));
  const { code, ausgabe } = await ende(phase(probe, ["d", ISSUE.ciRot, auftrag("D1", "src/d.js")]));
  assert.equal(code, EXIT_ROT, ausgabe);
  assert.ok(ausgabe.includes(CI_LOKAL_ROT), ausgabe);
  assert.ok(ausgabe.includes(zweckBlock(MELDUNG.CI_LOKAL).join("\n")), ausgabe);
  assert.equal(ciLokalAufrufe(probe.werkzeug).length, 1);
  assert.deepEqual(liste(probe.remote, ["for-each-ref", "refs/heads/phase/", "refs/sperren/"]), []);
  assert.ok(ausgabe.includes("phase/87-d bleibt lokal"), ausgabe);
  assert.equal(runIn(probe.repo, "git", ["rev-list", "--count", "HEAD..phase/87-d"]).stdout.trim(), "1");
});

function quelleM(eins, zwei, drei) {
  return [eins, zwei, drei].map((wert, index) => `export function ${["eins", "zwei", "drei"][index]}() {\n  return ${wert};\n}\n`).join("\n");
}

const NACHBARN = "export const NA = 1;\nexport const NB = 1;\n";
const TESTDATEI_ZEILEN = Array.from({ length: 12 }, (leer, index) => `test("t${index}", () => {});\n`);

function testQuelle(ersetzt = {}) {
  const kopf = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\n';
  return kopf + TESTDATEI_ZEILEN.map((zeile, index) => `\n${ersetzt[index] ?? zeile}`).join("");
}

function wertTest(name, datei) {
  return `test("t-${name}", async () => {\n  const modul = await import("../src/${datei}.js");\n  assert.equal(modul.${name}, 2);\n});\n`;
}

function mitBetrifft(einzel, betrifft) {
  return { ...einzel, betrifft };
}

async function warteAufStarts(probe, namen) {
  const datei = join(probe.werkzeug, "starts.txt");
  const vollstaendig = () => existsSync(datei) && namen.every((name) => readFileSync(datei, "utf8").includes(`${name} `));
  while (!vollstaendig()) await schlafen(ABFRAGE_MS);
}

function startsVon(probe, name) {
  const datei = join(probe.werkzeug, "starts.txt");
  return existsSync(datei) ? readFileSync(datei, "utf8").split("\n").filter((zeile) => zeile.startsWith(`${name} `)) : [];
}

test("zwei Aufträge mit betrifft an verschiedenen Deklarationen derselben Datei laufen gleichzeitig und landen beide", { timeout: PARALLEL_FRIST_MS }, async (context) => {
  const probe = aufbau(
    context,
    {
      "88-G1": { warteAuf: "88-G2", dateien: { "src/m.js": quelleM(10, 2, 3) } },
      "88-G2": { warteAuf: "88-G1", dateien: { "src/m.js": quelleM(1, 2, 30) } },
    },
    { "src/m.js": quelleM(1, 2, 3) },
  );
  const eins = mitBetrifft(auftrag("G1", "src/m.js"), { "src/m.js": ["eins"] });
  const drei = mitBetrifft(auftrag("G2", "src/m.js"), { "src/m.js": ["drei"] });
  const { code, ausgabe } = await ende(phase(probe, ["g", ISSUE.gleichzeitig, eins, drei]));
  assert.equal(code, 0, ausgabe);
  assert.equal(runIn(probe.remote, "git", ["show", "phase/88-g:src/m.js"]).stdout, quelleM(10, 2, 30));
  assert.equal(JSON.parse(readFileSync(join(probe.repo, ".fortschritt/g/G2.json"), "utf8")).neustarts, 0);
});

test("zwei Aufträge ohne betrifft in derselben Datei laufen nacheinander", { timeout: PARALLEL_FRIST_MS }, async (context) => {
  const probe = aufbau(
    context,
    { "88-S1": { dateien: { "src/m.js": quelleM(10, 2, 3) } }, "88-S2": { dateien: { "src/m.js": quelleM(11, 2, 30) } } },
    { "src/m.js": quelleM(1, 2, 3) },
  );
  const { code, ausgabe } = await ende(phase(probe, ["s", ISSUE.gleichzeitig, auftrag("S1", "src/m.js"), auftrag("S2", "src/m.js")]));
  assert.equal(code, 0, ausgabe);
  assert.equal(runIn(probe.remote, "git", ["show", "phase/88-s:src/m.js"]).stdout, quelleM(11, 2, 30));
  assert.equal(JSON.parse(readFileSync(join(probe.repo, ".fortschritt/s/S2.json"), "utf8")).neustarts, 0);
});

test("stoßen zwei Aufträge mit betrifft an benachbarten Zeilen aneinander, baut der spätere auf dem zusammengeführten Stand neu", { timeout: PARALLEL_FRIST_MS }, async (context) => {
  const probe = aufbau(
    context,
    {
      "89-N1": { warteAuf: "89-N2", dateien: { "src/n.js": "export const NA = 2;\nexport const NB = 1;\n" } },
      "89-N2": {
        bau: [
          { warteAuf: "89-N1", dateien: { "src/n.js": "export const NA = 1;\nexport const NB = 2;\n" } },
          { dateien: { "src/n.js": "export const NA = 2;\nexport const NB = 2;\n" } },
        ],
      },
    },
    { "src/n.js": NACHBARN },
  );
  const erster = mitBetrifft(auftrag("N1", "src/n.js"), { "src/n.js": ["NA"] });
  const zweiter = mitBetrifft(auftrag("N2", "src/n.js"), { "src/n.js": ["NB"] });
  const { code, ausgabe } = await ende(phase(probe, ["n", ISSUE.nachbarn, erster, zweiter]));
  assert.equal(code, 0, ausgabe);
  assert.equal(JSON.parse(readFileSync(join(probe.repo, ".fortschritt/n/N2.json"), "utf8")).neustarts, 1);
  assert.equal(JSON.parse(readFileSync(join(probe.repo, ".fortschritt/n/N1.json"), "utf8")).neustarts, 0);
  assert.equal(runIn(probe.remote, "git", ["show", "phase/89-n:src/n.js"]).stdout, "export const NA = 2;\nexport const NB = 2;\n");
});

test("ändern zwei Aufträge dieselbe Testdatei an getrennten Zeilen, startet der spätere erst nach der Übernahme des früheren und baut nicht neu", { timeout: PARALLEL_FRIST_MS }, async (context) => {
  const erstesP = { 1: wertTest("P", "p") };
  const beide = { ...erstesP, 10: wertTest("Q", "q") };
  const probe = aufbau(
    context,
    {
      "90-T1": { test: [{ dateien: { "test/t.test.js": testQuelle(erstesP) } }], bau: [{ dateien: { "src/p.js": "export const P = 2;\n" } }] },
      "90-T2": {
        test: [{ dateien: { "test/t.test.js": testQuelle(beide) } }],
        bau: [{ dateien: { "src/q.js": "export const Q = 2;\n" } }],
      },
    },
    { "src/p.js": "export const P = 1;\n", "src/q.js": "export const Q = 1;\n", "test/t.test.js": testQuelle() },
  );
  const funktion = (id, datei) => ({ ...auftrag(id, datei, [datei, "test/t.test.js"]), art: "funktion", abnahme: "test/t.test.js", erwarteterFehler: "1 !== 2", wasDarfNiePassieren: [] });
  const { code, ausgabe } = await ende(phase(probe, ["t", ISSUE.testdatei, funktion("T1", "src/p.js"), funktion("T2", "src/q.js")]));
  assert.equal(code, 0, ausgabe);
  assert.doesNotMatch(ausgabe, /Neustart/);
  assert.equal(JSON.parse(readFileSync(join(probe.repo, ".fortschritt/t/T2.json"), "utf8")).neustarts, 0);
  assert.equal(runIn(probe.remote, "git", ["show", "phase/90-t:test/t.test.js"]).stdout, testQuelle(beide));
});

test("ändert ein Auftrag Zeilen außerhalb von betrifft, startet der nächste erst nach seiner Übernahme", { timeout: PARALLEL_FRIST_MS }, async (context) => {
  const probe = aufbau(
    context,
    {
      "91-X0": { warteAuf: "gesperrt", dateien: { "src/d.js": "export const WERT = 2;\n" } },
      "91-X1": { dateien: { "src/m.js": quelleM(10, 20, 3) } },
      "91-X2": { dateien: { "src/m.js": quelleM(10, 21, 3) } },
    },
    { "src/m.js": quelleM(1, 2, 3) },
  );
  const kind = phase(probe, ["x", ISSUE.ausserhalb, auftrag("X0", "src/d.js"), mitBetrifft(auftrag("X1", "src/m.js"), { "src/m.js": ["eins"] }), mitBetrifft(auftrag("X2", "src/m.js"), { "src/m.js": ["zwei"] })]);
  let gemeldet = false;
  const lauf = ende(kind, (text) => {
    gemeldet ||= text.includes("Auftrag X1: ändert Zeilen außerhalb von betrifft");
    return false;
  });
  while (!gemeldet) await Promise.race([lauf, schlafen(ABFRAGE_MS)]);
  await schlafen(FREIRAUM_MS);
  assert.deepEqual(startsVon(probe, "91-X2"), []);
  writeFileSync(join(probe.werkzeug, "start-gesperrt"), "");
  const { code, ausgabe } = await lauf;
  assert.equal(code, 0, ausgabe);
  assert.match(ausgabe, /Auftrag X1: ändert Zeilen außerhalb von betrifft \(src\/m\.js\)/);
  assert.equal(JSON.parse(readFileSync(join(probe.repo, ".fortschritt/x/X2.json"), "utf8")).neustarts, 0);
});

test("von drei unabhängigen Aufträgen laufen höchstens zwei zugleich", { timeout: PARALLEL_FRIST_MS }, async (context) => {
  const probe = aufbau(
    context,
    {
      "92-D1": { warteAuf: "gesperrt", dateien: { "src/d.js": "export const WERT = 2;\n" } },
      "92-D2": { warteAuf: "gesperrt", dateien: { "src/c.js": "export const KOPIE = 2;\n" } },
      "92-D3": { dateien: { "src/store/a.js": "export const WERT = 2;\n" } },
    },
    {},
  );
  const lauf = ende(phase(probe, ["d", ISSUE.deckel, auftrag("D1", "src/d.js"), auftrag("D2", "src/c.js"), auftrag("D3", "src/store/a.js")]));
  await warteAufStarts(probe, ["92-D1", "92-D2"]);
  await schlafen(FREIRAUM_MS);
  assert.deepEqual(startsVon(probe, "92-D3"), []);
  writeFileSync(join(probe.werkzeug, "start-gesperrt"), "");
  const { code, ausgabe } = await lauf;
  assert.equal(code, 0, ausgabe);
  assert.equal(startsVon(probe, "92-D3").length, 1);
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
