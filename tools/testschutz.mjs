import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APPROVERS, alleSeiten, entfernteZeilen, ereignis, geaenderteDateien, inhaltAn } from "./github.mjs";

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
const RELATIVER_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])(?:\.\/|(\.\.\/))/g;

function ordnerEinTiefer(inhalt, pfad) {
  return QUELLDATEI.test(pfad) ? inhalt.replace(RELATIVER_IMPORT, "$1$2../$3") : inhalt;
}

function istVerschiebung(basis, kopf, pfad, ziel) {
  const alt = inhaltAn(basis, pfad);
  return alt !== undefined && ordnerEinTiefer(alt, pfad) === inhaltAn(kopf, ziel);
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
    const ziel = ziele.find((kandidat) => !belegt.has(kandidat) && istZiel(kandidat, name) && istVerschiebung(basis, kopf, pfad, kandidat));
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
