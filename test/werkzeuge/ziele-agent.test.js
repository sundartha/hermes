import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { starteAgent } from "../../tools/ziele/agent.mjs";
import { ergebnisDesAgenten } from "../../tools/ziele/agentenlauf.mjs";
import {
  arbeitsordner,
  ausgabenAus,
  ersatzClaude,
  ersatzProgramm,
  gelesen,
  githubAttrappe,
  quelltext,
  starteZiele,
  umgebung,
  zieleRepo,
} from "./ziele/hilfen.mjs";

const TOKEN = "schein-token-ziele";
const KURZE_FRIST_SEKUNDEN = 0.3;
const STUNDE_MS = 3_600_000;
const FREI = quelltext(["function rest() {\n  return 2;\n}", "export function frei() {\n  return 1;\n}", "export function weg() {\n  return rest();\n}"]);
const FREI_SAUBER = quelltext(["export function frei() {\n  return 1;\n}"]);
const ZIEL = { format: 1, ausgang: "weiter", grund: "", befunde: [], sorte: "knip", datei: "src/frei.js", zielbefunde: ["exports weg"], arten: ["exports"], agent: true, agentErlaubt: true, minuten: 10 };
const ANTWORT = { datei: "src/frei.js", geaendert: true, sorte: "knip", behobeneBefunde: ["exports weg"] };

function probe(context, budget = { Aufräumen: 10 }) {
  return zieleRepo(context, {
    ".github/budget.json": JSON.stringify({ minutenJeLauf: budget }),
    "src/main.js": quelltext(['import { frei } from "./frei.js";', "console.log(frei());"]),
    "src/frei.js": FREI,
  });
}

async function agent(context, repo, { programm, token = TOKEN, start = new Date().toISOString() }) {
  const github = await githubAttrappe(context);
  const ordner = arbeitsordner(context, { "ziel/ziel.json": { ...ZIEL, master: repo.sha() }, "ziel/vorpruefung.json": { ausgang: "weiter", start }, "ziel/fixer.patch": "", "ausgaben.txt": "" });
  const env = umgebung(github, { HERMES_CLAUDE: programm, CLAUDE_CODE_OAUTH_TOKEN: token, GITHUB_OUTPUT: join(ordner, "ausgaben.txt") });
  const lauf = await starteZiele(["agent", "--ordner", ordner], { cwd: repo.ordner, env });
  return { ...lauf, ordner, ergebnis: gelesen(ordner, "agent/agent.json"), ausgaben: ausgabenAus(join(ordner, "ausgaben.txt")) };
}

function kurz({ status, ergebnis }) {
  return [status, ergebnis.ausgang, ergebnis.grund, ...ergebnis.befunde.map(({ id, datei }) => `${id} ${datei}`)];
}

function ergebnisZeile(felder) {
  return `process.stdout.write(${JSON.stringify(`${JSON.stringify({ type: "result", num_turns: 1, usage: {}, ...felder })}\n`)});`;
}

test("ziele-agent: fehlt der Budget-Eintrag, endet der Fixer blockiert und rot, und kein Agent startet", async (context) => {
  const repo = probe(context, { Wochenbericht: 5 });
  const github = await githubAttrappe(context);
  const ordner = arbeitsordner(context, { "ziel/ziel.json": { ...ZIEL, agent: undefined, master: repo.sha() }, "ausgaben.txt": "" });
  const lauf = await starteZiele(["fixen", "--ordner", ordner], { cwd: repo.ordner, env: umgebung(github, { GITHUB_OUTPUT: join(ordner, "ausgaben.txt") }) });
  const ziel = gelesen(ordner, "ziel/ziel.json");
  assert.deepEqual([lauf.status, ziel.ausgang, ziel.agent, ausgabenAus(join(ordner, "ausgaben.txt")).agent], [1, "blockiert", false, "nein"]);
  assert.match(ziel.grund, /fehlt minutenJeLauf\["Aufräumen"\]/);
  const claude = ersatzClaude(context, { antwort: ANTWORT });
  const direkt = await agent(context, repo, { programm: claude.programm });
  assert.deepEqual([direkt.status, direkt.ergebnis.ausgang, claude.protokoll()], [1, "blockiert", null]);
});

test("ziele-agent: reicht die Zeit im Budget nach Abzug der Reserve nicht, startet kein Agent; blockiert, grün, AR-budget", async (context) => {
  const repo = probe(context);
  const claude = ersatzClaude(context, { antwort: ANTWORT });
  const vorEinerStunde = new Date(Date.now() - STUNDE_MS).toISOString();
  const ergebnis = await agent(context, repo, { programm: claude.programm, start: vorEinerStunde });
  const [status, ausgang, grund, befund] = kurz(ergebnis);
  assert.deepEqual([status, ausgang, befund], [0, "blockiert", "AR-budget src/frei.js"]);
  assert.match(grund, /^Agent: nur noch -\d+ s im Budget$/);
  assert.equal(claude.protokoll(), null);
});

test("ziele-agent: der Agent sieht nur eine Kopie der Zieldatei in einem Wegwerf-Ordner und bekommt nur PATH, HOME und das Token", async (context) => {
  const repo = probe(context);
  const claude = ersatzClaude(context, { schreibe: { "frei.js": FREI_SAUBER }, antwort: ANTWORT });
  const ergebnis = await agent(context, repo, { programm: claude.programm });
  assert.deepEqual(kurz(ergebnis), [0, "weiter", ""]);
  const { argumente, umgebung: kind, ordner, dateien, eingabe } = claude.protokoll();
  assert.deepEqual(Object.keys(kind).filter((name) => !name.startsWith("__CF")).sort(), ["CLAUDE_CODE_OAUTH_TOKEN", "HOME", "PATH"]);
  assert.equal(kind.CLAUDE_CODE_OAUTH_TOKEN, TOKEN);
  assert.deepEqual(dateien, ["frei.js"]);
  assert.notEqual(ordner, realpathSync(repo.ordner));
  assert.equal(existsSync(ordner), false);
  const wert = (schalter) => argumente[argumente.indexOf(schalter) + 1];
  assert.deepEqual([wert("--allowedTools"), wert("--tools"), wert("--model"), wert("--permission-mode")], ["Edit(frei.js)", "Read,Edit,Grep,Glob", "sonnet", "dontAsk"]);
  assert.ok(argumente.includes("--restricted"));
  assert.match(eingabe, /^Ziel: src\/frei\.js$/m);
  assert.equal(readFileSync(join(repo.ordner, "src/frei.js"), "utf8"), FREI_SAUBER);
  assert.match(readFileSync(join(ergebnis.ordner, "agent/agent.patch"), "utf8"), /^-export function weg\(\) \{$/m);
  assert.match(ergebnis.ausgaben.patch_sha, /^[0-9a-f]{64}$/);
});

test("ziele-agent: überschreitet der Agent seine Zeitgrenze, endet er blockiert, grün und mit AR-zeit", async (context) => {
  const { programm } = ersatzProgramm(context, 'import { spawnSync } from "node:child_process";\nspawnSync("sleep", ["30"]);');
  const ordner = arbeitsordner(context, {});
  const lauf = await starteAgent({ root: ordner, befehl: [programm], eingabe: "", sekunden: KURZE_FRIST_SEKUNDEN, token: TOKEN, pruefeAntwort: () => ANTWORT });
  const ergebnis = ergebnisDesAgenten(ZIEL, lauf);
  assert.deepEqual([lauf.grund, ergebnis.ausgang, ergebnis.rot, ergebnis.befunde.map(({ id }) => id)], ["Zeitablauf", "blockiert", undefined, ["AR-zeit"]]);
});

test("ziele-agent: eine Antwort für eine andere Datei ist ungültig, der Lauf wird rot mit AR-agent", async (context) => {
  const repo = probe(context);
  const claude = ersatzClaude(context, { antwort: { ...ANTWORT, datei: "src/main.js" } });
  const ergebnis = await agent(context, repo, { programm: claude.programm });
  assert.deepEqual(kurz(ergebnis), [1, "blockiert", "Agent: ungültige Antwort", "AR-agent src/frei.js"]);
  assert.equal(ergebnis.ausgaben.ausgang, "blockiert");
});

test("ziele-agent: schreibt der Agent das Token in die Datei, wird der Lauf rot und es gibt keinen Patch", async (context) => {
  const repo = probe(context);
  const claude = ersatzClaude(context, { schreibe: { "frei.js": `export const verraten = "${TOKEN}";\n` }, antwort: ANTWORT });
  const ergebnis = await agent(context, repo, { programm: claude.programm });
  assert.deepEqual(kurz(ergebnis), [1, "blockiert", "Agent: Patch enthielt das Token", "AR-agent src/frei.js"]);
  assert.equal(existsSync(join(ergebnis.ordner, "agent/agent.patch")), false);
});

test("ziele-agent: fehlt das Abo-Token oder scheitert die Anmeldung, wird der Lauf rot", async (context) => {
  const repo = probe(context);
  const claude = ersatzClaude(context, { antwort: ANTWORT });
  const ohne = await agent(context, repo, { programm: claude.programm, token: "" });
  assert.deepEqual(kurz(ohne), [1, "blockiert", "Agent: Token fehlt", "AR-agent src/frei.js"]);
  assert.equal(claude.protokoll(), null);
  const abgelaufen = ersatzClaude(context, { antwort: ANTWORT, ergebnis: { is_error: true, subtype: "error_during_execution", result: "Invalid OAuth token" } });
  const anmeldung = await agent(context, repo, { programm: abgelaufen.programm });
  assert.deepEqual(kurz(anmeldung), [1, "blockiert", "Agent: Anmeldung gescheitert (authentication_failed)", "AR-agent src/frei.js"]);
});

test("ziele-agent: ein Nutzungslimit endet blockiert und grün, ohne Befund", async (context) => {
  const repo = probe(context);
  const { programm } = ersatzProgramm(context, ergebnisZeile({ subtype: "error_during_execution", is_error: true, result: "Claude AI usage limit reached" }));
  assert.deepEqual(kurz(await agent(context, repo, { programm })), [0, "blockiert", "Agent: Nutzungslimit erreicht"]);
});
