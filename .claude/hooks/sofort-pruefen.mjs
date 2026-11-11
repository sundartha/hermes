import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chdir } from "node:process";
import { promisify } from "node:util";

import { block, git, isInside, readInput, realPath, repositoryRoot, startDirectory } from "./lib.mjs";

const ausfuehren = promisify(execFile);
const ESLINT_ORDNER = ["src", "test"];
const ESLINT_ENDUNGEN = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const SYNTAX_ORDNER = ["src", "scripts"];
const SYNTAX_ENDUNGEN = new Set([".js", ".mjs"]);
const BAUSYSTEM_ORDNER = ["tools", ".github/workflows", ".claude/hooks"];
const CI_DATEI = ".github/workflows/ci.yml";
const OBERGRENZE = /^ {2}OBERGRENZE_BAUSYSTEM_DATEIEN: (\d+)$/m;
const FEHLER_STUFE = 2;
const ERSTE_ZEILE = 1;
const LEERZEICHEN = /\s+/g;
const WEG = "So geht es richtig:";
const SYNTAX_ZEILE = /:(\d+)$/m;
const SYNTAX_MELDUNG = /^\w*Error: .*$/m;

function zuPruefendeDatei(input) {
  const pfad = input.tool_input?.file_path;
  if (typeof pfad !== "string") return undefined;
  const verzeichnis = startDirectory(input);
  const wurzel = realPath(repositoryRoot(verzeichnis));
  const datei = realPath(isAbsolute(pfad) ? pfad : resolve(verzeichnis, pfad));
  if (!isInside(datei, wurzel) || !existsSync(datei)) return undefined;
  return { wurzel, datei, pfad: relative(wurzel, datei).split(sep).join("/") };
}

function inOrdnern({ wurzel, datei }, ordner, endungen) {
  return (endungen === undefined || endungen.has(extname(datei))) && ordner.some((name) => isInside(datei, resolve(wurzel, name)));
}

async function eslintVerstoesse(ziel) {
  if (!inOrdnern(ziel, ESLINT_ORDNER, ESLINT_ENDUNGEN)) return [];
  const { ESLint } = await import("eslint");
  const eslint = new ESLint({ cwd: ziel.wurzel, applySuppressions: true });
  const [ergebnis] = await eslint.lintFiles([ziel.datei]);
  return ergebnis.messages
    .filter(({ severity }) => severity === FEHLER_STUFE)
    .map(({ line, ruleId, message }) => `${ziel.pfad}:${line}  ${ruleId ?? "parser"}  ${message.replace(LEERZEICHEN, " ")}`);
}

async function syntaxVerstoesse(ziel) {
  if (!inOrdnern(ziel, SYNTAX_ORDNER, SYNTAX_ENDUNGEN)) return [];
  try {
    await ausfuehren(process.execPath, ["--check", ziel.datei], { cwd: ziel.wurzel });
    return [];
  } catch (fehler) {
    if (typeof fehler.code !== "number") throw fehler;
    const zeile = SYNTAX_ZEILE.exec(fehler.stderr)?.[1] ?? ERSTE_ZEILE;
    const meldung = SYNTAX_MELDUNG.exec(fehler.stderr)?.[0] ?? "Syntaxfehler";
    return [`${ziel.pfad}:${zeile}  syntax  ${meldung}. ${WEG} die Zeile öffnen und Klammern, Anführungszeichen und import/export prüfen; .js und .mjs sind ES-Module.`];
  }
}

async function bestandsVerstoesse(ziel) {
  const { BESTAENDE, basisAus, bestandAuf, gewachseneEintraege } = await import("../../tools/pruefen.mjs");
  const bestand = BESTAENDE.find(({ datei }) => datei === ziel.pfad);
  if (bestand === undefined) return [];
  chdir(ziel.wurzel);
  const basis = basisAus([]);
  return gewachseneEintraege(bestandAuf(basis, bestand), bestandAuf(null, bestand))
    .map((eintrag) => `${ziel.pfad}:${ERSTE_ZEILE}  eingefrorene-bestaende  ${eintrag} ist neu oder öfter eingefroren. ${WEG} Bestände schrumpfen nur; die Ursache im Code beheben, statt einen Eintrag zu ergänzen.`);
}

function wachstumsVerstoesse(ziel) {
  if (!inOrdnern(ziel, BAUSYSTEM_ORDNER)) return [];
  const ci = join(ziel.wurzel, CI_DATEI);
  const grenze = existsSync(ci) ? OBERGRENZE.exec(readFileSync(ci, "utf8"))?.[1] : undefined;
  if (grenze === undefined) return [];
  const liste = git(ziel.wurzel, ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...BAUSYSTEM_ORDNER]).text;
  const dateien = liste.split("\n").filter(Boolean);
  if (dateien.length <= Number(grenze)) return [];
  return [`${ziel.pfad}:${ERSTE_ZEILE}  wachstumsbremse  Unter tools/, .github/workflows/ und .claude/hooks/ liegen ${dateien.length} Dateien, erlaubt sind ${grenze}. ${WEG} den Inhalt in eine bestehende Datei legen oder eine tote Datei mit Beleg per git grep entfernen; die Obergrenze OBERGRENZE_BAUSYSTEM_DATEIEN in ${CI_DATEI} nie anheben.`];
}

async function schrankenVerstoesse(ziel) {
  const { PRUEFREGELN, SYSTEM_BRANCH } = await import("../../tools/freigabe.mjs");
  if (!PRUEFREGELN.some((muster) => muster.test(ziel.pfad))) return [];
  const zweig = git(ziel.wurzel, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!zweig.ok || SYSTEM_BRANCH.test(zweig.text)) return [];
  return [`${ziel.pfad}:${ERSTE_ZEILE}  freigabe-schranke  ${ziel.pfad} ist eine Prüfregel-Datei, Branch ${zweig.text}, die Freigabe-Prüfung wird rot. ${WEG} nur ändern, wenn der Plan im Issue diese Datei nennt, sonst die Änderung zurücknehmen; den Branch nie umbenennen, um die Prüfung zu umgehen; nach PASS zieht die Kette den PR auf system/* um.`];
}

const PRUEFUNGEN = [eslintVerstoesse, syntaxVerstoesse, bestandsVerstoesse, wachstumsVerstoesse, schrankenVerstoesse];

function uebersprungen(fehler) {
  return `sofort-pruefen: Prüfung übersprungen (${String(fehler.message).split("\n")[0]})`;
}

async function main() {
  const ziel = zuPruefendeDatei(readInput());
  if (ziel === undefined) return;
  const uebersprungene = [];
  const ergebnisse = await Promise.all(PRUEFUNGEN.map(async (pruefung) => {
    try {
      return await pruefung(ziel);
    } catch (fehler) {
      uebersprungene.push(uebersprungen(fehler));
      return [];
    }
  }));
  const gefunden = ergebnisse.flat();
  if (gefunden.length > 0) block("hooks/sofort-pruefen", [...gefunden, ...uebersprungene]);
  for (const zeile of uebersprungene) console.error(zeile);
}

main().catch((fehler) => {
  console.error(uebersprungen(fehler));
});
