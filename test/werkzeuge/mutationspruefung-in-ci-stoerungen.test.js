import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";

import { mutationInCi } from "../../tools/mutationspruefung/in-ci.mjs";
import { SCHRITTE_IM_WORKFLOW } from "../../tools/mutationspruefung/lauf-einordnung.mjs";
import { probeDirectory, probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const EXIT_GRUENES_URTEIL = 0;
const EXIT_ROTES_URTEIL = 1;
const EXIT_HALT_OHNE_URTEIL = 2;
const WIEDERHOLUNGEN_JE_AUFRUF = 3;
const ERSTER_VERSUCH_UND_WIEDERHOLUNGEN = 1 + WIEDERHOLUNGEN_JE_AUFRUF;
const WORKFLOW = join(REPO_ROOT, ".github/workflows/ci.yml");
const SCHRITTE_DER_PRUEFUNG = ["Mutationsplan", "Mutationsprüfung", "Mutationsurteil"];
const REPO = "probe/repo";
const LAUF = "4711";
const LAUF_URL = `https://github.com/${REPO}/actions/runs/${LAUF}`;
const ZEITEN = { taktMs: 1, hoechstMs: 5000, suchabstandMs: 1, anfangMs: 600_000 };
const NACH_DEM_ANFANG = { ...ZEITEN, anfangMs: 0 };
const GRUENES_URTEIL = { exitCode: 0, ausgabe: "grün: keine geänderte Zeile unter src/\nZweck: Probe" };
const ROTES_URTEIL = { exitCode: 1, ausgabe: "Verstoß: Mutant überlebt: src/rechnen.js:1 ArithmeticOperator" };
const NICHT_GEFUNDEN = { exit: 1, stderr: "HTTP 404: Not Found (https://api.github.com/repos/probe/repo/actions/runs/4711)" };
const BAD_GATEWAY = { exit: 1, stderr: "HTTP 502: Bad Gateway (https://api.github.com/repos/probe/repo/actions/runs/4711)" };
const KEIN_ARTEFAKT = { exit: 1, stderr: "no valid artifacts found to download" };
const ROT_ATTEMPT_1 = { stdout: JSON.stringify({ status: "completed", conclusion: "failure", attempt: 1 }) };
const ROT_ATTEMPT_2 = { stdout: JSON.stringify({ status: "completed", conclusion: "failure", attempt: 2 }) };
const GRUEN_ATTEMPT_2 = { stdout: JSON.stringify({ status: "completed", conclusion: "success", attempt: 2 }) };
const ABGEBROCHEN = { stdout: JSON.stringify({ status: "completed", conclusion: "cancelled", attempt: 1 }) };
const ROT_NACH_WARTEZEIT = { warte: 250, ...ROT_ATTEMPT_1 };
const KNAPPE_HOECHSTZEIT = { ...ZEITEN, hoechstMs: 150 };
const NEUER_VERSUCH_LAEUFT = { stdout: JSON.stringify({ status: "in_progress", conclusion: "", attempt: 2 }) };
const MIT_URTEIL = (urteil) => ({ urteil });
const DREHBUCH_SKRIPT = [
  "#!/usr/bin/env node",
  'const fs = require("node:fs");',
  "const [befehl, unterbefehl, ...rest] = process.argv.slice(2);",
  'fs.appendFileSync(__dirname + "/protokoll.jsonl", JSON.stringify([befehl, unterbefehl, ...rest]) + "\\n");',
  'const welche = () => (rest.includes("--log-failed") ? "log" : rest.includes("jobs") ? "jobs" : "stand");',
  'const art = befehl === "run" && unterbefehl === "view" ? "ansicht-" + welche() : befehl + "-" + unterbefehl;',
  'const buch = JSON.parse(fs.readFileSync(__dirname + "/drehbuch.json", "utf8"));',
  'const zaehlerDatei = __dirname + "/zaehler-" + art;',
  'const bisher = fs.existsSync(zaehlerDatei) ? Number(fs.readFileSync(zaehlerDatei, "utf8")) : 0;',
  "fs.writeFileSync(zaehlerDatei, String(bisher + 1));",
  "const antworten = buch[art] ?? [{}];",
  "const antwort = antworten[Math.min(bisher, antworten.length - 1)];",
  'if (antwort.urteil) fs.cpSync(__dirname + "/urteil-" + antwort.urteil, rest[rest.indexOf("-D") + 1], { recursive: true });',
  "if (antwort.warte) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, antwort.warte);",
  "if (antwort.stdout) process.stdout.write(antwort.stdout);",
  "if (antwort.stderr) process.stderr.write(antwort.stderr);",
  "process.exit(antwort.exit ?? 0);",
  "",
].join("\n");

function jobs(...liste) {
  return { stdout: JSON.stringify({ jobs: liste }) };
}

function job(name, conclusion, ...gescheiterteSchritte) {
  const steps = gescheiterteSchritte.map((schritt) => ({ name: schritt, conclusion: "failure" }));
  return { name, conclusion, steps: [{ name: "Checkout", conclusion: "success" }, ...steps] };
}

const MUTATION_ABGEBROCHEN = {
  name: "Mutationsprüfung 5",
  conclusion: "failure",
  steps: [
    { name: "Mutationsprüfung", conclusion: "cancelled" },
    { name: "Zeit-Log hochladen", conclusion: "failure" },
  ],
};
const SAMMELJOB_ROT = job("CI", "failure", "Alle Jobs erfolgreich");
const START_SCHEITERT = job("Mutationsprüfung 5", "failure", "Set up job");
const MUTATION_SCHEITERT = job("Mutationsprüfung 5", "failure", "Mutationsprüfung");

function umgebung(context, drehbuch) {
  const urteile = Object.fromEntries(Object.entries(drehbuch.urteile ?? {}).map(([name, urteil]) => [`urteil-${name}/ausgabe.txt`, `${urteil.ausgabe}\n`]));
  const exitCodes = Object.fromEntries(Object.entries(drehbuch.urteile ?? {}).map(([name, urteil]) => [`urteil-${name}/exit-code`, `${urteil.exitCode}\n`]));
  const ordner = probeDirectory(context, { gh: DREHBUCH_SKRIPT, "protokoll.jsonl": "", "drehbuch.json": JSON.stringify(drehbuch.buch), ...urteile, ...exitCodes });
  chmodSync(join(ordner, "gh"), AUSFUEHRBAR);
  const vorher = { PATH: env.PATH, GITHUB_REPOSITORY: env.GITHUB_REPOSITORY };
  Object.assign(env, { PATH: `${ordner}${delimiter}${env.PATH}`, GITHUB_REPOSITORY: REPO });
  context.after(() => {
    env.PATH = vorher.PATH;
    if (vorher.GITHUB_REPOSITORY === undefined) delete env.GITHUB_REPOSITORY;
    else env.GITHUB_REPOSITORY = vorher.GITHUB_REPOSITORY;
  });
  return ordner;
}

function protokoll(ordner) {
  const zeilen = readFileSync(join(ordner, "protokoll.jsonl"), "utf8").trim().split("\n");
  return zeilen.map((zeile) => JSON.parse(zeile)).map(([befehl, unterbefehl, ...rest]) => ({ art: `${befehl} ${unterbefehl}`, rest }));
}

function anzahl(ordner, art, enthaelt) {
  return protokoll(ordner).filter((aufruf) => aufruf.art === art && (enthaelt === undefined || aufruf.rest.includes(enthaelt))).length;
}

function lauf(context, buch, urteile = {}) {
  const repo = probeRepository(context, { "package.json": '{ "type": "module" }\n', "alt.txt": "alt\n" });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  runIn(repo, "git", ["config", "user.name", "Probe"]);
  runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
  const upstream = probeDirectory(context, {});
  runIn(upstream, "git", ["init", "-q", "--bare"]);
  runIn(repo, "git", ["remote", "add", "upstream", upstream]);
  writeFileSync(join(repo, "neu.txt"), "neu\n");
  const ordner = umgebung(context, { buch: { "workflow-run": [{ stdout: `${LAUF_URL}\n` }], ...buch }, urteile });
  return { ordner, ausfuehren: (zeiten = ZEITEN) => mutationInCi({ root: repo, basis, alterStand: false, gleichwertige: [] }, zeiten) };
}

async function haeltOhneNeustart(context, jobsAntwort, stand = ROT_ATTEMPT_1) {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [stand], "ansicht-jobs": [jobsAntwort], "run-download": [KEIN_ARTEFAKT] });
  const ergebnis = await ausfuehren();
  assert.equal(ergebnis.exitCode, EXIT_HALT_OHNE_URTEIL);
  assert.match(ergebnis.zeilen.join("\n"), /ohne Urteil/);
  assert.equal(anzahl(ordner, "run rerun"), 0);
  return ordner;
}

function reihenfolge(ordner) {
  return protokoll(ordner).map((aufruf) => (aufruf.art === "run view" ? `view-${aufruf.rest.includes("jobs") ? "jobs" : "stand"}` : aufruf.art));
}

test("Mutationsprüfung in der CI: ein HTTP 404 von gh run view direkt nach dem Start bricht den Lauf nicht ab", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [NICHT_GEFUNDEN, NICHT_GEFUNDEN, GRUEN_ATTEMPT_2], "run-download": [MIT_URTEIL("gruen")] }, { gruen: GRUENES_URTEIL });
  const ergebnis = await ausfuehren();
  assert.equal(ergebnis.exitCode, EXIT_GRUENES_URTEIL);
  assert.equal(ergebnis.zeilen.at(-1), GRUENES_URTEIL.ausgabe);
  assert.equal(anzahl(ordner, "run view", "status,conclusion,attempt"), 3);
  assert.equal(anzahl(ordner, "run rerun"), 0);
});

test("Mutationsprüfung in der CI: eine Störung von gh run view über die Wiederholungen hinaus bricht den Lauf ab", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [BAD_GATEWAY] });
  await assert.rejects(ausfuehren(), /HTTP 502/);
  assert.equal(anzahl(ordner, "run view", "status,conclusion,attempt"), ERSTER_VERSUCH_UND_WIEDERHOLUNGEN);
  assert.equal(anzahl(ordner, "run download"), 0);
});

test("Mutationsprüfung in der CI: ein HTTP 404 von gh run view nach dem Anfangsfenster gilt nicht als Störung", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [NICHT_GEFUNDEN, GRUEN_ATTEMPT_2] });
  await assert.rejects(ausfuehren(NACH_DEM_ANFANG), /HTTP 404/);
  assert.equal(anzahl(ordner, "run view", "status,conclusion,attempt"), 1);
});

test("Mutationsprüfung in der CI: ein fehlgeschlagener Artefakt-Download mit HTTP 502 wird wiederholt und das Urteil gilt", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [GRUEN_ATTEMPT_2], "run-download": [BAD_GATEWAY, MIT_URTEIL("rot")] }, { rot: ROTES_URTEIL });
  const ergebnis = await ausfuehren();
  assert.equal(ergebnis.exitCode, EXIT_ROTES_URTEIL);
  assert.equal(ergebnis.zeilen.at(-1), ROTES_URTEIL.ausgabe);
  assert.equal(anzahl(ordner, "run download"), 2);
});

test("Mutationsprüfung in der CI: ein fehlendes Artefakt wird nicht wiederholt", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [GRUEN_ATTEMPT_2], "run-download": [KEIN_ARTEFAKT] });
  const ergebnis = await ausfuehren();
  assert.equal(ergebnis.exitCode, EXIT_HALT_OHNE_URTEIL);
  assert.match(ergebnis.zeilen.join("\n"), /ohne Urteil/);
  assert.equal(anzahl(ordner, "run download"), 1);
});

test("Mutationsprüfung in der CI: ein Job, der in Set up job scheitert, wird genau einmal neu gestartet und danach gilt das Urteil", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [ROT_ATTEMPT_1, NEUER_VERSUCH_LAEUFT, GRUEN_ATTEMPT_2], "ansicht-jobs": [jobs(job("Mutationsplan", "success"), START_SCHEITERT, SAMMELJOB_ROT)], "run-download": [KEIN_ARTEFAKT, MIT_URTEIL("gruen")] }, { gruen: GRUENES_URTEIL });
  const ergebnis = await ausfuehren();
  assert.equal(ergebnis.exitCode, EXIT_GRUENES_URTEIL);
  assert.equal(ergebnis.zeilen.at(-1), GRUENES_URTEIL.ausgabe);
  assert.equal(anzahl(ordner, "run rerun"), 1);
  assert.deepEqual(protokoll(ordner).find((aufruf) => aufruf.art === "run rerun").rest, [LAUF, "-R", REPO, "--failed"]);
});

test("Mutationsprüfung in der CI: nach dem Neustart wird erst der neue Versuch abgewartet, nicht der alte Stand gelesen", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [ROT_ATTEMPT_1, ROT_ATTEMPT_1, ROT_ATTEMPT_1, GRUEN_ATTEMPT_2], "ansicht-jobs": [jobs(START_SCHEITERT)], "run-download": [KEIN_ARTEFAKT, MIT_URTEIL("gruen")] }, { gruen: GRUENES_URTEIL });
  const ergebnis = await ausfuehren();
  assert.equal(ergebnis.exitCode, EXIT_GRUENES_URTEIL);
  const ablauf = reihenfolge(ordner);
  assert.deepEqual(ablauf.slice(ablauf.indexOf("run rerun") + 1, -1), ["view-stand", "view-stand", "view-stand", "run download"]);
});

test("Mutationsprüfung in der CI: ein Job, der im Mutationsschritt scheitert, wird nicht neu gestartet", async (context) => {
  await haeltOhneNeustart(context, jobs(MUTATION_SCHEITERT, START_SCHEITERT, SAMMELJOB_ROT));
});

test("Mutationsprüfung in der CI: ein Job mit einem unbekannten gescheiterten Schritt wird nicht neu gestartet", async (context) => {
  await haeltOhneNeustart(context, jobs(job("Mutationsprüfung 5", "failure", "Set up job", "Etwas Neues")));
});

test("Mutationsprüfung in der CI: scheitert nur der Sammeljob CI, wird nicht neu gestartet", async (context) => {
  await haeltOhneNeustart(context, jobs(job("Mutationsplan", "success"), SAMMELJOB_ROT));
});

test("Mutationsprüfung in der CI: ein abgebrochener Lauf wird nicht neu gestartet", async (context) => {
  const ordner = await haeltOhneNeustart(context, jobs(START_SCHEITERT), ABGEBROCHEN);
  assert.equal(anzahl(ordner, "run view", "jobs"), 0);
});

test("Mutationsprüfung in der CI: ein rotes Urteil im Artefakt gilt ohne Neustart, auch wenn Jobs außerhalb der Prüfung scheiterten", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [ROT_ATTEMPT_1], "ansicht-jobs": [jobs(START_SCHEITERT)], "run-download": [MIT_URTEIL("rot")] }, { rot: ROTES_URTEIL });
  const ergebnis = await ausfuehren();
  assert.equal(ergebnis.exitCode, EXIT_ROTES_URTEIL);
  assert.equal(ergebnis.zeilen.at(-1), ROTES_URTEIL.ausgabe);
  assert.equal(anzahl(ordner, "run rerun"), 0);
});

test("Mutationsprüfung in der CI: eine zweite Störung außerhalb der Prüfung nach dem Neustart hält ohne zweiten Neustart", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [ROT_ATTEMPT_1, ROT_ATTEMPT_2], "ansicht-jobs": [jobs(START_SCHEITERT)], "run-download": [KEIN_ARTEFAKT] });
  const ergebnis = await ausfuehren();
  assert.equal(ergebnis.exitCode, EXIT_HALT_OHNE_URTEIL);
  assert.match(ergebnis.zeilen.join("\n"), /ohne Urteil/);
  assert.equal(anzahl(ordner, "run rerun"), 1);
});

test("Mutationsprüfung in der CI: scheitert der Neustart selbst, bleibt es beim Halt ohne Urteil", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [ROT_ATTEMPT_1], "ansicht-jobs": [jobs(START_SCHEITERT)], "run-rerun": [{ exit: 1, stderr: "HTTP 403: Resource not accessible" }], "run-download": [KEIN_ARTEFAKT] });
  const ergebnis = await ausfuehren();
  assert.equal(ergebnis.exitCode, EXIT_HALT_OHNE_URTEIL);
  assert.equal(anzahl(ordner, "run rerun"), 1);
});

test("Mutationsprüfung in der CI: ein abgebrochener Job neben einem Fehler in Set up job führt nicht zum Neustart", async (context) => {
  await haeltOhneNeustart(context, jobs(START_SCHEITERT, job("Mutationsprüfung 6", "cancelled")));
});

test("Mutationsprüfung in der CI: ein roter Job ohne gescheiterten Schritt führt nicht zum Neustart", async (context) => {
  await haeltOhneNeustart(context, jobs(job("Mutationsprüfung 5", "failure")));
});

test("Mutationsprüfung in der CI: die Schritte außerhalb der Prüfung heißen im Workflow ci.yml so und die Prüfschritte stehen nicht darunter", () => {
  const schritte = new Set([...readFileSync(WORKFLOW, "utf8").matchAll(/^\s+- name: (.+)$/gm)].map((treffer) => treffer[1]));
  assert.deepEqual([...SCHRITTE_IM_WORKFLOW].filter((name) => !schritte.has(name)), []);
  assert.deepEqual(SCHRITTE_DER_PRUEFUNG.filter((name) => !schritte.has(name) || SCHRITTE_IM_WORKFLOW.has(name)), []);
});

test("Mutationsprüfung in der CI: ein abgebrochener Mutationsschritt neben einem gescheiterten Hochladen führt nicht zum Neustart", async (context) => {
  await haeltOhneNeustart(context, jobs(MUTATION_ABGEBROCHEN));
});

test("Mutationsprüfung in der CI: die Höchstzeit gilt für den ganzen Lauf einschließlich des Neustarts", async (context) => {
  const { ordner, ausfuehren } = lauf(context, { "ansicht-stand": [ROT_NACH_WARTEZEIT, NEUER_VERSUCH_LAEUFT], "ansicht-jobs": [jobs(START_SCHEITERT)], "run-download": [KEIN_ARTEFAKT] });
  const ergebnis = await ausfuehren(KNAPPE_HOECHSTZEIT);
  assert.equal(ergebnis.exitCode, EXIT_HALT_OHNE_URTEIL);
  assert.equal(anzahl(ordner, "run rerun"), 1);
  assert.equal(anzahl(ordner, "run view", "status,conclusion,attempt"), 2);
});
