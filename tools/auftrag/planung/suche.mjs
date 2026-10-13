import { pfadIstSauber } from "../format.mjs";
import { gitLauf } from "./git.mjs";

const EXIT_GRUEN = 0;
const EXIT_AUFRUF = 2;
const OHNE_TREFFER = 1;
const KEINE_TREFFER = "keine Treffer";
const KEINE_DATEIEN = "keine Dateien";
const GESPERRT = [":(exclude,glob,icase)**/.env*", ":(exclude,glob)data/**"];

function unsaubereAbgelehnt(pfade) {
  const unsauber = pfade.filter((pfad) => !pfadIstSauber(pfad));
  if (unsauber.length === 0) return false;
  console.error(`Abbruch: ${unsauber.join(", ")} muss ein relativer Pfad im Repo ohne . und .. sein`);
  return true;
}

export function suche([muster, ...pfade], root) {
  if (unsaubereAbgelehnt(pfade)) return EXIT_AUFRUF;
  const lauf = gitLauf(root, ["grep", "-n", "-I", "--full-name", "-e", muster, "--", ...pfade, ...GESPERRT], { erlaubt: [EXIT_GRUEN, OHNE_TREFFER] });
  if (lauf.status === OHNE_TREFFER && lauf.stdout === "" && lauf.stderr === "") {
    console.log(KEINE_TREFFER);
    return EXIT_GRUEN;
  }
  if (lauf.status !== EXIT_GRUEN) throw new Error(`git grep ist mit Exit ${lauf.status} gescheitert: ${lauf.stderr}`);
  process.stdout.write(lauf.stdout);
  return EXIT_GRUEN;
}

export function dateien(pfade, root) {
  if (unsaubereAbgelehnt(pfade)) return EXIT_AUFRUF;
  const { stdout } = gitLauf(root, ["ls-files", "--", ...pfade]);
  if (stdout === "") console.log(KEINE_DATEIEN);
  else process.stdout.write(stdout);
  return EXIT_GRUEN;
}
