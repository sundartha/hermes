import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASIS, bisBeendet, EXIT_ABBRUCH, mitProtokoll, NEGATIV, NULL, PROTOKOLL, quelle, testdatei } from "./mutationspruefung-hilfen.js";
import { commitAll, outputLines, probeDirectory, probeRepository, REPO_ROOT, runIn, writeFiles } from "./probe-repo.js";
import { halter, starte, umgebung, WARTET, wartet, zeile } from "./schwerlauf-lauf.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const EINE_SEKUNDE = fileURLToPath(new URL("mutationspruefung-budget-ersatz.mjs", import.meta.url));
const HAENGER = fileURLToPath(new URL("mutationspruefung-budget-haenger-ersatz.mjs", import.meta.url));
const KLEINES_BUDGET = fileURLToPath(new URL("mutationspruefung-budget-schaetzung-ersatz.mjs", import.meta.url));
const ENDE_ZUERST = fileURLToPath(new URL("mutationspruefung-budget-ende-ersatz.mjs", import.meta.url));
const HAENGER_BUDGET_MS = 5000;
const LOGORDNER = ".mutationspruefung/log";
const VIELE_ZEILEN = 600;
const URTEIL = /^(?:grün|rot): /m;
const ABBRUCH_BUDGET = /^Abbruch: Budget/m;
const ABBRUCH_SCHAETZUNG = /^Abbruch: Budget: Schätzung/m;
const TIMER_ERREICHT = /^Abbruch: Budget der .+ erreicht/m;
const NORMAL = ["--basis", "HEAD"];
const TESTUMBAU = ["--basis", "HEAD~1", "--testumbau"];
const EIN_PLATZ = 1;
const MS_JE_MINUTE = 60_000;
const SECHS_STUNDEN_MS = 360 * MS_JE_MINUTE;
const EINE_STUNDE_MS = 60 * MS_JE_MINUTE;
const FUENFZEHN_MINUTEN_MS = 15 * MS_JE_MINUTE;
const BUDGET_UMGEBUNG = [
  "BUDGET",
  "BUDGET_MS",
  "MUTATION_BUDGET",
  "MUTATIONSPRUEFUNG_BUDGET",
  "MUTATIONSPRUEFUNG_BUDGET_MS",
  "MUTATIONSPRUEFUNG_BUDGET_MINUTEN",
  "RECHENZEIT_BUDGET",
  "ZEITBUDGET",
];
const SEHR_VIEL = "999999999";
const UNLESBAR = "  const grenze = (;";
const UNTERGRENZE = /^Vorschau Seite neu: 1 Quelldateien, 1 Testdateien, 1 Testgruppen, 0 Mutanten, Mutanten in 1 Quelldateien nicht zählbar, Schätzung mindestens/m;
const PS_FEHLT = /^Prozessliste nicht lesbar \(.+\); Kindprozesse bleiben unbeendet\.$/m;
const LOESCHPROBE = /^Löschprobe src\/zahl\.js:\d+: Gruppe 1 von 1/m;
const NUR_EIGENTUEMER = 0o600;
const IMMER = 1000;

function vieleMutanten() {
  return Array.from({ length: VIELE_ZEILEN }, (_leer, stelle) => `  if (zahl > ${stelle} && zahl < ${stelle + 2}) return "${stelle}";`);
}

function markierenderTest(marke) {
  return ['import { appendFileSync } from "node:fs";', `appendFileSync(${JSON.stringify(marke)}, "lief\\n");`, testdatei([-1, "negativ"], [1, "positiv"])].join("\n");
}

function logeintraege(repo) {
  const ordner = join(repo, LOGORDNER);
  const dateien = existsSync(ordner) ? readdirSync(ordner).filter((name) => name.endsWith(".jsonl")) : [];
  assert.equal(dateien.length, 1, JSON.stringify(dateien));
  return outputLines(readFileSync(join(ordner, dateien[0]), "utf8")).map((zeile) => JSON.parse(zeile));
}

function arten(eintraege, art) {
  return eintraege.filter((eintrag) => eintrag.art === art);
}

function grosseQuelleGeaendert(context, marke) {
  const repo = probeRepository(context, { ...BASIS, "test/zahl.test.js": markierenderTest(marke) });
  writeFiles(repo, { "src/zahl.js": quelle(...vieleMutanten()) });
  return repo;
}

function grosseQuelleTestUmgebaut(context, marke) {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": quelle(...vieleMutanten()), "test/zahl.test.js": markierenderTest(marke) });
  writeFiles(repo, { "test/zahl.test.js": `${markierenderTest(marke)}// umgebaut\n` });
  commitAll(repo, "Testumbau");
  return repo;
}

async function ohneWarten(context, { repo, env, vorab = [] }, argumente) {
  const lauf = starte([...vorab, WERKZEUG, ...argumente], { env, cwd: repo });
  context.after(() => lauf.kind.kill("SIGKILL"));
  const gewartet = zeile(lauf.kind.stderr, WARTET).then(() => assert.fail(`Lauf wartet auf die Sperre: ${lauf.stderr}`));
  const [code] = await Promise.race([lauf.ende, gewartet]);
  return { ...lauf, status: code };
}

function ohneStart(lauf, { repo, marke }) {
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABBRUCH_BUDGET, lauf.stderr);
  assert.doesNotMatch(lauf.stdout, URTEIL, lauf.stdout);
  assert.equal(existsSync(marke), false, "ein Testprozess lief trotz Schätzung über dem Budget");
  const eintraege = logeintraege(repo);
  assert.deepEqual([arten(eintraege, "sperre"), arten(eintraege, "stryker")], [[], []], JSON.stringify(eintraege));
  const [vorschau] = arten(eintraege, "vorschau");
  assert.ok(vorschau.schaetzung_ms > vorschau.budget_ms, JSON.stringify(vorschau));
  assert.equal(eintraege.at(-1).exit, EXIT_ABBRUCH, JSON.stringify(eintraege.at(-1)));
  return vorschau;
}

test("liegt die Schätzung der normalen Mutation über dem Budget, startet sie nicht und endet mit Exit 2, ohne auf die Sperre zu warten", async (context) => {
  const env = umgebung(context, EIN_PLATZ);
  await halter(context, env);
  const marke = join(probeDirectory(context, {}), "testlauf");
  const repo = grosseQuelleGeaendert(context, marke);
  const vorschau = ohneStart(await ohneWarten(context, { repo, env, vorab: ["--import", KLEINES_BUDGET] }, ["--basis", "HEAD"]), { repo, marke });
  assert.deepEqual([vorschau.quelldateien, vorschau.testdateien, vorschau.testgruppen], [1, 1, 1], JSON.stringify(vorschau));
});

test("liegt die Schätzung der Testumbau-Mutation über dem Budget, startet sie nicht und endet mit Exit 2, ohne auf die Sperre zu warten", async (context) => {
  const env = umgebung(context, EIN_PLATZ);
  await halter(context, env);
  const marke = join(probeDirectory(context, {}), "testlauf");
  const repo = grosseQuelleTestUmgebaut(context, marke);
  const vorschau = ohneStart(await ohneWarten(context, { repo, env, vorab: ["--import", KLEINES_BUDGET] }, ["--basis", "HEAD~1", "--testumbau"]), { repo, marke });
  assert.deepEqual([vorschau.quelldateien, vorschau.testdateien], [1, 1], JSON.stringify(vorschau));
});

async function bisZurSperre(context, { repo, zusatz = {} }, argumente) {
  const env = umgebung(context, EIN_PLATZ);
  await halter(context, env);
  const lauf = starte([WERKZEUG, ...argumente], { env: { ...env, ...zusatz }, cwd: repo });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await wartet(lauf);
  const [vorschau] = arten(logeintraege(repo), "vorschau");
  assert.deepEqual(arten(logeintraege(repo), "stryker"), []);
  return vorschau;
}

test("eine normale Mutation mit einer Schätzung von über 15 Minuten bricht nicht ab, ihr Budget beträgt 360 Minuten", async (context) => {
  const repo = grosseQuelleGeaendert(context, join(probeDirectory(context, {}), "testlauf"));
  const vorschau = await bisZurSperre(context, { repo }, ["--basis", "HEAD"]);
  assert.ok(vorschau.schaetzung_ms > FUENFZEHN_MINUTEN_MS, JSON.stringify(vorschau));
  assert.ok(vorschau.budget_ms >= SECHS_STUNDEN_MS, JSON.stringify(vorschau));
});

test("eine Testumbau-Mutation mit einer Schätzung von über 60 Minuten bricht nicht ab, ihr Budget beträgt 360 Minuten", async (context) => {
  const repo = grosseQuelleTestUmgebaut(context, join(probeDirectory(context, {}), "testlauf"));
  const vorschau = await bisZurSperre(context, { repo }, ["--basis", "HEAD~1", "--testumbau"]);
  assert.ok(vorschau.schaetzung_ms > EINE_STUNDE_MS, JSON.stringify(vorschau));
  assert.ok(vorschau.budget_ms >= SECHS_STUNDEN_MS, JSON.stringify(vorschau));
});

test("Umgebungsvariablen heben das Budget nicht an: die Schätzung über dem Budget startet auch mit ihnen nicht", async (context) => {
  const marke = join(probeDirectory(context, {}), "testlauf");
  const ohne = umgebung(context, EIN_PLATZ);
  const mit = { ...ohne, ...Object.fromEntries(BUDGET_UMGEBUNG.map((name) => [name, SEHR_VIEL])) };
  const budgets = [];
  for (const env of [ohne, mit]) {
    const repo = grosseQuelleGeaendert(context, marke);
    budgets.push(ohneStart(await ohneWarten(context, { repo, env, vorab: ["--import", KLEINES_BUDGET] }, ["--basis", "HEAD"]), { repo, marke }).budget_ms);
  }
  assert.equal(budgets[1], budgets[0]);
});

test("Umgebungsvariablen heben das echte Budget nicht an: die Vorschau nennt mit ihnen dasselbe Budget wie ohne sie", async (context) => {
  const gesetzt = Object.fromEntries(BUDGET_UMGEBUNG.map((name) => [name, SEHR_VIEL]));
  const budgets = [];
  for (const zusatz of [{}, gesetzt]) {
    const repo = grosseQuelleGeaendert(context, join(probeDirectory(context, {}), "testlauf"));
    budgets.push((await bisZurSperre(context, { repo, zusatz }, ["--basis", "HEAD"])).budget_ms);
  }
  assert.equal(budgets[1], budgets[0]);
});

test("eine nicht zählbare Quelldatei rechnet die Vorschau nicht als 0 Mutanten, sondern weist die Schätzung als Untergrenze aus", async (context) => {
  const env = umgebung(context, EIN_PLATZ);
  await halter(context, env);
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, UNLESBAR) });
  const lauf = starte([WERKZEUG, "--basis", "HEAD"], { env, cwd: repo });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await wartet(lauf);
  assert.match(lauf.stdout, UNTERGRENZE, lauf.stdout);
  const [vorschau] = arten(logeintraege(repo), "vorschau");
  assert.deepEqual([vorschau.mutanten, vorschau.unzaehlbar], [0, 1], JSON.stringify(vorschau));
});

function kleinesRepo(context) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  return repo;
}

function kleinerTestumbau(context) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "test/zahl.test.js": `${BASIS["test/zahl.test.js"]}// umgebaut\n` });
  commitAll(repo, "Testumbau");
  return repo;
}

async function mitBudget(context, { ersatz, repo, env, vorab = [] }, argumente) {
  const lauf = starte(["--import", ersatz, ...vorab, WERKZEUG, ...argumente], { env, cwd: repo });
  context.after(() => lauf.kind.kill("SIGKILL"));
  const [status] = await lauf.ende;
  return { ...lauf, status };
}

function angehalten(lauf, repo) {
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABBRUCH_BUDGET, lauf.stderr);
  assert.doesNotMatch(lauf.stdout, URTEIL, lauf.stdout);
  const eintraege = logeintraege(repo);
  const [halt] = arten(eintraege, "budget");
  assert.ok(halt.rechenzeit_ms >= halt.budget_ms, JSON.stringify(halt));
  assert.deepEqual([eintraege.at(-1).art, eintraege.at(-1).exit], ["ende", EXIT_ABBRUCH], JSON.stringify(eintraege.at(-1)));
  return halt;
}

function haengerProtokoll(context) {
  const protokoll = join(probeDirectory(context, {}), "haenger");
  return { protokoll, env: { ...umgebung(context, EIN_PLATZ), HAENGER_PROTOKOLL: protokoll } };
}

async function keinerLebt(protokoll) {
  const kinder = outputLines(readFileSync(protokoll, "utf8")).map(Number);
  assert.ok(kinder.length > 0, "der Ersatz-Stryker hat keinen Kindprozess gestartet");
  for (const kind of kinder) assert.ok(await bisBeendet(kind), `Kindprozess ${kind} läuft nach dem Halt weiter`);
}

test("eine normale Mutation mit 1 s Budget an einer kleinen Quelldatei hält mit Exit 2 an, behält das Zeit-Log und meldet kein Urteil", async (context) => {
  const repo = kleinesRepo(context);
  angehalten(await mitBudget(context, { ersatz: EINE_SEKUNDE, repo, env: umgebung(context, EIN_PLATZ) }, ["--basis", "HEAD"]), repo);
});

test("eine Testumbau-Mutation mit 1 s Budget hält mit Exit 2 an, behält das Zeit-Log und meldet kein Urteil", async (context) => {
  const repo = kleinerTestumbau(context);
  angehalten(await mitBudget(context, { ersatz: EINE_SEKUNDE, repo, env: umgebung(context, EIN_PLATZ) }, ["--basis", "HEAD~1", "--testumbau"]), repo);
});

test("am Budget beendet die Mutationsprüfung jeden Kindprozess, den sie gestartet hat", async (context) => {
  const repo = kleinesRepo(context);
  const { protokoll, env } = haengerProtokoll(context);
  angehalten(await mitBudget(context, { ersatz: HAENGER, repo, env }, ["--basis", "HEAD"]), repo);
  await keinerLebt(protokoll);
});

test("das Warten an der Sperre zählt nicht zur Rechenzeit des Budgets", async (context) => {
  const repo = kleinesRepo(context);
  const { protokoll, env } = haengerProtokoll(context);
  const gehalten = await halter(context, env);
  const lauf = starte(["--import", HAENGER, WERKZEUG, "--basis", "HEAD"], { env, cwd: repo });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await wartet(lauf);
  gehalten.kind.kill("SIGKILL");
  const [status] = await lauf.ende;
  const halt = angehalten({ ...lauf, status }, repo);
  assert.equal(halt.budget_ms, HAENGER_BUDGET_MS);
  assert.ok(halt.warten_ms > 0 && halt.ms_seit_start >= halt.budget_ms + halt.warten_ms, JSON.stringify(halt));
  await keinerLebt(protokoll);
});

function keinArbeitsordner(repo) {
  const arbeitsordner = outputLines(runIn(repo, "git", ["worktree", "list", "--porcelain"]).stdout).filter((zeile) => zeile.startsWith("worktree "));
  assert.equal(arbeitsordner.length, 1, arbeitsordner.join("\n"));
}

test("hält die Testumbau-Mutation im alten Stand am Budget an, bleibt kein Arbeitsordner zurück", async (context) => {
  const repo = kleinerTestumbau(context);
  const { protokoll, env } = haengerProtokoll(context);
  angehalten(await mitBudget(context, { ersatz: HAENGER, repo, env }, ["--basis", "HEAD~1", "--testumbau"]), repo);
  await keinerLebt(protokoll);
  keinArbeitsordner(repo);
});

function ohnePs(context) {
  const nichtAusfuehrbar = join(probeDirectory(context, {}), "ps");
  writeFileSync(nichtAusfuehrbar, "", { mode: NUR_EIGENTUEMER });
  const umlenken = `import kindprozesse from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const { spawnSync } = kindprozesse;
kindprozesse.spawnSync = (datei, ...rest) => spawnSync(datei === "ps" ? ${JSON.stringify(nichtAusfuehrbar)} : datei, ...rest);
syncBuiltinESMExports();`;
  return ["--import", `data:text/javascript,${encodeURIComponent(umlenken)}`];
}

test("ohne lesbare Prozessliste hält die Mutationsprüfung am Budget trotzdem mit Exit 2 an und nennt das", async (context) => {
  const repo = kleinesRepo(context);
  const { protokoll, env } = haengerProtokoll(context);
  const lauf = await mitBudget(context, { ersatz: HAENGER, repo, env, vorab: ohnePs(context) }, ["--basis", "HEAD"]);
  for (const kind of outputLines(readFileSync(protokoll, "utf8")).map(Number)) process.kill(kind, "SIGKILL");
  await keinerLebt(protokoll);
  angehalten(lauf, repo);
  assert.match(lauf.stderr, PS_FEHLT, lauf.stderr);
});

function strykerOhneMutanten() {
  const stryker = `data:text/javascript,${encodeURIComponent("export class Stryker { runMutationTest() { return Promise.resolve([]); } }")}`;
  const umlenken = `import { registerHooks } from "node:module";
registerHooks({
  resolve: (specifier, context, nextResolve) => (specifier === "@stryker-mutator/core" ? { url: ${JSON.stringify(stryker)}, shortCircuit: true } : nextResolve(specifier, context)),
});`;
  return ["--import", `data:text/javascript,${encodeURIComponent(umlenken)}`];
}

function haengtInDerLoeschprobe() {
  return [`if (import.meta.url.includes("loeschprobe-")) setInterval(() => {}, ${IMMER});`, testdatei([-1, "negativ"], [1, "positiv"])].join("\n");
}

test("hält die normale Mutation während der Löschprobe am Budget an, bleibt kein Arbeitsordner zurück", async (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": mitProtokoll(quelle(NEGATIV)), "test/zahl.test.js": haengtInDerLoeschprobe() });
  writeFiles(repo, { "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  const { env } = haengerProtokoll(context);
  const lauf = await mitBudget(context, { ersatz: HAENGER, repo, env, vorab: strykerOhneMutanten() }, ["--basis", "HEAD"]);
  angehalten(lauf, repo);
  assert.match(lauf.stderr, LOESCHPROBE, lauf.stderr);
  keinArbeitsordner(repo);
});

function mitSchaetzungVorTimer(context, { repo, argumente, uhr }) {
  const env = { ...umgebung(context, EIN_PLATZ), BUDGET_UHR: uhr };
  return mitBudget(context, { ersatz: ENDE_ZUERST, repo, env }, argumente);
}

function einzigesEnde(repo) {
  const eintraege = logeintraege(repo);
  const reihenfolge = JSON.stringify(eintraege.map(({ art }) => art));
  assert.equal(arten(eintraege, "vorschau").length, 1, reihenfolge);
  assert.equal(arten(eintraege, "ende").length, 1, reihenfolge);
  assert.deepEqual([eintraege.at(-1).art, eintraege.at(-1).exit], ["ende", EXIT_ABBRUCH], reihenfolge);
  return eintraege;
}

function budgetVorEnde(lauf, repo) {
  angehalten(lauf, repo);
  assert.match(lauf.stderr, TIMER_ERREICHT, lauf.stderr);
  einzigesEnde(repo);
}

function endeBleibtLetztes(lauf, repo) {
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, ABBRUCH_SCHAETZUNG, lauf.stderr);
  assert.match(lauf.stderr, TIMER_ERREICHT, lauf.stderr);
  assert.doesNotMatch(lauf.stdout, URTEIL, lauf.stdout);
  einzigesEnde(repo);
}

test("ist das Budget der normalen Mutation bei der Schätzung schon aufgebraucht, steht budget vor dem einzigen ende im Zeit-Log", async (context) => {
  const repo = kleinesRepo(context);
  budgetVorEnde(await mitSchaetzungVorTimer(context, { repo, argumente: NORMAL, uhr: "echt" }), repo);
});

test("ist das Budget der Testumbau-Mutation bei der Schätzung schon aufgebraucht, steht budget vor dem einzigen ende im Zeit-Log", async (context) => {
  const repo = kleinerTestumbau(context);
  budgetVorEnde(await mitSchaetzungVorTimer(context, { repo, argumente: TESTUMBAU, uhr: "echt" }), repo);
});

test("feuert der Budget-Timer erst nach dem Abbruch der normalen Mutation durch die Schätzung, bleibt ende die letzte Zeile des Zeit-Logs", async (context) => {
  const repo = kleinesRepo(context);
  endeBleibtLetztes(await mitSchaetzungVorTimer(context, { repo, argumente: NORMAL, uhr: "eingefroren" }), repo);
});

test("feuert der Budget-Timer erst nach dem Abbruch der Testumbau-Mutation durch die Schätzung, bleibt ende die letzte Zeile des Zeit-Logs", async (context) => {
  const repo = kleinerTestumbau(context);
  endeBleibtLetztes(await mitSchaetzungVorTimer(context, { repo, argumente: TESTUMBAU, uhr: "eingefroren" }), repo);
});
