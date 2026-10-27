import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";

import { gleichwertigGemeldet } from "../../tools/auftrag/gleichwertig.mjs";
import { mutationInCi, ohneSchreibrecht } from "../../tools/mutationspruefung/in-ci.mjs";
import { jsonZeilenAus } from "../_iel-messbaum.mjs";
import { werkzeug } from "./mutationspruefung-probe.js";
import { commitAll, probeDirectory, probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";

const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const AUSFUEHRBAR = 0o755;
const REPO = "probe/repo";
const LAUF = "4711";
const LAUF_URL = `https://github.com/${REPO}/actions/runs/${LAUF}`;
const FERTIG_ROT = { status: "completed", conclusion: "failure" };
const FERTIG_GRUEN = { status: "completed", conclusion: "success" };
const LAEUFT = { status: "in_progress", conclusion: "" };
const KURZE_ZEITEN = { taktMs: 5, hoechstMs: 60, suchabstandMs: 1 };
const MEHRERE_ABFRAGEN = { taktMs: 5, hoechstMs: 1500, suchabstandMs: 1 };
const FRIST = { timeout: 20_000 };
const VOR_DEM_ABRUF_MS = -600_000;
const NACH_DEM_ABRUF_MS = 2000;
const NICHT_ERREICHBAR = "https://127.0.0.1:1/hermes.git";
const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const DATEIEN = {
  "package.json": '{ "type": "module" }\n',
  "src/rechnen.js": "export const doppelt = (zahl) => zahl * 2;\n",
  "alt.txt": "alt\n",
  "vorgemerkt.txt": "eins\n",
};
const GRUENES_URTEIL = "grün: keine geänderte Zeile unter src/\nZweck: Probe";
const ROTES_URTEIL = "Verstoß: Mutant überlebt: src/rechnen.js:1 ArithmeticOperator";
const ERSTLAUF_ROT = "Abbruch: Erstlauf rot: test/a.test.js › fall";
const LOG_FEHLGESCHLAGEN = [`Mutationsplan\tMutationsplan\t2026-10-27T10:00:00.1234567Z ${ERSTLAUF_ROT}`, "Mutationsplan\tMutationsplan\t2026-10-27T10:00:01.0000000Z npm error", ""].join("\n");
const GH_ATTRAPPE = [
  "#!/usr/bin/env node",
  'const { appendFileSync, cpSync, existsSync, readFileSync, writeFileSync } = require("node:fs");',
  'const { dirname, join } = require("node:path");',
  "const hier = dirname(process.argv[1]);",
  "const argumente = process.argv.slice(2);",
  "const datei = (name) => join(hier, name);",
  'const lies = (name) => (existsSync(datei(name)) ? readFileSync(datei(name), "utf8") : null);',
  'appendFileSync(datei("aufrufe.jsonl"), JSON.stringify({ argumente }) + "\\n");',
  'const befehl = argumente.slice(0, 2).join(" ");',
  'const nach = (option) => argumente[argumente.indexOf(option) + 1];',
  'if (befehl === "workflow run") process.stdout.write(lies("ausloesen.txt") ?? "");',
  'else if (befehl === "run list") process.stdout.write(lies("liste.json"));',
  'else if (befehl === "run view" && argumente.includes("--log-failed")) {',
  '  if (lies("log.txt") === null) process.exit(1);',
  '  process.stdout.write(lies("log.txt"));',
  '} else if (befehl === "run view") {',
  '  const staende = JSON.parse(lies("staende.json"));',
  '  const zaehler = Number(lies("zaehler.txt") ?? 0);',
  '  writeFileSync(datei("zaehler.txt"), String(zaehler + 1));',
  "  process.stdout.write(JSON.stringify(staende[Math.min(zaehler, staende.length - 1)]));",
  '} else if (befehl === "run download") {',
  '  if (!existsSync(datei("urteil")) || nach("-n") !== "mutationsurteil") process.exit(1);',
  '  cpSync(datei("urteil"), nach("-D"), { recursive: true });',
  '} else if (argumente[0] === "api") process.exit(Number(lies("api-exit.txt") ?? 0));',
  "else process.exit(9);",
  "",
].join("\n");

function setzeUmgebung(context, werte) {
  const vorher = Object.fromEntries(Object.keys(werte).map((name) => [name, env[name]]));
  Object.assign(env, werte);
  context.after(() => {
    for (const [name, alt] of Object.entries(vorher)) {
      if (alt === undefined) delete env[name];
      else env[name] = alt;
    }
  });
}

function git(repo, ...argumente) {
  const lauf = runIn(repo, "git", argumente);
  assert.equal(lauf.status, 0, `git ${argumente.join(" ")}: ${lauf.stderr}`);
  return lauf.stdout.trim();
}

function ghAttrappe(context, { staende = [FERTIG_GRUEN], urteil, log, ausloesen = `${LAUF_URL}\n`, liste }) {
  const ordner = probeDirectory(context, { gh: GH_ATTRAPPE, "aufrufe.jsonl": "", "staende.json": JSON.stringify(staende), "ausloesen.txt": ausloesen });
  chmodSync(join(ordner, "gh"), AUSFUEHRBAR);
  if (log !== undefined) writeFileSync(join(ordner, "log.txt"), log);
  if (liste !== undefined) writeFileSync(join(ordner, "liste.json"), JSON.stringify(liste));
  if (urteil !== undefined) {
    mkdirSync(join(ordner, "urteil"));
    writeFileSync(join(ordner, "urteil", "ausgabe.txt"), `${urteil.ausgabe}\n`);
    writeFileSync(join(ordner, "urteil", "exit-code"), `${urteil.exitCode}\n`);
  }
  setzeUmgebung(context, { PATH: `${ordner}${delimiter}${env.PATH}`, GITHUB_REPOSITORY: REPO });
  return ordner;
}

function ghAufrufe(ordner) {
  return jsonZeilenAus(readFileSync(join(ordner, "aufrufe.jsonl"), "utf8")).map(({ argumente }) => argumente);
}

function fall(context, antworten = {}) {
  const repo = probeRepository(context, DATEIEN);
  const basis = git(repo, "rev-parse", "HEAD");
  git(repo, "config", "user.name", "Probe");
  git(repo, "config", "user.email", "probe@example.invalid");
  const upstream = probeDirectory(context, {});
  git(upstream, "init", "-q", "--bare");
  git(repo, "remote", "add", "upstream", upstream);
  writeFileSync(join(repo, "src/rechnen.js"), "export const doppelt = (zahl) => zahl + zahl;\n");
  writeFileSync(join(repo, "neu.txt"), "neu und nicht vorgemerkt\n");
  writeFileSync(join(repo, "vorgemerkt.txt"), "zwei\n");
  git(repo, "add", "vorgemerkt.txt");
  rmSync(join(repo, "alt.txt"));
  return { repo, basis, upstream, gh: ghAttrappe(context, antworten) };
}

function gepushterStand(upstream) {
  const stand = git(upstream, "for-each-ref", "--format=%(objectname)", "refs/heads/lauf-mutation/");
  assert.match(stand, /^[0-9a-f]{40}$/);
  return stand;
}

function imCi({ repo, basis }, optionen = {}, zeiten = KURZE_ZEITEN) {
  return mutationInCi({ root: repo, basis, alterStand: false, gleichwertige: [], ...optionen }, zeiten);
}

test("Mutationsprüfung in der CI: ein grünes Urteil im Artefakt ergibt Exit 0, die Lauf-Zeile vorne und das Urteil unverändert", (context) => {
  const { repo, basis, upstream } = fall(context, { urteil: { ausgabe: GRUENES_URTEIL, exitCode: 0 } });
  const lauf = werkzeug(repo, basis, "--in-ci");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const [kopf, ...rest] = lauf.stdout.trimEnd().split("\n");
  assert.equal(kopf, `Mutationsprüfung in der CI: Lauf ${LAUF_URL}, Stand ${gepushterStand(upstream).slice(0, 12)}, Basis ${basis.slice(0, 12)}`);
  assert.equal(rest.join("\n"), GRUENES_URTEIL);
});

test("Mutationsprüfung in der CI: ein rotes Urteil mit überlebendem Mutanten ergibt Exit 1 und dieselbe Verstoß-Zeile", async (context) => {
  const probe = fall(context, { staende: [FERTIG_ROT], urteil: { ausgabe: ROTES_URTEIL, exitCode: EXIT_ROT } });
  const ergebnis = await imCi(probe);
  assert.equal(ergebnis.exitCode, EXIT_ROT);
  assert.equal(ergebnis.zeilen.at(-1), ROTES_URTEIL);
});

test("Mutationsprüfung in der CI: ein roter Lauf ohne Artefakt bricht mit Exit 2 ab und nennt die Abbruch-Zeilen ohne Job und Zeitstempel", async (context) => {
  const probe = fall(context, { staende: [FERTIG_ROT], log: LOG_FEHLGESCHLAGEN });
  const ergebnis = await imCi(probe);
  assert.equal(ergebnis.exitCode, EXIT_ABBRUCH);
  assert.deepEqual(ergebnis.zeilen.slice(1), [`Abbruch: Mutationsprüfung in der CI ohne Urteil: Lauf ${LAUF_URL} (completed, failure)`, ERSTLAUF_ROT]);
});

test("Mutationsprüfung in der CI: ein Artefakt mit einem Exit-Code außer 0, 1 und 2 gilt als fehlendes Urteil", async (context) => {
  const probe = fall(context, { urteil: { ausgabe: GRUENES_URTEIL, exitCode: 137 } });
  const ergebnis = await imCi(probe);
  assert.equal(ergebnis.exitCode, EXIT_ABBRUCH);
  assert.match(ergebnis.zeilen.join("\n"), /^Abbruch: Mutationsprüfung in der CI ohne Urteil: /m);
});

test("Mutationsprüfung in der CI: ein Lauf, der bis zur Höchstzeit nicht fertig ist, bricht mit Exit 2 ab", FRIST, async (context) => {
  const probe = fall(context, { staende: [LAEUFT], urteil: { ausgabe: GRUENES_URTEIL, exitCode: 0 } });
  const ergebnis = await imCi(probe, {}, MEHRERE_ABFRAGEN);
  assert.equal(ergebnis.exitCode, EXIT_ABBRUCH);
  assert.match(ergebnis.zeilen[1], /\(in_progress, \)$/);
  const abfragen = ghAufrufe(probe.gh).filter((argumente) => argumente[1] === "view" && !argumente.includes("--log-failed"));
  assert.ok(abfragen.length > 1, `${abfragen.length} Abfragen`);
});

test("Mutationsprüfung in der CI: der gepushte Stand ist der ganze Arbeitsbaum, Index, HEAD und Status bleiben unverändert", async (context) => {
  const probe = fall(context, { urteil: { ausgabe: GRUENES_URTEIL, exitCode: 0 } });
  const { repo, upstream } = probe;
  const vorher = { kopf: git(repo, "rev-parse", "HEAD"), index: git(repo, "diff", "--cached"), status: git(repo, "status", "--porcelain") };
  await imCi(probe);
  assert.deepEqual({ kopf: git(repo, "rev-parse", "HEAD"), index: git(repo, "diff", "--cached"), status: git(repo, "status", "--porcelain") }, vorher);
  const stand = gepushterStand(upstream);
  assert.equal(git(upstream, "rev-parse", `${stand}^`), vorher.kopf);
  assert.deepEqual(git(upstream, "ls-tree", "-r", "--name-only", stand).split("\n"), ["neu.txt", "package.json", "src/rechnen.js", "vorgemerkt.txt"]);
  for (const datei of ["neu.txt", "src/rechnen.js", "vorgemerkt.txt"]) assert.equal(`${git(upstream, "show", `${stand}:${datei}`)}\n`, readFileSync(join(repo, datei), "utf8"), datei);
});

test("Mutationsprüfung in der CI: gemeldete gleichwertige Mutanten stehen so in der Nachricht des gepushten Commits, dass das Urteil sie liest", async (context) => {
  const probe = fall(context, { urteil: { ausgabe: GRUENES_URTEIL, exitCode: 0 } });
  await imCi(probe, { gleichwertige: ["a b", "src/rechnen.js:1 ArithmeticOperator"] });
  const nachricht = git(probe.upstream, "log", "-1", "--format=%B", gepushterStand(probe.upstream));
  assert.match(nachricht, /^Auftrag: lauf\/in-ci$/m);
  assert.match(nachricht, /^Gleichwertig: a b, weil in lauf gemeldet$/m);
  assert.deepEqual(gleichwertigGemeldet(nachricht), ["a b", "src/rechnen.js:1 ArithmeticOperator"]);
});

test("Mutationsprüfung in der CI: der Abruf nennt die volle Basis und den alten Stand genau dann, wenn er verlangt ist", async (context) => {
  const probe = fall(context, { urteil: { ausgabe: GRUENES_URTEIL, exitCode: 0 } });
  await imCi({ ...probe, basis: probe.basis.slice(0, 7) });
  await imCi(probe, { alterStand: true });
  const abrufe = ghAufrufe(probe.gh).filter((argumente) => argumente.slice(0, 2).join(" ") === "workflow run");
  assert.equal(abrufe.length, 2);
  for (const abruf of abrufe) {
    assert.equal(abruf[abruf.indexOf("-f") + 1], `basis=${probe.basis}`);
    assert.match(abruf[abruf.indexOf("--ref") + 1], /^lauf-mutation\/[0-9a-f]{12}$/);
  }
  assert.ok(!abrufe[0].includes("alter_stand=true"));
  assert.ok(abrufe[1].includes("alter_stand=true"));
});

test("Mutationsprüfung in der CI: der Wegwerf-Branch wird auch nach einem Abbruch gelöscht", async (context) => {
  const probe = fall(context, { staende: [FERTIG_ROT], log: LOG_FEHLGESCHLAGEN });
  const ergebnis = await imCi(probe);
  assert.equal(ergebnis.exitCode, EXIT_ABBRUCH);
  const zweig = `lauf-mutation/${gepushterStand(probe.upstream).slice(0, 12)}`;
  assert.deepEqual(ghAufrufe(probe.gh).at(-1), ["api", "-X", "DELETE", `repos/${REPO}/git/refs/heads/${zweig}`]);
});

test("Mutationsprüfung in der CI: ohne Lauf-Adresse vom Abruf gilt der neueste Lauf des Branches, der nach dem Abruf angelegt wurde", async (context) => {
  const jetzt = Date.now();
  const liste = [
    { databaseId: 1, createdAt: new Date(jetzt + VOR_DEM_ABRUF_MS).toISOString() },
    { databaseId: Number(LAUF), createdAt: new Date(jetzt + NACH_DEM_ABRUF_MS).toISOString() },
  ];
  const probe = fall(context, { ausloesen: "", liste, urteil: { ausgabe: GRUENES_URTEIL, exitCode: 0 } });
  const ergebnis = await imCi(probe);
  assert.equal(ergebnis.exitCode, 0);
  assert.match(ergebnis.zeilen[0], new RegExp(`Lauf ${LAUF_URL}, `));
});

test("Mutationsprüfung in der CI: --in-ci zusammen mit einer anderen Betriebsart oder ohne Basis bricht mit dem Aufruftext ab", (context) => {
  const { repo, basis, gh } = fall(context);
  const andere = [["--plan", "x"], ["--teil", "1", "--teile", "1", "--ergebnis", "x"], ["--urteil", "x"], ["--testumbau"], ["--vorher-aus-ci", "1"], ["--tests", "a", "--vorher-plan", "x"]];
  for (const argumente of andere) {
    const lauf = werkzeug(repo, basis, "--in-ci", ...argumente);
    assert.equal(lauf.status, EXIT_ABBRUCH, argumente.join(" "));
    assert.match(lauf.stderr, /--in-ci/, argumente.join(" "));
  }
  const ohneBasis = runIn(repo, process.execPath, [WERKZEUG, "--in-ci"]);
  assert.equal(ohneBasis.status, EXIT_ABBRUCH);
  assert.deepEqual(ghAufrufe(gh), []);
});

test("Mutationsprüfung in der CI: der Weg über die CI nimmt keine Sperre für schwere Läufe", (context) => {
  const { repo, basis } = fall(context, { urteil: { ausgabe: GRUENES_URTEIL, exitCode: 0 } });
  const sperrdatei = join(probeDirectory(context, {}), "sperre");
  setzeUmgebung(context, { SCHWERLAUF_SPERRDATEI: sperrdatei });
  const lauf = werkzeug(repo, basis, "--in-ci");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(existsSync(sperrdatei), false);
});

test("Mutationsprüfung in der CI: wird der Push abgelehnt, läuft die Prüfung lokal und nennt den Grund", (context) => {
  const { repo, basis, gh } = fall(context, { urteil: { ausgabe: ROTES_URTEIL, exitCode: EXIT_ROT } });
  git(repo, "checkout", "-q", "--", "src/rechnen.js");
  git(repo, "remote", "set-url", "upstream", join(repo, "gibt-es-nicht"));
  commitAll(repo, "Ohne Quelländerung");
  const lauf = werkzeug(repo, basis, "--in-ci");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Hinweis: Mutationsprüfung läuft lokal, weil der Push nach upstream abgelehnt wurde: .+$/m);
  assert.match(lauf.stdout, /^grün: keine geänderte Zeile unter src\//m);
  assert.deepEqual(ghAufrufe(gh), []);
});

test("Mutationsprüfung in der CI: scheitert der Push ohne Hinweis auf fehlendes Schreibrecht, bricht sie mit Exit 2 ab statt lokal zu prüfen", (context) => {
  const { repo, basis, gh } = fall(context, { urteil: { ausgabe: GRUENES_URTEIL, exitCode: 0 } });
  git(repo, "remote", "set-url", "upstream", NICHT_ERREICHBAR);
  const lauf = werkzeug(repo, basis, "--in-ci");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /^Abbruch: git push nach upstream endete mit Exit \d+ ohne Hinweis auf fehlendes Schreibrecht: /m);
  assert.doesNotMatch(lauf.stdout, /läuft lokal/);
  assert.deepEqual(ghAufrufe(gh), []);
});

const PUSH_MELDUNGEN = [
  ["remote: Permission to sundartha/hermes.git denied to jemand. / fatal: unable to access 'https://github.com/sundartha/hermes.git/': The requested URL returned error: 403", true],
  ["fatal: Authentication failed for 'https://github.com/sundartha/hermes.git/'", true],
  ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", true],
  ["remote: Repository not found. / fatal: repository 'https://github.com/fork/hermes.git/' not found", true],
  ["fatal: 'upstream' does not appear to be a git repository", true],
  [" ! [remote rejected] 0123456789ab -> lauf-mutation/0123456789ab (permission denied)", true],
  [" ! [remote rejected] 0123456789ab -> lauf-mutation/0123456789ab (pre-receive hook declined)", true],
  [" ! [remote rejected] 0123456789ab -> lauf-mutation/0123456789ab (failed to update ref)", false],
  ["fatal: unable to access 'https://github.com/sundartha/hermes.git/': Could not resolve host: github.com", false],
  ["fatal: unable to access 'https://127.0.0.1:1/hermes.git/': Failed to connect to 127.0.0.1 port 1", false],
  ["error: RPC failed; HTTP 500 curl 22 The requested URL returned error: 500", false],
];

test("Mutationsprüfung in der CI: nur Push-Meldungen über fehlendes Schreibrecht führen auf den lokalen Weg", () => {
  for (const [meldung, lokal] of PUSH_MELDUNGEN) assert.equal(ohneSchreibrecht(meldung), lokal, meldung);
});
