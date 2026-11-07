import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APPROVERS, alleSeiten, entfernteZeilen, ereignis, geaenderteDateien } from "./github.mjs";

const LABEL = "verhalten-geaendert";
const TESTDATEI = /^test\/.*\.test\.[cm]?[jt]s$|^test\/sicherheit\/werkzeugtexte\.json$/;
const GELOESCHT = "D";
const GEAENDERT = "M";
const EXIT_ROT = 1;

export function testschutzBefunde(basis, kopf) {
  return geaenderteDateien(basis, kopf)
    .filter(({ pfad }) => TESTDATEI.test(pfad))
    .flatMap(({ status, pfad }) => {
      if (status === GELOESCHT) return [`${pfad}: bestehender Test gelöscht`];
      if (status !== GEAENDERT) return [];
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
