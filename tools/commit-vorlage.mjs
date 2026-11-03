import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

const VON_GIT = new Set(["merge", "squash"]);
const VON_GIT_VORGEGEBEN = ["MERGE_MSG", "SQUASH_MSG"];
const AUFRAEUMEN = /^(?:fixup|squash|amend)!/i;
export const HERKUNFT = /^(?:Paket: \S+|Auftrag: [^\s/]+\/\S+)$/m;
export const BEGRUENDUNG = /\n\n(?:Warum|Ursache): \S/;
const ANHANG = /^[A-Za-z]+-[A-Za-z-]*[A-Za-z]: \S/;
const PAKET_BRANCH = /^paket\/([^\s/-]+)/;
const ABSAETZE = /\n{2,}/;
const KOMMENTAR = /^#(?: |$)/;
const SCHERE = /^# -+ >8 -+$/;
const ABSATZ = "\n\n";
const ZEILE = "\n";

function aktuellerBranch() {
  try {
    const args = ["symbolic-ref", "-q", "--short", "HEAD"];
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function nachrichtVonGit() {
  try {
    const gitOrdner = execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return VON_GIT_VORGEGEBEN.some((datei) => existsSync(join(gitOrdner, datei)));
  } catch {
    return false;
  }
}

function getrennt(text) {
  const zeilen = text.split(ZEILE);
  const schere = zeilen.findIndex((zeile) => SCHERE.test(zeile));
  let ende = schere === -1 ? zeilen.length : schere;
  while (ende > 0 && (zeilen[ende - 1] === "" || KOMMENTAR.test(zeilen[ende - 1]))) ende -= 1;
  const kommentar = zeilen.slice(ende).join(ZEILE).trim();
  return { inhalt: zeilen.slice(0, ende).join(ZEILE).trim(), kommentar };
}

function nurAnhang(absatz) {
  return absatz.split(ZEILE).every((zeile) => ANHANG.test(zeile));
}

function mitBegruendung(absaetze) {
  if (BEGRUENDUNG.test(absaetze.join(ABSATZ))) return absaetze;
  const index = absaetze.findIndex((absatz, stelle) => stelle > 0 && !nurAnhang(absatz) && !HERKUNFT.test(absatz));
  if (index === -1) return absaetze;
  return absaetze.with(index, `Warum: ${absaetze[index]}`);
}

function mitHerkunft(absaetze, branch) {
  const kuerzel = PAKET_BRANCH.exec(branch)?.[1];
  if (kuerzel === undefined || absaetze.some((absatz) => HERKUNFT.test(absatz))) return absaetze;
  const herkunft = `Paket: ${kuerzel}`;
  const letzter = absaetze.at(-1);
  if (nurAnhang(letzter)) return [...absaetze.slice(0, -1), herkunft, letzter];
  return [...absaetze, herkunft];
}

function ausVorlage(text, branch) {
  const { inhalt, kommentar } = getrennt(text);
  const teile = inhalt.split(ABSAETZE);
  if (teile.length === 1 || AUFRAEUMEN.test(inhalt)) return text;
  const absaetze = mitHerkunft(mitBegruendung(teile), branch);
  const neu = `${absaetze.join(ABSATZ)}${ZEILE}`;
  return kommentar === "" ? neu : `${neu}${ZEILE}${kommentar}${ZEILE}`;
}

function direktAufgerufen(skript) {
  try {
    return pathToFileURL(realpathSync(skript)).href === import.meta.url;
  } catch {
    return false;
  }
}

const [, skript, datei, quelle] = argv;
if (skript !== undefined && direktAufgerufen(skript) && datei !== undefined && !VON_GIT.has(quelle) && !nachrichtVonGit()) {
  try {
    writeFileSync(datei, ausVorlage(readFileSync(datei, "utf8"), aktuellerBranch()));
  } catch (fehler) {
    console.error(`commit-vorlage: Nachricht unverändert gelassen: ${fehler.message}`);
  }
}
