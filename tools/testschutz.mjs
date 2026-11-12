import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APPROVERS, IMPORT_VOR_PFAD, alleSeiten, entfernteZeilen, ereignis, geaenderteDateien, inhaltAn } from "./github.mjs";

const LABEL = "verhalten-geaendert";
const GESCHUETZT = /^test\//;
const AUSGENOMMEN = new Set(["test/testbaenke-run.mjs"]);
const GELOESCHT = "D";
const GEAENDERT = "M";
const NEU = "A";
const EXIT_ROT = 1;
const FLACHE_TIEFE = 2;
const BEREICHS_TIEFE = 3;

const QUELLDATEI = /\.(?:js|mjs|cjs|ts)$/;
const UEBERSPRUNGEN = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|` + "`(?:\\\\.|[^`\\\\])*`" + String.raw`|\/\/[^\n]*|\/\*[\s\S]*?\*\/`;
const RELATIVER_IMPORT = new RegExp(String.raw`(${UEBERSPRUNGEN})|(${IMPORT_VOR_PFAD})(["'])(?:\.\/|(\.\.\/))((?:\\.|(?!\3)[^\\\n])*)\3`, "g");

const OHNE_TEMPLATE = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/`;
const AUSDRUCK = String.raw`\$\{(?:[^{}]|\{[^{}]*\})*\}`;
const TEMPLATE = "`(?:\\\\.|[^`\\\\$]|\\$(?!\\{)|" + AUSDRUCK + ")*`";
const DATEIRELATIV = new RegExp(String.raw`${OHNE_TEMPLATE}|(${TEMPLATE})|(\x60)|(import\.meta\b|__dirname|__filename|\bimport\s*\(\s*\x60\.{1,2}\/)`, "g");
const TEMPLATE_AUSDRUCK = /\$\{((?:[^{}]|\{[^{}]*\})*)\}/g;

function hatDateirelativenPfad(inhalt) {
  return [...inhalt.matchAll(DATEIRELATIV)].some(([, vorlage, einzeln, pfad]) => {
    if (vorlage !== undefined) return [...vorlage.matchAll(TEMPLATE_AUSDRUCK)].some(([, ausdruck]) => hatDateirelativenPfad(ausdruck));
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

async function main() {
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
