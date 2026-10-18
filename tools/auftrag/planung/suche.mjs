import { pfadIstSauber } from "../format.mjs";
import { gitLauf } from "./git.mjs";

const EXIT_GRUEN = 0;
const EXIT_AUFRUF = 2;
const OHNE_TREFFER = 1;
const MUSTER_UNGUELTIG = 128;
const KEINE_TREFFER = "keine Treffer";
const KEINE_DATEIEN = "keine Dateien";
const GESPERRT = [":(exclude,glob,icase)**/.env*", ":(exclude,glob)data/**"];
const CODE_ORDNER = ["src", "tools"];
const CODE_ENDUNGEN = ["js", "mjs", "cjs", "ts", "mts", "cts"];
const CODE_DATEIEN = CODE_ORDNER.flatMap((ordner) => CODE_ENDUNGEN.map((endung) => `:(glob)${ordner}/**/*.${endung}`));

function unsaubereAbgelehnt(pfade) {
  const unsauber = pfade.filter((pfad) => !pfadIstSauber(pfad));
  if (unsauber.length === 0) return false;
  console.error(`Abbruch: ${unsauber.join(", ")} muss ein relativer Pfad im Repo ohne . und .. sein`);
  return true;
}

const TREFFER_ZEILE = /^(.+?):(\d+):/;

function grepLauf(muster, pfade, root) {
  return gitLauf(root, ["-c", "core.quotePath=false", "grep", "-n", "-I", "--full-name", "-e", muster, "--", ...pfade, ...GESPERRT], { erlaubt: [EXIT_GRUEN, OHNE_TREFFER, MUSTER_UNGUELTIG] });
}

export function suchTreffer(muster, root) {
  const lauf = grepLauf(muster, CODE_DATEIEN, root);
  if (lauf.status === MUSTER_UNGUELTIG) return null;
  if (lauf.status !== EXIT_GRUEN) return [];
  return lauf.stdout.split("\n").flatMap((zeile) => {
    const treffer = TREFFER_ZEILE.exec(zeile);
    return treffer === null ? [] : [`${treffer[1]}:${treffer[2]}`];
  });
}

export function suche([muster, ...pfade], root) {
  if (unsaubereAbgelehnt(pfade)) return EXIT_AUFRUF;
  const lauf = grepLauf(muster, pfade, root);
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
