import { realpathSync } from "node:fs";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

import { APPROVERS, IMPORT_PRAEFIX, QUELLDATEI, alleSeiten, api, apiSenden, entfernteZeilen, ereignis, geaenderteDateien, inhaltAn, jobLog } from "./github.mjs";

const LABEL = "verhalten-geaendert";
const GESCHUETZT = /^test\//;
const AUSGENOMMEN = new Set(["test/testbaenke-run.mjs"]);
const GELOESCHT = "D";
const GEAENDERT = "M";
const NEU = "A";
const EXIT_ROT = 1;
const FLACHE_TIEFE = 2;
const BEREICHS_TIEFE = 3;

const UEBERSPRUNGEN = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|` + "`(?:\\\\.|[^`\\\\])*`" + String.raw`|\/\/[^\n]*|\/\*[\s\S]*?\*\/`;
const RELATIVER_IMPORT = new RegExp(String.raw`(${UEBERSPRUNGEN})|${IMPORT_PRAEFIX}(?:\.\/|(\.\.\/))((?:\\.|(?!\3)[^\\\n])*)\3`, "g");

const OHNE_TEMPLATE = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/`;
const AUSDRUCK = String.raw`\$\{(?:[^{}]|\{[^{}]*\})*\}`;
const TEMPLATE = "`(?:\\\\.|[^`\\\\$]|\\$(?!\\{)|" + AUSDRUCK + ")*`";
const REGEX_LITERAL = String.raw`(?<=[=(,:;!&|?{}\[]\s*)\/(?![\/*])(?:\\.|[^\/\\\n])+\/[a-z]*`;
const DATEIRELATIV = new RegExp(String.raw`(${REGEX_LITERAL})|${OHNE_TEMPLATE}|(${TEMPLATE})|(\x60)|(import\.meta\b|__dirname|__filename|\bimport\s*\(\s*\x60\.{1,2}\/)`, "g");
const TEMPLATE_AUSDRUCK = /\$\{((?:[^{}]|\{[^{}]*\})*)\}/g;

const PAAR = 2;
const ANFUEHRUNG = /["'\x60]|import\.meta\b|__dirname|__filename/;

function ungerade(ausdruck) {
  return ["\"", "'"].some((zeichen) => ausdruck.split(zeichen).length % PAAR === 0);
}

function hatDateirelativenPfad(inhalt) {
  return [...inhalt.matchAll(DATEIRELATIV)].some(([, regex, vorlage, einzeln, pfad]) => {
    if (regex !== undefined) return ANFUEHRUNG.test(regex);
    if (vorlage !== undefined) return [...vorlage.matchAll(TEMPLATE_AUSDRUCK)].some(([, ausdruck]) => ungerade(ausdruck) || hatDateirelativenPfad(ausdruck));
    return einzeln !== undefined || pfad !== undefined;
  });
}

function ordnerEinTieferAnweisung(...treffer) {
  const [, uebersprungen, vor, anfuehrung, aufwaerts = "", rest] = treffer;
  return uebersprungen ?? `${vor}${anfuehrung}../${aufwaerts}${rest}${anfuehrung}`;
}

function ordnerEinTiefer(inhalt, pfad) {
  return QUELLDATEI.test(pfad) ? inhalt.replace(RELATIVER_IMPORT, ordnerEinTieferAnweisung) : inhalt;
}

function istVerschiebung({ basis, kopf }, pfad, ziel) {
  const alt = inhaltAn(basis, pfad);
  return alt !== undefined && !hatDateirelativenPfad(alt) && ordnerEinTiefer(alt, pfad) === inhaltAn(kopf, ziel);
}

function istZiel(kandidat, name) {
  return kandidat.split("/").length === BEREICHS_TIEFE && kandidat.startsWith("test/") && kandidat.endsWith(`/${name}`);
}

function verschobeneDateien(dateien, basis, kopf) {
  const ziele = dateien.filter(({ status }) => status === NEU).map(({ pfad }) => pfad);
  const verschoben = new Set();
  const belegt = new Set();
  for (const { status, pfad } of dateien) {
    if (status !== GELOESCHT || pfad.split("/").length !== FLACHE_TIEFE) continue;
    const name = pfad.slice("test/".length);
    const ziel = ziele.find((kandidat) => !belegt.has(kandidat) && istZiel(kandidat, name) && istVerschiebung({ basis, kopf }, pfad, kandidat));
    if (ziel === undefined) continue;
    belegt.add(ziel);
    verschoben.add(pfad);
  }
  return verschoben;
}

export function testschutzBefunde(basis, kopf) {
  const dateien = geaenderteDateien(basis, kopf);
  const verschoben = verschobeneDateien(dateien, basis, kopf);
  return dateien
    .filter(({ pfad }) => GESCHUETZT.test(pfad) && !AUSGENOMMEN.has(pfad) && !verschoben.has(pfad))
    .flatMap(({ status, pfad }) => {
      if (status === GELOESCHT) return [`${pfad}: bestehende Testdatei gelöscht`];
      if (status === NEU) return [];
      if (status !== GEAENDERT) return [`${pfad}: bestehende Testdatei durch etwas anderes ersetzt (Status ${status})`];
      const entfernt = entfernteZeilen(basis, pfad, kopf);
      return entfernt.length === 0 ? [] : [`${pfad}: ${entfernt.length} bestehende Zeilen geändert oder entfernt`];
    });
}

export const TESTSCHUTZ_AUSWEG = `Bestehende Tests dürfen nur ergänzt werden. Ändert der PR absichtlich Verhalten, setzt ${APPROVERS.join(" oder ")} das Label ${LABEL} am PR.`;

async function freigegebenVon(pr) {
  const ereignisse = await alleSeiten(`/issues/${pr}/events`);
  const letztes = ereignisse.filter(({ label }) => label?.name === LABEL).at(-1);
  if (letztes?.event !== "labeled") return null;
  return APPROVERS.includes(letztes.actor?.login) ? letztes.actor.login : null;
}

const WACKELIG = "wackelig";
const SAMMEL_JOB = "CI";
const ROT = "failure";
const LAUF_ZAEHLER = /^Neulauf-Wackler Nr\. \d+: /;
const ERSTES_VORKOMMEN_ZAEHLT_MIT = 2;
const ZEITSTEMPEL = /^\S+Z /;
const DATEI_ZEILE = /^# Subtest: (.+\.test\.[cm]?[jt]s)$/;
const TEST_ZEILE = /^(\s+)not ok \d+ - (.+?)(?: # .*)?$/;
const SPEC_ZEILE = /^\s*✗ (.+) \((\S+\.test\.[cm]?[jt]s):\d+:\d+\)$/;
const BASIS_ROT_ZEILE = /^Basis rot: (\S+) war bei /;
const TESTORDNER = /^.*?\/((?:apps\/web\/)?test\/)/;

function speczeilenNamen(zeile) {
  const spec = SPEC_ZEILE.exec(zeile);
  const basisRot = BASIS_ROT_ZEILE.exec(zeile)?.[1];
  return [...(spec === null ? [] : [`${spec[2].replace(TESTORDNER, "$1")} › ${spec[1]}`]), ...(basisRot === undefined ? [] : [`${basisRot} (Mutation)`])];
}

function rotTests(log, jobName) {
  const namen = [];
  let datei;
  let letzteTiefe = 0;
  for (const roh of log.split("\n")) {
    const zeile = roh.replace(ZEITSTEMPEL, "").replace(/\r$/, "");
    const neueDatei = DATEI_ZEILE.exec(zeile)?.[1];
    if (neueDatei !== undefined) {
      datei = neueDatei.replace(TESTORDNER, "$1");
      letzteTiefe = 0;
    }
    namen.push(...speczeilenNamen(zeile));
    const treffer = TEST_ZEILE.exec(zeile);
    if (treffer === null) continue;
    const tiefe = treffer[1].length;
    const istEltern = tiefe < letzteTiefe;
    letzteTiefe = tiefe;
    if (!istEltern) namen.push(datei === undefined ? `${jobName} › ${treffer[2]}` : `${datei} › ${treffer[2]}`);
  }
  return namen.length === 0 ? [jobName] : namen;
}

function wacklerTitel(versuche, logs) {
  const titel = new Set();
  for (const { jobs } of versuche) {
    for (const job of jobs.filter(({ conclusion, name }) => conclusion === ROT && name !== SAMMEL_JOB)) {
      for (const eintrag of rotTests(logs[job.id] ?? "", job.name)) titel.add(`Wackelig: ${eintrag}`);
    }
  }
  return [...titel];
}

export function wacklerAuswerten({ versuche, logs, offeneIssues, laufLink }) {
  return wacklerTitel(versuche, logs).map((title) => {
    const offen = offeneIssues.find((issue) => issue.title === title);
    if (offen === undefined) return { anlegen: { title, labels: [WACKELIG], body: `Neulauf-Wackler Nr. 1: ${laufLink}` } };
    return { kommentieren: { nummer: offen.number, body: `Neulauf-Wackler Nr. ${offen.laeufe + ERSTES_VORKOMMEN_ZAEHLT_MIT}: ${laufLink}` } };
  });
}

async function offeneWackler(github) {
  const offene = await github.alleSeiten(`/issues?state=open&labels=${WACKELIG}`);
  return Promise.all(offene.map(async ({ number, title }) => {
    const kommentare = await github.alleSeiten(`/issues/${number}/comments`);
    return { number, title, laeufe: kommentare.filter(({ body }) => LAUF_ZAEHLER.test(body)).length };
  }));
}

async function fruehereVersuche(github, umgebung) {
  const aktuell = Number(umgebung.GITHUB_RUN_ATTEMPT);
  const nummern = Array.from({ length: aktuell - 1 }, (leer, i) => i + 1);
  return Promise.all(nummern.map(async (versuch) => {
    const { jobs } = await github.lesen(`/actions/runs/${umgebung.GITHUB_RUN_ID}/attempts/${versuch}/jobs?per_page=100`);
    return { versuch, jobs };
  }));
}

export async function wacklerErfassen(github, umgebung) {
  if (Number(umgebung.GITHUB_RUN_ATTEMPT) <= 1) return;
  const versuche = await fruehereVersuche(github, umgebung);
  const logs = {};
  for (const { jobs } of versuche) {
    for (const job of jobs.filter(({ conclusion, name }) => conclusion === ROT && name !== SAMMEL_JOB)) logs[job.id] = await github.log(job.id);
  }
  const laufLink = `${umgebung.GITHUB_SERVER_URL}/${umgebung.GITHUB_REPOSITORY}/actions/runs/${umgebung.GITHUB_RUN_ID}/attempts/${umgebung.GITHUB_RUN_ATTEMPT}`;
  const aktionen = wacklerAuswerten({ versuche, logs, offeneIssues: await offeneWackler(github), laufLink });
  for (const { anlegen, kommentieren } of aktionen) {
    if (anlegen === undefined) await github.senden(`/issues/${kommentieren.nummer}/comments`, "POST", { body: kommentieren.body });
    else await github.senden("/issues", "POST", anlegen);
  }
}

async function main() {
  if (process.argv.includes("--wackler")) {
    await wacklerErfassen({ lesen: api, alleSeiten, senden: apiSenden, log: jobLog }, env);
    return;
  }
  const { pr, basis, kopf } = ereignis();
  const befunde = testschutzBefunde(basis, kopf);
  if (befunde.length === 0) {
    console.log("Testschutz: bestehende Tests nur ergänzt.");
    return;
  }
  for (const befund of befunde) console.log(befund);
  const wer = await freigegebenVon(pr);
  if (wer !== null) {
    console.log(`Testschutz: Änderung bestehender Tests freigegeben von ${wer} (Label ${LABEL}).`);
    return;
  }
  console.log(`Testschutz: ${TESTSCHUTZ_AUSWEG}`);
  process.exitCode = EXIT_ROT;
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
