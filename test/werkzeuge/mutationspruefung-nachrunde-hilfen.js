import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { REPO_ROOT, commitAll, isolatedEnvironment, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const AUSFUEHRBAR = 0o755;
const REPO = "probe/repo";
const VORLAUF = "4711";
const AKTUELLER_LAUF = "5000";
const KURZ = 7;
const ERSTER_LAUF = /^src\/zahl\.js: (\d+) Mutanten gegen \d+ Testdateien in \d+ s$/gm;
const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;
const URTEIL = /^(?:grün|rot): .+$/gm;
const BESTAETIGUNG = /^Bestätigung: .+$/gm;

const GH_ATTRAPPE = [
  "#!/usr/bin/env node",
  'const { cpSync, existsSync, readFileSync } = require("node:fs");',
  'const { dirname, join } = require("node:path");',
  "const hier = dirname(process.argv[1]);",
  "const argumente = process.argv.slice(2);",
  'const einstellung = JSON.parse(readFileSync(join(hier, "einstellung.json"), "utf8"));',
  'if (einstellung.abruf === "fehlt") { process.stderr.write("HTTP 503: Egress is over the account limit"); process.exit(1); }',
  'if (argumente[0] === "api") { process.stdout.write(JSON.stringify(einstellung.lauf)); process.exit(0); }',
  'if (argumente[0] === "run" && argumente[1] === "download") {',
  '  if (!existsSync(einstellung.artefakte)) process.exit(1);',
  '  cpSync(einstellung.artefakte, argumente[argumente.indexOf("-D") + 1], { recursive: true });',
  "  process.exit(0);",
  "}",
  "process.exit(9);",
  "",
].join("\n");

export const NEGATIV = '  if (zahl < 0) return "negativ";';
export const NULL = '  if (zahl === 0) return "null";';

export function quelle(...zeilen) {
  return ["export function einordnen(zahl) {", ...zeilen, '  return "positiv";', "}", ""].join("\n");
}

export const VERDOPPELN = "export const verdoppeln = (zahl) => zahl * 2;\n";
export const VERDOPPELNTEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdoppeln } from "../src/zahl.js";',
  'test("verdoppeln", () => {',
  "  assert.equal(verdoppeln(3), 6);",
  "});",
  "",
].join("\n");

export const HILFE = 'export const FAELLE = [[-1, "negativ"], [1, "positiv"]];\n';
export const ZAHLTEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { einordnen } from "../src/zahl.js";',
  'import { FAELLE } from "./hilfe.js";',
  'test("einordnen", () => {',
  "  for (const [zahl, wert] of FAELLE) assert.equal(einordnen(zahl), wert);",
  "});",
  "",
].join("\n");
export const NULLTEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { einordnen } from "../src/zahl.js";',
  'test("null", () => {',
  '  assert.equal(einordnen(0), "null");',
  "});",
  "",
].join("\n");

export const TESTBANK = "export const BANK = 1;\n";
const WEITERETEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { BANK } from "./testbaenke-run.mjs";',
  'test("weitere", () => {',
  "  assert.equal(BANK, 1);",
  "});",
  "",
].join("\n");

const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "src/zahl.js": quelle(NEGATIV),
  "test/hilfe.js": HILFE,
  "test/testbaenke-run.mjs": TESTBANK,
  "test/zahl.test.js": ZAHLTEST,
  "test/weitere.test.js": WEITERETEST,
  "test/daten.json": '{ "neu": false }\n',
};

function git(verzeichnis, ...argumente) {
  const lauf = runIn(verzeichnis, "git", argumente);
  if (lauf.status !== 0) throw new Error(`git ${argumente.join(" ")}: ${lauf.stderr}`);
  return lauf.stdout.trim();
}

export function werkzeugLauf(repo, argumente, umgebung = {}) {
  return spawnSync(process.execPath, [WERKZEUG, ...argumente], { cwd: repo, encoding: "utf8", env: { ...isolatedEnvironment(), ...umgebung } });
}

function messeAlleTeile(repo, basis, { ziel, zusatz = [] }) {
  const planDatei = join(ziel, "plan.json");
  const plan = werkzeugLauf(repo, ["--basis", basis, "--plan", planDatei]);
  if (plan.status !== 0) throw new Error(plan.stdout + plan.stderr);
  const { teile, anzahl } = JSON.parse(readFileSync(planDatei, "utf8"));
  const ordner = join(ziel, "teile");
  mkdirSync(ordner, { recursive: true });
  const laeufe = teile.map((teil) => {
    const datei = join(ordner, `mutation-teil-${teil}.json`);
    const lauf = werkzeugLauf(repo, ["--basis", basis, "--teil", String(teil), "--teile", String(anzahl), "--ergebnis", datei, ...zusatz]);
    if (lauf.status !== 0) throw new Error(lauf.stdout + lauf.stderr);
    return lauf.stdout;
  });
  return { ordner, ausgaben: laeufe.join("\n") };
}

export function urteil(repo, basis, { ordner, zusatz = [] }) {
  return werkzeugLauf(repo, ["--basis", basis, "--urteil", ordner, ...zusatz]);
}

export function zusammenfassung(ausgabe) {
  const treffer = (muster) => [...ausgabe.matchAll(muster)].map(([gefunden, gruppe]) => gruppe ?? gefunden).sort();
  return { ueberlebende: treffer(UEBERLEBT), bestaetigung: treffer(BESTAETIGUNG), urteil: treffer(URTEIL) };
}

export function ersteLaeufe(ausgabe) {
  return [...ausgabe.matchAll(ERSTER_LAUF)].reduce((summe, [, anzahl]) => summe + Number(anzahl), 0);
}

function teilergebnisse(ordner) {
  return readdirSync(ordner).map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8")));
}

export function alleEintraege(ordner) {
  return teilergebnisse(ordner).flatMap(({ messungen }) => messungen.flatMap(({ ergebnisse }) => ergebnisse));
}

export function temporaer(aufraeumer, praefix) {
  const verzeichnis = mkdtempSync(join(tmpdir(), praefix));
  aufraeumer.push(() => rmSync(verzeichnis, { recursive: true, force: true }));
  return verzeichnis;
}

export function vorlaufRepo(aufraeumer) {
  const verzeichnis = temporaer(aufraeumer, "nachrunde-vorlauf-");
  const repo = probeRepository({ after: (aufgabe) => aufraeumer.push(aufgabe) }, BASIS);
  const basis = git(repo, "rev-parse", "HEAD");
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) + VERDOPPELN, "test/verdoppeln.test.js": VERDOPPELNTEST });
  commitAll(repo, "Runde 1");
  const kopf = git(repo, "rev-parse", "HEAD");
  const { ordner, ausgaben } = messeAlleTeile(repo, basis, { ziel: verzeichnis });
  const artefakte = join(verzeichnis, "artefakte");
  for (const name of readdirSync(ordner)) {
    const artefakt = name.replace(/\.json$/, "");
    mkdirSync(join(artefakte, artefakt), { recursive: true });
    cpSync(join(ordner, name), join(artefakte, artefakt, name));
  }
  return { repo, basis, kopf, artefakte, ordner, ausgaben, verzeichnis };
}

function laufBeschreibung(kopf, aenderungen) {
  return {
    id: Number(VORLAUF),
    status: "completed",
    conclusion: "failure",
    path: ".github/workflows/ci.yml",
    event: "workflow_dispatch",
    head_branch: `lauf-mutation/${kopf.slice(0, KURZ)}`,
    head_sha: kopf,
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
    ...aenderungen,
  };
}

export function ghAttrappe(vorlauf, aufraeumer, { lauf = {}, abruf = "ok" } = {}) {
  const ordner = temporaer(aufraeumer, "nachrunde-gh-");
  writeFileSync(join(ordner, "gh"), GH_ATTRAPPE);
  chmodSync(join(ordner, "gh"), AUSFUEHRBAR);
  writeFileSync(join(ordner, "einstellung.json"), JSON.stringify({ abruf, artefakte: vorlauf.artefakte, lauf: laufBeschreibung(vorlauf.kopf, lauf) }));
  return ordner;
}

function ciUmgebung(attrappe, aenderungen = {}) {
  return {
    PATH: `${attrappe}:${process.env.PATH}`,
    GITHUB_REPOSITORY: REPO,
    GITHUB_RUN_ID: AKTUELLER_LAUF,
    GITHUB_REF_NAME: "lauf-mutation/abcdef0",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    ...aenderungen,
  };
}

const MIT_VORLAUF = ["Mutationsprüfung auf Abruf", "", "Auftrag: lauf/in-ci", `Vorlauf: ${VORLAUF}`, ""].join("\n");

export function nachrundeRepo(vorlauf, aufraeumer, { dateien, nachricht = MIT_VORLAUF, entfernen = [] }) {
  const verzeichnis = temporaer(aufraeumer, "nachrunde-repo-");
  const geklont = runIn(tmpdir(), "git", ["clone", "-q", vorlauf.repo, verzeichnis]);
  if (geklont.status !== 0) throw new Error(geklont.stderr);
  for (const pfad of entfernen) rmSync(join(verzeichnis, pfad));
  writeFiles(verzeichnis, dateien);
  commitAll(verzeichnis, nachricht);
  return verzeichnis;
}

export function holeVorergebnis(repo, attrappe, { ziel, basis, aenderungen = {} }) {
  const plan = join(dirname(ziel), "plan.json");
  return werkzeugLauf(repo, ["--basis", basis, "--plan", plan, "--vorergebnis-holen", ziel], ciUmgebung(attrappe, aenderungen));
}

export function nachrunde(repo, basis, { vorergebnis, aufraeumer }) {
  const verzeichnis = temporaer(aufraeumer, "nachrunde-lauf-");
  const zusatz = vorergebnis === undefined ? [] : ["--vorergebnis", vorergebnis];
  const gemessen = messeAlleTeile(repo, basis, { ziel: verzeichnis, zusatz });
  return { ...gemessen, verzeichnis, urteil: urteil(repo, basis, { ordner: gemessen.ordner, zusatz }) };
}

export function erwartung(eintraege, betroffeneTests) {
  const unberuehrtGetoetet = (eintrag) => eintrag.status === "Killed" && eintrag.bestaetigung === "getoetet" && eintrag.toeter.every((test) => !betroffeneTests.includes(test));
  const ort = (eintrag) => JSON.stringify(eintrag.lage);
  const offeneOrte = new Set(eintraege.filter((eintrag) => !unberuehrtGetoetet(eintrag)).map(ort));
  const uebernommen = eintraege.filter((eintrag) => unberuehrtGetoetet(eintrag) && !offeneOrte.has(ort(eintrag))).length;
  return { uebernommen, geprueft: eintraege.length - uebernommen };
}

export function abgewandelt(vorlauf, aufraeumer, aenderung) {
  const artefakte = temporaer(aufraeumer, "nachrunde-artefakte-");
  const teile = aenderung(teilergebnisse(vorlauf.ordner).map((teil) => structuredClone(teil)));
  for (const [index, teil] of teile.entries()) {
    const name = `mutation-teil-${index + 1}`;
    mkdirSync(join(artefakte, name), { recursive: true });
    writeFileSync(join(artefakte, name, `${name}.json`), JSON.stringify(teil));
  }
  return { ...vorlauf, artefakte };
}

export function mitEintraegen(umbau) {
  return (teile) => teile.map((teil) => ({ ...teil, messungen: teil.messungen.map((messung) => ({ ...messung, ergebnisse: umbau(messung.ergebnisse) })) }));
}

export function bestaetigtGetoetet(eintrag) {
  return eintrag.status === "Killed" && eintrag.bestaetigung === "getoetet" && eintrag.toeter.length > 0 && eintrag.hinweis === undefined && eintrag.befund === undefined;
}

export function holeAus(vorlauf, aufraeumer, { gh, umgebung, nachricht, dateien = {} }) {
  const repo = nachrundeRepo(vorlauf, aufraeumer, { dateien: { "test/null.test.js": NULLTEST, ...dateien }, nachricht });
  const attrappe = ghAttrappe(vorlauf, aufraeumer, { lauf: gh });
  const ziel = join(temporaer(aufraeumer, "nachrunde-vorergebnis-"), "vorergebnis.json");
  return { repo, ziel, geholt: holeVorergebnis(repo, attrappe, { ziel, basis: vorlauf.basis, aenderungen: umgebung }) };
}
